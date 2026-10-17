# Plan: Extra Operations (`power`, `sqrt`, `percent`) + Deterministic Numeric Behavior

- **PRD:** `docs/opencode/prds/extra-operations.md` (single source of truth; all 4 open questions RESOLVED — do not re-open)
- **Contract:** `.opencode/skills/api-contract/SKILL.md` (seven operations, exact error strings)
- **Conventions:** `.opencode/skills/go-http-service/SKILL.md`
- **Depends on:** `internal/calc` (`docs/opencode/prds/calc-domain-package.md`) and `internal/httpapi` (`docs/opencode/prds/http-api-layer.md`)
- **Repo root (isolated worktree):** `/Users/juancamilocortesmedina/workspace/sezzlecalc-worktrees/extra-operations`
- **Scope:** Backend only — `backend/internal/calc` + `backend/internal/httpapi`. No `cmd/`, no `go.mod`/`go.sum`, no frontend.

---

## 1. Context & Goals

### Context

`backend/internal/calc/calc.go` today exports `func Evaluate(operation string, a, b float64) (float64, error)` (signature frozen by `calc-domain-package.md`), normalizes via `strings.ToLower(strings.TrimSpace(operation))`, and switches over exactly `add`, `subtract`, `multiply`, `divide`. It exports two sentinels (`ErrDivideByZero`, `ErrUnknownOperation`) and returns `(0, <sentinel>)` on failure. There is no result-finiteness detection: a non-finite result (e.g. `multiply(1e308, 10)` → `+Inf`) is returned as `(<non-finite>, nil)`.

`backend/internal/httpapi/httpapi.go` exposes `NewHandler`; its `evaluateHandler` enforces method → Content-Type → body cap (1024 B) → decode → trailing-data → **both operands present** → **both operands finite** → `calc.Evaluate` → **result finiteness** (lines 120–123) → success. It holds a local sentinel `errNonFiniteResult` (line 30) and a single `writeError` mapper that today knows `ErrDivideByZero` and `ErrUnknownOperation` but **not** a sqrt-negative error nor a domain non-finite error.

`backend/internal/httpapi/httpapi_test.go` currently asserts `unknown/power`, `unknown/sqrt`, `unknown/percent` → `422 invalid operation` (lines 85–87). Those three rows encode the OLD contract and must be replaced (BC-4).

The `api-contract` skill already lists all seven operations (`power`/`sqrt`/`percent` among them) and the error strings `square root of negative number` and `non-finite result`.

### Desired outcome

1. `internal/calc` recognizes **all seven** contract operations — adding `power` (`math.Pow`), `sqrt` (`math.Sqrt`), `percent` (`a/100`) — with `Evaluate`'s signature **unchanged**; unary ops compute from `a` only and ignore `b`.
2. Two new domain sentinels: `ErrSqrtNegative` and `ErrNonFiniteResult`.
3. The **non-finite RESULT check moves into the domain** (value-based, after each op computes its result): `encoding/json` can never receive `NaN`/`±Inf`. The HTTP layer's local `errNonFiniteResult` sentinel and its post-`Evaluate` `math.IsNaN/IsInf` check are **removed**.
4. A new exported pure helper `func Arity(operation string) (int, bool)` — the **single source of truth** for operation arity — so `internal/httpapi` holds no local operation/unary table.
5. `internal/httpapi` makes operand-presence **arity-aware** (`a` always required; `b` required for binary, must be omitted/null for unary; unary with numeric `b` → `400`; unknown op → `422 invalid operation` regardless of operand presence) and maps `ErrSqrtNegative`→`422 square root of negative number` and `ErrNonFiniteResult`→`422 non-finite result`.
6. All four backend Makefile gates pass.

### Non-goals (explicit, from PRD §1.1)

- **NG-1** — any frontend change (the `frontend/` tree is absent in this worktree, per PRD D-10).
- **NG-2** — an expression parser / multi-operand chaining.
- **NG-3** — server-side rounding, significant-digit capping, or string number formatting (result stays a raw JSON number).
- **NG-4** — reworking routing, Content-Type, body cap, method enforcement, panic recovery, or `GET /health`.
- **NG-5** — changing the request/response envelope shapes.
- **NG-6** — CORS, graceful shutdown, config via flags/env, persistence, auth, i18n, CI/CD, observability, rate limiting.
- **NG-7** — changing `cmd/server/main.go` (wiring only; unchanged).
- **NG-8** — changing non-finite *input* handling (stays `400 invalid input`, AC-E5).
- **NG-9** — new error strings beyond the closed contract vocabulary.

### Breaking changes introduced (flagged, from PRD §2.1)

- **BC-1** — `power`/`sqrt`/`percent` change from `422 invalid operation` to real behavior.
- **BC-2** — `calc.Evaluate` no longer returns a non-finite value with `nil` error; direct callers get `(0, ErrNonFiniteResult)`.
- **BC-3** — HTTP-layer local `errNonFiniteResult` + post-`Evaluate` result check removed (origin moves to the domain; wire response unchanged).
- **BC-4** — the three `unknown/power|sqrt|percent` rows in `httpapi_test.go` are deleted/replaced.
- **BC-5 (NOT a break)** — `Evaluate`'s signature is **unchanged**.

---

## 2. Approach

**Design.** Extend the domain in place (no new files, no new packages). `Evaluate` computes its result into a single `result` local across the switch, then applies **one** value-based finiteness check immediately before the success return — so the check runs on the success path of *every* operation and the raw non-finite value is discarded in favor of `(0, ErrNonFiniteResult)`. `sqrt`'s `a < 0` guard runs **before** `math.Sqrt(a)`, so `sqrt(-1)` returns `ErrSqrtNegative` (never `ErrNonFiniteResult`) while `sqrt(-0.0)` (where `-0.0 < 0` is false) reaches `math.Sqrt(-0.0)`, which returns `-0.0` as a finite success. A new exported pure `Arity` helper centralizes the operation table's arity; `Evaluate` and `Arity` share the identical `strings.ToLower(strings.TrimSpace(operation))` normalization (no new abstraction; matching the existing inline style).

**HTTP layer.** `evaluateHandler` becomes arity-aware: after decode/trailing-data, it calls `calc.Arity(req.Operation)`. For a **known** op it enforces presence (`a` always; `b` required for arity 2, forbidden for arity 1); for an **unknown** op it skips presence enforcement entirely and falls through to `calc.Evaluate`, which returns `ErrUnknownOperation` → `422 invalid operation` regardless of operand presence (D-1). The non-finite **input** backstop then runs on whichever operands are present (defensive; unchanged), and `calc.Evaluate` is called with nil operands coerced to `0` (safe because an unknown op ignores operands, and a known op always has its required operands by this point). The post-`Evaluate` result check and `errNonFiniteResult` sentinel are deleted; `writeError` gains `ErrSqrtNegative` and `ErrNonFiniteResult` arms in the exact PRD §3.7 order.

### Alternatives considered and rejected

- **Changing `Evaluate`'s signature to express arity (variadic / operands slice / `Operands` struct).** Rejected: breaks the frozen API, touches every call site, leaks request-shape into the pure domain for no arithmetic gain (D-2, BC-5).
- **Keeping non-finite result detection in `httpapi` (the current `math.IsNaN/IsInf` backstop).** Rejected: the domain is the sole detection point (D-3); the HTTP backstop would duplicate the rule and could drift. The domain-side value check is the only mechanism that guarantees `encoding/json` never receives `NaN`/`±Inf` (AC-W3).
- **A local unary-set table in `httpapi` (e.g. `map[string]int` or `[]string{"sqrt","percent"}`).** Rejected: duplicates the operation table and can drift (R-6). `calc.Arity` is the single source of truth (AC-A4, D-11).
- **`sqrt` guard placed after `math.Sqrt` (or only a finiteness check).** Rejected: `math.Sqrt(-1)` is `NaN`, which would surface as `ErrNonFiniteResult` (`422 non-finite result`) instead of `ErrSqrtNegative` (`422 square root of negative number`) (R-3, D-4).
- **Special-casing `power(0, -1)` as `ErrDivideByZero`.** Rejected: `math.Pow(0,-1)` is `+Inf`, a non-finite *result*; divide-by-zero stays divide-only (AC-N4).
- **Server-side rounding/formatting of the result.** Rejected: the result stays a raw `float64` JSON number (NG-3, D-6).

---

## 3. File-by-file changes

### Modified files

| # | Path | One-line description |
|---|------|----------------------|
| 1 | `backend/internal/calc/calc.go` | Add `power`/`sqrt`/`percent` cases, `ErrSqrtNegative` + `ErrNonFiniteResult`, post-switch non-finite-result check, and `Arity`; add `math` import; refresh doc comments. |
| 2 | `backend/internal/calc/calc_test.go` | Extend `TestEvaluate` (new ops, normalization, non-finite, `sqrt` negative), add `TestEvaluateNegativeZero` and `TestArity`, extend `TestEvaluateConcurrent`. |
| 3 | `backend/internal/httpapi/httpapi.go` | Remove `errNonFiniteResult`; add `ErrSqrtNegative`/`ErrNonFiniteResult` arms to `writeError`; make `evaluateHandler` arity-aware via `calc.Arity`; delete post-`Evaluate` result check. |
| 4 | `backend/internal/httpapi/httpapi_test.go` | Replace `unknown/power|sqrt|percent` rows; add arity/presence, sqrt-negative, non-finite-result, normalized-unary, and negative-zero-result cases. |

### New files

None.

### Deleted files

None.

### Explicitly UNCHANGED

- `backend/go.mod` (module `sezzlecalc/backend`, `go 1.22`, requires only `testify v1.12.1` + indirect `go.yaml.in/yaml/v3`) and `backend/go.sum` — **no new requires** (AC-A5).
- `backend/cmd/server/main.go` — wiring only; no change (NG-7).
- Root `Makefile` — backend gates already cover the changed packages.

---

### File 1 — `backend/internal/calc/calc.go`

Changes, in place:

1. **Imports:** add `"math"` (for `math.Pow`, `math.Sqrt`, `math.IsNaN`, `math.IsInf`). `errors` and `strings` stay.
2. **Sentinels:** extend the existing `var (...)` block to four values (order: keep existing two, append the two new):

```go
var (
	// ErrDivideByZero is returned when dividing by a zero divisor.
	ErrDivideByZero = errors.New("division by zero")

	// ErrSqrtNegative is returned when computing the square root of a
	// negative number.
	ErrSqrtNegative = errors.New("square root of negative number")

	// ErrNonFiniteResult is returned when an operation's result is NaN or
	// infinite.
	ErrNonFiniteResult = errors.New("non-finite result")

	// ErrUnknownOperation is returned when the operation name is not one
	// of add, subtract, multiply, divide, power, sqrt, or percent after
	// normalization.
	ErrUnknownOperation = errors.New("unknown operation")
)
```

3. **`Evaluate` body:** restructure so each case assigns a `result` local instead of returning directly (except `divide`'s guard and the `default`), then perform the non-finite check once after the switch:

```go
func Evaluate(operation string, a, b float64) (float64, error) {
	op := strings.ToLower(strings.TrimSpace(operation))

	var result float64

	switch op {
	case "add":
		result = a + b
	case "subtract":
		result = a - b
	case "multiply":
		result = a * b
	case "divide":
		if b == 0 {
			return 0, ErrDivideByZero
		}
		result = a / b
	case "power":
		result = math.Pow(a, b)
	case "sqrt":
		if a < 0 {
			return 0, ErrSqrtNegative
		}
		result = math.Sqrt(a)
	case "percent":
		result = a / 100
	default:
		return 0, ErrUnknownOperation
	}

	if math.IsNaN(result) || math.IsInf(result, 0) {
		return 0, ErrNonFiniteResult
	}

	return result, nil
}
```

Contract-critical notes:

- The finiteness check runs **after** the switch and **before** the success return — i.e. on the success path of every operation, value-based (catches `+Inf`/`-Inf`/`NaN` regardless of origin). The raw non-finite value is discarded, matching the existing `(0, sentinel)` failure convention (AC-N10).
- `sqrt`'s `a < 0` guard is **before** `math.Sqrt(a)`, so `sqrt(-1)` → `ErrSqrtNegative`, never `ErrNonFiniteResult` (R-3). `sqrt(-0.0)`: `-0.0 < 0` is false, so the guard does not fire and `math.Sqrt(-0.0)` returns `-0.0` — a finite success (AC-N7; Go's `math.Sqrt` special-cases `x == 0` to return `x`, so the sign is preserved).
- Unary ops (`sqrt`, `percent`) read only `a`; `b` is never consulted (AC-A3).
- `divide` behavior (and `ErrDivideByZero`) is unchanged; `power(0, -1)` flows through `math.Pow` → `+Inf` → `ErrNonFiniteResult`, not `ErrDivideByZero` (AC-N4).

4. **`Arity` helper** (new, exported, additive — does not touch `Evaluate`):

```go
// Arity reports the number of operands an operation requires: (2, true) for
// the binary operations (add, subtract, multiply, divide, power), (1, true)
// for the unary operations (sqrt, percent), and (0, false) for an unknown
// operation. The name is normalized exactly like Evaluate.
func Arity(operation string) (int, bool) {
	switch strings.ToLower(strings.TrimSpace(operation)) {
	case "sqrt", "percent":
		return 1, true
	case "add", "subtract", "multiply", "divide", "power":
		return 2, true
	default:
		return 0, false
	}
}
```

5. **Doc comments:** update the package doc ("Errors are returned as sentinel values (ErrDivideByZero, ErrSqrtNegative, ErrNonFiniteResult, ErrUnknownOperation)…") and `Evaluate`'s doc (note the seven operations, unary `sqrt`/`percent` compute from `a` only, and non-finite results return `(0, ErrNonFiniteResult)`).

`package calc` still imports only `errors`, `math`, `strings` — no `net/http` (AC-A3).

---

### File 2 — `backend/internal/calc/calc_test.go`

Existing helpers and structure stay (table-driven, `t.Run` per case, `require.ErrorIs` + `require.Equal`). Changes:

1. **Extend `TestEvaluate`** (add rows; the struct gains an optional `notErr error` field asserted with `require.False(t, errors.Is(err, tc.notErr))` when non-nil — used to pin "not divide-by-zero" for `power(0,-1)`). New rows:

   | name | op | a | b | want | wantErr | notErr |
   |------|----|---|---|------|---------|--------|
   | power/positive | `power` | 2 | 10 | 1024 | nil | — |
   | power/negative-exponent | `power` | 2 | -2 | 0.25 | nil | — |
   | power/fractional-exponent | `power` | 4 | 0.5 | 2 | nil | — |
   | power/zero-zero | `power` | 0 | 0 | 1 | nil | — |
   | sqrt/positive | `sqrt` | 9 | 0 | 3 | nil | — |
   | sqrt/fractional | `sqrt` | 2 | 0 | `math.Sqrt(2)` | nil | — |
   | sqrt/zero | `sqrt` | 0 | 0 | 0 | nil | — |
   | sqrt/ignores-b | `sqrt` | 9 | 99 | 3 | nil | — |
   | percent/positive | `percent` | 50 | 0 | 0.5 | nil | — |
   | percent/negative | `percent` | -25 | 0 | -0.25 | nil | — |
   | percent/zero | `percent` | 0 | 0 | 0 | nil | — |
   | percent/ignores-b | `percent` | 50 | 7 | 0.5 | nil | — |
   | normalize/power/mixed-case | `PoWeR` | 2 | 3 | 8 | nil | — |
   | normalize/power/padded | ` power ` | 2 | 3 | 8 | nil | — |
   | normalize/sqrt/upper | `SQRT` | 9 | 0 | 3 | nil | — |
   | normalize/percent/mixed-case | ` PeRcEnT ` | 50 | 0 | 0.5 | nil | — |
   | non-finite/power/overflow | `power` | 10 | 400 | 0 | `ErrNonFiniteResult` | — |
   | non-finite/power/nan | `power` | -2 | 0.5 | 0 | `ErrNonFiniteResult` | — |
   | non-finite/power/zero-negative-exp | `power` | 0 | -1 | 0 | `ErrNonFiniteResult` | `ErrDivideByZero` |
   | non-finite/multiply/overflow | `multiply` | 1e308 | 10 | 0 | `ErrNonFiniteResult` | — |
   | sqrt/negative | `sqrt` | -1 | 0 | 0 | `ErrSqrtNegative` | — |

   All non-finite rows assert `want == 0` (raw non-finite discarded) and `wantErr == ErrNonFiniteResult` (AC-N10). The existing unknown rows (`mod`, `""`, `"   "`, `"plus"`) are **kept**; no `power`/`sqrt`/`percent` "unknown" rows exist in this file to remove (they exist only in `httpapi_test.go`).

2. **Add `TestEvaluateNegativeZero`** — distinct `0` vs runtime `-0.0` (AC-T2/AC-T3), using the existing `TestNegativeZeroConstruction` guard pattern (`negZero := math.Copysign(0, -1)`), asserting both value and `math.Signbit` (naive equality `-0.0 == 0.0` would pass vacuously — R-2):

   | name | op | a | want |
   |------|----|---|------|
   | sqrt | `sqrt` | `negZero` | `negZero` (Signbit true) |
   | percent | `percent` | `negZero` | `negZero` (Signbit true) |

   Each asserts `require.NoError(t, err)`, `require.Equal(t, tc.want, got)`, and `require.True(t, math.Signbit(got))` (AC-N7, AC-N8).

3. **Add `TestArity`** — table-driven coverage of the single source of truth (AC-A4, AC-R4, AC-H5):

   | name | op | wantArity | wantOK |
   |------|----|-----------|--------|
   | add/subtract/multiply/divide/power (binary) | `add` … `power` | 2 | true |
   | sqrt (unary) | `sqrt` | 1 | true |
   | percent (unary) | `percent` | 1 | true |
   | normalized | ` SQRT `, `Power` | 1 / 2 | true |
   | unknown | `mod`, `""`, `"   "` | 0 | false |

4. **Extend `TestEvaluateConcurrent`** (cheap mirror of value/error cases only, no Signbit):
   add `{"power", 2, 3, 8, nil}`, `{" SQRT ", 9, 0, 3, nil}`, `{"percent", 50, 0, 0.5, nil}`, `{"power", 10, 400, 0, ErrNonFiniteResult}`, `{"sqrt", -1, 0, 0, ErrSqrtNegative}`.

---

### File 3 — `backend/internal/httpapi/httpapi.go`

1. **Remove `errNonFiniteResult`** from the local sentinel block (line 30), leaving:

```go
var (
	errInvalidInput     = errors.New("invalid input")
	errMethodNotAllowed = errors.New("method not allowed")
	errInternal         = errors.New("internal error")
)
```

The `math` import **stays** (still used for the input finiteness backstop).

2. **`evaluateHandler`** — replace the current body (from the operand-presence check through the result check, i.e. lines 104–125) with the arity-aware flow:

```go
	// Arity-aware operand presence. The operation table lives only in
	// calc.Arity; unknown operations skip presence enforcement and delegate
	// to calc.Evaluate (ErrUnknownOperation → 422), regardless of operands.
	arity, ok := calc.Arity(req.Operation)
	if ok {
		if req.A == nil {
			s.writeError(w, errInvalidInput)
			return
		}
		switch arity {
		case 2: // add, subtract, multiply, divide, power
			if req.B == nil {
				s.writeError(w, errInvalidInput)
				return
			}
		case 1: // sqrt, percent
			if req.B != nil {
				s.writeError(w, errInvalidInput)
				return
			}
		}
	}

	// Non-finite input backstop (defensive; standard JSON cannot decode
	// NaN/Inf). Runs on whichever operands are present, known or unknown op.
	if req.A != nil && (math.IsNaN(*req.A) || math.IsInf(*req.A, 0)) {
		s.writeError(w, errInvalidInput)
		return
	}
	if req.B != nil && (math.IsNaN(*req.B) || math.IsInf(*req.B, 0)) {
		s.writeError(w, errInvalidInput)
		return
	}

	var a, b float64
	if req.A != nil {
		a = *req.A
	}
	if req.B != nil {
		b = *req.B
	}

	result, err := calc.Evaluate(req.Operation, a, b)
	if err != nil {
		s.writeError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, evaluateResponse{Result: result})
```

The new authoritative order (PRD §3.3): method → Content-Type → body cap → decode/trailing → **`calc.Arity`** → **(known) presence** → **(both) non-finite input backstop** → `calc.Evaluate` → success. The post-`Evaluate` `math.IsNaN/IsInf(result)` check and its `errNonFiniteResult` write are **removed**; the domain now guarantees finite-or-error (D-3).

Key semantics:

- **AC-H1** — binary missing/null `a` or `b` → `400` (arity 2, `req.A == nil` or `req.B == nil`).
- **AC-H2** — unary missing/null `a` → `400` (`req.A == nil`).
- **AC-H3** — unary with numeric `b` → `400` (arity 1, `req.B != nil`).
- **AC-H4** — unary with `b` omitted or `null` → both decode to `nil`, accepted.
- **AC-H6** — unknown op skips presence (`ok == false`), falls through to `calc.Evaluate` → `422 invalid operation`, regardless of operand presence. Nil operands are coerced to `0` before the call (safe: unknown ops ignore operands).
- **AC-E5** — non-finite input (the unreachable-in-practice defensive backstop, plus decode/overflow errors) stays `400`, never `422`.

Update the handler's doc comment to the new order: `method, Content-Type, body cap, decode, arity-aware presence, operand finiteness, calc.Evaluate, success`.

3. **`writeError`** — remove the `errNonFiniteResult` arm and insert the two domain arms in PRD §3.7 order:

```go
	switch {
	case errors.Is(err, errInvalidInput):
		status, message = http.StatusBadRequest, "invalid input"
	case errors.Is(err, calc.ErrDivideByZero):
		status, message = http.StatusUnprocessableEntity, "division by zero"
	case errors.Is(err, calc.ErrSqrtNegative):
		status, message = http.StatusUnprocessableEntity, "square root of negative number"
	case errors.Is(err, calc.ErrUnknownOperation):
		status, message = http.StatusUnprocessableEntity, "invalid operation"
	case errors.Is(err, calc.ErrNonFiniteResult):
		status, message = http.StatusUnprocessableEntity, "non-finite result"
	case errors.Is(err, errMethodNotAllowed):
		status, message = http.StatusMethodNotAllowed, "method not allowed"
	case errors.Is(err, errInternal):
		status, message = http.StatusInternalServerError, "internal error"
	default:
		status, message = http.StatusInternalServerError, "internal error"
	}
```

The logging block and `writeJSON` tail are unchanged. The mapper remains the authority over the client string (AC-E7): the sentinels' own messages happen to match, but `writeError` picks the literal.

---

### File 4 — `backend/internal/httpapi/httpapi_test.go`

Existing helpers (`serve`, `decodeEnvelope`, `assertErrorBody`) are unchanged. Changes to `TestEvaluate` (and one new test function):

1. **Replace** the three rows at lines 85–87 with real behavior; **update** the `non-finite/result` row to the PRD's exact `multiply(1e308, 10)`; **add** the arity/error/normalization rows. New/updated rows:

   | name | body | status | result | error |
   |------|------|--------|--------|-------|
   | power | `{"operation":"power","a":2,"b":10}` | 200 | 1024 | — |
   | sqrt (b omitted) | `{"operation":"sqrt","a":9}` | 200 | 3 | — |
   | percent (b omitted) | `{"operation":"percent","a":50}` | 200 | 0.5 | — |
   | unary/normalized | `{"operation":" SQRT ","a":9}` | 200 | 3 | — |
   | unary/b-null | `{"operation":"sqrt","a":9,"b":null}` | 200 | 3 | — |
   | unary-missing-a | `{"operation":"sqrt"}` | 400 | — | invalid input |
   | unary-null-a | `{"operation":"sqrt","a":null}` | 400 | — | invalid input |
   | unary-numeric-b | `{"operation":"sqrt","a":9,"b":2}` | 400 | — | invalid input |
   | unary-numeric-b/percent | `{"operation":"percent","a":50,"b":1}` | 400 | — | invalid input |
   | sqrt/negative | `{"operation":"sqrt","a":-1}` | 422 | — | square root of negative number |
   | non-finite/power/overflow | `{"operation":"power","a":10,"b":400}` | 422 | — | non-finite result |
   | non-finite/power/zero-neg-exp | `{"operation":"power","a":0,"b":-1}` | 422 | — | non-finite result |
   | non-finite/result | `{"operation":"multiply","a":1e308,"b":10}` | 422 | — | non-finite result |
   | unknown/mod-missing-b | `{"operation":"mod","a":8}` | 422 | — | invalid operation |
   | unknown/empty-no-operands | `{"operation":""}` | 422 | — | invalid operation |
   | overflow-1e999 | `{"operation":"add","a":1e999,"b":2}` | 400 | — | invalid input |

   The `nan-literal` / `infinity-literal` / `overflow-1e400` rows and all existing binary presence rows (`missing-a`, `missing-b`, `null-a`, `null-b`) are **kept** (AC-E5, AC-H1). No row asserts `power`/`sqrt`/`percent` as `invalid operation` anymore (AC-T7).

2. **Add `TestEvaluateNegativeZeroResult`** (mirrors the existing `TestEvaluateNegativeZeroDivisor` style): marshal `map[string]any{"operation": "sqrt", "a": negZero}` (and a second sub-case with `"percent"`), **guard** the wire carries `"a":-0`, then assert `200`, decode `evaluateResponse`, and assert `require.Equal(t, 0.0, got.Result)` **and** `require.True(t, math.Signbit(got.Result))` (AC-W2, AC-N7/AC-N8 at the wire level).

3. All other tests (`TestEvaluateContentType`, `TestEvaluateBodyCap`, `TestEvaluateBodyCapBoundary`, `TestMethodNotAllowed`, `TestHealth`, `TestUnknownPath`, `TestPanicRecovery`, `TestWriteErrorDefault`, `TestEvaluateNegativeZeroDivisor`, `TestNewHandlerNilLogger`) remain unchanged and must continue to pass.

---

## 4. Data, API & schema impact

- **Domain API expansion (additive):** new exported `func Arity(operation string) (int, bool)`; new exported sentinels `ErrSqrtNegative`, `ErrNonFiniteResult`. `Evaluate`'s signature and behavior for the existing four ops are unchanged except the new non-finite-result rule (AC-N9/N10).
- **Domain behavior change (BC-2):** `Evaluate` now returns `(0, ErrNonFiniteResult)` instead of `(<±Inf/NaN>, nil)` for non-finite results. The raw value is discarded.
- **HTTP client-visible changes (BC-1):** `power`, `sqrt`, `percent` now evaluate (`200`) instead of `422 invalid operation`. `sqrt` of a negative now returns `422 {"error":"square root of negative number"}`; overflowing results (`power(10,400)`, `power(0,-1)`, `multiply(1e308,10)`, …) return `422 {"error":"non-finite result"}` (unchanged wire body, but the origin moves from the HTTP layer to the domain — BC-3).
- **HTTP behavior change (D-1, BC vs. old):** an unknown op with a missing operand now returns `422 invalid operation` (previously `400 invalid input`), because the operation name is validated first (AC-H6).
- **Request/response envelopes:** unchanged — success `{"result": <number>}`, error `{"error":"<string>"}` with no `result` on error. `evaluateResponse{Result float64}` stays; `encoding/json` encodes the raw float (`4.0`→`4`, `-0.0`→`-0`); no rounding/formatting (D-6, AC-W1/W2).
- **Closed error vocabulary (AC-E7):** `invalid input` (400), `division by zero` (422), `square root of negative number` (422), `invalid operation` (422), `non-finite result` (422), `method not allowed` (405), `internal error` (500). No raw sentinel message/wrapped cause/stack/path leaks.
- **No migrations, no config, no env vars, no new deps** (AC-A5). `go.mod`/`go.sum` unchanged.
- **Downstream consumers:** none in this worktree (frontend absent, D-10). The future frontend consumes the seven operations and the five `4xx` error strings per `api-contract`.

---

## 5. Test strategy

All tests are table-driven with `t.Run` per case, assert **both value and error** via `require.ErrorIs` (domain) and **status + envelope shape + exact decoded value** via `decodeEnvelope`/`assertErrorBody` (HTTP), and must pass under `go test -race ./...` (AC-T1).

Plan steps referenced in the traceability table:

- **S1** — `calc.go`: sentinels, `math` import, extended `Evaluate` (post-switch finiteness check; `sqrt` guard before `math.Sqrt`), `Arity`.
- **S2** — `calc_test.go`: extended `TestEvaluate`, new `TestEvaluateNegativeZero`, new `TestArity`, extended `TestEvaluateConcurrent`.
- **S3** — `httpapi.go`: remove `errNonFiniteResult` + result check; arity-aware handler; new `writeError` arms.
- **S4** — `httpapi_test.go`: replace/update rows; add arity, sqrt-negative, non-finite-result, normalized-unary, negative-zero-result cases.
- **S5** — quality gates (`make backend-build` / `-test` / `-vet` / `-cover`).

### Traceability: PRD acceptance criteria → plan step / test

| AC | Criterion (short) | Plan step | Test covering it |
|----|-------------------|-----------|------------------|
| AC-A1 | `Evaluate` signature unchanged | S1 (body only; signature frozen) | All `calc` tests still call the unchanged signature |
| AC-A2 | `ErrSqrtNegative` + `ErrNonFiniteResult` exported sentinels | S1 | `TestEvaluate` `sqrt/negative`, `non-finite/*` (via `require.ErrorIs`) |
| AC-A3 | unary ops ignore `b`; no `net/http` in `calc` | S1 (unary cases; imports `errors/math/strings` only) | `TestEvaluate` `sqrt/ignores-b`, `percent/ignores-b` |
| AC-A4 | arity single source of truth (`calc.Arity`); httpapi no local table | S1 `Arity`; S3 calls `calc.Arity` | `TestArity`; HTTP arity rows |
| AC-A5 | no new dependency; `go.mod`/`go.sum` unchanged | S1–S4 (stdlib + existing testify only) | S5 gate `git status`/go.mod diff |
| AC-R1 | exactly seven canonical operations | S1 switch | `TestEvaluate` rows across all seven |
| AC-R2 | case-insensitive + trim for all seven | S1 normalization | `TestEvaluate` `normalize/*` rows |
| AC-R3 | unknown → `ErrUnknownOperation` | S1 `default` | `TestEvaluate` `unknown/mod`, `unknown/empty`, `unknown/whitespace-only`, `unknown/alias-plus` |
| AC-R4 | `sqrt`/`percent` unary; others binary | S1 `Arity` | `TestArity` |
| AC-F1 | `power` = `math.Pow` | S1 `power` case | `TestEvaluate` `power/positive`, `power/negative-exponent`, `power/fractional-exponent` |
| AC-F2 | `sqrt` = `math.Sqrt` for `a >= 0` | S1 `sqrt` case | `TestEvaluate` `sqrt/positive`, `sqrt/fractional`, `sqrt/zero` |
| AC-F3 | `percent` = `a/100` | S1 `percent` case | `TestEvaluate` `percent/positive`, `percent/negative`, `percent/zero` |
| AC-F4 | four existing ops arithmetic unchanged | S1 (cases untouched) | existing `add/subtract/multiply/divide` rows |
| AC-F5 | all seven reachable via `POST /evaluate` | S3 + S4 | `TestEvaluate` happy rows for all seven |
| AC-N1 | `power(0,0)` = `(1,nil)` | S2 | `TestEvaluate` `power/zero-zero` |
| AC-N2 | `power(10,400)` = `(0,ErrNonFiniteResult)` | S1 check; S2 | `TestEvaluate` `non-finite/power/overflow` |
| AC-N3 | `power(-2,0.5)` = `(0,ErrNonFiniteResult)` | S1; S2 | `TestEvaluate` `non-finite/power/nan` |
| AC-N4 | `power(0,-1)` = `ErrNonFiniteResult`, not `ErrDivideByZero` | S1; S2 (`notErr`) | `TestEvaluate` `non-finite/power/zero-negative-exp` (`notErr: ErrDivideByZero`) |
| AC-N5 | `sqrt(a<0)` = `(0,ErrSqrtNegative)` | S1 guard before `math.Sqrt`; S2 | `TestEvaluate` `sqrt/negative` |
| AC-N6 | `sqrt(0)` = `(+0,nil)` | S1; S2 | `TestEvaluate` `sqrt/zero` |
| AC-N7 | `sqrt(-0.0)` = `(-0.0,nil)`, Signbit true | S1; S2 | `TestEvaluateNegativeZero`/sqrt |
| AC-N8 | `percent(50)=0.5`; `percent(-0.0)=-0.0` Signbit true | S1; S2 | `TestEvaluate` `percent/positive`; `TestEvaluateNegativeZero`/percent |
| AC-N9 | `multiply(1e308,10)` = `(0,ErrNonFiniteResult)` | S1; S2 | `TestEvaluate` `non-finite/multiply/overflow` |
| AC-N10 | any non-finite result → `(0,ErrNonFiniteResult)`, raw discarded | S1 post-switch check | all four `non-finite/*` rows assert `want == 0` |
| AC-N11 | finite results (incl `+0`/`-0.0`) never `ErrNonFiniteResult` | S1 (check is `IsNaN‖IsInf`) | `sqrt/zero`, `TestEvaluateNegativeZero` (nil error) |
| AC-H1 | binary missing/null `a`/`b` → 400 | S3 (arity 2 presence) | `TestEvaluate` `missing-a/b`, `null-a/b` |
| AC-H2 | unary missing/null `a` → 400 | S3 (`req.A == nil`) | `TestEvaluate` `unary-missing-a`, `unary-null-a` |
| AC-H3 | unary numeric `b` → 400 | S3 (arity 1, `req.B != nil`) | `TestEvaluate` `unary-numeric-b`, `unary-numeric-b/percent` |
| AC-H4 | unary `b` omitted/null → accepted | S3 (nil passes) | `TestEvaluate` `sqrt`/`percent` (b omitted), `unary/b-null` |
| AC-H5 | arity from normalized name via `calc.Arity` | S3 calls `calc.Arity(req.Operation)` | `TestEvaluate` `unary/normalized` (`" SQRT "`) |
| AC-H6 | unknown op → 422 regardless of operand presence | S3 (skip presence when `ok == false`) | `TestEvaluate` `unknown/mod-missing-b`, `unknown/empty-no-operands` |
| AC-E1 | `ErrSqrtNegative` → 422 `square root of negative number` | S3 `writeError` arm | `TestEvaluate` `sqrt/negative` |
| AC-E2 | `ErrNonFiniteResult` → 422 `non-finite result` | S3 `writeError` arm | `TestEvaluate` `non-finite/power/overflow`, `non-finite/power/zero-neg-exp`, `non-finite/result` |
| AC-E3 | `ErrDivideByZero` → 422 `division by zero` | S3 (unchanged arm) | `TestEvaluate` `divide-by-zero/positive`; `TestEvaluateNegativeZeroDivisor` |
| AC-E4 | `ErrUnknownOperation` → 422 `invalid operation` | S3 (unchanged arm) | `TestEvaluate` `unknown/mod`, `unknown/empty` |
| AC-E5 | non-finite input → 400, never 422 | S3 (decode/backstop) | `TestEvaluate` `overflow-1e400`, `overflow-1e999`, `nan-literal`, `infinity-literal` |
| AC-E6 | `errNonFiniteResult` + result check removed; domain sole detection | S3 (deletions) | `non-finite/result` row still 422 (now domain-originated) |
| AC-E7 | closed vocab; no raw/cause/stack/path leak | S3 mapper | `assertErrorBody` everywhere; `TestWriteErrorDefault`; `TestPanicRecovery` |
| AC-W1 | raw JSON number, no rounding/formatting | S3 (`evaluateResponse{Result float64}` unchanged) | `TestEvaluate` happy rows (decoded) |
| AC-W2 | `4.0`→`4`; `-0.0`→`-0`; decoded value + Signbit | S3/S4 | `TestEvaluate` `add/fractional` (decoded 4); `TestEvaluateNegativeZeroResult` |
| AC-W3 | `NaN`/`±Inf` never reach `encoding/json` | S1 domain check | all `non-finite/*` rows return 422 (encoder never sees non-finite) |
| AC-T1 | calc tests table-driven, `t.Run`, value+error via `errors.Is` | S2 | `TestEvaluate` structure |
| AC-T2 | calc distinct `0`/`-0.0` via `math.Copysign` | S2 | `TestEvaluateNegativeZero` (+ `TestNegativeZeroConstruction` guard) |
| AC-T3 | `power(0,0)=1`, `sqrt(0)`, `sqrt(-0.0)=-0.0` (Signbit) | S2 | `power/zero-zero`, `sqrt/zero`, `TestEvaluateNegativeZero`/sqrt |
| AC-T4 | all non-finite cases + `sqrt` negative | S2 | `non-finite/*` + `sqrt/negative` |
| AC-T5 | httpapi unary/binary arity incl `b` omitted and `b:null` | S4 | `unary-missing-a`, `unary-numeric-b`, `unary/b-null`, `sqrt`/`percent` b-omitted, `missing-a/b`, `null-a/b` |
| AC-T6 | httpapi sqrt-negative + three non-finite-result | S4 | `sqrt/negative`; `non-finite/power/overflow`, `non-finite/power/zero-neg-exp`, `non-finite/result` |
| AC-T7 | former `unknown/power|sqrt|percent` replaced; none assert invalid-operation | S4 | new `power`/`sqrt`/`percent` rows replace lines 85–87 |
| AC-T8 | non-finite-input regressions stay 400 | S4 | `overflow-1e400`, `overflow-1e999`, `nan-literal`, `infinity-literal` |
| AC-Q1 | `make backend-build` succeeds | S5 | gate 3 |
| AC-Q2 | `make backend-test` (`-race`) passes | S5 | gate 4 |
| AC-Q3 | `make backend-vet` passes; `gofmt -l` empty | S5 | gate 5 |
| AC-Q4 | `make backend-cover` writes `coverage.txt`; new branches covered | S5 | gate 6 |

---

## 6. Risks & edge cases

- **R-1 — contract/doc drift on the operation set (low after this change).** The prior `http-api-layer.md` declared `power`/`sqrt`/`percent` out of scope and its tests asserted `invalid operation`. This feature supersedes that (BC-1/BC-4). Mitigated by AC-R1/AC-T7; after this change code, tests, and contract agree on seven operations.
- **R-2 — negative-zero tests passing vacuously (medium).** An untyped `-0.0` literal collapses to `+0.0`, and `-0.0 == 0.0`, so naive equality cannot distinguish signs. Mitigated by constructing `-0.0` at runtime via `math.Copysign(0, -1)` and asserting `math.Signbit` (AC-T2/T3; `TestEvaluateNegativeZero`, `TestEvaluateNegativeZeroResult`).
- **R-3 — `sqrt(-1)` misclassified as non-finite (low).** `math.Sqrt(-1)` is `NaN`; if the negative guard ran after `math.Sqrt`, it would surface as `ErrNonFiniteResult`. Mitigated by guarding `a < 0` **before** `math.Sqrt` (D-4, AC-N5/E1).
- **R-4 — `power(0,-1)` misclassified as divide-by-zero (low).** `math.Pow(0,-1)` is `+Inf`, not a zero-divisor. Mitigated by `power` flowing through `math.Pow` → the non-finite check, and a `notErr: ErrDivideByZero` assertion (AC-N4).
- **R-5 — invalid JSON emitted after a `200` (low).** If the domain ever returned a non-finite value on success, `encoding/json` would fail mid-encode after the status was written. Mitigated by the domain-side value check (D-3, AC-N10/W3); the HTTP layer no longer has any non-finite detection to forget.
- **R-6 — arity/op-table drift between domain and HTTP (low→medium).** A second hard-coded unary set in `httpapi` could diverge. Mitigated by `calc.Arity` as the single source of truth (AC-A4/H5).
- **R-7 — unknown-op precedence change (low).** For an unknown op with a missing operand, behavior changes from `400` to `422 invalid operation` (D-1). Intentional and pinned by AC-H6.
- **Edge — unknown op with a non-finite present operand.** Unreachable through standard JSON (NaN/Inf literals and overflowing literals fail decode), but the defensive input backstop runs before `calc.Evaluate` even for unknown ops, so it would return `400` (consistent with AC-E5), never a domain `422`.
- **Edge — `sqrt`/`percent` `b` coercion.** For known unary ops `b` is guaranteed `nil` (numeric `b` → 400), so `b` is coerced to `0` and ignored; for unknown ops `a`/`b` are coerced to `0` and ignored. The nil-coercion code path is safe because every known op has its required operands present by that point.
- **Edge — `-0.0` on the wire.** `json.Marshal` of a runtime `-0.0` produces `-0`; tests guard the wire bytes before asserting (mirrors the existing `TestEvaluateNegativeZeroDivisor` guard).
- **Concurrency.** `package calc` is a pure package of total functions (no shared mutable state); `httpapi`'s `server` holds only an immutable logger. `go test -race ./...` passes with no per-request state.

---

## 7. Rollout & rollback

This is an in-place change to four files in two packages, with no consumers in this worktree and no flags/config.

**Rollout order (implementation order):**

1. Confirm the isolated worktree (below) — never the main checkout.
2. **S1** — edit `backend/internal/calc/calc.go` (sentinels, `math` import, extended `Evaluate`, `Arity`, doc comments).
3. **S2** — edit `backend/internal/calc/calc_test.go` (extend `TestEvaluate`, add `TestEvaluateNegativeZero` + `TestArity`, extend `TestEvaluateConcurrent`); run `cd backend && go test ./internal/calc/` to confirm the domain in isolation.
4. **S3** — edit `backend/internal/httpapi/httpapi.go` (remove `errNonFiniteResult` + result check, arity-aware handler, new `writeError` arms).
5. **S4** — edit `backend/internal/httpapi/httpapi_test.go` (replace/update rows, add new cases); run `cd backend && go test ./internal/httpapi/`.
6. Run the full gates (`gofmt -w` the changed files first):
   - `cd backend && gofmt -l .` → empty.
   - `cd backend && go vet ./...` → clean.
   - `cd backend && go build ./...` → success.
   - `cd backend && go test -race ./...` → pass.
   - `cd backend && go test -coverprofile=coverage.txt ./... && go tool cover -func=coverage.txt` → new branches covered.
   - `make backend-build backend-test backend-vet backend-cover` → all succeed.
   - `git status --short` → only the four modified files; `go.mod`, `go.sum`, `cmd/server/main.go` unchanged.
7. Confirm `internal/calc` still imports no `net/http` (grep).

**Rollback.** Revert the four files (`git checkout -- backend/internal/calc/calc.go backend/internal/calc/calc_test.go backend/internal/httpapi/httpapi.go backend/internal/httpapi/httpapi_test.go`). No migration, flag, config, or dependency rollback exists; `go.mod`/`go.sum` are untouched. The service returns to shipping four operations with the HTTP-layer non-finite check. Note this restores the pre-feature behavior (BC-1/BC-2 revert too), which is the intended rollback target.

**Sequencing note.** Do **not** run `make check` (it depends on the not-yet-present frontend targets). Run the backend gates individually.

### Confirming the isolated worktree (before any edit)

Per `AGENTS.md`, implementation happens in the isolated `git gtr` worktree. Verify before editing:

1. `git rev-parse --show-toplevel` prints `/Users/juancamilocortesmedina/workspace/sezzlecalc-worktrees/extra-operations`.
2. `test -f .git && echo "worktree (.git is a file)"` → must print `worktree (.git is a file)`.
3. `git worktree list` shows the path as a linked worktree.
4. `git status --short` is clean before starting.
5. Confirm the four target files exist and `backend/cmd/server/main.go`, `backend/go.mod`, `backend/go.sum` are present (to be left untouched).

---

## 8. Open questions

None blocking — the PRD is RESOLVED (all four OQ-1…OQ-4 decided; D-1…D-11 recorded). Remaining non-blocking notes for the human at coding time:

1. **`api-contract` skill is already consistent** (seven operations and both new error strings are present at `.opencode/skills/api-contract/SKILL.md` lines 27–37 and 68–74), so no doc-sync follow-up is required for this feature.
2. **Normalization duplication.** `Evaluate` and `Arity` both inline `strings.ToLower(strings.TrimSpace(operation))` (matching the existing single-call-site style and the "prefer existing patterns over new abstractions" guidance). If the reviewer prefers a shared private `normalize(operation string) string` helper to eliminate the two-line duplication, that is a trivial, non-behavioral refactor and acceptable — but not required.
3. **Unreachable defensive backstop for unknown-op + non-finite operand.** Per §3.3, the input finiteness backstop still runs for unknown operations with present operands (returning `400` before the `422`), though the path is unreachable through standard JSON. This matches AC-E5 and is intentional.
