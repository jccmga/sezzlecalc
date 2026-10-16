# PRD: HTTP API Layer (`internal/httpapi` + `cmd/server`)

- **Status:** Resolved — all 12 tension points decided; ready for design/planning
- **Owner:** Backend / TPM
- **Source of truth:** `.opencode/skills/api-contract/SKILL.md` (endpoints, shapes, error strings)
- **Related conventions:** `.opencode/skills/go-http-service/SKILL.md`
- **Depends on:** `internal/calc` (`docs/opencode/prds/calc-domain-package.md`)
- **Repo:** `sezzlecalc` (Go backend + React/Vite/TS frontend)
- **Scope level:** Backend HTTP layer + process entrypoint only. No frontend, no domain changes.

---

## 1. Goal

Deliver the HTTP layer that implements the `api-contract` skill for the operations the
domain actually provides, plus the process entrypoint that serves it.

Concretely:

- A new package `internal/httpapi` that owns encoding/decoding, routing, method
  enforcement, the request `Content-Type` check, the body cap, panic recovery, and
  **the single `errors.Is` → HTTP status mapper** for the whole service.
- A thin `cmd/server/main.go` that wires configuration, constructs the handler,
  sets server timeouts, and starts an `http.Server` on `:8080`. It contains **no
  business logic**.
- `internal/calc` is consumed **as-is** and is not modified.
- The wire surface is exactly: `POST /evaluate` with `{"operation","a","b"}` →
  `200 {"result": <number>}`, and `GET /health` → `200 {"status":"ok"}`, with the
  error taxonomy of the `api-contract` skill.

The layer must be **thin**: it validates transport-level concerns and delegates all
arithmetic to `calc.Evaluate`. The one deliberate "domain-ish" check the HTTP layer
performs is the contract-mandated non-finite-result check (§3.8), which is a single
predicate over the value `calc.Evaluate` already returned.

### 1.1 Non-goals (explicitly out of scope)

| # | Out of scope | Note |
|---|--------------|------|
| NG-1 | `power`, `sqrt`, `percent` operations | Request explicitly excludes them; domain implements only `add`/`subtract`/`multiply`/`divide` |
| NG-2 | `square root of negative number` error path | Only reachable via `sqrt` (NG-1); string stays in the contract but is unreachable here |
| NG-3 | CORS middleware | Explicitly out of scope |
| NG-4 | Frontend changes (React/Vite/TS) | The frontend does not yet exist in this worktree |
| NG-5 | `internal/calc` changes | Domain is frozen for this feature |
| NG-6 | Persistence, auth, i18n, CI/CD, observability, rate limiting | Repo-wide out of scope |
| NG-7 | JSON 404 body for unknown paths | Unknown paths keep the stdlib default `404 page not found` (see §3.5) |
| NG-8 | Graceful shutdown / signal handling | Not requested; `ListenAndServe` + fatal on error is sufficient |
| NG-9 | Config via flags/env | Port is the fixed constant `:8080` per the request |
| NG-10 | Compression, request tracing, metrics | Repo-wide out of scope |

---

## 2. Background & current state

- Module `sezzlecalc/backend` (`backend/go.mod`, `go 1.22`, no `toolchain` line).
  Dependencies already present: `github.com/stretchr/testify v1.12.1` (test-only) and
  `go.yaml.in/yaml/v3` (indirect). `backend/go.sum` exists.
- `internal/calc/calc.go` exports:
  - `func Evaluate(operation string, a, b float64) (float64, error)` — trims
    whitespace and case-folds `operation`; supports exactly `add`, `subtract`,
    `multiply`, `divide`.
  - `var ErrDivideByZero = errors.New("division by zero")` (returned when
    `b == 0`, covering `+0.0` and `-0.0`).
  - `var ErrUnknownOperation = errors.New("unknown operation")` (any other op).
  - Non-finite operands pass through with IEEE-754 semantics; the domain does **not**
    validate operand finiteness and does **not** emit a non-finite-result error.
- `backend/internal/calc/calc_test.go` passes.
- **There is no `internal/httpapi`, no `cmd/`, and no `main.go` yet.**
- Root `Makefile` gates (all backend gates run from within `backend/`):
  - `make backend-build` → `go build ./...`
  - `make backend-test` → `go test -race ./...`
  - `make backend-vet` → `go vet ./...` + `gofmt -l .` empty
  - `make backend-cover` → `go test -coverprofile=coverage.txt ./...`
- The `go-http-service` skill mandates: thin `main.go`, `internal/httpapi` owning
  encoding/decoding + the error contract, sentinel errors matched with `errors.Is`
  in one place, never leaking raw errors, and table-driven `httptest` tests asserting
  status + envelope + value.

### 2.1 Known contract vs. request conflict (resolved, see §8)

The `api-contract` skill states "All seven operations are in scope", while the feature
request explicitly places `power`, `sqrt`, and `percentage` **out of scope** and
`internal/calc` implements only four. The request is the governing instruction for
this feature. **This HTTP layer exposes exactly `add`, `subtract`, `multiply`,
`divide`.** See R-1 for the documentation-sync consequence.

Additionally, the `go-http-service` skill's *illustrative* envelope
(`{"result": ..., "error": ""}`) differs from the `api-contract` envelope (success =
`{"result": <number>}`; error = `{"error":"<string>"}` with **no** `result` field).
The `api-contract` skill is the source of truth for response shapes, so this PRD
follows it exactly (§3.6). See R-2.

---

## 3. Functional requirements

### 3.1 Routing surface (plain paths, method enforced in-handler)

`internal/httpapi` constructs a stdlib `http.ServeMux` and registers **plain path
patterns only**:

```
mux.HandleFunc("/evaluate", evaluateHandler)
mux.HandleFunc("/health",   healthHandler)
```

- **Do not** use Go 1.22 method patterns (`"POST /evaluate"`) and do not use a
  third-party router. The request requires plain paths with method enforcement inside
  the handler so wrong methods produce a **JSON** 405 instead of the mux's default
  405 text response.
- A missing path (anything other than `/evaluate` or `/health`) yields the stdlib
  default 404. No JSON 404 is added (NG-7).

### 3.2 Package surface (`internal/httpapi`)

The package exports exactly one constructor:

```go
// Package httpapi provides the calculator HTTP handlers and error mapping.
package httpapi

func NewHandler(logger *slog.Logger) http.Handler
```

- `NewHandler` builds the mux, registers both routes, wraps the mux in panic-recovery
  middleware, and returns the fully-wired `http.Handler`.
- A `nil` logger defaults to `slog.Default()`; `NewHandler(nil)` must not panic.
- Everything else (handlers, request/response types, the mapper, sentinels) is
  unexported. The only required exported symbol is `NewHandler`.
- The package imports only the standard library plus
  `sezzlecalc/backend/internal/calc`. Tests add `testify`.

### 3.3 `POST /evaluate` handling order (authoritative)

The handler performs checks in exactly this order so that multi-fault requests have a
deterministic response:

1. **Method check.** `r.Method != http.MethodPost` → map `errMethodNotAllowed` →
   `405 {"error":"method not allowed"}`. Stop. (No body is read.)
2. **Content-Type check** (§3.4). Failure → `400 {"error":"invalid input"}`. Stop.
3. **Body cap** (§3.5): `r.Body = http.MaxBytesReader(w, r.Body, 1024)`.
4. **Decode** (§3.6) into the request struct; any decode error (syntax, type, empty
   body, trailing data, `*http.MaxBytesError`) → `400 {"error":"invalid input"}`.
   Stop. The underlying error is preserved for server-side logging.
5. **Operand presence.** Both `a` and `b` are required for all four in-scope
   operations; a missing **or explicit `null`** operand → `400 invalid input`. Stop.
6. **Operand finiteness** (§3.8). Non-finite `a` or `b` → `400 invalid input`. Stop.
7. **Evaluate.** `result, err := calc.Evaluate(req.Operation, *req.A, *req.B)`; call
   the mapper with `err` (§3.7).
8. **Result finiteness** (§3.8). If the result is `±Inf`/`NaN` → map
   `errNonFiniteResult` → `422 {"error":"non-finite result"}`.
9. **Success.** Write `200 {"result": <number>}`.

> Missing `operation` decodes to `""`, which `calc.Evaluate` normalizes to
> `ErrUnknownOperation` → `422 {"error":"invalid operation"}`. This is intentional and
> contract-consistent: the 400 "missing operand" row concerns the numeric operands
> `a`/`b`, while an empty/unknown operation string is the `invalid operation` row.

### 3.4 Content-Type validation (before any body decode)

Validated with `mime.ParseMediaType(r.Header.Get("Content-Type"))`.

- Accept **iff** the parsed media type equals `application/json` (case-insensitive;
  `mime.ParseMediaType` lowercases it).
- Parameters are allowed and ignored, e.g. `application/json; charset=utf-8` is
  accepted.
- **Absent Content-Type header** (`""`) is treated as "anything other than
  `application/json`" → `400 invalid input`. `mime.ParseMediaType("")` returns an
  error → 400.
- Malformed Content-Type → `400 invalid input`.
- Any other media type (`text/plain`, `application/xml`, `application/json-patch+json`,
  …) → `400 invalid input`.
- The check occurs **before** the body is wrapped and **before** any decode, so a
  rejected request never has its body parsed.

### 3.5 Body cap

- Wrap the request body with `http.MaxBytesReader(w, r.Body, 1024)` (1 KiB) before
  decoding.
- Bodies larger than 1024 bytes cause the decode to fail with `*http.MaxBytesError`;
  the handler maps that to `400 {"error":"invalid input"}` **through the same mapper**
  (§3.7), by wrapping: `fmt.Errorf("%w: %w", errInvalidInput, err)` (double `%w` keeps
  both the HTTP sentinel and the real cause, the latter for logs only).
- All decode errors map to `400 invalid input` regardless of concrete type; the
  `*http.MaxBytesError` check (`errors.As`) is used to keep the cause explicit for
  logging. The limit is inclusive at 1024 bytes; 1025+ is rejected.

### 3.6 Request/response shapes (exact)

Request (both `a` and `b` required for the four in-scope ops):

```json
{ "operation": "add", "a": 1.5, "b": 2.5 }
```

Decode target (pointers distinguish "missing/null" from a legitimate `0`):

```go
type evaluateRequest struct {
    Operation string   `json:"operation"`
    A         *float64 `json:"a"`
    B         *float64 `json:"b"`
}
```

- Unknown JSON fields are **ignored** (`DisallowUnknownFields` is not used) to keep
  the layer thin and forward-compatible.
- Decoding uses a `json.Decoder`; after the first value decodes successfully, a further
  `dec.Token()` must return `io.EOF`. Trailing non-whitespace data → `400 invalid input`.
- An empty body (`io.EOF` on first decode) → `400 invalid input`.

Response envelopes (two distinct structures, per `api-contract`):

```go
type evaluateResponse struct { Result float64 `json:"result"` }
type errorResponse    struct { Error  string  `json:"error"`  }
```

- Success body is exactly `{"result": <number>}` — no `error` key.
- Error body is exactly `{"error":"<fixed string>"}` — **no `result` key**.
- `Content-Type: application/json` is set on **every** response (success and error).
- `GET /health` returns `200 {"status":"ok"}` (a third shape, per contract), with
  `Content-Type: application/json`.
- Numbers are encoded by `encoding/json`'s default `float64` formatter (e.g. `4.0`
  marshals as `4`). Tests must assert the **decoded numeric value**, not exact bytes.

### 3.7 The single error mapper (the only place error strings meet status codes)

One unexported function is the sole mapping point. Every handler and the panic
middleware route errors through it:

```go
// writeError writes the (status, client-safe message) mapped from err and logs err
// server-side. It is the only place error values are translated to status codes and
// client-facing strings.
func (s *server) writeError(w http.ResponseWriter, err error)
```

Mapping rules (`errors.Is`; checked in this order):

| `errors.Is(err, …)` | Status | Response `error` string | Origin |
|---------------------|--------|-------------------------|--------|
| `errInvalidInput` (local) | `400` | `invalid input` | Request Content-Type, decode, body cap, missing/null operand, non-finite operand |
| `calc.ErrDivideByZero` | `422` | `division by zero` | Domain |
| `calc.ErrUnknownOperation` | `422` | `invalid operation` | Domain |
| `errNonFiniteResult` (local) | `422` | `non-finite result` | HTTP-layer result check |
| `errMethodNotAllowed` (local) | `405` | `method not allowed` | Method enforcement |
| `errInternal` (local) | `500` | `internal error` | Panic recovery / unexpected |
| default (no match) | `500` | `internal error` | Defensive fallback |

- **Critical:** `calc.ErrUnknownOperation` maps to the contract string
  `invalid operation`, **not** the sentinel's own message `unknown operation`. The
  `invalid operation` string originates from `api-contract`. Likewise
  `calc.ErrDivideByZero` happens to match the contract string `division by zero`, but
  the mapper — not the sentinel message — is what populates the body.
- Local sentinels to declare (names are the planner's choice, behavior is fixed):
  `errInvalidInput`, `errNonFiniteResult`, `errMethodNotAllowed`, `errInternal`.
- The mapper logs server-side: `5xx` at error level with the full (wrapped) error;
  `4xx` are expected and need not be logged (debug optional). The client body never
  contains the raw error, a wrapped cause, a stack trace, or a file path.
- `square root of negative number` is in the contract vocabulary but unreachable in
  this feature (NG-1/NG-2); it must not appear in code.

### 3.8 Non-finite input and non-finite result (contract fidelity)

**Non-finite input → `400 invalid input`.** Standard JSON cannot express `NaN`/`Inf`
literals, so all reachable paths are covered:

- Literal `NaN`/`Infinity`/`-Infinity` tokens are invalid JSON → decode error → 400.
- An overflowing numeric literal (e.g. `1e400`) surfaces as a `strconv` range error
  through the decoder → 400.
- As a backstop, after a successful decode the handler checks
  `math.IsNaN(*A) || math.IsInf(*A, 0) || math.IsNaN(*B) || math.IsInf(*B, 0)` and maps
  a hit to `400 invalid input`.

**Non-finite result → `422 non-finite result`.** After `calc.Evaluate` returns
successfully, the handler checks `math.IsNaN(result) || math.IsInf(result, 0)` and, if
true, maps `errNonFiniteResult` → `422 {"error":"non-finite result"}`. This is included
because the contract explicitly lists the row, the domain does not emit it, and it is
a single predicate in the HTTP layer (still "thin"). It is genuinely reachable once
operands are validated finite, e.g. `multiply(1e308, 1e308)` overflows to `+Inf`.

### 3.9 Operations in scope

| Operation | Operands | Delegates to |
|-----------|----------|--------------|
| `add` | `a`, `b` | `calc.Evaluate` |
| `subtract` | `a`, `b` | `calc.Evaluate` |
| `multiply` | `a`, `b` | `calc.Evaluate` |
| `divide` | `a`, `b` | `calc.Evaluate` (422 `division by zero` on `b == 0`, incl. `-0.0`) |

`power`, `sqrt`, `percent` are **not** accepted. A request naming any of them returns
`422 invalid operation` (they are simply unknown to the domain), and no HTTP-layer
special-casing is added for them.

### 3.10 Method enforcement and `GET /health`

- `/evaluate`: only `POST`; any other method → `405 {"error":"method not allowed"}`.
- `/health`: only `GET`; any other method (including `HEAD`) →
  `405 {"error":"method not allowed"}`.
- Exact method matching is required; there is no implicit `HEAD` handling.
- `/health` does **not** read the body and does **not** check `Content-Type`.
- `Allow` header (`POST` / `GET`) may be set on 405s as good practice; it is not part
  of the contract and its presence/absence is not an acceptance criterion.

### 3.11 Panic recovery

- A single recover middleware wraps the whole mux inside `NewHandler`, so both routes
  are covered.
- On panic: log server-side via the injected logger, including the recovered value and
  `runtime/debug.Stack()`, then map `errInternal` → `500 {"error":"internal error"}`.
- The panic value, stack trace, and any internal detail must **never** appear in the
  response body.
- Known limitation: if a handler panics *after* it has already written a status, the
  500 cannot fully replace the prior response. Handlers must not write before they are
  ready to respond; see R-3.

### 3.12 `cmd/server/main.go` responsibilities

Thin wiring only:

- Package `main`, at `backend/cmd/server/main.go`.
- Construct a `*slog.Logger` (e.g. `slog.New(slog.NewTextHandler(os.Stderr, nil))`).
- Construct the handler via `httpapi.NewHandler(logger)`.
- Build `&http.Server` with:
  - `Addr: ":8080"` (fixed constant; no flags/env — NG-9)
  - `Handler: handler`
  - `ReadHeaderTimeout: 5 * time.Second`
  - `ReadTimeout: 10 * time.Second`
  - `WriteTimeout: 10 * time.Second`
  - `IdleTimeout: 60 * time.Second` (recommended)
- Log startup, then `ListenAndServe()`; treat `http.ErrServerClosed` as non-fatal and
  any other error as fatal (`os.Exit(1)` or `log.Fatal`).
- **No business logic:** no `calc.Evaluate` calls, no JSON decoding, no error mapping,
  no routing, no `Content-Type`/body handling.

---

## 4. Expected file layout

Package path is fixed; exact file names inside `internal/httpapi/` are the planner's
choice (a single `httpapi.go`, or split into `handlers.go` / `response.go` /
`middleware.go`):

```
backend/
  go.mod                              # unchanged (module sezzlecalc/backend; go 1.22)
  go.sum                              # unchanged
  cmd/
    server/
      main.go                         # package main: config + http.Server; thin
  internal/
    calc/
      calc.go                         # UNCHANGED
      calc_test.go                    # UNCHANGED
    httpapi/
      httpapi.go                      # NewHandler, routes, handlers, mapper, envelopes, recovery
      httpapi_test.go                 # httptest tests (package httpapi)
```

- No new third-party dependencies; `go.mod`/`go.sum` need no new requires.
- `internal/calc` must not gain any `net/http` import.

---

## 5. Testing requirements

Tests live at `backend/internal/httpapi/httpapi_test.go` in **`package httpapi`**
(white-box) so they can exercise the unexported mapper and the recovery middleware,
and drive `NewHandler` end-to-end through `httptest`.

- Use `net/http/httptest` (`NewRequest` + `NewRecorder`); no sockets.
- Assert **status code**, **envelope shape** (which keys are present), and the **exact
  decoded value** — never merely "did not panic" (per `go-http-service` skill).
- Envelope-shape assertion: decode the body into `map[string]json.RawMessage` and
  assert `result` present / `error` absent on success, and `error` present / `result`
  absent on error.
- Table-driven where practical, one `t.Run` per case; `require`/`assert` from testify.
- Must pass under `go test -race ./...` (via `make backend-test`).

Required cases:

| Area | Cases |
|------|-------|
| Happy paths | `add`, `subtract`, `multiply`, `divide` → 200 with exact `result` (ints, negatives, fractions; e.g. `divide(8,2)=4`, `add(1.5,2.5)=4`) |
| Domain 422 | `divide` with `0`, `-0.0` (runtime-constructed `math.Copysign(0,-1)`; note untyped `-0.0` collapses to `+0.0`) → 422 `division by zero` |
| Unknown op | `mod`, `""`, `"power"`, `"sqrt"`, `"percent"` → 422 `invalid operation` |
| Non-finite result | `multiply(1e308, 1e308)` → 422 `non-finite result` |
| Bad JSON | malformed body → 400 `invalid input`; empty body → 400 |
| Trailing data | valid value + trailing garbage → 400 |
| Missing/null operand | missing `a`; missing `b`; explicit `null` → 400 |
| Wrong type | `"a":"x"` or `"operation":3` → 400 |
| Overflowing literal | `1e400` → 400 `invalid input` |
| Content-Type | absent; `text/plain`; malformed → 400. `application/json; charset=utf-8` → accepted (200) |
| Body cap | body > 1024 bytes → 400 `invalid input` |
| Method | `GET /evaluate` → 405; `POST /health` → 405; body is `{"error":"method not allowed"}` |
| Health | `GET /health` → 200 with `{"status":"ok"}` |
| Malformed path | unknown path → 404 (stdlib default; documented, not part of the error taxonomy) |
| Panic recovery | wrap a panicking handler with the recovery middleware (white-box), drive via `httptest` with a `slog` logger writing to a `bytes.Buffer`: response is 500 `{"error":"internal error"}`, and the buffer contains the panic detail while the response body does **not** |

Quality gates before hand-off: `make backend-build`, `make backend-test` (race),
`make backend-vet` (vet + `gofmt -l .` empty), `make backend-cover`.

---

## 6. Acceptance criteria

Each criterion is verifiable from source and from `go test`/`go vet` output.

### Structure & dependencies

- **AC-M1** — `make backend-build` succeeds, including the new `cmd/server` package.
- **AC-M2** — `internal/httpapi` exists and `cmd/server/main.go` exists; `internal/calc` is unmodified.
- **AC-M3** — No new module dependencies are added; `go.mod`/`go.sum` retain only the existing stdlib usage, testify, and the indirect yaml dependency.
- **AC-S1** — `internal/httpapi` exports `func NewHandler(logger *slog.Logger) http.Handler`; `NewHandler(nil)` does not panic.
- **AC-S2** — `internal/calc` imports no HTTP package and is unchanged; `httpapi` imports only stdlib + `sezzlecalc/backend/internal/calc` (plus testify in tests).
- **AC-S3** — All HTTP error→status mapping happens in exactly one unexported function; no other code maps errors to status codes.

### Routing & methods

- **AC-R1** — Routes are registered as plain paths `/evaluate` and `/health`; no method-pattern strings (e.g. `"POST /evaluate"`) and no third-party router are used.
- **AC-R2** — Any method other than `POST` on `/evaluate` returns `405` with body `{"error":"method not allowed"}`.
- **AC-R3** — Any method other than `GET` on `/health` returns `405` with body `{"error":"method not allowed"}`.
- **AC-R4** — Method enforcement occurs inside the handler and the 405 body is JSON.

### Content-Type

- **AC-CT1** — Content-Type is parsed with `mime.ParseMediaType` before any body decode.
- **AC-CT2** — An absent Content-Type header returns `400 {"error":"invalid input"}`.
- **AC-CT3** — A non-`application/json` media type (e.g. `text/plain`) returns `400 {"error":"invalid input"}` without decoding the body.
- **AC-CT4** — A malformed Content-Type returns `400 {"error":"invalid input"}`.
- **AC-CT5** — `application/json; charset=utf-8` is accepted and processed normally.

### Body cap

- **AC-B1** — The request body is wrapped with `http.MaxBytesReader(w, r.Body, 1024)`.
- **AC-B2** — A body larger than 1024 bytes returns `400 {"error":"invalid input"}` routed through the single mapper.
- **AC-B3** — `*http.MaxBytesError` is detected with `errors.As` so the overflow cause is identifiable for logging.

### Decode & validation

- **AC-V1** — Malformed JSON returns `400 {"error":"invalid input"}`.
- **AC-V2** — An empty body returns `400 {"error":"invalid input"}`.
- **AC-V3** — Trailing non-whitespace data after the JSON value returns `400 {"error":"invalid input"}`.
- **AC-V4** — A missing or explicit-`null` `a` or `b` returns `400 {"error":"invalid input"}`.
- **AC-V5** — A wrong-type `a`/`b`/`operation` returns `400 {"error":"invalid input"}`.
- **AC-V6** — Non-finite input (invalid `NaN`/`Inf` literal, an overflowing literal, or any `±Inf`/`NaN` reaching the decoded struct) returns `400 {"error":"invalid input"}`.

### Functional behavior

- **AC-F1** — `POST /evaluate` with a valid `add`, `subtract`, `multiply`, or `divide` request returns `200` and body `{"result": <value>}` with the exact arithmetic value from `calc.Evaluate`.
- **AC-F2** — `divide` with `b == 0` (including `-0.0`) returns `422 {"error":"division by zero"}`.
- **AC-F3** — An unknown/empty operation string (including `power`, `sqrt`, `percent`) returns `422 {"error":"invalid operation"}`.
- **AC-F4** — A successful evaluation whose result is `±Inf`/`NaN` (e.g. `multiply(1e308, 1e308)`) returns `422 {"error":"non-finite result"}`.
- **AC-F5** — Success bodies contain a `result` key and no `error` key; error bodies contain an `error` key and no `result` key.
- **AC-F6** — `power`, `sqrt`, and `percent` are not implemented and receive no special-casing.
- **AC-F7** — Every response (success and error) sets `Content-Type: application/json`.

### Health

- **AC-H1** — `GET /health` returns `200` with body `{"status":"ok"}`.

### Error mapping

- **AC-E1** — The mapper maps `calc.ErrDivideByZero` → `422 division by zero` and `calc.ErrUnknownOperation` → `422 invalid operation`.
- **AC-E2** — `ErrUnknownOperation`'s client string is `invalid operation`, **not** the sentinel message `unknown operation`.
- **AC-E3** — The mapper returns `400 invalid input`, `405 method not allowed`, `422 non-finite result`, and `500 internal error` for the corresponding local sentinels, and a defensive default of `500 internal error`.
- **AC-E4** — No response body contains a raw error message, wrapped cause, stack trace, or internal path.
- **AC-E5** — The only client-visible error strings are `invalid input`, `division by zero`, `invalid operation`, `non-finite result`, `method not allowed`, and `internal error`. `square root of negative number` is never emitted.

### Panic recovery

- **AC-P1** — A panic in a handler yields `500` with body `{"error":"internal error"}`.
- **AC-P2** — The panic detail (value and stack) is logged server-side and is absent from the response body.
- **AC-P3** — Recovery wraps the whole mux (both routes covered).

### `main.go`

- **AC-C1** — `cmd/server/main.go` sets `Addr` to `:8080` and sets non-zero `ReadHeaderTimeout`, `ReadTimeout`, and `WriteTimeout` on the `http.Server`.
- **AC-C2** — `cmd/server/main.go` contains no business logic: it does not call `calc.Evaluate`, does not decode JSON, does not map errors, and does not define routes.
- **AC-C3** — The handler is constructed via `httpapi.NewHandler(logger)` and a `*slog.Logger` is injected.

### Tests

- **AC-T1** — Tests use `net/http/httptest`, are table-driven, and assert status code + envelope shape + exact value.
- **AC-T2** — Tests pass under `go test -race ./...` (`make backend-test`).
- **AC-T3** — Every reachable row of the error taxonomy is covered: `400 invalid input`, `405 method not allowed`, `422 division by zero`, `422 invalid operation`, `422 non-finite result`, `500 internal error`.
- **AC-T4** — `make backend-vet` passes with `gofmt -l .` empty.

---

## 7. Resolved decisions (the 12 tension points)

| # | Tension | Decision |
|---|---------|----------|
| 1 | Operation set vs. contract's 7 ops | HTTP exposes exactly the 4 domain ops (`add`/`subtract`/`multiply`/`divide`); `power`/`sqrt`/`percent` are out of scope and unhandled beyond `422 invalid operation` (§3.9). |
| 2 | Sentinel message vs. contract string | Mapper is the only translator: `ErrUnknownOperation` → `422 invalid operation` (contract string, not the sentinel's `"unknown operation"`); `ErrDivideByZero` → `422 division by zero` (§3.7). |
| 3 | Non-finite input | Explicit post-decode `math.IsNaN`/`math.IsInf` check on `a` and `b` → `400 invalid input`; invalid/overflowing numeric literals also land on 400 via decode errors (§3.8). |
| 4 | Non-finite result | Included: HTTP layer checks the returned `result` and maps `±Inf`/`NaN` → `422 non-finite result`; single predicate, stays thin (§3.8). |
| 5 | 500 string | Fixed as `internal error`, from panic recovery and any unexpected error; logged server-side only, never leaked (§3.7, §3.11). |
| 6 | 405 string | Fixed as `method not allowed` (§3.7, §3.10). |
| 7 | Content-Type | `mime.ParseMediaType`; only `application/json` accepted; parameters (`charset`) allowed; absent/malformed/other → `400 invalid input` before decode (§3.4). |
| 8 | Body cap | `http.MaxBytesReader(w, r.Body, 1024)`; overflow detected via `*http.MaxBytesError` (`errors.As`) and routed through the same mapper to `400 invalid input` (§3.5). |
| 9 | In-handler method enforcement | Plain-path registration; `POST` required on `/evaluate`, `GET` required on `/health`; every other method → `405 method not allowed` on both (§3.10). |
| 10 | Routing approach | stdlib `http.ServeMux` with plain patterns `/evaluate` and `/health`; no `"POST /evaluate"` patterns, no third-party router (§3.1). |
| 11 | `main.go` responsibilities | Fixed `:8080`, `slog` logger, `httpapi.NewHandler`, `http.Server` with `ReadHeaderTimeout`/`ReadTimeout`/`WriteTimeout`, startup log; no business logic (§3.12). |
| 12 | `internal/httpapi` surface | Single exported `func NewHandler(logger *slog.Logger) http.Handler`; mapper and sentinels unexported; `errors.Is`→status mapping is the sole mapping point (§3.2, §3.7). |

---

## 8. Risks

- **R-1 — Contract drift: the skill advertises 7 operations, the service ships 4 (medium).**
  The `api-contract` skill's "all seven operations are in scope" clause and its `sqrt`
  row are inconsistent with the delivered subset. Mitigation: this PRD records the
  delivered surface explicitly; the frontend must treat `power`/`sqrt`/`percent` as
  unsupported. Recommended follow-up (non-blocking): amend the `api-contract` skill to
  reflect the shipped operation set so the two layers cannot drift.
- **R-2 — Two skill envelopes disagree (low→medium).** The `go-http-service` skill
  illustrates `{"result":..., "error":...}`, while `api-contract` mandates a single-key
  body per outcome. Mitigation: `api-contract` is authoritative; success=result only,
  error=error only; AC-F5 enforces key presence/absence.
- **R-3 — Panic after a write cannot be cleanly replaced (low).** A handler that panics
  after `WriteHeader` cannot produce a clean 500 body. Mitigation: handlers write only
  once they are ready; documented limitation. Tests exercise a panic before any write.
- **R-4 — Non-finite detection depends on decoder behavior (low).** Whether an
  overflowing literal surfaces as a decode error or as `±Inf` is decoder-internal.
  Mitigation: handle both — decode errors → 400, plus the explicit finiteness backstop.
- **R-5 — Missing-vs-zero operand ambiguity (low).** Decoding `a`/`b` into `float64`
  would make a missing operand indistinguishable from `0`. Mitigation: pointer fields;
  missing and explicit `null` both → `400 invalid input`.
- **R-6 — Envelope/value assertion pitfalls (low).** `float64` marshaling renders
  `4.0` as `4`. Mitigation: tests assert decoded numeric values and key presence, not
  raw body bytes.

---

## 9. Open questions

None blocking. Every one of the 12 tension points is decided above. The only
human-facing follow-up is the non-blocking documentation sync in R-1 (whether to amend
the `api-contract` skill's operation table to the shipped four-operation set); it does
not block design, planning, or implementation of this feature.

---

## 10. Traceability summary

| Requirement area | Acceptance criteria |
|------------------|---------------------|
| Structure & dependencies | AC-M1 … AC-M3, AC-S1 … AC-S3 |
| Routing & method enforcement | AC-R1 … AC-R4 |
| Content-Type validation | AC-CT1 … AC-CT5 |
| Body cap | AC-B1 … AC-B3 |
| Decode & input validation | AC-V1 … AC-V6 |
| Functional behavior (ops, envelopes, headers) | AC-F1 … AC-F7 |
| Health endpoint | AC-H1 |
| Error mapping table | AC-E1 … AC-E5 |
| Panic recovery | AC-P1 … AC-P3 |
| `cmd/server` wiring | AC-C1 … AC-C3 |
| Tests & quality gates | AC-T1 … AC-T4 |

### Contract coverage cross-check

| Contract row | Handled by |
|--------------|------------|
| `200 {"result": <number>}` | AC-F1, AC-F5, AC-F7 |
| `200 {"status":"ok"}` (`/health`) | AC-H1 |
| `400 invalid input` | AC-CT2…AC-CT5, AC-B2, AC-V1…AC-V6 |
| `422 division by zero` | AC-F2 |
| `422 invalid operation` | AC-F3 |
| `422 non-finite result` | AC-F4 |
| `422 square root of negative number` | NG-1/NG-2 — out of scope, never emitted (AC-E5) |
| `405 method not allowed` (request-defined) | AC-R2, AC-R3 |
| `500 internal error` (request-defined) | AC-P1, AC-P2, AC-E3 |
