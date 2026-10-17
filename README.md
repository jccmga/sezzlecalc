# sezzlecalc

A full-stack calculator — a Go REST API consumed by a React/Vite/TypeScript frontend. This worktree delivers the **backend domain core** (`internal/calc`, now with all seven contract operations) **and the HTTP layer + server** (`internal/httpapi` + `cmd/server`). The frontend and Docker packaging are later phases and are **not yet present**.

## Current state

| Layer | Status |
|-------|--------|
| `backend/internal/calc` — pure, stateless arithmetic domain package (seven operations) | ✅ Built & verified (100% coverage) |
| `backend/internal/httpapi` + `cmd/server` — HTTP server, `POST /evaluate`, `GET /health` | ✅ Built & verified (this phase; 97.9% coverage) |
| `frontend/` — React/Vite/TypeScript UI | ⏳ Later phase — **not yet present** |
| Docker packaging for the full stack | ⏳ Later phase — **not yet present** |

The repository currently contains the Go backend (domain package + HTTP layer + server entrypoint), plus the agent harness and documentation. There is no frontend directory and no `docker compose` configuration yet.

## Architecture

```
┌────────────────────────────────────────────────────────────────┐
│                          sezzlecalc                            │
│                                                                │
│  backend/  (Go module: sezzlecalc/backend)                     │
│  ┌──────────────────────────────────────────────┐              │
│  │  cmd/server/main.go                         │              │
│  │  slog logger → httpapi.NewHandler → :8080   │              │
│  │  http.Server timeouts · ListenAndServe      │              │
│  └──────────────────────┬───────────────────────┘              │
│  ┌──────────────────────▼───────────────────────┐              │
│  │  internal/httpapi                            │              │
│  │  NewHandler(logger) http.Handler             │              │
│  │  POST /evaluate · GET /health                │              │
│  │  arity-aware operand presence                │              │
│  │  writeError = single error→status mapper     │              │
│  │  Content-Type gate · 1 KiB cap · recovery    │              │
│  └──────────────────────┬───────────────────────┘              │
│                         │  calc.Evaluate · calc.Arity          │
│  ┌──────────────────────▼───────────────────────┐              │
│  │  internal/calc  (pure domain)                │              │
│  │  Evaluate(operation,a,b) (float64, error)    │              │
│  │  Arity(operation) (int, bool)                │              │
│  │  ErrDivideByZero / ErrUnknownOperation /     │              │
│  │  ErrSqrtNegative / ErrNonFiniteResult        │              │
│  │  unary: sqrt · percent   binary: add…power   │              │
│  │  pure · stateless · no net/http              │              │
│  └──────────────────────────────────────────────┘              │
│                                                                │
│  frontend/  (React/Vite/TS)                    ← future        │
│  ┌──────────────────────────────────────────────┐   (not yet   │
│  │  validates & formats only — no arithmetic    │    present)  │
│  └──────────────────────────────────────────────┘              │
└────────────────────────────────────────────────────────────────┘
```

The design deliberately separates a **pure domain** (`internal/calc`) from a **thin HTTP layer** (`internal/httpapi`) and a **thin entrypoint** (`cmd/server/main.go`). The domain never touches `net/http`, so it is unit-testable in complete isolation; the HTTP layer owns encoding/decoding, routing, method enforcement, the `Content-Type` gate, the body cap, arity-aware operand presence, panic recovery, and the single error→status mapper, and delegates all arithmetic to `calc.Evaluate` (and all arity questions to `calc.Arity`).

## Tech stack

- **Backend:** Go (module `sezzlecalc/backend`, minimum `go 1.22`), stdlib-only in production code. The single third-party dependency is `github.com/stretchr/testify` (test-only, plus its indirect `go.yaml.in/yaml/v3`).
- **Frontend:** React + Vite + TypeScript (planned; not yet scaffolded).
- **Testing:** Go's standard `testing` package — table-driven (`t.Run` per case) with `net/http/httptest` for handler tests, `testify` (`require`/`assert`) for assertions, and `-race` enabled.

## Repository layout

```
sezzlecalc/
├── AGENTS.md                       # repository guide for agents
├── Makefile                        # canonical build/test entry points
├── PROMPTS.md                      # curated AI-prompt trail
├── README.md
├── opencode.json
├── .gitignore                      # ignores backend/coverage.txt
├── backend/
│   ├── go.mod                      # module sezzlecalc/backend; go 1.22; testify (test-only)
│   ├── go.sum                      # testify + indirect yaml/v3 checksums
│   ├── coverage.txt                # git-ignored artifact from `make backend-cover`
│   ├── cmd/
│   │   └── server/
│   │       └── main.go             # package main: slog logger, httpapi.NewHandler, :8080, timeouts
│   └── internal/
│       ├── calc/
│       │   ├── calc.go             # package calc: Evaluate + Arity + four sentinel errors
│       │   └── calc_test.go        # table-driven + concurrency tests (HTTP-free)
│       └── httpapi/
│           ├── httpapi.go          # package httpapi: NewHandler, handlers, writeError mapper, recovery
│           └── httpapi_test.go     # httptest suite (status + envelope + exact value)
├── docs/
│   ├── ai/
│   │   ├── coverage-summary.md     # backend coverage summary (calc + httpapi)
│   │   ├── prompt-log.md           # raw, complete prompt appendix
│   │   └── skills.md               # vendored/authored skill inventory
│   └── opencode/
│       ├── prds/
│       │   ├── calc-domain-package.md
│       │   ├── http-api-layer.md
│       │   └── extra-operations.md
│       └── plans/
│           ├── calc-domain-package.md
│           ├── http-api-layer.md
│           └── extra-operations.md
└── .opencode/                      # agent harness: agents/, commands/, skills/
```

## Prerequisites

- **Go** toolchain `>= 1.22` (the module declares `go 1.22` as its minimum and does not pin a `toolchain` directive, so it builds with any toolchain at or above 1.22).
- **make** (the root `Makefile` is the canonical entry point; the underlying `go` commands work without it too).

## Quick start — backend

From the repository root:

```sh
make backend-build   # cd backend && go build ./...
make backend-test    # cd backend && go test -race ./...
make backend-vet     # cd backend && go vet ./... && test -z "$(gofmt -l .)"
make backend-cover   # writes backend/coverage.txt and prints a per-function report
make help            # list all targets
```

All four backend gates pass: `make backend-cover` reports **100% statement coverage** for `internal/calc`, **97.9%** for `internal/httpapi`, and a **92.7%** module total (`cmd/server` is a thin untested entrypoint). See [Testing & coverage](#testing--coverage) and [`docs/ai/coverage-summary.md`](docs/ai/coverage-summary.md).

> The `frontend-*` and `check` targets in the `Makefile` reference `frontend/`, which does not exist yet — those targets will become meaningful in a later phase. There is no `docker compose` configuration yet.

## Running the server

```sh
cd backend && go run ./cmd/server
```

The server listens on **`:8080`** and logs to stderr. It sets `ReadHeaderTimeout: 5s`, `ReadTimeout: 10s`, `WriteTimeout: 10s`, and `IdleTimeout: 60s`.

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

- Matching is **case-insensitive** and **whitespace-trimmed** for all seven names: `"Add"`, `" add "`, and `"ADD"` all resolve to `add`; likewise `" Power "`, `"SQRT"`, and `" PeRcEnT "` resolve to their canonical names.
- Any string that does not normalize to one of the seven canonical names — including `""` and whitespace-only strings, and aliases like `"plus"` or `"mod"` — returns `ErrUnknownOperation`.

### `Arity` — the single source of truth for operand count

`Arity(operation)` returns the required operand count, normalized exactly like `Evaluate`:

- `(2, true)` for `add`, `subtract`, `multiply`, `divide`, `power` (binary)
- `(1, true)` for `sqrt`, `percent` (unary)
- `(0, false)` for anything else (unknown)

`internal/httpapi` calls `Arity` to enforce operand presence; it holds **no** local operation/unary table of its own, so the two layers cannot drift on which operations exist or how many operands they take.

### Error semantics

- Errors are **sentinel values**, matched with `errors.Is` (not `==` or string comparison), so the HTTP layer can map them cleanly.
- `divide` with a **zero divisor** returns `(0, ErrDivideByZero)`. The guard is `b == 0`, which under IEEE-754 also catches `-0.0` (since `+0.0 == -0.0`). Go's raw `a / b` would instead produce `±Inf`/`NaN` without panicking — the explicit guard is what turns that into a recoverable error.
- `sqrt` of a **strictly negative** number returns `(0, ErrSqrtNegative)`. The `a < 0` guard runs **before** `math.Sqrt(a)`, so `math.Sqrt(-1)`'s raw `NaN` never escapes; `sqrt(-0.0)` is a **finite success** returning `-0.0` (because `-0.0 < 0` is `false` in IEEE-754).
- A **non-finite result** (`NaN` or `±Inf`) returns `(0, ErrNonFiniteResult)` — detected **in the domain** before it is returned, and the raw non-finite value is discarded. This is what guarantees `encoding/json` can never receive `NaN`/`±Inf`. It covers e.g. `power(10, 400)`, `power(-2, 0.5)`, `power(0, -1)` (non-finite — **not** `ErrDivideByZero`), and `multiply(1e308, 10)`.
- On any error the returned result is the zero value `0`.
- Non-finite **operands** passed directly to the package are not a separate error; the value-based result check still catches a non-finite result they produce (via `ErrNonFiniteResult`). Through the HTTP API, non-finite *input* is rejected earlier as `400 invalid input` — see below.

### Usage

```go
package main

import (
    "errors"
    "fmt"

    "sezzlecalc/backend/internal/calc"
)

func main() {
    if v, err := calc.Evaluate("add", 2, 3); err == nil {
        fmt.Println(v) // 5
    }

    if v, err := calc.Evaluate(" ADD ", 1.5, 2.5); err == nil {
        fmt.Println(v) // 4 (normalized: " ADD " → "add")
    }

    if v, err := calc.Evaluate("power", 2, 10); err == nil {
        fmt.Println(v) // 1024
    }

    if v, err := calc.Evaluate("sqrt", 9, 0); err == nil {
        fmt.Println(v) // 3 (unary: b is ignored)
    }

    if v, err := calc.Evaluate("percent", 50, 0); err == nil {
        fmt.Println(v) // 0.5 (unary: b is ignored)
    }

    if arity, ok := calc.Arity(" SQRT "); ok {
        fmt.Println(arity) // 1 (normalized, unary)
    }

    _, err := calc.Evaluate("divide", 5, 0)
    fmt.Println(errors.Is(err, calc.ErrDivideByZero)) // true

    _, err = calc.Evaluate("sqrt", -1, 0)
    fmt.Println(errors.Is(err, calc.ErrSqrtNegative)) // true

    _, err = calc.Evaluate("power", 10, 400)
    fmt.Println(errors.Is(err, calc.ErrNonFiniteResult)) // true

    _, err = calc.Evaluate("mod", 8, 2)
    fmt.Println(errors.Is(err, calc.ErrUnknownOperation)) // true
}
```

## HTTP API

The HTTP surface implements the `api-contract` skill for all seven operations the domain provides. The single exported constructor is `func httpapi.NewHandler(logger *slog.Logger) http.Handler` (nil-safe — a nil logger falls back to `slog.Default()`).

### Endpoints

| Method | Path | Success | Purpose |
|--------|------|---------|---------|
| `POST` | `/evaluate` | `200 {"result": <number>}` | Evaluate one arithmetic operation |
| `GET`  | `/health`  | `200 {"status":"ok"}` | Liveness check |

Routes are registered as **plain paths** on a stdlib `http.ServeMux`; the HTTP method is enforced **inside each handler**, so a wrong method returns a JSON `405` (not the mux's default text 405).

### Request — `POST /evaluate`

```json
{ "operation": "add", "a": 1.5, "b": 2.5 }
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `operation` | string | yes | one of the seven operations (case-insensitive, whitespace-trimmed) |
| `a` | number | yes | required for **every** operation; decoded into a pointer so a missing or explicit `null` operand is distinguishable from a legitimate `0` |
| `b` | number | binary only | required for `add`/`subtract`/`multiply`/`divide`/`power`; must be **omitted or `null`** for `sqrt`/`percent` (a numeric `b` on a unary op → `400`) |

Transport constraints (checked in this order):

1. **Method** must be `POST`; anything else → `405`.
2. **`Content-Type`** must be `application/json` (parsed with `mime.ParseMediaType`, so a `charset` parameter such as `application/json; charset=utf-8` is accepted). Absent, malformed, or any other media type → `400` before the body is read.
3. **Body cap** — the body is wrapped with `http.MaxBytesReader(w, r.Body, 1024)`; bodies over 1 KiB (inclusive limit at 1024 bytes) → `400`.
4. **Decode** — malformed JSON, an empty body, or trailing non-whitespace data → `400`.
5. **Arity-aware operand presence** — `a` is required for every known operation; `b` is required for the five binary operations and must be **omitted/`null`** for the two unary operations (`sqrt`, `percent`). A violation → `400`. Arity comes from `calc.Arity`, so an **unknown** operation skips presence enforcement entirely and delegates to `calc.Evaluate` (→ `422 invalid operation`) **regardless of operand presence** — the operation name is validated before the operands.
6. **Non-finite input** — a defensive post-decode backstop: any `±Inf`/`NaN` in `a` or `b` → `400` (standard JSON cannot express these; overflowing literals such as `1e400` already fail in the decoder).
7. **Evaluate** — `calc.Evaluate` runs; a domain error flows through the single mapper below.

Unknown JSON fields are ignored (no `DisallowUnknownFields`), keeping the layer forward-compatible.

### Response envelopes

- **Success** (`/evaluate`): `200 {"result": <number>}` — a `result` key and **no** `error` key. The result is a raw JSON number (no server-side rounding or formatting): `4.0` marshals as `4`, `-0.0` marshals as `-0`.
- **Health**: `200 {"status":"ok"}`.
- **Error**: `{"error":"<string>"}` with **no** `result` key. `Content-Type: application/json` is set on every response (success and error).

### Error taxonomy

Exactly one unexported function — `writeError` — maps errors to `(status, message)`. It is the **only** place an error string meets a status code; raw errors, wrapped causes, stack traces, and file paths never reach the response body.

| Status | `error` string | Trigger |
|--------|----------------|---------|
| `400` | `invalid input` | non-`application/json`/absent `Content-Type`, malformed JSON, empty body, trailing data, missing/`null`/wrong-typed operands, a numeric `b` on a unary op, non-finite input, body > 1 KiB |
| `405` | `method not allowed` | wrong HTTP method on `/evaluate` or `/health` |
| `422` | `division by zero` | `divide` with `b == 0` (including `-0.0`) |
| `422` | `square root of negative number` | `sqrt` of a strictly negative number |
| `422` | `invalid operation` | unknown/empty `operation` |
| `422` | `non-finite result` | result overflows to `±Inf`/`NaN` (e.g. `power(10, 400)`, `multiply(1e308, 10)`) — detected in the **domain**, then mapped here |
| `500` | `internal error` | panic recovery / unexpected error |

### curl examples

Run the server first (`cd backend && go run ./cmd/server`), then in another terminal:

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

Note the error envelope is always `{"error":"<string>"}` with no `result` key; `curl -i` includes the status line and headers. A `divide` result such as `8 / 2 = 4.0` marshals as `4` (Go's `float64` JSON formatter), so assert the decoded number, not the exact bytes.

## Design decisions & assumptions

- **Module path `sezzlecalc/backend`.** Chosen explicitly (rather than a hosting URL); derived import path is `sezzlecalc/backend/internal/...`.
- **`go 1.22` minimum, no `toolchain` directive.** The `go.mod` is written by hand to keep the module portable across any Go ≥ 1.22. Production code is stdlib-only; `github.com/stretchr/testify` (and its indirect `go.yaml.in/yaml/v3`) is the single third-party dependency and is **test-only**, added in a backmerge that updated the `go-http-service` skill to mandate testify.
- **Sentinel errors over dynamic strings.** The four domain errors (`ErrDivideByZero`, `ErrUnknownOperation`, `ErrSqrtNegative`, `ErrNonFiniteResult`) are package-level `errors.New` values so callers (the HTTP layer) match with `errors.Is` rather than string comparison.
- **Pure, stateless domain, separated from HTTP.** The `calc` package has no mutable package-level state, no I/O, no goroutines, and imports no `net/http`; `Evaluate` and `Arity` are pure functions of their arguments. The HTTP boundary (`internal/httpapi` + `cmd/`) is a separate layer that delegates all arithmetic and all arity questions to it.
- **Non-finite result detection lives in the domain.** `Evaluate` detects a `NaN`/`±Inf` result before returning and returns `(0, ErrNonFiniteResult)` — discarding the raw non-finite value — so `encoding/json` can never receive `NaN`/`±Inf` and can never fail mid-encode after a `200` has already been written. The HTTP layer's former local `errNonFiniteResult` sentinel and post-`Evaluate` check were **removed**; the domain is the sole detection point and the mapper turns `ErrNonFiniteResult` into `422 {"error":"non-finite result"}`.
- **Explicit zero-divisor guard.** `divide` checks `b == 0` and returns `ErrDivideByZero` rather than relying on Go's `±Inf`/`NaN` behavior; `-0.0` is treated as zero (the single `b == 0` check suffices because `+0.0 == -0.0`).
- **`sqrt` negative guard before `math.Sqrt`.** The `a < 0` check runs first, so a strictly negative input yields `ErrSqrtNegative` (`422 square root of negative number`) rather than a raw `NaN` that would surface as `ErrNonFiniteResult`. Because `-0.0 < 0` is `false`, `sqrt(-0.0)` passes the guard and returns `-0.0` as a finite success.
- **Unary rule + `Arity` single source of truth.** The seven-operation table and its arity live only in `calc.Arity`; `internal/httpapi` holds no local operation/unary set. At the boundary, `a` is always required; `b` is required for the five binary operations and must be **omitted/`null`** for `sqrt`/`percent` (a numeric `b` on a unary op → `400`). The operation name is validated first, so an unknown operation returns `422 invalid operation` regardless of operand presence.
- **Normalization in one place.** Trim + case-fold + `switch` guarantees exactly seven accepted operation names and no aliases; `Evaluate` and `Arity` share the identical normalization.
- **Single `errors.Is` → status mapper.** All error→(status, string) translation lives in one unexported `writeError` method — the only place error strings meet status codes. Handlers and the recovery middleware pass a sentinel (or a wrapped decode error) to it and never choose a status code themselves.
- **Plain-path routing with in-handler method enforcement.** Routes are registered as plain `/evaluate` and `/health` patterns (no Go 1.22 method patterns, no third-party router), so a wrong method is caught inside the handler and returns a JSON `405 {"error":"method not allowed"}` instead of the mux's default text 405.
- **`mime.ParseMediaType` Content-Type gate.** The `Content-Type` is parsed and must equal `application/json` (case-insensitive; a `charset` parameter is allowed) *before* any body decode; absent/malformed/other → `400 invalid input`.
- **`http.MaxBytesReader` 1 KiB cap.** The body is capped at 1024 bytes (inclusive); overflow surfaces as `*http.MaxBytesError`, wrapped with `fmt.Errorf("%w: %w", errInvalidInput, err)` so both the HTTP sentinel and the real cause flow through the same mapper to `400 invalid input`.
- **Pointer-field decode.** `a` and `b` decode into `*float64` so a missing or explicit `null` operand is distinguishable from a legitimate `0` (missing/`null` where required → `400 invalid input`; a numeric `b` on a unary op → `400 invalid input`).
- **Non-finite input vs. result split.** Non-finite `a`/`b` → `400 invalid input` (a defensive post-decode backstop, since standard JSON cannot express `NaN`/`Inf` and overflowing literals fail in the decoder). A non-finite *result* → `422 non-finite result`, now detected in the domain (e.g. `power(10, 400)`, `multiply(1e308, 10)`). Input finiteness never becomes a domain `422`.
- **Panic recovery with server-side-only logging.** A recovery middleware wraps the whole mux: on panic it logs the panic value plus `runtime/debug.Stack()` at error level and returns `500 {"error":"internal error"}` — the panic detail never leaks into the response body.

## North star

The REST API is governed by the `api-contract` skill (`.opencode/skills/api-contract/SKILL.md`). Both endpoints are now **built and verified**, and the domain implements **all seven** contract operations:

- `POST /evaluate` — evaluate a single arithmetic operation (`add`, `subtract`, `multiply`, `divide`, `power`, `sqrt`, `percent`). ✅ built
- `GET /health` — liveness check. ✅ built

The error mapping from the domain's sentinel errors is implemented in the single `writeError` mapper: `ErrDivideByZero` → `422 {"error":"division by zero"}`, `ErrSqrtNegative` → `422 {"error":"square root of negative number"}`, `ErrUnknownOperation` → `422 {"error":"invalid operation"}`, `ErrNonFiniteResult` → `422 {"error":"non-finite result"}` (the mapper, not the sentinels' own messages, populates the body). The remaining north-star items — the React frontend that validates and formats only (never performs arithmetic) and the Docker packaging — are later phases, not yet present.

## Testing & coverage

- Domain tests (`backend/internal/calc/calc_test.go`) are **table-driven** (`t.Run` per case) and assert **both** the returned value and the returned error via `errors.Is`; they cover all seven operations, normalization, distinct `0`/`-0.0` (runtime `math.Copysign(0, -1)`, asserted with `math.Signbit`), every non-finite case, `sqrt` of a negative, the `Arity` helper, and a concurrency test exercising overlapping `Evaluate` calls under the `-race` detector.
- HTTP tests (`backend/internal/httpapi/httpapi_test.go`) drive `NewHandler` end-to-end through `net/http/httptest`, asserting **status code + envelope shape (key presence/absence) + exact decoded value** — never raw bytes. They cover all seven operations, the full error taxonomy (400/405/422/500 rows), the arity-aware presence rules (unary `b` omitted vs. `null` vs. numeric), the `Content-Type` gate (absent, other, malformed, `charset`, case-insensitive), the 1 KiB body cap (boundary included), wrong methods on both routes, unknown paths, panic recovery, negative-zero results, and the mapper default.
- `make backend-test` runs `go test -race ./...`; `make backend-cover` reports **100% statement coverage** for `internal/calc` (`Evaluate` 100%, `Arity` 100%), **97.9%** for `internal/httpapi` (`evaluateHandler` and its extracted validation helpers are 100% except `validateOperandFiniteness` at 60%), and a **92.7%** module total. The two uncovered statement blocks in `internal/httpapi` are the defensive non-finite-input backstop guards on `a` and on `b` in `validateOperandFiniteness` — unreachable over the wire because JSON cannot express `NaN`/`Inf` and overflowing literals fail in the decoder. `cmd/server/main.go` has no tests by design (`main()` shows 0.0%): it is thin wiring only, with no business logic. **17 tests run, 0 fail, 0 skip** (no skipped tests).
- See [`docs/ai/coverage-summary.md`](docs/ai/coverage-summary.md) for the full per-function breakdown.

## AI-assisted development

This feature was delivered through a multi-agent pipeline (PRD → plan → plan review → implementation → verification → docs). The curated prompt trail lives in [`PROMPTS.md`](PROMPTS.md); the complete raw log is [`docs/ai/prompt-log.md`](docs/ai/prompt-log.md).
