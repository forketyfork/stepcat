# Build the project
build:
    npm run build

# Run linting
lint:
    npm run lint

# Run tests
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
    npx prettier --check "src/**/*.ts"

# Format files
format:
    npx prettier --write "src/**/*.ts"

# Full CI check (run after npm install)
ci: lint test build

# Install, build, and test (full setup)
setup: install build test
