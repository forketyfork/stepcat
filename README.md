# Stepcat

Step-by-step agent orchestration solution that automates implementation of multi-step development plans using Claude Code and Codex.

## Overview

Stepcat orchestrates the implementation of complex development tasks by:
1. Parsing a markdown file containing numbered steps
2. Using Claude Code to implement each step
3. Pushing changes and waiting for GitHub Actions to pass
4. Using Codex to review the implementation with structured JSON output
5. Using Claude Code to fix any build failures or review issues
6. Creating separate commits for each iteration (implementation, build fixes, review fixes)
7. Moving to the next step when all checks pass

All execution state is stored in a SQLite database (`.stepcat/executions.db`), enabling resume functionality and complete audit trails. Each Claude Code execution creates a separate git commit, providing full transparency and traceability.

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

All prompts used by Stepcat are defined in `src/prompts.ts`. You can customize these prompts to match your project's needs:

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

**One Commit Per Iteration**: Stepcat creates a separate git commit for each Claude Code execution, providing complete transparency and audit trails.

- **Initial implementation**: Claude Code creates Commit 1
- **Build fix**: If CI fails, Claude Code creates Commit 2
- **Review fix iteration 1**: If Codex finds issues, Claude Code creates Commit 3
- **Review fix iteration 2**: Additional fixes create Commit 4, and so on
- **Maximum iterations**: 10 per step (configurable)
- **Pushing**: The orchestrator handles all pushes; agents never push themselves
- **No amending**: All commits are separate (never use `git commit --amend`)

**Trade-off**: This creates a more verbose git history with multiple commits per step, but provides full transparency, traceability, and easier debugging. Each commit SHA is captured and stored in the database for complete audit trails.

## How It Works

For each pending step in the plan:

1. **Initial Implementation Iteration**:
   - Claude Code implements the step (creates Commit 1)
   - Orchestrator pushes and waits for GitHub Actions

2. **Build Verification Loop**:
   - If CI fails: Create build_fix iteration → Claude creates new commit → push → repeat until CI passes

3. **Code Review**:
   - Run Codex with context-specific prompt (implementation/build_fix/review_fix)
   - Codex returns structured JSON: `{"result": "PASS"|"FAIL", "issues": [...]}`
   - Parse issues and save to database

4. **Review Fix Loop**:
   - If issues found: Create review_fix iteration → Claude creates new commit → push → back to build verification
   - Repeat until Codex returns `"result": "PASS"`

5. **Step Complete**:
   - Mark step as completed in database
   - Move to next step

6. **Maximum Iterations**:
   - If a step exceeds 10 iterations, mark as failed and halt execution

**Key Points**:
- All state stored in SQLite database (`.stepcat/executions.db`)
- Plan file is never modified during execution
- Each Claude execution creates a separate commit (full audit trail)
- Issues are tracked with file paths, line numbers, and resolution status
- Iteration types: 'implementation', 'build_fix', 'review_fix'
- Full traceability: Issue → Iteration → Commit SHA
- Resume at any time using execution ID

## Environment Variables

- `GITHUB_TOKEN` - GitHub personal access token (required if not provided via `--token`)

## Development

Stepcat includes a `justfile` for convenient development commands:

```bash
# Install dependencies
just install

# Build the project
just build

# Run linting
just lint

# Run tests
just test

# Run in development mode
just dev --file plan.md --dir /path/to/project

# Full CI check (lint + test + build)
just ci
```

Or using npm directly:

```bash
# Install dependencies
npm install

# Build the project
npm run build

# Run in development mode
npm run dev -- --file plan.md --dir /path/to/project

# Run linting
npm run lint
```

## License

MIT
