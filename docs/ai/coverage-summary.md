# Backend coverage summary

This covers the **backend Go packages** — `sezzlecalc/backend/internal/calc` (the pure domain) and `sezzlecalc/backend/internal/httpapi` (the HTTP layer). `cmd/server` is a thin entrypoint with no tests, so its `main()` shows 0% by design (see below). There is no frontend yet.

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

- **Total: 92.7% statement coverage** across the module (`mode set`).
- **`internal/calc` — 100.0%** (`Evaluate` 100.0%, `Arity` 100.0%).
- **`internal/httpapi` — 97.9%** (`NewHandler` 100.0%, `evaluateHandler` 100.0%, `requirePost` 100.0%, `requireJSONContentType` 100.0%, `decodeEvaluateRequest` 100.0%, `validateOperands` 100.0%, `validateOperandPresence` 100.0%, `validateOperandFiniteness` 60.0%, `isNonFinite` 100.0%, `operandValue` 100.0%, `healthHandler` 100.0%, `writeError` 100.0%, `recover` 100.0%, `writeJSON` 100.0%).
- **`cmd/server` — 0.0%** (`main()` has no tests by design; it is thin wiring only).
- The artifact `backend/coverage.txt` is git-ignored (added to `.gitignore` in an earlier feature).

## `internal/calc` (pure domain)

- **`Evaluate` — 100%** — all seven `switch` arms (`add`, `subtract`, `multiply`, `divide`, `power`, `sqrt`, `percent`), the `b == 0` divide-by-zero guard, the `a < 0` sqrt-negative guard, the `default` (unknown-operation) branch, and the post-switch non-finite-result check are all covered.
- **`Arity` — 100%** — every branch of the arity table (binary, unary, unknown, and normalized variants) is covered.

## What the table-driven suite covers

`backend/internal/calc/calc_test.go` (`TestEvaluate`, plus `TestEvaluateNegativeZero`, `TestArity`, `TestNegativeZeroConstruction`, and `TestEvaluateConcurrent`) exercises:

- **All seven operations** — `add`, `subtract`, `multiply`, `divide`, `power`, `sqrt`, `percent` — across positive, negative, zero, fractional, and mixed-sign operands, plus the unary-op rule that `sqrt`/`percent` read `a` only and ignore `b` (`sqrt/ignores-b`, `percent/ignores-b`).
- **Operation-name normalization** — mixed-case, upper-case, and whitespace-padded variants (`"Add"`, `" add "`, `"ADD"`, `"MuLtIpLy"`, `"PoWeR"`, `"SQRT"`, `" PeRcEnT "`, …) resolve to the canonical result.
- **Unknown-operation errors** — `"mod"`, `""`, whitespace-only, and the alias `"plus"` all return `ErrUnknownOperation`.
- **Divide-by-zero** — positive, zero, and negative numerators with a `+0.0` divisor, and with a runtime-constructed `-0.0` divisor (`math.Copysign(0, -1)`, not an untyped `-0.0` literal that would collapse to `+0.0`).
- **`power` semantics** — `power(0, 0) = 1`, fractional/negative exponents, and the non-finite cases `power(10, 400)`, `power(-2, 0.5)`, `power(0, -1)` (asserted **not** `ErrDivideByZero`).
- **`sqrt` semantics** — `sqrt(9)`, `sqrt(2)`, `sqrt(0) = +0`, `sqrt(-1)` → `ErrSqrtNegative`, and `sqrt(-0.0) = -0.0` (finite success, asserted with `math.Signbit`).
- **`percent` semantics** — `percent(50) = 0.5`, `percent(-25)`, `percent(0)`, and `percent(-0.0) = -0.0` (sign preserved).
- **Non-finite results** — `power(10, 400)`, `power(-2, 0.5)`, `power(0, -1)`, and `multiply(1e308, 10)` all return `(0, ErrNonFiniteResult)`, with the raw `±Inf`/`NaN` discarded (result `0`).
- **Negative zero** — distinct `0` vs runtime `-0.0` cases, asserted via `math.Signbit` (naive `==` would pass vacuously for both signs).
- **Concurrency/statelessness** — 8 goroutines × 100 iterations over an overlapping input set (including divide-by-zero, `-0.0`, unknown-op, `power`, `sqrt`, `percent`, and non-finite cases), asserting deterministic results.

## `internal/httpapi` (HTTP layer)

Statement coverage is **97.9%**. Per-function:

| Function | Coverage | Note |
|----------|----------|------|
| `NewHandler` | 100% | nil-logger fallback path exercised |
| `evaluateHandler` | 100% | pure top-down narrative delegating to the extracted helpers |
| `requirePost` | 100% | |
| `requireJSONContentType` | 100% | |
| `decodeEvaluateRequest` | 100% | 1 KiB cap + trailing-data rejection paths exercised |
| `validateOperands` | 100% | delegates to presence + finiteness |
| `validateOperandPresence` | 100% | all arity-aware presence branches exercised |
| `validateOperandFiniteness` | **60.0%** | the only uncovered blocks are the defensive non-finite-input backstop guards (below) |
| `isNonFinite` | 100% | |
| `operandValue` | 100% | |
| `healthHandler` | 100% | |
| `writeError` | 100% | every mapper branch — all seven error strings plus the defensive `500 internal error` default — exercised |
| `recover` | 100% | panic path exercised via white-box test |
| `writeJSON` | 100% | |

The uncovered statements (`validateOperandFiniteness` at 60.0%) are the **two** post-decode `math.IsNaN`/`math.IsInf` backstop guards — one on `a` and one on `b` (each `if … { return errInvalidInput }`, 2 statements total). They are **unreachable over the wire**: standard JSON cannot express `NaN`/`Inf` literals (they fail decode), and an overflowing literal such as `1e400` surfaces as a `strconv` range error through the decoder. Both reachable decode paths are covered by tests (`nan-literal`, `infinity-literal`, `overflow-1e400` → `400 invalid input`); the backstops are defensive guards kept per the PRD and are exercised by no test because no valid JSON can reach them.

`evaluateHandler` is now **100%**: the behavior-preserving refactor split it into the small private helpers above, so the handler itself is a pure top-down narrative with no branching of its own. The two previously-uncovered backstop guards moved into `validateOperandFiniteness`, which is why that function now reads 60.0% (3 of 5 statements). The uncovered *nature* is unchanged: it is still the defensive non-finite-input backstop, not any new error path.

The `httpapi` suite (`backend/internal/httpapi/httpapi_test.go`) drives `NewHandler` end-to-end through `httptest`, asserting status code + envelope shape + exact decoded value, and covers: all seven operations (200), the full error taxonomy (`400 invalid input`, `405 method not allowed`, `422 division by zero`, `422 square root of negative number`, `422 invalid operation`, `422 non-finite result`, `500 internal error`), the arity-aware presence rules (unary `b` omitted and `b: null` → 200; unary numeric `b` and missing/null `a` → 400), the `Content-Type` gate (absent/other/malformed → 400; `charset` and case-insensitive → 200), the 1 KiB body cap (boundary at exactly 1024 accepted, 1025+ rejected), wrong methods on both routes, unknown paths (stdlib 404), panic recovery, negative-zero results (`math.Signbit`), and the mapper default.

### `cmd/server` — 0% by design

`cmd/server/main.go`'s `main()` (0.0%) is deliberately untested: it only constructs a `slog.Logger`, calls `httpapi.NewHandler`, sets `http.Server` timeouts on `:8080`, and calls `ListenAndServe`. It contains no business logic (no `calc.Evaluate`, no JSON decode, no error mapping, no routing), so there is nothing meaningful to unit-test. This is why the whole-module `./...` number is not a single meaningful percentage — the two packages carry 100.0% and 97.9% respectively, and the entrypoint is wiring.

## Scope note (no overstatement)

- This is **statement coverage**, not branch/MCDC coverage.
- Error assertions use `errors.Is` (domain tests) and exact envelope/string assertions (httpapi tests), so the sentinel-error matching (including `ErrSqrtNegative` and `ErrNonFiniteResult`) and the single `writeError` mapper are exercised directly.
- No tests are skipped: the `-count=1` flag forces re-execution (no cached `ok`), and there are no `t.Skip`/`t.SkipNow`/`t.Skipf`/`.Skip(` calls in the suite. The verification run recorded **17 PASS / 0 FAIL / 0 SKIP**.

## Race detector

`make backend-test` runs `go test -race ./...`, which passes — the race detector also validates the statelessness/concurrency expectation (no shared mutable state, no data races). The HTTP layer is stateless too (`server` holds only an immutable logger; handlers share no per-request state).
