# Stepcat

Step-by-step agent orchestration solution that automates implementation of multi-step development plans using Claude Code and Codex.

## Overview

Stepcat orchestrates the implementation of complex development tasks by:
1. Parsing a markdown file containing numbered steps
2. Using Claude Code to implement each step
3. Waiting for GitHub Actions to pass
4. Using Codex to review the implementation
5. Using Claude Code to address any review comments
6. Moving to the next step

## Installation

```bash
npm install -g stepcat
```

Or install as a dev dependency:

```bash
npm install --save-dev stepcat
```

## Usage

```bash
stepcat --file plan.md --dir /path/to/project
```

### Options

- `-f, --file <path>` - Path to the implementation plan file (required)
- `-d, --dir <path>` - Path to the work directory (required)
- `-t, --token <token>` - GitHub token (optional, defaults to `GITHUB_TOKEN` env var)

### Example

```bash
export GITHUB_TOKEN=your_token_here
stepcat --file implementation-plan.md --dir ./my-project
```

### CLI Options

- `-f, --file <path>` - Path to the implementation plan file (required)
- `-d, --dir <path>` - Path to the work directory (required)
- `-t, --token <token>` - GitHub token (optional, defaults to `GITHUB_TOKEN` env var)
- `--max-build-attempts <number>` - Maximum build fix attempts (default: 3)
- `--build-timeout <minutes>` - GitHub Actions check timeout in minutes (default: 30)
- `--agent-timeout <minutes>` - Agent execution timeout in minutes (default: 30)

**Example with custom timeouts:**

```bash
stepcat --file plan.md --dir ./project \
  --max-build-attempts 5 \
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

### Step Completion Tracking

Stepcat automatically tracks completed steps by marking them with `[done]` in the plan file:

```markdown
## Step 1: Setup Project Structure [done]
```

**Resumability**: If Stepcat is interrupted or fails, simply run it again with the same plan file. It will automatically skip completed steps and resume from where it left off.

**Manual Control**: You can manually mark steps as `[done]` to skip them, or remove the `[done]` marker to re-run a step.

## Customizing Prompts

All prompts used by Stepcat are defined in `src/prompts.ts`. You can customize these prompts to match your project's needs:

- `PROMPTS.implementation` - Prompt for implementing a step
- `PROMPTS.buildFix` - Prompt for fixing build failures
- `PROMPTS.reviewFix` - Prompt for addressing review comments
- `PROMPTS.codexReview` - Prompt for Codex code review

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

## How It Works

For each pending step in the plan:

1. **Implementation**: Claude Code is invoked with the step number and plan file path (agents read the file themselves)
2. **Build Verification**: Waits for GitHub Actions to complete (max 30 minutes)
3. **Build Fix Loop**: If builds fail, Claude Code is asked to fix and amend the commit (max 3 attempts)
4. **Code Review**: Codex reviews the last commit with plan file as context
5. **Review Fixes**: Claude Code addresses any issues found by Codex
6. **Mark Complete**: Claude Code marks the step as `[done]` in the plan file
7. **Next Step**: Moves to the next pending step

**Notes**:
- The implementation plan file path is passed to agents rather than pasting the full content into prompts. This is more efficient and allows agents to read the file directly.
- Completed steps are marked with `[done]` and automatically skipped on subsequent runs.

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
