# Repository Guide

This is a repository for a full-stack calculator: a Go backend plus a React/Vite/TypeScript frontend.

## Project context

A full-stack calculator — a Go REST API consumed by a React/TypeScript frontend. It is graded on correctness, clarity, maintainability, and testability over feature count.

Deliverables:

- A README with setup, how to run both layers, API examples, and design decisions/assumptions.
- Unit tests with a coverage report.
- Docker packaging for the full stack.

North star:

- One `POST /evaluate` endpoint plus `GET /health`.
- A pure `internal/calc` domain (no `net/http`) and a thin `internal/httpapi` layer.
- The frontend validates and formats only — it never performs arithmetic.
- The REST contract is the `api-contract` skill (single source of truth); the two layers must not drift.

Out of scope: expression parser, persistence, auth, i18n, CI/CD, observability, and rate limiting.

## Layout

- `backend/` — Go module. The calculator HTTP service (REST API).
- `frontend/` — Vite + React + TypeScript. Consumes the backend API.
- `.opencode/` — agent harness: `agents/`, `skills/`, `commands/`, `plugins/`.

## Build & test

Use the root `Makefile` as the canonical entry point:

```
make help           # list all targets
make backend-build  # go build ./...
make backend-test   # go test -race ./...
make backend-vet    # go vet ./... and gofmt -l
make backend-cover  # writes backend/coverage.txt
make frontend-install
make frontend-test
make frontend-build
```

Underlying commands (what the targets run):

Backend (Go):

```
cd backend && go build ./... && go test -race ./... && go vet ./...
```

Frontend (Vite + React + TS):

```
cd frontend && npm install
npm run dev      # dev server
npm run test     # unit/component tests
npm run build    # production build
```

## API contract

The shared REST contract (operations, request/response JSON shapes, and the error taxonomy) lives in the `api-contract` skill. The Go backend and React frontend must both conform to it so the two layers cannot drift.

## Worktree rule

Implementation happens inside a `git gtr` worktree — never in the main checkout. The orchestrator launches the session with `git gtr`, and `@coder` must confirm it is in the isolated worktree before editing.

## Before side effects

Ask the user before running `git add`, `git commit`, `git push`, or docker commands.
