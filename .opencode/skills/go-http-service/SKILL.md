---
name: go-http-service
description: "Idiomatic patterns for a Go net/http JSON service: layout, sentinel errors mapped to HTTP status codes, a consistent JSON response envelope, table-driven tests, and httptest handler tests. Use when building or reviewing Go HTTP services, REST APIs, handlers, middleware, error mapping, or table-driven/httptest unit tests."
---

# Go HTTP Service

Conventions for building a small, correct Go `net/http` JSON service (e.g. the calculator backend) that is testable and hard to get wrong.

## Layout

```
cmd/<name>/main.go      # wiring: flags/env, routes, http.Server; thin
internal/<domain>/       # pure domain logic, no net/http imports
internal/httpapi/        # handlers, request/response types, error mapping
```

- `main.go` only assembles: construct the domain service, register handlers, start the server. No business logic.
- Domain packages stay free of HTTP concerns so they unit-test without a server.
- `internal/httpapi/` owns encoding/decoding and the HTTP error contract.

## Sentinel errors → status codes

Define errors in the domain package and map them with `errors.Is` in one place (e.g. a single `respondError` helper):

| Condition | Status |
|-----------|--------|
| Invalid input (bad JSON, missing/NaN fields, wrong type) | `400 Bad Request` |
| Domain error (e.g. division by zero) | `422 Unprocessable Entity` |
| Anything unexpected (bug, panic recovered) | `500 Internal Server Error` |

```go
var ErrDivideByZero = errors.New("division by zero")

func (s *Service) Divide(a, b float64) (float64, error) {
    if b == 0 {
        return 0, ErrDivideByZero
    }
    return a / b, nil
}
```

In the handler, switch on `errors.Is(err, domain.ErrDivideByZero)` → 422; a parse/decode failure → 400; the default → 500. Never leak the raw error string to the client.

## JSON response envelope

Use one shape everywhere so the frontend never branches on structure:

```json
{ "result": 42, "error": "" }
```

- Success: `result` populated, `error` empty (or omit it).
- Failure: `result` zero-value, `error` a short, stable, client-safe message (no stack traces, no internal paths).

Keep the envelope consistent; `{"result":..., "error":...}` or an equivalent field pair is fine as long as it is the same for every endpoint.

## Testing library

Tests use `github.com/stretchr/testify` (`require` / `assert`). Add it once with
`go get github.com/stretchr/testify` (or `go mod tidy`) and commit the resulting
`go.mod` / `go.sum`. Everything else stays on the standard library — testify is a
test-only dependency.

## Table-driven unit tests

Test the domain package with a table of cases:

```go
import (
    "testing"

    "github.com/stretchr/testify/require"
)

func TestDivide(t *testing.T) {
    cases := []struct {
        name    string
        a, b    float64
        want    float64
        wantErr error
    }{
        {"positive", 8, 2, 4, nil},
        {"fraction", 1, 2, 0.5, nil},
        {"by zero", 5, 0, 0, ErrDivideByZero},
    }
    for _, tc := range cases {
        t.Run(tc.name, func(t *testing.T) {
            got, err := Divide(tc.a, tc.b)
            require.ErrorIs(t, err, tc.wantErr)
            require.Equal(t, tc.want, got)
        })
    }
}
```

Use `t.Run` per case for readable failure output. `require.ErrorIs` compares with `errors.Is` semantics (not `==`) so wrapped errors still match, and `require.ErrorIs(t, err, nil)` asserts "no error". Reach for `require` when the rest of the case depends on the assertion (fail fast); use `assert` for independent checks that should all run.

## httptest handler tests

Exercise the HTTP layer with `net/http/httptest` — no real socket:

```go
import (
    "encoding/json"
    "net/http"
    "net/http/httptest"
    "strings"
    "testing"

    "github.com/stretchr/testify/require"
)

func TestEvaluateHandler(t *testing.T) {
    req := httptest.NewRequest(http.MethodPost, "/evaluate", strings.NewReader(`{"operation":"divide","a":8,"b":2}`))
    req.Header.Set("Content-Type", "application/json")
    rec := httptest.NewRecorder()

    httpapi.New(domain.New()).ServeHTTP(rec, req)

    require.Equal(t, http.StatusOK, rec.Code)

    var got struct {
        Result float64 `json:"result"`
    }
    require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &got))
    require.Equal(t, 4.0, got.Result)
}
```

Assert status code, envelope shape, and value — not just that the request didn't panic.

## Discipline

- `gofmt -l .` must print nothing; run `gofmt -w` on changed files.
- `go vet ./...` must pass with no warnings.
- `go build ./...` and `go test ./...` must pass before hand-off.
- `go mod tidy` leaves `go.mod`/`go.sum` clean.
- Check coverage with `go test -cover ./...`; add cases for untested branches rather than ignoring the number.
