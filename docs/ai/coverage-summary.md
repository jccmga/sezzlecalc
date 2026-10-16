# Backend coverage summary

This covers the **backend Go packages** — `sezzlecalc/backend/internal/calc` (the pure domain, delivered first) and `sezzlecalc/backend/internal/httpapi` (the HTTP layer, delivered in the `http-layer` feature). `cmd/server` is a thin entrypoint with no tests, so its `main()` shows 0% by design (see below). There is no frontend yet.

## Command

Coverage is produced by the canonical Makefile target:

```sh
make backend-cover
```

which runs:

```sh
cd backend && go test -coverprofile=coverage.txt ./... && go tool cover -func=coverage.txt
```

## Result

- **`internal/calc` — 100% statement coverage** (mode `set`; every statement block in `calc.go` is exercised at least once).
- **`internal/httpapi` — 97.0% statement coverage** (per-function breakdown below).
- **`cmd/server` — 0%** (`main()` has no tests by design; it is thin wiring only).
- The artifact `backend/coverage.txt` is git-ignored (added to `.gitignore` in this feature).

## `internal/calc` (pure domain)

- **`Evaluate` — 100%** — all four `switch` arms, the `b == 0` divide-by-zero guard, and the `default` (unknown-operation) branch are all covered.

## What the table-driven suite covers

`backend/internal/calc/calc_test.go` (`TestEvaluate`, plus `TestNegativeZeroConstruction` and `TestEvaluateConcurrent`) exercises:

- **All four operations** (`add`, `subtract`, `multiply`, `divide`) across positive, negative, zero, fractional, and mixed-sign operands.
- **Operation-name normalization** — mixed-case, upper-case, and whitespace-padded variants (`"Add"`, `" add "`, `"ADD"`, `"MuLtIpLy"`, …) resolve to the canonical result.
- **Unknown-operation errors** — `"mod"`, `""`, whitespace-only, and the alias `"plus"` all return `ErrUnknownOperation`.
- **Divide-by-zero** — positive, zero, and negative numerators with a `+0.0` divisor, and with a runtime-constructed `-0.0` divisor (`math.Copysign(0, -1)`, not an untyped `-0.0` literal that would collapse to `+0.0`).
- **Concurrency/statelessness** — 8 goroutines × 100 iterations over an overlapping input set (including a divide-by-zero and a `-0.0` divisor case), asserting deterministic results.

## `internal/httpapi` (HTTP layer)

Statement coverage is **97.0%**. Per-function:

| Function | Coverage | Note |
|----------|----------|------|
| `NewHandler` | 100% | nil-logger fallback path exercised |
| `evaluateHandler` | 93.3% | the single uncovered statement is the defensive non-finite-input backstop (below) |
| `healthHandler` | 100% | |
| `writeError` | 100% | every mapper branch — all six error strings plus the defensive `500 internal error` default — exercised |
| `recover` | 100% | panic path exercised via white-box test |
| `writeJSON` | 100% | |

The one uncovered statement (`evaluateHandler` at 93.3%) is the post-decode `math.IsNaN`/`math.IsInf` backstop on `a`/`b`. It is **unreachable over the wire**: standard JSON cannot express `NaN`/`Inf` literals (they fail decode), and an overflowing literal such as `1e400` surfaces as a `strconv` range error through the decoder. Both reachable paths are covered by tests (`nan-literal`, `infinity-literal`, `overflow-1e400` → `400 invalid input`); the backstop is a defensive guard kept per the PRD (risk R-4) and is exercised by no test because no valid JSON can reach it.

The `httpapi` suite (`backend/internal/httpapi/httpapi_test.go`) drives `NewHandler` end-to-end through `httptest`, asserting status code + envelope shape + exact decoded value, and covers: all four operations (200), the full error taxonomy (`400 invalid input`, `405 method not allowed`, `422 division by zero`, `422 invalid operation`, `422 non-finite result`, `500 internal error`), the `Content-Type` gate (absent/other/malformed → 400; `charset` and case-insensitive → 200), the 1 KiB body cap (boundary at exactly 1024 accepted, 1025+ rejected), wrong methods on both routes, unknown paths (stdlib 404), panic recovery, and the mapper default.

### `cmd/server` — 0% by design

`cmd/server/main.go`'s `main()` (0%) is deliberately untested: it only constructs a `slog.Logger`, calls `httpapi.NewHandler`, sets `http.Server` timeouts on `:8080`, and calls `ListenAndServe`. It contains no business logic (no `calc.Evaluate`, no JSON decode, no error mapping, no routing) per AC-C2, so there is nothing meaningful to unit-test. This is why the whole-module `./...` number is not a single meaningful percentage — the two packages carry 100% and 97.0% respectively, and the entrypoint is wiring.

## Scope note (no overstatement)

- This is **statement coverage**, not branch/MCDC coverage.
- Error assertions use `errors.Is` (domain tests) and exact envelope/string assertions (httpapi tests), so the sentinel-error matching and the single `writeError` mapper are exercised directly.
- No tests are skipped: the `-count=1` flag forces re-execution (no cached `ok`), and there are no `t.Skip`/`t.SkipNow`/`t.Skipf`/`.Skip(` calls in the suite.

## Race detector

`make backend-test` runs `go test -race ./...`, which passes — the race detector also validates the statelessness/concurrency expectation (no shared mutable state, no data races). The HTTP layer is stateless too (`server` holds only an immutable logger; handlers share no per-request state).
