# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Stepcat is a step-by-step agent orchestration solution that automates multi-step development plans using Claude Code and Codex. Each stage can be configured to use either agent (Claude Code by default for implementation, Codex by default for review). It uses a SQLite database to track execution state, iterations, and issues. For each step, it implements code via the selected implementation agent, waits for GitHub Actions to pass, uses the configured review agent to analyze the changes with structured JSON output, and iterates until the step is complete.

**Key Principle**: One commit per iteration (not per step) for complete audit trail. Each implementation agent execution creates a separate git commit, providing full transparency and traceability throughout the development process.

## Task Completion Requirements

**CRITICAL: Before completing ANY task, you MUST:**

1. **Run Linting**: Execute formatting and linting checks
   ```bash
   just lint              # Backend ESLint
   just lint-frontend     # Frontend ESLint (if frontend changes)
   ```

2. **Run Tests**: Execute all relevant tests
   ```bash
   just test              # Run all tests (Jest + Vitest)
   ```

3. **Fix Any Issues**: If linting or tests fail, fix all issues before marking the task as complete

4. **Verify Build** (for significant changes):
   ```bash
   just build             # Build the entire project
   ```

**This applies to:**
- Feature implementations
- Bug fixes
- Refactoring
- Code improvements
- ANY code changes

**Exception**: You may skip these steps only when explicitly instructed by the user (e.g., "skip tests for now").

## Common Commands

### Development
```bash
just build              # Build the entire project (frontend + backend)
just build-frontend     # Build only frontend
just build-backend      # Build only backend
just lint               # Run backend ESLint
just lint-frontend      # Run frontend ESLint
just test               # Run all tests (Jest + Vitest)
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
npm test                # Run all tests (Jest + Vitest)
npm run test:jest       # Run only Jest tests
npm run test:vitest     # Run only Vitest tests
npm run test:watch      # Run Vitest in watch mode
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

### Preflight Check

Before running a full execution, use the preflight check to verify that Claude Code has all the required permissions configured in the target project. This prevents execution failures due to unapproved commands.

```bash
# Run preflight check
stepcat --preflight --file plan.md --dir /path/to/project
```

**What it does:**
1. Reads the plan file to identify all bash commands that will be needed
2. Reads the project's `.claude/settings.json` and `.claude/settings.local.json` (if they exist)
3. Reads the project's `CLAUDE.md` file (if it exists)
4. Runs Claude Code to analyze required permissions vs. configured permissions
5. Outputs recommendations for missing permissions

**Exit codes:**
- `0` - All required permissions are configured
- `1` - Error occurred during preflight check
- `2` - Missing permissions detected (action needed)

**Example output:**
```
════════════════════════════════════════════════════════════════════════════════
PREFLIGHT CHECK RESULTS
════════════════════════════════════════════════════════════════════════════════

📋 DETECTED COMMANDS
────────────────────────────────────────────────────────────────────────────────
  • zig build
    └─ Plan mentions Zig language implementation
  • just build
    └─ Standard build command from plan

⚠️  MISSING PERMISSIONS
────────────────────────────────────────────────────────────────────────────────
  • zig build
  • just build

📝 RECOMMENDED CONFIGURATION
════════════════════════════════════════════════════════════════════════════════

Add the following to .claude/settings.json:

{
  "permissions": {
    "allow": [
      "Bash(git:*)",
      "Bash(zig build:*)",
      "Bash(just:*)"
    ]
  }
}
```

**Configuring permissions:**

Add the recommended permissions to `.claude/settings.json` or `.claude/settings.local.json` in the target project directory. The `settings.local.json` file is typically used for user-specific settings that shouldn't be committed to version control.

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

Stepcat uses SQLite to persist execution state at `.stepcat/executions.db` in the work directory. The database has four main tables plus a lightweight migrations tracker:

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
- `buildStatus` (TEXT | NULL): 'pending' | 'in_progress' | 'passed' | 'failed' | 'merge_conflict'
- `reviewStatus` (TEXT | NULL): 'pending' | 'in_progress' | 'passed' | 'failed'
- `status` (TEXT): 'in_progress' | 'completed' | 'failed' | 'aborted'
- `createdAt` (TEXT): ISO timestamp
- `updatedAt` (TEXT): ISO timestamp

**Issue Table**:
- `id` (INTEGER PRIMARY KEY): Unique issue identifier
- `iterationId` (INTEGER): Foreign key to iteration where issue was found
- `type` (TEXT): 'ci_failure' | 'codex_review' | 'merge_conflict'
- `description` (TEXT): Issue description
- `filePath` (TEXT | NULL): File where issue occurred
- `lineNumber` (INTEGER | NULL): Line number where issue occurred
- `severity` (TEXT | NULL): 'error' | 'warning'
- `status` (TEXT): 'open' | 'fixed'
- `createdAt` (TEXT): ISO timestamp
- `resolvedAt` (TEXT | NULL): ISO timestamp when marked fixed

**Execution ID**: The plan ID serves as the execution ID and can be used to resume executions with `--execution-id <id>`.

**Migrations**:
- `schema_migrations` records applied schema changes with `{id, name, appliedAt}`.
- The backend automatically applies pending migrations when the database is opened. Legacy databases (created before migrations were introduced) are assumed to be on the baseline schema and are upgraded in place before any work proceeds.

### Core Components

**Orchestrator** (`backend/orchestrator.ts`): Main coordinator that implements iteration loop logic
- Uses Database for state persistence and never modifies plan file
- Creates separate commits for each Claude execution (not amending)
- For each step, runs iteration loop:
  1. **Initial Implementation**: Claude creates commit, push, wait for CI
  2. **Build Verification**: If CI fails, create build_fix iteration, Claude fixes and creates new commit, push, repeat. When an open PR exists, Stepcat tracks the PR head commit for CI status so newer pushes unblock the loop, and if GitHub reports merge conflicts we record a 'merge_conflict' build status so the branch can be rebased before retrying
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

**PreflightRunner** (`backend/preflight-runner.ts`): Analyzes required permissions before execution
- Reads plan file, CLAUDE.md, and `.claude/settings.json` / `.claude/settings.local.json`
- Runs Claude Code with a specialized prompt to analyze required bash commands
- Compares detected commands against configured permissions
- Returns structured JSON with detected commands, currently allowed permissions, and missing permissions
- Outputs formatted recommendations for `.claude/settings.json` configuration
- Used via `--preflight` CLI flag before starting a full execution

**Prompts** (`backend/prompts.ts`): All agent prompts with explicit instructions to create new commits
- **Preflight prompt**:
  - `preflight(planContent, claudeMdContent, claudeSettingsContent)`: Analyzes plan and configuration to detect required permissions
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
2. **Build Verification Loop**: If build fails, create build_fix iteration → Claude creates new commit → orchestrator pushes → repeat from step 2. Merge conflicts are detected during this phase and surface as 'merge_conflict' build statuses until the branch is rebased
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
- Iteration status: 'in_progress' (running), 'completed' (finished), 'failed' (error), 'aborted' (interrupted)
- Aborted iterations: Interrupted executions (e.g., Ctrl+C) are marked as 'aborted' on resume and don't count toward max iterations
- Only iterations with commits (actual work done) count toward the max iteration limit
- Build status tracks CI progress and surfaces merge conflicts via the 'merge_conflict' state when GitHub declines to run checks
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
- Excludes: test files (`*.test.ts`, `*.vitest.ts`, `__tests__`)

## Testing

Stepcat uses a **hybrid testing approach** with two frameworks:

- **Jest** (69 tests): CommonJS-compatible tests using ts-jest preset
  - Test files: `*.test.ts` in `backend/__tests__/`
  - Run: `npm run test:jest` or `just test` (runs both)

- **Vitest** (50 tests): ESM-specific tests with native `import.meta.url` support
  - Test files: `*.vitest.ts` in `backend/__tests__/`
  - Run: `npm run test:vitest`
  - Watch mode: `npm run test:watch`

**Why two frameworks?**

The project uses native ECMAScript Modules (ESM) with `import.meta.url` for path resolution. Jest runs in CommonJS mode and cannot handle `import.meta.url` at runtime. Tests that import modules using `import.meta.url` (like `claude-runner.ts`, `codex-runner.ts`, `tui-adapter.ts`, `orchestrator.ts`) must run in Vitest.

**Running tests:**
- `npm test` or `just test` - Runs both Jest and Vitest (119 total tests)
- `npm run test:jest` - Runs only Jest tests
- `npm run test:vitest` - Runs only Vitest tests
- `npm run test:watch` - Runs Vitest in watch mode for development

**Integration testing**: See `docs/INTEGRATION_TEST_CHECKLIST.md` for comprehensive manual integration testing procedures and acceptance criteria.

**Frontend testing**: Tests can be added to `frontend/src/` (not yet implemented).

## Development Best Practices

### Test Coverage Requirements

**Always write tests for infrastructure and adapter code**, not just business logic. Critical areas that MUST have test coverage:

1. **Adapters and UI Components**: TUI adapter, WebSocket adapter, Web Server
   - Test initialization and shutdown
   - Test path resolution with mocked `process.cwd()`
   - Test component loading in both dev and production modes
   - Example: `backend/__tests__/tui-adapter.test.ts`

2. **Module Path Resolution**: Any code that resolves file paths relative to module location
   - Test from different working directories
   - Verify paths exist in both source (`backend/`) and build (`dist/`) directories
   - Never fall back to `process.cwd()` for module-relative paths

3. **Runner Components**: ClaudeRunner, CodexRunner
   - Test binary path resolution
   - Test with missing binaries
   - Test timeout behavior

4. **Database Operations**: Test with actual SQLite database
   - Use temp directories for test databases
   - Test schema migrations
   - Test foreign key constraints

### ESM Module Resolution Guidelines

**IMPORTANT**: This project uses ECMAScript Modules (ESM) with `"type": "module"` in package.json.

#### Module Path Resolution

**DO:**
```typescript
// ✅ Direct import.meta.url usage (CORRECT)
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const componentPath = resolve(__dirname, '../components/App.js');
```

**DON'T:**
```typescript
// ❌ Runtime detection with Function constructor (BROKEN)
const moduleDir = (() => {
  try {
    const url = new Function('return import.meta.url')() as string;
    return dirname(fileURLToPath(url));
  } catch {
    return process.cwd(); // NEVER fall back to process.cwd()!
  }
})();
```

**Why the Function trick fails:**
- `new Function('return import.meta.url')()` throws `SyntaxError` at runtime
- `import.meta` cannot be accessed dynamically via Function constructor
- Falls back to `process.cwd()` which returns the **working directory**, not the **module directory**
- Breaks when running from different directories

#### Path Resolution Principles

1. **Module-relative paths**: Always resolve relative to the module's location using `import.meta.url`
2. **Working directory paths**: Only use `process.cwd()` for user-provided paths (plan files, work directories)
3. **Resource paths**: UI components, static files, binaries → use module-relative resolution
4. **Never mix concerns**: Don't use `process.cwd()` as fallback for module-relative path resolution

#### Testing Path Resolution

When adding new path resolution code, use **Vitest** for modules that use `import.meta.url`:

```typescript
// backend/__tests__/my-module.vitest.ts
import { vi } from 'vitest';

// Test that path resolution works from arbitrary directories
it('should resolve paths correctly regardless of cwd', async () => {
  const wrongDir = '/tmp/random';
  vi.spyOn(process, 'cwd').mockReturnValue(wrongDir);

  try {
    // Your initialization code here
    await adapter.initialize();
    // If it works, path resolution is using import.meta.url correctly
  } catch (error) {
    if (error.message.includes('Cannot find module')) {
      fail('Path resolution is using process.cwd() instead of import.meta.url');
    }
  } finally {
    vi.restoreAllMocks();
  }
});
```

**Important**: Tests for modules using `import.meta.url` MUST use Vitest (`.vitest.ts` extension), not Jest.

### Test Framework Selection (Jest vs Vitest)

**Challenge**: Jest runs in CommonJS mode by default, which doesn't support `import.meta.url` at runtime.

**Solution**: Stepcat uses a **hybrid testing approach**:

1. **Jest** for CommonJS-compatible tests (`*.test.ts`)
   - Most tests that don't import modules using `import.meta.url`
   - Uses ts-jest preset with standard configuration
   - 69 tests in 4 suites

2. **Vitest** for ESM-specific tests (`*.vitest.ts`)
   - Tests for modules that use `import.meta.url` (claude-runner, codex-runner, tui-adapter, orchestrator)
   - Native ESM support with no workarounds needed
   - 50 tests in 4 suites

**When to use Vitest:**
- Testing modules that use `import.meta.url` for path resolution
- Testing ESM-only modules or features
- When you need watch mode with fast HMR (`npm run test:watch`)

**When to use Jest:**
- Testing modules that don't use ESM-specific features
- When Jest compatibility is important for CI/tooling
- For the majority of backend tests

**Vitest configuration:**
```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['backend/__tests__/**/*.vitest.ts'],
    globals: true,
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
  }
});

// vitest.setup.ts - provides Jest API compatibility
import { vi } from 'vitest';
globalThis.jest = vi;
```

**Key differences:**
- **Mocking**: Jest uses `jest.fn()`, `jest.mock()`; Vitest uses `vi.fn()`, `vi.mock()`
- **API**: Mostly compatible, but Vitest has better ESM support
- **Performance**: Vitest is faster with native ESM and built-in watch mode
- **Files**: Jest ignores `*.vitest.ts`, Vitest ignores `*.test.ts`

### Integration Testing

**Before considering a feature complete**, verify it works in production-like conditions:

```bash
# 1. Build the project
npm run build

# 2. Test from a DIFFERENT directory
cd /some/other/directory
node /path/to/stepcat/dist/cli.js --file plan.md --dir . --tui

# 3. Verify all features work
# - TUI displays correctly
# - Web UI serves correctly
# - Paths resolve correctly
# - All tests pass
```

### Common Pitfalls to Avoid

1. **❌ Using runtime detection tricks**: `new Function('return import.meta.url')`
2. **❌ Falling back to process.cwd()**: For module-relative paths
3. **❌ Skipping infrastructure tests**: UI adapters, path resolution, initialization
4. **❌ Testing only from project root**: Always test from different directories
5. **❌ Using wrong test framework**: Use Vitest for modules with `import.meta.url`, Jest for others
6. **❌ Mixing test file extensions**: Use `.vitest.ts` for Vitest, `.test.ts` for Jest
7. **❌ Mixing path resolution concerns**: Keep module paths and user paths separate

### TypeScript Coding Guidelines

**NEVER use the `any` type**. Always use concrete types from the models or define specific types.

**DO:**
```typescript
import { DbStep, Iteration, Issue } from '../../models.js';

const calculateStepHeight = (step: DbStep, iterations: Iteration[], issues: Map<number, Issue[]>): number => {
  // Implementation
};
```

**DON'T:**
```typescript
// ❌ Using any type (FORBIDDEN)
const calculateStepHeight = (step: any, iterations: any[], issues: Map<number, any[]>): number => {
  // Implementation
};
```

**Why avoid `any`:**
- Defeats the purpose of TypeScript's type safety
- Prevents IDE autocomplete and type checking
- Makes code harder to understand and maintain
- Hides bugs that TypeScript would otherwise catch
- ESLint will warn about `any` usage

**When you need a type:**
1. **First choice**: Use existing types from `models.ts` or other type definition files
2. **Second choice**: Define a specific interface or type for your use case
3. **Last resort**: Use `unknown` (not `any`) if the type is truly dynamic, then narrow it with type guards

**Use descriptive variable names in callbacks.** Avoid single-letter abbreviations when the context makes a full name natural.

**DO:**
```typescript
const activeStep = state.steps.find(step => step.status === 'in_progress');
const openIssues = issues.filter(issue => issue.status === 'open');
```

**DON'T:**
```typescript
// ❌ Abbreviated names when full names are clearer
const activeStep = state.steps.find(s => s.status === 'in_progress');
const openIssues = issues.filter(i => i.status === 'open');
```

### Debugging Path Issues

If you see errors like `Cannot find module '/wrong/path/to/file'`:

1. **Check the path in error**: Does it include project directory? Or is it missing intermediate dirs?
2. **Verify moduleDir/dirname source**: Is it using `import.meta.url` or `process.cwd()`?
3. **Test from different directory**: `cd /tmp && node /path/to/dist/cli.js`
4. **Check if path exists**: Add logging: `console.log('Resolved path:', path, 'exists:', existsSync(path))`
5. **Review recent changes**: Did someone change path resolution for "Jest compatibility"?

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

11. **Resume functionality**: Execution ID is the plan ID. Use `--execution-id <id>` to resume. Orchestrator loads state from database, marks any in_progress iterations as 'aborted', and continues from first pending/in_progress step. Aborted iterations don't count toward max iterations limit.

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
