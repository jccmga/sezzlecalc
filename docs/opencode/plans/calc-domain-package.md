# Plan: `internal/calc` Domain Package + Go Module Bootstrap

- **PRD:** `docs/opencode/prds/calc-domain-package.md` (single source of truth; all questions resolved)
- **Conventions:** `.opencode/skills/go-http-service/SKILL.md`
- **Repo root (isolated worktree):** `/Users/juancamilocortesmedina/workspace/sezzlecalc-worktrees/sezzlecalc`
- **Scope:** Backend domain only. No HTTP, no `cmd/`, no frontend, no third-party deps.

---

## 1. Context & Goals

### Context

The repository currently has **no `backend/` directory and no Go module** (verified: `glob **/*.go` → none; `glob **/go.mod` → none; root listing shows only `.opencode/`, `docs/`, `.git`, `.gitignore`, `AGENTS.md`, `Makefile`, `opencode.json`, `PROMPTS.md`, `README.md`).

The root `Makefile` already has backend targets that assume `backend/` is a self-contained Go module:

- `make backend-build` → `cd backend && go build ./...`
- `make backend-test` → `cd backend && go test -race ./...`
- `make backend-vet` → `cd backend && go vet ./... && test -z "$$(gofmt -l .)"`
- `make backend-cover` → `cd backend && go test -coverprofile=coverage.txt ./... && go tool cover -func=coverage.txt`

This feature bootstraps that module and delivers the pure, HTTP-free domain package `internal/calc` — the core a later phase wires into `internal/httpapi` and `cmd/<name>/main.go` (per the `go-http-service` skill layout). It deliberately stops at the domain boundary.

### Desired outcome

1. `backend/go.mod` declares `module sezzlecalc/backend`, `go 1.22`, no `toolchain` line, no `require` block, no `go.sum`.
2. `backend/internal/calc/calc.go` exports exactly `Evaluate(operation string, a, b float64) (float64, error)` plus two sentinel errors `ErrDivideByZero` and `ErrUnknownOperation`.
3. `backend/internal/calc/calc_test.go` is a table-driven, HTTP-free test suite that exercises all four operations, operation-name normalization, the unknown-operation path, the divide-by-zero path (including a runtime-constructed `-0.0` divisor), and concurrent statelessness.
4. All four Makefile backend gates pass from a clean checkout.

### Non-goals (explicit)

- No `internal/httpapi`, no `cmd/`, no routing, no JSON envelope, no `POST /evaluate` / `GET /health` (NG-1, NG-2).
- No extra operations (`power`, `sqrt`, `percentage`, …) (NG-3).
- No frontend changes (NG-4).
- No expression parser / multi-operand expressions (NG-5).
- No persistence, auth, i18n, CI/CD, observability, rate limiting (NG-6).
- No Docker packaging (NG-7).
- No third-party dependency of any kind (testify, etc.) — stdlib only (Q-2).

---

## 2. Approach

**Design.** Create a single-package Go module `sezzlecalc/backend` whose only package is `internal/calc` (import path `sezzlecalc/backend/internal/calc`). The package is a pure function with no package-level mutable state: `Evaluate` normalizes `operation` (trim + lowercase) and switches on the four canonical names. The `divide` branch performs an explicit `b == 0` guard and returns `ErrDivideByZero`; any non-canonical operation returns `ErrUnknownOperation`. Both errors are package-level `error` sentinels created with `errors.New`, so the future HTTP layer can match them with `errors.Is`.

**Why `b == 0` is correct for `-0.0`.** IEEE-754 defines `+0.0 == -0.0` to be `true`, so the single equality check catches both. The PRD (Q-5) and AC-E2 require `-0.0` to be treated as a zero divisor, not a negative number. No separate `math.Signbit` check is needed in production code — that would be wrong, because a negative *nonzero* divisor must still divide normally.

**Why sentinel errors, not dynamic strings.** Callers match with `errors.Is`, not string comparison (skill line 88, PRD AC-E4). Dynamic `fmt.Errorf` values would break `errors.Is` matching across the package boundary.

**Why the switch handles normalization in one place.** Normalizing once (rather than comparing the raw string against mixed-case variants) guarantees exactly four accepted names and no aliases (AC-F5, Q-6). Unrecognized values — including `""` and whitespace-only strings after trimming — fall through to `ErrUnknownOperation`.

**Test strategy.** One table-driven `TestEvaluate` plus a tiny `TestNegativeZeroConstruction` guard and a `TestEvaluateConcurrent` race check, covering happy paths, normalization, unknown-operation, divide-by-zero, and concurrent statelessness. Each `TestEvaluate` case is a `t.Run` subtest asserting both `errors.Is(err, tc.wantErr)` and exact value equality. All chosen fractional cases are dyadic rationals (denominators powers of two: `0.25`, `0.5`, `0.75`, `1.5`, `1.75`, `2`, `3`, `4`) so exact `==` float comparison is safe — no epsilon needed.

### Alternatives considered and rejected

- **`go mod init sezzlecalc/backend` to create `go.mod`.** Rejected as the primary path: with a local toolchain newer than 1.22 (e.g. `go 1.24`), `go mod init` seeds a newer `go` line and can add a `toolchain` directive, directly violating AC-M2/AC-M3 (R-1). We write `go.mod` by hand instead (see §4).
- **A `Service` struct with methods.** Rejected: the PRD fixes the API as a package-level function (§3.1), and statelessness (AC-S1) is simplest with no struct at all.
- **Normalizing via `strings.ToLower` only, or comparing against a map of allowed names.** Rejected: trim+lowercase+`switch` is the minimal, branch-trivial, easily-verified form; a map or alias table would invite unintended aliases (AC-F5).
- **Returning `a / b` for `divide` and relying on IEEE-754 `±Inf`/`NaN`.** Rejected (R-3): AC-E1/AC-E2 require `ErrDivideByZero`, not `±Inf`/`NaN`.
- **Rejecting non-finite operands (`NaN`, `±Inf`).** Rejected per Q-4: non-finite operands pass through with IEEE-754 semantics; no extra error.
- **Using an epsilon/tolerance for float comparison in tests.** Rejected: all asserted results are exactly representable in `float64`, so exact equality is correct and simpler.

---

## 3. File-by-file changes

### New files

| # | Path | One-line description |
|---|------|----------------------|
| 1 | `backend/go.mod` | Module bootstrap: `module sezzlecalc/backend`, `go 1.22`, no `toolchain`, no `require`. |
| 2 | `backend/internal/calc/calc.go` | Package `calc`: `Evaluate` + sentinel errors `ErrDivideByZero` / `ErrUnknownOperation`. |
| 3 | `backend/internal/calc/calc_test.go` | Table-driven tests (same package), HTTP-free, covering arithmetic, normalization, error paths, and concurrency. |

### Modified files

| # | Path | One-line description |
|---|------|----------------------|
| 4 | `.gitignore` | Add `backend/coverage.txt` so the `make backend-cover` artifact is ignored. |

### Deleted files

None.

### File 1 — `backend/go.mod` (exact contents)

```go
module sezzlecalc/backend

go 1.22
```

Requirements (PRD §4, AC-M1–M3):

- `module` line is exactly `sezzlecalc/backend` (Q-1).
- `go` line is exactly `go 1.22` — **not** `go 1.22.0`, **not** any higher version.
- **No `toolchain` directive.**
- **No `require` block**, no `replace`/`exclude`, no `go.sum` (stdlib-only, Q-2).

Creation rule (do **not** use `go mod init`):

1. Create the file by writing the three lines above literally (e.g. the `write` tool, or `printf 'module sezzlecalc/backend\n\ngo 1.22\n' > backend/go.mod`).
2. Do **not** run `go mod init sezzlecalc/backend`, because a newer local toolchain would seed a newer `go` line and possibly a `toolchain` line.
3. Do **not** run `go mod tidy` — there is nothing to tidy, and the goal is to keep the file exactly three lines.
4. After `go build ./...` / `go test ./...` run, confirm `backend/go.sum` was **not** created (no module deps means no sums are recorded).

### File 2 — `backend/internal/calc/calc.go`

Package doc + two imports + sentinel errors + one function. Exact shape:

- Package clause: `package calc`, preceded by a doc comment:
  ```go
  // Package calc provides stateless arithmetic operations.
  //
  // Errors are returned as sentinel values (ErrDivideByZero, ErrUnknownOperation)
  // that callers should match with errors.Is.
  ```
- Imports (only these two; no `net/http`, no `net/url`, no transport package):
  - `errors`
  - `strings`
- Sentinel errors (package-level `var`, immutable after init; no other package-level vars, no `init()`):
  ```go
  var (
      // ErrDivideByZero is returned when dividing by a zero divisor.
      ErrDivideByZero = errors.New("division by zero")

      // ErrUnknownOperation is returned when the operation name is not one
      // of add, subtract, multiply, or divide after normalization.
      ErrUnknownOperation = errors.New("unknown operation")
  )
  ```
- Function (exact signature, AC-A1):
  ```go
  func Evaluate(operation string, a, b float64) (float64, error)
  ```
  Logic, in order:
  1. Normalize once: `op := strings.ToLower(strings.TrimSpace(operation))`.
  2. `switch op`:
     - `case "add":` return `a + b, nil`
     - `case "subtract":` return `a - b, nil`
     - `case "multiply":` return `a * b, nil`
     - `case "divide":` `if b == 0 { return 0, ErrDivideByZero }; return a / b, nil`
     - `default:` return `0, ErrUnknownOperation`
  3. On error the result is the zero value `0` (AC-E1/AC-E3 requirement).

Critical correctness notes:

- The `b == 0` guard is the entire zero-divisor detection (catches `+0.0` and `-0.0`; Q-5). Do **not** add `math.Signbit` logic to the divide guard — a negative *nonzero* divisor must divide normally (e.g. `divide(8, -2) == -4`).
- No `fmt.Errorf`, no logging, no I/O, no goroutines, no `time`/`crypto/rand` (AC-S1, AC-S4). Pure function of its arguments only.
- `strings` and `errors` are the only imports required; nothing else.

### File 3 — `backend/internal/calc/calc_test.go`

Same package (`package calc`) so the test can reference the sentinels directly, but assertions must still use `errors.Is` (skill line 88, AC-E4/AC-T1). Imports (only these; **no `net/http`, no `net/http/httptest`** — AC-S2/AC-T5):

- `errors`
- `math` (for `math.Copysign` and `math.Signbit`)
- `sync` (for `sync.WaitGroup` in `TestEvaluateConcurrent`)
- `testing`

Structure:

1. **`TestNegativeZeroConstruction`** (guard against R-2): build `negZero := math.Copysign(0, -1)` and assert both:
   - `negZero == 0` (it is a zero value), and
   - `math.Signbit(negZero)` (it is genuinely *negative* zero).
   This proves the `-0.0` divisor cases below actually exercise the intended path.

2. **`TestEvaluate`** — table-driven. Table type:
   ```go
   cases := []struct {
       name    string
       op      string
       a, b    float64
       want    float64
       wantErr error
   }{ ... }
   ```
   Construct `negZero := math.Copysign(0, -1)` **inside the test function, before the table literal**, and reference it in the `-0.0` divisor cases (never write an untyped `-0.0` literal into the table — §3.4 implementation note / R-2).
   Loop: `for _, tc := range cases { t.Run(tc.name, func(t *testing.T) { ... }) }`. Inside each subtest:
   - `got, err := Evaluate(tc.op, tc.a, tc.b)`
   - `if !errors.Is(err, tc.wantErr) { t.Fatalf("Evaluate(%q, %v, %v) err = %v, want %v", tc.op, tc.a, tc.b, err, tc.wantErr) }`
   - `if got != tc.want { t.Fatalf("Evaluate(%q, %v, %v) = %v, want %v", tc.op, tc.a, tc.b, got, tc.want) }`
   - `errors.Is(err, nil)` naturally returns `true` only when `err == nil`, so a single assertion covers both the `nil` and sentinel `wantErr` cases.

   Exact cases to include (each is a `t.Run` name → inputs → expected):

   **Arithmetic happy paths (AC-F1–F4, AC-T2):**

   | name | op | a | b | want | wantErr |
   |---|---|---|---|---|---|
   | add/positive | `add` | 2 | 3 | 5 | nil |
   | add/negative | `add` | -2 | -3 | -5 | nil |
   | add/fractional | `add` | 1.5 | 0.25 | 1.75 | nil |
   | add/zero | `add` | 7 | 0 | 7 | nil |
   | subtract/positive | `subtract` | 2 | 3 | -1 | nil |
   | subtract/negative | `subtract` | -2 | -3 | 1 | nil |
   | subtract/fractional | `subtract` | 0.5 | 1.25 | -0.75 | nil |
   | subtract/zero | `subtract` | 7 | 0 | 7 | nil |
   | multiply/positive | `multiply` | 2 | 3 | 6 | nil |
   | multiply/mixed-sign | `multiply` | -2 | 3 | -6 | nil |
   | multiply/fractional | `multiply` | 1.5 | 2 | 3 | nil |
   | multiply/zero | `multiply` | 7 | 0 | 0 | nil |
   | divide/positive | `divide` | 8 | 2 | 4 | nil |
   | divide/negative | `divide` | -8 | 2 | -4 | nil |
   | divide/negative-divisor | `divide` | 8 | -2 | -4 | nil |
   | divide/fractional | `divide` | 1 | 2 | 0.5 | nil |
   | divide/zero-numerator | `divide` | 0 | 5 | 0 | nil |

   **Operation-name normalization (AC-F5):** each must succeed and equal the canonical result.

   | name | op | a | b | want | wantErr |
   |---|---|---|---|---|---|
   | normalize/add/mixed-case | `Add` | 2 | 3 | 5 | nil |
   | normalize/add/padded | ` add ` | 2 | 3 | 5 | nil |
   | normalize/add/upper | `ADD` | 2 | 3 | 5 | nil |
   | normalize/subtract/padded | ` subtract ` | 2 | 3 | -1 | nil |
   | normalize/multiply/mixed-case | `MuLtIpLy` | 3 | 4 | 12 | nil |
   | normalize/divide/padded | `  divide  ` | 8 | 2 | 4 | nil |

   **Unknown operation (AC-E3, AC-T4):** `want` = `0`, `wantErr` = `ErrUnknownOperation`.

   | name | op | a | b |
   |---|---|---|---|
   | unknown/mod | `mod` | 8 | 2 |
   | unknown/empty | `` | 8 | 2 |
   | unknown/whitespace-only | `   ` | 8 | 2 |
   | unknown/alias-plus | `plus` | 2 | 3 |

   **Divide-by-zero (AC-E1, AC-E2, AC-T3):** `want` = `0`, `wantErr` = `ErrDivideByZero`. The `negZero` rows use the runtime-constructed `negZero` value, not a literal.

   | name | op | a | b |
   |---|---|---|---|
   | divide-by-zero/positive-numerator | `divide` | 5 | 0 |
   | divide-by-zero/zero-numerator | `divide` | 0 | 0 |
   | divide-by-zero/negative-numerator | `divide` | -5 | 0 |
   | divide-by-zero/negzero/positive-numerator | `divide` | 5 | `negZero` |
   | divide-by-zero/negzero/zero-numerator | `divide` | 0 | `negZero` |
   | divide-by-zero/negzero/negative-numerator | `divide` | -5 | `negZero` |

   All fractional `want` values (`0.25`, `0.5`, `0.75`, `1.5`, `1.75`) are exactly representable binary fractions, so `==` comparison is exact and deterministic.

3. **`TestEvaluateConcurrent`** (makes AC-S3 observable under `-race`): spawn a few goroutines (e.g. 8) with a `sync.WaitGroup` and have each call `Evaluate` repeatedly (e.g. 100 iterations) over an overlapping set of inputs — including the canonical four operations, a divide-by-zero case, an unknown-operation case, and a `-0.0` divisor case using the runtime `negZero` value. Each goroutine asserts its own expected `(result, error)`; any mismatch calls `t.Errorf` (never `t.Fatal` from a non-test goroutine). After `wg.Wait()`, the test passes deterministically; run under `go test -race` (already part of `make backend-test`) the race detector fails if any data race or shared-state corruption is introduced. Do **not** use `t.Fatal` inside the spawned goroutines — report via `t.Errorf` only, then rely on the main goroutine to finish the subtest.

### File 4 — `.gitignore` (modified)

Exact file path: `/Users/juancamilocortesmedina/workspace/sezzlecalc-worktrees/sezzlecalc/.gitignore`

Edit: in the `### Go ###` section, immediately after the existing coverage line, add one line so that block reads:

```
# Output of the go coverage tool, specifically when used with LiteIDE
*.out
backend/coverage.txt
```

No other line in `.gitignore` changes. This ignores the `backend/coverage.txt` artifact produced by `make backend-cover` (see §6 note).

---

## 4. Data, API & schema impact

- **Module contract (new):** `go.mod` declares module `sezzlecalc/backend`, `go 1.22`. Derived import path `sezzlecalc/backend/internal/calc`. No toolchain pinning; builds with any Go ≥ 1.22.
- **Public API (new):** `func Evaluate(operation string, a, b float64) (float64, error)`; `var ErrDivideByZero error`; `var ErrUnknownOperation error`. No other exported identifiers.
- **Sentinel error → status mapping (deferred, not in this feature):** per the skill, the future `internal/httpapi` maps `ErrDivideByZero` → `422 Unprocessable Entity` and `ErrUnknownOperation` → `400 Bad Request`. This plan only defines the sentinels so that mapping is possible; it adds no HTTP code.
- **No migrations, no config, no env vars, no downstream consumers yet.** No frontend, no `cmd/`, no Docker.
- **No `go.sum`** is created (no module dependencies). If a `go.sum` appears, something imported a non-stdlib package — investigate and remove it.

---

## 5. Test strategy

### Tests to add

All tests live in `backend/internal/calc/calc_test.go` (same package `calc`):

1. `TestNegativeZeroConstruction` — guards R-2 by asserting the runtime `negZero` is both zero and sign-negative.
2. `TestEvaluate` — table-driven, `t.Run` per case, asserts value and error together (AC-T1). Covers the full case set in §3 File 3.
3. `TestEvaluateConcurrent` — spawns several goroutines calling `Evaluate` over overlapping inputs and asserts deterministic results, making AC-S3 observable under `go test -race`.

### Cases that must be covered

- All four operations across positive, negative, zero, fractional, and mixed-sign operands (AC-F1–F4, AC-T2).
- A negative *nonzero* divisor (`divide(8, -2) == -4`) to prove the guard does not over-reject negative divisors.
- Normalization: mixed-case, upper-case, and whitespace-padded variants for each operation resolve to the canonical result (AC-F5).
- Unknown operation: `"mod"`, `""`, `"   "`, `"plus"` → `ErrUnknownOperation` (AC-E3, AC-T4).
- Divide-by-zero: positive/zero/negative numerator with `+0.0` divisor → `ErrDivideByZero` (AC-E1); positive, zero, and negative numerator with runtime `-0.0` divisor → `ErrDivideByZero` (AC-E2, AC-T3).
- Concurrent invocation: several goroutines call `Evaluate` over overlapping inputs and observe identical, deterministic results (AC-S3).
- Error assertions always via `errors.Is`, never `==` or string match (AC-E4).
- No `net/http` / `net/http/httptest` import anywhere in the package or tests (AC-S2, AC-T5).

### Verification steps (quality gates, AC-M4/M5)

Run from the repo root, in order, and confirm each passes before hand-off:

1. `cd backend && gofmt -l .` → prints nothing (also `gofmt -w` the two `.go` files first).
2. `cd backend && go vet ./...` → clean.
3. `cd backend && go build ./...` → success.
4. `cd backend && go test -race ./...` → pass (race detector validates statelessness/concurrency, AC-S3).
5. `cd backend && go test -coverprofile=coverage.txt ./... && go tool cover -func=coverage.txt` → every branch of `Evaluate` covered (the switch arms and the `b == 0` guard), not ignored.
6. `make backend-build`, `make backend-test`, `make backend-vet`, `make backend-cover` from the repo root → all succeed (these are the canonical gates).
7. Inspect `backend/go.mod` → exactly `module sezzlecalc/backend`, `go 1.22`, no `toolchain`, no `require`.
8. Confirm `backend/go.sum` does **not** exist.
9. Confirm `git status` shows only the three new files plus the modified `.gitignore` — and that `backend/coverage.txt` does **not** appear (it is now ignored; see File 4).

### Traceability: PRD acceptance criteria → plan steps

| AC | Criterion | Satisfied by |
|----|-----------|--------------|
| AC-M1 | `backend/go.mod` exists with module path | File 1 creation |
| AC-M2 | `go 1.22`, no higher | File 1 exact contents; verification step 7 |
| AC-M3 | no `toolchain` directive | File 1 exact contents; verification step 7 |
| AC-M4 | `make backend-build` succeeds; no directive newer than 1.22 | File 1; verification steps 3, 6 |
| AC-M5 | `make backend-test`/`-vet`/`-cover` succeed from clean checkout | Files 2–3; verification steps 4–6 |
| AC-A1 | `Evaluate` exact signature | File 2 function signature |
| AC-A2 | `ErrDivideByZero` + `ErrUnknownOperation` matchable via `errors.Is` | File 2 sentinel `var` block; File 3 assertions |
| AC-A3 | no exported symbol references HTTP type | File 2 imports (`errors`, `strings` only) + signature |
| AC-F1 | `add` = `a+b` across operand classes | File 2 switch; File 3 add/ cases |
| AC-F2 | `subtract` = `a-b` across operand classes | File 2 switch; File 3 subtract/ cases |
| AC-F3 | `multiply` = `a*b` across operand classes | File 2 switch; File 3 multiply/ cases |
| AC-F4 | `divide` non-zero `b` = `a/b` across operand classes (incl. negative divisor) | File 2 switch; File 3 divide/ + divide/negative-divisor cases |
| AC-F5 | exactly four canonical names after trim+case-fold; no aliases | File 2 normalize+switch; File 3 normalize/ + unknown/ cases |
| AC-E1 | `divide` by `+0.0` → `(0, ErrDivideByZero)` for positive/zero/negative numerator | File 2 `b == 0` guard; File 3 divide-by-zero/ cases |
| AC-E2 | `divide` by `-0.0` → `(0, ErrDivideByZero)` for positive/zero/negative numerator | File 2 `b == 0`; File 3 `negZero` cases (incl. negzero/negative-numerator) + `TestNegativeZeroConstruction` |
| AC-E3 | non-canonical op (incl. `""`, `"   "`) → `(0, ErrUnknownOperation)` | File 2 `default`; File 3 unknown/ cases |
| AC-E4 | errors are sentinels matched with `errors.Is`, no dynamic strings | File 2 `errors.New`; File 3 `errors.Is` assertion |
| AC-E5 | never panics for any operands incl. ±0 divisors | File 2 guard; File 3 divide-by-zero cases; `-race` gate |
| AC-S1 | no mutable package-level state | File 2: only function + immutable error sentinels |
| AC-S2 | no `net/http`/transport imports | File 2 + File 3 import blocks; `go vet`/`go list` check |
| AC-S3 | repeated/concurrent invocations identical, no data races | File 2 purity; File 3 `TestEvaluateConcurrent`; `go test -race ./...` gate |
| AC-S4 | no I/O, no goroutines | File 2 (pure function, no I/O/spawn) |
| AC-T1 | table-driven, `t.Run` per case, assert value + error | File 3 `TestEvaluate` structure |
| AC-T2 | covers positive/negative/zero/fractional operands | File 3 arithmetic cases |
| AC-T3 | divide-by-zero for `+0.0` and runtime `-0.0` | File 3 divide-by-zero + `negZero` cases |
| AC-T4 | ≥1 unknown-operation case asserting `ErrUnknownOperation` | File 3 unknown/ cases |
| AC-T5 | no `httptest`/`net/http`, no server | File 3 import block |

---

## 6. Risks & edge cases

- **R-1 — `go.mod` seeded with newer `go`/`toolchain` (medium).** Avoid `go mod init`; write the three-line file by hand; verify step 7. If a newer `go` or `toolchain` line ever appears, it violates AC-M2/M3.
- **R-2 — `-0.0` test silently not testing negative zero (medium).** An untyped `-0.0` literal collapses to `+0.0` when stored in a `float64`. Mitigated by `math.Copysign(0, -1)` at runtime plus `TestNegativeZeroConstruction` asserting `math.Signbit(negZero)`.
- **R-3 — divide-by-zero-by-omission (low).** A bare `a / b` would return `±Inf`/`NaN` and pass value-only tests. Mitigated by the explicit `b == 0` guard and error assertions that forbid `±Inf`/`NaN`/panic.
- **R-4 — scope creep (low).** Adding `internal/httpapi`, `cmd/`, or `power`/`sqrt` violates NG-1/NG-3. The file-layout and operation-set ACs constrain this; the coder must create only the three new files plus the single `.gitignore` edit listed in §3.
- **Edge — non-finite operands (`NaN`, `±Inf`).** Pass through with IEEE-754 semantics (Q-4). No test case is required to reject them; the plan intentionally does not add a non-finite error.
- **Edge — whitespace-only / empty operation.** After `strings.TrimSpace`, `""` falls through to `ErrUnknownOperation`. Covered by `unknown/empty` and `unknown/whitespace-only`.
- **Edge — negative *nonzero* divisor.** `divide(8, -2) == -4` must remain normal division (covered by `divide/negative-divisor`). The guard must not reject negative divisors.
- **Concurrency.** `Evaluate` reads no shared mutable state; `TestEvaluateConcurrent` exercises overlapping concurrent invocations and `go test -race` is the enforcement gate (AC-S3). The race detector is already part of `make backend-test`.
- **`coverage.txt` artifact.** `make backend-cover` writes `backend/coverage.txt`, which was previously unignored (`.gitignore` only covered `*.out`/`*.test`). This feature adds `backend/coverage.txt` to `.gitignore` (File 4), so the artifact is not accidentally committed; verification step 9 confirms it does not appear in `git status`.

---

## 7. Rollout & rollback

This is a greenfield, additive feature with no consumers and no flags.

- **Rollout order (implementation order):**
  1. Confirm isolated worktree (see below).
  2. `mkdir -p backend/internal/calc` to create the directory tree before writing any files.
  3. Create `backend/go.mod` (File 1).
  4. Create `backend/internal/calc/calc.go` (File 2).
  5. Create `backend/internal/calc/calc_test.go` (File 3).
  6. Edit `.gitignore` (File 4).
  7. Run `gofmt -w` on the two `.go` files, then run verification steps 1–9.
  - **Implementation note:** in `calc_test.go`, `negZero` must be constructed at runtime via `math.Copysign(0, -1)` and must **not** use an untyped `-0.0` literal (R-2).
- **Rollback.** Revert is deleting the new `backend/` directory (it is entirely new; nothing else in the repo references it yet) and removing the single `backend/coverage.txt` line from `.gitignore` (File 4). The root `Makefile` backend targets would again fail with "no such directory" until the next phase — that is the pre-existing behavior. No flag, migration, or config rollback exists.
- **Sequencing note.** The Makefile targets `backend-*` will only become meaningful once `backend/` exists, which is exactly what this feature delivers. No `make check` is run (it also depends on the not-yet-present frontend targets); run the backend gates individually.

### Confirming the isolated worktree (before any edit)

Per `AGENTS.md`, implementation must happen in the isolated git worktree, never the main checkout. The coder must verify **all** of the following before creating any file:

1. `git rev-parse --show-toplevel` prints `/Users/juancamilocortesmedina/workspace/sezzlecalc-worktrees/sezzlecalc`.
2. `test -f .git && echo "worktree (.git is a file)" || echo "main checkout (.git is a dir)"` → must print `worktree (.git is a file)`. In a linked worktree `.git` is a file containing `gitdir: ...`; in the main checkout it is a directory.
3. `git worktree list` shows the path listed as a linked worktree (not `(bare)`/main-only).
4. `git status --short` is clean (or shows only the three new files plus the modified `.gitignore` after creation).
5. Confirm the expected pre-state: `backend/` and `go.mod` do **not** exist yet (`test ! -e backend && test ! -e go.mod`).

Only after all checks pass should the coder proceed to File 1. The worktree is already at the correct path per the task context; these commands are the verification, not a setup step.

---

## 8. Open questions

The PRD states no blocking open questions remain. Remaining minor item for human confirmation before/at coding time (does not block the domain implementation):

1. **Sentinel error message strings** — `"division by zero"` and `"unknown operation"` are proposed to match the skill's example and be human-readable; the exact strings are not API (callers use `errors.Is`). Confirm these are acceptable or pick preferred wording (no functional impact).
