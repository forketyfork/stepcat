import { vi } from 'vitest';
import { Orchestrator } from '../orchestrator.js';
import { Database } from '../database.js';
import { ClaudeRunner } from '../claude-runner.js';
import { CodexRunner } from '../codex-runner.js';
import { GitHubChecker } from '../github-checker.js';
import { OrchestratorEventEmitter } from '../events.js';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';

const { mockClaudeRunnerInstance, mockCodexRunnerInstance, mockGitHubCheckerInstance } = vi.hoisted(() => {
  const mockClaudeRunnerInstance = {
    run: vi.fn(),
    buildImplementationPrompt: vi.fn(),
    buildFixPrompt: vi.fn(),
    buildReviewFixPrompt: vi.fn(),
  };

  const mockCodexRunnerInstance = {
    run: vi.fn(),
    buildReviewPrompt: vi.fn(),
    buildBuildFixReviewPrompt: vi.fn(),
    buildReviewFixReviewPrompt: vi.fn(),
  };

  const mockGitHubCheckerInstance = {
    waitForChecksToPass: vi.fn(),
    getLatestCommitSha: vi.fn(),
    getLastTrackedSha: vi.fn().mockReturnValue('abc123'),
    getOwner: vi.fn().mockReturnValue('test-owner'),
    getRepo: vi.fn().mockReturnValue('test-repo'),
    getOctokit: vi.fn().mockReturnValue({
      checks: {
        listForRef: vi.fn().mockResolvedValue({ data: { check_runs: [] } }),
      },
      request: vi.fn().mockResolvedValue({ data: [] }),
    }),
  };

  return { mockClaudeRunnerInstance, mockCodexRunnerInstance, mockGitHubCheckerInstance };
});

vi.mock('../claude-runner', () => {
  return {
    ClaudeRunner: vi.fn(function() { return mockClaudeRunnerInstance; }),
  };
});

vi.mock('../codex-runner', () => {
  return {
    CodexRunner: vi.fn(function() { return mockCodexRunnerInstance; }),
  };
});

vi.mock('../github-checker', async () => {
  const actual = await vi.importActual<typeof import('../github-checker.js')>('../github-checker.js');
  const GitHubCheckerMock: any = vi.fn(function() { return mockGitHubCheckerInstance; });
  GitHubCheckerMock.parseRepoInfo = actual.GitHubChecker.parseRepoInfo;
  return {
    ...actual,
    GitHubChecker: GitHubCheckerMock,
  };
});
vi.mock('child_process');

const { MergeConflictError } = await vi.importActual<typeof import('../github-checker.js')>('../github-checker.js');

describe('Orchestrator', () => {
  let tempDir: string;
  let planFile: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'orchestrator-test-'));

    const planContent = `# Test Plan

## Step 1: Setup

Setup the project

## Step 2: Implementation

Implement the feature
`;
    planFile = join(tempDir, 'plan.md');
    writeFileSync(planFile, planContent, 'utf-8');

    vi.clearAllMocks();

    vi.spyOn(GitHubChecker, 'parseRepoInfo').mockReturnValue({
      owner: 'test-owner',
      repo: 'test-repo',
    });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('new execution', () => {
    it('should initialize plan and steps in database', async () => {
      mockClaudeRunnerInstance.run = vi.fn().mockResolvedValue({ success: true, commitSha: 'abc123' });
      mockGitHubCheckerInstance.waitForChecksToPass = vi.fn().mockResolvedValue(true);
      mockGitHubCheckerInstance.getLatestCommitSha = vi.fn().mockReturnValue('abc123');
      mockGitHubCheckerInstance.getLastTrackedSha = vi.fn().mockReturnValue('abc123');
      mockGitHubCheckerInstance.getLastTrackedSha = vi.fn().mockReturnValue('abc123');
      mockGitHubCheckerInstance.getLastTrackedSha = vi.fn().mockReturnValue('abc123');
      mockGitHubCheckerInstance.getLastTrackedSha = vi.fn().mockReturnValue('abc123');
      mockCodexRunnerInstance.run = vi.fn().mockResolvedValue({
        success: true,
        output: JSON.stringify({ result: 'PASS', issues: [] })
      });

      const eventEmitter = new OrchestratorEventEmitter();
      const orchestrator = new Orchestrator({
        planFile,
        workDir: tempDir,
        githubToken: 'test-token',
        eventEmitter,
        maxIterationsPerStep: 3,
      });

      const executionId = await orchestrator.run();

      expect(executionId).toBeGreaterThan(0);

      const db = new Database(tempDir);
      const plan = db.getPlan(executionId);
      expect(plan).toBeDefined();
      expect(plan!.planFilePath).toBe(planFile);

      const steps = db.getSteps(executionId);
      expect(steps).toHaveLength(2);
      expect(steps[0].title).toBe('Setup');
      expect(steps[1].title).toBe('Implementation');

      db.close();
    });
  });

  describe('resume execution', () => {
    it('should resume from existing execution ID', async () => {
      const db = new Database(tempDir);
      const plan = db.createPlan(planFile, tempDir, 'test-owner', 'test-repo');
      const step1 = db.createStep(plan.id, 1, 'Setup');
      const step2 = db.createStep(plan.id, 2, 'Implementation');
      db.updateStepStatus(step1.id, 'completed');
      db.close();

      mockClaudeRunnerInstance.run = vi.fn().mockResolvedValue({ success: true, commitSha: 'def456' });
      mockGitHubCheckerInstance.waitForChecksToPass = vi.fn().mockResolvedValue(true);
      mockGitHubCheckerInstance.getLatestCommitSha = vi.fn().mockReturnValue('def456');
      mockGitHubCheckerInstance.getLastTrackedSha = vi.fn().mockReturnValue('def456');
      mockCodexRunnerInstance.run = vi.fn().mockResolvedValue({
        success: true,
        output: JSON.stringify({ result: 'PASS', issues: [] })
      });

      const orchestrator = new Orchestrator({
        planFile,
        workDir: tempDir,
        githubToken: 'test-token',
        executionId: plan.id,
        maxIterationsPerStep: 3,
      });

      await orchestrator.run();

      const db2 = new Database(tempDir);
      const steps = db2.getSteps(plan.id);
      expect(steps[0].status).toBe('completed');
      expect(steps[1].status).toBe('completed');
      db2.close();
    });

    it('should refresh pending steps from updated plan on resume', async () => {
      const db = new Database(tempDir);
      const plan = db.createPlan(planFile, tempDir, 'test-owner', 'test-repo');
      const step1 = db.createStep(plan.id, 1, 'Setup');
      db.createStep(plan.id, 2, 'Implementation');
      db.createStep(plan.id, 3, 'Legacy Future');
      db.updateStepStatus(step1.id, 'completed');
      db.close();

      const updatedPlan = `# Test Plan

## Step 1: Setup

Setup the project

## Step 2: Implementation Updated

Implement the feature

## Step 3: New Future

Additional changes

## Step 4: Extra Step

More changes
`;
      writeFileSync(planFile, updatedPlan, 'utf-8');

      mockClaudeRunnerInstance.run = vi.fn().mockResolvedValue({ success: true, commitSha: 'abc123' });
      mockGitHubCheckerInstance.waitForChecksToPass = vi.fn().mockResolvedValue(true);
      mockGitHubCheckerInstance.getLatestCommitSha = vi.fn().mockReturnValue('abc123');
      mockGitHubCheckerInstance.getLastTrackedSha = vi.fn().mockReturnValue('abc123');
      mockCodexRunnerInstance.run = vi.fn().mockResolvedValue({
        success: true,
        output: JSON.stringify({ result: 'PASS', issues: [] })
      });

      const orchestrator = new Orchestrator({
        planFile,
        workDir: tempDir,
        githubToken: 'test-token',
        executionId: plan.id,
        maxIterationsPerStep: 3,
      });

      await orchestrator.run();

      const db2 = new Database(tempDir);
      const steps = db2.getSteps(plan.id);
      expect(steps).toHaveLength(4);
      expect(steps[1].title).toBe('Implementation Updated');
      expect(steps[2].title).toBe('New Future');
      expect(steps[3].title).toBe('Extra Step');
      db2.close();
    });

    it('should throw error if execution ID not found', () => {
      expect(() => {
        new Orchestrator({
          planFile,
          workDir: tempDir,
          githubToken: 'test-token',
          executionId: 999,
        });
      }).not.toThrow();
    });

    it('should mark in_progress iterations as aborted on resume', async () => {
      const db = new Database(tempDir);
      const plan = db.createPlan(planFile, tempDir, 'test-owner', 'test-repo');
      const step1 = db.createStep(plan.id, 1, 'Setup');
      const iteration1 = db.createIteration(step1.id, 1, 'implementation', 'claude', 'codex');
      db.close();

      mockClaudeRunnerInstance.run = vi.fn().mockResolvedValue({ success: true, commitSha: 'abc123' });
      mockGitHubCheckerInstance.waitForChecksToPass = vi.fn().mockResolvedValue(true);
      mockGitHubCheckerInstance.getLatestCommitSha = vi.fn().mockReturnValue('abc123');
      mockGitHubCheckerInstance.getLastTrackedSha = vi.fn().mockReturnValue('abc123');
      mockCodexRunnerInstance.run = vi.fn().mockResolvedValue({
        success: true,
        output: JSON.stringify({ result: 'PASS', issues: [] })
      });

      const orchestrator = new Orchestrator({
        planFile,
        workDir: tempDir,
        githubToken: 'test-token',
        executionId: plan.id,
        maxIterationsPerStep: 3,
      });

      await orchestrator.run();

      const db2 = new Database(tempDir);
      const iterations = db2.getIterations(step1.id);
      const abortedIteration = iterations.find(i => i.id === iteration1.id);
      expect(abortedIteration?.status).toBe('aborted');
      db2.close();
    });

    it('should not count aborted iterations toward max iterations', async () => {
      const db = new Database(tempDir);
      const plan = db.createPlan(planFile, tempDir, 'test-owner', 'test-repo');
      const step1 = db.createStep(plan.id, 1, 'Setup');
      const step2 = db.createStep(plan.id, 2, 'Implementation');

      db.createIteration(step1.id, 1, 'implementation', 'claude', 'codex');
      const iter1 = db.createIteration(step1.id, 2, 'implementation', 'claude', 'codex');
      db.updateIteration(iter1.id, { status: 'aborted' });

      const iter2 = db.createIteration(step1.id, 3, 'implementation', 'claude', 'codex');
      db.updateIteration(iter2.id, { status: 'aborted' });
      db.close();

      mockClaudeRunnerInstance.run = vi.fn().mockResolvedValue({ success: true, commitSha: 'abc123' });
      mockGitHubCheckerInstance.waitForChecksToPass = vi.fn().mockResolvedValue(true);
      mockGitHubCheckerInstance.getLatestCommitSha = vi.fn().mockReturnValue('abc123');
      mockGitHubCheckerInstance.getLastTrackedSha = vi.fn().mockReturnValue('abc123');
      mockCodexRunnerInstance.run = vi.fn().mockResolvedValue({
        success: true,
        output: JSON.stringify({ result: 'PASS', issues: [] })
      });

      const orchestrator = new Orchestrator({
        planFile,
        workDir: tempDir,
        githubToken: 'test-token',
        executionId: plan.id,
        maxIterationsPerStep: 3,
      });

      await orchestrator.run();

      const db2 = new Database(tempDir);
      const steps = db2.getSteps(plan.id);
      expect(steps[0].status).toBe('completed');
      expect(steps[1].status).toBe('completed');
      db2.close();
    });

    it('should preserve iteration numbering and events when resuming with aborted iterations', async () => {
      const db = new Database(tempDir);
      const plan = db.createPlan(planFile, tempDir, 'test-owner', 'test-repo');
      const step1 = db.createStep(plan.id, 1, 'Setup');
      db.createIteration(step1.id, 1, 'implementation', 'claude', 'codex');
      db.close();

      mockClaudeRunnerInstance.run = vi.fn().mockResolvedValue({ success: true, commitSha: 'abc123' });
      mockGitHubCheckerInstance.waitForChecksToPass = vi.fn().mockResolvedValue(true);
      mockGitHubCheckerInstance.getLatestCommitSha = vi.fn().mockReturnValue('abc123');
      mockGitHubCheckerInstance.getLastTrackedSha = vi.fn().mockReturnValue('abc123');
      mockCodexRunnerInstance.run = vi.fn().mockResolvedValue({
        success: true,
        output: JSON.stringify({ result: 'PASS', issues: [] })
      });

      const eventEmitter = new OrchestratorEventEmitter();
      const events: any[] = [];
      eventEmitter.on('event', (event) => events.push(event));

      const orchestrator = new Orchestrator({
        planFile,
        workDir: tempDir,
        githubToken: 'test-token',
        executionId: plan.id,
        maxIterationsPerStep: 3,
        eventEmitter,
      });

      await orchestrator.run();

      const db2 = new Database(tempDir);
      const iterations = db2.getIterations(step1.id);
      expect(iterations).toHaveLength(2);
      const aborted = iterations.find(i => i.status === 'aborted');
      const completed = iterations.find(i => i.status === 'completed');
      expect(aborted?.iterationNumber).toBe(1);
      expect(completed?.iterationNumber).toBe(2);
      expect(completed?.commitSha).toBe('abc123');

      const iterationStartEvents = events.filter((event) => event.type === 'iteration_start');
      const iterationCompleteEvents = events.filter((event) => event.type === 'iteration_complete');
      expect(iterationStartEvents[0]?.iterationNumber).toBe(2);
      expect(iterationCompleteEvents[0]?.iterationNumber).toBe(2);

      db2.close();
    });

    it('should recover manual commit when resuming with failed iteration', async () => {
      const manualCommitSha = 'manual123abc';

      // Setup: create a failed iteration without commit SHA
      const db = new Database(tempDir);
      const plan = db.createPlan(planFile, tempDir, 'test-owner', 'test-repo');
      const step1 = db.createStep(plan.id, 1, 'Setup');
      db.createStep(plan.id, 2, 'Implementation');
      db.updateStepStatus(step1.id, 'in_progress');
      const iteration1 = db.createIteration(step1.id, 1, 'implementation', 'claude', 'codex');
      db.updateIteration(iteration1.id, { status: 'failed', commitSha: null });
      db.close();

      // Mock execSync to return the manual commit SHA for git rev-parse HEAD
      const mockedExecSync = vi.mocked(execSync);
      mockedExecSync.mockImplementation((cmd: string) => {
        if (typeof cmd === 'string' && cmd.includes('git rev-parse HEAD')) {
          return manualCommitSha;
        }
        if (typeof cmd === 'string' && cmd.includes('git push')) {
          return '';
        }
        return '';
      });

      mockGitHubCheckerInstance.waitForChecksToPass = vi.fn().mockResolvedValue(true);
      mockGitHubCheckerInstance.getLatestCommitSha = vi.fn().mockReturnValue(manualCommitSha);
      mockGitHubCheckerInstance.getLastTrackedSha = vi.fn().mockReturnValue(manualCommitSha);
      mockCodexRunnerInstance.run = vi.fn().mockResolvedValue({
        success: true,
        output: JSON.stringify({ result: 'PASS', issues: [] })
      });
      mockClaudeRunnerInstance.run = vi.fn().mockResolvedValue({ success: true, commitSha: 'step2commit' });

      const eventEmitter = new OrchestratorEventEmitter();
      const events: any[] = [];
      eventEmitter.on('event', (event) => events.push(event));

      const orchestrator = new Orchestrator({
        planFile,
        workDir: tempDir,
        githubToken: 'test-token',
        executionId: plan.id,
        maxIterationsPerStep: 3,
        eventEmitter,
      });

      await orchestrator.run();

      const db2 = new Database(tempDir);
      const iterations = db2.getIterations(step1.id);

      // The failed iteration should now have the manual commit SHA and be completed
      const recoveredIteration = iterations.find(i => i.id === iteration1.id);
      expect(recoveredIteration?.commitSha).toBe(manualCommitSha);
      expect(recoveredIteration?.status).toBe('completed');

      // Should only have one iteration for step 1 (the recovered one)
      expect(iterations).toHaveLength(1);

      // Step 1 should be completed
      const steps = db2.getSteps(plan.id);
      expect(steps[0].status).toBe('completed');

      // Check that iteration_complete event was emitted for the recovered iteration
      const iterationCompleteEvents = events.filter((e) => e.type === 'iteration_complete');
      const recoveredEvent = iterationCompleteEvents.find(e => e.commitSha === manualCommitSha);
      expect(recoveredEvent).toBeDefined();

      db2.close();
    });

    it('should not recover if HEAD is already a known commit', async () => {
      const knownCommitSha = 'known123abc';

      // Setup: create a failed iteration with no commit SHA
      // HEAD points to a commit that's already known from a different source
      const db = new Database(tempDir);
      const plan = db.createPlan(planFile, tempDir, 'test-owner', 'test-repo');
      const step1 = db.createStep(plan.id, 1, 'Setup');
      db.createStep(plan.id, 2, 'Implementation');
      db.updateStepStatus(step1.id, 'in_progress');

      // Create iteration1 as completed with the known commit SHA
      const iteration1 = db.createIteration(step1.id, 1, 'implementation', 'claude', 'codex');
      db.updateIteration(iteration1.id, { status: 'completed', commitSha: knownCommitSha });

      // Create iteration2 as failed with no commit SHA
      const iteration2 = db.createIteration(step1.id, 2, 'review_fix', 'claude', 'codex');
      db.updateIteration(iteration2.id, { status: 'failed', commitSha: null });
      db.close();

      // Mock execSync to return the known commit SHA (HEAD hasn't changed)
      const mockedExecSync = vi.mocked(execSync);
      mockedExecSync.mockImplementation((cmd: string) => {
        if (typeof cmd === 'string' && cmd.includes('git rev-parse HEAD')) {
          return knownCommitSha;
        }
        if (typeof cmd === 'string' && cmd.includes('git push')) {
          return '';
        }
        return '';
      });

      mockClaudeRunnerInstance.run = vi.fn().mockResolvedValue({ success: true, commitSha: 'newcommit456' });
      mockGitHubCheckerInstance.waitForChecksToPass = vi.fn().mockResolvedValue(true);
      mockGitHubCheckerInstance.getLatestCommitSha = vi.fn().mockReturnValue(knownCommitSha);
      mockGitHubCheckerInstance.getLastTrackedSha = vi.fn().mockReturnValue(knownCommitSha);
      mockCodexRunnerInstance.run = vi.fn().mockResolvedValue({
        success: true,
        output: JSON.stringify({ result: 'PASS', issues: [] })
      });

      const orchestrator = new Orchestrator({
        planFile,
        workDir: tempDir,
        githubToken: 'test-token',
        executionId: plan.id,
        maxIterationsPerStep: 5,
      });

      await orchestrator.run();

      const db2 = new Database(tempDir);
      const iterations = db2.getIterations(step1.id);

      // The failed iteration should NOT be recovered (HEAD was a known commit)
      const failedIteration = iterations.find(i => i.id === iteration2.id);
      expect(failedIteration?.commitSha).toBeNull();
      expect(failedIteration?.status).toBe('failed');

      // Step should still complete because there's a completed iteration with a commit
      // and the review passes
      const steps = db2.getSteps(plan.id);
      expect(steps[0].status).toBe('completed');

      db2.close();
    });
  });

  describe('build failure handling', () => {
    it('should create build_fix iteration when CI fails', async () => {
      mockClaudeRunnerInstance.run = jest
        .fn()
        .mockResolvedValueOnce({ success: true, commitSha: 'abc123' })
        .mockResolvedValueOnce({ success: true, commitSha: 'def456' })
        .mockResolvedValue({ success: true, commitSha: 'step2' });

      mockGitHubCheckerInstance.getLatestCommitSha = jest
        .fn()
        .mockReturnValueOnce('abc123')
        .mockReturnValueOnce('def456')
        .mockReturnValue('step2');
      mockGitHubCheckerInstance.getLastTrackedSha = jest
        .fn()
        .mockReturnValueOnce('abc123')
        .mockReturnValueOnce('def456')
        .mockReturnValue('step2');

      mockGitHubCheckerInstance.waitForChecksToPass = jest
        .fn()
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true)
        .mockResolvedValue(true);

      mockCodexRunnerInstance.run = vi.fn().mockResolvedValue({
        success: true,
        output: JSON.stringify({ result: 'PASS', issues: [] })
      });

      const orchestrator = new Orchestrator({
        planFile,
        workDir: tempDir,
        githubToken: 'test-token',
        maxIterationsPerStep: 5,
      });

      const executionId = await orchestrator.run();

      const db = new Database(tempDir);
      const steps = db.getSteps(executionId);
      const step = steps[0];
      const iterations = db.getIterations(step.id);

      expect(iterations.length).toBeGreaterThanOrEqual(2);
      expect(iterations[0].type).toBe('implementation');
      expect(iterations[1].type).toBe('build_fix');
      expect(iterations[1].commitSha).toBe('def456');

      const issues = db.getIssues(iterations[0].id);
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].type).toBe('ci_failure');

      db.close();
    });

    it('should attach CI failures to the last committed iteration after a failed attempt', async () => {
      const db = new Database(tempDir);
      const plan = db.createPlan(planFile, tempDir, 'test-owner', 'test-repo');
      const step1 = db.createStep(plan.id, 1, 'Setup');
      db.createStep(plan.id, 2, 'Implementation');
      const iteration1 = db.createIteration(step1.id, 1, 'implementation', 'claude', 'codex');
      db.updateIteration(iteration1.id, { commitSha: 'abc123', status: 'completed' });
      const failedIteration = db.createIteration(step1.id, 2, 'build_fix', 'claude', 'codex');
      db.updateIteration(failedIteration.id, { status: 'failed' });
      db.close();

      mockClaudeRunnerInstance.run = vi
        .fn()
        .mockResolvedValueOnce({ success: true, commitSha: 'def456' })
        .mockResolvedValueOnce({ success: true, commitSha: 'step2' });

      mockGitHubCheckerInstance.getLatestCommitSha = vi
        .fn()
        .mockReturnValueOnce('abc123')
        .mockReturnValueOnce('def456')
        .mockReturnValue('step2');
      mockGitHubCheckerInstance.getLastTrackedSha = vi
        .fn()
        .mockReturnValueOnce('abc123')
        .mockReturnValueOnce('def456')
        .mockReturnValue('step2');

      mockGitHubCheckerInstance.waitForChecksToPass = vi
        .fn()
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true)
        .mockResolvedValue(true);

      mockCodexRunnerInstance.run = vi.fn().mockResolvedValue({
        success: true,
        output: JSON.stringify({ result: 'PASS', issues: [] })
      });

      const orchestrator = new Orchestrator({
        planFile,
        workDir: tempDir,
        githubToken: 'test-token',
        executionId: plan.id,
        maxIterationsPerStep: 5,
      });

      await orchestrator.run();

      const db2 = new Database(tempDir);
      const iteration1Issues = db2.getIssues(iteration1.id);
      expect(iteration1Issues.some(issue => issue.type === 'ci_failure')).toBe(true);
      expect(db2.getIssues(failedIteration.id)).toHaveLength(0);

      const buildFixPrompt = mockCodexRunnerInstance.run.mock.calls
        .map(call => (call[0] as { prompt: string }).prompt)
        .find(prompt => prompt.includes('fix the following build failures'));
      expect(buildFixPrompt).toBeDefined();
      expect(buildFixPrompt).toContain('Build checks failed.');

      db2.close();
    });
  });

  describe('merge conflict handling', () => {
    it('should surface merge conflicts during build checks', async () => {
      const db = new Database(tempDir);
      const plan = db.createPlan(planFile, tempDir, 'test-owner', 'test-repo');
      const step1 = db.createStep(plan.id, 1, 'Setup');
      db.close();

      mockClaudeRunnerInstance.run = vi.fn().mockResolvedValue({ success: true, commitSha: 'abc123' });
      mockGitHubCheckerInstance.getLatestCommitSha = vi.fn().mockReturnValue('abc123');
      mockGitHubCheckerInstance.getLastTrackedSha = vi.fn().mockReturnValue('abc123');
      mockGitHubCheckerInstance.waitForChecksToPass = vi
        .fn()
        .mockRejectedValue(
          new MergeConflictError('Merge conflict detected for PR #7', {
            prNumber: 7,
            branch: 'feature/test',
            base: 'main',
          })
        );
      mockCodexRunnerInstance.run = vi.fn().mockResolvedValue({
        success: true,
        output: JSON.stringify({ result: 'PASS', issues: [] })
      });

      const orchestrator = new Orchestrator({
        planFile,
        workDir: tempDir,
        githubToken: 'test-token',
        executionId: plan.id,
        maxIterationsPerStep: 3,
      });

      await expect(orchestrator.run()).rejects.toThrow(/merge conflict/i);

      const db2 = new Database(tempDir);
      const iterations = db2.getIterations(step1.id);
      expect(iterations.some(iteration => iteration.buildStatus === 'merge_conflict')).toBe(true);

      const issues = db2.getIssues(iterations[0].id);
      expect(issues[0].type).toBe('merge_conflict');

      const steps = db2.getSteps(plan.id);
      expect(steps[0].status).toBe('failed');
      db2.close();
    });
  });

  describe('code review handling', () => {
    it('should create review_fix iteration when Codex finds issues', async () => {
      mockClaudeRunnerInstance.run = jest
        .fn()
        .mockResolvedValueOnce({ success: true, commitSha: 'abc123' })
        .mockResolvedValueOnce({ success: true, commitSha: 'fix789' })
        .mockResolvedValue({ success: true, commitSha: 'step2' });

      mockGitHubCheckerInstance.getLatestCommitSha = jest
        .fn()
        .mockReturnValueOnce('abc123')
        .mockReturnValueOnce('fix789')
        .mockReturnValue('step2');
      mockGitHubCheckerInstance.getLastTrackedSha = jest
        .fn()
        .mockReturnValueOnce('abc123')
        .mockReturnValueOnce('fix789')
        .mockReturnValue('step2');

      mockGitHubCheckerInstance.waitForChecksToPass = vi.fn().mockResolvedValue(true);

      mockCodexRunnerInstance.run = jest
        .fn()
        .mockResolvedValueOnce({
          success: true,
          output: JSON.stringify({
            result: 'FAIL',
            issues: [{ file: 'src/app.ts', line: 42, severity: 'error', description: 'Missing error handling' }]
          })
        })
        .mockResolvedValueOnce({
          success: true,
          output: JSON.stringify({ result: 'PASS', issues: [] })
        })
        .mockResolvedValue({
          success: true,
          output: JSON.stringify({ result: 'PASS', issues: [] })
        });

      const orchestrator = new Orchestrator({
        planFile,
        workDir: tempDir,
        githubToken: 'test-token',
        maxIterationsPerStep: 5,
      });

      const executionId = await orchestrator.run();

      const db = new Database(tempDir);
      const steps = db.getSteps(executionId);
      const step = steps[0];
      const iterations = db.getIterations(step.id);

      expect(iterations.length).toBeGreaterThanOrEqual(2);
      expect(iterations[0].type).toBe('implementation');
      expect(iterations[1].type).toBe('review_fix');

      const issues = db.getIssues(iterations[0].id);
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].type).toBe('codex_review');
      expect(issues[0].description).toBe('Missing error handling');

      db.close();
    });
  });

  describe('max iterations enforcement', () => {
    it('should fail step when max iterations exceeded', async () => {
      mockClaudeRunnerInstance.run = vi.fn().mockResolvedValue({ success: true, commitSha: 'abc123' });
      mockGitHubCheckerInstance.getLatestCommitSha = vi.fn().mockReturnValue('abc123');
      mockGitHubCheckerInstance.getLastTrackedSha = vi.fn().mockReturnValue('abc123');
      mockGitHubCheckerInstance.waitForChecksToPass = vi.fn().mockResolvedValue(true);

      mockCodexRunnerInstance.run = vi.fn().mockResolvedValue({
        success: true,
        output: JSON.stringify({
          result: 'FAIL',
          issues: [{ file: 'test.ts', severity: 'error', description: 'Always fails' }]
        })
      });

      const orchestrator = new Orchestrator({
        planFile,
        workDir: tempDir,
        githubToken: 'test-token',
        maxIterationsPerStep: 3,
      });

      await expect(orchestrator.run()).rejects.toThrow(/exceeded maximum iterations/);

      const db = new Database(tempDir);
      const steps = db.getSteps(1);
      expect(steps[0].status).toBe('failed');
      db.close();
    });

    it('should perform review on final allowed iteration before failing', async () => {
      mockClaudeRunnerInstance.run = vi.fn().mockResolvedValue({ success: true, commitSha: 'abc123' });
      mockGitHubCheckerInstance.getLatestCommitSha = vi.fn().mockReturnValue('abc123');
      mockGitHubCheckerInstance.getLastTrackedSha = vi.fn().mockReturnValue('abc123');
      mockGitHubCheckerInstance.waitForChecksToPass = vi.fn().mockResolvedValue(true);

      mockCodexRunnerInstance.run = vi.fn().mockResolvedValue({
        success: true,
        output: JSON.stringify({
          result: 'FAIL',
          issues: [{ file: 'test.ts', severity: 'error', description: 'Always fails' }]
        })
      });

      const orchestrator = new Orchestrator({
        planFile,
        workDir: tempDir,
        githubToken: 'test-token',
        maxIterationsPerStep: 3,
      });

      await expect(orchestrator.run()).rejects.toThrow(/exceeded maximum iterations/);
      expect(mockCodexRunnerInstance.run).toHaveBeenCalledTimes(3);
    });
  });

  describe('event emission', () => {
    it('should emit step_start and step_complete events', async () => {
      mockClaudeRunnerInstance.run = vi.fn().mockResolvedValue({ success: true, commitSha: 'abc123' });
      mockGitHubCheckerInstance.waitForChecksToPass = vi.fn().mockResolvedValue(true);
      mockGitHubCheckerInstance.getLatestCommitSha = vi.fn().mockReturnValue('abc123');
      mockGitHubCheckerInstance.getLastTrackedSha = vi.fn().mockReturnValue('abc123');
      mockCodexRunnerInstance.run = vi.fn().mockResolvedValue({
        success: true,
        output: JSON.stringify({ result: 'PASS', issues: [] })
      });

      const eventEmitter = new OrchestratorEventEmitter();
      const events: any[] = [];
      eventEmitter.on('event', (event) => events.push(event));

      const orchestrator = new Orchestrator({
        planFile,
        workDir: tempDir,
        githubToken: 'test-token',
        eventEmitter,
        maxIterationsPerStep: 3,
      });

      await orchestrator.run();

      const stepStartEvents = events.filter((e) => e.type === 'step_start');
      const stepCompleteEvents = events.filter((e) => e.type === 'step_complete');

      expect(stepStartEvents.length).toBeGreaterThan(0);
      expect(stepCompleteEvents.length).toBeGreaterThan(0);
    });

    it('should emit iteration_start and iteration_complete events', async () => {
      mockClaudeRunnerInstance.run = vi.fn().mockResolvedValue({ success: true, commitSha: 'abc123' });
      mockGitHubCheckerInstance.waitForChecksToPass = vi.fn().mockResolvedValue(true);
      mockGitHubCheckerInstance.getLatestCommitSha = vi.fn().mockReturnValue('abc123');
      mockGitHubCheckerInstance.getLastTrackedSha = vi.fn().mockReturnValue('abc123');
      mockCodexRunnerInstance.run = vi.fn().mockResolvedValue({
        success: true,
        output: JSON.stringify({ result: 'PASS', issues: [] })
      });

      const eventEmitter = new OrchestratorEventEmitter();
      const events: any[] = [];
      eventEmitter.on('event', (event) => events.push(event));

      const orchestrator = new Orchestrator({
        planFile,
        workDir: tempDir,
        githubToken: 'test-token',
        eventEmitter,
        maxIterationsPerStep: 3,
      });

      await orchestrator.run();

      const iterationStartEvents = events.filter((e) => e.type === 'iteration_start');
      const iterationCompleteEvents = events.filter((e) => e.type === 'iteration_complete');

      expect(iterationStartEvents.length).toBeGreaterThan(0);
      expect(iterationCompleteEvents.length).toBeGreaterThan(0);
    });
  });

  describe('configuration', () => {
    it('should use default max iterations of 3', async () => {
      mockClaudeRunnerInstance.run = vi.fn().mockResolvedValue({ success: true, commitSha: 'abc123' });
      mockGitHubCheckerInstance.waitForChecksToPass = vi.fn().mockResolvedValue(true);
      mockGitHubCheckerInstance.getLatestCommitSha = vi.fn().mockReturnValue('abc123');
      mockGitHubCheckerInstance.getLastTrackedSha = vi.fn().mockReturnValue('abc123');
      mockCodexRunnerInstance.run = vi.fn().mockResolvedValue({
        success: true,
        output: JSON.stringify({
          result: 'FAIL',
          issues: [{ file: 'test.ts', severity: 'error', description: 'Fails' }]
        })
      });

      const orchestrator = new Orchestrator({
        planFile,
        workDir: tempDir,
        githubToken: 'test-token',
      });

      await expect(orchestrator.run()).rejects.toThrow(/exceeded maximum iterations \(3\)/);
    });

    it('should use custom max iterations when provided', async () => {
      mockClaudeRunnerInstance.run = vi.fn().mockResolvedValue({ success: true, commitSha: 'abc123' });
      mockGitHubCheckerInstance.waitForChecksToPass = vi.fn().mockResolvedValue(true);
      mockGitHubCheckerInstance.getLatestCommitSha = vi.fn().mockReturnValue('abc123');
      mockGitHubCheckerInstance.getLastTrackedSha = vi.fn().mockReturnValue('abc123');
      mockCodexRunnerInstance.run = vi.fn().mockResolvedValue({
        success: true,
        output: JSON.stringify({
          result: 'FAIL',
          issues: [{ file: 'test.ts', severity: 'error', description: 'Fails' }]
        })
      });

      const orchestrator = new Orchestrator({
        planFile,
        workDir: tempDir,
        githubToken: 'test-token',
        maxIterationsPerStep: 5,
      });

      await expect(orchestrator.run()).rejects.toThrow(/exceeded maximum iterations \(5\)/);
    });
  });

  describe('agent configuration', () => {
    it('allows using Codex for implementation iterations', async () => {
      mockCodexRunnerInstance.run = vi.fn().mockImplementation(async (options: any) => {
        if (options.expectCommit) {
          return { success: true, output: 'Implementation complete', commitSha: 'abc123' };
        }
        return {
          success: true,
          output: JSON.stringify({ result: 'PASS', issues: [] }),
        };
      });

      mockClaudeRunnerInstance.run = vi.fn();
      mockGitHubCheckerInstance.waitForChecksToPass = vi.fn().mockResolvedValue(true);
      mockGitHubCheckerInstance.getLatestCommitSha = vi.fn().mockReturnValue('abc123');
      mockGitHubCheckerInstance.getLastTrackedSha = vi.fn().mockReturnValue('abc123');

      const orchestrator = new Orchestrator({
        planFile,
        workDir: tempDir,
        githubToken: 'test-token',
        implementationAgent: 'codex',
      });

      await orchestrator.run();

      expect(mockCodexRunnerInstance.run).toHaveBeenCalled();
      expect(mockCodexRunnerInstance.run.mock.calls[0][0].expectCommit).toBe(true);
      expect(mockClaudeRunnerInstance.run).not.toHaveBeenCalled();
    });

    it('allows using Claude Code for code review', async () => {
      mockClaudeRunnerInstance.run = vi.fn().mockImplementation(async (options: any) => {
        if (options.prompt.includes('code review') || options.prompt.includes('Review')) {
          return {
            success: true,
            commitSha: null,
            output: JSON.stringify({ result: 'PASS', issues: [] }),
          };
        }
        return { success: true, commitSha: 'abc123', output: 'Implementation log' };
      });

      mockCodexRunnerInstance.run = vi.fn();

      mockGitHubCheckerInstance.waitForChecksToPass = vi.fn().mockResolvedValue(true);
      mockGitHubCheckerInstance.getLatestCommitSha = vi.fn().mockReturnValue('abc123');
      mockGitHubCheckerInstance.getLastTrackedSha = vi.fn().mockReturnValue('abc123');

      const orchestrator = new Orchestrator({
        planFile,
        workDir: tempDir,
        githubToken: 'test-token',
        reviewAgent: 'claude',
      });

      await orchestrator.run();

      expect(mockClaudeRunnerInstance.run).toHaveBeenCalled();
      expect(mockCodexRunnerInstance.run).not.toHaveBeenCalled();
    });
  });

  describe('extractBuildErrors', () => {
    it('includes output text and annotations for failed checks', async () => {
      const listForRef = vi.fn().mockResolvedValue({
        data: {
          check_runs: [
            {
              id: 101,
              name: 'build',
              status: 'completed',
              conclusion: 'failure',
              output: {
                title: 'Build failed',
                summary: 'Compile error',
                text: 'error: expected type',
              },
              details_url: 'https://example.com/details',
            },
          ],
        },
      });
      const request = vi.fn().mockResolvedValue({
        data: [
          {
            path: 'src/main.zig',
            start_line: 12,
            end_line: 12,
            annotation_level: 'failure',
            message: 'expected type',
            title: 'Compiler error',
            raw_details: 'details here',
          },
        ],
      });

      mockGitHubCheckerInstance.getOctokit = vi.fn().mockReturnValue({
        checks: { listForRef },
        request,
      });

      const orchestrator = new Orchestrator({
        planFile,
        workDir: tempDir,
        githubToken: 'test-token',
      });

      const extractBuildErrors = (orchestrator as unknown as {
        extractBuildErrors: (sha: string) => Promise<string>;
      }).extractBuildErrors;
      const errors = await extractBuildErrors.call(orchestrator, 'abc123');

      expect(errors).toContain('Check: build');
      expect(errors).toContain('Output:');
      expect(errors).toContain('Annotations:');
      expect(errors).toContain('src/main.zig:12');
      expect(listForRef).toHaveBeenCalled();
      expect(request).toHaveBeenCalled();
    });
  });

  describe('permission prompts', () => {
    const setTty = (value: boolean): void => {
      Object.defineProperty(process.stdin, 'isTTY', {
        value,
        configurable: true,
      });
    };

    it('routes permission approval to the UI adapter', async () => {
      const originalIsTty = process.stdin.isTTY;
      setTty(true);

      const requestPermissionApproval = vi.fn().mockResolvedValue(true);
      const uiAdapter = {
        initialize: vi.fn(),
        onEvent: vi.fn(),
        shutdown: vi.fn(),
        getName: () => 'test-ui',
        requestPermissionApproval,
      };

      const orchestrator = new Orchestrator({
        planFile,
        workDir: tempDir,
        githubToken: 'test-token',
        uiAdapters: [uiAdapter],
      });

      const confirmPermissionUpdate = (orchestrator as unknown as {
        confirmPermissionUpdate: (
          permissions: string[],
          reason: string | undefined,
          stepNumber: number,
        ) => Promise<boolean>;
      }).confirmPermissionUpdate;

      await expect(
        confirmPermissionUpdate.call(orchestrator, ['Bash(zig build:*)'], 'needed', 1),
      ).resolves.toBe(true);

      expect(requestPermissionApproval).toHaveBeenCalledWith(
        { permissions: ['Bash(zig build:*)'], reason: 'needed' },
        1,
      );

      setTty(originalIsTty ?? false);
    });

    it('fails when no UI adapter can approve permissions', async () => {
      const originalIsTty = process.stdin.isTTY;
      setTty(true);

      const orchestrator = new Orchestrator({
        planFile,
        workDir: tempDir,
        githubToken: 'test-token',
      });

      const confirmPermissionUpdate = (orchestrator as unknown as {
        confirmPermissionUpdate: (
          permissions: string[],
          reason: string | undefined,
          stepNumber: number,
        ) => Promise<boolean>;
      }).confirmPermissionUpdate;

      await expect(
        confirmPermissionUpdate.call(orchestrator, ['Bash(zig build:*)'], 'needed', 1),
      ).rejects.toThrow(/requires the TUI/);

      setTty(originalIsTty ?? false);
    });
  });
});
