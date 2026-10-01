# Murdle. Two services: the Go API and the Next.js app.
#
#   make dev    both at once, in one terminal
#   make api    just the Go API      (:8080)
#   make web    just the Next.js app (:3000)
#   make test   Go tests, typecheck, lint

.PHONY: dev api web test install stop

api:
	cd server && go run ./cmd/murdled

web:
	cd web && pnpm dev

# Runs both and shuts both down together: without the trap, killing this with
# ctrl-c leaves the other one holding its port, and the next `make dev` fails
# with "address already in use".
dev:
	@trap 'kill 0' EXIT INT TERM; \
	(cd server && go run ./cmd/murdled) & \
	(cd web && pnpm dev) & \
	wait

install:
	cd web && pnpm install
	cd server && go mod download

test:
	cd server && go test ./...
	cd web && pnpm exec tsc --noEmit && pnpm exec eslint src --max-warnings=0

# For when something is still holding a port.
stop:
	@lsof -ti:8080 | xargs kill -9 2>/dev/null || true
	@lsof -ti:3000 | xargs kill -9 2>/dev/null || true
	@echo "ports 8080 and 3000 free"
