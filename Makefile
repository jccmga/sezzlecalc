.PHONY: help check backend-build backend-test backend-vet backend-cover frontend-install frontend-test frontend-lint frontend-build docker-build docker-up docker-down docker-e2e

help:
	@echo "Available targets:"
	@echo "  check              Run all build + test gates"
	@echo "  backend-build      Build the Go backend"
	@echo "  backend-test       Run backend tests with the race detector"
	@echo "  backend-vet        Vet the Go backend and check formatting"
	@echo "  backend-cover      Run backend tests, write backend/coverage.txt"
	@echo "  frontend-install   Install frontend dependencies"
	@echo "  frontend-test      Run the frontend test suite"
	@echo "  frontend-lint      Lint the frontend"
	@echo "  frontend-build     Build the frontend for production"
	@echo "  docker-build       Build both Docker images (docker compose build)"
	@echo "  docker-up          Start the full stack (docker compose up -d)"
	@echo "  docker-down        Stop and remove the stack (docker compose down)"
	@echo "  docker-e2e         Smoke-test the running stack via curl (requires docker-up)"

check: backend-build backend-test backend-vet frontend-test frontend-lint frontend-build

backend-build:
	cd backend && go build ./...

backend-test:
	cd backend && go test -race ./...

backend-vet:
	cd backend && go vet ./... && test -z "$$(gofmt -l .)"

backend-cover:
	cd backend && go test -coverprofile=coverage.txt ./... && go tool cover -func=coverage.txt

frontend-install:
	cd frontend && npm install

frontend-test:
	cd frontend && npm run test

frontend-lint:
	cd frontend && npm run lint

frontend-build:
	cd frontend && npm run build

docker-build:
	docker compose build

docker-up:
	docker compose up -d

docker-down:
	docker compose down

docker-e2e:
	curl -sS -f --fail-with-body -o /dev/null -w 'GET / -> %{http_code} %{content_type}\n' http://localhost:3000/
	curl -sS -f --fail-with-body -X POST http://localhost:3000/api/evaluate -H 'Content-Type: application/json' -d '{"operation":"multiply","a":12,"b":4}'; echo
	curl -sS -f --fail-with-body http://localhost:8080/health; echo
