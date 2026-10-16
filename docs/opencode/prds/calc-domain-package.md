# PRD: `internal/calc` Domain Package + Go Module Bootstrap

- **Status:** Resolved — all open questions decided; ready for design/planning
- **Owner:** Backend / TPM
- **Related skill:** `.opencode/skills/go-http-service/SKILL.md`
- **Repo:** `sezzlecalc` (Go backend + React/Vite/TS frontend)
- **Scope level:** Backend domain only. No HTTP, no frontend.

---

## 1. Goal

Bootstrap the Go module at `./backend` and deliver a **stateless, HTTP-free domain
package** `internal/calc` that exposes a single pure entry point for four arithmetic
operations: `add`, `subtract`, `multiply`, and `divide`.

The package must be:

- **Pure and stateless** — same inputs always produce the same outputs, with no
  observable side effects and no mutable shared state.
- **HTTP-agnostic** — free of `net/http` and any HTTP/transport types, so it can be
  unit-tested in complete isolation (no server, no sockets, no `httptest`).
- **Correct on the divide-by-zero path** — Go's floating-point division by zero
  yields `+Inf`, `-Inf`, or `NaN` and **does not panic**; the package must instead
  detect a zero divisor explicitly and return a sentinel error.

This package is the domain core that a later phase wires into the thin
`internal/httpapi` layer and `cmd/<name>/main.go` (see the `go-http-service` skill
layout). This PRD deliberately stops at the domain boundary.

### 1.1 Non-goals (explicitly out of scope)

| # | Out of scope | Note |
|---|--------------|------|
| NG-1 | The HTTP layer (`internal/httpapi`, handlers, routing, `cmd/`, JSON envelope) | Later phase; `api-contract` skill governs it |
| NG-2 | `POST /evaluate` and `GET /health` endpoints | North star for a later phase |
| NG-3 | Extra operations — `power`, `sqrt`, `percentage`, etc. | Only the four listed operations are in scope |
| NG-4 | The frontend (React/Vite/TS) | Untouched by this work |
| NG-5 | An expression parser / multi-operand expressions | Single binary operation only |
| NG-6 | Persistence, auth, i18n, CI/CD, observability, rate limiting | Repo-wide out of scope |
| NG-7 | Docker packaging | Repo-level deliverable, not this feature |

---

## 2. Background & current state

- The repository currently has **no `backend/` directory and no Go module**. There is
  a root `Makefile` whose backend targets already assume `backend/` exists and that
  the module is self-contained:
  - `make backend-build` → `cd backend && go build ./...`
  - `make backend-test` → `cd backend && go test -race ./...`
  - `make backend-vet` → `cd backend && go vet ./... && test -z "$(gofmt -l .)"`
  - `make backend-cover` → `cd backend && go test -coverprofile=coverage.txt ./...`
- The `go-http-service` skill defines the conventions this feature must pre-align
  with, even though HTTP itself is out of scope here:
  - Domain packages stay free of HTTP concerns so they unit-test without a server.
  - Sentinel errors are defined in the **domain** package and matched with
    `errors.Is` (wrapped errors still match).
  - Domain errors (e.g. division by zero) are the canonical example of a sentinel.
  - Tests are **table-driven**, one `t.Run` subtest per case, asserting both value
    and error.
  - Discipline: `gofmt -l .` prints nothing, `go vet ./...` clean, `go build ./...`
    and `go test ./...` pass before hand-off.

This feature creates the module and the domain package only; it does **not** create
`internal/httpapi` or `cmd/`.

---

## 3. Functional requirements

### 3.1 Public API (exact)

The package exposes exactly one exported function:

```go
// Package calc provides stateless arithmetic operations.
package calc

func Evaluate(operation string, a, b float64) (float64, error)
```

- **Signature is fixed** as `func Evaluate(operation string, a, b float64) (float64, error)`.
- `operation` is an operation name; matching is case-insensitive and trims
  surrounding whitespace (see §3.2).
- `a` is the left operand, `b` is the right operand.
- On success, returns `(result, nil)`.
- On failure, returns `(0, <sentinel error>)` — the result value is the zero value
  when an error is returned.

The package also exports sentinel errors (see §3.3).

### 3.2 Operation names and behavior

Accepted `operation` strings and their arithmetic:

| `operation` | Computation | Examples |
|-------------|-------------|----------|
| `"add"` | `a + b` | `add(2, 3) = 5`; `add(-2, -3) = -5`; `add(1.5, 0.25) = 1.75`; `add(7, 0) = 7` |
| `"subtract"` | `a - b` | `subtract(2, 3) = -1`; `subtract(-2, -3) = 1`; `subtract(0.5, 1.25) = -0.75`; `subtract(7, 0) = 7` |
| `"multiply"` | `a * b` | `multiply(2, 3) = 6`; `multiply(-2, 3) = -6`; `multiply(1.5, 2) = 3`; `multiply(7, 0) = 0` |
| `"divide"` | `a / b` (guarded) | `divide(8, 2) = 4`; `divide(-8, 2) = -4`; `divide(1, 2) = 0.5`; `divide(0, 5) = 0` |

- Arithmetic uses standard Go `float64` IEEE-754 semantics (see §3.4).
- The four names above are the **canonical** operation names. Matching is
  **case-insensitive** and **trims surrounding whitespace** before comparison, so
  `"Add"`, `" add "`, and `"ADD"` all resolve to `add`; likewise for the other three.
- After normalization, only the four canonical operations are accepted; any other
  value (e.g. `"mod"`, `"power"`, or `""` after trimming) is an error (see §3.3).
- Only the four operations are implemented; no alias names (e.g. `"plus"`,
  `"times"`) and no extra operations (NG-3).

### 3.3 Error semantics

Sentinel errors are declared as package-level `error` values (per the
`go-http-service` skill), so the future HTTP layer can map them with `errors.Is`:

| Sentinel | Condition | Return value |
|----------|-----------|--------------|
| `ErrDivideByZero` | normalized `operation == "divide"` and the divisor is zero (see §3.4) | `(0, ErrDivideByZero)` |
| `ErrUnknownOperation` | `operation` does not normalize to one of the four canonical names | `(0, ErrUnknownOperation)` |

- Errors are **sentinel values**, not dynamic `fmt.Errorf` strings, so callers match
  with `errors.Is` instead of string comparison.
- `ErrDivideByZero` is the canonical domain sentinel illustrated in the
  `go-http-service` skill (future mapping: `422 Unprocessable Entity`).
- The error names above are the required exported identifiers; `ErrDivideByZero` is
  explicitly required by the request, and `ErrUnknownOperation` is confirmed as a
  sentinel error for the unrecognized-operation path (Q-3, resolved).
- After trimming and case-folding, only the four canonical operation names
  (`add`, `subtract`, `multiply`, `divide`) are accepted; anything else — including
  `""` or a whitespace-only string after trimming — is `ErrUnknownOperation`.

### 3.4 Divide-by-zero semantics (critical)

Go floating-point division does **not** panic on a zero divisor; it produces
`+Inf`, `-Inf`, or `NaN`:

- `5.0 / 0.0` → `+Inf`
- `-5.0 / 0.0` → `-Inf`
- `0.0 / 0.0` → `NaN`

Therefore `Evaluate("divide", a, b)` **must not** simply return `a / b`. It must
**explicitly detect a zero divisor and return `ErrDivideByZero`**, with the
following precise definition of "zero divisor":

- **"Zero divisor" means `b == 0` under IEEE-754 equality.**
- In IEEE-754, `+0.0 == -0.0` evaluates to **true**, so the single check `b == 0`
  correctly catches **both `+0.0` and `-0.0`**. `-0.0` must be treated as zero, not
  as a negative number to be divided by.
- The zero-divisor guard applies regardless of the numerator: `0/0`, `5/0`,
  `-5/0`, `0/-0.0`, `5/-0.0` all return `ErrDivideByZero` (raw Go would give
  `NaN`, `+Inf`, `-Inf` respectively).
- `divide` with a **non-zero** divisor is never a division-by-zero error; the result
  may still be `±Inf`/`NaN` if a caller passes non-finite operands. Non-finite
  operands (`NaN`, `±Inf`) **pass through** with IEEE-754 semantics; `Evaluate` does
  not reject them (Q-4, resolved).
- The guard is inside `Evaluate` (or a private helper it calls); the HTTP layer is
  not expected to pre-validate the divisor.

> Implementation note (test-authoring caveat): a Go **untyped constant** `-0.0`
> does not preserve the negative-zero sign when converted to `float64`. To obtain a
> genuine runtime `-0.0` divisor in a test table, build it at runtime, e.g.
> `math.Copysign(0, -1)` or `negZero := -z` where `z` is a `float64` zero. A literal
> `-0.0` in a `[]struct{...}` field may silently become `+0.0` and fail to exercise
> the intended case. This must be honored when writing the denominator cases.

### 3.5 Statelessness (concrete meaning)

"Stateless" is defined operationally for acceptance purposes:

- `Evaluate` is a **pure function** of its arguments: identical `(operation, a, b)`
  always yields identical `(result, error)`; no hidden inputs (time, randomness,
  environment, global counters).
- **No mutable package-level state.** Exported/unexported package variables, if any,
  are immutable `error` sentinels only (or `const`). No package-level
  vars/`init()` that mutate shared state.
- **No I/O or side effects.** No logging, no printing, no file/network/database
  access, no `time`, no `crypto/rand`, no goroutine spawning.
- **Concurrency-safe.** Concurrent calls to `Evaluate` from multiple goroutines must
  be safe with no data races — validated by the existing `go test -race ./...` gate.
- **No service/handler types.** There is no `Service` struct required; the API is the
  package-level function. (If a helper type is introduced later, it must be stateless.)

### 3.6 "No `net/http`" (concrete meaning)

- The `internal/calc` package (and its test file) must **not import** `net/http`,
  `net/url`, `net/http/httptest`, or any HTTP/transport package.
- No HTTP types appear in the public API: `Evaluate` takes `string` and `float64` and
  returns `float64` and `error`. No `http.Request`, `http.ResponseWriter`,
  `*http.Client`, JSON tags, or status codes.
- "HTTP-free" is judged by the package's imports and API surface, not by absence of
  the word "http" in comments.

---

## 4. Module & toolchain requirements

- Create the module at `./backend` with `go.mod` at `backend/go.mod`.
- **`go.mod` must declare `go 1.22` as the module's minimum version.** Set it
  explicitly; do **not** accept whatever version `go mod init` seeds from the locally
  installed toolchain (a newer toolchain would seed e.g. `go 1.24`).
- **No `toolchain` directive** may be present in `go.mod`.
- The module must build with any Go toolchain satisfying `go >= 1.22`, including
  `1.22` itself — i.e. it must not require features or directives from newer
  toolchains, even though it is compiled with a newer toolchain locally and in the
  container. The absence of a `toolchain` line prevents an automatic toolchain
  switch/download and keeps the module portable.
- **Module path (decided, Q-1):** the `module` line in `go.mod` is
  `sezzlecalc/backend`. The derived internal import path for the domain package is
  therefore `sezzlecalc/backend/internal/calc`.
- **No third-party dependencies (decided, Q-2):** the module is stdlib-only; `go.mod`
  has no `require` block and there is no `go.sum`.

---

## 5. Expected file layout

Minimum expected layout after this feature (names of `.go` files are the planner's
choice; the package path is fixed):

```
backend/
  go.mod                 # module sezzlecalc/backend; go 1.22; no toolchain line
  internal/
    calc/
      calc.go            # package calc: Evaluate + sentinel errors
      calc_test.go       # table-driven tests (same package, no HTTP imports)
```

- The package's import path is `sezzlecalc/backend/internal/calc`.
- No `cmd/`, no `internal/httpapi/`, no root-level `.go` files in this feature.
- The test file lives alongside the package and is HTTP-free (no `httptest`).
- Exact file names within `internal/calc/` are not mandated here; the planner owns
  the file-by-file breakdown.

---

## 6. Testing requirements

Tests are **table-driven**, with one `t.Run` subtest per case and assertions on
**both** the returned value and the returned error (`errors.Is(err, wantErr)`), per
the `go-http-service` skill.

### 6.1 Operand classes to cover

For the arithmetic operations, cover the cross-product of value classes for `a` and
`b` where meaningful:

- **Positive** integers (e.g. `2`, `3`, `8`)
- **Negative** integers (e.g. `-2`, `-3`, `-8`)
- **Zero** (`0`, and for divisor cases `-0.0` — see §3.4)
- **Fractional** values (e.g. `0.5`, `1.5`, `0.25`, `-0.75`)
- **Mixed sign** pairs (e.g. `multiply(-2, 3) = -6`)

### 6.2 Required scenarios

- **Happy paths** for all four operations across the operand classes above.
- **Operation-name normalization** for each of the four operations: mixed-case and
  whitespace-padded variants must **succeed** and produce the same result as the
  canonical name (e.g. `"Add"`, `" add "`, `"ADD"` → `add`; `" subtract "` → `subtract`).
- **Unknown operation** path → `ErrUnknownOperation` for non-operation strings
  (e.g. `"mod"`, `""`, `"   "`, `"plus"`).
- **Divide-by-zero** path:
  - numerator positive, zero, and negative with divisor `+0.0` → `ErrDivideByZero`.
  - numerator positive and zero with divisor **`-0.0`** → `ErrDivideByZero`.
- **`-0.0` divisor construction**: the negative-zero divisor must be created at
  runtime (`math.Copysign(0, -1)` or equivalent), not via an untyped `-0.0` literal
  (see §3.4 implementation note).
- Error assertions use `errors.Is`, not `==` or string matching (so wrapped errors
  and sentinel identity both work).

### 6.3 Quality gates (must pass before hand-off)

- `make backend-build` — `go build ./...` succeeds.
- `make backend-test` — `go test -race ./...` passes (race detector also exercises
  the statelessness/concurrency expectation).
- `make backend-vet` — `go vet ./...` clean and `gofmt -l .` prints nothing.
- `make backend-cover` — produces `backend/coverage.txt`; new branches are covered
  rather than ignored.

---

## 7. Acceptance criteria

Each criterion is verifiable from source, `go.mod`, and test output.

### Module & toolchain

- **AC-M1** — `backend/go.mod` exists and declares a `module` path.
- **AC-M2** — `backend/go.mod` contains `go 1.22` and no higher version.
- **AC-M3** — `backend/go.mod` contains **no** `toolchain` directive.
- **AC-M4** — `make backend-build` succeeds with the repository's configured
  toolchain, and the module declares no language/directive requirements newer than
  `1.22`.
- **AC-M5** — `make backend-test`, `make backend-vet`, and `make backend-cover`
  succeed from a clean checkout of `backend/`.

### Public API

- **AC-A1** — Package `calc` exports `func Evaluate(operation string, a, b float64) (float64, error)` with exactly that signature.
- **AC-A2** — Package `calc` exports `ErrDivideByZero` (and `ErrUnknownOperation`) as sentinel `error` values matchable via `errors.Is`.
- **AC-A3** — No exported symbol in `package calc` references an HTTP type; `Evaluate`'s parameters and return types are only `string`, `float64`, and `error`.

### Functional behavior

- **AC-F1** — `Evaluate("add", a, b)` returns `a + b` for positive, negative, zero, fractional, and mixed-sign operands.
- **AC-F2** — `Evaluate("subtract", a, b)` returns `a - b` for the same operand classes.
- **AC-F3** — `Evaluate("multiply", a, b)` returns `a * b` for the same operand classes.
- **AC-F4** — `Evaluate("divide", a, b)` with non-zero `b` returns `a / b` for the same operand classes.
- **AC-F5** — After trimming surrounding whitespace and case-folding, `Evaluate` recognizes exactly the four canonical operation names `add`, `subtract`, `multiply`, `divide`; no aliases or additional operations exist. Inputs such as `"Add"`, `" add "`, and `"ADD"` resolve to `add`.

### Error semantics

- **AC-E1** — `Evaluate("divide", a, 0)` returns `(0, ErrDivideByZero)` for positive, zero, and negative `a` — never `±Inf`, `NaN`, or a panic.
- **AC-E2** — `Evaluate("divide", a, -0.0)` returns `(0, ErrDivideByZero)` (the `-0.0` divisor is treated as zero).
- **AC-E3** — Any `operation` that does not normalize (after trimming and case-folding) to one of the four canonical names returns `(0, ErrUnknownOperation)` — e.g. `"mod"`, `""`, and whitespace-only strings like `"   "`.
- **AC-E4** — Returned errors are sentinel values matchable with `errors.Is`; no error is produced only via dynamic string formatting.
- **AC-E5** — `Evaluate` never panics for any `float64` operands, including zero and negative-zero divisors.

### Statelessness & isolation

- **AC-S1** — `package calc` declares no mutable package-level state; the only package-level identifiers are the function, the sentinel errors, and unexported helpers/consts.
- **AC-S2** — `package calc` (and its test file) imports neither `net/http` nor any HTTP/transport package; this is checkable from the `import` blocks or `go list -deps`.
- **AC-S3** — Repeated and concurrent invocations of `Evaluate` with identical inputs return identical results and produce no data races under `go test -race ./...`.
- **AC-S4** — `Evaluate` performs no I/O and spawns no goroutines.

### Tests

- **AC-T1** — Tests are table-driven with `t.Run` per case and assert both value and error.
- **AC-T2** — The table covers positive, negative, zero, and fractional operands for the arithmetic operations.
- **AC-T3** — The table includes the divide-by-zero path for `+0.0` and for a runtime-constructed `-0.0` divisor.
- **AC-T4** — The table includes at least one unknown-operation case asserting `ErrUnknownOperation`.
- **AC-T5** — The test file imports no `httptest`/`net/http` and requires no running server.

---

## 8. Resolved decisions

All previously open questions are now decided. No blocking open questions remain.

- **Q-1 — Module path (RESOLVED).** The module path is `sezzlecalc/backend`. The
  derived internal import path is `sezzlecalc/backend/internal/calc`. See §4 and §5.
- **Q-2 — Dependency expectation (RESOLVED).** The module is stdlib-only and
  zero-dependency: no `require` block, no `go.sum`, no third-party test library
  (e.g. testify). See §4.
- **Q-3 — Unknown-operation error name (RESOLVED).** `ErrUnknownOperation` is
  confirmed as an exported sentinel `error`, matched with `errors.Is`. See §3.3.
- **Q-4 — Non-finite operands (RESOLVED).** `NaN`/`±Inf` operands pass through with
  IEEE-754 semantics; `Evaluate` does not add a non-finite-operand error. See §3.4.
- **Q-5 — Zero-divisor strictness for `-0.0` (RESOLVED).** A `-0.0` divisor is treated
  as zero and returns `ErrDivideByZero` (via the `b == 0` check). See §3.4 and AC-E2.
- **Q-6 — Operation string case/normalization (RESOLVED).** Matching is
  **case-insensitive** and **trims surrounding whitespace** before comparing against
  the four canonical lowercase names; e.g. `"Add"`, `" add "`, and `"ADD"` all resolve
  to `add`. Anything not normalizing to a canonical name returns `ErrUnknownOperation`.
  See §3.2, §3.3, AC-F5, and AC-E3.

---

## 9. Risks

- **R-1 — `go 1.22` vs. `go mod init` seeding (medium).** A newer local/container
  toolchain may seed `go.mod` with a newer `go` line (e.g. `go 1.24`) and/or a
  `toolchain` line. If not corrected, AC-M2/AC-M3 fail and the module becomes
  less portable. Mitigation: explicitly set `go 1.22` and delete any `toolchain`
  line; verify with the build/vet gates.
- **R-2 — Negative-zero test may silently not test what it claims (medium).** An
  untyped `-0.0` literal collapses to `+0.0` when stored in a `float64`, so a naive
  test table gives false confidence on AC-E2. Mitigation: construct `-0.0` at runtime
  (`math.Copysign(0, -1)`).
- **R-3 — Divide-by-zero-by-omission (low).** Implementing `divide` as a bare `a / b`
  would return `±Inf`/`NaN` and pass a value-only test. Mitigation: AC-E1/AC-E2 assert
  `ErrDivideByZero` explicitly and forbid `±Inf`/`NaN`/panic.
- **R-4 — Scope creep into HTTP/extra ops (low).** Adding `internal/httpapi`,
  `cmd/`, or `power`/`sqrt` would violate NG-1/NG-3. Mitigation: file-layout and
  operation-set ACs.

---

## 10. Traceability summary

| Requirement area | Acceptance criteria |
|------------------|---------------------|
| Module bootstrap & toolchain | AC-M1 … AC-M5 |
| Public API surface | AC-A1 … AC-A3 |
| Operation behavior | AC-F1 … AC-F5 |
| Error semantics (incl. divide-by-zero, `-0.0`) | AC-E1 … AC-E5 |
| Statelessness & HTTP-free isolation | AC-S1 … AC-S4 |
| Test coverage | AC-T1 … AC-T5 |
