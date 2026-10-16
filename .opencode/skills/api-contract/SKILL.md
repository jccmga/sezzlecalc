---
name: api-contract
description: "The single source of truth for the calculator REST contract shared by the Go backend and React frontend. Use when defining or changing request/response shapes, JSON schemas, operations, error handling, or syncing the frontend and backend so the two layers cannot drift."
---

# API Contract (calculator)

This is the single source of truth for the calculator REST API. The Go backend implements it and the React frontend consumes it — both must match this document, so neither layer can drift.

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/evaluate` | Evaluate a single arithmetic operation. |
| `GET` | `/health` | Liveness check; always returns `200`. |

`GET /health` responds:

```json
{ "status": "ok" }
```

## Operations

All seven operations are in scope:

| Operation | Operands | Result |
|-----------|----------|--------|
| `add` | `a`, `b` | `a + b` |
| `subtract` | `a`, `b` | `a - b` |
| `multiply` | `a`, `b` | `a * b` |
| `divide` | `a`, `b` | `a / b` (`b == 0` is a domain error → 422) |
| `power` | `a`, `b` | `a ** b` |
| `sqrt` | `a` | `sqrt(a)` |
| `percent` | `a` | `a / 100` |

`percent(a) = a / 100`. `sqrt` and `percent` take a single operand and omit `b`.

## Request

`POST /evaluate` accepts JSON over HTTP. `a` and `b` are numbers; operations that take one operand (`sqrt`, `percent`) omit `b`.

```json
{ "operation": "add", "a": 1.5, "b": 2.5 }
```

- Invalid JSON, missing operands, wrong-type operands, or non-finite `NaN`/`Inf` input → `400 Bad Request`.

## Response

One consistent envelope for every operation:

- Success: `200` with `{"result": <number>}`.
- Error: `4xx` with `{"error": "<fixed-string>"}` — **no `result` field is present on error bodies**.

```json
{ "result": 4.0 }
```

```json
{ "error": "division by zero" }
```

## Error taxonomy

Closed vocabulary of stable, client-safe `error` strings:

| Status | `error` string | When |
|--------|----------------|------|
| `400` | `invalid input` | Malformed JSON, missing operand, wrong-type operand, or non-finite (`NaN`/`Inf`) input |
| `422` | `division by zero` | `divide` with `b == 0` (including `-0.0`) |
| `422` | `square root of negative number` | `sqrt` of a negative number |
| `422` | `invalid operation` | Unknown `operation` string |
| `422` | `non-finite result` | Result overflows to `Inf` (or is otherwise non-finite) |

The frontend must map these statuses to user-facing messages using the same `error` string as the contract, never its own ad-hoc strings.
