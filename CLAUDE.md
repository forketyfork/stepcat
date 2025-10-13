# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Stepcat is a step-by-step agent orchestration solution that automates multi-step development plans using Claude Code and Codex. Each stage can be configured to use either agent (Claude Code by default for implementation, Codex by default for review). It uses a SQLite database to track execution state, iterations, and issues. For each step, it implements code via the selected implementation agent, waits for GitHub Actions to pass, uses the configured review agent to analyze the changes with structured JSON output, and iterates until the step is complete.

**Key Principle**: One commit per iteration (not per step) for complete audit trail. Each implementation agent execution creates a separate git commit, providing full transparency and traceability throughout the development process.

## Common Commands

### Development
```bash
just build              # Build the entire project (frontend + backend)
just build-frontend     # Build only frontend
just build-backend      # Build only backend
just lint               # Run backend ESLint
just lint-frontend      # Run frontend ESLint
just test               # Run Jest tests
just dev --file plan.md --dir /path/to/project  # Run in dev mode with ts-node
just dev --file plan.md --dir /path/to/project --ui  # Run with web UI
just ci                 # Run full CI check (lint + test + build)
```

### npm Scripts
```bash
npm run build           # Build entire project (frontend + backend)
npm run build:frontend  # Build only frontend (React + Vite)
npm run build:backend   # Compile backend TypeScript to dist/
npm run dev             # Run backend with ts-node
npm run dev:frontend    # Run frontend dev server with hot reload
npm run start           # Run from built dist/
npm test                # Run Jest
npm run lint            # Run backend ESLint
```

### Local Testing
```bash
just install-local      # Build and npm link for local testing
just uninstall-local    # Remove npm link
```

### Execution
```bash
# Start new execution (prints execution ID)
stepcat --file plan.md --dir /path/to/project

# Start with web UI (opens browser automatically)
stepcat --file plan.md --dir /path/to/project --ui

# Resume existing execution
stepcat --execution-id 123

# Resume with web UI
stepcat --execution-id 123 --ui

# Custom port without auto-open
stepcat --file plan.md --dir /path/to/project --ui --port 8080 --no-auto-open
```

## Architecture

### Project Structure

Stepcat is organized into two main components:

**Backend** (`backend/`): TypeScript + Node.js
- Express server with WebSocket support
- SQLite database for execution state
- Claude Code and Codex integration
- Serves built React frontend as static files

**Frontend** (`frontend/`): React 18 + TypeScript + Vite
- Beautiful purple/pastel UI with animations
- WebSocket client for real-time updates
- Component-based architecture
- Separate dev server for frontend development

### Database Schema

Stepcat uses SQLite to persist execution state at `.stepcat/executions.db` in the work directory. The database has four main tables:

**Plan Table**:
- `id` (INTEGER PRIMARY KEY): Unique execution identifier
- `planFilePath` (TEXT): Path to the plan markdown file
- `workDir` (TEXT): Working directory for the execution
- `createdAt` (TEXT): ISO timestamp of execution start

**Step Table**:
- `id` (INTEGER PRIMARY KEY): Unique step identifier
- `planId` (INTEGER): Foreign key to plan
- `stepNumber` (INTEGER): Step number from plan file
- `title` (TEXT): Step title
- `status` (TEXT): 'pending' | 'in_progress' | 'completed' | 'failed'
- `createdAt` (TEXT): ISO timestamp
- `updatedAt` (TEXT): ISO timestamp

**Iteration Table**:
- `id` (INTEGER PRIMARY KEY): Unique iteration identifier
- `stepId` (INTEGER): Foreign key to step
- `iterationNumber` (INTEGER): Sequential number within step
- `type` (TEXT): 'implementation' | 'build_fix' | 'review_fix'
- `commitSha` (TEXT | NULL): Git commit SHA created by this iteration
- `claudeLog` (TEXT | NULL): Full Claude Code output/logs
- `codexLog` (TEXT | NULL): Full Codex review output
- `status` (TEXT): 'in_progress' | 'completed' | 'failed'
- `createdAt` (TEXT): ISO timestamp
- `updatedAt` (TEXT): ISO timestamp

**Issue Table**:
- `id` (INTEGER PRIMARY KEY): Unique issue identifier
- `iterationId` (INTEGER): Foreign key to iteration where issue was found
- `type` (TEXT): 'ci_failure' | 'codex_review'
- `description` (TEXT): Issue description
- `filePath` (TEXT | NULL): File where issue occurred
- `lineNumber` (INTEGER | NULL): Line number where issue occurred
- `severity` (TEXT | NULL): 'error' | 'warning'
- `status` (TEXT): 'open' | 'fixed'
- `createdAt` (TEXT): ISO timestamp
- `resolvedAt` (TEXT | NULL): ISO timestamp when marked fixed

**Execution ID**: The plan ID serves as the execution ID and can be used to resume executions with `--execution-id <id>`.

### Core Components

**Orchestrator** (`backend/orchestrator.ts`): Main coordinator that implements iteration loop logic
- Uses Database for state persistence and never modifies plan file
- Creates separate commits for each Claude execution (not amending)
- For each step, runs iteration loop:
  1. **Initial Implementation**: Claude creates commit, push, wait for CI
  2. **Build Verification**: If CI fails, create build_fix iteration, Claude fixes and creates new commit, push, repeat
  3. **Code Review**: Run Codex with context-specific prompt (implementation/build_fix/review_fix), parse JSON output
  4. **Review Fixes**: If issues found, create review_fix iteration, Claude fixes and creates new commit, push, repeat from build verification
  5. **Completion**: When Codex passes and CI passes, mark step complete
- Configuration: `OrchestratorConfig` includes executionId (for resume), maxIterationsPerStep (default 3), database path, timeouts, event emitter, silent mode
- Emits granular events for iterations and issues via `OrchestratorEventEmitter` for real-time UI updates
- Supports `silent` mode for web UI (suppresses console.log, only emits events)
- All pushes handled by orchestrator; agents never push

**Database** (`backend/database.ts`): SQLite database management
- Initializes database at `.stepcat/executions.db` in work directory
- Creates schema with four tables: plan, step, iteration, issue
- CRUD methods for all entities with proper type safety
- Methods include: `createPlan()`, `getSteps()`, `updateStepStatus()`, `createIteration()`, `updateIteration()`, `createIssue()`, `getOpenIssues()`, etc.
- Handles foreign key constraints and transactions
- Used by Orchestrator for all state persistence

**StepParser** (`backend/step-parser.ts`): Parses markdown plan files
- Expects format: `## Step N: Title` (case-insensitive)
- Returns sorted array of `Step` objects with `{number, title, fullHeader}`
- Validates no duplicate step numbers
- Used once at startup to populate database with steps

**ClaudeRunner** (`backend/claude-runner.ts`): Executes Claude Code and captures commit SHA
- Locates binary at `../node_modules/.bin/claude`
- Runs with `--print`, `--verbose`, `--add-dir`, `--permission-mode acceptEdits` flags
- Uses async `spawn` with stdin for prompt and configurable timeout
- Inherits stdout/stderr for real-time streaming output
- After execution, captures commit SHA via `git rev-parse HEAD`
- Returns `{ success: boolean; commitSha: string | null }`
- No longer enforces commit amending (creates new commits instead)
- Three prompt types: implementation, buildFix, reviewFix (see `backend/prompts.ts`)

**CodexRunner** (`backend/codex-runner.ts`): Executes Codex with commit tracking support
- Locates binary at `../node_modules/.bin/codex`
- Runs with `exec` subcommand
- Captures stdout for output
- Supports `expectCommit` flag for implementation iterations (tracks commit SHA)
- `parseCodexOutput()` method delegates to ReviewParser for parsing review output
- Returns `{ success: boolean; output: string; commitSha?: string | null }`

**ReviewParser** (`backend/review-parser.ts`): Agent-agnostic review output parser
- Parses JSON output from any review agent (Claude Code or Codex)
- Handles JSON wrapped in markdown code blocks
- Extracts JSON from mixed text/JSON output
- Returns `ReviewResult` with `result` ('PASS' | 'FAIL') and `issues` array
- Falls back gracefully if JSON parsing fails
- Used by both ClaudeRunner and CodexRunner for consistent review parsing
- Expected JSON schema: `{"result": "PASS"|"FAIL", "issues": [{file, line?, severity, description}]}`

**GitHubChecker** (`backend/github-checker.ts`): Monitors GitHub Actions
- Uses Octokit to poll check runs via GitHub API
- Polls every 30 seconds until completion or timeout
- Parses repo info from `git remote get-url origin`
- Expects format: `github.com[:/]owner/repo`
- Returns true if all checks pass/skip, false otherwise

**Prompts** (`backend/prompts.ts`): All agent prompts with explicit instructions to create new commits
- **Claude Code prompts** (all explicitly instruct NOT to use `git commit --amend` and NOT to push):
  - `implementation(stepNumber, planFilePath)`: Initial implementation task pointing to plan file path, creates new commit
  - `buildFix(buildErrors)`: Fix build failures, creates new commit
  - `reviewFix(reviewComments)`: Address Codex review feedback, creates new commit
- **Codex prompts** (all request JSON output with consistent schema):
  - `codexReviewImplementation(stepNumber, stepTitle, planContent)`: Review initial implementation
  - `codexReviewBuildFix(buildErrors)`: Verify build fixes address the failures
  - `codexReviewCodeFixes(issues)`: Verify code fixes address review issues
  - All Codex prompts request JSON: `{"result": "PASS"|"FAIL", "issues": [{file, line?, severity, description}]}`

**Events** (`backend/events.ts`): Event system for real-time UI updates with granular iteration tracking
- `OrchestratorEventEmitter`: EventEmitter subclass with typed events
- Event types include:
  - Step events: `step_start`, `step_complete`
  - Iteration events: `iteration_start`, `iteration_complete`
  - Issue events: `issue_found`, `issue_resolved`
  - Review events: `codex_review_start`, `codex_review_complete`
  - Build events: `github_check` (includes `iterationId` when available)
  - State events: `state_sync` (full state on WebSocket connect), `all_complete`, `error`, `log`
- All events include timestamp and type discriminator
- Events carry context like stepId, iterationId, issueId for precise UI updates

**WebServer** (`backend/web-server.ts`): HTTP server with WebSocket support serving React frontend
- Express server serving built React frontend as static files
- WebSocket server for real-time event broadcasting
- On new WebSocket connection, emits `state_sync` event with full current state from database
- Serves React app from `frontend/dist/` directory
- Auto-opens browser (configurable)
- Default port: 3742 (configurable)

**Frontend** (`frontend/`): React 18 + TypeScript + Vite application
- Beautiful purple/pastel UI with smooth animations
- **Hierarchical display**: Steps → Iterations → Issues with collapsible sections
- Features: step tracking, iteration details (type, commit SHA), issue tracking (status, location), progress indicators
- Color coding: pending (gray), in_progress (blue), completed (green), failed (red)
- WebSocket client with automatic reconnection (`frontend/src/hooks/useWebSocket.ts`)
- LocalStorage persistence for UI state (`frontend/src/hooks/useLocalStorage.ts`)
- **Security**: All dynamic content is HTML-escaped in React to prevent XSS attacks
- Component structure:
  - `App.tsx`: Main application with state management
  - `components/Header.tsx`: Title and subtitle
  - `components/StatusBanner.tsx`: Execution stats and connection status
  - `components/StepsContainer.tsx`, `StepCard.tsx`: Step display and management
  - `components/IterationsContainer.tsx`, `Iteration.tsx`: Iteration tracking with badges
  - `components/IssuesContainer.tsx`, `Issue.tsx`: Issue display

### Key Behaviors

**Git Commit Strategy - One Commit Per Iteration**:
- Each Claude Code execution creates a separate git commit
- Initial implementation creates Commit 1
- Build fix creates Commit 2
- Review fix iteration 1 creates Commit 3
- Review fix iteration 2 creates Commit 4, etc.
- This creates a complete audit trail with more commits per step
- Trade-off: noisier git history, but full transparency and traceability
- Orchestrator handles all git pushes; agents never push
- No amending - all commits are separate
- Each commit SHA is captured and stored in the database

**Step Execution Flow**:
1. **Initial Implementation**: Claude creates commit, orchestrator pushes and waits for GitHub Actions
2. **Build Verification Loop**: If build fails, create build_fix iteration → Claude creates new commit → orchestrator pushes → repeat from step 2
3. **Code Review**: Run Codex review with context-specific prompt (varies based on iteration type: implementation/build_fix/review_fix)
4. **Review Fix Loop**: If Codex finds issues, parse JSON, save issues to DB, create review_fix iteration → Claude creates new commit → orchestrator pushes → repeat from step 2
5. **Step Completion**: When Codex passes (result: 'PASS') and CI passes, mark step complete and move to next step

**State Tracking**:
- All execution state stored in SQLite database at `.stepcat/executions.db` in project work directory
- Plan file is NEVER modified during execution
- State includes: steps (with status), iterations (with logs and commit SHAs), issues (with resolution status)
- Resume functionality: Stop execution at any time, restart later using `--execution-id`
- Database persisted to disk in real-time as progress is made

**Iteration and Issue Tracking**:
- Each Claude execution is an iteration with: type ('implementation' | 'build_fix' | 'review_fix'), commit SHA, logs (Claude and Codex), status
- Issues are extracted from CI failures and Codex JSON reviews
- Issues stored with: file path, line number, severity ('error' | 'warning'), description, status ('open' | 'fixed')
- Full traceability: Issue → Iteration that found it → Iteration that fixed it → Commit SHA
- Max iterations per step: 3 (configurable via `maxIterationsPerStep` in OrchestratorConfig)
- If max iterations exceeded, step marked as 'failed' and execution halts

**Review Process**:
- Review agent (Codex by default, configurable to Claude Code) uses three context-specific prompts:
  1. `codexReviewImplementation`: Reviews initial implementation commit
  2. `codexReviewBuildFix`: Verifies build fixes address the CI failures
  3. `codexReviewCodeFixes`: Verifies code fixes address previous review issues
- All review prompts request structured JSON output: `{"result": "PASS"|"FAIL", "issues": [...]}`
- JSON parsing handled by agent-agnostic ReviewParser with graceful fallback for malformed output
- Issues are parsed and stored in database with full context
- No text pattern matching - all detection based on JSON structure

**Execution Model**:
- State persisted to database in real-time
- Resume support: can stop and restart execution at any time
- Each phase is sequential: implement → build verify → review
- No parallelization between steps
- Steps are processed in order from first pending/in_progress step

**Target Project Requirements**:
- Must have `justfile` with `build`, `lint`, `test` commands
- Must be a GitHub repo with Actions enabled
- Must have remote origin pointing to GitHub
- Must be executed from within the target project directory

## TypeScript Configuration

- Target: ES2020, CommonJS modules
- Strict mode enabled
- Output: `dist/` directory
- Excludes: test files (`*.test.ts`, `__tests__`)

## Testing

- Jest with ts-jest preset for backend tests
- Tests in `backend/__tests__/` or `*.test.ts` files
- Run: `just test` or `npm test`
- **Integration testing**: See `docs/INTEGRATION_TEST_CHECKLIST.md` for comprehensive manual integration testing procedures and acceptance criteria
- Frontend testing: Tests can be added to `frontend/src/` (not yet implemented)

## Important Notes for Development

1. **Git Commit Policy**: Maintain "one commit per iteration" - each Claude execution creates a NEW commit (never use `git commit --amend`). All commits are separate for full audit trail. Orchestrator handles all pushes; agents are instructed NOT to push.

2. **Database First**: All state is in the database. Plan file is never modified during execution. Use Database methods for all state operations. Database location: `.stepcat/executions.db` in work directory.

3. **Review Detection**: Use `ReviewParser` class in `backend/review-parser.ts` to parse JSON from review agent output (Claude Code or Codex). The parser is agent-agnostic and handles markdown-wrapped JSON and malformed output gracefully. Returns structured `ReviewResult` with `result` and `issues` fields. Both ClaudeRunner and CodexRunner use this parser for consistency.

4. **Prompt customization**: All agent prompts are in `backend/prompts.ts` - modify there to change agent behavior. Claude prompts explicitly instruct to create new commits and NOT to push. Codex prompts request JSON output with consistent schema.

5. **Iteration Types**: Three types - 'implementation' (initial), 'build_fix' (CI failures), 'review_fix' (code review issues). Each type uses context-specific Codex review prompt.

6. **CLI entry point**: A shebang is added to `dist/cli.js` by the postbuild script

7. **Error handling**: All runners throw on non-zero exit codes

8. **Dependencies**: Required runtime deps include `@anthropic-ai/claude-code`, `@openai/codex` (specified as wildcard "*"), `better-sqlite3` for database, and `@octokit/rest` for GitHub integration

9. **GitHub token**: Must be provided via `--token` flag or `GITHUB_TOKEN` env var

10. **Web UI Security**: All dynamic content in the React frontend is automatically escaped by React. No need for manual HTML escaping in JSX.

11. **Resume functionality**: Execution ID is the plan ID. Use `--execution-id <id>` to resume. Orchestrator loads state from database and continues from first pending/in_progress step.

12. **Build Process**: The build process is now two-stage:
    - Frontend: React app built with Vite to `frontend/dist/`
    - Backend: TypeScript compiled to `dist/`
    - Backend serves frontend static files from `frontend/dist/`
    - Use `npm run build` to build both, or `npm run build:frontend` / `npm run build:backend` individually

13. **Frontend Development**: To work on the React UI:
    - Run `cd frontend && npm run dev` for hot reload dev server
    - Frontend dev server runs on port 5173
    - Expects backend WebSocket on port 3742
    - Make sure to run `npm run build:frontend` before deploying
