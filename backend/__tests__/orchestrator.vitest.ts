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
});
