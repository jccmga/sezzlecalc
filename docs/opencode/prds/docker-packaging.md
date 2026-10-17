# PRD: Docker Packaging for the Full Stack

- **Status:** Approved for planning — all open questions resolved (see §12)
- **Owner:** Platform / TPM
- **Source of truth (contract):** `.opencode/skills/api-contract/SKILL.md` — not modified by this feature
- **Frozen for this feature:** `backend/internal/calc`, `backend/internal/httpapi`, the frontend `src/` tree, `frontend/vite.config.ts`
- **Depends on:** the delivered backend (`POST /evaluate`, `GET /health` on `:8080`) and the delivered React/Vite calculator
- **Repo:** `sezzlecalc` (Go backend + React/Vite/TS frontend)
- **Scope level:** Packaging only — 2 Dockerfiles, 2 `.dockerignore` files, 1 nginx config, 1 compose file, plus Makefile/README updates needed to satisfy the QA gates. No API, domain, or UI behavior changes.

---

## 1. Overview

The application is functionally complete but cannot be run as a unit. Today a developer must start
the Go process (`cd backend && go run ./cmd/server`) and the Vite dev server (`cd frontend && npm run dev`)
in two terminals; there is no production artifact for either layer and no single command that serves
the browser experience.

This feature packages both layers:

- The **Go backend** becomes a small, static, non-root container listening on `:8080`, exposing the
  plain paths `/evaluate` and `/health`.
- The **React SPA** becomes a static bundle served by nginx on container port `80`, with nginx also
  acting as the API gateway: `/api/*` is proxied to `http://backend:8080/*` with the `/api` prefix
  stripped.
- A root `docker-compose.yml` publishes the frontend on host `3000` and the backend on host `8080`,
  so the entire product is reachable at `http://localhost:3000`.

The defining property: **the browser still talks to `/api/evaluate`, exactly as it does through the
Vite dev proxy, and the backend still receives `/evaluate`.** Production and development must remain
path-identical from the frontend's point of view, so no application code changes.

### 1.1 Success statement

From a clean checkout, `docker compose build` succeeds. `docker compose up -d` then makes
`http://localhost:3000` render the calculator; pressing `1 2 × 4 =` displays `48` after exactly one
browser request to `POST /api/evaluate`, which nginx forwards to the backend as `POST /evaluate` and
which returns `200 {"result":48}`. `GET http://localhost:8080/health` returns `200 {"status":"ok"}`.
`make check` still passes without Docker.

---

## 2. Grounded current state

Verified in this worktree (no assumptions):

| Area | Fact | Location |
|------|------|----------|
| Backend entrypoint | `Addr: ":8080"` **hardcoded** today, no env read; `slog` to stderr; timeouts 5s/10s/10s/60s. This feature adds `PORT` support (default `8080`) — the only app-code change (OQ-1) | `backend/cmd/server/main.go:20` |
| Backend routes | Plain paths `/evaluate` and `/health` via `http.NewServeMux`; no `/api` prefix on the server | `backend/internal/httpapi/httpapi.go:44-46` |
| Go version | Module declares `go 1.22`, no `toolchain` directive | `backend/go.mod:3` |
| Go deps | `testify` (test-only) + indirect `go.yaml.in/yaml/v3`; `go.sum` present | `backend/go.mod:5-7`, `backend/go.sum` |
| Frontend scripts | `build` = `tsc -b && vite build`; `test` = `vitest run`; `lint` = `eslint .` | `frontend/package.json:6-12` |
| Node expectation | `@types/node@^24` — Node 24 is the matching runtime | `frontend/package.json:27` |
| Lockfile | `frontend/package-lock.json` exists → `npm ci` is viable | — |
| API base | `API_BASE_URL` = `VITE_API_BASE_URL`, default `/api`, trailing slashes stripped; endpoint = `${base}/evaluate` | `frontend/src/lib/api.ts:12-17` |
| Env typing | `VITE_API_BASE_URL?: string` is declared | `frontend/src/vite-env.d.ts:3-5` |
| Dev proxy | `/api` → `http://localhost:8080` **with** `rewrite` stripping `/api` | `frontend/vite.config.ts:14-22` |
| SPA root | `index.html` with `<div id="root">` and a module script `/src/main.tsx` | `frontend/index.html:9-10` |
| E2E key path | Keys `1`, `2`, `×` (`multiply`), `4`, `=`; `=` posts `{operation, a, b}` | `frontend/src/components/Calculator.tsx:128-139, 41-48` |
| Gate | `check: backend-build backend-test backend-vet frontend-test frontend-lint frontend-build` (no Docker) | `Makefile:15` |
| Ignore rules | `frontend/dist/`, `frontend/.vite/`, `frontend/*.tsbuildinfo`, `backend/coverage.txt` already git-ignored | `.gitignore:20, 113-116` |
| Docker assets | **None exist** — no `Dockerfile*`, `.dockerignore`, or compose file anywhere in the repo | verified by glob |
| Docs claim | README says Docker is "not yet present (no compose file)" in 4 places | `README.md:12, 14, 182, 407` |

---

## 3. Goals and non-goals

### 3.1 Goals

| # | Goal |
|---|------|
| G-1 | One command builds both images reproducibly: `docker compose build`. |
| G-2 | One command runs the full product: `docker compose up -d`, frontend at `http://localhost:3000`, backend at `http://localhost:8080`. |
| G-3 | Preserve the existing wire contract exactly: browser → `/api/evaluate` → nginx → backend `/evaluate`. No CORS, no client code change. |
| G-4 | Production-grade backend image: multi-stage build, fully static `CGO_ENABLED=0` binary, distroless runtime, non-root user, `EXPOSE 8080`. |
| G-5 | Reproducible frontend image: `npm ci` from the committed lockfile, Vite build with `VITE_API_BASE_URL=/api` inlined, nginx runtime with SPA fallback + API proxy. |
| G-6 | Every third-party base image pinned to an explicit, non-`latest` version (minor level where the upstream tag scheme allows). |
| G-7 | `make check` remains green and remains Docker-free. |
| G-8 | Documentation matches reality: no README statement may still claim Docker is absent. |

### 3.2 Non-goals

| ID | Out of scope | Note |
|----|--------------|------|
| NG-1 | Any change to `/evaluate` or `/health` semantics, request/response shapes, or error taxonomy | `api-contract` is frozen; both layers are already verified |
| NG-2 | Changes to `internal/calc`, `internal/httpapi`, or the frontend `src/` tree | Packaging must not require app changes (see OQ-1 for the one possible exception) |
| NG-3 | CORS middleware | Same-origin through nginx; the backend intentionally has none |
| NG-4 | Registry publishing, image tagging strategy, multi-arch (`--platform`) builds | Local build/run only |
| NG-5 | TLS/HTTPS, reverse-proxy hardening, WAF, rate limiting | Repo-wide out of scope |
| NG-6 | Kubernetes manifests, Helm, swarm, compose profiles/overlays | Not requested |
| NG-7 | CI/CD integration, image vulnerability scanning, SBOM, image signing | Repo-wide out of scope |
| NG-8 | Container healthchecks / readiness gating | Distroless has no shell/curl; see R-4 and OQ-5 |
| NG-9 | Log aggregation, metrics, tracing, structured request logs | Repo-wide out of scope |
| NG-10 | Non-root nginx worker/master redesign | Requirement is scoped to the backend image (see R-7) |
| NG-11 | Adding a browser automation harness (Playwright/Cypress) | Repo has Vitest/jsdom only; see OQ-4 |
| NG-12 | Expression parser, persistence, auth, i18n | Repo-wide out of scope |

---

## 4. API contract summary (as seen through the proxy)

Unchanged by this feature; restated so the proxy behavior can be checked against it.

### 4.1 Endpoints

| Method | Backend path | Public path through nginx | Success |
|--------|--------------|---------------------------|---------|
| `POST` | `/evaluate` | `/api/evaluate` | `200 {"result": <number>}` |
| `GET` | `/health` | *(not proxied — OQ-3 resolved)* | `200 {"status":"ok"}` |

The backend serves **plain paths**. Only two layers ever add `/api`: the Vite dev proxy
(`frontend/vite.config.ts:14-22`) and nginx (`frontend/nginx.conf`). These two must stay
behaviorally identical, or dev and production diverge.

### 4.2 Request

```json
{ "operation": "multiply", "a": 12, "b": 4 }
```

- `operation`: one of `add`, `subtract`, `multiply`, `divide`, `power` (binary) or `sqrt`, `percent` (unary).
- `a`: required for every operation. `b`: required for binary ops; must be omitted/`null` for unary ops.
- `Content-Type: application/json` is required by the backend (`400 invalid input` otherwise). nginx
  must forward the header untouched.

### 4.3 Responses and error taxonomy (client-safe, closed vocabulary)

| Status | Body | Trigger |
|--------|------|---------|
| `200` | `{"result":48}` | successful evaluation |
| `200` | `{"status":"ok"}` | `GET /health` |
| `400` | `{"error":"invalid input"}` | bad JSON, missing/null/wrong-type operand, non-JSON content type, body > 1 KiB, non-finite input |
| `405` | `{"error":"method not allowed"}` | wrong method on either route |
| `422` | `{"error":"division by zero"}` | `divide` with `b == 0` (incl. `-0.0`) |
| `422` | `{"error":"square root of negative number"}` | `sqrt` of a negative |
| `422` | `{"error":"invalid operation"}` | unknown/empty operation |
| `422` | `{"error":"non-finite result"}` | result overflows to `±Inf`/`NaN` |
| `500` | `{"error":"internal error"}` | panic recovery |

Contract constraints that the proxy must preserve: status code verbatim, JSON body verbatim, method,
and `Content-Type`. The frontend's `api.ts` treats a non-JSON body (including the backend's stdlib
`404 page not found` text) as `Could not reach the server`, so an incorrectly stripped prefix shows up
as a transport error rather than a wrong number — a useful failure signature for QA.

---

## 5. Architecture and user flows

### 5.1 Target topology

```
host :3000                                 host :8080
   │                                            │
   ▼                                            ▼
┌──────────────────────────┐            ┌────────────────────────────┐
│ frontend (nginx:1.30-    │            │ backend (distroless/static-│
│ alpine), container :80   │            │ debian13:nonroot), :8080   │
│                          │            │                            │
│ /            → SPA       │            │ /evaluate  POST            │
│   try_files → index.html │  compose   │ /health    GET             │
│ /api/        → proxy ────┼──network──▶│                            │
│   proxy_pass http://     │  "backend" │ binary /server (static,    │
│   backend:8080/          │            │ CGO_ENABLED=0, uid 65532)  │
└──────────────────────────┘            └────────────────────────────┘
   ▲ built from node:24-alpine (Vite build, VITE_API_BASE_URL=/api)
```

### 5.2 Flow F-1 — Primary browser evaluation (the QA scenario)

1. User opens `http://localhost:3000/` (host port `3000` → container port `80`).
2. nginx `location /` runs `try_files $uri $uri/ /index.html` and returns the built `index.html`.
3. The hashed JS/CSS assets are served from `/usr/share/nginx/html`; no proxy involvement.
4. User presses `1`, `2`, `×`, `4`, `=`. The reducer stores `lhs=12`, `operator=multiply`, `entry="4"`.
5. `pressEquals` posts to `EVALUATE_URL` = `/api/evaluate` on origin `http://localhost:3000`
   (same-origin, so no CORS preflight; `Content-Type: application/json` makes it non-simple, but
   same-origin requests are never preflighted).
6. nginx selects the longest matching prefix `location /api/` and, because `proxy_pass` carries a
   URI (`http://backend:8080/`), replaces the matched `/api/` with `/`, forwarding `POST /evaluate`.
7. The Go handler validates, calls `calc.Evaluate("multiply", 12, 4)`, and returns
   `200 {"result":48}` with `Content-Type: application/json`.
8. nginx relays status, headers, and body unchanged.
9. `api.ts` parses `result` (finite number) → `{ok:true, value:48}`; `formatNumber(48)` renders `48`.
10. Exactly **one** request is issued for the evaluation (the UI is `busy` until it resolves).

### 5.3 Flow F-2 — Deep link / refresh (SPA fallback)

`GET http://localhost:3000/anything` → no file exists → `try_files` falls back to `/index.html` →
`200 text/html`, app boots. This must not shadow `/api/` (longest-prefix match wins).

### 5.4 Flow F-3 — Error path through the proxy

`12 ÷ 0 =` → `POST /api/evaluate {"operation":"divide","a":12,"b":0}` → upstream `422
{"error":"division by zero"}` → nginx relays it → the display renders that string verbatim. Proves
status and body pass through unmodified (no nginx `error_page` interception, no body rewriting).

### 5.5 Flow F-4 — Direct backend access

`GET http://localhost:8080/health` → `200 {"status":"ok"}`; `POST http://localhost:8080/evaluate`
with the same body → `200 {"result":48}`. This is the backend's plain-path surface, published for
debugging and QA; it is not the browser path.

### 5.6 Flow F-5 — Build

`docker compose build` → backend context `./backend` → builder `golang:1.26` runs
`go mod download` + `go build ./cmd/server` with `CGO_ENABLED=0` → runtime stage copies only the
binary onto `gcr.io/distroless/static-debian13:nonroot`. Frontend context `./frontend` →
`node:24-alpine` runs `npm ci` + `npm run build` (`tsc -b && vite build`) with
`VITE_API_BASE_URL=/api` inlined → runtime stage copies `dist/` and `nginx.conf` onto
`nginx:1.30-alpine`.

---

## 6. File-by-file deliverables

All paths are relative to the repo root (= the worktree root). Build contexts are per-service, so
**each context needs its own `.dockerignore`** — a root-level one would not apply.

### 6.1 `backend/Dockerfile` (new)

| Requirement | Detail |
|-------------|--------|
| Multi-stage | At least `build` (compiler) and a minimal runtime stage; no toolchain in the final image |
| Builder image | `golang:1.26` (or a variant of the same minor, e.g. `golang:1.26-bookworm`). Builder Go ≥ `go 1.22` from `backend/go.mod:3` |
| Build config | `CGO_ENABLED=0`, `GOOS=linux`, build target `./cmd/server`, static binary written outside the source tree (e.g. `/out/server`) |
| Layer caching | `COPY go.mod go.sum ./` + `go mod download` **before** `COPY . .` |
| Recommended flags | `-trimpath -ldflags="-s -w"` (size/determinism; not a gate) |
| Runtime image | `gcr.io/distroless/static-debian13:nonroot` — Debian 13 static base, `:nonroot` variant. The variant tag is pinned at the `debian13` minor level and never `latest` (documented pin exception — OQ-2) |
| Process | Exec-form `ENTRYPOINT ["/server"]` (no shell exists in the runtime image; shell-form would fail) |
| Port | `EXPOSE 8080` (`8080/tcp`) |
| User | Runs as the distroless non-root user (uid `65532`); no `USER root`, no writable paths required |
| Env | `PORT` — optional, interpreted as a port number, default `8080` (read by `cmd/server/main.go` per OQ-1). No other environment variables |
| Files copied to runtime | Only the binary. No source, no `go.mod`, no coverage files |

Expected shape (illustrative, not literal code to copy verbatim):

```
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

### 6.2 `backend/.dockerignore` (new)

Build context is `./backend`. Must exclude at minimum:

| Pattern | Why |
|---------|-----|
| `.git`, `.gitignore` | Not a repo context; bloats context |
| `coverage.txt`, `*.out`, `*.test` | Local artifacts (already git-ignored at `.gitignore:20`); `.out`/`*.test` must not shadow needed files — verify after adding |
| `Dockerfile`, `.dockerignore`, `README*` | Not needed in the image |
| `.DS_Store`, `**/.DS_Store` | macOS noise |

Must **not** exclude `go.mod`, `go.sum`, `cmd/`, or `internal/` — the build needs them. Verify by
inspecting the build context (`docker build` must succeed after the file is added).

### 6.3 `frontend/Dockerfile` (new)

| Requirement | Detail |
|-------------|--------|
| Multi-stage | `build` (Node) + runtime (nginx) |
| Builder image | `node:24-alpine` (matches `@types/node@^24` at `frontend/package.json:27`) |
| Install | `npm ci` from `package-lock.json` **including devDependencies** — `npm run build` runs `tsc -b`, and TypeScript/Vite are devDependencies. Do **not** pass `--omit=dev`/`NODE_ENV=production` for install |
| Layer caching | `COPY package.json package-lock.json ./` + `npm ci` before `COPY . .` |
| Build-time env | `ARG VITE_API_BASE_URL=/api` **and** `ENV VITE_API_BASE_URL=$VITE_API_BASE_URL` **before** `RUN npm run build` — Vite inlines only variables present in the process env at build time |
| Build command | `npm run build` (must equal `tsc -b && vite build`; do not bypass the type check) |
| Runtime image | `nginx:1.30-alpine` (current stable mainline; `1.30.6` current at decision time). Deliberate security deviation from the originally requested `1.27`, which is a superseded branch — OQ-6 |
| Static assets | Copy build output (`/app/dist`) to `/usr/share/nginx/html` |
| nginx config | Copy `nginx.conf` over `/etc/nginx/conf.d/default.conf` (replaces the stock server block; keeps `/etc/nginx/nginx.conf` intact) |
| Port | `EXPOSE 80` |
| No runtime env | API base is baked at build; no env-driven config at runtime (see IR-1) |

Expected shape (illustrative):

```
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

### 6.4 `frontend/.dockerignore` (new)

Build context is `./frontend`. Must exclude at minimum:

| Pattern | Why |
|---------|-----|
| `node_modules` | Host-arch binaries (esbuild/rollup) would poison the Linux container build; also huge |
| `dist` | Stale build output (`.gitignore:114`) |
| `.vite`, `*.tsbuildinfo` | Stale incremental state (`.gitignore:115-116`) |
| `.git`, `.gitignore` | Noise |
| `npm-debug.log*`, `.DS_Store` | Noise |
| `.env`, `.env.*` | No `.env` is committed and secrets must never enter an image |

Must **not** exclude `package-lock.json`, `nginx.conf`, `tsconfig*.json`, `index.html`, or `src/`.
`nginx.conf` is copied from the build context into the runtime stage, so excluding it breaks the build.

### 6.5 `frontend/nginx.conf` (new)

A single `server` block copied to `/etc/nginx/conf.d/default.conf`.

| ID | Requirement |
|----|-------------|
| N-1 | `listen 80;` and `root /usr/share/nginx/html;` `index index.html;` |
| N-2 | `location /api/ { proxy_pass http://backend:8080/; }` — **trailing slash on both sides is mandatory**. The `backend` hostname must equal the compose service name |
| N-3 | `location / { try_files $uri $uri/ /index.html; }` — SPA fallback for deep links/refresh |
| N-4 | `/api/` must not fall through to the SPA. Longest-prefix matching guarantees the `/api/` block wins over `/`; do not add a regex location that could reorder this |
| N-5 | Proxy headers: set `Host`, `X-Real-IP`, `X-Forwarded-For`, `X-Forwarded-Proto` (and `proxy_http_version 1.1`) so upstream sees a sane request. No `proxy_redirect` rewriting needed |
| N-6 | No response transformation: no `proxy_set_header Accept-Encoding ""` + gzip off tricks, no `error_page` remapping. Status codes and JSON bodies must reach the browser unchanged |
| N-7 | No CORS headers. The browser origin is the same origin (`:3000`), so none are needed and adding them would contradict the backend's "no CORS" design |
| N-8 | Do not proxy `/` or static assets to the backend |
| N-9 | Default nginx body-size cap (1 MiB) is fine; the backend's 1 KiB cap stays authoritative |
| N-10 | `location = /health` is **not** added — health is documented at `http://localhost:8080/health` (OQ-3, resolved: option (a)) |

Behavior table that the config must produce:

| Browser request | Upstream request | Expected result |
|-----------------|------------------|-----------------|
| `POST /api/evaluate` | `POST /evaluate` | `200 {"result":48}` |
| `POST /api/evaluate/` (trailing slash) | `POST /evaluate/` | backend stdlib `404` text (documented, not an error) |
| `POST /api/evaluate` with body > 1 KiB | same | `400 {"error":"invalid input"}` |
| `GET /api` (no trailing slash) | *(not proxied)* | SPA `index.html` 200 (see R-6) |
| `GET /` and `GET /deep/link` | none | `200 text/html` (`index.html`) |
| `GET /assets/<hashed>.js` | none | `200` static asset |

Expected shape (illustrative):

```
server {
    listen 80;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;

    location /api/ {
        proxy_pass http://backend:8080/;
        proxy_http_version 1.1;
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

### 6.6 `docker-compose.yml` (new, repo root)

| Requirement | Detail |
|-------------|--------|
| Schema | Compose Specification. **No `version:` key** (obsolete; emits a warning) |
| `backend` service | `build: { context: ./backend }`; `ports: ["8080:8080"]`; `environment: PORT: "8080"` (honored by `cmd/server/main.go` per OQ-1); no volumes, no command override |
| `frontend` service | `build: { context: ./frontend, args: { VITE_API_BASE_URL: /api } }`; `ports: ["3000:80"]`; `depends_on: [backend]` |
| DNS | Service names must be exactly `backend` and `frontend`; nginx resolves `backend` on the compose network |
| Networking | Default compose bridge network; no `network_mode: host` |
| Images | Local builds only; an optional `image:` name is allowed but no registry push |
| Secrets | None. No `.env` required for `docker compose build` or `up` |
| Restart policy | Not required; if added, keep it out of the acceptance criteria |
| Expected published ports | frontend `3000` (host) → `80` (container); backend `8080` (host) → `8080` (container) |

Expected shape (illustrative):

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

### 6.7 `Makefile` (update)

| Requirement | Detail |
|-------------|--------|
| New targets | `docker-build` (`docker compose build`), `docker-up` (`docker compose up -d`), `docker-down` (`docker compose down`), optionally `docker-e2e` (the curl-through-nginx probe in §9) |
| `.PHONY` | Every new target added to the `.PHONY` line (`Makefile:1`) |
| `help` | Every new target listed with a one-line description |
| `check` | **Unchanged** — `check` must not require Docker (`Makefile:15`). Adding `docker-build` to `check` would fail on machines without a daemon and would break gate AC-G2 |
| Existing targets | No behavior changes to `backend-*` / `frontend-*` |

### 6.8 `README.md` (update)

| Requirement | Detail |
|-------------|--------|
| Current state table | Change the "Docker packaging" row from ⏳/not present to ✅ built, with the compose command (`README.md:12`) |
| Stale claims | Remove/replace "no compose file" statements at `README.md:14`, `:182`, `:407` |
| New section | "Docker (full stack)": prerequisites (Docker Engine + Compose v2), `docker compose build`, `docker compose up -d`, ports `3000`/`8080`, the `12 × 4 = 48` verification, `docker compose down`, and the rebuild requirement after changing `VITE_API_BASE_URL` |
| Repository layout tree | Add `backend/Dockerfile`, `backend/.dockerignore`, `frontend/Dockerfile`, `frontend/.dockerignore`, `frontend/nginx.conf`, `docker-compose.yml` (`README.md:57-109`) |
| Architecture diagram | Note that production proxies `/api/*` in nginx (mirroring the Vite dev proxy) |
| Prerequisites section | Add Docker/Compose; keep Go/Node instructions for the non-Docker path (`README.md:111-115`) |
| Scope | Documentation only — do not restate or alter the API contract |

### 6.9 Files that must remain unchanged

`backend/cmd/server/main.go` changes **solely** to add `PORT` support (interpreted as a port number,
default `8080`, `Addr` construction otherwise identical — OQ-1). Everything else in this list must
remain unchanged: `backend/go.mod`, `backend/go.sum`, `backend/internal/calc/*`,
`backend/internal/httpapi/*`, `frontend/package.json`, `frontend/package-lock.json`,
`frontend/vite.config.ts`, `frontend/src/**`, `.opencode/skills/api-contract/SKILL.md`.

---

## 7. Performance and operational boundaries

| Boundary | Expectation | Gate? |
|----------|-------------|-------|
| `docker compose build` (cold, with network) | Completes successfully; no target duration. Expect minutes on first pull | Yes (success only) |
| `docker compose build` (warm cache) | Source-only changes rebuild quickly; dependency layers stay cached | No |
| Backend image size | Distroless `static-debian13` base + one binary; roughly an order of magnitude smaller than a full Go image | No (soft) |
| Frontend image size | nginx-alpine + static assets | No (soft) |
| Container start → serving | Backend `/health` answers within ~1 s of container start; nginx serves `index.html` immediately | No |
| First proxied request after `up -d` | May briefly return `502` if the backend is not yet accepting connections (`depends_on` is start-order only — R-4). Retry once; this is not a defect | No (QA must retry, not fail) |
| Steady-state request latency (local) | Proxied `/api/evaluate` adds negligible overhead over direct `:8080` | No |
| Client request timeout | `api.ts` aborts at 10 s (`REQUEST_TIMEOUT_MS`) | Existing behavior |
| Backend server timeouts | `ReadHeaderTimeout` 5 s, `ReadTimeout` 10 s, `WriteTimeout` 10 s, `IdleTimeout` 60 s | Existing, unchanged |
| nginx proxy timeouts | Defaults (60 s) are longer than the backend's write timeout; no override required | No |
| Body limits | nginx default 1 MiB ≫ backend 1 KiB cap; the backend remains authoritative | No |
| Concurrency | No new limits, pools, or workers introduced by this feature | No |
| Image reproducibility | Base tags pinned; `npm ci` + `go.sum` pin dependencies; no `latest`, no floating tags | Yes (AC-S1) |

---

## 8. Acceptance criteria

Stable IDs for traceability into the plan and QA. `AC-G*` map directly to the two stated gates.

### 8.1 Deliverables present (AC-M)

- **AC-M1** — `backend/Dockerfile`, `backend/.dockerignore`, `frontend/Dockerfile`, `frontend/.dockerignore`, `frontend/nginx.conf`, and root `docker-compose.yml` all exist at those exact paths.
- **AC-M2** — `docker-compose.yml` contains no `version:` key and defines exactly the services `backend` and `frontend`.
- **AC-M3** — `docker compose config` exits 0 from the repo root (file is syntactically valid and resolves).
- **AC-M4** — No pre-existing file is deleted; sources are unmodified except `cmd/server/main.go`'s `PORT` support (OQ-1).

### 8.2 Backend image (AC-B)

- **AC-B1** — `backend/Dockerfile` is multi-stage; the final stage is `gcr.io/distroless/static-debian13:nonroot`.
- **AC-B2** — The builder image is `golang:1.26` (or a variant of that minor); it satisfies the `go 1.22` directive in `backend/go.mod`.
- **AC-B3** — The binary is built with `CGO_ENABLED=0` for `./cmd/server`; the final image contains no Go toolchain, no source, and no shell.
- **AC-B4** — The container runs as the non-root distroless user of the `:nonroot` variant (uid `65532`; image config user is non-root, no `USER root`).
- **AC-B5** — `EXPOSE 8080` is declared, and the process listens on `8080` inside the container.
- **AC-B6** — Running the image alone (`docker run --rm -p 8080:8080 <backend-image>`) serves `GET /health` → `200 {"status":"ok"}` and `POST /evaluate` → `200 {"result":48}` for `{"operation":"multiply","a":12,"b":4}`. Success on a libc-less base is the static-binary proof.
- **AC-B7** — `backend/.dockerignore` excludes local artifacts (`coverage.txt`, `*.test`, `.git`, `Dockerfile`) while the build still succeeds, proving required sources are not excluded.
- **AC-B8** — Rebuilding after touching only `cmd/` or `internal/` does not re-run `go mod download` (dependency layer cached).

### 8.3 Frontend image (AC-W)

- **AC-W1** — `frontend/Dockerfile` is multi-stage: builder `node:24-alpine`, runtime `nginx:1.30-alpine`.
- **AC-W2** — Dependencies are installed with `npm ci` from `package-lock.json`, **with** devDependencies (the build must not skip TypeScript).
- **AC-W3** — `VITE_API_BASE_URL=/api` is provided as a build arg and exported to the environment before `npm run build`, so the emitted bundle targets `/api/evaluate`.
- **AC-W4** — The build runs the repo's own `npm run build` (`tsc -b && vite build`); a type error fails the image build.
- **AC-W5** — The runtime image serves the built SPA from `/usr/share/nginx/html` and declares `EXPOSE 80`.
- **AC-W6** — `nginx.conf` is installed as `/etc/nginx/conf.d/default.conf` and the stock default server block is replaced (no duplicate `default_server` warning).
- **AC-W7** — `frontend/.dockerignore` excludes `node_modules`, `dist`, `.vite`, `*.tsbuildinfo`, and `.env*`, while the build still succeeds (proving `nginx.conf`/`package-lock.json`/`src` are included).
- **AC-W8** — Rebuilding after touching only `src/` does not re-run `npm ci` (dependency layer cached).

### 8.4 nginx routing (AC-N)

- **AC-N1** — `POST /api/evaluate` on the frontend origin reaches upstream `POST /evaluate`; the `/api/` prefix is stripped exactly once (a `200 {"result":48}` proves it, since `/api/evaluate` upstream would 404).
- **AC-N2** — `proxy_pass` uses the trailing-slash form (`http://backend:8080/`) and the upstream host equals the compose service name `backend`.
- **AC-N3** — `GET /` returns `200 text/html` containing the built app shell; hashed assets under the build output directory return `200` and are not proxied.
- **AC-N4** — `GET /deep/link` returns `200 text/html` via `try_files ... /index.html` (SPA fallback).
- **AC-N5** — Upstream status codes and JSON bodies pass through unmodified: `divide` by zero through the proxy returns `422 {"error":"division by zero"}`, and an invalid body returns `400 {"error":"invalid input"}`.
- **AC-N6** — The backend receives the original `Content-Type: application/json` and request body (no header stripping, no method change).
- **AC-N7** — nginx adds no CORS headers and no response rewriting.
- **AC-N8** — `/api/` is never served `index.html` (SPA fallback does not shadow the proxy).

### 8.5 Compose (AC-C)

- **AC-C1** — `backend` service: build context `./backend`, host `8080` → container `8080`, `PORT=8080` in the environment.
- **AC-C2** — `frontend` service: build context `./frontend`, build arg `VITE_API_BASE_URL=/api`, host `3000` → container `80`, `depends_on: backend`.
- **AC-C3** — Service names are `backend` and `frontend` and the frontend image's nginx config resolves `backend`.
- **AC-C4** — `docker compose up -d` starts both containers without an error, and `docker compose ps` shows both running.
- **AC-C5** — `docker compose down` removes both containers and the default network; a subsequent `up -d` works again.
- **AC-C6** — The build and run require no `.env` file, no bind mounts, and no host-network mode.
- **AC-C7** — `cmd/server/main.go` reads `PORT` as a port number, defaults to `8080` when unset/empty, honors `PORT=8080`, keeps `Addr` construction otherwise identical, and logs the actual listen address at startup (OQ-1).

### 8.6 End-to-end behavior (AC-E)

- **AC-E1** — `GET http://localhost:3000/` returns `200` with `text/html` and the app boots in a browser.
- **AC-E2** — `POST http://localhost:3000/api/evaluate` with `{"operation":"multiply","a":12,"b":4}` returns `200` and body `{"result":48}`.
- **AC-E3** — In a browser at `http://localhost:3000`, pressing `1 2 × 4 =` displays `48` (the canonical QA scenario).
- **AC-E4** — That key sequence produces **exactly one** `POST /api/evaluate` request (verified in the nginx access log and/or browser devtools).
- **AC-E5** — `GET http://localhost:8080/health` returns `200 {"status":"ok"}`.
- **AC-E6** — `POST http://localhost:8080/evaluate` with the same body returns `200 {"result":48}` (direct backend parity).
- **AC-E7** — An error path works end-to-end through nginx: `{"operation":"divide","a":1,"b":0}` → `422 {"error":"division by zero"}`.
- **AC-E8** — The QA report records the exact commands run, the host/container port pairs, and the observed outputs (per the QA note).
- **AC-E9** — Reloading a deep link (`http://localhost:3000/deep/link`) still renders the app (no 404 page).

### 8.7 Gates (AC-G)

- **AC-G1** — **Gate 1:** `docker compose build` succeeds from the repo root on a clean checkout (exit code 0, both images built).
- **AC-G2** — **Gate 2:** `make check` still passes, unchanged, and does not invoke Docker (`backend-build`, `backend-test`, `backend-vet`, `frontend-test`, `frontend-lint`, `frontend-build`).
- **AC-G3** — `docker compose build` also succeeds on a warm cache after a no-op change (no flaky network dependency beyond the first pull).
- **AC-G4** — The build does not modify tracked files in the worktree (`git status --short` shows only the new/updated files intended by §6).

### 8.8 Pinning and hygiene (AC-S)

- **AC-S1** — Every `FROM` uses an explicit tag at minor level (or the documented distroless `:nonroot` variant tag); no `latest`, no untagged image, no `:stable`/`:main` floating alias.
- **AC-S2** — `golang:1.26` (or a `golang:1.26-*` variant), `node:24-alpine`, `nginx:1.30-alpine`, and `gcr.io/distroless/static-debian13:nonroot` are the only base images, each explicitly tagged; the distroless variant tag is the recorded exception to strict minor-level pinning (OQ-2).
- **AC-S3** — No secrets, tokens, or host paths appear in Dockerfiles, build args, compose, or the built images.
- **AC-S4** — `.dockerignore` files prevent `.git`, `node_modules`, coverage/build artifacts, and `.env*` from entering the images.
- **AC-S5** — The backend runtime image contains no shell, package manager, or compiler (distroless `static-debian13`).

### 8.9 Documentation (AC-D)

- **AC-D1** — README has a Docker section with the exact build/up/down commands, the ports (`3000`, `8080`), the `12 × 4 = 48` check, and the rebuild-on-API-base-change note.
- **AC-D2** — No README text still claims Docker packaging is absent (`README.md:12, 14, 182, 407` are corrected).
- **AC-D3** — README's repository-layout tree lists all six new files.
- **AC-D4** — `make help` lists every new Docker target.

### 8.10 No-drift / regression (AC-R)

- **AC-R1** — The `api-contract` skill is unmodified; no endpoint, field, status, or error string changed.
- **AC-R2** — `backend/internal/calc` and `backend/internal/httpapi` are unmodified; `cmd/server/main.go` changes solely to add `PORT` support (OQ-1).
- **AC-R3** — `frontend/src/**`, `frontend/package.json`, and `frontend/package-lock.json` are unmodified; no client code change is needed.
- **AC-R4** — The existing dev workflow still works: `npm run dev` + `go run ./cmd/server`, with `/api` proxied to `localhost:8080` (`frontend/vite.config.ts:14-22` untouched).
- **AC-R5** — The production and dev proxy behaviors are path-identical: browser `/api/evaluate` → backend `/evaluate` in both.

---

## 9. Verification plan (QA)

Prerequisites: Docker Engine with Compose v2 (`docker compose version` works). Nothing else — no local
Go/Node install is needed for the Docker path.

### 9.1 Exact commands

```sh
# From the repo root
docker compose build                      # Gate 1
docker compose up -d
docker compose ps

# Frontend (browser path) — host 3000 → container 80
curl -sS -o /dev/null -w 'GET / -> %{http_code} %{content_type}\n' http://localhost:3000/

# The QA scenario, through nginx, exactly as the browser does it
curl -sS -X POST http://localhost:3000/api/evaluate \
  -H 'Content-Type: application/json' \
  -d '{"operation":"multiply","a":12,"b":4}'
# expected: {"result":48}

# Backend direct — host 8080 → container 8080
curl -sS http://localhost:8080/health
# expected: {"status":"ok"}

curl -sS -X POST http://localhost:8080/evaluate \
  -H 'Content-Type: application/json' \
  -d '{"operation":"multiply","a":12,"b":4}'
# expected: {"result":48}

# Proxy transparency (status + body unchanged)
curl -sS -i -X POST http://localhost:3000/api/evaluate \
  -H 'Content-Type: application/json' \
  -d '{"operation":"divide","a":1,"b":0}'
# expected: HTTP/1.1 422 + {"error":"division by zero"}

# SPA fallback
curl -sS -o /dev/null -w 'deep link -> %{http_code}\n' http://localhost:3000/deep/link
# expected: 200

# Evidence for AC-E4 (one POST, path seen by nginx)
docker compose logs frontend | grep 'POST /api/evaluate'

# Gate 2 (does not require Docker)
make check

docker compose down
```

### 9.2 Browser check (AC-E3)

Open `http://localhost:3000`, press `1 2 × 4 =` (or type `12*4` then `Enter`), and confirm the
display shows `48`. With devtools open, the Network tab must show exactly one `POST
/api/evaluate` with payload `{"operation":"multiply","a":12,"b":4}` and response `{"result":48}`.
Because the repo has no browser-automation harness (Vitest/jsdom only), this step is manual; the
curl-through-nginx command above is the automatable equivalent for the same path (see OQ-4).

### 9.3 Ports

| Host port | Container port | Service | Reachable surface |
|-----------|----------------|---------|-------------------|
| `3000` | `80` | `frontend` (nginx) | `/`, static assets, `/api/*` → backend |
| `8080` | `8080` | `backend` (Go) | `/evaluate`, `/health` (plain paths) |

### 9.4 Failure signatures (useful during QA triage)

| Symptom | Likely cause |
|---------|--------------|
| Browser shows `Could not reach the server`; nginx log shows `POST /api/evaluate` but backend received nothing | `proxy_pass` missing the trailing slash or wrong upstream host |
| Backend returns stdlib `404 page not found` (text) | `/api/` prefix not stripped |
| `502 Bad Gateway` immediately after `up -d` | Backend not yet accepting connections (R-4) — retry |
| Empty page / 404 on `/` | `dist` not copied, or wrong `root` |
| Request goes to `/evaluate` (no `/api`) from the browser | `VITE_API_BASE_URL` build arg was empty (IR-1/R-5) |
| `npm ci` fails in the image build | Lockfile out of sync, or `node_modules` copied into the context instead of ignored |

---

## 10. Irreversible or breaking changes

| ID | Change | Why it matters | Reversible? |
|----|--------|----------------|-------------|
| IR-1 | `VITE_API_BASE_URL` is **inlined into the JS bundle at build time** | One image is permanently bound to one API base. Changing the base requires a rebuild, not a restart. Passing an empty build arg yields `/evaluate` (per the `api.ts:12` fallback semantics) and silently breaks the browser path | Yes, but only by rebuilding |
| IR-2 | The compose service name `backend` becomes a DNS contract consumed by `nginx.conf` | Renaming the service (or adding a network alias only) breaks the proxy at runtime with no build-time error | Yes, two-file change |
| IR-3 | Host port bindings `3000` and `8080` become the documented public surface | Changing them later breaks README, QA scripts, and any external habit. Also: if either port is occupied on the host, `up` fails | Yes, but it is a visible contract change |
| IR-4 | `PORT` support is added to `cmd/server/main.go` with default `8080` | The default must stay `8080`: a different default would break the documented curl commands and the compose mapping assumptions | Default change would be breaking |
| IR-5 | The backend runtime image has no shell and is non-root | Any future operational step needing `sh`, `curl`, `apk`, or a writable filesystem fails. Adding a shell later is a security regression | Yes, at a security cost |
| IR-6 | `.dockerignore` silently excludes files from the build context | A future file added under an ignored pattern will be missing in the image with a confusing build/runtime failure | Yes |
| IR-7 | `GET /api` (no trailing slash) is not proxied and returns the SPA shell with `200` | Any client that builds `/api` + path by string concatenation without a slash would get HTML instead of JSON | Yes (nginx config) |
| IR-8 | README's "no Docker" statements are removed | Documentation-only; no runtime impact | Yes |

**Explicitly not breaking:** the REST contract, the domain, the HTTP layer, the frontend source, the
dev workflow, and `make check`. Nothing in this feature changes observable API behavior.

---

## 11. Risks

| ID | Risk | Likelihood / Impact | Mitigation |
|----|------|---------------------|------------|
| R-1 | nginx `1.27` is an old mainline branch (superseded by 1.28/1.29+); keeping it would leave the image without security patches | Medium / Medium | **Resolved (OQ-6):** runtime is `nginx:1.30-alpine` (current stable; 1.30.6), a deliberate security deviation from the requested 1.27. Record the deviation in the README |
| R-2 | Distroless `static-debian13:nonroot` is a **variant** tag, not a version; it can move within the debian13 minor | Medium / Low | **Resolved (OQ-2):** the variant tag is the documented exception to strict minor-level pinning (never `latest`). Pin by digest only if strict byte-reproducibility is later required |
| R-3 | Trailing-slash mistakes in `location /api/` or `proxy_pass` produce 404s or double-prefix paths | High / High (it is the core of the feature) | AC-N1/AC-N2; QA failure signature table §9.4 |
| R-4 | `depends_on: backend` waits for container **start**, not readiness; the first proxied request can 502 | Medium / Low | **Resolved (OQ-5):** no container healthcheck (distroless has no shell/curl); QA and README document a one-time retry, and this is not a defect |
| R-5 | Empty `VITE_API_BASE_URL` build arg produces `/evaluate` (relative), which nginx serves as the SPA → transport error | Medium / Medium | Keep `/api` as the Dockerfile `ARG` default; document that the arg must not be empty; AC-W3/AC-E2 |
| R-6 | SPA fallback masks unknown routes, including `GET /api` and `GET /health` on port 3000, returning `200 text/html` | High / Low | **Resolved (OQ-3):** `/health` is deliberately not proxied; README documents `http://localhost:8080/health`. SPA fallback for unknown paths is accepted |
| R-7 | nginx master runs as root inside the container (only the backend is required to be non-root) | Certain / Low | Accepted for this feature; document as a hardening follow-up (NG-10) |
| R-8 | A pinned base tag is re-tagged or withdrawn upstream (`golang:1.26`, `node:24-alpine`, `nginx:1.30-alpine`, `static-debian13:nonroot`) | Low / High (blocks Gate 1) | All four tags verified to exist; if one disappears, bump to the nearest patch/minor and record the deviation |
| R-9 | Host ports 3000/8080 already in use | Medium / Medium | QA checks (`lsof -i :3000 -i :8080`), README notes the mapping |
| R-10 | Copying host `node_modules` into the frontend build context (missing `.dockerignore`) breaks the Linux build via host-arch esbuild/rollup binaries | High if `.dockerignore` is forgotten / High | AC-W7/AC-S4 |
| R-11 | `package-lock.json` drifts from `package.json`, making `npm ci` fail | Low / High | Lockfile is committed and unchanged; `npm ci` is the canary |
| R-12 | README drift: docs still claim Docker is absent after the feature lands | High if skipped / Low | AC-D2 |
| R-13 | Architecture mismatch: images build for the host arch; deploying to a different arch needs `--platform` | Low / Medium | Out of scope (NG-4); documented |
| R-14 | `docker compose build` requires network access (base pulls + module/npm registry); an offline evaluator cannot run Gate 1 | Low / High | Record prerequisite; warm cache can satisfy a repeat build |

---

## 12. Resolved decisions

All six open questions are closed; nothing blocks design. OQ IDs are kept stable for traceability.

| ID | Decision | Resolution |
|----|----------|------------|
| **OQ-1** | Add `PORT` support to the backend (option b) | `backend/cmd/server/main.go` reads `PORT` as a port number, defaulting to `8080`; this is the only application-code change. AC-C7 is unconditional. |
| **OQ-2** | Distroless runtime on Debian 13 with `:nonroot` (option b, with a user override of the base OS) | Runtime image is `gcr.io/distroless/static-debian13:nonroot`. The `:nonroot` variant is retained because running non-root is a hard requirement; the tag is pinned at the debian13 minor level and is the documented exception to strict minor-level pinning (never `latest`). |
| **OQ-3** | Do not proxy `/health` on `:3000` (option a) | nginx proxies `/api/` only; health is documented at `http://localhost:8080/health`. §6.5 N-10 stays "not added". |
| **OQ-4** | No browser automation (option a) | The automated equivalent of the browser path is `curl` through `http://localhost:3000/api/evaluate`; the browser check remains a documented manual QA step. No Playwright/Cypress. |
| **OQ-5** | No container healthcheck (option a) | `depends_on` is start-order only; the one-time 502 race is accepted, and QA/README document a single retry. |
| **OQ-6** | Current stable nginx instead of the requested 1.27 (option b) | Runtime image is `nginx:1.30-alpine` (stable; 1.30.6 current) — a deliberate security deviation from the requested 1.27, which is superseded. Record the deviation in the README. |

**Build prerequisites:** the `golang:1.26`, `node:24-alpine`, `nginx:1.30-alpine`, and
`gcr.io/distroless/static-debian13:nonroot` tags were verified to exist. Host ports `3000` and `8080`
should still be checked free during QA (R-9).

---

## 13. Traceability matrix

| Requirement area | Acceptance criteria |
|------------------|---------------------|
| Deliverables / compose schema | AC-M1 … AC-M4 |
| Backend image (multi-stage, static, non-root, `EXPOSE 8080`) | AC-B1 … AC-B8 |
| Frontend image (node 24 → nginx 1.30, baked `/api`) | AC-W1 … AC-W8 |
| nginx SPA fallback + `/api/` prefix stripping | AC-N1 … AC-N8 |
| Compose services, ports, `depends_on` | AC-C1 … AC-C7 |
| End-to-end `12 × 4 = 48` through the browser path | AC-E1 … AC-E9 |
| **Gate 1** `docker compose build` | AC-G1, AC-G3 |
| **Gate 2** `make check` unchanged and green | AC-G2, AC-G4 |
| Image pinning and build hygiene | AC-S1 … AC-S5 |
| Documentation | AC-D1 … AC-D4 |
| Contract / dev-workflow preservation | AC-R1 … AC-R5 |

| Stated gate | Criteria | Evidence |
|-------------|----------|----------|
| `docker compose build` succeeds | AC-G1 | Exit code 0, both images listed by `docker images` |
| `make check` passes | AC-G2 | Exit code 0; Docker not required |
| `12 × 4 = 48` end-to-end through the browser path | AC-E2, AC-E3, AC-E4 | `curl` through `:3000/api/evaluate` → `{"result":48}`; manual browser check; nginx access log |
| Exact command and ports reported | AC-E8 | QA report: `docker compose build` / `up -d`, ports `3000:80` and `8080:8080` |
