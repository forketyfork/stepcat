# Integration Test Checklist for Step 12

This document provides a comprehensive checklist for manual integration testing of the Stepcat database-driven architecture. Use this checklist to validate that all components work correctly in real-world scenarios.

## Build and Test Verification

- [x] `npm run build` completes successfully with no errors
- [x] `npm run lint` passes with no linting errors
- [x] `npm test` passes with all tests passing
- [x] TypeScript compilation produces no errors or warnings

## 1. Fresh Execution Test

### Setup
- [x] Create a test project with a simple 3-step plan
- [x] Ensure test project has `justfile` with `build`, `lint`, `test` commands
- [x] Ensure test project is a GitHub repo with Actions enabled
- [x] Ensure GitHub token is available via `GITHUB_TOKEN` env var or `--token` flag

### Execution
- [ ] Run `npx ts-node src/cli.ts --file plan.md --dir /path/to/test-project --ui`
- [ ] Verify execution ID is printed to console
- [ ] Verify web UI opens automatically in browser
- [ ] Verify web UI displays all 3 steps in hierarchical view

### Step 1 - Normal Flow
- [ ] Watch UI for real-time updates during implementation
- [ ] Verify iteration 1 (implementation) appears in UI
- [ ] Verify commit SHA is displayed in iteration details
- [ ] Verify GitHub Actions check status updates in real-time
- [ ] Verify Codex review runs and displays result
- [ ] Verify step 1 completes successfully

### Step 2 - Build Failure Flow
- [ ] Intentionally introduce a build failure in step 2 (before execution)
- [ ] Verify iteration 1 (implementation) creates commit with build error
- [ ] Verify CI failure is detected and displayed in UI
- [ ] Verify build failure issues are created and displayed
- [ ] Verify iteration 2 (build_fix) is created automatically
- [ ] Verify Claude fixes the build issue and creates new commit
- [ ] Verify build fix commit is pushed to GitHub
- [ ] Verify GitHub Actions check passes after fix
- [ ] Verify Codex review runs on build fix
- [ ] Verify step 2 progresses past build verification

### Step 3 - Code Review Flow
- [ ] Let step 3 implementation complete normally
- [ ] Verify Codex review runs and finds issues (may need to introduce code issues)
- [ ] Verify review issues are displayed in UI with details (file, line, severity, description)
- [ ] Verify iteration 2 (review_fix) is created
- [ ] Verify Claude addresses review feedback and creates new commit
- [ ] Verify review fix commit is pushed to GitHub
- [ ] Verify GitHub Actions check passes
- [ ] Verify Codex review runs again with `review_fix` context
- [ ] Verify issues are marked as fixed in UI
- [ ] Verify step 3 completes successfully

### Verification
- [ ] Verify all 3 steps show as completed in UI
- [ ] Verify "All steps completed successfully" message appears
- [ ] Inspect database with `sqlite3 .stepcat/executions.db`
- [ ] Verify plan record exists with correct fields
- [ ] Verify 3 step records exist with status 'completed'
- [ ] Verify all iterations are recorded with correct types and commit SHAs
- [ ] Verify all issues are recorded with correct status
- [ ] Verify git history shows separate commits for each iteration (no amending)
- [ ] Count total commits and verify matches iteration count

## 2. Resume Execution Test

### Setup
- [ ] Create a test project with a 5-step plan
- [ ] Ensure all preconditions (justfile, GitHub repo, etc.)

### Initial Execution
- [ ] Run `stepcat --file plan.md --dir /path/to/test-project --ui`
- [ ] Note the execution ID printed to console
- [ ] Let step 1 and step 2 complete successfully
- [ ] Stop execution (Ctrl+C) after step 2 completes

### Database Verification
- [ ] Verify database exists at `.stepcat/executions.db`
- [ ] Inspect database: `sqlite3 .stepcat/executions.db "SELECT * FROM steps;"`
- [ ] Verify steps 1-2 show status 'completed'
- [ ] Verify steps 3-5 show status 'pending'
- [ ] Verify iterations exist for steps 1-2 with commit SHAs

### Resume Execution
- [ ] Run `stepcat --execution-id <id> --ui` (without --file or --dir)
- [ ] Verify console shows "Resuming execution ID: <id>"
- [ ] Verify UI opens and displays full state via `state_sync` event
- [ ] Verify UI shows steps 1-2 as completed (collapsed)
- [ ] Verify execution continues from step 3
- [ ] Let execution complete all remaining steps (3-5)
- [ ] Verify all 5 steps complete successfully

### Resume with --dir Flag
- [ ] Start new execution, stop after 1 step
- [ ] Resume with `stepcat --execution-id <id> --dir /path/to/project`
- [ ] Verify resume works correctly with explicit directory

## 3. Error Handling Test

### Max Iterations Test
- [ ] Create a test plan with a step that will repeatedly fail Codex review
- [ ] Configure or note the max iterations limit (default: 3)
- [ ] Start execution
- [ ] Verify iteration loop runs multiple times
- [ ] Verify execution stops after max iterations exceeded
- [ ] Verify step is marked as 'failed' in database
- [ ] Verify appropriate error message is displayed
- [ ] Verify error message includes step number

### Invalid Execution ID Test
- [ ] Run `stepcat --execution-id 99999` (non-existent ID)
- [ ] Verify clear error message is displayed
- [ ] Verify error indicates execution ID not found
- [ ] Verify execution does not start

### Dirty Working Directory Test
- [ ] Start execution, let it create some commits
- [ ] Stop execution
- [ ] Make uncommitted changes to a file in the working directory
- [ ] Try to resume with `stepcat --execution-id <id>`
- [ ] Verify execution is prevented
- [ ] Verify clear error message about uncommitted changes
- [ ] Commit or stash changes
- [ ] Verify resume works after cleaning working directory

### Missing Preconditions Test
- [ ] Try to run in project without `justfile`
- [ ] Verify execution fails when `just build` command is invoked (indirect error during execution rather than pre-run validation)
- [ ] Try to run in non-GitHub repo
- [ ] Verify execution fails when attempting to push to GitHub (indirect error)
- [ ] Try to run without GitHub token
- [ ] Verify appropriate error message during GitHub Actions check phase

## 4. Web UI Validation

### Initial State
- [ ] Start new execution with `--ui` flag
- [ ] Verify browser opens automatically to correct URL (default: http://localhost:3742)
- [ ] Verify page loads with Stepcat title and styling
- [ ] Verify all steps are displayed in hierarchical list
- [ ] Verify step status indicators show correct colors (gray for pending)

### Real-Time Updates
- [ ] Watch UI as execution progresses
- [ ] Verify step status changes appear immediately (no page refresh needed)
- [ ] Verify iteration appears when started (with spinner/loading indicator)
- [ ] Verify commit SHA appears in iteration when complete
- [ ] Verify issues appear in real-time when found
- [ ] Verify issue status updates when fixed
- [ ] Verify Codex review results appear in UI
- [ ] Verify GitHub Actions check status updates

### Hierarchical Display
- [ ] Verify steps display as top-level items
- [ ] Verify iterations display nested under steps
- [ ] Verify issues display nested under iterations
- [ ] Verify each level shows appropriate information:
  - Step: number, title, status, iteration count
  - Iteration: number, type, commit SHA, status
  - Issue: severity, description, file:line, status

### Collapsible Sections
- [ ] Click on a step header to collapse it
- [ ] Verify iterations are hidden when step is collapsed
- [ ] Click again to expand
- [ ] Verify iterations reappear
- [ ] Click on an iteration header to collapse it
- [ ] Verify issues are hidden when iteration is collapsed
- [ ] Verify current in-progress step is expanded by default
- [ ] Verify completed steps are collapsed by default

### Progress Indicators
- [ ] Verify progress information is displayed (e.g., "Iteration 2 of 5")
- [ ] Verify issue resolution count (e.g., "Fixed 3 of 4 issues")
- [ ] Verify loading spinners appear during long operations
- [ ] Verify completion checkmarks appear when steps complete

### State Synchronization
- [ ] Start execution and let it run for a while
- [ ] Open a new browser window to the same URL
- [ ] Verify new window receives full state via `state_sync` event
- [ ] Verify both windows show identical state
- [ ] Verify both windows update in real-time as execution progresses
- [ ] Close and reopen browser after execution completes
- [ ] Verify completed state is still visible

### Visual Styling
- [ ] Verify color coding is correct:
  - Pending: gray
  - In Progress: blue (with animations/spinner)
  - Completed: green
  - Failed: red
- [ ] Verify smooth animations when status changes
- [ ] Verify page is visually appealing with purple/pastel theme
- [ ] Verify layout is readable and not cluttered
- [ ] Verify text is properly formatted (no HTML escaping issues visible)

### Security (XSS Prevention)
- [ ] Create a test plan with step title containing HTML: `## Step 1: <script>alert('xss')</script>`
- [ ] Run execution with UI
- [ ] Verify HTML is escaped and displayed as text (not executed)
- [ ] Verify no alert popup appears
- [ ] Verify step title shows literal `<script>` tags as text
- [ ] Test with other fields: issue descriptions, file paths, etc.

### Custom Port and No Auto-Open
- [ ] Run with `--port 8080 --no-auto-open`
- [ ] Verify browser does NOT open automatically
- [ ] Manually open browser to `http://localhost:8080`
- [ ] Verify UI loads and works correctly on custom port

## 5. Documentation Validation

### CLAUDE.md Accuracy
- [ ] Read through CLAUDE.md from start to finish
- [ ] Verify Project Overview section accurately describes the system
- [ ] Verify Common Commands section has correct CLI examples
- [ ] Try each CLI example to ensure they work as documented
- [ ] Verify Architecture section matches actual implementation:
  - Database schema matches `src/database.ts`
  - Component descriptions match actual code
  - Event types match `src/events.ts`
- [ ] Verify Key Behaviors section is accurate:
  - Git commit strategy matches orchestrator behavior
  - Step execution flow matches actual flow
  - State tracking description is correct
- [ ] Verify Important Notes section is current and accurate
- [ ] Check for any outdated references or broken internal links
- [ ] Verify no mentions of removed features (e.g., `amendPlanFileAndPush()`)

### README.md (if exists)
- [ ] Verify README has up-to-date information
- [ ] Verify installation instructions work
- [ ] Verify usage examples are correct

## 6. System Readiness

### Final Checks
- [ ] All npm scripts run successfully (`build`, `lint`, `test`)
- [ ] No outstanding bugs or issues discovered during testing
- [ ] All integration test scenarios pass
- [ ] Documentation is accurate and complete
- [ ] System is ready for production use

## Test Results Summary

**Date:** [Fill in when testing]

**Tested by:** [Fill in]

**Environment:**
- Node version: [Fill in]
- OS: [Fill in]
- Test project: [Fill in]

**Results:**
- Total test scenarios: 6
- Scenarios passed: [Fill in]
- Scenarios failed: [Fill in]
- Issues found: [List any issues]

**Conclusion:** [Ready for production / Needs fixes / etc.]

---

## Notes

Use this checklist to perform comprehensive manual integration testing. Check off items as you complete them. Document any issues or unexpected behavior in the Test Results Summary section.

For automated testing, refer to the test suites in `src/__tests__/`.
