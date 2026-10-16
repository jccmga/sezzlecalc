# sezzlecalc

A full-stack calculator — a Go REST API consumed by a React/Vite/TypeScript frontend. This phase delivers the **backend domain core** (`internal/calc`); the HTTP layer and frontend are later phases and are **not yet present**.

## Current state

| Layer | Status |
|-------|--------|
| `backend/internal/calc` — pure, stateless arithmetic domain package | ✅ Built & verified (this phase) |
| `backend/internal/httpapi` + `cmd/` — HTTP server, `POST /evaluate`, `GET /health` | ⏳ Later phase — **not yet built** |
| `frontend/` — React/Vite/TypeScript UI | ⏳ Later phase — **not yet present** |
| Docker packaging for the full stack | ⏳ Later phase — **not yet present** |

The repository currently contains only the Go domain package (plus the agent harness and documentation). There is no HTTP server, no endpoints, and no frontend directory yet.

## Architecture

```
┌────────────────────────────────────────────────────────────────┐
│                          sezzlecalc                            │
│                                                                │
│  backend/  (Go module: sezzlecalc/backend)                     │
│  ┌──────────────────────────────────────────────┐              │
│  │  internal/calc            ← THIS PHASE       │              │
│  │  Evaluate(operation,a,b)                     │              │
│  │    (float64, error)                          │              │
│  │  ErrDivideByZero / ErrUnknownOperation       │              │
│  │  pure · stateless · no net/http              │              │
│  └──────────────────────────────────────────────┘              │
│  ┌──────────────────────────────────────────────┐              │
│  │  internal/httpapi + cmd/<name>/main.go       │  ← future    │
│  │  POST /evaluate · GET /health                │    (not yet  │
│  └──────────────────────────────────────────────┘     built)   │
│                                                                │
│  frontend/  (React/Vite/TS)                    ← future        │
│  ┌──────────────────────────────────────────────┐   (not yet   │
│  │  validates & formats only — no arithmetic    │    present)  │
│  └──────────────────────────────────────────────┘              │
└────────────────────────────────────────────────────────────────┘
```

The design deliberately separates a **pure domain** (`internal/calc`) from a **thin HTTP layer** (`internal/httpapi`, future). The domain never touches `net/http`, so it is unit-testable in complete isolation; the HTTP layer will later map the domain's sentinel errors to status codes.

## Tech stack

- **Backend:** Go (module `sezzlecalc/backend`, minimum `go 1.22`), stdlib only — zero third-party dependencies.
- **Frontend:** React + Vite + TypeScript (planned; not yet scaffolded).
- **Testing:** Go's standard `testing` package, table-driven, `-race` enabled.

## Repository layout

```
sezzlecalc/
├── AGENTS.md                       # repository guide for agents
├── Makefile                        # canonical build/test entry points
├── PROMPTS.md                      # curated AI-prompt trail for this feature
├── README.md
├── opencode.json
├── .gitignore                      # ignores backend/coverage.txt
├── backend/
│   ├── go.mod                      # module sezzlecalc/backend; go 1.22; no toolchain/require
│   ├── coverage.txt                # git-ignored artifact from `make backend-cover`
│   └── internal/
│       └── calc/
│           ├── calc.go             # package calc: Evaluate + sentinel errors
│           └── calc_test.go        # table-driven + concurrency tests (HTTP-free)
├── docs/
│   ├── ai/
│   │   ├── coverage-summary.md     # backend coverage summary
│   │   ├── prompt-log.md           # raw, complete prompt appendix
│   │   └── skills.md               # vendored/authored skill inventory
│   └── opencode/
│       ├── prds/
│       │   └── calc-domain-package.md
│       └── plans/
│           └── calc-domain-package.md
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

All four backend gates pass, and `make backend-cover` reports **100% statement coverage** for `internal/calc`.

> The `frontend-*` and `check` targets in the `Makefile` reference `frontend/`, which does not exist yet — those targets will become meaningful in a later phase. There is no `docker compose` configuration yet.

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

- Errors are **sentinel values**, matched with `errors.Is` (not `==` or string comparison), so a future HTTP layer can map them cleanly.
- `divide` with a **zero divisor** returns `(0, ErrDivideByZero)`. The guard is `b == 0`, which under IEEE-754 also catches `-0.0` (since `+0.0 == -0.0`). Go's raw `a / b` would instead produce `±Inf`/`NaN` without panicking — the explicit guard is what turns that into a recoverable error.
- Non-finite operands (`NaN`, `±Inf`) **pass through** with standard IEEE-754 semantics; `Evaluate` does not reject them.
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

## Design decisions & assumptions

- **Module path `sezzlecalc/backend`.** Chosen explicitly (rather than a hosting URL); derived import path is `sezzlecalc/backend/internal/calc`.
- **`go 1.22` minimum, no `toolchain` directive, no `require`/`go.sum`.** The `go.mod` is three lines and stdlib-only. `go mod init` was deliberately *not* used, because a newer local toolchain would seed a newer `go` line and possibly a `toolchain` line; the file is written by hand to keep the module portable across any Go ≥ 1.22.
- **Sentinel errors over dynamic strings.** `ErrDivideByZero` and `ErrUnknownOperation` are package-level `errors.New` values so callers (and the future HTTP layer) match with `errors.Is` rather than string comparison.
- **Pure, stateless domain, separated from HTTP.** The package has no mutable package-level state, no I/O, no goroutines, and imports no `net/http`; the single exported function is a pure function of its arguments. The HTTP boundary (`internal/httpapi` + `cmd/`) is a deliberate later phase.
- **IEEE-754 pass-through for non-finite operands.** `Evaluate` does not add a non-finite-operand error; `NaN`/`±Inf` flow through with standard float semantics (decided in the PRD).
- **Explicit zero-divisor guard.** `divide` checks `b == 0` and returns `ErrDivideByZero` rather than relying on Go's `±Inf`/`NaN` behavior; `-0.0` is treated as zero (the single `b == 0` check suffices because `+0.0 == -0.0`).
- **Normalization in one place.** Trim + case-fold + `switch` guarantees exactly four accepted operation names and no aliases.

## North star (forward-looking, **not yet built**)

The eventual REST API is governed by the `api-contract` skill (`.opencode/skills/api-contract/SKILL.md`) and consists of:

- `POST /evaluate` — evaluate a single arithmetic operation.
- `GET /health` — liveness check.

The planned error mapping from the domain's sentinel errors: `ErrDivideByZero` → `422 Unprocessable Entity`, `ErrUnknownOperation` → `400 Bad Request`. None of this HTTP surface exists yet; this phase only delivers the domain sentinels so that mapping is possible later.

## Testing & coverage

- Tests are **table-driven** (`t.Run` per case) and assert **both** the returned value and the returned error via `errors.Is`.
- The suite covers all four operations across positive, negative, zero, fractional, and mixed-sign operands; operation-name normalization (mixed-case and padded); unknown-operation errors; and divide-by-zero including a runtime-constructed `-0.0` divisor.
- A concurrency test exercises overlapping `Evaluate` calls from multiple goroutines; `make backend-test` runs it under the `-race` detector.
- `make backend-cover` reports **100% statement coverage** for `internal/calc` (`Evaluate` at 100%). See [`docs/ai/coverage-summary.md`](docs/ai/coverage-summary.md) for details.

## AI-assisted development

This feature was delivered through a multi-agent pipeline (PRD → plan → plan review → implementation → verification → docs). The curated prompt trail lives in [`PROMPTS.md`](PROMPTS.md); the complete raw log is [`docs/ai/prompt-log.md`](docs/ai/prompt-log.md).
