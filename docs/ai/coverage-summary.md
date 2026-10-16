# Backend coverage summary

This covers the **backend domain package** only — `sezzlecalc/backend/internal/calc`, the single Go package that exists in this phase. There is no HTTP layer or frontend yet, so "100% coverage" refers to one package and one function, not the whole project.

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
- **`Evaluate` — 100%** — all four `switch` arms, the `b == 0` divide-by-zero guard, and the `default` (unknown-operation) branch are all covered.
- The artifact `backend/coverage.txt` is git-ignored (added to `.gitignore` in this feature).

## What the table-driven suite covers

`backend/internal/calc/calc_test.go` (`TestEvaluate`, plus `TestNegativeZeroConstruction` and `TestEvaluateConcurrent`) exercises:

- **All four operations** (`add`, `subtract`, `multiply`, `divide`) across positive, negative, zero, fractional, and mixed-sign operands.
- **Operation-name normalization** — mixed-case, upper-case, and whitespace-padded variants (`"Add"`, `" add "`, `"ADD"`, `"MuLtIpLy"`, …) resolve to the canonical result.
- **Unknown-operation errors** — `"mod"`, `""`, whitespace-only, and the alias `"plus"` all return `ErrUnknownOperation`.
- **Divide-by-zero** — positive, zero, and negative numerators with a `+0.0` divisor, and with a runtime-constructed `-0.0` divisor (`math.Copysign(0, -1)`, not an untyped `-0.0` literal that would collapse to `+0.0`).
- **Concurrency/statelessness** — 8 goroutines × 100 iterations over an overlapping input set (including a divide-by-zero and a `-0.0` divisor case), asserting deterministic results.

## Scope note (no overstatement)

- This is **statement coverage of the single current package** (`internal/calc`), not branch/MCDC coverage and not coverage of any HTTP layer.
- Error assertions use `errors.Is`, so the sentinel-error matching path is exercised directly.

## Race detector

`make backend-test` runs `go test -race ./...`, which passes — the race detector also validates the statelessness/concurrency expectation (no shared mutable state, no data races).
