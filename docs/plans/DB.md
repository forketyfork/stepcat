# Database-Driven Architecture Migration Plan

This plan migrates Stepcat from file-based state tracking to a SQLite database-driven approach with granular iteration and issue tracking.

## Step 1: Add SQLite Database Dependency [done]

### Status Quo

The project currently has no database dependency. State is tracked by modifying the plan markdown file with phase markers like `[done]`, `[review]`, etc.

### Objectives

Add `better-sqlite3` as a project dependency to enable SQLite database functionality.

### Tech Notes

- Add `better-sqlite3` to dependencies in `package.json`
- Add `@types/better-sqlite3` to devDependencies for TypeScript support
- Run `npm install` to install the new dependencies
- Verify the native module compiles successfully

### Acceptance Criteria

- `package.json` contains `better-sqlite3` in dependencies
- `package.json` contains `@types/better-sqlite3` in devDependencies
- `npm install` completes without errors
- The project builds successfully with `npm run build`

## Step 2: Create Database Models and Schema [done]

### Status Quo

The project has no database models. A new dependency on `better-sqlite3` has been added.

### Objectives

Create TypeScript interfaces for the database entities and implement the database schema with CRUD operations.

### Tech Notes

**Create `src/models.ts`** with interfaces:
- `Plan`: id (number), planFilePath (string), workDir (string), createdAt (string)
- `Step`: id (number), planId (number), stepNumber (number), title (string), status ('pending' | 'in_progress' | 'completed' | 'failed'), createdAt (string), updatedAt (string)
- `Iteration`: id (number), stepId (number), iterationNumber (number), type ('implementation' | 'build_fix' | 'review_fix'), commitSha (string | null), claudeLog (string | null), codexLog (string | null), status ('in_progress' | 'completed' | 'failed'), createdAt (string), updatedAt (string)
- `Issue`: id (number), iterationId (number), type ('ci_failure' | 'codex_review'), description (string), filePath (string | null), lineNumber (number | null), severity ('error' | 'warning' | null), status ('open' | 'fixed'), createdAt (string), resolvedAt (string | null)

**Create `src/database.ts`** with:
- Database class with connection management
- Schema creation SQL for all four tables with proper foreign keys
- CRUD methods for each entity:
  - `createPlan(planFilePath, workDir)`: Create new execution, return Plan with id
  - `getPlan(id)`: Retrieve plan by id
  - `createStep(planId, stepNumber, title)`: Create step, return Step
  - `getSteps(planId)`: Get all steps for a plan
  - `updateStepStatus(stepId, status)`: Update step status
  - `createIteration(stepId, iterationNumber, type)`: Create iteration, return Iteration
  - `getIterations(stepId)`: Get all iterations for a step
  - `updateIteration(iterationId, updates)`: Update iteration fields (commitSha, logs, status)
  - `createIssue(iterationId, type, description, ...)`: Create issue, return Issue
  - `getIssues(iterationId)`: Get all issues for an iteration
  - `updateIssueStatus(issueId, status, resolvedAt?)`: Mark issue as fixed
  - `getOpenIssues(stepId)`: Get all open issues for a step
- Initialize database at `.stepcat/executions.db` in the work directory
- Proper error handling and transactions where needed

### Acceptance Criteria

- `src/models.ts` exists with all four interfaces properly typed
- `src/database.ts` exists with Database class and all CRUD methods
- Database file is created at `.stepcat/executions.db` on first run
- All tables are created with proper schema and foreign key constraints
- TypeScript compilation succeeds with `npm run build`
- Basic manual test: can create a plan, steps, iterations, and issues

## Step 3: Update Event System [done]

### Status Quo

The event system in `src/events.ts` has basic events for step and phase tracking but lacks granularity for iterations and issues.

### Objectives

Add new event types to support iteration-level and issue-level tracking for real-time UI updates.

### Tech Notes

**Update `src/events.ts`**:

Add new event types to the union:
- `iteration_start`: { type, timestamp, stepId, iterationNumber, iterationType }
- `iteration_complete`: { type, timestamp, stepId, iterationNumber, commitSha, status }
- `issue_found`: { type, timestamp, iterationId, issueType, description, filePath?, lineNumber?, severity? }
- `issue_resolved`: { type, timestamp, issueId }
- `codex_review_start`: { type, timestamp, iterationId, promptType }
- `codex_review_complete`: { type, timestamp, iterationId, result, issueCount }

Update existing events to include iteration context where relevant:
- `build_attempt`: Add `iterationId` field
- `github_check`: Add `iterationId` field

Add new event type for full state sync:
- `state_sync`: { type, timestamp, plan, steps, iterations, issues }

Update `OrchestratorEventEmitter` class to support the new event types.

### Acceptance Criteria

- All new event types are added to the event type union
- Event types are properly typed with discriminated unions
- TypeScript compilation succeeds
- No breaking changes to existing event consumers

## Step 4: Update Prompts for New Architecture [done]

### Status Quo

Prompts in `src/prompts.ts` currently instruct Claude to use `git commit --amend` and include a single Codex review prompt that produces free-form text output.

### Objectives

Update Claude prompts to create new commits (not amend) and create three distinct Codex prompts that request structured JSON output.

### Tech Notes

**Update `src/prompts.ts`**:

**Modify existing Claude prompts**:
- `implementation()`: Remove any mention of amending. Add explicit instruction: "Create a new commit for your changes. Do NOT use git commit --amend. Do NOT push to remote (the orchestrator will handle pushing)."
- `buildFix()`: Same changes as above - emphasize creating NEW commit, not amending
- `reviewFix()`: Same changes as above

**Add three new Codex prompt functions**:

1. `codexReviewImplementation(stepNumber, stepTitle, planContent)`:
   - Context: "This is the initial implementation of Step {stepNumber}: {stepTitle} from the following plan: {planContent}"
   - Task: "Review the last commit for code quality, correctness, and adherence to the plan"
   - Output format: "Respond with a JSON object: {\"result\": \"PASS\" or \"FAIL\", \"issues\": [{\"file\": \"path/to/file\", \"line\": 123, \"severity\": \"error\" or \"warning\", \"description\": \"detailed description\"}]}"

2. `codexReviewBuildFix(buildErrors)`:
   - Context: "This commit attempts to fix the following build failures: {buildErrors}"
   - Task: "Review the last commit to verify it properly addresses the build issues"
   - Same JSON output format as above

3. `codexReviewCodeFixes(issues)`:
   - Context: "This commit attempts to fix the following code review issues from the previous iteration: {JSON.stringify(issues)}"
   - Task: "Review the last commit to verify it properly addresses these concerns"
   - Same JSON output format as above

**Remove or deprecate**:
- The old `codexReview()` function (or keep for backward compatibility with a deprecation note)

### Acceptance Criteria

- All Claude prompts explicitly instruct to create new commits, not amend
- Three new Codex prompt functions exist with distinct contexts
- All Codex prompts request JSON output with consistent schema
- TypeScript compilation succeeds
- Manual inspection confirms prompts are clear and comprehensive

## Step 5: Update ClaudeRunner

### Status Quo

`src/claude-runner.ts` currently enforces the "one commit per step" policy by validating commit counts and uses `baselineCommit` parameter to ensure amending behavior.

### Objectives

Remove commit count validation and baseline enforcement. Add logic to capture the commit SHA after Claude creates a commit.

### Tech Notes

**Update `src/claude-runner.ts`**:

**Remove**:
- `baselineCommit` parameter from `runClaude()` function
- All commit count validation logic
- Any code that enforces or checks for amending behavior

**Add**:
- After Claude completes execution, capture the latest commit SHA
- Use `git rev-parse HEAD` to get the current commit SHA
- Return the commit SHA as part of the result (update return type if needed)
- Add error handling for git command failures

**Update**:
- Function signature: `runClaude(workDir: string, prompt: string, timeout?: number): Promise<{ success: boolean; commitSha: string | null }>`
- Keep all existing flags: `--print`, `--verbose`, `--add-dir`, `--permission-mode acceptEdits`
- Keep the async spawn with stdin for prompt delivery

### Acceptance Criteria

- `baselineCommit` parameter is removed from function signature
- No commit count validation logic remains
- Function successfully captures and returns commit SHA after execution
- TypeScript compilation succeeds
- Existing tests are updated to reflect new signature
- Manual test: Run Claude and verify commit SHA is correctly captured

## Step 6: Update CodexRunner with JSON Parsing

### Status Quo

`src/codex-runner.ts` runs Codex and returns raw text output. There's no structured parsing of review results.

### Objectives

Add a method to parse structured JSON output from Codex and extract issues into a typed format.

### Tech Notes

**Update `src/codex-runner.ts`**:

**Add new interface** (or import from models.ts):
```typescript
interface CodexReviewResult {
  result: 'PASS' | 'FAIL';
  issues: Array<{
    file: string;
    line?: number;
    severity: 'error' | 'warning';
    description: string;
  }>;
}
```

**Add new method**:
- `parseCodexOutput(rawOutput: string): CodexReviewResult`
- Extract JSON from Codex output (may be wrapped in markdown code blocks)
- Use try-catch for JSON.parse with fallback handling
- If JSON parsing fails:
  - Check for legacy text patterns (backward compatibility)
  - Return `{ result: 'FAIL', issues: [{ file: 'unknown', description: 'Failed to parse Codex output: ' + rawOutput, severity: 'error' }] }`
- Validate that parsed object has expected structure
- Return typed result

**Update existing runCodex method**:
- Keep existing functionality
- Consider adding an optional parameter to automatically parse JSON

### Acceptance Criteria

- `parseCodexOutput()` method exists and handles JSON parsing with fallback
- Method extracts JSON from markdown code blocks if present
- Method handles malformed JSON gracefully
- Returns properly typed `CodexReviewResult` object
- TypeScript compilation succeeds
- Unit tests for parsing various JSON formats and error cases

## Step 7: Refactor Orchestrator with Database Integration

### Status Quo

`src/orchestrator.ts` currently uses `amendPlanFileAndPush()` to modify the plan file with phase markers and amend commits. It processes each step through linear phases (implementation → build → review) with amending between phases.

### Objectives

Complete refactor to use database for state tracking and implement an iteration loop that creates separate commits for each Claude execution.

### Tech Notes

**Update `src/orchestrator.ts`**:

**Import and initialize**:
- Import Database class from `src/database.ts`
- Import new event types from `src/events.ts`
- Import updated prompts from `src/prompts.ts`
- Import models from `src/models.ts`

**Add to OrchestratorConfig**:
- `executionId?: number` (for resume functionality)
- `maxIterationsPerStep?: number` (default 10)
- `databasePath?: string` (optional, defaults to `.stepcat/executions.db` in workDir)

**Remove**:
- `amendPlanFileAndPush()` method and all calls to it
- `reviewHasIssues()` method (replaced by JSON parsing)
- All logic that modifies the plan file
- All commit amend logic

**Add new methods**:
- `initializeOrResumePlan()`: If executionId provided, load from DB; otherwise create new plan and steps
- `getCurrentStep()`: Find first step with status 'pending' or 'in_progress'
- `pushCommit()`: Simple git push with proper error handling
- `extractBuildErrors(githubCheckResult)`: Parse errors from GitHub Actions logs
- `determineCodexPromptType(iteration)`: Return 'implementation', 'build_fix', or 'review_fix' based on iteration type

**Refactor main loop** - replace `run()` method with new iteration-based flow:

```typescript
async run() {
  await this.initializeOrResumePlan();
  emit('init', { full state from DB });

  while (true) {
    const step = this.getCurrentStep();
    if (!step) break; // All steps complete

    emit('step_start', step);
    updateStepStatus(step.id, 'in_progress');

    let iterationNumber = getIterations(step.id).length + 1;
    const maxIterations = this.config.maxIterationsPerStep || 10;

    // Initial implementation
    if (iterationNumber === 1) {
      const iteration = createIteration(step.id, 1, 'implementation');
      emit('iteration_start', ...);

      const prompt = prompts.implementation(step.stepNumber, planContent);
      const result = await claudeRunner.runClaude(workDir, prompt);

      updateIteration(iteration.id, { commitSha: result.commitSha, claudeLog: ..., status: 'completed' });
      await this.pushCommit();
      emit('iteration_complete', ...);
      iterationNumber++;
    }

    // Iteration loop: build verification and code review
    while (iterationNumber <= maxIterations) {
      // Build verification phase
      emit('github_check', { status: 'pending', iterationId: ... });
      const checksPass = await githubChecker.waitForChecks(...);

      if (!checksPass) {
        const buildErrors = await this.extractBuildErrors(...);
        // Create issues in DB
        const iteration = createIteration(step.id, iterationNumber, 'build_fix');
        for (const error of buildErrors) {
          createIssue(iteration.id, 'ci_failure', error, ...);
        }

        emit('iteration_start', ...);
        const prompt = prompts.buildFix(buildErrors);
        const result = await claudeRunner.runClaude(workDir, prompt);
        updateIteration(iteration.id, { commitSha: result.commitSha, ... });
        await this.pushCommit();
        emit('iteration_complete', ...);
        iterationNumber++;
        continue; // Go back to build verification
      }

      // Code review phase
      const previousIteration = getIterations(step.id)[iterationNumber - 2];
      const promptType = this.determineCodexPromptType(previousIteration);

      let codexPrompt;
      if (promptType === 'implementation') {
        codexPrompt = prompts.codexReviewImplementation(step.stepNumber, step.title, planContent);
      } else if (promptType === 'build_fix') {
        const buildErrors = getIssues(previousIteration.id).filter(i => i.type === 'ci_failure');
        codexPrompt = prompts.codexReviewBuildFix(buildErrors);
      } else { // review_fix
        const openIssues = getOpenIssues(step.id).filter(i => i.type === 'codex_review');
        codexPrompt = prompts.codexReviewCodeFixes(openIssues);
      }

      emit('codex_review_start', { iterationId: previousIteration.id, promptType });
      const codexOutput = await codexRunner.runCodex(workDir, codexPrompt);
      const reviewResult = codexRunner.parseCodexOutput(codexOutput);

      updateIteration(previousIteration.id, { codexLog: codexOutput });
      emit('codex_review_complete', { iterationId: previousIteration.id, result: reviewResult.result, issueCount: reviewResult.issues.length });

      if (reviewResult.result === 'FAIL' && reviewResult.issues.length > 0) {
        // Create issues in DB
        const iteration = createIteration(step.id, iterationNumber, 'review_fix');
        for (const issue of reviewResult.issues) {
          createIssue(iteration.id, 'codex_review', issue.description, issue.file, issue.line, issue.severity, 'open');
          emit('issue_found', ...);
        }

        // Run Claude to fix issues
        emit('iteration_start', ...);
        const prompt = prompts.reviewFix(reviewResult.issues);
        const result = await claudeRunner.runClaude(workDir, prompt);
        updateIteration(iteration.id, { commitSha: result.commitSha, ... });
        await this.pushCommit();
        emit('iteration_complete', ...);

        // Mark previous issues as resolved (optimistic - will verify in next iteration)
        const openIssues = getOpenIssues(step.id);
        for (const issue of openIssues) {
          updateIssueStatus(issue.id, 'fixed', new Date().toISOString());
          emit('issue_resolved', { issueId: issue.id });
        }

        iterationNumber++;
        continue; // Go back to build verification
      } else {
        // Review passed - step complete
        updateStepStatus(step.id, 'completed');
        emit('step_complete', step);
        break;
      }
    }

    if (iterationNumber > maxIterations) {
      updateStepStatus(step.id, 'failed');
      emit('error', { message: `Step ${step.stepNumber} exceeded maximum iterations` });
      throw new Error(`Step ${step.stepNumber} exceeded maximum iterations`);
    }
  }

  emit('all_complete');
}
```

**Update constructor**:
- Initialize Database instance
- Store executionId if provided

### Acceptance Criteria

- `amendPlanFileAndPush()` method is completely removed
- Orchestrator uses Database class for all state management
- Plan file is never modified during execution
- Iteration loop correctly handles build failures and review feedback
- Each Claude execution results in a new commit (not amend)
- Events are emitted at appropriate points for UI updates
- Database is updated in real-time as progress is made
- TypeScript compilation succeeds
- Integration test: Run through a simple 2-step plan and verify DB state

## Step 8: Update CLI for Execution ID Support

### Status Quo

`src/cli.ts` requires `--file` and `--dir` flags to start execution. There's no resume functionality.

### Objectives

Add `--execution-id` flag to support resuming executions and make `--file` and `--dir` optional when resuming.

### Tech Notes

**Update `src/cli.ts`**:

**Add new CLI option**:
- `--execution-id <id>` or `-e <id>`: Resume existing execution

**Update validation logic**:
- If `--execution-id` is provided:
  - Load plan from database
  - Validate database exists
  - Extract `workDir` from plan record
  - Validate `workDir` still exists
  - Optionally validate plan file still exists and matches
  - Check git working directory is clean (no uncommitted changes)
- If `--execution-id` is NOT provided:
  - Require `--file` and `--dir` flags (existing behavior)
  - Create new execution

**Update orchestrator initialization**:
- Pass `executionId` to OrchestratorConfig if provided
- Print clear message: "Resuming execution #123" or "Starting new execution..."

**After orchestrator completes** (new execution only):
- Print execution ID: "Execution complete. Execution ID: {id}"
- Suggest resume command: "To resume this execution later, use: stepcat --execution-id {id}"

**Error handling**:
- If execution ID not found in database: clear error message
- If both execution-id and file/dir provided: validate they match or warn user
- If workDir doesn't match current directory: clear error

### Acceptance Criteria

- CLI accepts `--execution-id` flag
- Starting new execution prints the execution ID
- Resuming with execution ID works without requiring `--file` and `--dir`
- Appropriate error messages for invalid execution IDs
- Git working directory validation prevents resume with uncommitted changes
- TypeScript compilation succeeds
- Manual test: Start execution, stop it, resume with execution ID

## Step 9: Update WebServer with Hierarchical UI

### Status Quo

`src/web-server.ts` displays a flat list of steps with basic phase indicators. UI shows activity log and GitHub status but doesn't display iterations or issues hierarchically.

### Objectives

Implement hierarchical UI displaying Steps → Iterations → Issues with real-time updates and proper state synchronization.

### Tech Notes

**Update `src/web-server.ts`**:

**WebSocket state synchronization**:
- On new WebSocket connection, emit `state_sync` event with full current state from database
- Include: plan info, all steps, all iterations, all issues
- This ensures new clients get complete state immediately

**Update embedded HTML/CSS/JavaScript**:

**HTML Structure**:
```html
<div id="steps-container">
  <!-- Hierarchical structure -->
  <div class="step" data-step-id="1">
    <div class="step-header">
      <span class="status-icon">⏳/✓/✗</span>
      <span class="step-title">Step 1: Title</span>
      <span class="step-meta">3 iterations</span>
    </div>
    <div class="iterations-container">
      <div class="iteration" data-iteration-id="1">
        <div class="iteration-header">
          <span>Iteration 1: Implementation</span>
          <span class="commit-sha">abc123f</span>
        </div>
        <div class="issues-container">
          <div class="issue" data-issue-id="1">
            <span class="severity">⚠️</span>
            <span class="description">Issue description</span>
            <span class="location">file.ts:42</span>
            <span class="status">✓ fixed</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
```

**CSS Styling**:
- Hierarchical indentation for iterations and issues
- Collapsible sections (expand/collapse iterations)
- Color coding:
  - Steps: pending (gray), in_progress (blue), completed (green), failed (red)
  - Issues: open (red), fixed (green)
  - Iterations: in_progress (blue spinner), completed (green), failed (red)
- Smooth animations for status transitions
- Progress indicators: "Fixing 2/5 issues in iteration 3"

**JavaScript Event Handlers**:
- `state_sync`: Render complete hierarchy from scratch
- `step_start`: Update step status, add loading indicator
- `step_complete`: Update step status, show completion
- `iteration_start`: Add new iteration to step, show spinner
- `iteration_complete`: Update iteration with commit SHA, change status
- `issue_found`: Add new issue to iteration
- `issue_resolved`: Update issue status to fixed
- `codex_review_complete`: Show review result in iteration

**Collapsible functionality**:
- Click step header to expand/collapse iterations
- Click iteration header to expand/collapse issues
- Default: expand current in-progress step, collapse others
- Persist expansion state in browser localStorage

**Real-time updates**:
- Smooth animations when adding new items
- Auto-scroll to show current activity
- Highlight recently updated items (fade effect)

**HTML escaping** (security):
- Ensure all dynamic content uses the existing `escapeHtml()` function
- Apply to: step titles, issue descriptions, file paths, commit messages, etc.

### Acceptance Criteria

- UI displays three-level hierarchy: Steps → Iterations → Issues
- New WebSocket connections receive full state via `state_sync` event
- All events properly update the UI in real-time
- Collapsible sections work correctly
- Visual indicators clearly show status of each entity
- Progress information is displayed (iteration counts, issue resolution)
- HTML escaping prevents XSS vulnerabilities
- UI is visually appealing with smooth animations
- TypeScript compilation succeeds
- Manual test: Run execution with UI and verify all updates appear correctly

## Step 10: Update Documentation

### Status Quo

`CLAUDE.md` documents the current architecture with file-based state tracking, one commit per step via amending, and `amendPlanFileAndPush()` method.

### Objectives

Completely rewrite documentation to reflect the new database-driven architecture with iteration-based commits.

### Tech Notes

**Update `CLAUDE.md`**:

**Project Overview section**:
- Change description: "Uses SQLite database to track execution state, iterations, and issues"
- Update key principle: "One commit per iteration (not per step) for complete audit trail"

**Common Commands section**:
- Add new CLI examples:
  ```bash
  # Start new execution
  stepcat --file plan.md --dir /path/to/project  # outputs execution ID

  # Resume execution
  stepcat --execution-id 123

  # With UI
  stepcat --file plan.md --dir /path/to/project --ui
  stepcat --execution-id 123 --ui
  ```

**Architecture section** - major rewrite:

**Database Schema** (new subsection):
- Document all four tables: plan, step, iteration, issue
- Show schema with field types and relationships
- Explain execution ID concept
- Document database location: `.stepcat/executions.db` in workDir

**Core Components** - update descriptions:
- **Orchestrator**: "Main coordinator that implements iteration loop logic. Creates separate commits for each Claude execution. Uses Database for state persistence. Never modifies plan file."
- **Database**: NEW component - describe methods and purpose
- **ClaudeRunner**: "Runs Claude Code and captures commit SHA. No longer enforces amending."
- **CodexRunner**: "Runs Codex reviews with JSON output parsing"
- **Prompts**: Document three Codex prompt types (A, B, C) and their contexts

**Key Behaviors** - complete rewrite:

**Git Commit Strategy** (replace "One commit per step"):
```markdown
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
```

**Step Execution Flow** (replace existing):
```markdown
**Step Execution Flow**:
1. Initial implementation iteration: Claude creates commit
2. Push and wait for GitHub Actions
3. If build fails: Create build_fix iteration → Claude creates new commit → repeat from step 2
4. Run Codex review (prompt varies based on iteration type)
5. If Codex finds issues: Parse JSON, save to DB, create review_fix iteration → Claude creates new commit → repeat from step 2
6. If Codex passes: Mark step complete, move to next step
```

**State Tracking** (new subsection):
```markdown
**State Tracking**:
- All execution state stored in SQLite database
- Plan file is NEVER modified during execution
- State includes: steps, iterations (with logs and commit SHAs), issues (with resolution status)
- Resume functionality: Start execution later using execution ID
- Database location: `.stepcat/executions.db` in project work directory
```

**Iteration and Issue Tracking** (new subsection):
```markdown
**Iteration and Issue Tracking**:
- Each Claude execution is an iteration with: type, commit SHA, logs, status
- Issues are extracted from CI failures and Codex reviews
- Issues stored with: file, line, severity, description, status
- Full traceability: Issue → Iteration that fixed it → Commit SHA
- Max iterations per step: 10 (configurable)
```

**Review Process** (update existing):
- Document three Codex prompt types
- Explain JSON output format
- Describe issue parsing and storage
- Remove references to `reviewHasIssues()` and text pattern matching

**Execution Model** (update existing):
- Remove "Steps parsed once at startup (immutable during run)"
- Add "State persisted to database in real-time"
- Add "Resume support: can stop and restart execution"

**Remove or update**:
- Remove all mentions of `amendPlanFileAndPush()`
- Remove all mentions of plan file markers like `[done]`, `[review]`
- Remove "one commit per step" references
- Update any code references that are now outdated

**Target Project Requirements**:
- Keep existing requirements (justfile, GitHub Actions, etc.)
- Add: "Must be executed from within the target project directory"

**Web UI section** (update):
- Document hierarchical display: Steps → Iterations → Issues
- Explain state synchronization on WebSocket connect
- Document collapsible sections

### Acceptance Criteria

- `CLAUDE.md` accurately reflects new architecture
- All references to file-based state tracking removed
- Database schema documented clearly
- Execution ID and resume functionality documented
- Git commit strategy section reflects one-commit-per-iteration approach
- CLI examples show both new execution and resume patterns
- All outdated code references updated or removed
- Iteration loop and issue tracking explained clearly
- Three Codex prompt types documented

## Step 11: Add Comprehensive Tests

### Status Quo

Existing tests cover the previous architecture with amending and file-based state.

### Objectives

Add comprehensive test coverage for database operations, JSON parsing, iteration loops, and resume functionality.

### Tech Notes

**Create/update test files**:

**`src/__tests__/database.test.ts`** (new):
- Test database initialization and schema creation
- Test CRUD operations for all entities (plan, step, iteration, issue)
- Test foreign key constraints
- Test getOpenIssues() with mixed statuses
- Test concurrent access scenarios (if applicable)
- Use in-memory SQLite (`:memory:`) for fast tests

**`src/__tests__/codex-runner.test.ts`** (update):
- Test `parseCodexOutput()` with valid JSON
- Test parsing JSON wrapped in markdown code blocks
- Test malformed JSON handling (fallback)
- Test missing fields in JSON
- Test empty issues array vs. issues present
- Test backward compatibility with legacy text output

**`src/__tests__/claude-runner.test.ts`** (update):
- Remove tests for commit count validation
- Remove tests for baselineCommit parameter
- Add tests for commit SHA capture
- Test handling of git command failures

**`src/__tests__/orchestrator.test.ts`** (update):
- Remove tests for amendPlanFileAndPush()
- Add tests for initializeOrResumePlan() with new and existing executions
- Add tests for iteration loop logic
- Mock Database, ClaudeRunner, CodexRunner, GitHubChecker
- Test build failure handling with retry
- Test review failure handling with fix iterations
- Test max iterations limit enforcement
- Test successful step completion flow
- Verify database state at each stage
- Verify events are emitted correctly

**`src/__tests__/cli.test.ts`** (update or create):
- Test CLI parsing with --execution-id flag
- Test validation: execution-id requires existing DB
- Test validation: new execution requires --file and --dir
- Test error messages for invalid execution IDs

**Integration test** (`src/__tests__/integration.test.ts`) (new):
- Create temporary directory with mock plan file
- Mock Claude Code and Codex binaries (or use test fixtures)
- Run full orchestrator flow for a 2-step plan
- Verify database state after each phase
- Test resume functionality: stop after step 1, resume, verify step 2 completes
- Clean up temporary files

**Test utilities**:
- Create helper to set up test database
- Create mock responses for Claude and Codex
- Create fixtures for various Codex JSON outputs

### Acceptance Criteria

- All new database operations have unit tests
- JSON parsing has comprehensive test coverage including error cases
- Orchestrator iteration loop logic is tested with mocks
- CLI flag parsing and validation are tested
- Integration test demonstrates full flow works end-to-end
- Resume functionality is tested
- All tests pass with `npm test`
- Test coverage is reasonable (aim for >80% on new code)
- TypeScript compilation succeeds

## Step 12: Final Integration Testing and Documentation Validation

### Status Quo

All components have been implemented and unit tested individually. Documentation has been updated.

### Objectives

Perform end-to-end integration testing, validate documentation accuracy, and ensure the system works correctly in real-world scenarios.

### Tech Notes

**Manual integration testing**:

1. **Fresh execution test**:
   - Create a simple test project with a 3-step plan
   - Run `stepcat --file plan.md --dir /path/to/test-project --ui`
   - Verify execution ID is printed
   - Watch UI for real-time updates
   - Intentionally introduce a build failure in step 2
   - Verify build fix iteration is created and works
   - Verify Codex review runs and issues are displayed
   - Verify review fix iteration is created and works
   - Verify all 3 steps complete successfully
   - Inspect database with `sqlite3 .stepcat/executions.db` to verify state

2. **Resume execution test**:
   - Start execution of a 5-step plan
   - Stop execution (Ctrl+C) after step 2 completes
   - Verify database contains partial state
   - Resume with `stepcat --execution-id <id> --ui`
   - Verify execution continues from step 3
   - Verify execution completes all remaining steps

3. **Error handling test**:
   - Test with plan that exceeds max iterations
   - Verify appropriate error message and step marked as failed
   - Test with invalid execution ID
   - Verify clear error message
   - Test resume with dirty git working directory
   - Verify appropriate error and prevention

4. **UI validation**:
   - Open web UI during execution
   - Verify steps, iterations, and issues display correctly
   - Verify status updates happen in real-time
   - Verify collapsible sections work
   - Verify progress indicators are accurate
   - Test opening UI after execution is complete (state_sync)
   - Close and reopen browser to verify state persists

**Documentation validation**:
- Read through CLAUDE.md as if you're a new developer
- Verify all CLI examples work as documented
- Verify architecture descriptions match implementation
- Check for any outdated references or broken links
- Verify database schema documentation matches actual schema

**Build and lint**:
- Run `npm run build` - must succeed
- Run `npm run lint` - must pass with no errors
- Run `npm test` - all tests must pass

### Acceptance Criteria

- Fresh execution completes successfully with all features working
- Resume functionality works correctly from any point
- Error handling is robust with clear error messages
- Web UI displays all information correctly with real-time updates
- Database state is correct after various execution scenarios
- Documentation is accurate and complete
- All npm scripts (build, lint, test) pass successfully
- No TypeScript compilation errors or warnings
- System is ready for production use
