# PRD: Extra Operations (`power`, `sqrt`, `percent`) + Deterministic Numeric Behavior

- **Status:** Resolved — all open questions decided; ready for design/planning
- **Owner:** Backend / TPM
- **Source of truth:** `.opencode/skills/api-contract/SKILL.md` (operation names, operands, exact error strings)
- **Related conventions:** `.opencode/skills/go-http-service/SKILL.md`
- **Depends on:** `internal/calc` (`docs/opencode/prds/calc-domain-package.md`), HTTP layer (`docs/opencode/prds/http-api-layer.md`)
- **Repo:** `sezzlecalc` (Go backend + React/Vite/TS frontend)
- **Scope level:** Backend only — `internal/calc` + `internal/httpapi`. No `cmd/` change, no frontend.

---

## 1. Goal

Extend the calculator domain and HTTP surface to support the **remaining three contract
operations** — `power` (binary, `a ** b`), `sqrt` (unary), and `percent` (unary,
`a / 100`) — bringing the shipped operation set to **all seven** operations in the
`api-contract` skill, and pin down **deterministic numeric behavior** for the edge
cases the contract and QA notes call out.

Concretely:

- `internal/calc` gains `power`, `sqrt`, and `percent`, with new sentinel errors for
  the two new failure modes (square root of a negative number; non-finite result).
- The **non-finite RESULT check moves into the domain**, so `encoding/json` can never
  receive `NaN`/`±Inf` and can never emit invalid JSON mid-encode after a `200` status
  has already been written.
- `internal/httpapi` learns the **unary rule** (`b` omitted for `sqrt`/`percent`) and
  maps the two new domain sentinels to the contract's exact `422` strings.
- The frontend does not exist in this worktree (verified: no `frontend/**` files), so
  this PRD is backend-only.

### 1.1 Non-goals (explicitly out of scope)

| # | Out of scope | Note |
|---|--------------|------|
| NG-1 | Any frontend change (React/Vite/TS) | The `frontend/` tree is absent in this worktree (verified by glob); nothing to change. Follow-up for the frontend worktree/phase. |
| NG-2 | An expression parser, multi-operand expressions, or operand chaining | Single operation per request, as today. |
| NG-3 | Server-side rounding, significant-digit capping, or string number formatting | The result is a raw JSON number (§3.9). |
| NG-4 | Reworking routing, `Content-Type`, body cap, method enforcement, panic recovery, or `GET /health` | Delivered by `http-api-layer.md`; unchanged here. |
| NG-5 | Reworking the request/response envelope shapes | Success stays `{"result": <number>}`; error stays `{"error":"<string>"}`. |
| NG-6 | CORS, graceful shutdown, config via flags/env, persistence, auth, i18n, CI/CD, observability, rate limiting | Repo-wide out of scope. |
| NG-7 | Changing `cmd/server/main.go` | Wiring only; no change required for extra operations. |
| NG-8 | Non-finite *input* handling changes | Must remain `400 invalid input`; explicitly preserved (§3.8, AC-E5). |
| NG-9 | New error strings beyond the contract vocabulary | `square root of negative number` and `non-finite result` already exist in the contract. |

---

## 2. Background & current state

- Module `sezzlecalc/backend` (`backend/go.mod`, `go 1.22`, no `toolchain` line).
  Dependencies already present: `github.com/stretchr/testify v1.12.1` (test-only) and
  `go.yaml.in/yaml/v3 v3.0.5` (indirect). No new dependency is needed for this feature
  (`math`, `errors`, `strings` are stdlib).
- **Domain** `backend/internal/calc/calc.go`:
  - `func Evaluate(operation string, a, b float64) (float64, error)` — signature is
    documented as **fixed** in `calc-domain-package.md` (§3.1/AC-A1).
  - Normalization: `op := strings.ToLower(strings.TrimSpace(operation))`, then a
    `switch` over exactly `add`, `subtract`, `multiply`, `divide`.
  - Sentinels: `var ErrDivideByZero = errors.New("division by zero")` and
    `var ErrUnknownOperation = errors.New("unknown operation")`.
  - On failure it returns `(0, <sentinel>)`; non-finite operands currently pass through
    with IEEE-754 semantics and there is **no** result-finiteness check.
- **Tests** `backend/internal/calc/calc_test.go`: table-driven `TestEvaluate` +
  `TestEvaluateConcurrent`; covers the four ops, normalization, unknown ops, and the
  `-0.0` divisor (built at runtime with `math.Copysign(0, -1)`).
- **HTTP layer** `backend/internal/httpapi/httpapi.go`:
  - `type evaluateRequest struct { Operation string; A *float64; B *float64 }` —
    pointer fields already distinguish "missing/null" from a legitimate `0`.
  - Local sentinels: `errInvalidInput`, `errNonFiniteResult`, `errMethodNotAllowed`,
    `errInternal`. The **non-finite RESULT check currently lives here** (lines 120–123:
    `if math.IsNaN(result) || math.IsInf(result, 0) { s.writeError(w, errNonFiniteResult) }`).
  - Order today (lines 104–125): require **both** `A` and `B` present (else `400`),
    check operand finiteness (else `400`), call `calc.Evaluate`, then check result
    finiteness (`422 non-finite result`), then `200`.
  - `writeError` is the single `errors.Is` → (status, string) mapper; there is currently
    **no** mapping for a `sqrt`-negative error and **no** domain non-finite-result
    sentinel.
- **Tests** `backend/internal/httpapi/httpapi_test.go`: table-driven
  `TestEvaluate`, plus negative-zero divisor, Content-Type, body cap, method, health,
  unknown path, panic-recovery, and default-mapper tests. It currently asserts
  `unknown/power`, `unknown/sqrt`, and `unknown/percent` → `422 invalid operation`
  (lines 85–87) — **these three cases become wrong** once the ops are implemented and
  must be replaced.
- **Contract** `.opencode/skills/api-contract/SKILL.md`:
  - Operations table already lists all **seven** ops, with `sqrt` and `percent` taking a
    single operand and **omitting `b`** (lines 27–37).
  - Error taxonomy (lines 68–74): `400 invalid input`, `422 division by zero`,
    `422 square root of negative number`, `422 invalid operation`, `422 non-finite result`.
- Root `Makefile` gates: `backend-build` (`go build ./...`), `backend-test`
  (`go test -race ./...`), `backend-vet` (`go vet ./...` + `gofmt -l .` empty),
  `backend-cover`.
- Worktree rule (`AGENTS.md`): implementation happens inside a `git gtr` worktree.

### 2.1 Breaking changes introduced by this feature (flagged)

This feature is **not purely additive**; it changes previously delivered behavior.

| Flag | Change | Impact |
|------|--------|--------|
| **BC-1** | `power`/`sqrt`/`percent` change from `422 invalid operation` to real behavior. | Client-visible. Any caller relying on the old "unknown operation" response for these names breaks. `http-api-layer.md` NG-1/NG-2 are superseded. |
| **BC-2** | `calc.Evaluate` no longer returns a non-finite value with `nil` error. | Domain-contract change. Direct callers that relied on receiving `±Inf`/`NaN` (e.g. from `multiply(1e308,10)`) now get `(0, ErrNonFiniteResult)`. |
| **BC-3** | The HTTP-layer local `errNonFiniteResult` sentinel and its post-`Evaluate` result check are removed (single-source-of-truth decision, §3.5). | Internal (unexported) refactor; wire response for `multiply(1e308,10)` stays `422 non-finite result`, but the origin moves to the domain. |
| **BC-4** | `unknown/*` test cases for `power`/`sqrt`/`percent` in `httpapi_test.go` must be deleted/replaced. | Test-only, but they currently encode the OLD contract. |
| **BC-5 (NOT a break)** | `Evaluate`'s **signature is unchanged** (`func Evaluate(operation string, a, b float64) (float64, error)`). | The signature is kept (§3.1). A signature change expressing arity would be the real API break and is rejected. |

---

## 3. Functional requirements

### 3.1 Domain API surface & signature (decision D-2)

**Recommended: keep `func Evaluate(operation string, a, b float64) (float64, error)`
unchanged.**

- Rationale: the domain stays a **pure, total function over `(operation, a, b)`**;
  operation-name matching + arithmetic remain its concern. **Arity is a wire/presence
  concern**, not arithmetic, so it is enforced at the HTTP boundary. Changing the
  signature (variadic, an operands slice, or an `Operands` struct) would break the
  previously-frozen API, touch every call site, and leak request-shape concerns into
  the domain for no arithmetic gain.
- Unary ops (`sqrt`, `percent`) compute from `a` only and **ignore `b`** inside the
  domain; `b` is never consulted for their result.
- The domain continues to return `(0, <sentinel>)` on failure (existing convention) and
  `(<value>, nil)` on success.

To avoid duplicating the operation table/normalization in the HTTP layer, the domain
exposes the operation metadata as a small pure helper
`func Arity(operation string) (int, bool)`, normalized identically to `Evaluate`
(resolved: OQ-3 / D-11). `internal/httpapi` calls it and holds **no** local unary set.
This is an **additive** API expansion; it does not change `Evaluate`.

New/continued exported symbols in `package calc`:

```go
func Evaluate(operation string, a, b float64) (float64, error) // UNCHANGED signature
func Arity(operation string) (int, bool)                       // NEW: required operands, normalized

var ErrDivideByZero    = errors.New("division by zero")   // existing
var ErrUnknownOperation = errors.New("unknown operation") // existing
var ErrSqrtNegative    = errors.New("square root of negative number") // NEW
var ErrNonFiniteResult = errors.New("non-finite result")  // NEW
```

### 3.2 Operation set & normalization

The recognized operation set becomes **exactly the seven** contract operations:

| `operation` | Arity | Computation |
|-------------|-------|-------------|
| `add` | binary | `a + b` |
| `subtract` | binary | `a - b` |
| `multiply` | binary | `a * b` |
| `divide` | binary | `a / b` (guarded: `b == 0` → `ErrDivideByZero`) |
| `power` | binary | `math.Pow(a, b)` |
| `sqrt` | **unary** | `math.Sqrt(a)` (guarded: `a < 0` → `ErrSqrtNegative`) |
| `percent` | **unary** | `a / 100` |

- Matching for **all seven** is **case-insensitive** and **trims surrounding
  whitespace**, reusing the existing `strings.ToLower(strings.TrimSpace(operation))`
  normalization in `calc.go` (so `"PowE R"` is not valid, but `" Power "`, `"SQRT"`,
  `" Percent "` all resolve).
- Anything that does not normalize to one of the seven → `ErrUnknownOperation`
  (unchanged fallback for `"mod"`, `""`, `"   "`, etc.).
- No aliases are introduced.

### 3.3 Arity & operand-presence rules (decision D-1)

The request type is already `A *float64` / `B *float64`, so **missing** and explicit
**`null`** both decode to `nil` and are indistinguishable (as today). Presence rules:

| Operation class | `a` | `b` |
|-----------------|-----|-----|
| Binary (`add`, `subtract`, `multiply`, `divide`, `power`) | **required** (`nil` → `400 invalid input`) | **required** (`nil` → `400 invalid input`) |
| Unary (`sqrt`, `percent`) | **required** (`nil` → `400 invalid input`) | **must be omitted** (see below) |
| Unknown (`mod`, `""`, …) | not enforced (delegated) | not enforced (delegated) |

- **Unary `b` omitted:** `b` absent **or** explicit `null` decodes to `nil` and is
  treated as "omitted" → accepted.
- **Unary with a numeric `b`:** `req.B != nil` (a real number was supplied) →
  **`400 invalid input`** (resolved: OQ-1 / D-1; strict — the contract says unary ops
  "omit `b`").
- **Arity source:** the HTTP layer determines arity from the **normalized** operation
  name via `calc.Arity` (resolved: OQ-3 / D-11); there is no second hard-coded op table
  in `internal/httpapi`.

**Authoritative `POST /evaluate` order (updated):**

1. Method check → `405 method not allowed`.
2. Content-Type check → `400 invalid input`.
3. Body cap (`MaxBytesReader(w, r.Body, 1024)`).
4. Decode → `400 invalid input` (malformed/empty/trailing/wrong-type/overflow literal).
5. Determine arity from the normalized `operation`.
6. **If the operation is unknown:** skip presence enforcement and delegate to
   `calc.Evaluate` → `422 invalid operation` (§3.3 / D-1). Non-finite input backstop
   still applies if operands are present.
7. **If known:** enforce presence per the table above → `400 invalid input` on violation.
8. Operand finiteness backstop on the present operands → `400 invalid input`.
9. `result, err := calc.Evaluate(req.Operation, a, b)`; on `err` → mapper (§3.7).
10. Success → `200 {"result": <number>}`. (The old HTTP-layer result-finiteness check is
    removed; the domain now guarantees finite-or-error — §3.5.)

> **Precedence note (resolved: D-1):** the operation name is validated first, so for a
> known op presence/finiteness (`400`) precedes the domain call, while for an **unknown**
> op `invalid operation` (`422`) takes precedence over `400 invalid input` for a missing
> operand, regardless of operand presence. This differs from the pre-feature behavior
> (where a missing `b` → `400` even for an unknown op).

### 3.4 Numeric semantics (decision D-5)

Use Go's `math` package; no custom approximations. Consequence table:

| Input | Result | Classification |
|-------|--------|----------------|
| `power(0, 0)` | `1` | finite success |
| `power(10, 400)` | `math.Pow` → `+Inf` | non-finite → `ErrNonFiniteResult` |
| `power(-2, 0.5)` | `math.Pow` → `NaN` | non-finite → `ErrNonFiniteResult` |
| `power(0, -1)` | `math.Pow` → `+Inf` | non-finite → `ErrNonFiniteResult` (**NOT** `ErrDivideByZero`) |
| `power(2, 10)` | `1024` | finite success |
| `sqrt(0)` | `+0` | finite success |
| `sqrt(-0.0)` | `-0.0` | finite success (`-0.0 < 0` is **false** in IEEE-754) |
| `sqrt(-1)` | — | `ErrSqrtNegative` (checked **before** `math.Sqrt`) |
| `percent(50)` | `0.5` | finite success |
| `percent(-0.0)` | `-0.0` | finite success (sign preserved) |
| `multiply(1e308, 10)` | `+Inf` | non-finite → `ErrNonFiniteResult` |

- `ErrDivideByZero` remains **divide-only**. `power(0, -1)` is a non-finite *result*,
  not a division-by-zero.
- Finite inputs to `sqrt`/`percent` (non-negative for `sqrt`) always yield finite
  results, so those ops only produce `ErrSqrtNegative`, never `ErrNonFiniteResult`.

### 3.5 Non-finite result detection lives in the domain (decision D-3)

- The domain **detects a non-finite result before returning** and returns
  `(0, ErrNonFiniteResult)` instead of the raw `±Inf`/`NaN`. The raw non-finite value is
  **discarded** (consistent with the existing `(0, sentinel)` failure convention).
- This is the mechanism that guarantees `encoding/json` can never receive `NaN`/`±Inf`
  (which would otherwise fail mid-encode after a `200` was already written). Detection is
  **value-based**: it catches any non-finite result, including one arising from a
  non-finite operand passed directly to the package. (Through the HTTP API, non-finite
  operands are rejected at `400` before `Evaluate` is called, §3.8.)
- **HTTP-layer decision (resolved: OQ-4 / D-3):** **remove** the local
  `errNonFiniteResult` sentinel and the post-`Evaluate` `math.IsNaN/IsInf(result)` check
  (`httpapi.go` lines 120–123), and map `calc.ErrNonFiniteResult` → `422 non-finite
  result` in `writeError`. The domain is the **sole** non-finite detection point; no
  defensive HTTP backstop is added.
- The wire response for an overflowing result is unchanged (`422 non-finite result`);
  only its origin moves from the HTTP layer to the domain.

### 3.6 `sqrt` of a negative number (decision D-4)

- New domain sentinel `ErrSqrtNegative`; the guard is `if a < 0 { return 0, ErrSqrtNegative }`
  executed **before** `math.Sqrt(a)`, so the raw `NaN` from `math.Sqrt(-1)` never
  escapes.
- `sqrt(-0.0)`: IEEE-754 makes `-0.0 < 0` **false**, so the guard is not triggered and
  `math.Sqrt(-0.0)` returns `-0.0` → **finite success**. `sqrt` of a strictly negative
  number (e.g. `-1`) → `ErrSqrtNegative`.
- Mapping: `ErrSqrtNegative` → `422 {"error":"square root of negative number"}` (the
  exact contract string).

### 3.7 Error taxonomy mapping (`internal/httpapi.writeError`)

| `errors.Is(err, …)` | Status | `error` string | Origin |
|---------------------|--------|----------------|--------|
| `errInvalidInput` (local) | `400` | `invalid input` | Content-Type, decode, body cap, operand presence/arity, non-finite **input** |
| `calc.ErrDivideByZero` | `422` | `division by zero` | Domain (`divide` only) |
| `calc.ErrSqrtNegative` **(new)** | `422` | `square root of negative number` | Domain (`sqrt`) |
| `calc.ErrUnknownOperation` | `422` | `invalid operation` | Domain |
| `calc.ErrNonFiniteResult` **(new)** | `422` | `non-finite result` | Domain |
| `errMethodNotAllowed` (local) | `405` | `method not allowed` | Method enforcement |
| `errInternal` (local) | `500` | `internal error` | Panic recovery / unexpected |
| default | `500` | `internal error` | Defensive fallback |

- The client-visible string is chosen by the mapper, **not** the sentinel message. The
  new sentinels' own messages happen to match the contract strings, but the mapper
  remains the authority.
- `errNonFiniteResult` is **removed** from the local sentinel block (BC-3/§3.5).
- The vocabulary stays closed: the only client strings are `invalid input`,
  `division by zero`, `square root of negative number`, `invalid operation`,
  `non-finite result`, `method not allowed`, `internal error`.

### 3.8 Non-finite INPUT stays `400 invalid input` (no regression)

Non-finite **input** must never become a domain `422`. The existing 400 paths are
preserved unchanged:

- Raw `NaN` / `Infinity` / `-Infinity` JSON tokens are invalid JSON → decode error → `400`.
- An overflowing numeric literal such as `1e999` / `1e400` surfaces as a `strconv`
  range error through the decoder → `400`.
- Post-decode finiteness backstop: any `±Inf`/`NaN` reaching `*A`/`*B` → `400`.
- These checks run **before** `calc.Evaluate`, so the domain's new
  `ErrNonFiniteResult` is only ever about **results**, not inputs. AC-E5 pins this.

### 3.9 Result stays a raw JSON number

- The response struct stays `type evaluateResponse struct { Result float64 \`json:"result"\` }`;
  `encoding/json` encodes the `float64` with no server-side rounding, truncation, or
  string formatting.
- `4.0` marshals as `4`; `-0.0` marshals as `-0`. Tests must assert the **decoded
  numeric value** (and use `math.Signbit` for negative-zero cases, since `-0.0 == 0.0`
  makes a naive equality assertion pass for both signs).
- The domain's non-finite detection (§3.5) is what prevents `encoding/json` from ever
  receiving `NaN`/`±Inf`.

---

## 4. Expected file layout

Package paths are fixed; file names inside each package are the planner's choice.

```
backend/
  go.mod                              # unchanged (module sezzlecalc/backend; go 1.22)
  go.sum                              # unchanged (no new deps)
  cmd/
    server/
      main.go                         # UNCHANGED
  internal/
    calc/
      calc.go                         # + power/sqrt/percent, + ErrSqrtNegative, + ErrNonFiniteResult,
                                      #   + result-finiteness check, + Arity helper
      calc_test.go                    # extended: new ops, 0/-0.0, non-finite cases
    httpapi/
      httpapi.go                      # arity-aware presence rules; - errNonFiniteResult;
                                      #   + map ErrSqrtNegative/ErrNonFiniteResult; delegate unary ops
      httpapi_test.go                 # updated unknown/* cases; + unary/binary arity, sqrt-negative,
                                      #   non-finite-result, raw-number cases
```

- No new third-party dependencies; `go.mod`/`go.sum` need no new requires.
- `internal/calc` must not gain any `net/http` import.
- `cmd/server/main.go` and the routing/Content-Type/body-cap/recovery code are untouched.

---

## 5. Testing requirements

All existing discipline holds: table-driven, one `t.Run` per case, assert **both value
and error** (`errors.Is`), run under `go test -race ./...`.

### 5.1 Domain tests (`backend/internal/calc/calc_test.go`)

Extend `TestEvaluate` (and mirror value-only cases in `TestEvaluateConcurrent` where
cheap) with:

- **Happy paths** for `power`, `sqrt`, `percent` (ints, negatives, fractions), plus the
  existing four ops.
- **Normalization** for each new op: mixed-case and whitespace-padded variants succeed
  and equal the canonical name's result.
- **Distinct `0` and `-0.0` cases**, constructing `-0.0` at runtime via
  `math.Copysign(0, -1)` (an untyped `-0.0` literal collapses to `+0.0` — see
  `calc-domain-package.md` §3.4). Required: `sqrt(-0.0)` = `-0.0` (assert `Signbit`,
  `nil` error).
- `power(0, 0) = 1` (finite success).
- `sqrt(0)` = `+0` (finite success).
- **Every non-finite case** → `ErrNonFiniteResult`: `power(10, 400)`,
  `power(-2, 0.5)`, `power(0, -1)`, `multiply(1e308, 10)`. Each asserts the result is
  `0` (raw non-finite discarded) and the error is `ErrNonFiniteResult`; `power(0, -1)`
  must **not** be `ErrDivideByZero`.
- `sqrt(-1)` → `ErrSqrtNegative` (and **not** `ErrNonFiniteResult`).
- Unknown-op cases for the new names must be removed (`power`/`sqrt`/`percent` are no
  longer unknown); keep `mod`, `""`, `"   "`, `"plus"` as `ErrUnknownOperation`.

### 5.2 HTTP tests (`backend/internal/httpapi/httpapi_test.go`)

- **Replace** the current `unknown/power`, `unknown/sqrt`, `unknown/percent` cases
  (lines 85–87) with real behavior.
- **Arity / presence:** binary op missing/null `a` or `b` → `400 invalid input`; unary
  op (`sqrt`/`percent`) missing/null `a` → `400`; unary op with a numeric `b` → `400`
  (strict); unary op with `b` omitted **and** with `b: null` → `200`.
- **Functional:** `power`, `sqrt`, `percent` happy paths → `200` with exact `result`.
- **`422 square root of negative number`:** `sqrt` of a negative numeric literal → `422`.
- **`422 non-finite result`:** `power(10, 400)`, `power(0, -1)`, `multiply(1e308, 10)`
  → `422` (same wire body as before, now domain-originated).
- **Raw-number encoding:** assert a decoded numeric value (e.g. `add(1.5, 2.5) = 4`);
  a `-0` result decodes to a float whose `math.Signbit` is true.
- **No regression on non-finite input:** `1e999`/`1e400`, `NaN`/`Infinity` literals, and
  the post-decode backstop all remain `400 invalid input`, never `422`.
- Preserve all existing passing cases (Content-Type, body cap, method, health, panic
  recovery, default mapper, negative-zero divisor).

### 5.3 Quality gates (must pass before hand-off)

- `make backend-build`, `make backend-test` (race), `make backend-vet`
  (`go vet` clean + `gofmt -l .` empty), `make backend-cover`.

---

## 6. Acceptance criteria

Each criterion is verifiable from source and from `go test`/`go vet` output.

### Domain API & structure

- **AC-A1** — `internal/calc` exports `func Evaluate(operation string, a, b float64) (float64, error)` with the signature **unchanged** (`calc-domain-package.md` AC-A1 still holds).
- **AC-A2** — `internal/calc` exports `ErrSqrtNegative` and `ErrNonFiniteResult` as sentinel `error` values matchable with `errors.Is`, alongside the existing `ErrDivideByZero` and `ErrUnknownOperation`.
- **AC-A3** — `sqrt` and `percent` compute from `a` only and do not consult `b`; `package calc` imports no HTTP/transport package.
- **AC-A4** — The recognized operation set and its arity have a **single source of truth** (`calc.Arity`); `internal/httpapi` does not re-declare the seven-operation table and holds no local unary set.
- **AC-A5** — No new third-party dependency is added; `go.mod`/`go.sum` are otherwise unchanged.

### Operation set & normalization

- **AC-R1** — The domain recognizes exactly the seven canonical operations `add`, `subtract`, `multiply`, `divide`, `power`, `sqrt`, `percent`.
- **AC-R2** — Matching for all seven is case-insensitive and trims surrounding whitespace, reusing the existing normalization.
- **AC-R3** — Any operation not normalizing to one of the seven returns `ErrUnknownOperation` (e.g. `"mod"`, `""`, `"   "`).
- **AC-R4** — `sqrt` and `percent` are the only unary operations; `add`, `subtract`, `multiply`, `divide`, `power` are binary.

### Functional behavior

- **AC-F1** — `power(a, b)` returns `math.Pow(a, b)` for finite success cases.
- **AC-F2** — `sqrt(a)` returns `math.Sqrt(a)` for `a >= 0`.
- **AC-F3** — `percent(a)` returns `a / 100`.
- **AC-F4** — `add`, `subtract`, `multiply`, `divide` arithmetic is unchanged (except the result-finiteness rule in AC-N9).
- **AC-F5** — All seven operations are reachable through `POST /evaluate` and return `200` on valid input.

### Numeric semantics

- **AC-N1** — `power(0, 0)` returns `(1, nil)`.
- **AC-N2** — `power(10, 400)` returns `(0, ErrNonFiniteResult)`.
- **AC-N3** — `power(-2, 0.5)` returns `(0, ErrNonFiniteResult)`.
- **AC-N4** — `power(0, -1)` returns `(0, ErrNonFiniteResult)` and **not** `ErrDivideByZero`.
- **AC-N5** — `sqrt(a)` for a strictly negative `a` returns `(0, ErrSqrtNegative)`.
- **AC-N6** — `sqrt(0)` returns `(+0, nil)` (finite success).
- **AC-N7** — `sqrt(-0.0)` returns `(-0.0, nil)` (finite success; `math.Signbit` true).
- **AC-N8** — `percent(50)` returns `0.5`; `percent(-0.0)` returns `-0.0` with `math.Signbit` true.
- **AC-N9** — `multiply(1e308, 10)` returns `(0, ErrNonFiniteResult)`.
- **AC-N10** — On any non-finite result the domain returns `(0, ErrNonFiniteResult)`; the raw `±Inf`/`NaN` value is discarded.
- **AC-N11** — Finite results, including `+0`/`-0.0`, never yield `ErrNonFiniteResult`.

### HTTP arity / operand presence

- **AC-H1** — A binary operation with missing or explicit-`null` `a` **or** `b` → `400 invalid input`.
- **AC-H2** — A unary operation (`sqrt`/`percent`) with missing or explicit-`null` `a` → `400 invalid input`.
- **AC-H3** — A unary operation with a numeric `b` present → `400 invalid input` (strict; D-1).
- **AC-H4** — A unary operation with `b` omitted **or** explicit `null` → accepted (no arity error).
- **AC-H5** — Arity is determined from the **normalized** operation name via the single source of truth (AC-A4), not by ad-hoc string comparison on the raw input.
- **AC-H6** — The operation name is validated first: an unknown operation returns `422 invalid operation` regardless of operand presence (D-1).

### Error mapping

- **AC-E1** — `calc.ErrSqrtNegative` maps to `422 {"error":"square root of negative number"}`.
- **AC-E2** — `calc.ErrNonFiniteResult` maps to `422 {"error":"non-finite result"}`.
- **AC-E3** — `calc.ErrDivideByZero` maps to `422 {"error":"division by zero"}` (divide-only; unaffected).
- **AC-E4** — `calc.ErrUnknownOperation` maps to `422 {"error":"invalid operation"}` (unchanged).
- **AC-E5** — Non-finite **input** still returns `400 {"error":"invalid input"}` and never `422` (no regression).
- **AC-E6** — The HTTP-layer local `errNonFiniteResult` sentinel and post-`Evaluate` result check are removed; the domain is the sole non-finite-result detection point.
- **AC-E7** — The client-visible error vocabulary is closed: only `invalid input`, `division by zero`, `square root of negative number`, `invalid operation`, `non-finite result`, `method not allowed`, `internal error`; no raw sentinel message, wrapped cause, stack, or path is leaked.

### Wire encoding

- **AC-W1** — The result is emitted as a raw JSON number via the `float64` field; no server-side rounding or string formatting.
- **AC-W2** — `4.0` encodes as `4` and `-0.0` encodes as `-0`; tests assert decoded values (and `math.Signbit` for `-0`).
- **AC-W3** — `NaN`/`±Inf` never reach `encoding/json` (guaranteed by the domain), so a `200` is never followed by a mid-encode failure.

### Tests

- **AC-T1** — `calc` tests are table-driven with `t.Run` per case and assert both value and error via `errors.Is`.
- **AC-T2** — `calc` tests include distinct `0` and runtime-constructed `-0.0` cases (`math.Copysign(0, -1)`).
- **AC-T3** — `calc` tests include `power(0, 0) = 1`, `sqrt(0)`, and `sqrt(-0.0) = -0.0` (with `Signbit`).
- **AC-T4** — `calc` tests cover **every** non-finite case (`power(10,400)`, `power(-2,0.5)`, `power(0,-1)`, `multiply(1e308,10)`) and `sqrt` of a negative.
- **AC-T5** — `httpapi` tests cover unary and binary arity/presence rules, including unary with `b` omitted and with `b: null`.
- **AC-T6** — `httpapi` tests cover `422 square root of negative number` and the three non-finite-result cases.
- **AC-T7** — The former `unknown/power|sqrt|percent` cases are replaced with real-behavior assertions; no test still asserts those names as `invalid operation`.
- **AC-T8** — Non-finite-input regressions are covered (`1e999`/`1e400`, `NaN`/`Infinity` literals, backstop) and remain `400`.

### Quality gates

- **AC-Q1** — `make backend-build` succeeds.
- **AC-Q2** — `make backend-test` (`go test -race ./...`) passes.
- **AC-Q3** — `make backend-vet` passes with `gofmt -l .` empty.
- **AC-Q4** — `make backend-cover` produces `backend/coverage.txt` and the new branches are covered.

---

## 7. Resolved decisions

| # | Tension | Decision |
|---|---------|----------|
| D-1 | Unary vs binary at the HTTP boundary | `A` required for all ops; `B` required for binary (`add`/`subtract`/`multiply`/`divide`/`power`), **must be omitted/null** for unary (`sqrt`/`percent`). Unary `b` absent or `null` → accepted; unary with a numeric `b` → `400` (strict). The operation name is validated first, so an unknown op → `422 invalid operation` regardless of operand presence. Arity comes from the normalized name. **Confirmed: OQ-1 = strict `400`; OQ-2 = `422 invalid operation`.** §3.3. |
| D-2 | Domain signature | **Keep** `func Evaluate(operation string, a, b float64) (float64, error)`; unary ops ignore `b`; arity enforced in HTTP. Rejected: a signature change expressing arity (breaking, leaks wire shape into the domain). **Confirmed with OQ-1/OQ-2 above.** §3.1. |
| D-3 | Non-finite result detection location | Domain gains `ErrNonFiniteResult` and returns `(0, ErrNonFiniteResult)` instead of a non-finite value; HTTP maps it to `422 non-finite result`. The local `errNonFiniteResult` sentinel + post-`Evaluate` check are **removed** (single source of truth); **confirmed: OQ-4 = remove, no defensive backstop**. §3.5. |
| D-4 | `sqrt` of a negative | New `ErrSqrtNegative`, checked **before** `math.Sqrt` → `422 square root of negative number`. `sqrt(-0.0)` = `-0.0` (finite success) because `-0.0 < 0` is false; strictly negative `a` errors. §3.6. |
| D-5 | Numeric semantics | `power = math.Pow`, `sqrt = math.Sqrt`, `percent = a/100`. Exact outcomes pinned in §3.4; `power(0,-1)` is non-finite (not divide-by-zero). Domain discards the raw non-finite value. |
| D-6 | Raw JSON number | `Result float64` retained; `encoding/json` encodes with no rounding/formatting; domain detection prevents `NaN`/`±Inf` reaching the encoder. §3.9. |
| D-7 | Operation set | All seven contract ops supported; `invalid operation` remains the fallback for anything else. §3.2. |
| D-8 | Normalization | New ops are case-insensitive and whitespace-trimmed exactly like the existing four, reusing `strings.ToLower(strings.TrimSpace(...))`. §3.2. |
| D-9 | Non-finite input | Unchanged: `1e999`/`1e400`, raw `NaN`/`Infinity`, and the post-decode backstop → `400 invalid input`, never a domain `422`. §3.8. |
| D-10 | Frontend | Absent in this worktree (verified); this feature is backend-only. NG-1. |
| D-11 | Arity single source of truth | **Confirmed: OQ-3 = export a small pure domain helper `func Arity(operation string) (int, bool)`**, normalized identically to `Evaluate`; `internal/httpapi` holds no local unary set. Additive; does not change `Evaluate`. §3.1. |

---

## 8. Open questions / blocking decisions

**All four questions are resolved; no blocking open questions remain.** The human
confirmed each of the recommended defaults:

- **OQ-1 (unary op sent a numeric `b`) — RESOLVED: reject with `400 invalid input`**
  (strict). Recorded in D-1 and §3.3.
- **OQ-2 (unknown op with a missing operand) — RESOLVED: `422 invalid operation`.**
  The operation name is validated first, regardless of operand presence. Recorded in
  D-1 and §3.3.
- **OQ-3 (arity single source of truth) — RESOLVED: export `calc.Arity(operation
  string) (int, bool)`**, normalized identically to `Evaluate`; no local unary set in
  `internal/httpapi`. Recorded in D-11 and §3.1.
- **OQ-4 (defensive HTTP non-finite backstop) — RESOLVED: remove** the local
  `errNonFiniteResult` sentinel and the post-`Evaluate` check; the domain is the sole
  non-finite detection point. Recorded in D-3 and §3.5.

---

## 9. Risks

- **R-1 — Contract/doc drift on the operation set (removed, was medium).** The previous
  `http-api-layer.md` NG-1/NG-2 declared `power`/`sqrt`/`percent` out of scope and the
  tests asserted them as `invalid operation`. This feature supersedes that; BC-1/BC-4 must
  be applied so code, tests, and the contract agree. Mitigation: AC-R1, AC-T7.
- **R-2 — Negative-zero tests pass vacuously (medium).** An untyped `-0.0` literal
  collapses to `+0.0`, and `-0.0 == 0.0` is `true`, so a naive equality assertion cannot
  distinguish signs. Mitigation: construct `-0.0` at runtime and assert `math.Signbit`
  (AC-T2/AC-T3, §5.1).
- **R-3 — `sqrt(-1)` misclassified as non-finite (low).** `math.Sqrt(-1)` returns `NaN`;
  if the negative guard runs **after** `math.Sqrt`, the case would surface as
  `ErrNonFiniteResult` (`422 non-finite result`) instead of `ErrSqrtNegative`
  (`422 square root of negative number`). Mitigation: guard before `math.Sqrt` (D-4,
  AC-N5, AC-E1).
- **R-4 — `power(0,-1)` misclassified as divide-by-zero (low).** `math.Pow(0,-1)` is
  `+Inf`; it must be `ErrNonFiniteResult`, not `ErrDivideByZero`. Mitigation: AC-N4.
- **R-5 — Invalid JSON emitted after a `200` (low).** If the domain ever returns a
  non-finite value on success, `encoding/json` fails mid-encode after the header is sent.
  Mitigation: domain-side detection (D-3, AC-N10, AC-W3).
- **R-6 — Arity/op-table drift between domain and HTTP (low→medium).** A second hard-coded
  unary set in `httpapi` can diverge from the domain. Mitigation: AC-A4/AC-H5 and the
  `calc.Arity` helper (D-11).
- **R-7 — Unknown-op precedence change (low).** The resolved rule (D-1) changes the
  pre-feature behavior from `400` to `422` for a missing operand on an unknown op.
  Mitigation: explicit decision + AC-H6.

---

## 10. Traceability summary

| Requirement area | Acceptance criteria |
|------------------|---------------------|
| Domain API & structure | AC-A1 … AC-A5 |
| Operation set & normalization | AC-R1 … AC-R4 |
| Functional behavior (new ops) | AC-F1 … AC-F5 |
| Numeric semantics | AC-N1 … AC-N11 |
| HTTP arity / operand presence | AC-H1 … AC-H6 |
| Error mapping & taxonomy | AC-E1 … AC-E7 |
| Wire encoding (raw JSON number) | AC-W1 … AC-W3 |
| Tests | AC-T1 … AC-T8 |
| Quality gates | AC-Q1 … AC-Q4 |

### Contract coverage cross-check

| Contract row (`api-contract`) | Handled by |
|-------------------------------|------------|
| `power` (`a ** b`, binary) | AC-F1, AC-N1…AC-N4, AC-R4 |
| `sqrt` (unary) | AC-F2, AC-N5…AC-N7, AC-H2…AC-H4 |
| `percent` (unary, `a / 100`) | AC-F3, AC-N8 |
| `200 {"result": <number>}` | AC-F5, AC-W1, AC-W2 |
| `400 invalid input` | AC-E5, AC-H1…AC-H3, AC-T8, D-9 |
| `422 division by zero` | AC-E3, AC-N4 |
| `422 square root of negative number` | AC-E1, AC-N5 |
| `422 invalid operation` | AC-E4, AC-H6, AC-R3 |
| `422 non-finite result` | AC-E2, AC-N2, AC-N3, AC-N4, AC-N9, AC-N10 |
| Unary rule (`b` omitted for `sqrt`/`percent`) | AC-H2…AC-H5, D-1 |
