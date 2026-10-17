# Full-stack coverage summary

This covers the whole repository: the **backend Go packages** — `sezzlecalc/backend/internal/calc` (the pure domain) and `sezzlecalc/backend/internal/httpapi` (the HTTP layer) — and the **frontend** (`frontend/`, Vite + React + TS, Vitest). `cmd/server` is a thin entrypoint with no tests, so its `main()` shows 0% by design (see below). The backend is measured with Go statement coverage (`-coverprofile`); the frontend is measured by test breadth (Vitest has no Go-style `-coverprofile` — see the frontend section at the end).

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

- **Total: 90.5% statement coverage** across the module (`mode set`).
- **`internal/calc` — 100.0%** (`Evaluate` 100.0%, `Arity` 100.0%).
- **`internal/httpapi` — 97.9%** (`NewHandler` 100.0%, `evaluateHandler` 100.0%, `requirePost` 100.0%, `requireJSONContentType` 100.0%, `decodeEvaluateRequest` 100.0%, `validateOperands` 100.0%, `validateOperandPresence` 100.0%, `validateOperandFiniteness` 60.0%, `isNonFinite` 100.0%, `operandValue` 100.0%, `healthHandler` 100.0%, `writeError` 100.0%, `recover` 100.0%, `writeJSON` 100.0%).
- **`cmd/server` — 0.0%** (`main()` has no tests by design; it is thin wiring only — including the `PORT` env read added by the Docker packaging feature).
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

`cmd/server/main.go`'s `main()` (0.0%) is deliberately untested: it only constructs a `slog.Logger`, calls `httpapi.NewHandler`, reads the `PORT` env var (defaulting to `8080`), sets `http.Server` timeouts, and calls `ListenAndServe`. It contains no business logic (no `calc.Evaluate`, no JSON decode, no error mapping, no routing), so there is nothing meaningful to unit-test. This is why the whole-module `./...` number is not a single meaningful percentage — the two packages carry 100.0% and 97.9% respectively, and the entrypoint is wiring.

The Docker packaging feature added the three-statement `PORT` read to `main()`; that is why the module total moved from 92.7% (pre-Docker) to **90.5%**: `internal/calc` and `internal/httpapi` are unchanged, while `cmd/server` now carries a few more untested wiring statements. This is expected and by design.

## Scope note (no overstatement)

- This is **statement coverage**, not branch/MCDC coverage.
- Error assertions use `errors.Is` (domain tests) and exact envelope/string assertions (httpapi tests), so the sentinel-error matching (including `ErrSqrtNegative` and `ErrNonFiniteResult`) and the single `writeError` mapper are exercised directly.
- No tests are skipped: the `-count=1` flag forces re-execution (no cached `ok`), and there are no `t.Skip`/`t.SkipNow`/`t.Skipf`/`.Skip(` calls in the suite. The verification run recorded **17 PASS / 0 FAIL / 0 SKIP**.

## Race detector

`make backend-test` runs `go test -race ./...`, which passes — the race detector also validates the statelessness/concurrency expectation (no shared mutable state, no data races). The HTTP layer is stateless too (`server` holds only an immutable logger; handlers share no per-request state).

---

## Frontend coverage (Vitest)

The frontend has **no Go-style `-coverprofile`**: Vitest reports test counts, not a statement-coverage percentage. Coverage here is therefore described as **test breadth** (what each suite exercises), not invented as a percentage. All 75 tests run under `environment: 'jsdom'` with `fetch` stubbed, so no test touches the network.

## Command

```sh
make frontend-test        # cd frontend && npm run test
```

which runs `vitest run` (non-interactive; `make check` calls it). Install first with `make frontend-install` (`cd frontend && npm install`).

## Result

- **5 test files / 75 tests passed** (0 failed, 0 skipped — no `it.skip`/`describe.skip`/`.todo(`/`.only(`/`xit`/`xdescribe` anywhere in `frontend/src`).
- `make frontend-lint` (`eslint .`) reports **0 errors**; one known `react-refresh/only-export-components` **warning** on the shadcn `buttonVariants` export (a warning, not an error).
- `make frontend-build` (`tsc -b && vite build`) passes; TypeScript `strict` is on with no `@ts-ignore`/`@ts-expect-error`.

## What each suite covers

### `src/components/Calculator.test.tsx` — 18 tests (component + state machine)

Renders `<Calculator />` with a stubbed `fetch` and drives it with `@testing-library/user-event`. Queries are by role + accessible name, never by glyph text. It covers the three mandated component scenarios plus supporting behavior:

- **T-1 (binary path)** — `1 2 × 4 =` sends **exactly one** `POST /api/evaluate` with `{ operation: 'multiply', a: 12, b: 4 }` (asserts URL, method, `Content-Type`, and exact body) and renders `48`.
- **T-2 (unary path)** — `9 √` sends **exactly one** `POST /api/evaluate` with `{ operation: 'sqrt', a: 9 }` and asserts `'b' in body === false`; renders `3`.
- **T-3 (invalid entry blocks the request)** — `5 Backspace √` leaves the entry empty so `fetch` is **never called** and the display stays `0`; a companion case asserts `=` with no pending operation issues no request.
- Supporting cases: no request on mount; `±` toggles the sign without a request; `±` is a no-op on zero; a `422` error string renders verbatim; `AC` clears an error back to `0`; `busy` disables keys (with `aria-busy="true"`) but keeps `AC` enabled; operator replacement (`12 + 4 × =` → `multiply`); a unary preserves a pending `lhs`/`operator` (`9 + 3 √ =` → `{operation:'add', a:9, b:3}`); keyboard entry (`12*4{Enter}`) matches the keypad.

The `fe-polish` pass added five component cases (the 13 pre-existing tests are untouched):

- **C1** — `5 ÷ 0 =` with a `422` stub: before the error the display is `aria-live="polite"` with no `role`; after the error it has `role="alert"` and **no** `aria-live` attribute (one alert region, zero polite/assertive regions, the error string exactly once in the document).
- **C2** — `12 × 4 =` → `48`, then `5 ÷ 0 =` → the display `textContent` is exactly `division by zero` with no `48`, and `=` in the error state issues no request (call count unchanged).
- **C3** — `9 √` with `fetch` rejecting `TypeError('Failed to fetch')` → display shows exactly `Could not reach the server`, the region stays mounted with `aria-busy="false"`, every key is enabled, and exactly one request was issued.
- **C3b** — `9 √` with a non-JSON 2xx body → the same transport error, `aria-busy="false"`, keypad enabled.
- **C4** — `5 ÷ 0 =` → error, then `2 + 2 =` with a `200 {result:4}` stub → exactly 2 requests total, the second body `{operation:'add', a:2, b:2}`, display `4`, error text gone.

### `src/lib/calculator-machine.test.ts` — 2 tests (reducer; new file)

Pure reducer unit tests (no React, no fetch, no DOM):

- **C2** — a `resolve` failure from a state holding `entry: '48'`, `lhs: 12`, `operator: 'add'` (with `preserve: true`) yields exactly `{ entry: '', lhs: null, operator: null, status: 'error', error: 'division by zero' }`, proving a prior value cannot survive an error.
- **C4 (reducer)** — a `digit` after `status: 'error'` yields `{ entry: '2', lhs: null, operator: null, status: 'editing', error: null }`, the reducer precondition for the C4 retry flow.

### `src/lib/api.test.ts` — 13 tests (the `evaluate` client; mandated T-4)

The **T-4** status/transport table, each case asserting the promise **resolves** (never rejects) to the exact expected outcome:

- success `200` `{result:48}` → `{ok:true, value:48}`;
- `422` `{error:'division by zero'}`, `400` `{error:'invalid input'}`, `500` `{error:'internal error'}` → returned **verbatim** as `{ok:false, error}`;
- non-2xx without an error string → `TRANSPORT_ERROR`;
- network failure (`TypeError`), abort (`AbortError`), non-JSON 2xx, non-JSON 500, and a 2xx without a finite numeric `result` (missing/`null`/string) → all `TRANSPORT_ERROR = 'Could not reach the server'`;
- plus the request init: URL `/api/evaluate`, method `POST`, `Content-Type: application/json`, and a unary body with **no `b` key**.

### `src/lib/validation.test.ts` — 25 tests (`parseEntry` + operation metadata)

- `parseEntry` **accepts** `12`, `-5`, `3.`, `0.`, `.5`, `1e+21`, `1.5e-9`, `-0` (8 cases);
- **rejects** `''`, `' '`, `'-'`, `'.'`, `'-.', 'abc'`, `'0x10'`, `'1,000'`, `'Infinity'`, `'NaN'`, `'1e999'`, `' 12 34'` (12 cases);
- representative parses (`'12'`→12, `'-5'`→−5, `'.5'`→0.5, `'3.'`→3);
- `BINARY_OPERATIONS` is exactly the five, `UNARY_OPERATIONS` exactly the two, and the `isBinaryOperation`/`isUnaryOperation` type guards return the right results.

### `src/lib/format.test.ts` — 17 tests (`formatNumber`)

The full 12-significant-digit table: `48 → '48'`, `0 → '0'`, `-0 → '0'`, `0.5 → '0.5'`, `-2.5 → '-2.5'`, `100 → '100'`, `1/3 → '0.333333333333'`, `Math.PI → '3.14159265359'`, `1e12 → '1e+12'`, `123456789012 → '123456789012'`, `1e21 → '1e+21'`, `1e-7 → '1e-7'`, `1.5e-9 → '1.5e-9'`, `1e-6 → '0.000001'`, `Infinity → 'Error'`, `NaN → 'Error'`, plus `MAX_SIGNIFICANT_DIGITS === 12`.

## Scope note

The frontend coverage is described by the **five test files and their 75 passing tests** above — there is no statement-coverage percentage for `frontend/` because Vitest does not emit a Go-style coverage profile. `fetch` is always stubbed (`vi.stubGlobal('fetch', …)` with `vi.unstubAllGlobals()` in the test setup's `afterEach`), so every scenario runs offline and deterministically. The 320 px layout criterion (no horizontal scroll, every key ≥44×44) is **not** asserted by any test — jsdom has no layout engine — and is instead verified manually in a real headless browser (Chrome, 320×568 CSS px).

## Docker packaging gate status (verified)

The Docker packaging feature adds no Go or TypeScript test code (the only application-code change is the `PORT` read in `cmd/server/main.go`, which is untested wiring by design), so its gates are build/run evidence rather than test additions:

| Gate | Result |
|------|--------|
| `docker compose build` | **PASS** (exit 0, both images built) |
| `make check` | **PASS** (Docker-free — `backend-build backend-test backend-vet frontend-test frontend-lint frontend-build`) |
| End-to-end `12 × 4 = 48` | **PASS** — `POST http://localhost:3000/api/evaluate` with `{"operation":"multiply","a":12,"b":4}` → `200 {"result":48}` |

Published ports: frontend `3000 → 80` (nginx) and backend `8080 → 8080` (Go). The backend coverage figures above (`internal/calc` 100.0%, `internal/httpapi` 97.9%, total 90.5%) are unchanged by Docker packaging except for the widened `cmd/server` entrypoint described above.
