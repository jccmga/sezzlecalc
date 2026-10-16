# Plan: HTTP API Layer (`internal/httpapi` + `cmd/server`)

- **PRD:** `docs/opencode/prds/http-api-layer.md` (single source of truth; all 12 tension points resolved)
- **Contract:** `.opencode/skills/api-contract/SKILL.md` (endpoints, shapes, error strings)
- **Conventions:** `.opencode/skills/go-http-service/SKILL.md`
- **Depends on:** `internal/calc` (frozen; consumed as-is)
- **Repo root (isolated worktree, already active):** `/Users/juancamilocortesmedina/workspace/sezzlecalc-worktrees/http-layer`
- **Scope:** Backend HTTP layer + process entrypoint only. No frontend, no domain changes.

---

## 1. Context & Goals

### Context

The backend currently contains only the pure domain package `internal/calc` (verified: `glob backend/**/*.go` → `internal/calc/calc.go`, `internal/calc/calc_test.go`; `backend/go.mod` → `module sezzlecalc/backend`, `go 1.22`, requires `testify v1.12.1` + indirect `go.yaml.in/yaml/v3`; `backend/go.sum` present). There is **no `internal/httpapi`, no `cmd/`, no `main.go`** yet.

`internal/calc` exports:

- `func Evaluate(operation string, a, b float64) (float64, error)` — trims/case-folds `operation`, supports exactly `add`, `subtract`, `multiply`, `divide`.
- `var ErrDivideByZero = errors.New("division by zero")`
- `var ErrUnknownOperation = errors.New("unknown operation")`

The root `Makefile` already gates the backend (`make backend-build` / `-test` / `-vet` / `-cover`, all run `cd backend && go …`). This feature delivers the transport layer that wraps the domain, plus the process entrypoint.

### Desired outcome

1. `backend/internal/httpapi` with a single exported `func NewHandler(logger *slog.Logger) http.Handler`; `NewHandler(nil)` must not panic (defaults to `slog.Default()`).
2. Stdlib `http.ServeMux` registering **plain paths** `/evaluate` and `/health`; method enforcement inside handlers (`POST` only on `/evaluate`, `GET` only on `/health`), wrong method → JSON `405 {"error":"method not allowed"}`.
3. `POST /evaluate` implements the exact handling order of PRD §3.3: method → Content-Type → body cap → decode → operand presence → operand finiteness → `calc.Evaluate` → result finiteness → success.
4. A single unexported error→(status, string) mapper (`writeError`) implementing PRD §3.7 exactly, plus panic-recovery middleware wrapping the whole mux.
5. `backend/cmd/server/main.go` (package `main`) with `slog` logger, `httpapi.NewHandler(logger)`, an `http.Server` with the specified timeouts on `:8080`, and no business logic.
6. All four Makefile backend gates pass from a clean checkout, including under `-race`.

### Non-goals (explicit)

- **NG-1** — `power`, `sqrt`, `percent` are not implemented and receive no special-casing (they fall through to `422 invalid operation`).
- **NG-2** — `square root of negative number` error path is unreachable and must never be emitted (PRD AC-E5).
- **NG-3** — CORS middleware; NG-4 — frontend changes; NG-5 — `internal/calc` changes (frozen).
- **NG-6** — persistence, auth, i18n, CI/CD, observability, rate limiting (repo-wide out of scope).
- **NG-7** — JSON 404 body for unknown paths; unknown paths keep the stdlib default `404 page not found`.
- **NG-8** — graceful shutdown / signal handling (`ListenAndServe` + fatal on error is sufficient); **NG-9** — config via flags/env (port is the fixed constant `:8080`); **NG-10** — compression, tracing, metrics.

---

## 2. Approach

**Design.** A single-file package `internal/httpapi` (import path `sezzlecalc/backend/internal/httpapi`) holding the handler constructor, both handlers, the request/response structs, the four local sentinel errors, the one error→status mapper, and the recovery middleware. The package exposes exactly one symbol — `NewHandler` — and imports only stdlib + `sezzlecalc/backend/internal/calc`. A thin `cmd/server/main.go` wires the logger, handler, and `http.Server` timeouts.

`NewHandler` builds a `server{logger}` struct (defaulting a nil logger to `slog.Default()`), registers `/evaluate` and `/health` on a `http.ServeMux` using **plain path patterns** (no Go 1.22 `"POST /evaluate"` patterns, no third-party router), and returns `s.recover(mux)` so the recovery middleware wraps both routes. The `server` type carries the logger so it is available to the mapper and the recovery middleware; it is unexported (only `NewHandler` is exported, per PRD §3.2).

**Single mapping point.** All error→status/string translation lives in one unexported method `(*server).writeError(w, err)`. The handler and recovery middleware never choose a status code themselves — they pass a sentinel (or a wrapped decode error) to `writeError`, which runs the ordered `errors.Is` switch of PRD §3.7 and then calls a small `writeJSON` helper. `writeJSON` sets `Content-Type: application/json` before `WriteHeader` and encodes via `json.NewEncoder`. This is the *only* place `Content-Type` + status + body come together, satisfying AC-S3 and AC-F7.

**Handling order (PRD §3.3) as code.** The `evaluateHandler` is a linear sequence of early returns, each calling `s.writeError` with the appropriate sentinel:

1. `r.Method != POST` → `errMethodNotAllowed` (405). No body read.
2. `mime.ParseMediaType(r.Header.Get("Content-Type"))`; fail or `mediatype != "application/json"` → `errInvalidInput` (400). Absent header parses to error (`mime.ParseMediaType("")` errors), so "absent" and "other" collapse naturally.
3. `r.Body = http.MaxBytesReader(w, r.Body, 1024)` (1 KiB, inclusive).
4. `json.NewDecoder(r.Body).Decode(&req)`; on error, wrap `fmt.Errorf("%w: %w", errInvalidInput, err)` so both the HTTP sentinel and the real cause are preserved (double `%w`; Go ≥ 1.20). Then a further `dec.Token()` must return `io.EOF` (trailing data → 400). Empty body → `io.EOF` on first `Decode` → 400.
5. `req.A == nil || req.B == nil` → `errInvalidInput` (400). Pointer fields distinguish missing/`null` from a legitimate `0`.
6. `math.IsNaN/IsInf` backstop on `*req.A`/`*req.B` → `errInvalidInput` (400). Defensive (standard JSON cannot produce NaN/Inf), kept per PRD §3.8 / R-4.
7. `calc.Evaluate(req.Operation, *req.A, *req.B)`; error → `s.writeError(w, err)` (maps `ErrDivideByZero`→422 `division by zero`, `ErrUnknownOperation`→422 `invalid operation`).
8. `math.IsNaN/IsInf(result)` → `errNonFiniteResult` (422 `non-finite result`).
9. Success → `writeJSON(w, 200, evaluateResponse{result})`.

**Panic recovery.** `(*server).recover(next)` defers a `recover()` that logs the panic value plus `runtime/debug.Stack()` at error level and then calls `s.writeError(w, errInternal)` → `500 {"error":"internal error"}`. The panic detail and stack are logged, never written to the body. Known limitation (PRD R-3): a panic *after* a prior `WriteHeader` cannot be cleanly replaced; handlers are structured to write once only.

### Alternatives considered and rejected

- **Go 1.22 method patterns (`mux.HandleFunc("POST /evaluate", …)`).** Rejected: the PRD (R/AC-R1) requires plain-path registration with in-handler method enforcement so wrong methods yield a **JSON** 405 rather than the mux's default text 405.
- **Third-party router (chi, gorilla/mux, gin).** Rejected: stdlib `ServeMux` is sufficient for two plain paths and keeps the module dependency-free (AC-M3).
- **Rejecting requests by Content-Type via string `==` comparison.** Rejected: `mime.ParseMediaType` is required (AC-CT1) and gives correct case-insensitivity plus parameter tolerance (`application/json; charset=utf-8`).
- **A `Service`/`Handler` struct exported from `httpapi`.** Rejected: PRD §3.2 fixes the surface to exactly `func NewHandler(logger *slog.Logger) http.Handler`; the internal `server` struct carries the logger but stays unexported.
- **Re-using `calc.ErrUnknownOperation`'s own message (`"unknown operation"`) in the 422 body.** Rejected: the mapper must emit the contract string `invalid operation` (AC-E2). The sentinel is matched with `errors.Is`, never string-matched.
- **Mapping errors in a separate `statusFor` helper.** Rejected for AC-S3 literalness: PRD §3.7 names `writeError` as "the only place error strings meet status codes"; the switch lives inside `writeError` itself so there is exactly one mapping function.
- **Skipping the non-finite result check.** Rejected: the contract lists `422 non-finite result`, the domain does not emit it, and it is reachable once operands are finite (e.g. `multiply(1e308, 1e308)` → `+Inf`). One predicate in the HTTP layer keeps it thin (PRD §3.8, R-4).
- **Setting `DisallowUnknownFields`.** Rejected: unknown JSON fields are ignored to keep the layer thin and forward-compatible (PRD §3.6).

---

## 3. File-by-file changes

### New files

| # | Path | One-line description |
|---|------|----------------------|
| 1 | `backend/internal/httpapi/httpapi.go` | Package `httpapi`: `NewHandler`, handlers, envelopes, sentinels, single mapper `writeError`, recovery middleware. |
| 2 | `backend/cmd/server/main.go` | Package `main`: `slog` logger, `httpapi.NewHandler`, `http.Server` timeouts, `ListenAndServe`; thin. |
| 3 | `backend/internal/httpapi/httpapi_test.go` | White-box (`package httpapi`) `httptest` tests: status + envelope shape + exact value, plus panic-recovery and mapper tests. |

### Modified files

None.

### Deleted files

None.

### Explicitly UNCHANGED

- `backend/go.mod` — still `module sezzlecalc/backend`, `go 1.22`, requires only `testify v1.12.1` + indirect `go.yaml.in/yaml/v3`. **No new requires.**
- `backend/go.sum` — unchanged (no new transitive sums; testify/yaml already present).
- `backend/internal/calc/calc.go`, `backend/internal/calc/calc_test.go` — **frozen**; no `net/http` import may be added (AC-S2).

---

### File 1 — `backend/internal/httpapi/httpapi.go`

Package doc + stdlib imports + `calc`. Exact shape (single file; names are the planner's choice per PRD §4, behavior is fixed):

```go
// Package httpapi provides the calculator HTTP handlers, request/response
// types, panic recovery, and the single error-to-status mapper.
//
// NewHandler is the only exported symbol. It builds the routing surface
// (POST /evaluate and GET /health), wraps it in panic recovery, and returns
// the fully wired http.Handler.
package httpapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math"
	"mime"
	"net/http"
	"runtime/debug"

	"sezzlecalc/backend/internal/calc"
)

// maxBodyBytes caps the JSON request body at 1 KiB (inclusive: 1024 ok, 1025+ rejected).
const maxBodyBytes = 1024

// Local sentinel errors, matched with errors.Is in writeError only. They carry
// the client-safe meaning; writeError is the sole place a status code and
// client string are chosen.
var (
	errInvalidInput     = errors.New("invalid input")
	errNonFiniteResult  = errors.New("non-finite result")
	errMethodNotAllowed = errors.New("method not allowed")
	errInternal         = errors.New("internal error")
)

// server carries the injected logger used for server-side error reporting.
type server struct {
	logger *slog.Logger
}

// NewHandler builds the calculator HTTP handler. A nil logger falls back to
// slog.Default(); NewHandler(nil) must not panic.
func NewHandler(logger *slog.Logger) http.Handler {
	if logger == nil {
		logger = slog.Default()
	}
	s := &server{logger: logger}

	mux := http.NewServeMux()
	mux.HandleFunc("/evaluate", s.evaluateHandler)
	mux.HandleFunc("/health", s.healthHandler)

	return s.recover(mux)
}

// evaluateRequest is the POST /evaluate request body. A and B are pointers so
// a missing or explicit null operand is distinguishable from a legitimate 0.
type evaluateRequest struct {
	Operation string   `json:"operation"`
	A         *float64 `json:"a"`
	B         *float64 `json:"b"`
}

type evaluateResponse struct {
	Result float64 `json:"result"`
}

type errorResponse struct {
	Error string `json:"error"`
}

type healthResponse struct {
	Status string `json:"status"`
}

// evaluateHandler implements POST /evaluate. Checks run in a fixed order
// (PRD §3.3): method, Content-Type, body cap, decode, operand presence,
// operand finiteness, calc.Evaluate, result finiteness, success.
func (s *server) evaluateHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		s.writeError(w, errMethodNotAllowed)
		return
	}

	mediatype, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || mediatype != "application/json" {
		s.writeError(w, errInvalidInput)
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)

	dec := json.NewDecoder(r.Body)
	var req evaluateRequest
	if err := dec.Decode(&req); err != nil {
		s.writeError(w, fmt.Errorf("%w: %w", errInvalidInput, err))
		return
	}
	if _, err := dec.Token(); err != io.EOF {
		s.writeError(w, fmt.Errorf("%w: trailing data", errInvalidInput))
		return
	}

	if req.A == nil || req.B == nil {
		s.writeError(w, errInvalidInput)
		return
	}

	if math.IsNaN(*req.A) || math.IsInf(*req.A, 0) || math.IsNaN(*req.B) || math.IsInf(*req.B, 0) {
		s.writeError(w, errInvalidInput)
		return
	}

	result, err := calc.Evaluate(req.Operation, *req.A, *req.B)
	if err != nil {
		s.writeError(w, err)
		return
	}

	if math.IsNaN(result) || math.IsInf(result, 0) {
		s.writeError(w, errNonFiniteResult)
		return
	}

	writeJSON(w, http.StatusOK, evaluateResponse{Result: result})
}

// healthHandler implements GET /health. It reads no body and checks no
// Content-Type.
func (s *server) healthHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		s.writeError(w, errMethodNotAllowed)
		return
	}
	writeJSON(w, http.StatusOK, healthResponse{Status: "ok"})
}

// writeError is the ONLY place an error is translated to a status code and a
// client-safe string. It logs 5xx server-side at error level and 4xx at debug
// level (identifying *http.MaxBytesError via errors.As); the client body never
// contains the raw error, a wrapped cause, a stack trace, or a file path.
func (s *server) writeError(w http.ResponseWriter, err error) {
	var status int
	var message string

	switch {
	case errors.Is(err, errInvalidInput):
		status, message = http.StatusBadRequest, "invalid input"
	case errors.Is(err, calc.ErrDivideByZero):
		status, message = http.StatusUnprocessableEntity, "division by zero"
	case errors.Is(err, calc.ErrUnknownOperation):
		status, message = http.StatusUnprocessableEntity, "invalid operation"
	case errors.Is(err, errNonFiniteResult):
		status, message = http.StatusUnprocessableEntity, "non-finite result"
	case errors.Is(err, errMethodNotAllowed):
		status, message = http.StatusMethodNotAllowed, "method not allowed"
	case errors.Is(err, errInternal):
		status, message = http.StatusInternalServerError, "internal error"
	default:
		status, message = http.StatusInternalServerError, "internal error"
	}

	if status >= http.StatusInternalServerError {
		s.logger.Error("request failed", "error", err)
	} else {
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			s.logger.Debug("request body too large", "limit", maxBytesErr.Limit)
		} else {
			s.logger.Debug("invalid request", "error", err)
		}
	}

	writeJSON(w, status, errorResponse{Error: message})
}

// recover wraps next so a panicking handler is logged server-side and the
// client receives a 500 {"error":"internal error"} instead of a dropped
// connection. The panic value and stack are logged but never written to the
// response body.
func (s *server) recover(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				s.logger.Error("panic recovered",
					"panic", rec,
					"stack", string(debug.Stack()))
				s.writeError(w, errInternal)
			}
		}()
		next.ServeHTTP(w, r)
	})
}

// writeJSON sets Content-Type before WriteHeader and encodes v.
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
```

Implementation notes (contract-critical):

- The `errors.Is` switch order matches PRD §3.7 **exactly** — `errInvalidInput` first, then the two domain sentinels, then `errNonFiniteResult`, `errMethodNotAllowed`, `errInternal`, and the defensive default.
- `ErrUnknownOperation` maps to the literal `invalid operation`, **not** `"unknown operation"` (AC-E2). The mapper, not the sentinel message, populates the body.
- The decode wrap `fmt.Errorf("%w: %w", errInvalidInput, err)` keeps both `errors.Is(err, errInvalidInput)` and `errors.As(err, &maxBytesErr)` working through the same chain (AC-B3). Empty body surfaces as `io.EOF` on the first `Decode`, landing in the same wrap → 400 (AC-V2).
- Trailing-data detection uses `dec.Token() != io.EOF` exactly as PRD §3.6 specifies (not `dec.More()`).
- The non-finite input backstop (step 6) is defensive: standard JSON cannot express `NaN`/`Inf` literals (they fail decode) and `1e400` overflows to a `strconv` range error through the decoder; the explicit `math.IsNaN/IsInf` check is the R-4 backstop (AC-V6).
- The `Allow` header on 405s is *optional* (PRD §3.10) and intentionally omitted — not an AC. If added later, set it in the handler before `writeError`, never in the mapper.
- On panic, `writeError(errInternal)` logs a second, generic `"internal error"` line in addition to the recover middleware's rich `"panic recovered"` line. This is intentional (the mapper owns 5xx logging; the middleware owns the panic/stack detail) and harmless.

---

### File 2 — `backend/cmd/server/main.go`

Thin wiring only; no business logic (AC-C2). Exact shape:

```go
// Command server runs the calculator HTTP service on :8080.
package main

import (
	"errors"
	"log/slog"
	"net/http"
	"os"
	"time"

	"sezzlecalc/backend/internal/httpapi"
)

func main() {
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))

	handler := httpapi.NewHandler(logger)

	srv := &http.Server{
		Addr:              ":8080",
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      10 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	logger.Info("calculator server listening", "addr", srv.Addr)

	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		logger.Error("server failed", "error", err)
		os.Exit(1)
	}
}
```

Notes:

- `Addr` is the fixed constant `:8080` (no flags/env — NG-9). `ReadHeaderTimeout`/`ReadTimeout`/`WriteTimeout` are non-zero (AC-C1); `IdleTimeout` is set per PRD §3.12.
- The handler is constructed via `httpapi.NewHandler(logger)` and a `*slog.Logger` is injected (AC-C3).
- No `calc.Evaluate`, no JSON decode, no error mapping, no routing, no `Content-Type`/body handling (AC-C2).
- `http.ErrServerClosed` is treated as non-fatal; any other error logs and exits non-zero.

---

### File 3 — `backend/internal/httpapi/httpapi_test.go`

Same package (`package httpapi`, white-box) so tests can construct `server{logger}` directly and call the unexported `recover` middleware and `writeError`. Imports: `bytes`, `encoding/json`, `errors`, `log/slog`, `math`, `net/http`, `net/http/httptest`, `strings`, `testing`, plus `github.com/stretchr/testify/require` (and `assert` if preferred; `require` is sufficient).

Shared helpers:

```go
// serve drives a handler end-to-end via httptest; setCT controls whether the
// Content-Type header is set (absent vs. empty are the same to Header.Get).
func serve(t *testing.T, h http.Handler, method, path, body string, setCT bool, ct string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	if setCT {
		req.Header.Set("Content-Type", ct)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

// decodeEnvelope decodes the body into raw key→value for shape assertions.
func decodeEnvelope(t *testing.T, rec *httptest.ResponseRecorder) map[string]json.RawMessage {
	t.Helper()
	var env map[string]json.RawMessage
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &env))
	return env
}

// assertErrorBody asserts Content-Type, error-key-present/result-key-absent,
// and the exact error string. Never asserts raw bytes.
func assertErrorBody(t *testing.T, rec *httptest.ResponseRecorder, wantMsg string) {
	t.Helper()
	require.Equal(t, "application/json", rec.Header().Get("Content-Type"))
	env := decodeEnvelope(t, rec)
	require.Contains(t, env, "error")
	require.NotContains(t, env, "result")
	var got errorResponse
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &got))
	require.Equal(t, wantMsg, got.Error)
}
```

Test functions and the cases each must cover:

1. **`TestNewHandlerNilLogger`** (AC-S1) — `require.NotPanics` calling `NewHandler(nil)`, result non-nil.

2. **`TestEvaluate`** — table-driven (AC-T1), one `t.Run` per row, `h := NewHandler(nil)`, method `POST /evaluate` with `Content-Type: application/json`. Rows (wantStatus / wantResult / wantError):

   | name | body | status | result | error |
   |------|------|--------|--------|-------|
   | add/fractional | `{"operation":"add","a":1.5,"b":2.5}` | 200 | 4 | — |
   | subtract | `{"operation":"subtract","a":5,"b":2}` | 200 | 3 | — |
   | multiply | `{"operation":"multiply","a":3,"b":4}` | 200 | 12 | — |
   | divide | `{"operation":"divide","a":8,"b":2}` | 200 | 4 | — |
   | divide/negative-divisor | `{"operation":"divide","a":8,"b":-2}` | 200 | -4 | — |
   | divide/fraction | `{"operation":"divide","a":1,"b":2}` | 200 | 0.5 | — |
   | divide-by-zero/positive | `{"operation":"divide","a":5,"b":0}` | 422 | — | division by zero |
   | unknown/mod | `{"operation":"mod","a":8,"b":2}` | 422 | — | invalid operation |
   | unknown/empty | `{"operation":"","a":8,"b":2}` | 422 | — | invalid operation |
   | unknown/power | `{"operation":"power","a":8,"b":2}` | 422 | — | invalid operation |
   | unknown/sqrt | `{"operation":"sqrt","a":8,"b":2}` | 422 | — | invalid operation |
   | unknown/percent | `{"operation":"percent","a":8,"b":2}` | 422 | — | invalid operation |
   | non-finite/result | `{"operation":"multiply","a":1e308,"b":1e308}` | 422 | — | non-finite result |
   | bad-json | `{"operation":` | 400 | — | invalid input |
   | empty-body | `` | 400 | — | invalid input |
   | trailing-data | `{"operation":"add","a":1,"b":2} extra` | 400 | — | invalid input |
   | missing-a | `{"operation":"add","b":2}` | 400 | — | invalid input |
   | missing-b | `{"operation":"add","a":1}` | 400 | — | invalid input |
   | null-a | `{"operation":"add","a":null,"b":2}` | 400 | — | invalid input |
   | null-b | `{"operation":"add","a":1,"b":null}` | 400 | — | invalid input |
   | wrong-type-a | `{"operation":"add","a":"x","b":2}` | 400 | — | invalid input |
   | wrong-type-operation | `{"operation":3,"a":1,"b":2}` | 400 | — | invalid input |
   | overflow-1e400 | `{"operation":"add","a":1e400,"b":2}` | 400 | — | invalid input |
   | nan-literal | `{"operation":"add","a":NaN,"b":2}` | 400 | — | invalid input |
   | infinity-literal | `{"operation":"add","a":Infinity,"b":2}` | 400 | — | invalid input |

   Each row asserts `rec.Code == wantStatus`, `Content-Type: application/json`, and — via `decodeEnvelope` — `result` present / `error` absent on success (with exact `float64` value) or `error` present / `result` absent with the exact string on failure. Success values are decoded, not string-compared (float64 `4.0` marshals as `4`; PRD R-6).

3. **`TestEvaluateNegativeZeroDivisor`** (AC-F2, PRD §5) — construct `negZero := math.Copysign(0, -1)`, marshal the request with `json.Marshal(map[string]any{"operation":"divide","a":5,"b":negZero})`, and **guard** that the wire bytes contain `"b":-0` (an untyped Go `-0.0` literal would collapse to `+0.0`; the guard makes a silent +0 regression fail loudly). Assert `422` and `assertErrorBody(rec, "division by zero")`.

4. **`TestEvaluateContentType`** (AC-CT1…CT5) — fixed body `{"operation":"add","a":1,"b":2}`, table of `{name, setCT, ct, wantStatus}`:

   | name | setCT | ct | status |
   |------|-------|----|--------|
   | absent | false | — | 400 |
   | text-plain | true | `text/plain` | 400 |
   | xml | true | `application/xml` | 400 |
   | json-patch | true | `application/json-patch+json` | 400 |
   | malformed | true | `;;;` | 400 |
   | charset-accepted | true | `application/json; charset=utf-8` | 200 |
   | case-insensitive | true | `Application/JSON` | 200 |

   Success rows assert result `3`; failure rows assert `invalid input`.

5. **`TestEvaluateBodyCap`** (AC-B1…B3) — body `{"operation":"add","a":1,"b":2,"x":"` + `strings.Repeat("A", 2048)` + `"}` (>1024 bytes) → `400` + `assertErrorBody(rec, "invalid input")`.

6. **`TestMethodNotAllowed`** (AC-R2…R4) — for `/evaluate`, loop `GET/PUT/DELETE/PATCH/HEAD` → `405` `method not allowed`; for `/health`, loop `POST/PUT/DELETE/HEAD` → `405` `method not allowed`. Every response asserts JSON envelope + exact string.

7. **`TestHealth`** (AC-H1) — `GET /health` → `200`, `Content-Type: application/json`, body decodes to `healthResponse{Status:"ok"}` with no other keys.

8. **`TestUnknownPath`** (NG-7) — `GET /nope` → `404`; body is the stdlib default (text, `404 page not found`), asserted **not** to contain `"error"` (no JSON 404).

9. **`TestPanicRecovery`** (AC-P1…P3) — `logger := slog.New(slog.NewTextHandler(&buf, nil))`, `s := &server{logger: logger}`, wrap `http.HandlerFunc(func(w,r){ panic("boom") })` with `s.recover`, drive via `httptest`. Assert `500` + `assertErrorBody(rec, "internal error")`; `require.Contains(buf.String(), "boom")` and `require.Contains(buf.String(), "goroutine")` (stack); and `require.NotContains(rec.Body.String(), "boom")` / `"goroutine"` (detail never in the body).

10. **`TestWriteErrorDefault`** (AC-E3 default, AC-E4) — white-box `s.writeError(rec, errors.New("unexpected internal detail"))` → `500` `internal error`; `require.NotContains(rec.Body.String(), "unexpected internal detail")`.

### Quality gates (AC-T2/T4, AC-M1)

Run from repo root, in order, confirm each passes:

1. `cd backend && gofmt -l .` → prints nothing (`gofmt -w` the two new `.go` files first).
2. `cd backend && go vet ./...` → clean.
3. `cd backend && go build ./...` → success (includes new `cmd/server`).
4. `cd backend && go test -race ./...` → pass.
5. `cd backend && go test -coverprofile=coverage.txt ./... && go tool cover -func=coverage.txt` → mapper switch arms + handler branches covered; add cases rather than ignoring gaps.
6. `make backend-build backend-test backend-vet backend-cover` → all succeed (canonical gates).
7. `git status --short` → only the three new files; `backend/go.mod`, `backend/go.sum`, `backend/internal/calc/*` unchanged.
8. Confirm `internal/calc` still imports no `net/http` (unchanged; grep to be safe).

---

## 4. Data, API & schema impact

- **Public API (new):** `func httpapi.NewHandler(logger *slog.Logger) http.Handler` — the only exported symbol (AC-S1). Everything else unexported.
- **HTTP surface (new):** `POST /evaluate` → `200 {"result":<number>}` or `4xx {"error":"<string>"}`; `GET /health` → `200 {"status":"ok"}`. `Content-Type: application/json` on every JSON response (AC-F7).
- **Error vocabulary (closed set, AC-E5):** `invalid input` (400), `division by zero` (422), `invalid operation` (422), `non-finite result` (422), `method not allowed` (405), `internal error` (500). `square root of negative number` is never emitted (NG-2).
- **Module/deps:** no new requires; `go.mod`/`go.sum` unchanged (AC-M3). `internal/httpapi` imports only stdlib + `sezzlecalc/backend/internal/calc`; tests add `testify` (AC-S2).
- **No migrations, no config files, no env vars.** Port is the fixed constant `:8080` (NG-9).
- **Downstream consumers:** none yet (no frontend in this worktree). The future frontend consumes `POST /evaluate` and `GET /health` per the `api-contract` skill. Note (PRD R-1): the skill advertises 7 operations while this service ships 4 — a non-blocking doc-sync follow-up.

---

## 5. Test strategy

All tests in `backend/internal/httpapi/httpapi_test.go`, `package httpapi`, using `net/http/httptest` (`NewRequest` + `NewRecorder`) driving `NewHandler` end-to-end; white-box access for the recovery middleware and mapper. Assertions always cover **status code + envelope shape (key presence/absence) + exact decoded value**, never raw bytes (PRD §5, go-http-service skill). `require`/`assert` from testify. Must pass under `-race`.

**Cases that must be covered** (each maps to a test function above):

- 4 happy paths (`add`/`subtract`/`multiply`/`divide`) with ints, negatives, fractions → 200 exact `result` (AC-F1, AC-F5).
- `divide` by `+0.0` and runtime `-0.0` (`math.Copysign(0,-1)`, wire-guard asserts `-0`) → 422 `division by zero` (AC-F2).
- Unknown/empty ops `mod`, `""`, `power`, `sqrt`, `percent` → 422 `invalid operation` (AC-F3, AC-F6).
- Non-finite result `multiply(1e308, 1e308)` → 422 `non-finite result` (AC-F4).
- Malformed body, empty body, trailing data → 400 `invalid input` (AC-V1…V3).
- Missing/`null` `a` or `b` → 400 (AC-V4); wrong-type `a`/`operation` → 400 (AC-V5).
- Overflowing literal `1e400` and `NaN`/`Infinity` literals → 400 (AC-V6).
- Content-Type absent / `text/plain` / `application/xml` / `application/json-patch+json` / malformed → 400; `application/json; charset=utf-8` and `Application/JSON` → 200 (AC-CT1…CT5).
- Body >1024 bytes → 400 (AC-B1…B3).
- Wrong methods on both routes → 405 `method not allowed` (AC-R2…R4); health 200 (AC-H1); unknown path 404 (NG-7).
- Panic recovery → 500 `internal error`, detail logged but absent from body (AC-P1…P3); unmapped error → 500 default (AC-E3, AC-E4); `NewHandler(nil)` non-panic (AC-S1).

### Traceability: PRD acceptance criteria → plan step / file

| AC | Criterion | Satisfied by |
|----|-----------|--------------|
| AC-M1 | `make backend-build` succeeds incl. `cmd/server` | File 2; gates 3, 6 |
| AC-M2 | `httpapi` + `cmd/server/main.go` exist; `calc` unmodified | Files 1–3; §3 "UNCHANGED"; gate 7 |
| AC-M3 | no new module deps | §4; `go.mod`/`go.sum` unchanged; gate 7 |
| AC-S1 | `NewHandler(logger *slog.Logger) http.Handler`; nil-safe | File 1 `NewHandler`; `TestNewHandlerNilLogger` |
| AC-S2 | `calc` imports no HTTP; `httpapi` imports stdlib + `calc` only | File 1 import block; §3 UNCHANGED |
| AC-S3 | single unexported error→status mapping function | File 1 `writeError` (only place) |
| AC-R1 | plain paths, no method patterns, no router | File 1 `mux.HandleFunc("/evaluate")`, `("/health")` |
| AC-R2 | non-POST `/evaluate` → 405 JSON | File 1; `TestMethodNotAllowed` |
| AC-R3 | non-GET `/health` → 405 JSON | File 1 `healthHandler`; `TestMethodNotAllowed` |
| AC-R4 | in-handler method enforcement; JSON 405 | File 1; tests |
| AC-CT1 | `mime.ParseMediaType` before decode | File 1 step 2 |
| AC-CT2 | absent CT → 400 | File 1; `TestEvaluateContentType`/absent |
| AC-CT3 | non-JSON CT → 400 without decode | File 1; `TestEvaluateContentType`/text-plain, xml, json-patch |
| AC-CT4 | malformed CT → 400 | File 1; `TestEvaluateContentType`/malformed |
| AC-CT5 | `application/json; charset=utf-8` accepted | File 1; `TestEvaluateContentType`/charset-accepted |
| AC-B1 | `http.MaxBytesReader(w, r.Body, 1024)` | File 1 step 3 |
| AC-B2 | >1024 → 400 via same mapper | File 1; `TestEvaluateBodyCap` |
| AC-B3 | `*http.MaxBytesError` via `errors.As` | File 1 `writeError` debug branch |
| AC-V1 | malformed JSON → 400 | `TestEvaluate`/bad-json |
| AC-V2 | empty body → 400 | `TestEvaluate`/empty-body |
| AC-V3 | trailing data → 400 | `TestEvaluate`/trailing-data |
| AC-V4 | missing/null `a`/`b` → 400 | `TestEvaluate`/missing-a, missing-b, null-a, null-b |
| AC-V5 | wrong-type → 400 | `TestEvaluate`/wrong-type-a, wrong-type-operation |
| AC-V6 | non-finite input → 400 | `TestEvaluate`/overflow-1e400, nan-literal, infinity-literal; File 1 backstop |
| AC-F1 | 4 ops → 200 exact `result` | `TestEvaluate` happy rows |
| AC-F2 | `divide` b==0 (incl. -0.0) → 422 `division by zero` | `TestEvaluate`/divide-by-zero/positive; `TestEvaluateNegativeZeroDivisor` |
| AC-F3 | unknown/empty op → 422 `invalid operation` | `TestEvaluate`/unknown rows |
| AC-F4 | non-finite result → 422 `non-finite result` | `TestEvaluate`/non-finite/result |
| AC-F5 | success has `result` only; error has `error` only | `decodeEnvelope` + `assertErrorBody` in every test |
| AC-F6 | `power`/`sqrt`/`percent` unspecial-cased | File 1 (no cases for them); `TestEvaluate`/unknown/power, sqrt, percent |
| AC-F7 | `Content-Type: application/json` on every response | File 1 `writeJSON`; asserted in every test |
| AC-H1 | `GET /health` → 200 `{"status":"ok"}` | File 1 `healthHandler`; `TestHealth` |
| AC-E1 | `ErrDivideByZero`→422 `division by zero`; `ErrUnknownOperation`→422 `invalid operation` | File 1 `writeError` switch |
| AC-E2 | `invalid operation`, not `unknown operation` | File 1; `TestEvaluate`/unknown rows assert the string |
| AC-E3 | 400/405/422/500 local sentinels + default 500 | File 1; `TestWriteErrorDefault`; `TestPanicRecovery` |
| AC-E4 | no raw error/cause/stack/path in body | `assertErrorBody` + `NotContains` in panic/default tests |
| AC-E5 | only the 6 client strings; no sqrt-negative | File 1 message set; no such string anywhere |
| AC-P1 | panic → 500 `{"error":"internal error"}` | File 1 `recover`; `TestPanicRecovery` |
| AC-P2 | detail logged, absent from body | `TestPanicRecovery` `Contains`/`NotContains` |
| AC-P3 | recovery wraps whole mux | File 1 `return s.recover(mux)` |
| AC-C1 | `:8080` + non-zero header/read/write timeouts | File 2 `http.Server` |
| AC-C2 | no business logic in `main.go` | File 2 (wiring only) |
| AC-C3 | `httpapi.NewHandler(logger)` + injected `slog.Logger` | File 2 |
| AC-T1 | httptest, table-driven, status+shape+value | File 3 structure |
| AC-T2 | pass under `-race` | gates 4, 6 |
| AC-T3 | every reachable error row covered | `TestEvaluate` + method + panic + default tests |
| AC-T4 | `make backend-vet` passes, `gofmt -l` empty | gates 1, 2, 6 |

---

## 6. Risks & edge cases

- **R-1 — negative-zero literal collapse (medium).** An untyped `-0.0` in Go source collapses to `+0.0`, and an untyped `-0.0` in a JSON *test string* would be `-0.0` text (valid JSON, still negative zero on decode) — the risk is specifically in Go code that passes `-0.0` as a `float64` argument. Mitigated by constructing the divisor with `math.Copysign(0,-1)` and asserting the marshaled wire bytes contain `"b":-0` before asserting 422. Mirrors the calc plan's `TestNegativeZeroConstruction` guard.
- **R-2 — panic-after-write cannot be cleanly replaced (low, PRD R-3).** If a handler panics after `WriteHeader`, the 500 cannot overwrite the prior response. Mitigated by keeping handlers single-write; the panic test exercises a panic before any write. Documented limitation.
- **R-3 — float64 marshaling (`4.0` → `4`) (low, PRD R-6).** Tests must assert decoded numeric values and key presence, never raw bytes. Enforced by `decodeEnvelope`/`assertErrorBody` and the happy-path value assertions.
- **R-4 — non-finite detection depends on decoder behavior (low, PRD R-4).** Whether `1e400` surfaces as a decode error vs `±Inf` is decoder-internal. Mitigated by handling both: decode errors → 400, plus the explicit `math.IsNaN/IsInf` backstop on decoded operands. The backstop branch itself is not reachable through standard JSON (NaN/Inf literals are invalid); it is a defensive guard, and the reachable paths (overflow literal, NaN/Infinity literals) are tested.
- **R-5 — missing-vs-zero operand ambiguity (low, PRD R-5).** Pointer fields `A *float64` / `B *float64` distinguish missing/`null` from `0`; a bare `null` body also fails via `req.A == nil`.
- **R-6 — MaxBytesError routing (low).** The double-`%w` wrap (`fmt.Errorf("%w: %w", errInvalidInput, err)`) keeps `errors.Is(err, errInvalidInput)` and `errors.As(err, &*http.MaxBytesError)` working through one chain. Body cap is inclusive at 1024 bytes; the test uses 2048 to be unambiguous. A later boundary test at exactly 1024 is optional.
- **R-7 — Content-Type absent vs. other.** `r.Header.Get("Content-Type")` returns `""` for both absent and empty, and `mime.ParseMediaType("")` errors, so both map to 400 without special-casing.
- **Edge — unknown fields.** Ignored (no `DisallowUnknownFields`), keeping the layer forward-compatible (PRD §3.6).
- **Edge — `HEAD` on `/health`.** Explicitly a 405 (PRD §3.10); there is no implicit `HEAD` handling. Covered by `TestMethodNotAllowed`.
- **Concurrency.** The package is stateless (`server` holds only an immutable logger; handlers share no mutable state), so `go test -race` passes with no per-request state. No goroutines are spawned by the service itself.
- **Double-logging on panic (cosmetic).** The recover middleware logs `panic recovered` + stack, and `writeError(errInternal)` logs a generic `internal error`. Intentional and harmless; both are server-side only.

---

## 7. Rollout & rollback

This is an additive feature with no consumers and no flags.

- **Rollout order (implementation order):**
  1. Confirm isolated worktree (below).
  2. `mkdir -p backend/internal/httpapi backend/cmd/server`.
  3. Create `backend/internal/httpapi/httpapi.go` (File 1).
  4. Create `backend/cmd/server/main.go` (File 2).
  5. Create `backend/internal/httpapi/httpapi_test.go` (File 3).
  6. `gofmt -w` the three `.go` files, then run gates 1–8 (§3).
  - **Implementation notes:** negative-zero test uses `math.Copysign(0,-1)` + wire guard, never an untyped `-0.0` literal; tests assert decoded values, not raw bytes.
- **Rollback.** Delete `backend/internal/httpapi/` and `backend/cmd/` (both entirely new). `backend/go.mod`, `backend/go.sum`, and `backend/internal/calc/` are untouched and remain valid. No flag, migration, or config rollback exists. The service simply stops being built (`make backend-build` would no longer include `cmd/server`); the remaining domain package still builds/tests cleanly.
- **Sequencing note.** Do **not** run `make check` (it also depends on the not-yet-present frontend targets). Run the backend gates individually, as listed.

### Confirming the isolated worktree (before any edit)

Per `AGENTS.md`, implementation must happen in the isolated git worktree, never the main checkout. The worktree is already active (repo root in this task's env is `/Users/juancamilocortesmedina/workspace/sezzlecalc-worktrees/http-layer`); the following are **verification**, not setup:

1. `git rev-parse --show-toplevel` prints `/Users/juancamilocortesmedina/workspace/sezzlecalc-worktrees/http-layer`.
2. `test -f .git && echo "worktree (.git is a file)" || echo "main checkout (.git is a dir)"` → must print `worktree (.git is a file)`.
3. `git worktree list` shows the path listed as a linked worktree (not `(bare)`).
4. `git status --short` is clean before starting (or shows only the three new files after creation).
5. Confirm pre-state: `test ! -e backend/cmd && test ! -e backend/internal/httpapi` and `test -f backend/internal/calc/calc.go` (domain present, to be left untouched).

Only after all checks pass should the coder proceed to File 1.

---

## 8. Open questions

The PRD states no blocking open questions (all 12 tension points resolved). Remaining non-blocking notes for the human before/at coding time:

1. **`api-contract` skill drift (PRD R-1, non-blocking).** The skill advertises 7 operations; this service ships 4. Whether to amend the skill's operation table to the shipped subset is a follow-up and does not block this feature.
2. **`Allow` header on 405s.** Optional good practice (PRD §3.10), not an AC; this plan omits it. Confirm whether to add it in the handlers for polish.
3. **Double-log line on panic.** The recover middleware and `writeError` each log a 5xx line. Acceptable as-is; confirm if a single consolidated log line is preferred (would require a small refactor of who logs, not of the mapping).
