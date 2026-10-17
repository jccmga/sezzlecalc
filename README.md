# sezzlecalc

A full-stack calculator — a Go REST API consumed by a React/Vite/TypeScript frontend. The backend is a pure arithmetic domain (`internal/calc`) behind a thin HTTP layer (`internal/httpapi` + `cmd/server`); the frontend is a calculator UI that **validates and formats only** and delegates every computed value to the server.

## Current state

| Layer | Status |
|-------|--------|
| `backend/internal/calc` — pure, stateless arithmetic domain (all seven operations) | ✅ Built & verified (100% coverage) |
| `backend/internal/httpapi` + `cmd/server` — HTTP server, `POST /evaluate`, `GET /health` | ✅ Built & verified (97.9% coverage) |
| `frontend/` — React/Vite/TypeScript calculator UI | ✅ Built & verified (68 tests, lint clean) |
| Docker packaging for the full stack | ⏳ Later phase — **not yet present** (no compose file) |

The repository contains the Go backend, the React/Vite/TypeScript frontend, plus the agent harness and documentation. There is no `docker compose` configuration yet.

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                             sezzlecalc                               │
│                                                                      │
│  backend/  (Go module sezzlecalc/backend, :8080)                     │
│  ┌────────────────────────────────────────────────────────────┐      │
│  │  cmd/server/main.go   slog → httpapi.NewHandler → :8080    │      │
│  │  internal/httpapi     POST /evaluate · GET /health         │      │
│  │                       single error→status mapper           │      │
│  │  internal/calc        pure domain: Evaluate · Arity        │      │
│  └────────────────────────────────────────────────────────────┘      │
│                          ▲  plain paths (/evaluate, /health)         │
│                          │  no /api prefix, no CORS                  │
│                          │                                           │
│  frontend/  (Vite 7 + React 19 + TS)                                 │
│  ┌────────────────────────────────────────────────────────────┐      │
│  │  components/Calculator.tsx  key grid + keyboard wiring     │      │
│  │  components/Display.tsx     display panel                  │      │
│  │  lib/calculator-machine.ts  state machine                  │      │
│  │  lib/api.ts        never-throws evaluate() client          │      │
│  │  lib/validation.ts parseEntry + binary/unary metadata      │      │
│  │  lib/format.ts     formatNumber (12 significant digits)    │      │
│  └────────────────────────────────────────────────────────────┘      │
│   browser calls /api/evaluate → Vite dev proxy strips /api → :8080   │
└──────────────────────────────────────────────────────────────────────┘
```

The backend deliberately separates a **pure domain** (`internal/calc`) from a **thin HTTP layer** (`internal/httpapi`) and a **thin entrypoint** (`cmd/server/main.go`). The domain never touches `net/http`; the HTTP layer owns encoding, routing, method enforcement, the `Content-Type` gate, the 1 KiB body cap, arity-aware operand presence, panic recovery, and the single error→status mapper, delegating all arithmetic to `calc.Evaluate` (and arity to `calc.Arity`).

The frontend is a **dumb-but-exact** state machine: it never performs arithmetic. Every computed display value originates from a `200 {"result": <number>}` response. The four pure modules under `src/lib/` (`api`, `validation`, `format`, `calculator-machine`) hold every "smart" decision, and the dev proxy keeps the backend CORS-free.

## Tech stack

- **Backend:** Go (module `sezzlecalc/backend`, minimum `go 1.22`), stdlib-only in production code. The single third-party dependency is `github.com/stretchr/testify` (test-only, plus its indirect `go.yaml.in/yaml/v3`).
- **Frontend:** Vite 7 + React 19 + TypeScript (strict) + Tailwind v4 + shadcn/ui (`Button`). Testing: Vitest 3 + React Testing Library + `@testing-library/user-event` + `@testing-library/jest-dom`.
- **Testing:** Go's standard `testing` package (table-driven, `-race`, `httptest`) for the backend; Vitest (jsdom) for the frontend.

## Repository layout

```
sezzlecalc/
├── AGENTS.md                       # repository guide for agents
├── Makefile                        # canonical build/test entry points
├── PROMPTS.md                      # curated AI-prompt trail
├── README.md
├── opencode.json
├── .gitignore                      # ignores backend/coverage.txt, frontend/dist, node_modules
├── backend/
│   ├── go.mod                      # module sezzlecalc/backend; go 1.22; testify (test-only)
│   ├── go.sum
│   ├── coverage.txt                # git-ignored artifact from `make backend-cover`
│   ├── cmd/server/main.go          # :8080, slog, httpapi.NewHandler, server timeouts
│   └── internal/
│       ├── calc/
│       │   ├── calc.go             # Evaluate + Arity + sentinel errors
│       │   └── calc_test.go        # table-driven + concurrency tests
│       └── httpapi/
│           ├── httpapi.go          # NewHandler, handlers, writeError mapper, recovery
│           └── httpapi_test.go     # httptest suite
├── frontend/
│   ├── package.json                # scripts: dev, build, test, lint, preview
│   ├── package-lock.json
│   ├── vite.config.ts              # react + tailwind plugins, @ alias, /api proxy, Vitest block
│   ├── tsconfig.json / tsconfig.app.json / tsconfig.node.json
│   ├── eslint.config.js
│   ├── components.json             # shadcn config
│   ├── index.html
│   └── src/
│       ├── main.tsx / App.tsx / index.css / vite-env.d.ts
│       ├── components/
│       │   ├── Calculator.tsx        # key grid + keyboard wiring
│       │   ├── Display.tsx           # display panel
│       │   ├── Calculator.test.tsx   # T-1..T-3 + supporting scenarios
│       │   └── ui/button.tsx         # shadcn Button + 4 calculator variants
│       ├── lib/
│       │   ├── utils.ts              # cn (shadcn)
│       │   ├── api.ts / api.test.ts
│       │   ├── validation.ts / validation.test.ts
│       │   ├── format.ts / format.test.ts
│       │   └── calculator-machine.ts # state machine (reducer)
│       └── test/setup.ts           # jest-dom + cleanup
├── docs/
│   ├── ai/
│   │   ├── coverage-summary.md     # full-stack coverage summary (backend + frontend)
│   │   ├── prompt-log.md           # raw, complete prompt appendix
│   │   └── skills.md
│   └── opencode/
│       ├── prds/                   # calc-domain-package, http-api-layer, extra-operations, frontend-calculator
│       └── plans/                  # matching implementation plans
└── .opencode/                      # agent harness: agents/, commands/, skills/
```

## Prerequisites

- **Go** toolchain `>= 1.22` (the module declares `go 1.22` as its minimum and does not pin a `toolchain` directive).
- **Node.js + npm** (the frontend pins `@types/node@^24`; Node 22/24 is expected — exact patches resolve via `npm install` into `package-lock.json`).
- **make** (the root `Makefile` is the canonical entry point; the underlying `go`/`npm` commands work without it too).

## Quick start

### Backend

From the repository root:

```sh
make backend-build   # cd backend && go build ./...
make backend-test    # cd backend && go test -race ./...
make backend-vet     # cd backend && go vet ./... && test -z "$(gofmt -l .)"
make backend-cover   # writes backend/coverage.txt and prints a per-function report
```

Run the server:

```sh
cd backend && go run ./cmd/server
```

The server listens on **`:8080`** and logs to stderr. It sets `ReadHeaderTimeout: 5s`, `ReadTimeout: 10s`, `WriteTimeout: 10s`, and `IdleTimeout: 60s`.

### Frontend

From the repository root:

```sh
make frontend-install   # cd frontend && npm install
make frontend-test      # cd frontend && npm run test    (= vitest run)
make frontend-lint      # cd frontend && npm run lint    (= eslint .)
make frontend-build     # cd frontend && npm run build   (= tsc -b && vite build)
```

Run the dev server (assumes the backend is running on `:8080`):

```sh
cd frontend && npm install && npm run dev
```

Open the URL Vite prints (default `http://localhost:5173`). The dev server proxies `/api/*` → `http://localhost:8080/*` (stripping the `/api` prefix), so the browser never talks to the backend cross-origin.

### Full stack (both layers)

In one terminal run the backend, in another the frontend:

```sh
# terminal 1
cd backend && go run ./cmd/server
```

```sh
# terminal 2
cd frontend && npm run dev
```

Then open `http://localhost:5173` and press `1 2 × 4 =` → the display shows `48` after a single `POST /api/evaluate` (proxied to `/evaluate`) with `{"operation":"multiply","a":12,"b":4}`. With the backend stopped, the UI still renders and a computed key press shows `Could not reach the server`.

### The canonical `make check` gate

```sh
make help   # list all targets
make check  # backend-build backend-test backend-vet frontend-test frontend-lint frontend-build
```

`make check` is green: it runs all backend and frontend gates. The frontend suite reports **4 test files / 68 tests passed**; lint reports **0 errors** (one known `react-refresh/only-export-components` warning on the shadcn `buttonVariants` export, which is a warning, not an error).

> Docker packaging is a later phase: there is no `docker compose` configuration yet, so there is no `docker compose up` command to run.

## The `internal/calc` API

Package `calc` (import path `sezzlecalc/backend/internal/calc`) exposes two pure functions and four sentinel errors:

```go
func Evaluate(operation string, a, b float64) (float64, error)
func Arity(operation string) (int, bool)

var ErrDivideByZero     = errors.New("division by zero")
var ErrUnknownOperation = errors.New("unknown operation")
var ErrSqrtNegative     = errors.New("square root of negative number")
var ErrNonFiniteResult  = errors.New("non-finite result")
```

### Operations

| `operation` | Arity | Computation | Notes |
|-------------|-------|-------------|-------|
| `add`       | binary | `a + b` | |
| `subtract`  | binary | `a - b` | |
| `multiply`  | binary | `a * b` | |
| `divide`    | binary | `a / b` | guarded: `b == 0` → `ErrDivideByZero` |
| `power`     | binary | `math.Pow(a, b)` | |
| `sqrt`      | **unary** | `math.Sqrt(a)` | guarded: `a < 0` → `ErrSqrtNegative`; reads `a` only |
| `percent`   | **unary** | `a / 100` | reads `a` only |

- Matching is **case-insensitive** and **whitespace-trimmed** for all seven names: `"Add"`, `" add "`, and `"ADD"` all resolve to `add`.
- Any string that does not normalize to one of the seven canonical names — including `""` and aliases like `"plus"` or `"mod"` — returns `ErrUnknownOperation`.

### `Arity` — the single source of truth for operand count

`Arity(operation)` returns the required operand count, normalized exactly like `Evaluate`: `(2, true)` for the five binary operations, `(1, true)` for `sqrt`/`percent`, `(0, false)` for anything else. `internal/httpapi` holds **no** local operation/unary table, so the two layers cannot drift.

### Error semantics

- Errors are **sentinel values**, matched with `errors.Is` (not `==` or string comparison).
- `divide` with a **zero divisor** returns `(0, ErrDivideByZero)`. The guard is `b == 0`, which also catches `-0.0` (`+0.0 == -0.0`).
- `sqrt` of a **strictly negative** number returns `(0, ErrSqrtNegative)`; the `a < 0` guard runs **before** `math.Sqrt(a)`. `sqrt(-0.0)` is a **finite success** returning `-0.0`.
- A **non-finite result** (`NaN`/`±Inf`) returns `(0, ErrNonFiniteResult)` — detected **in the domain** before it is returned, so `encoding/json` can never receive `NaN`/`±Inf`. It covers e.g. `power(10, 400)`, `power(-2, 0.5)`, `power(0, -1)`, and `multiply(1e308, 10)`.

## HTTP API

The HTTP surface implements the `api-contract` skill (`.opencode/skills/api-contract/SKILL.md`) for all seven operations. The single exported constructor is `func httpapi.NewHandler(logger *slog.Logger) http.Handler` (nil-safe).

### Endpoints

| Method | Path | Success | Purpose |
|--------|------|---------|---------|
| `POST` | `/evaluate` | `200 {"result": <number>}` | Evaluate one arithmetic operation |
| `GET`  | `/health`  | `200 {"status":"ok"}` | Liveness check |

Routes are **plain paths** — there is no `/api` prefix on the server. The frontend's dev proxy adds `/api` on the browser side and strips it before forwarding. The HTTP method is enforced **inside each handler**, so a wrong method returns a JSON `405` (not the mux's default text 405).

### Request — `POST /evaluate`

```json
{ "operation": "add", "a": 1.5, "b": 2.5 }
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `operation` | string | yes | one of the seven operations (case-insensitive, whitespace-trimmed) |
| `a` | number | yes | required for **every** operation |
| `b` | number | binary only | required for `add`/`subtract`/`multiply`/`divide`/`power`; must be **omitted or `null`** for `sqrt`/`percent` (a numeric `b` on a unary op → `400`) |

Transport constraints (checked in order): method must be `POST` (else `405`); `Content-Type` must be `application/json` (else `400`, `charset` allowed); body capped at 1 KiB (else `400`); malformed JSON / empty body / trailing data (else `400`); arity-aware operand presence (else `400`); non-finite input backstop (else `400`); then `calc.Evaluate` runs and domain errors flow through the single mapper.

### Response envelopes

- **Success** (`/evaluate`): `200 {"result": <number>}` — a `result` key and **no** `error` key. The result is a raw JSON number (no server-side rounding).
- **Health**: `200 {"status":"ok"}`.
- **Error**: `{"error":"<string>"}` with **no** `result` key.

### Error taxonomy

Exactly one unexported function — `writeError` — maps errors to `(status, message)`; it is the **only** place an error string meets a status code.

| Status | `error` string | Trigger |
|--------|----------------|---------|
| `400` | `invalid input` | non-JSON/absent `Content-Type`, malformed JSON, empty body, trailing data, missing/`null`/wrong-typed operands, numeric `b` on a unary op, non-finite input, body > 1 KiB |
| `405` | `method not allowed` | wrong HTTP method on `/evaluate` or `/health` |
| `422` | `division by zero` | `divide` with `b == 0` (including `-0.0`) |
| `422` | `square root of negative number` | `sqrt` of a strictly negative number |
| `422` | `invalid operation` | unknown/empty `operation` |
| `422` | `non-finite result` | result overflows to `±Inf`/`NaN` |
| `500` | `internal error` | panic recovery / unexpected error |

### curl examples

Run the server first (`cd backend && go run ./cmd/server`), then in another terminal. These hit the backend directly at `:8080` (its plain paths, no `/api` — the `/api` prefix is a dev-proxy concept on the frontend side only):

```sh
# add → 200 {"result":4}
curl -i -X POST http://localhost:8080/evaluate \
  -H 'Content-Type: application/json' \
  -d '{"operation":"add","a":1.5,"b":2.5}'

# subtract → 200 {"result":3}
curl -i -X POST http://localhost:8080/evaluate \
  -H 'Content-Type: application/json' \
  -d '{"operation":"subtract","a":5,"b":2}'

# multiply → 200 {"result":12}
curl -i -X POST http://localhost:8080/evaluate \
  -H 'Content-Type: application/json' \
  -d '{"operation":"multiply","a":3,"b":4}'

# divide → 200 {"result":4}
curl -i -X POST http://localhost:8080/evaluate \
  -H 'Content-Type: application/json' \
  -d '{"operation":"divide","a":8,"b":2}'

# power → 200 {"result":1024}
curl -i -X POST http://localhost:8080/evaluate \
  -H 'Content-Type: application/json' \
  -d '{"operation":"power","a":2,"b":10}'

# sqrt (unary — b omitted) → 200 {"result":3}
curl -i -X POST http://localhost:8080/evaluate \
  -H 'Content-Type: application/json' \
  -d '{"operation":"sqrt","a":9}'

# percent (unary — b omitted) → 200 {"result":0.5}
curl -i -X POST http://localhost:8080/evaluate \
  -H 'Content-Type: application/json' \
  -d '{"operation":"percent","a":50}'

# divide by zero → 422 {"error":"division by zero"}
curl -i -X POST http://localhost:8080/evaluate \
  -H 'Content-Type: application/json' \
  -d '{"operation":"divide","a":5,"b":0}'

# sqrt of a negative → 422 {"error":"square root of negative number"}
curl -i -X POST http://localhost:8080/evaluate \
  -H 'Content-Type: application/json' \
  -d '{"operation":"sqrt","a":-1}'

# unknown operation → 422 {"error":"invalid operation"}
curl -i -X POST http://localhost:8080/evaluate \
  -H 'Content-Type: application/json' \
  -d '{"operation":"mod","a":2,"b":3}'

# invalid input (numeric b on a unary op) → 400 {"error":"invalid input"}
curl -i -X POST http://localhost:8080/evaluate \
  -H 'Content-Type: application/json' \
  -d '{"operation":"sqrt","a":9,"b":2}'

# invalid input (missing Content-Type) → 400 {"error":"invalid input"}
curl -i -X POST http://localhost:8080/evaluate \
  -d '{"operation":"add","a":1,"b":2}'

# health → 200 {"status":"ok"}
curl -i http://localhost:8080/health
```

The error envelope is always `{"error":"<string>"}` with no `result` key; `curl -i` includes the status line and headers. A `divide` result such as `8 / 2 = 4.0` marshals as `4` (Go's `float64` JSON formatter), so assert the decoded number, not the exact bytes.

## Frontend — architecture

The frontend is Vite 7 + React 19 + TypeScript strict, styled with Tailwind v4 and shadcn/ui (a single `Button` component). All "smart" behavior lives in four pure `src/lib` modules (`api`, `validation`, `format`, `calculator-machine`); `Calculator.tsx` is the wiring, while `calculator-machine.ts` holds the state machine.

### `src/lib/validation.ts` — the entry guard and operation metadata

The single source of binary-vs-unary truth in the app. It exports `BinaryOperation`/`UnaryOperation`/`Operation` types, the `BINARY_OPERATIONS`/`UNARY_OPERATIONS` metadata arrays, the `isBinaryOperation`/`isUnaryOperation` type guards, the `ENTRY_PATTERN` regex, and `parseEntry(raw: string): number | null` — the one guard between the display buffer and the wire. It accepts `12`, `-5`, `3.`, `0.`, `.5`, `1e+21`, `1.5e-9`, `-0`; it rejects empty/whitespace, `'-'`, `'.'`, `'abc'`, `'0x10'`, `'1,000'`, `'Infinity'`, `'NaN'`, and non-finite `'1e999'`. A `null` result blocks any request.

### `src/lib/format.ts` — the display rule

One function, `formatNumber(value: number): string`, with `MAX_SIGNIFICANT_DIGITS = 12`. It returns `'Error'` for non-finite input (defensive only), normalizes `-0` → `'0'`, renders `value.toPrecision(12)` and strips trailing zeros (and a trailing `.`) after the decimal point, preserving any exponent unchanged. JS's `toPrecision` switches to exponential form at exponent ≥ 12 or < −6, which gives the compact scientific notation for very large/small magnitudes. It is applied **exactly once** per computed value, never during typing.

### `src/lib/api.ts` — the never-throwing request client

`evaluate(request): Promise<EvaluateOutcome>` where `EvaluateOutcome` is `{ ok: true; value: number } | { ok: false; error: string }`. It **never throws or rejects**. It posts `JSON.stringify(request)` to `EVALUATE_URL` (`${API_BASE_URL}/evaluate`) with `Content-Type: application/json` and a 10 s abort (`REQUEST_TIMEOUT_MS`). On a 2xx it reads `result` (must be a finite number, else transport error); on a 4xx/5xx it reads `error` (must be a non-empty string, rendered **verbatim**); any thrown/rejected path (network, abort/timeout, non-JSON body) returns `TRANSPORT_ERROR` = `'Could not reach the server'`. The `EvaluateRequest` union (`{operation, a, b}` for binary, `{operation, a}` for unary) makes it a type error to send `b` to `sqrt`/`percent`.

### `src/lib/calculator-machine.ts` — the state machine

A pure reducer module (no React, no `fetch`, no DOM). It exports `DisplayStatus` (`editing | awaiting | result | error | busy`), `CalculatorState` (`{ entry, lhs, operator, status, error }`), `INITIAL`, the `Action` union (`digit`, `decimal`, `sign`, `clear`, `backspace`, `operator`, `begin`, `resolve`), and `reducer`. Digits/`.` build the entry (at most one decimal point); `±` toggles the sign as text only; `AC` (`clear`) resets to `INITIAL`; Backspace removes the last character (keyboard-only); a binary operator stores `lhs` and selects the operation (replacing, never evaluating, if a second operand was typed); `begin`/`resolve` commit an evaluation — `=` resolves with `preserve: false`, `√`/`%` resolve with `preserve: true` (keeping a pending `lhs`/`operator`). While `busy`, every transition except `clear` is ignored, guaranteeing **exactly one** request per evaluating press.

### `src/components/Calculator.tsx` — wiring, keypad, keyboard

`useReducer(reducer, INITIAL)` holds the state, plus a `requestToken` ref for staleness. `evaluateCurrent` builds the request, bumps the token, dispatches `begin`, and on resolution dispatches `resolve` only if the token is still current; `pressEquals`, `pressUnary`, and `clear` wrap it (`clear` bumps the token to invalidate any in-flight response). A single `window` keydown listener maps digits, `.`, `+ - * /`, `Enter`/`=`, `Backspace`, and `Escape` (never `preventDefault` on `Tab`). The key grid is 4 columns × 6 rows (a two-key scientific strip `√ xʸ` above the keypad, `0` spanning two columns, operators rightmost), all 21 keys are real `<button type="button">` with unique accessible names, and it renders `<Display … />` above the keypad.

### `src/components/Display.tsx` — the display

A presentational `<output aria-live="polite">` with `aria-label="Calculator display"` and `data-testid="calculator-display"`. Text precedence: error → the `error` string (falling back to `Unknown error`), empty entry → `0`, otherwise the entry. Size thresholds: ≤10 characters renders `text-4xl`, else `text-2xl`; an error renders `text-lg break-words`.

## Calculator behavior summary

- **One binary operation at a time** — operator presses never evaluate; `=` sends a single `POST /evaluate` `{operation, a, b}`. There is no chaining, precedence, or parser.
- **No client-side arithmetic** — the UI only edits text (digits, `.`, `±`, Backspace) and formats. Every computed value comes from a server `200 {"result": <number>}`.
- **Unary `sqrt` / `percent`** — these evaluate the current entry immediately with `{operation, a}` (no `b` key). `percent(a) = a / 100`, so `50 %` displays the bare ratio `0.5`.
- **Exactly one request per evaluating press**, guarded by the `busy` status (not timing); zero requests on mount; `fetch` is always stubbed in tests.
- **Server error strings are rendered verbatim** (`division by zero`, `invalid input`, `square root of negative number`, `invalid operation`, `non-finite result`); the only client-authored string is the transport message `Could not reach the server`.

## Design decisions & assumptions

### Backend

- **Module path `sezzlecalc/backend`**, `go 1.22` minimum with no `toolchain` directive; production code is stdlib-only; `testify` is test-only.
- **Sentinel errors over dynamic strings**, matched with `errors.Is`.
- **Pure, stateless domain separated from HTTP**; `Evaluate` and `Arity` are pure functions; all error→status mapping lives in one `writeError` method.
- **Non-finite result detection lives in the domain** (so `encoding/json` never sees `NaN`/`±Inf`), while non-finite *input* is a `400 invalid input` at the boundary.
- **Plain-path routing with in-handler method enforcement**; `mime.ParseMediaType` Content-Type gate; `http.MaxBytesReader` 1 KiB cap; panic recovery logging server-side only.

### Frontend

- **12 significant digits** — `formatNumber` renders at most 12 significant digits via `toPrecision(12)`; JS's own exponential thresholds (exponent ≥ 12 or < −6) produce compact scientific notation.
- **`-0` → `0`** — negative zero is normalized to `0` in the display (`value === 0` also matches `-0` in JS); `±` never produces `-0`.
- **Percent is a bare ratio** — the contract defines `percent(a) = a / 100`, so `50 %` shows `0.5` (no `%` suffix) and no sign symbol is sent as an operation.
- **Precision trade-off on chained calculations** — computed values are stored in `entry` already formatted (12 significant digits), so a chain uses the *displayed* value: `1 ÷ 3 =` shows `0.333333333333`, then `× 3 =` yields `0.999999999999`. This is accepted; there is no hidden exact-value field.
- **`VITE_API_BASE_URL` is a base prefix** — it defaults to `/api` and has trailing slashes stripped; the full endpoint is `${base}/evaluate`. It is not a full endpoint URL. Setting it to `http://localhost:8080` would bypass the proxy and fail CORS (the backend has no CORS middleware) — documented but unsupported. No `.env` file is committed.
- **The dev proxy is mandatory** — `/api/*` → `/*` to `http://localhost:8080`, so `/api/evaluate` reaches `/evaluate`. Omitting the `rewrite` produces 404s.

## North star

The REST API is governed by the `api-contract` skill (`.opencode/skills/api-contract/SKILL.md`). Both layers are **built and verified**:

- `POST /evaluate` — evaluate a single arithmetic operation (`add`, `subtract`, `multiply`, `divide`, `power`, `sqrt`, `percent`). ✅ built
- `GET /health` — liveness check. ✅ built
- React frontend that validates and formats only (never performs arithmetic). ✅ built

The remaining north-star item — Docker packaging for the full stack — is a later phase, not yet present.

## Testing & coverage

### Backend

- `internal/calc` tests are **table-driven** (`t.Run` per case), asserting both value and error via `errors.Is`, covering all seven operations, normalization, `0`/`-0.0`, every non-finite case, `sqrt` of a negative, `Arity`, and a concurrency test under `-race`.
- `internal/httpapi` tests drive `NewHandler` end-to-end through `httptest`, asserting **status code + envelope shape + exact decoded value** — all seven operations, the full error taxonomy, arity-aware presence rules, the `Content-Type` gate, the 1 KiB cap, wrong methods, panic recovery, and negative-zero results.
- `make backend-cover` reports **100%** for `internal/calc`, **97.9%** for `internal/httpapi`, and a **92.7%** module total. The only uncovered statements are two defensive non-finite-input backstop guards, unreachable over the wire because JSON cannot express `NaN`/`Inf`. `cmd/server/main.go` is untested by design (thin wiring).

### Frontend

- Stack: **Vitest 3 + React Testing Library + `@testing-library/user-event` + `@testing-library/jest-dom`**, `environment: 'jsdom'`. `fetch` is always stubbed (`vi.stubGlobal`), so no test performs real network I/O; async assertions use `waitFor`/`findBy`.
- Four test files, **68 tests**, run via `make frontend-test` (`npm run test` = `vitest run`, non-interactive):
  - `Calculator.test.tsx` — the mandated scenarios **T-1** (binary path sends exactly one `POST /api/evaluate` `{operation:'multiply', a:12, b:4}` and renders `48`), **T-2** (unary `sqrt` posts `{operation:'sqrt', a:9}` with no `b` key and renders `3`), **T-3** (an empty entry blocks the request — `fetch` is never called), plus supporting cases: no request on mount, `±` sign toggle, server error rendered verbatim, `AC` clears an error, `busy` disables keys, operator replacement, unary-preserves-pending-operator, and keyboard entry.
  - `api.test.ts` — the mandated **T-4** status/transport table: success `200`, `422`/`400`/`500` verbatim errors, network failure, abort, non-JSON bodies, and a 2xx without a finite numeric `result`, all resolving (never rejecting) to the exact expected outcome, plus the request init (`POST`, `Content-Type`, no `b` key on unary).
  - `validation.test.ts` — `parseEntry` accept/reject tables and the binary/unary metadata + type guards.
  - `format.test.ts` — the `formatNumber` 12-significant-digit table (`48 → '48'`, `-0 → '0'`, `1/3 → '0.333333333333'`, `1e12 → '1e+12'`, `1e-7 → '1e-7'`, `Infinity → 'Error'`, …).
- Lint: `make frontend-lint` (`eslint .`) reports **0 errors**; there is one known `react-refresh/only-export-components` **warning** on the shadcn `buttonVariants` export (a warning, not an error).

See [`docs/ai/coverage-summary.md`](docs/ai/coverage-summary.md) for the full per-function backend breakdown and the frontend breadth summary.

## AI-assisted development

This project was delivered through a multi-agent pipeline (PRD → plan → plan review → implementation → verification → docs), feature by feature: the domain package, the HTTP layer, the extra operations, and the frontend scaffold + calculator. The curated prompt trail lives in [`PROMPTS.md`](PROMPTS.md); the complete raw log is [`docs/ai/prompt-log.md`](docs/ai/prompt-log.md).
