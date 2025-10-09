# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Stepcat is a step-by-step agent orchestration solution that automates multi-step development plans using Claude Code (for implementation) and Codex (for code review). It parses a markdown plan file, implements each step via Claude Code, waits for GitHub Actions to pass, uses Codex to review the code, and then moves to the next step.

## Common Commands

### Development
```bash
just build          # Build the project (npm run build)
just lint           # Run ESLint
just test           # Run Jest tests
just dev --file plan.md --dir /path/to/project  # Run in dev mode with ts-node
just ci             # Run full CI check (lint + test + build)
```

### npm Scripts
```bash
npm run build       # Compile TypeScript to dist/
npm run dev         # Run with ts-node (pass args with --)
npm test            # Run Jest
npm run lint        # Run ESLint
```

### Local Testing
```bash
just install-local      # Build and npm link for local testing
just uninstall-local    # Remove npm link
```

## Architecture

### Core Components

**Orchestrator** (`src/orchestrator.ts`): Main coordinator that drives the entire process
- Parses steps once at startup (manual edits during execution won't be reflected until next run)
- For each pending step:
  1. **Implementation Phase**: Invokes Claude Code with step number and plan content
  2. **Build Verification Phase**: Waits for GitHub Actions, retries fixes if needed (up to `maxBuildAttempts`)
  3. **Code Review Phase**: Runs Codex review, then Claude Code to address issues
- Configuration: `OrchestratorConfig` includes timeouts, max attempts, paths

**StepParser** (`src/step-parser.ts`): Parses markdown plan files
- Expects format: `## Step N: Title` (case-insensitive)
- Completed steps marked with `[done]` suffix: `## Step 1: Setup [done]`
- Validates no duplicate step numbers
- Returns sorted array of `Step` objects with `{number, title, fullHeader, isDone}`

**ClaudeRunner** (`src/claude-runner.ts`): Executes Claude Code
- Locates binary at `../node_modules/.bin/claude`
- Runs with `--print` flag and stdin for prompt
- Uses `spawnSync` with configurable timeout
- Three prompt types: implementation, buildFix, reviewFix (see `src/prompts.ts`)

**CodexRunner** (`src/codex-runner.ts`): Executes Codex for code review
- Locates binary at `../node_modules/.bin/codex`
- Runs with `exec` subcommand
- Captures stdout for review output
- Review prompt includes plan context

**GitHubChecker** (`src/github-checker.ts`): Monitors GitHub Actions
- Uses Octokit to poll check runs via GitHub API
- Polls every 30 seconds until completion or timeout
- Parses repo info from `git remote get-url origin`
- Expects format: `github.com[:/]owner/repo`
- Returns true if all checks pass/skip, false otherwise

**Prompts** (`src/prompts.ts`): All agent prompts
- `implementation(stepNumber, planContent)`: Claude Code implementation task
- `buildFix(buildErrors)`: Fix build failures and amend commit
- `reviewFix(reviewComments)`: Address Codex review feedback
- `codexReview(planContent)`: Review last commit with plan context

### Key Behaviors

**Step Completion Tracking**:
- Steps are marked `[done]` in the plan file after completion
- On restart, Stepcat skips done steps and resumes from first pending
- This enables fault tolerance and manual skip/rerun control

**Build Fix Loop**:
- If GitHub Actions fail, Claude Code is asked to fix and amend the commit
- Retries up to `maxBuildAttempts` (default: 3)
- Uses `git commit --amend` + force push strategy

**Review Process**:
- Codex reviews last commit with full plan context
- If output contains "no issues found" (case-insensitive), skip fixes
- Otherwise, Claude Code addresses the feedback in a new commit

**Execution Model**:
- Steps parsed once at startup (immutable during run)
- Each phase is sequential: implement → build verify → review
- No parallelization between steps

**Target Project Requirements**:
- Must have `justfile` with `build`, `lint`, `test` commands
- Must be a GitHub repo with Actions enabled
- Must have remote origin pointing to GitHub

## TypeScript Configuration

- Target: ES2020, CommonJS modules
- Strict mode enabled
- Output: `dist/` directory
- Excludes: test files (`*.test.ts`, `__tests__`)

## Testing

- Jest with ts-jest preset
- Tests in `src/__tests__/` or `*.test.ts` files
- Run: `just test` or `npm test`

## Important Notes for Development

1. **Prompt customization**: All agent prompts are in `src/prompts.ts` - modify there to change agent behavior
2. **CLI entry point**: `src/cli.ts` has shebang added post-build by npm script
3. **Error handling**: All runners throw on non-zero exit codes
4. **Dependencies**: `@anthropic-ai/claude-code` and `@openai/codex` are required runtime deps (specified as wildcard "*")
5. **GitHub token**: Must be provided via `--token` flag or `GITHUB_TOKEN` env var
