# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Stepcat is a step-by-step agent orchestration solution that automates multi-step development plans using Claude Code (for implementation) and Codex (for code review). It parses a markdown plan file, implements each step via Claude Code, waits for GitHub Actions to pass, uses Codex to review the code, and then moves to the next step.

**Key Principle**: One commit per step. All fixes (build and review) are applied via `git commit --amend`, and plan file phase markers are amended into the step commit. This ensures a clean, linear git history.

## Common Commands

### Development
```bash
just build          # Build the project (npm run build)
just lint           # Run ESLint
just test           # Run Jest tests
just dev --file plan.md --dir /path/to/project  # Run in dev mode with ts-node
just dev --file plan.md --dir /path/to/project --ui  # Run with web UI
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

### Web UI
```bash
# Launch with web UI (opens browser automatically)
stepcat --file plan.md --dir /path/to/project --ui

# Custom port without auto-open
stepcat --file plan.md --dir /path/to/project --ui --port 8080 --no-auto-open
```

## Architecture

### Core Components

**Orchestrator** (`src/orchestrator.ts`): Main coordinator that drives the entire process
- Parses steps once at startup (manual edits during execution won't be reflected until next run)
- Enforces "one commit per step" policy via `amendPlanFileAndPush()` method
- For each pending step:
  1. **Implementation Phase**: Invokes Claude Code to create initial commit, amends `[implementation]` marker into commit, pushes
  2. **Build Verification Phase**: Waits for GitHub Actions, retries fixes if needed (up to `maxBuildAttempts`). Fixes amend the commit.
  3. **Code Review Phase**: Amends `[review]` marker, runs Codex review with structured result detection, Claude Code amends fixes if needed
  4. **Completion**: Amends `[done]` marker into commit and pushes
- Configuration: `OrchestratorConfig` includes timeouts, max attempts, paths, event emitter, silent mode
- Emits events via `OrchestratorEventEmitter` for real-time UI updates
- Supports `silent` mode for web UI (suppresses console.log, only emits events)
- All pushes handled by orchestrator; agents never push

**StepParser** (`src/step-parser.ts`): Parses markdown plan files
- Expects format: `## Step N: Title` (case-insensitive)
- Completed steps marked with `[done]` suffix: `## Step 1: Setup [done]`
- Validates no duplicate step numbers
- Returns sorted array of `Step` objects with `{number, title, fullHeader, isDone}`

**ClaudeRunner** (`src/claude-runner.ts`): Executes Claude Code
- Locates binary at `../node_modules/.bin/claude`
- Runs with `--print`, `--verbose`, `--add-dir`, `--permission-mode acceptEdits` flags
- Uses async `spawn` with stdin for prompt and configurable timeout
- Inherits stdout/stderr for real-time streaming output
- Validates commit count from baseline to enforce "one commit per step" policy
- Three prompt types: implementation, buildFix, reviewFix (see `src/prompts.ts`)
- Accepts optional `baselineCommit` parameter for fix operations to enforce amend behavior

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
- `implementation(stepNumber, planContent)`: Claude Code implementation task (creates initial commit)
- `buildFix(buildErrors)`: Fix build failures and amend commit
- `reviewFix(reviewComments)`: Address Codex review feedback and amend commit
- `codexReview(planFilePath)`: Review last commit with plan context; uses structured markers `[STEPCAT_REVIEW_RESULT: PASS/FAIL]` for reliable detection

**Events** (`src/events.ts`): Event system for real-time UI updates
- `OrchestratorEventEmitter`: EventEmitter subclass with typed events
- Event types: `init`, `step_start`, `step_complete`, `phase_start`, `phase_complete`, `log`, `github_check`, `build_attempt`, `review_start`, `review_complete`, `all_complete`, `error`
- All events include timestamp and type discriminator

**WebServer** (`src/web-server.ts`): HTTP server with WebSocket support
- Express server serving embedded HTML/CSS/JS
- WebSocket server for real-time event broadcasting
- Embedded beautiful purple/pastel UI with animations
- Features: step tracking, phase indicators, GitHub status, activity log, review progress indicators
- Auto-opens browser (configurable)
- Default port: 3742 (configurable)
- **Security**: All dynamic content (step titles, log messages) is HTML-escaped via `escapeHtml()` to prevent XSS attacks

### Key Behaviors

**Git Commit Policy - One Commit Per Step**:
- Each step results in exactly one commit in git history
- Initial implementation creates the commit
- All fixes (build and review) use `git commit --amend` to modify the existing commit
- Plan file phase markers (`[implementation]`, `[review]`, `[done]`) are amended into the step commit
- Orchestrator handles all pushes via `amendPlanFileAndPush()` method
- Agents are explicitly instructed NOT to push (orchestrator does it after amending plan file)
- This policy ensures clean, linear git history where each commit is a complete, tested, reviewed step

**Step Completion Tracking**:
- Steps are marked with phase markers in the plan file: `[implementation]`, `[review]`, `[done]`
- Phase markers are amended into the step commit (not separate commits)
- On restart, Stepcat skips done steps and resumes from first pending
- This enables fault tolerance and manual skip/rerun control
- Example: `## Step 1: Setup Project [review]` means step is in review phase

**Build Fix Loop**:
- If GitHub Actions fail, Claude Code is asked to fix and amend the commit
- Retries up to `maxBuildAttempts` (default: 3)
- Uses `git commit --amend` + `git push --force-with-lease` strategy
- Orchestrator handles the push after agent amends

**Review Process**:
- Orchestrator amends `[review]` marker into commit before review
- Codex reviews last commit with full plan context
- Uses structured markers for reliable detection (`reviewHasIssues()` method in `orchestrator.ts:331`):
  - **Primary detection**: Looks for `[STEPCAT_REVIEW_RESULT: PASS]` or `[STEPCAT_REVIEW_RESULT: FAIL]` markers
  - **Fallback detection**: Normalizes output (remove punctuation/whitespace) and checks multiple "no issues" patterns
  - Backward compatible with legacy outputs like "no issues found", "no issues detected", etc.
- If issues found, Claude Code addresses the feedback by amending the commit (not creating new commit)
- Orchestrator pushes amended commit and verifies build still passes

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

1. **Git Commit Policy**: Maintain "one commit per step" - all fixes must use `git commit --amend`, never create new commits for fixes. Plan file updates are amended into the step commit by the orchestrator. Agents are instructed NOT to push (orchestrator handles it).

2. **Review Detection**: Use the `reviewHasIssues()` method which checks for structured markers first (`[STEPCAT_REVIEW_RESULT: PASS/FAIL]`), then falls back to normalized pattern matching. Never use simple substring matching for review results.

3. **Prompt customization**: All agent prompts are in `src/prompts.ts` - modify there to change agent behavior. Prompts explicitly instruct agents NOT to push.

4. **CLI entry point**: `src/cli.ts` has shebang added post-build by npm script

5. **Error handling**: All runners throw on non-zero exit codes

6. **Dependencies**: `@anthropic-ai/claude-code` and `@openai/codex` are required runtime deps (specified as wildcard "*")

7. **GitHub token**: Must be provided via `--token` flag or `GITHUB_TOKEN` env var

8. **Web UI Security**: All dynamic content rendered in the UI must be HTML-escaped to prevent XSS. Use the `escapeHtml()` function for any user-controlled content (step titles, messages, etc.) before inserting into `innerHTML`
