# Stepcat

Step-by-step agent orchestration solution that automates implementation of multi-step development plans using Claude Code and Codex, with configurable agents for each stage.

## Overview

Stepcat orchestrates the implementation of complex development tasks by:
1. Parsing a markdown file containing numbered steps
2. Using a configurable implementation agent (Claude Code by default) to implement each step
3. Pushing changes and waiting for GitHub Actions to pass
4. Using a configurable review agent (Codex by default) to review the implementation with structured JSON output
5. Using the selected implementation agent to fix any build failures or review issues
6. Creating separate commits for each iteration (implementation, build fixes, review fixes)
7. Moving to the next step when all checks pass

All execution state is stored in a SQLite database (`.stepcat/executions.db`), enabling resume functionality and complete audit trails. Each implementation iteration creates a separate git commit, providing full transparency and traceability.

## Installation

```bash
npm install -g stepcat
```

Or install as a dev dependency:

```bash
npm install --save-dev stepcat
```

## Usage

### CLI Mode (Default)

Run Stepcat with terminal output:

```bash
stepcat --file plan.md --dir /path/to/project
```

### Web UI Mode

Launch the beautiful web interface for real-time progress visualization:

```bash
stepcat --file plan.md --dir /path/to/project --ui
```

The web UI features:
- 🎨 **Beautiful purple/pastel design** with smooth animations
- 📊 **Hierarchical view** of Steps → Iterations → Issues
- 🔄 **Live GitHub Actions status** with visual progress indicators
- 📋 **Detailed iteration tracking** with commit SHAs and logs
- 🐛 **Issue tracking** from CI failures and code reviews
- ⚡ **WebSocket-powered** instant updates
- 📱 **Responsive design** that works on all devices
- 🔽 **Collapsible sections** for easy navigation

The UI automatically opens in your default browser at `http://localhost:3742` (customizable with `--port`).

### CLI Options

- `-f, --file <path>` - Path to the implementation plan file (required for new executions)
- `-d, --dir <path>` - Path to the work directory (required for new executions, optional for resume)
- `-e, --execution-id <id>` - Resume existing execution by ID
- `-t, --token <token>` - GitHub token (optional, defaults to `GITHUB_TOKEN` env var)
- `--build-timeout <minutes>` - GitHub Actions check timeout in minutes (default: 30)
- `--agent-timeout <minutes>` - Agent execution timeout in minutes (default: 30)
- `--implementation-agent <agent>` - Agent to use for implementation iterations (`claude` or `codex`, default: `claude`)
- `--review-agent <agent>` - Agent to use for code review (`claude` or `codex`, default: `codex`)
- `--ui` - Launch web UI (default: false)
- `--port <number>` - Web UI port (default: 3742)
- `--no-auto-open` - Don't automatically open browser when using --ui

### Examples

**Start a new execution with web UI:**

```bash
export GITHUB_TOKEN=your_token_here
stepcat --file implementation-plan.md --dir ./my-project --ui
```

**Resume an existing execution:**

```bash
stepcat --execution-id 123
```

**Resume from a different directory:**

```bash
stepcat --execution-id 123 --dir /path/to/project
```

**Custom port without auto-opening browser:**

```bash
stepcat --file plan.md --dir ./project --ui --port 8080 --no-auto-open
```

**CLI mode with custom timeouts:**

```bash
stepcat --file plan.md --dir ./project \
  --build-timeout 45 \
  --agent-timeout 60
```

## Implementation Plan Format

The plan file should be a markdown document with steps marked as second-level headers:

```markdown
# Project Implementation Plan

## Step 1: Setup Project Structure

Create the basic project structure with necessary directories and configuration files.

## Step 2: Implement Core Features

Implement the core functionality as described in the specification.

## Step 3: Add Tests

Add comprehensive test coverage for all features.
```

Stepcat will parse these steps and implement them one by one.

### Execution State and Resumability

Stepcat stores all execution state in a SQLite database at `.stepcat/executions.db` in your project directory. The plan file itself is **never modified** during execution.

**Database tracks**:
- Steps with their status (pending, in_progress, completed, failed)
- Iterations for each step (implementation, build fixes, review fixes)
- Issues found during CI and code review
- Commit SHAs for each iteration
- Full logs from Claude Code and Codex

**Resume functionality**: If Stepcat is interrupted or fails, you can resume from where it left off:

```bash
# Note the execution ID when starting
stepcat --file plan.md --dir ./project
# Output: Execution ID: 123

# Later, resume with:
stepcat --execution-id 123
```

The execution will continue from the first pending or in-progress step.

## Customizing Prompts

All prompts used by Stepcat are defined in `backend/prompts.ts`. You can customize these prompts to match your project's needs:

**Claude Code prompts** (create new commits, never amend):
- `implementation()` - Initial implementation of a step
- `buildFix()` - Fix build/CI failures
- `reviewFix()` - Address code review feedback

**Codex prompts** (request structured JSON output):
- `codexReviewImplementation()` - Review initial implementation
- `codexReviewBuildFix()` - Verify build fixes address failures
- `codexReviewCodeFixes()` - Verify fixes address review issues

All Codex prompts expect JSON output: `{"result": "PASS"|"FAIL", "issues": [...]}`

## Requirements

### Stepcat Requirements

- Node.js 18 or higher
- `@anthropic-ai/claude-code` npm package (installed as dependency)
- `@openai/codex` npm package (installed as dependency)
- GitHub repository with Actions enabled
- GitHub token with appropriate permissions
- [just](https://github.com/casey/just) command runner (optional, for development)

The Claude Code and Codex CLIs are installed automatically as npm dependencies.

### Target Project Requirements

Your target project (the one being developed) **must** have the following `just` commands defined in a `justfile`:

- `just build` - Build the project
- `just lint` - Run linting
- `just test` - Run tests

**Example justfile for a Node.js project:**

```justfile
# Build the project
build:
    npm run build

# Run linting
lint:
    npm run lint

# Run tests
test:
    npm test
```

Claude Code will execute these commands after implementing each step to ensure code quality.

## Git Commit Strategy

**One Commit Per Iteration**: Stepcat creates a separate git commit for each implementation agent execution, providing complete transparency and audit trails.

- **Initial implementation**: The implementation agent creates Commit 1
- **Build fix**: If CI fails, the implementation agent creates Commit 2
- **Review fix iteration 1**: If the review agent finds issues, the implementation agent creates Commit 3
- **Review fix iteration 2**: Additional fixes create Commit 4, and so on
- **Maximum iterations**: 3 per step (configurable)
- **Pushing**: The orchestrator handles all pushes; agents never push themselves
- **No amending**: All commits are separate (never use `git commit --amend`)

**Trade-off**: This creates a more verbose git history with multiple commits per step, but provides full transparency, traceability, and easier debugging. Each commit SHA is captured and stored in the database for complete audit trails.

## How It Works

For each pending step in the plan:

1. **Initial Implementation Iteration**:
   - The implementation agent implements the step (creates Commit 1)
   - Orchestrator pushes and waits for GitHub Actions

2. **Build Verification Loop**:
   - If CI fails: Create build_fix iteration → the implementation agent creates a new commit → push → repeat until CI passes

3. **Code Review**:
   - Run the selected review agent with context-specific prompt (implementation/build_fix/review_fix)
   - The review agent returns structured JSON: `{"result": "PASS"|"FAIL", "issues": [...]}`
   - Parse issues and save to database

4. **Review Fix Loop**:
   - If issues found: Create review_fix iteration → the implementation agent creates a new commit → push → back to build verification
   - Repeat until the review agent returns `"result": "PASS"`

5. **Step Complete**:
   - Mark step as completed in database
   - Move to next step

6. **Maximum Iterations**:
   - If a step exceeds 3 iterations, mark as failed and halt execution

**Key Points**:
- All state stored in SQLite database (`.stepcat/executions.db`)
- Plan file is never modified during execution
 - Each implementation agent execution creates a separate commit (full audit trail)
- Issues are tracked with file paths, line numbers, and resolution status
- Iteration types: 'implementation', 'build_fix', 'review_fix'
- Full traceability: Issue → Iteration → Commit SHA
- Resume at any time using execution ID

## Environment Variables

- `GITHUB_TOKEN` - GitHub personal access token (required if not provided via `--token`)

## Project Architecture

Stepcat is organized into two main components:

### Backend (`backend/`)
- **TypeScript + Node.js** backend with Express
- SQLite database for execution state
- Claude Code and Codex integration
- WebSocket server for real-time updates

### Frontend (`frontend/`)
- **React 18 + TypeScript + Vite** frontend
- Beautiful purple/pastel UI with smooth animations
- WebSocket client for real-time updates
- Component-based architecture with proper separation of concerns

The backend serves the built frontend as static files, creating a seamless single-application experience.

## Development

### Running Locally from Sources

To run Stepcat locally during development, you need to build the frontend first (since the backend serves the built React app):

```bash
# 1. Install all dependencies (root + frontend)
npm install
cd frontend && npm install && cd ..

# 2. Build the frontend
npm run build:frontend
# or: just build-frontend

# 3. Run the backend with ts-node
npm run dev -- --file plan.md --dir /path/to/project --ui
# or: just dev --file plan.md --dir /path/to/project --ui
```

**Alternative using justfile:**

```bash
just install           # Install all dependencies
just build-frontend    # Build React app
just dev --file plan.md --dir /path/to/project --ui
```

**Note**: The frontend must be built before running the backend with `--ui`, as the backend serves the static React files from `frontend/dist/`. If you make changes to the frontend, rebuild it with `npm run build:frontend` or `just build-frontend`.

### Development Commands

```bash
# Install dependencies (both root and frontend)
just install

# Build the entire project (frontend + backend)
just build

# Build only backend
just build-backend

# Build only frontend
just build-frontend

# Run backend linting
just lint

# Run frontend linting
just lint-frontend

# Run tests (Jest + Vitest)
just test

# Clean build artifacts
just clean

# Full CI check (lint + test + build)
just ci
```

Or using npm directly:

```bash
# Build the entire project
npm run build

# Build only backend
npm run build:backend

# Build only frontend
npm run build:frontend

# Run backend linting
npm run lint

# Run all tests (Jest + Vitest)
npm test

# Run only Jest tests
npm run test:jest

# Run only Vitest tests
npm run test:vitest

# Run Vitest in watch mode
npm run test:watch
```

### Testing

Stepcat uses a **hybrid testing approach** with two test frameworks:

- **Jest** (69 tests): Tests for CommonJS-compatible code
- **Vitest** (50 tests): Tests for ESM-specific code that uses `import.meta.url`

**Why two frameworks?**

The project uses native ECMAScript Modules (ESM) with `import.meta.url` for path resolution. Jest runs in CommonJS mode and cannot handle `import.meta.url` at runtime. Vitest provides native ESM support for these tests.

**Test files:**
- `*.test.ts` - Jest tests (run with `npm run test:jest`)
- `*.vitest.ts` - Vitest tests (run with `npm run test:vitest`)
- `npm test` - Runs both frameworks (119 total tests)

All tests are located in `backend/__tests__/` directory.

### Frontend Development

To work on the web UI separately:

```bash
# Start the frontend dev server with hot reload
cd frontend
npm install
npm run dev
```

The frontend dev server runs on `http://localhost:5173` and expects the backend WebSocket server to be running on port 3742.

## License

MIT
