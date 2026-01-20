# Build the project (backend only)
build:
    npm run build

# Build only backend
build-backend:
    npm run build:backend

# Run linting (backend only)
lint:
    npm run lint

# Run backend linting only
lint-backend:
    npm run lint:backend


# Run tests (backend only for now)
test:
    npm test

# Clean build artifacts
clean:
    rm -rf dist

# Install dependencies
install:
    npm install

# Run the CLI in dev mode
dev *ARGS:
    npm run dev -- {{ARGS}}

# Build and install locally
install-local: build
    npm link

# Uninstall local installation
uninstall-local:
    npm unlink

# Format check
format-check:
    npx prettier --check "backend/**/*.ts"

# Format files
format:
    npx prettier --write "backend/**/*.ts"

# Full CI check (run after npm install)
ci: lint test build

# Install, build, and test (full setup)
setup: install build test
