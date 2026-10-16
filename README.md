# sezzlecalc

A full-stack calculator — a Go REST API consumed by a React/Vite/TypeScript frontend. This worktree delivers the **backend domain core** (`internal/calc`) **and the HTTP layer + server** (`internal/httpapi` + `cmd/server`). The frontend and Docker packaging are later phases and are **not yet present**.

## Current state

| Layer | Status |
|-------|--------|
| `backend/internal/calc` — pure, stateless arithmetic domain package | ✅ Built & verified (100% coverage) |
| `backend/internal/httpapi` + `cmd/server` — HTTP server, `POST /evaluate`, `GET /health` | ✅ Built & verified (this phase; 97.0% coverage) |
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
│  │  writeError = single error→status mapper     │              │
│  │  Content-Type gate · 1 KiB cap · recovery    │              │
│  └──────────────────────┬───────────────────────┘              │
│                         │  calc.Evaluate (only)                │
│  ┌──────────────────────▼───────────────────────┐              │
│  │  internal/calc  (pure domain, unchanged)     │              │
│  │  Evaluate(operation,a,b) (float64, error)    │              │
│  │  ErrDivideByZero / ErrUnknownOperation       │              │
│  │  pure · stateless · no net/http              │              │
│  └──────────────────────────────────────────────┘              │
│                                                                │
│  frontend/  (React/Vite/TS)                    ← future        │
│  ┌──────────────────────────────────────────────┐   (not yet   │
│  │  validates & formats only — no arithmetic    │    present)  │
│  └──────────────────────────────────────────────┘              │
└────────────────────────────────────────────────────────────────┘
```

The design deliberately separates a **pure domain** (`internal/calc`) from a **thin HTTP layer** (`internal/httpapi`) and a **thin entrypoint** (`cmd/server/main.go`). The domain never touches `net/http`, so it is unit-testable in complete isolation; the HTTP layer owns encoding/decoding, routing, method enforcement, the `Content-Type` gate, the body cap, panic recovery, and the single error→status mapper, and delegates all arithmetic to `calc.Evaluate`.

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
│       │   ├── calc.go             # package calc: Evaluate + sentinel errors
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
│       │   └── http-api-layer.md
│       └── plans/
│           ├── calc-domain-package.md
│           └── http-api-layer.md
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

All four backend gates pass: `make backend-cover` reports **100% statement coverage** for `internal/calc` and **97.0%** for `internal/httpapi` (`cmd/server` is a thin untested entrypoint). See [Testing & coverage](#testing--coverage) and [`docs/ai/coverage-summary.md`](docs/ai/coverage-summary.md).

> The `frontend-*` and `check` targets in the `Makefile` reference `frontend/`, which does not exist yet — those targets will become meaningful in a later phase. There is no `docker compose` configuration yet.

## Running the server

```sh
cd backend && go run ./cmd/server
```

The server listens on **`:8080`** and logs to stderr. It sets `ReadHeaderTimeout: 5s`, `ReadTimeout: 10s`, `WriteTimeout: 10s`, and `IdleTimeout: 60s`.

## The `internal/calc` API

Package `calc` (import path `sezzlecalc/backend/internal/calc`) exposes one pure function and two sentinel errors:

```go
func Evaluate(operation string, a, b float64) (float64, error)

var ErrDivideByZero   = errors.New("division by zero")  // matchable via errors.Is
var ErrUnknownOperation = errors.New("unknown operation")
```

### Operations

| `operation` | Computation | Notes |
|-------------|-------------|-------|
| `add`       | `a + b`     | |
| `subtract`  | `a - b`     | |
| `multiply`  | `a * b`     | |
| `divide`    | `a / b`     | guarded: `b == 0` → `ErrDivideByZero` |

- Matching is **case-insensitive** and **whitespace-trimmed**: `"Add"`, `" add "`, and `"ADD"` all resolve to `add` (and likewise for the other three).
- Any string that does not normalize to one of the four canonical names — including `""` and whitespace-only strings, and aliases like `"plus"` or `"mod"` — returns `ErrUnknownOperation`.

### Error semantics

- Errors are **sentinel values**, matched with `errors.Is` (not `==` or string comparison), so the HTTP layer can map them cleanly.
- `divide` with a **zero divisor** returns `(0, ErrDivideByZero)`. The guard is `b == 0`, which under IEEE-754 also catches `-0.0` (since `+0.0 == -0.0`). Go's raw `a / b` would instead produce `±Inf`/`NaN` without panicking — the explicit guard is what turns that into a recoverable error.
- Non-finite operands (`NaN`, `±Inf`) **pass through** with standard IEEE-754 semantics; `Evaluate` does not reject them (the HTTP layer rejects non-finite *input* and *result* before/after calling it — see below).
- On any error the returned result is the zero value `0`.

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

    _, err := calc.Evaluate("divide", 5, 0)
    fmt.Println(errors.Is(err, calc.ErrDivideByZero)) // true

    _, err = calc.Evaluate("mod", 8, 2)
    fmt.Println(errors.Is(err, calc.ErrUnknownOperation)) // true
}
```

## HTTP API

The HTTP surface implements the `api-contract` skill for the four operations the domain provides. The single exported constructor is `func httpapi.NewHandler(logger *slog.Logger) http.Handler` (nil-safe — a nil logger falls back to `slog.Default()`).

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
| `operation` | string | yes | one of `add`, `subtract`, `multiply`, `divide` (case-insensitive, whitespace-trimmed) |
| `a` | number | yes | decoded into a pointer so a missing or explicit `null` operand is distinguishable from a legitimate `0` |
| `b` | number | yes | same as `a` |

Transport constraints (checked in this order):

1. **Method** must be `POST`; anything else → `405`.
2. **`Content-Type`** must be `application/json` (parsed with `mime.ParseMediaType`, so a `charset` parameter such as `application/json; charset=utf-8` is accepted). Absent, malformed, or any other media type → `400` before the body is read.
3. **Body cap** — the body is wrapped with `http.MaxBytesReader(w, r.Body, 1024)`; bodies over 1 KiB (inclusive limit at 1024 bytes) → `400`.
4. **Decode** — malformed JSON, an empty body, or trailing non-whitespace data → `400`.
5. **Operands** — a missing or explicit-`null` `a`/`b`, or a wrong-typed field → `400`.

Unknown JSON fields are ignored (no `DisallowUnknownFields`), keeping the layer forward-compatible.

### Response envelopes

- **Success** (`/evaluate`): `200 {"result": <number>}` — a `result` key and **no** `error` key.
- **Health**: `200 {"status":"ok"}`.
- **Error**: `{"error":"<string>"}` with **no** `result` key. `Content-Type: application/json` is set on every response (success and error).

### Error taxonomy

Exactly one unexported function — `writeError` — maps errors to `(status, message)`. It is the **only** place an error string meets a status code; raw errors, wrapped causes, stack traces, and file paths never reach the response body.

| Status | `error` string | Trigger |
|--------|----------------|---------|
| `400` | `invalid input` | non-`application/json`/absent `Content-Type`, malformed JSON, empty body, trailing data, missing/`null`/wrong-typed `a`/`b`, non-finite input, body > 1 KiB |
| `405` | `method not allowed` | wrong HTTP method on `/evaluate` or `/health` |
| `422` | `division by zero` | `divide` with `b == 0` (including `-0.0`) |
| `422` | `invalid operation` | unknown/empty `operation` (including `power`, `sqrt`, `percent`) |
| `422` | `non-finite result` | result overflows to `±Inf`/`NaN` (e.g. `multiply(1e308, 1e308)`) |
| `500` | `internal error` | panic recovery / unexpected error |

> `square root of negative number` is in the `api-contract` vocabulary but is **unreachable** here — there is no `sqrt` operation — and is never emitted.

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

# divide by zero → 422 {"error":"division by zero"}
curl -i -X POST http://localhost:8080/evaluate \
  -H 'Content-Type: application/json' \
  -d '{"operation":"divide","a":5,"b":0}'

# unknown operation → 422 {"error":"invalid operation"}
curl -i -X POST http://localhost:8080/evaluate \
  -H 'Content-Type: application/json' \
  -d '{"operation":"power","a":2,"b":3}'

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
- **Sentinel errors over dynamic strings.** `ErrDivideByZero` and `ErrUnknownOperation` are package-level `errors.New` values so callers (the HTTP layer) match with `errors.Is` rather than string comparison.
- **Pure, stateless domain, separated from HTTP.** The `calc` package has no mutable package-level state, no I/O, no goroutines, and imports no `net/http`; the single exported function is a pure function of its arguments. The HTTP boundary (`internal/httpapi` + `cmd/`) is a separate layer that delegates all arithmetic to it.
- **IEEE-754 pass-through for non-finite operands in the domain.** `Evaluate` does not add a non-finite-operand error; `NaN`/`±Inf` flow through with standard float semantics. The *HTTP layer* owns finiteness: it rejects non-finite input (`400 invalid input`) and non-finite results (`422 non-finite result`), because the `api-contract` error taxonomy requires both rows.
- **Explicit zero-divisor guard.** `divide` checks `b == 0` and returns `ErrDivideByZero` rather than relying on Go's `±Inf`/`NaN` behavior; `-0.0` is treated as zero (the single `b == 0` check suffices because `+0.0 == -0.0`).
- **Normalization in one place.** Trim + case-fold + `switch` guarantees exactly four accepted operation names and no aliases.
- **Single `errors.Is` → status mapper.** All error→(status, string) translation lives in one unexported `writeError` method — the only place error strings meet status codes. Handlers and the recovery middleware pass a sentinel (or a wrapped decode error) to it and never choose a status code themselves.
- **Plain-path routing with in-handler method enforcement.** Routes are registered as plain `/evaluate` and `/health` patterns (no Go 1.22 method patterns, no third-party router), so a wrong method is caught inside the handler and returns a JSON `405 {"error":"method not allowed"}` instead of the mux's default text 405.
- **`mime.ParseMediaType` Content-Type gate.** The `Content-Type` is parsed and must equal `application/json` (case-insensitive; a `charset` parameter is allowed) *before* any body decode; absent/malformed/other → `400 invalid input`.
- **`http.MaxBytesReader` 1 KiB cap.** The body is capped at 1024 bytes (inclusive); overflow surfaces as `*http.MaxBytesError`, wrapped with `fmt.Errorf("%w: %w", errInvalidInput, err)` so both the HTTP sentinel and the real cause flow through the same mapper to `400 invalid input`.
- **Pointer-field decode.** `a` and `b` decode into `*float64` so a missing or explicit `null` operand is distinguishable from a legitimate `0` (missing/`null` → `400 invalid input`).
- **Non-finite input/result handling.** Non-finite `a`/`b` → `400 invalid input` (a defensive post-decode backstop, since standard JSON cannot express `NaN`/`Inf` and overflowing literals fail in the decoder); a non-finite *result* → `422 non-finite result` (genuinely reachable, e.g. `multiply(1e308, 1e308)`).
- **Panic recovery with server-side-only logging.** A recovery middleware wraps the whole mux: on panic it logs the panic value plus `runtime/debug.Stack()` at error level and returns `500 {"error":"internal error"}` — the panic detail never leaks into the response body.
- **Four-operation scope (documented skill drift).** The HTTP layer ships exactly `add`/`subtract`/`multiply`/`divide`, because `internal/calc` implements only those four and the feature request placed `power`/`sqrt`/`percent` out of scope. This is a known, intentional drift from the `api-contract` skill, whose prose still says "all seven operations are in scope" — see PRD `docs/opencode/prds/http-api-layer.md` (§2.1, R-1). Naming `power`/`sqrt`/`percent` returns `422 invalid operation` (they are simply unknown to the domain); no special-casing is added for them.

## North star

The REST API is governed by the `api-contract` skill (`.opencode/skills/api-contract/SKILL.md`). Both endpoints are now **built and verified**:

- `POST /evaluate` — evaluate a single arithmetic operation. ✅ built
- `GET /health` — liveness check. ✅ built

The error mapping from the domain's sentinel errors is implemented in the single `writeError` mapper: `ErrDivideByZero` → `422 {"error":"division by zero"}`, `ErrUnknownOperation` → `422 {"error":"invalid operation"}` (the mapper, not the sentinel's `"unknown operation"` message, populates the body). The remaining north-star items — the React frontend that validates and formats only (never performs arithmetic) and the Docker packaging — are later phases, not yet present.

## Testing & coverage

- Domain tests (`backend/internal/calc/calc_test.go`) are **table-driven** (`t.Run` per case) and assert **both** the returned value and the returned error via `errors.Is`; a concurrency test exercises overlapping `Evaluate` calls, run under the `-race` detector.
- HTTP tests (`backend/internal/httpapi/httpapi_test.go`) drive `NewHandler` end-to-end through `net/http/httptest`, asserting **status code + envelope shape (key presence/absence) + exact decoded value** — never raw bytes. They cover all four operations, the full error taxonomy (400/405/422/500 rows), the `Content-Type` gate (absent, other, malformed, `charset`, case-insensitive), the 1 KiB body cap (boundary included), wrong methods on both routes, unknown paths, panic recovery, and the mapper default.
- `make backend-test` runs `go test -race ./...`; `make backend-cover` reports **100% statement coverage** for `internal/calc` and **97.0%** for `internal/httpapi`. The single uncovered statement in `internal/httpapi` is the defensive non-finite-input backstop in `evaluateHandler` (93.3% per-function) — unreachable over the wire because JSON cannot express `NaN`/`Inf` and overflowing literals fail in the decoder. `cmd/server/main.go` has no tests by design (`main()` shows 0.0%): it is thin wiring only, with no business logic.
- See [`docs/ai/coverage-summary.md`](docs/ai/coverage-summary.md) for the full per-function breakdown.

## AI-assisted development

This feature was delivered through a multi-agent pipeline (PRD → plan → plan review → implementation → verification → docs). The curated prompt trail lives in [`PROMPTS.md`](PROMPTS.md); the complete raw log is [`docs/ai/prompt-log.md`](docs/ai/prompt-log.md).
