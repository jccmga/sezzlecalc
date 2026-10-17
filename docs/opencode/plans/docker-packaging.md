# Plan: Docker Packaging for the Full Stack

- **PRD:** `docs/opencode/prds/docker-packaging.md` (single source of truth; all six open questions resolved in §12 — do not re-open)
- **Contract:** the system-provided `api-contract` skill (single source of truth for the REST contract; **not a file in this worktree** — verified by glob) — not modified by this feature
- **Repo root (isolated worktree, already active):** `/Users/juancamilocortesmedina/workspace/sezzlecalc-worktrees/feat-docker-packaging`
- **Scope:** Packaging only — 2 Dockerfiles, 2 `.dockerignore` files, 1 nginx config, 1 compose file, plus Makefile/README updates and a single app-code change (`cmd/server/main.go` `PORT` support, OQ-1). No API, domain, or UI behavior changes.
- **Worktree rule:** All edits stay in this `feat-docker-packaging` worktree, never the main checkout (per `AGENTS.md`). Confirmed via `git rev-parse --show-toplevel`.

---

## 1. Context & Goals

### Context (verified in this worktree)

- Backend entrypoint `backend/cmd/server/main.go` hardcodes `Addr: ":8080"` (line 20) with no env read. `slog` logs to stderr; server timeouts 5s/10s/10s/60s. **The only application-code change** is adding `PORT` support here (OQ-1).
- Backend routes are plain paths `/evaluate` and `/health` (`backend/internal/httpapi/httpapi.go:44-46`); no `/api` prefix on the server. The `/api` prefix is added only by the Vite dev proxy (`frontend/vite.config.ts:14-22`) and, after this feature, nginx.
- Go module `sezzlecalc/backend`, `go 1.22`, no `toolchain` directive (`backend/go.mod`). Deps: `testify` (test-only) + indirect `go.yaml.in/yaml/v3`; `backend/go.sum` present.
- Frontend `build` = `tsc -b && vite build`; `@types/node@^24` (Node 24 is the matching runtime); `package-lock.json` is committed → `npm ci` is viable (`frontend/package.json`).
- `VITE_API_BASE_URL` defaults to `/api`, trailing slashes stripped; endpoint = `${base}/evaluate` (`frontend/src/lib/api.ts:12-17`); typed as optional in `frontend/src/vite-env.d.ts:3-5`.
- `make check` = `backend-build backend-test backend-vet frontend-test frontend-lint frontend-build` with **no Docker** (`Makefile:15`).
- `.gitignore` already ignores `frontend/dist/`, `frontend/.vite/`, `frontend/*.tsbuildinfo`, `backend/coverage.txt` (lines 20, 113-116).
- **No Docker artifacts exist** anywhere (verified by glob: no `Dockerfile*`, `.dockerignore`, or compose file).
- README claims Docker is absent in **4 places**: `README.md:12`, `:14`, `:182`, `:407`.

### Desired outcome

1. `docker compose build` reproducibly builds both images from a clean checkout.
2. `docker compose up -d` serves the browser experience at `http://localhost:3000` and the backend at `http://localhost:8080`, with nginx stripping `/api/` so the browser path (`/api/evaluate`) is identical to the Vite dev proxy path.
3. Production-grade backend image: multi-stage, `CGO_ENABLED=0` static binary, distroless `static-debian13:nonroot` runtime, non-root uid 65532, `EXPOSE 8080`.
4. Reproducible frontend image: `npm ci` (with devDependencies) → `tsc -b && vite build` with `VITE_API_BASE_URL=/api` inlined → nginx 1.30-alpine runtime with SPA fallback + `/api/` proxy.
5. `make check` remains green and remains Docker-free (unchanged target).
6. README matches reality — no "no Docker" claims remain; layout tree lists the six new files.

### Non-goals (explicit — do not touch)

| ID | Out of scope |
|----|--------------|
| NG-1 | Any change to `/evaluate` or `/health` semantics, shapes, or the error taxonomy (api-contract frozen). |
| NG-2 | Changes to `internal/calc`, `internal/httpapi`, or the frontend `src/**` tree. |
| NG-3 | CORS middleware (same-origin through nginx; backend intentionally has none). |
| NG-4 | Registry publishing, tagging strategy, multi-arch `--platform` builds. |
| NG-5 | TLS/HTTPS, reverse-proxy hardening, WAF, rate limiting. |
| NG-6 | Kubernetes/Helm/swarm, compose profiles/overlays. |
| NG-7 | CI/CD, vulnerability scanning, SBOM, image signing. |
| NG-8 | Container healthchecks / readiness gating (distroless has no shell/curl; OQ-5). |
| NG-9 | Log aggregation, metrics, tracing. |
| NG-10 | Non-root nginx master/worker redesign (backend-only requirement; R-7). |
| NG-11 | Browser automation (Playwright/Cypress); repo has Vitest/jsdom only (OQ-4). |
| NG-12 | Expression parser, persistence, auth, i18n. |

### Explicitly UNCHANGED (do not modify)

`backend/go.mod`, `backend/go.sum`, `backend/internal/calc/*`, `backend/internal/httpapi/*`, `frontend/package.json`, `frontend/package-lock.json`, `frontend/vite.config.ts`, `frontend/src/**`, `frontend/tsconfig*.json`, `frontend/index.html`, `frontend/eslint.config.js`, `frontend/components.json`, `.gitignore`.

The `api-contract` skill is **system-provided** (single source of truth for the REST contract; not a file in this worktree — verified by glob) and is out of scope for any edit. The plan must not direct the coder to `git status` or otherwise verify a `.opencode/skills/api-contract/SKILL.md` file path.

---

## 2. Approach

**Backend.** A multi-stage `backend/Dockerfile` compiles with `golang:1.26` (Go ≥ the `go 1.22` directive) into a fully static binary (`CGO_ENABLED=0 GOOS=linux`, `-trimpath -ldflags="-s -w"`) written to `/out/server`, then copies only that binary onto `gcr.io/distroless/static-debian13:nonroot` and runs it via exec-form `ENTRYPOINT ["/server"]`. The layer-caching sequence is `COPY go.mod go.sum ./` → `RUN go mod download` → `COPY . .` → `go build`, so touching only `cmd/` or `internal/` does not re-download modules (AC-B8). The only app-code change is `PORT` support in `main.go`: read `os.Getenv("PORT")`, default `"8080"`, and build `Addr` as `":" + port`. Default stays `:8080`; everything else in the server construction is untouched.

**Frontend.** A multi-stage `frontend/Dockerfile` installs with `npm ci` (keeping devDependencies so `tsc -b` runs), then sets `ARG VITE_API_BASE_URL=/api` + `ENV VITE_API_BASE_URL=$VITE_API_BASE_URL` **before** `RUN npm run build`, so Vite inlines `/api` into the bundle at build time. The runtime stage copies `dist/` to `/usr/share/nginx/html` and `nginx.conf` to `/etc/nginx/conf.d/default.conf` on `nginx:1.30-alpine`, replacing the stock default server block (no duplicate `default_server` warning). `nginx.conf` uses `location /api/ { proxy_pass http://backend:8080/; }` — trailing slash on both sides — so nginx strips `/api/` exactly once and forwards `POST /evaluate` to the `backend` service; `location / { try_files $uri $uri/ /index.html; }` handles SPA deep links.

**Compose.** A root `docker-compose.yml` (no `version:` key) defines exactly `backend` (context `./backend`, `PORT=8080`, `8080:8080`) and `frontend` (context `./frontend`, build arg `VITE_API_BASE_URL=/api`, `3000:80`, `depends_on: backend`). The service name `backend` is the DNS contract nginx consumes (IR-2).

**Makefile & README.** Add `.PHONY` targets `docker-build`, `docker-up`, `docker-down` , and `docker-e2e`, list them in `help`, and **do not** add them to `check`. Update README: fix the four "no Docker" statements, add a Docker section, update the layout tree, and note the `PORT` default and the nginx 1.30 deviation.

### Alternatives considered and rejected

- **`nginx:1.27-alpine` runtime.** Rejected (OQ-6): 1.27 is a superseded mainline branch; using `nginx:1.30-alpine` (current stable) is a deliberate security deviation, recorded in README.
- **Container healthcheck / readiness gate.** Rejected (OQ-5): distroless `static-debian13` has no shell/curl. `depends_on` is start-order only; the one-time 502 race is accepted and documented as a retry, not a defect.
- **Proxying `/health` on port 3000.** Rejected (OQ-3): health stays at `http://localhost:8080/health`; nginx proxies `/api/` only.
- **Browser automation (Playwright/Cypress) for the `12 × 4 = 48` check.** Rejected (OQ-4): the automatable equivalent is `curl` through `http://localhost:3000/api/evaluate`; the browser step is a documented manual QA check.
- **`--omit=dev` / `NODE_ENV=production` during frontend install.** Rejected: `npm run build` runs `tsc -b`, and TypeScript/Vite are devDependencies (AC-W2, AC-W4).
- **Reading `PORT` in the Dockerfile or hardcoding a second default.** Rejected: `PORT` is read at runtime by `main.go` only (default 8080), so `docker run` and compose both honor the same single source of truth.
- **A root-level `.dockerignore`.** Rejected: build contexts are per-service (`./backend`, `./frontend`), so each context needs its own file (PRD §6).

---

## 3. File-by-file changes

All paths relative to repo root. **New: 6 files. Modified: 2 files (`backend/cmd/server/main.go`, `Makefile`, plus `README.md` = 3 modified). Deleted: none.**

| # | Path | Status | Description |
|---|------|--------|-------------|
| 1 | `backend/cmd/server/main.go` | **Modified** | Add `PORT` env support (default `8080`); the only app-code change (OQ-1). |
| 2 | `backend/Dockerfile` | New | Multi-stage static build → distroless `static-debian13:nonroot`. |
| 3 | `backend/.dockerignore` | New | Slim the `./backend` build context. |
| 4 | `frontend/Dockerfile` | New | Multi-stage `node:24-alpine` build → `nginx:1.30-alpine`. |
| 5 | `frontend/.dockerignore` | New | Slim the `./frontend` build context (keep lockfile/nginx.conf/src). |
| 6 | `frontend/nginx.conf` | New | SPA fallback + `/api/` proxy to `backend:8080`. |
| 7 | `docker-compose.yml` | New | Root compose: `backend` + `frontend` services. |
| 8 | `Makefile` | **Modified** | Add `.PHONY` Docker targets + `help` entries (not in `check`). |
| 9 | `README.md` | **Modified** | Fix 4 "no Docker" claims, add Docker section, update layout tree. |

---

### File 1 — `backend/cmd/server/main.go` (modified)

Change **only** the `Addr` construction. `os` is already imported (line 8); no new imports, no parsing, no validation — `PORT` is a bare port number (the compose file sets `PORT: "8080"`, never `":8080"`).

Before (lines 19-26):

```go
	srv := &http.Server{
		Addr:              ":8080",
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      10 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
```

After:

```go
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	srv := &http.Server{
		Addr:              ":" + port,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      10 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
```

Notes:

- The existing `logger.Info("calculator server listening", "addr", srv.Addr)` (line 28) is **unchanged** and already logs the resolved address (`:8080` by default, or `:<port>`), satisfying AC-C7's "logs the actual listen address at startup".
- Default is exactly `:8080` when `PORT` is unset or empty; compose sets `PORT=8080` which resolves to `:8080`. Behavior is otherwise byte-identical.
- No `strconv` import, no validation of `PORT` contents — a malformed value (e.g. `PORT=:8080`) would yield `::8080` and fail to bind; that is out of scope (see Open questions).
- Maps to AC-C7, AC-R2, IR-4.

### File 2 — `backend/Dockerfile` (new)

```dockerfile
FROM golang:1.26 AS build
WORKDIR /src
ENV CGO_ENABLED=0
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/server ./cmd/server

FROM gcr.io/distroless/static-debian13:nonroot
COPY --from=build /out/server /server
EXPOSE 8080
ENTRYPOINT ["/server"]
```

Notes:

- Builder `golang:1.26` satisfies the `go 1.22` directive (`backend/go.mod:3`). No `toolchain` directive is present.
- Layer cache: `COPY go.mod go.sum ./` + `RUN go mod download` before `COPY . .` (AC-B8).
- `CGO_ENABLED=0 GOOS=linux` → fully static binary; distroless `static-debian13` is libc-less, so a successful `docker run` is itself the static-binary proof (AC-B3, AC-B6).
- Runtime image runs as the distroless non-root user (uid 65532); no `USER` directive needed (`:nonroot` variant sets it), no shell, no writable paths, only the binary copied (AC-B4, AC-S5).
- Exec-form `ENTRYPOINT ["/server"]` (shell-form would fail — no shell) (AC-B4).
- Maps to AC-B1…B5, AC-S1/S2/S5, AC-G1.

### File 3 — `backend/.dockerignore` (new)

```dockerignore
.git
.gitignore
Dockerfile
.dockerignore
README*
coverage.txt
*.out
*.test
.DS_Store
**/.DS_Store
```

Notes:

- Must **not** exclude `go.mod`, `go.sum`, `cmd/`, or `internal/` — the build needs them. Verify by `docker build` succeeding (AC-B7).
- `*.test`/`*.out` match no committed backend files (only `coverage.txt` is a real artifact, already git-ignored); they are defensive. Do not let them shadow needed sources.
- Maps to AC-B7, AC-S4, IR-6.

### File 4 — `frontend/Dockerfile` (new)

```dockerfile
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_API_BASE_URL=/api
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN npm run build

FROM nginx:1.30-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
```

Notes:

- `node:24-alpine` matches `@types/node@^24` (`frontend/package.json:27`).
- `npm ci` from `package-lock.json`, **with** devDependencies (no `--omit=dev`, no `NODE_ENV=production`) so `tsc -b` runs (AC-W2, AC-W4).
- Layer cache: `COPY package.json package-lock.json ./` + `npm ci` before `COPY . .` (AC-W8).
- `ARG VITE_API_BASE_URL=/api` + `ENV VITE_API_BASE_URL=$VITE_API_BASE_URL` are placed **before** `RUN npm run build` so Vite inlines `/api` (AC-W3, R-5).
- `npm run build` = `tsc -b && vite build` — a type error fails the image build (AC-W4).
- Runtime `nginx:1.30-alpine`; `dist/` → `/usr/share/nginx/html`; `nginx.conf` → `/etc/nginx/conf.d/default.conf` (replaces the stock server block; `/etc/nginx/nginx.conf` untouched) (AC-W5, AC-W6).
- `EXPOSE 80`; no runtime env (API base is baked at build time) (AC-W5, IR-1).
- Maps to AC-W1…W8, AC-S1/S2, AC-G1.

### File 5 — `frontend/.dockerignore` (new)

```dockerignore
node_modules
dist
.vite
*.tsbuildinfo
.git
.gitignore
npm-debug.log*
.DS_Store
**/.DS_Store
.env
.env.*
```

Notes:

- Must **not** exclude `package-lock.json`, `nginx.conf`, `tsconfig*.json`, `index.html`, or `src/` — `nginx.conf` is copied from the context into the runtime stage, so excluding it breaks the build (AC-W7).
- `node_modules` exclusion prevents host-arch esbuild/rollup binaries from poisoning the Linux build (R-10, AC-S4).
- `.env`/`.env.*` exclusion prevents secrets entering the image (no `.env` is committed; verified by glob) (AC-S3, AC-S4).
- `**/.DS_Store` is added to symmetrize with the backend `.dockerignore` (which already lists both `.DS_Store` and `**/.DS_Store`).
- Maps to AC-W7, AC-S3/S4, IR-6.

### File 6 — `frontend/nginx.conf` (new)

```nginx
server {
    listen 80;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;

    location /api/ {
        proxy_pass http://backend:8080/;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

Notes:

- `proxy_pass http://backend:8080/;` — **trailing slash on both the `location` and `proxy_pass`**. The trailing `/` on `proxy_pass` makes nginx replace the matched `/api/` prefix with `/`, so `POST /api/evaluate` → upstream `POST /evaluate` (AC-N1, AC-N2). `backend` equals the compose service name (AC-C3, IR-2).
- Longest-prefix matching guarantees `/api/` wins over `/`; no regex location is added that could reorder this (AC-N8).
- No CORS headers, no response rewriting, no `error_page` remapping, no gzip-off tricks — status codes and JSON bodies reach the browser unchanged (AC-N5, AC-N7).
- Standard proxy headers (`Host`, `X-Real-IP`, `X-Forwarded-For`, `X-Forwarded-Proto`) + `proxy_http_version 1.1` with `Connection ""` cleared for upstream keepalive friendliness (AC-N6).
- No `location = /health` — health is documented at `http://localhost:8080/health` (OQ-3, N-10).
- Maps to AC-N1…N8, AC-E1/E2/E7/E9, R-3, R-6.

### File 7 — `docker-compose.yml` (new, repo root)

```yaml
services:
  backend:
    build:
      context: ./backend
    environment:
      PORT: "8080"
    ports:
      - "8080:8080"

  frontend:
    build:
      context: ./frontend
      args:
        VITE_API_BASE_URL: /api
    ports:
      - "3000:80"
    depends_on:
      - backend
```

Notes:

- **No `version:` key** (obsolete; Compose v2) (AC-M2).
- `backend`: context `./backend`, `PORT: "8080"` (quoted → string, honored by `main.go`), host 8080 → container 8080, no volumes/command override (AC-C1).
- `frontend`: context `./frontend`, build arg `VITE_API_BASE_URL: /api` (plain scalar resolves to the string `/api`), host 3000 → container 80, `depends_on: backend` (start-order only; no healthcheck per OQ-5) (AC-C2).
- Service names exactly `backend` and `frontend`; default bridge network; no `.env`, no bind mounts, no `network_mode: host` (AC-C3, AC-C6).
- Maps to AC-M1/M2, AC-C1…C6, AC-G1, IR-2, IR-3.

### File 8 — `Makefile` (modified)

Extend the `.PHONY` line (line 1) to:

```make
.PHONY: help check backend-build backend-test backend-vet backend-cover frontend-install frontend-test frontend-lint frontend-build docker-build docker-up docker-down docker-e2e
```

Add to the `help` target (after the `frontend-build` echo, line 13):

```make
	@echo "  docker-build       Build both Docker images (docker compose build)"
	@echo "  docker-up          Start the full stack (docker compose up -d)"
	@echo "  docker-down        Stop and remove the stack (docker compose down)"
	@echo "  docker-e2e         Smoke-test the running stack via curl (requires docker-up)"
```

Append the target definitions after `frontend-build` (line 39):

```make
docker-build:
	docker compose build

docker-up:
	docker compose up -d

docker-down:
	docker compose down

docker-e2e:
	curl -sS -f --fail-with-body -o /dev/null -w 'GET / -> %{http_code} %{content_type}\n' http://localhost:3000/
	curl -sS -f --fail-with-body -X POST http://localhost:3000/api/evaluate -H 'Content-Type: application/json' -d '{"operation":"multiply","a":12,"b":4}'; echo
	curl -sS -f --fail-with-body http://localhost:8080/health; echo
```

Notes:

- **Do NOT add any Docker target to `check`** — `check` (line 15) stays exactly `backend-build backend-test backend-vet frontend-test frontend-lint frontend-build`, Docker-free (AC-G2).
- `docker-e2e` is retained as a real target (its `.PHONY` and `help` entries stay in sync). It probes an already-running stack (it does not build/up) and fails non-zero on any non-2xx response (502/404/422) via `-f --fail-with-body`.
- Maps to AC-D4, AC-G2.

### File 9 — `README.md` (modified)

Concrete edits (line numbers reference the current file):

1. **Line 12** — replace the "Docker packaging" status row:
   - From: `| Docker packaging for the full stack | ⏳ Later phase — **not yet present** (no compose file) |`
   - To: `| Docker packaging for the full stack | ✅ Built — \`docker compose up -d\`, frontend \`:3000\` + backend \`:8080\` |`

2. **Line 14** — replace the "no `docker compose` configuration" sentence:
   - From: `There is no \`docker compose\` configuration yet.`
   - To: `A root \`docker-compose.yml\` packages both layers; see "Docker (full stack)" below.`

3. **Line 182** — replace the "Docker packaging is a later phase" blockquote:
   - From: `> Docker packaging is a later phase: there is no \`docker compose\` configuration yet, so there is no \`docker compose up\` command to run.`
   - To: `> Docker packaging is available: see "Docker (full stack)" below for \`docker compose build\` / \`docker compose up -d\` / \`docker compose down\`.`

4. **Line 407** — replace the north-star remainder sentence:
   - From: `The remaining north-star item — Docker packaging for the full stack — is a later phase, not yet present.`
   - To: `Docker packaging for the full stack is delivered: \`docker compose up -d\` serves the calculator at \`http://localhost:3000\`.`

5. **Layout tree (lines 57-109)** — add the six new files:
   - Under `backend/` (after line 65 `├── go.mod …`): add `│   ├── Dockerfile                  # multi-stage static build → distroless static-debian13:nonroot` and `│   ├── .dockerignore               # excludes local artifacts from the build context`.
   - Under `frontend/` (after line 78 `├── package.json …`): add `│   ├── Dockerfile                  # node:24-alpine build → nginx:1.30-alpine`, `│   ├── .dockerignore               # excludes node_modules/dist/.env from the build context`, and `│   ├── nginx.conf                  # SPA fallback + /api/ → backend:8080 proxy`.
   - At repo root (after line 64 `├── .gitignore …`): add `├── docker-compose.yml             # backend (8080) + frontend (3000:80) services`.

6. **Architecture diagram (lines 18-43)** — update the frontend annotation (line 41) to note production parity:
   - From: `│   browser calls /api/evaluate → Vite dev proxy strips /api → :8080   │`
   - To: `│   browser calls /api/evaluate → dev: Vite proxy / prod: nginx strip /api → :8080 │`

7. **Prerequisites (lines 111-115)** — add a bullet for the Docker path:
   - Add: `- **Docker Engine + Compose v2** (\`docker compose version\` works) — required only for the Docker path; the Go/Node path above works without it.`

8. **New "Docker (full stack)" section** — insert after the "Full stack (both layers)" section (after line 171), before "The canonical `make check` gate":

```markdown
### Docker (full stack)

One command builds both images; one command runs the whole product (no Go/Node install needed):

\`\`\`sh
docker compose build    # build backend + frontend images
docker compose up -d    # start both containers
docker compose ps       # both should be running
\`\`\`

- Frontend: <http://localhost:3000> (nginx, container port 80).
- Backend: <http://localhost:8080> (Go, container port 8080).

Verify: open <http://localhost:3000>, press `1 2 × 4 =` → the display shows `48` after exactly one `POST /api/evaluate` (nginx strips `/api` and forwards `/evaluate`). The same path via curl:

\`\`\`sh
curl -sS -X POST http://localhost:3000/api/evaluate \
  -H 'Content-Type: application/json' \
  -d '{"operation":"multiply","a":12,"b":4}'
# → {"result":48}

curl -sS http://localhost:8080/health
# → {"status":"ok"}
\`\`\`

Stop and remove the stack with `docker compose down`. The backend reads `PORT` (a bare port number, default `8080`); the compose file sets `PORT=8080`. The API base is inlined into the frontend bundle at build time — after changing `VITE_API_BASE_URL`, rebuild with `docker compose build` (a restart alone does not change it). The frontend runtime uses `nginx:1.30-alpine` (current stable), a deliberate deviation from an earlier `1.27` plan for security patches.

The first proxied request immediately after `docker compose up -d` can briefly return `502 Bad Gateway` — `depends_on` only waits for container start, not for the backend to accept connections (there is no healthcheck, since the distroless image has no shell). Retry once; this is expected, not a defect.

Routing note: production nginx proxies only `location /api/` (trailing slash) and strips the `/api/` prefix before forwarding, whereas the Vite dev proxy matches the bare `/api` prefix and rewrites it away. The app itself only ever emits `/api/evaluate`, so the two behave identically in normal use — but a bare `GET /api` is served the SPA shell (`index.html`, `200`) in production, while the dev proxy forwards it to the backend.
```

Notes:

- The `PORT` default and the nginx 1.30 deviation must both be stated (AC-D1, OQ-6).
- Documentation only — do not restate or alter the API contract (AC-D2).
- Maps to AC-D1…D3, R-12.

---

## 4. Data, API & schema impact

- **REST contract: unchanged.** No endpoint, field, status code, or error string changes. The system-provided `api-contract` skill (single source of truth for the contract; not a file in this worktree) is not modified (AC-R1).
- **New backend env var:** `PORT` — a bare port number, default `8080` (unset/empty). Read only by `cmd/server/main.go`. Compose sets `PORT: "8080"`. `:8080` remains the effective default (IR-4).
- **New build arg (frontend):** `VITE_API_BASE_URL` — default `/api`, inlined into the JS bundle at build time; changing it requires a rebuild, not a restart (IR-1). Runtime has no env-driven config.
- **New config files:** `docker-compose.yml` (2 services; host ports `3000` and `8080`; no secrets, no volumes, no `.env`), `frontend/nginx.conf` (SPA fallback + `/api/` proxy).
- **New DNS contract:** the compose service name `backend` is consumed by `nginx.conf`'s `proxy_pass` (IR-2).
- **No migrations, no DB, no secrets, no host paths.** Nothing enters the images except the compiled binary (backend) and static assets + nginx config (frontend) (AC-S3, AC-S4).
- **Downstream consumers:** the browser (same-origin through nginx), and direct backend callers at `:8080`. Dev workflow (`npm run dev` + `go run ./cmd/server`) is unaffected (AC-R4, AC-R5).

---

## 5. Test strategy

There is **no new Go or TypeScript test code** in this feature: the only application change is the `PORT` read in `cmd/server/main.go`, which is "untested by design" (thin wiring; see `README.md:415`). Verification is therefore the PRD §9 QA command set plus `docker compose config`. All commands below run from the repo root.

| # | Command | Verifies |
|---|---------|----------|
| 1 | `git rev-parse --show-toplevel` (and `test -f .git` → worktree) | Worktree isolation |
| 2 | `docker compose config` | AC-M3 (compose is syntactically valid and resolves) |
| 3 | `docker compose build` | AC-G1, AC-B1..B5, AC-W1..W6, AC-S1/S2 |
| 4 | `docker compose up -d` && `docker compose ps` | AC-C4 |
| 5 | `curl -sS -o /dev/null -w '%{http_code} %{content_type}\n' http://localhost:3000/` | AC-E1, AC-N3 |
| 6 | `curl -sS -X POST http://localhost:3000/api/evaluate -H 'Content-Type: application/json' -d '{"operation":"multiply","a":12,"b":4}'` → `{"result":48}` | AC-E2, AC-N1, AC-N2, AC-N6 |
| 7 | `curl -sS http://localhost:8080/health` → `{"status":"ok"}` | AC-E5, AC-B6, AC-C7 (PORT honored) |
| 8 | `curl -sS -X POST http://localhost:8080/evaluate -H 'Content-Type: application/json' -d '{"operation":"multiply","a":12,"b":4}'` → `{"result":48}` | AC-E6, AC-B6 |
| 9 | `curl -sS -i -X POST http://localhost:3000/api/evaluate -H 'Content-Type: application/json' -d '{"operation":"divide","a":1,"b":0}'` → `HTTP/1.1 422` + `{"error":"division by zero"}` | AC-E7, AC-N5 |
| 10 | `curl -sS -o /dev/null -w '%{http_code}\n' http://localhost:3000/deep/link` → `200` | AC-E9, AC-N4 |
| 11 | `docker compose logs frontend \| grep 'POST /api/evaluate'` (single line) | AC-E4 (exactly one request) |
| 12 | `docker compose down` && `docker compose up -d` | AC-C5 |
| 13 | `make check` | AC-G2 (Docker-free, unchanged) |
| 14 | `git status --short` | AC-G4 (only intended files), AC-M4, AC-R2/R3 |
| 15 | `make help` | AC-D4 (new targets listed) |
| 16 | Manual browser: open `http://localhost:3000`, press `1 2 × 4 =` | AC-E3 (manual; OQ-4) |

Layer-cache / hygiene checks (documented, not gated):

- AC-B8: touch only `cmd/`/`internal/`, re-run `docker compose build backend` → `go mod download` layer is cached.
- AC-W8: touch only `src/`, re-run `docker compose build frontend` → `npm ci` layer is cached.
- AC-S5: `docker run --rm --entrypoint sh <backend-image> -c 'echo hi'` fails (no shell) — optional; AC-B6 is the primary static-binary proof.

**QA note — `PORT` validation.** `PORT` is intentionally unvalidated: `main.go` concatenates the value as a bare port number (default `8080`), so a malformed value such as `PORT=:8080` or `PORT=abc` fails at bind time (`ListenAndServe` returns an error and the process exits), not at parse time. During verification, QA must exercise only the compose-provided bare number `8080` (the default); do not set `PORT` to a colon-prefixed or non-numeric value.

### Traceability: PRD acceptance criteria → plan step / verification

| AC | Criterion | Satisfied by |
|----|-----------|--------------|
| AC-M1 | Six files at exact paths | Files 2-7; step 14 |
| AC-M2 | No `version:`; exactly `backend`+`frontend` | File 7; step 2 |
| AC-M3 | `docker compose config` exits 0 | step 2 |
| AC-M4 | No file deleted; only `main.go` app change | Files 1-9; step 14 |
| AC-B1 | Multi-stage; final `static-debian13:nonroot` | File 2 |
| AC-B2 | Builder `golang:1.26` (≥ go 1.22) | File 2 |
| AC-B3 | `CGO_ENABLED=0` static; no toolchain/source/shell | File 2; step 6/8 |
| AC-B4 | Non-root uid 65532; no `USER root` | File 2 (`:nonroot` variant) |
| AC-B5 | `EXPOSE 8080`; listens on 8080 | File 2; step 7 |
| AC-B6 | `docker run` serves health + evaluate | step 7/8 |
| AC-B7 | `.dockerignore` excludes artifacts; build succeeds | File 3; step 3 |
| AC-B8 | `cmd/`/`internal/` touch doesn't re-download modules | File 2 layering |
| AC-W1 | `node:24-alpine` → `nginx:1.30-alpine` | File 4 |
| AC-W2 | `npm ci` with devDependencies | File 4 |
| AC-W3 | `VITE_API_BASE_URL=/api` before build | File 4 |
| AC-W4 | `npm run build` = `tsc -b && vite build` | File 4; step 3 |
| AC-W5 | serves SPA from `/usr/share/nginx/html`; `EXPOSE 80` | File 4 |
| AC-W6 | nginx.conf → `default.conf`; no duplicate warning | File 4; step 3 |
| AC-W7 | `.dockerignore` excludes node_modules/dist/.vite/.env*; build succeeds | File 5; step 3 |
| AC-W8 | `src/` touch doesn't re-run `npm ci` | File 4 layering |
| AC-N1 | `/api/evaluate` → upstream `/evaluate` | File 6; step 6 |
| AC-N2 | trailing-slash `proxy_pass http://backend:8080/`; host = service name | File 6 |
| AC-N3 | `GET /` 200 html; assets not proxied | File 6; step 5 |
| AC-N4 | deep link 200 via `try_files` | File 6; step 10 |
| AC-N5 | 422/400 pass through unmodified | File 6; step 9 |
| AC-N6 | Content-Type + body + method forwarded untouched | File 6; step 6 |
| AC-N7 | No CORS headers, no rewriting | File 6 |
| AC-N8 | `/api/` never serves `index.html` | File 6 (longest-prefix) |
| AC-C1 | backend: `./backend`, `8080:8080`, `PORT=8080` | File 7 |
| AC-C2 | frontend: `./frontend`, arg `/api`, `3000:80`, `depends_on` | File 7 |
| AC-C3 | service names `backend`/`frontend`; nginx resolves `backend` | Files 6, 7 |
| AC-C4 | `up -d` + `ps` both running | step 4 |
| AC-C5 | `down` then `up -d` works | step 12 |
| AC-C6 | no `.env`/bind mounts/host network | File 7 |
| AC-C7 | `PORT` read as port number, default 8080, logs address | File 1 |
| AC-E1 | `GET :3000/` 200 html | step 5 |
| AC-E2 | `POST :3000/api/evaluate` → `{"result":48}` | step 6 |
| AC-E3 | browser `1 2 × 4 =` → `48` | step 16 (manual) |
| AC-E4 | exactly one `POST /api/evaluate` | step 11 |
| AC-E5 | `GET :8080/health` → `{"status":"ok"}` | step 7 |
| AC-E6 | `POST :8080/evaluate` → `{"result":48}` | step 8 |
| AC-E7 | divide-by-zero through nginx → 422 | step 9 |
| AC-E8 | QA report records commands/ports/outputs | QA-runner responsibility (out of code scope) |
| AC-E9 | deep link reload renders app | step 10 |
| AC-G1 | `docker compose build` exits 0 | step 3 |
| AC-G2 | `make check` unchanged, Docker-free | File 8; step 13 |
| AC-G3 | warm-cache rebuild succeeds | step 3 (repeat) |
| AC-G4 | no tracked files modified beyond intent | step 14 |
| AC-S1 | all `FROM` tags explicit; no `latest`/floating | Files 2, 4 |
| AC-S2 | exactly 4 base images, each tagged; distroless variant tag = recorded exception | Files 2, 4; OQ-2 |
| AC-S3 | no secrets/tokens/host paths in images | Files 2-7 |
| AC-S4 | `.dockerignore` blocks .git/node_modules/artifacts/.env* | Files 3, 5 |
| AC-S5 | backend runtime has no shell/package manager/compiler | File 2 (distroless) |
| AC-D1 | README Docker section + commands + ports + 12×4=48 + rebuild note | File 9 |
| AC-D2 | no "no Docker" claims remain | File 9 (edits 1-4) |
| AC-D3 | layout tree lists all six files | File 9 (edit 5) |
| AC-D4 | `make help` lists Docker targets | File 8; step 15 |
| AC-R1 | api-contract skill unmodified | §4 (system-provided skill; no worktree file to touch) |
| AC-R2 | `internal/calc` + `internal/httpapi` unmodified; only `PORT` in `main.go` | File 1; step 14 |
| AC-R3 | `frontend/src/**` + lockfiles unmodified | Files 4-6; step 14 |
| AC-R4 | dev workflow still works | §4 (no change to vite.config.ts) |
| AC-R5 | prod + dev proxy path-identical | Files 6 vs `vite.config.ts:14-22` |

---

## 6. Risks & edge cases

- **R-3 — trailing-slash mistakes (high).** The whole feature hinges on `location /api/` + `proxy_pass http://backend:8080/;`. Missing either trailing slash yields 404s or a double prefix. Mitigated by File 6 exact snippet and AC-N1/N2; the §9.4 failure-signature table is the triage aid.
- **R-4 — first proxied request 502 (accepted).** `depends_on` is start-order only; no healthcheck (distroless has no shell). QA retries once; documented as not-a-defect (OQ-5).
- **R-5 — empty `VITE_API_BASE_URL` (medium).** An empty build arg resolves to `/evaluate` (`api.ts:12`), which nginx serves as the SPA → transport error. Mitigated by the `ARG ...=/api` default in File 4 and the README rebuild note.
- **R-6 — SPA fallback masks `GET /api` and `GET /health` on :3000 (accepted).** Unknown paths return `index.html` with 200. Health is documented at `:8080` (OQ-3).
- **R-7 — nginx master runs as root (accepted).** Only the backend is required non-root (NG-10); documented as a hardening follow-up.
- **R-9 — host ports 3000/8080 in use (medium).** `up` fails if occupied. QA checks `lsof -i :3000 -i :8080` first.
- **R-10 — host `node_modules` poisoning the Linux build (high if `.dockerignore` forgotten).** Mitigated by File 5's `node_modules` exclusion.
- **R-11 — lockfile drift breaks `npm ci` (low).** `package-lock.json` is committed and unchanged; `npm ci` is the canary.
- **R-14 — build requires network (low/high for offline).** Base pulls + `go mod download` + `npm ci` need network on first build; warm cache satisfies repeat builds (AC-G3).
- **IR-1 — API base baked at build time.** Rebuild (not restart) required to change `VITE_API_BASE_URL`.
- **IR-2 — `backend` service name is a DNS contract.** Renaming the service breaks nginx at runtime with no build error.
- **IR-4 — `PORT` default must stay 8080.** A different default breaks the documented curl commands and the compose mapping.
- **IR-6 — `.dockerignore` silent exclusions.** Over-excluding `nginx.conf`, `package-lock.json`, `src/`, `go.mod`, or `go.sum` breaks the build at runtime/build with a confusing error. File 3/5 snippets are chosen so required sources are included.
- **Edge — `PORT` is not validated.** `PORT` is concatenated as a bare number; `PORT=:8080` yields `::8080` and fails to bind. Out of scope (see Open questions).
- **Edge — distroless `:nonroot` is a variant tag.** It can move within the debian13 minor (documented exception to strict pinning, OQ-2). Pin by digest later if byte-reproducibility is required.
- **Concurrency/scale.** No new limits, pools, or workers; nginx proxy timeouts (60s) exceed the backend's 10s write timeout; nginx's 1 MiB body cap far exceeds the backend's 1 KiB authoritative cap — all unchanged.

---

## 7. Rollout & rollback

No flags, no migrations, no secrets. This is purely additive packaging plus one app-code change (`PORT` support).

**Rollout (implementation order — minimizes churn; validate as you go):**

1. Confirm isolated worktree (`git rev-parse --show-toplevel` → `…/feat-docker-packaging`; `test -f .git` → worktree). See checklist below.
2. `backend/cmd/server/main.go` — add `PORT` support (File 1). Immediately run `cd backend && go build ./... && go vet ./... && gofmt -l .` (empty) to validate the only app-code change before anything else.
3. `backend/.dockerignore` (File 3) then `backend/Dockerfile` (File 2).
4. `frontend/.dockerignore` (File 5) then `frontend/nginx.conf` (File 6) then `frontend/Dockerfile` (File 4).
5. `docker-compose.yml` (File 7).
6. `Makefile` (File 8).
7. `README.md` (File 9).
8. End-to-end validation (Test strategy steps 2-16).

**Rollback.** Delete the six new files and revert the three edits (`main.go` `PORT` block, `Makefile` target additions, `README.md` edits). No other file is touched; `backend/go.mod`/`go.sum`/`internal/*` and all `frontend/src/**` remain valid. `make check` remains green before and after. No flag/migration/config rollback exists.

**Sequencing note.** Do not run `make check` until after the app-code change is validated with `go build`/`go vet`; `make check` also runs frontend gates, which are untouched but require `npm install` (network) the first time. Docker commands (`docker compose build/up/down`) are **gated through the owning specialists** — the coder should not run them unprompted (per `AGENTS.md`: ask before `git add/commit/push` and docker commands).

---

## 8. Open questions

None blocking — all six PRD open questions are resolved (§12) and baked in above. One non-blocking note for the human, raised only to confirm intent, **not to re-litigate**:

1. **`PORT` validation scope.** The plan interprets `PORT` as a bare port number with no validation (per OQ-1: "interpreted as a port number"). A malformed value (`PORT=:8080`, `PORT=abc`) is not rejected and will fail `ListenAndServe` at startup. If defensive validation is desired later, it is an additive `main.go` change, not part of this feature.

---

## Implementation checklist (ordered)

- [ ] 1. Confirm worktree: `git rev-parse --show-toplevel` prints `…/feat-docker-packaging`; `test -f .git && echo worktree`; `git status --short` clean.
- [ ] 2. Edit `backend/cmd/server/main.go` — add `port := os.Getenv("PORT")` block and `Addr: ":" + port` (File 1).
- [ ] 3. Validate app-code change: `cd backend && go build ./... && go vet ./... && gofmt -l .` (empty output).
- [ ] 4. Create `backend/.dockerignore` (File 3).
- [ ] 5. Create `backend/Dockerfile` (File 2).
- [ ] 6. Create `frontend/.dockerignore` (File 5).
- [ ] 7. Create `frontend/nginx.conf` (File 6).
- [ ] 8. Create `frontend/Dockerfile` (File 4).
- [ ] 9. Create `docker-compose.yml` (File 7).
- [ ] 10. Edit `Makefile` — `.PHONY` line, `help` entries, the four Docker targets (`docker-build`/`docker-up`/`docker-down`/`docker-e2e`) (File 8).
- [ ] 11. Edit `README.md` — 4 claim fixes, layout tree, diagram note, prerequisites, Docker section (File 9).
- [ ] 12. Validate compose syntax: `docker compose config` (AC-M3).
- [ ] 13. Build: `docker compose build` (AC-G1, AC-B*, AC-W*, AC-S1/S2).
- [ ] 14. Run: `docker compose up -d` && `docker compose ps` (AC-C4).
- [ ] 15. Probe: steps 5-11 of Test strategy (AC-E1/E2/E4/E5/E6/E7/E9, AC-N*).
- [ ] 16. Manual browser check `1 2 × 4 =` → `48` (AC-E3).
- [ ] 17. Teardown/restart: `docker compose down` && `docker compose up -d` (AC-C5).
- [ ] 18. `make check` (AC-G2) and `make help` (AC-D4).
- [ ] 19. `git status --short` — only the six new files + three modified files (AC-G4, AC-M4, AC-R2/R3).

### Gate → plan steps → verifying command

| Stated gate | Plan step | Verifying command |
|-------------|-----------|-------------------|
| `docker compose build` succeeds | 13 | `docker compose build` → exit 0, both images listed by `docker images` |
| `make check` passes, Docker-free | 18 | `make check` → exit 0 (no docker target invoked) |
| `12 × 4 = 48` end-to-end through the browser path | 14-16 | `curl -sS -X POST http://localhost:3000/api/evaluate -H 'Content-Type: application/json' -d '{"operation":"multiply","a":12,"b":4}'` → `{"result":48}`; manual browser check; `docker compose logs frontend \| grep 'POST /api/evaluate'` |
| Exact command and ports reported | 13-15 | QA report records `docker compose build`/`up -d`, ports `3000:80` and `8080:8080` |
