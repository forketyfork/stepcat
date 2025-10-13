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

jest.mock('../claude-runner');
jest.mock('../codex-runner');
jest.mock('../github-checker');
jest.mock('child_process');

describe('Orchestrator', () => {
  let tempDir: string;
  let planFile: string;
  let mockClaudeRunner: jest.Mocked<ClaudeRunner>;
  let mockCodexRunner: jest.Mocked<CodexRunner>;
  let mockGitHubChecker: jest.Mocked<GitHubChecker>;

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

    jest.clearAllMocks();

    mockClaudeRunner = new ClaudeRunner() as jest.Mocked<ClaudeRunner>;
    mockCodexRunner = new CodexRunner() as jest.Mocked<CodexRunner>;

    jest.spyOn(GitHubChecker, 'parseRepoInfo').mockReturnValue({
      owner: 'test-owner',
      repo: 'test-repo',
    });

    mockGitHubChecker = {
      waitForChecksToPass: jest.fn(),
      getLatestCommitSha: jest.fn(),
      getOwner: jest.fn().mockReturnValue('test-owner'),
      getRepo: jest.fn().mockReturnValue('test-repo'),
      getOctokit: jest.fn().mockReturnValue({
        checks: {
          listForRef: jest.fn().mockResolvedValue({ data: { check_runs: [] } }),
        },
      }),
    } as any;

    (ClaudeRunner as jest.MockedClass<typeof ClaudeRunner>).mockImplementation(() => mockClaudeRunner);
    (CodexRunner as jest.MockedClass<typeof CodexRunner>).mockImplementation(() => mockCodexRunner);
    (GitHubChecker as jest.MockedClass<typeof GitHubChecker>).mockImplementation(() => mockGitHubChecker);

    (execSync as jest.Mock) = jest.fn();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('new execution', () => {
    it('should initialize plan and steps in database', async () => {
      mockClaudeRunner.run = jest.fn().mockResolvedValue({ success: true, commitSha: 'abc123' });
      mockGitHubChecker.waitForChecksToPass = jest.fn().mockResolvedValue(true);
      mockGitHubChecker.getLatestCommitSha = jest.fn().mockReturnValue('abc123');
      mockCodexRunner.run = jest.fn().mockResolvedValue({
        success: true,
        output: JSON.stringify({ result: 'PASS', issues: [] })
      });
      mockCodexRunner.parseCodexOutput = jest.fn().mockReturnValue({ result: 'PASS', issues: [] });

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

      mockClaudeRunner.run = jest.fn().mockResolvedValue({ success: true, commitSha: 'def456' });
      mockGitHubChecker.waitForChecksToPass = jest.fn().mockResolvedValue(true);
      mockGitHubChecker.getLatestCommitSha = jest.fn().mockReturnValue('def456');
      mockCodexRunner.run = jest.fn().mockResolvedValue({
        success: true,
        output: JSON.stringify({ result: 'PASS', issues: [] })
      });
      mockCodexRunner.parseCodexOutput = jest.fn().mockReturnValue({ result: 'PASS', issues: [] });

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
  });

  describe('build failure handling', () => {
    it('should create build_fix iteration when CI fails', async () => {
      mockClaudeRunner.run = jest
        .fn()
        .mockResolvedValueOnce({ success: true, commitSha: 'abc123' })
        .mockResolvedValueOnce({ success: true, commitSha: 'def456' })
        .mockResolvedValue({ success: true, commitSha: 'step2' });

      mockGitHubChecker.getLatestCommitSha = jest
        .fn()
        .mockReturnValueOnce('abc123')
        .mockReturnValueOnce('def456')
        .mockReturnValue('step2');

      mockGitHubChecker.waitForChecksToPass = jest
        .fn()
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true)
        .mockResolvedValue(true);

      mockCodexRunner.run = jest.fn().mockResolvedValue({
        success: true,
        output: JSON.stringify({ result: 'PASS', issues: [] })
      });
      mockCodexRunner.parseCodexOutput = jest.fn().mockReturnValue({ result: 'PASS', issues: [] });

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

  describe('code review handling', () => {
    it('should create review_fix iteration when Codex finds issues', async () => {
      mockClaudeRunner.run = jest
        .fn()
        .mockResolvedValueOnce({ success: true, commitSha: 'abc123' })
        .mockResolvedValueOnce({ success: true, commitSha: 'fix789' })
        .mockResolvedValue({ success: true, commitSha: 'step2' });

      mockGitHubChecker.getLatestCommitSha = jest
        .fn()
        .mockReturnValueOnce('abc123')
        .mockReturnValueOnce('fix789')
        .mockReturnValue('step2');

      mockGitHubChecker.waitForChecksToPass = jest.fn().mockResolvedValue(true);

      mockCodexRunner.run = jest
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

      mockCodexRunner.parseCodexOutput = jest
        .fn()
        .mockReturnValueOnce({
          result: 'FAIL',
          issues: [{ file: 'src/app.ts', line: 42, severity: 'error', description: 'Missing error handling' }],
        })
        .mockReturnValueOnce({ result: 'PASS', issues: [] })
        .mockReturnValue({ result: 'PASS', issues: [] });

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
      mockClaudeRunner.run = jest.fn().mockResolvedValue({ success: true, commitSha: 'abc123' });
      mockGitHubChecker.getLatestCommitSha = jest.fn().mockReturnValue('abc123');
      mockGitHubChecker.waitForChecksToPass = jest.fn().mockResolvedValue(true);

      mockCodexRunner.run = jest.fn().mockResolvedValue({
        success: true,
        output: JSON.stringify({
          result: 'FAIL',
          issues: [{ file: 'test.ts', severity: 'error', description: 'Always fails' }]
        })
      });
      mockCodexRunner.parseCodexOutput = jest.fn().mockReturnValue({
        result: 'FAIL',
        issues: [{ file: 'test.ts', severity: 'error', description: 'Always fails' }],
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
  });

  describe('event emission', () => {
    it('should emit step_start and step_complete events', async () => {
      mockClaudeRunner.run = jest.fn().mockResolvedValue({ success: true, commitSha: 'abc123' });
      mockGitHubChecker.waitForChecksToPass = jest.fn().mockResolvedValue(true);
      mockGitHubChecker.getLatestCommitSha = jest.fn().mockReturnValue('abc123');
      mockCodexRunner.run = jest.fn().mockResolvedValue({
        success: true,
        output: JSON.stringify({ result: 'PASS', issues: [] })
      });
      mockCodexRunner.parseCodexOutput = jest.fn().mockReturnValue({ result: 'PASS', issues: [] });

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
      mockClaudeRunner.run = jest.fn().mockResolvedValue({ success: true, commitSha: 'abc123' });
      mockGitHubChecker.waitForChecksToPass = jest.fn().mockResolvedValue(true);
      mockGitHubChecker.getLatestCommitSha = jest.fn().mockReturnValue('abc123');
      mockCodexRunner.run = jest.fn().mockResolvedValue({
        success: true,
        output: JSON.stringify({ result: 'PASS', issues: [] })
      });
      mockCodexRunner.parseCodexOutput = jest.fn().mockReturnValue({ result: 'PASS', issues: [] });

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
    it('should use default max iterations of 10', async () => {
      mockClaudeRunner.run = jest.fn().mockResolvedValue({ success: true, commitSha: 'abc123' });
      mockGitHubChecker.waitForChecksToPass = jest.fn().mockResolvedValue(true);
      mockGitHubChecker.getLatestCommitSha = jest.fn().mockReturnValue('abc123');
      mockCodexRunner.run = jest.fn().mockResolvedValue({
        success: true,
        output: JSON.stringify({
          result: 'FAIL',
          issues: [{ file: 'test.ts', severity: 'error', description: 'Fails' }]
        })
      });
      mockCodexRunner.parseCodexOutput = jest.fn().mockReturnValue({
        result: 'FAIL',
        issues: [{ file: 'test.ts', severity: 'error', description: 'Fails' }],
      });

      const orchestrator = new Orchestrator({
        planFile,
        workDir: tempDir,
        githubToken: 'test-token',
      });

      await expect(orchestrator.run()).rejects.toThrow(/exceeded maximum iterations \(10\)/);
    });

    it('should use custom max iterations when provided', async () => {
      mockClaudeRunner.run = jest.fn().mockResolvedValue({ success: true, commitSha: 'abc123' });
      mockGitHubChecker.waitForChecksToPass = jest.fn().mockResolvedValue(true);
      mockGitHubChecker.getLatestCommitSha = jest.fn().mockReturnValue('abc123');
      mockCodexRunner.run = jest.fn().mockResolvedValue({
        success: true,
        output: JSON.stringify({
          result: 'FAIL',
          issues: [{ file: 'test.ts', severity: 'error', description: 'Fails' }]
        })
      });
      mockCodexRunner.parseCodexOutput = jest.fn().mockReturnValue({
        result: 'FAIL',
        issues: [{ file: 'test.ts', severity: 'error', description: 'Fails' }],
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
      mockCodexRunner.run = jest.fn().mockImplementation(async (options: any) => {
        if (options.expectCommit) {
          return { success: true, output: 'Implementation complete', commitSha: 'abc123' };
        }
        return {
          success: true,
          output: JSON.stringify({ result: 'PASS', issues: [] }),
        };
      });
      mockCodexRunner.parseCodexOutput = jest.fn().mockReturnValue({ result: 'PASS', issues: [] });

      mockClaudeRunner.run = jest.fn();
      mockGitHubChecker.waitForChecksToPass = jest.fn().mockResolvedValue(true);
      mockGitHubChecker.getLatestCommitSha = jest.fn().mockReturnValue('abc123');

      const orchestrator = new Orchestrator({
        planFile,
        workDir: tempDir,
        githubToken: 'test-token',
        implementationAgent: 'codex',
      });

      await orchestrator.run();

      expect(mockCodexRunner.run).toHaveBeenCalled();
      expect(mockCodexRunner.run.mock.calls[0][0].expectCommit).toBe(true);
      expect(mockClaudeRunner.run).not.toHaveBeenCalled();
    });

    it('allows using Claude Code for code review', async () => {
      mockClaudeRunner.run = jest.fn().mockImplementation(async (options: any) => {
        if (options.captureOutput) {
          return {
            success: true,
            commitSha: null,
            output: JSON.stringify({ result: 'PASS', issues: [] }),
          };
        }
        return { success: true, commitSha: 'abc123' };
      });

      mockCodexRunner.run = jest.fn();

      mockGitHubChecker.waitForChecksToPass = jest.fn().mockResolvedValue(true);
      mockGitHubChecker.getLatestCommitSha = jest.fn().mockReturnValue('abc123');

      const orchestrator = new Orchestrator({
        planFile,
        workDir: tempDir,
        githubToken: 'test-token',
        reviewAgent: 'claude',
      });

      await orchestrator.run();

      expect(mockClaudeRunner.run).toHaveBeenCalled();
      expect(mockCodexRunner.run).not.toHaveBeenCalled();
    });
  });
});
