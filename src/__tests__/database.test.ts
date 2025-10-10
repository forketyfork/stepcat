import { Database } from '../database';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('Database', () => {
  let tempDir: string;
  let db: Database;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'stepcat-db-test-'));
    db = new Database(tempDir);
  });

  afterEach(() => {
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('initialization', () => {
    it('should create database file in .stepcat directory', () => {
      expect(() => new Database(tempDir)).not.toThrow();
    });

    it('should create database with custom path', () => {
      const customPath = join(tempDir, 'custom.db');
      const customDb = new Database(tempDir, customPath);
      expect(() => customDb.close()).not.toThrow();
    });

    it('should enable foreign keys', () => {
      const result = (db as any).db.pragma('foreign_keys', { simple: true });
      expect(result).toBe(1);
    });
  });

  describe('plan operations', () => {
    it('should create a plan', () => {
      const plan = db.createPlan('/path/to/plan.md', '/path/to/workdir');

      expect(plan.id).toBeGreaterThan(0);
      expect(plan.planFilePath).toBe('/path/to/plan.md');
      expect(plan.workDir).toBe('/path/to/workdir');
      expect(plan.createdAt).toBeTruthy();
    });

    it('should retrieve a plan by id', () => {
      const created = db.createPlan('/path/to/plan.md', '/path/to/workdir');
      const retrieved = db.getPlan(created.id);

      expect(retrieved).toEqual(created);
    });

    it('should return undefined for non-existent plan', () => {
      const retrieved = db.getPlan(999);
      expect(retrieved).toBeUndefined();
    });

    it('should create multiple plans', () => {
      const plan1 = db.createPlan('/path/to/plan1.md', '/workdir1');
      const plan2 = db.createPlan('/path/to/plan2.md', '/workdir2');

      expect(plan1.id).not.toBe(plan2.id);
      expect(db.getPlan(plan1.id)).toEqual(plan1);
      expect(db.getPlan(plan2.id)).toEqual(plan2);
    });
  });

  describe('step operations', () => {
    let planId: number;

    beforeEach(() => {
      const plan = db.createPlan('/path/to/plan.md', '/path/to/workdir');
      planId = plan.id;
    });

    it('should create a step', () => {
      const step = db.createStep(planId, 1, 'Setup');

      expect(step.id).toBeGreaterThan(0);
      expect(step.planId).toBe(planId);
      expect(step.stepNumber).toBe(1);
      expect(step.title).toBe('Setup');
      expect(step.status).toBe('pending');
      expect(step.createdAt).toBeTruthy();
      expect(step.updatedAt).toBeTruthy();
    });

    it('should retrieve steps for a plan', () => {
      db.createStep(planId, 1, 'Setup');
      db.createStep(planId, 2, 'Implementation');
      db.createStep(planId, 3, 'Testing');

      const steps = db.getSteps(planId);

      expect(steps).toHaveLength(3);
      expect(steps[0].stepNumber).toBe(1);
      expect(steps[1].stepNumber).toBe(2);
      expect(steps[2].stepNumber).toBe(3);
    });

    it('should return empty array for plan with no steps', () => {
      const steps = db.getSteps(planId);
      expect(steps).toEqual([]);
    });

    it('should update step status', () => {
      const step = db.createStep(planId, 1, 'Setup');

      db.updateStepStatus(step.id, 'in_progress');
      let steps = db.getSteps(planId);
      expect(steps[0].status).toBe('in_progress');

      db.updateStepStatus(step.id, 'completed');
      steps = db.getSteps(planId);
      expect(steps[0].status).toBe('completed');

      db.updateStepStatus(step.id, 'failed');
      steps = db.getSteps(planId);
      expect(steps[0].status).toBe('failed');
    });

    it('should update updatedAt when changing status', (done) => {
      const step = db.createStep(planId, 1, 'Setup');
      const originalUpdatedAt = step.updatedAt;

      setTimeout(() => {
        db.updateStepStatus(step.id, 'in_progress');
        const steps = db.getSteps(planId);
        expect(steps[0].updatedAt).not.toBe(originalUpdatedAt);
        done();
      }, 10);
    });
  });

  describe('iteration operations', () => {
    let stepId: number;

    beforeEach(() => {
      const plan = db.createPlan('/path/to/plan.md', '/path/to/workdir');
      const step = db.createStep(plan.id, 1, 'Setup');
      stepId = step.id;
    });

    it('should create an iteration', () => {
      const iteration = db.createIteration(stepId, 1, 'implementation');

      expect(iteration.id).toBeGreaterThan(0);
      expect(iteration.stepId).toBe(stepId);
      expect(iteration.iterationNumber).toBe(1);
      expect(iteration.type).toBe('implementation');
      expect(iteration.commitSha).toBeNull();
      expect(iteration.claudeLog).toBeNull();
      expect(iteration.codexLog).toBeNull();
      expect(iteration.status).toBe('in_progress');
      expect(iteration.createdAt).toBeTruthy();
      expect(iteration.updatedAt).toBeTruthy();
    });

    it('should create multiple iterations for a step', () => {
      db.createIteration(stepId, 1, 'implementation');
      db.createIteration(stepId, 2, 'build_fix');
      db.createIteration(stepId, 3, 'review_fix');

      const iterations = db.getIterations(stepId);

      expect(iterations).toHaveLength(3);
      expect(iterations[0].type).toBe('implementation');
      expect(iterations[1].type).toBe('build_fix');
      expect(iterations[2].type).toBe('review_fix');
    });

    it('should update iteration with commit SHA', () => {
      const iteration = db.createIteration(stepId, 1, 'implementation');

      db.updateIteration(iteration.id, { commitSha: 'abc123' });

      const iterations = db.getIterations(stepId);
      expect(iterations[0].commitSha).toBe('abc123');
    });

    it('should update iteration with logs', () => {
      const iteration = db.createIteration(stepId, 1, 'implementation');

      db.updateIteration(iteration.id, {
        claudeLog: 'Claude output...',
        codexLog: 'Codex review...',
      });

      const iterations = db.getIterations(stepId);
      expect(iterations[0].claudeLog).toBe('Claude output...');
      expect(iterations[0].codexLog).toBe('Codex review...');
    });

    it('should update iteration status', () => {
      const iteration = db.createIteration(stepId, 1, 'implementation');

      db.updateIteration(iteration.id, { status: 'completed' });

      const iterations = db.getIterations(stepId);
      expect(iterations[0].status).toBe('completed');
    });

    it('should update multiple iteration fields at once', () => {
      const iteration = db.createIteration(stepId, 1, 'implementation');

      db.updateIteration(iteration.id, {
        commitSha: 'xyz789',
        claudeLog: 'Log content',
        status: 'completed',
      });

      const iterations = db.getIterations(stepId);
      expect(iterations[0].commitSha).toBe('xyz789');
      expect(iterations[0].claudeLog).toBe('Log content');
      expect(iterations[0].status).toBe('completed');
    });

    it('should return empty array for step with no iterations', () => {
      const iterations = db.getIterations(stepId);
      expect(iterations).toEqual([]);
    });
  });

  describe('issue operations', () => {
    let iterationId: number;
    let stepId: number;

    beforeEach(() => {
      const plan = db.createPlan('/path/to/plan.md', '/path/to/workdir');
      const step = db.createStep(plan.id, 1, 'Setup');
      stepId = step.id;
      const iteration = db.createIteration(step.id, 1, 'implementation');
      iterationId = iteration.id;
    });

    it('should create an issue with all fields', () => {
      const issue = db.createIssue(
        iterationId,
        'codex_review',
        'Missing error handling',
        'src/app.ts',
        42,
        'error',
        'open'
      );

      expect(issue.id).toBeGreaterThan(0);
      expect(issue.iterationId).toBe(iterationId);
      expect(issue.type).toBe('codex_review');
      expect(issue.description).toBe('Missing error handling');
      expect(issue.filePath).toBe('src/app.ts');
      expect(issue.lineNumber).toBe(42);
      expect(issue.severity).toBe('error');
      expect(issue.status).toBe('open');
      expect(issue.createdAt).toBeTruthy();
      expect(issue.resolvedAt).toBeNull();
    });

    it('should create an issue with minimal fields', () => {
      const issue = db.createIssue(
        iterationId,
        'ci_failure',
        'Build failed'
      );

      expect(issue.description).toBe('Build failed');
      expect(issue.filePath).toBeNull();
      expect(issue.lineNumber).toBeNull();
      expect(issue.severity).toBeNull();
      expect(issue.status).toBe('open');
    });

    it('should retrieve issues for an iteration', () => {
      db.createIssue(iterationId, 'codex_review', 'Issue 1', 'file1.ts', 10, 'error');
      db.createIssue(iterationId, 'codex_review', 'Issue 2', 'file2.ts', 20, 'warning');

      const issues = db.getIssues(iterationId);

      expect(issues).toHaveLength(2);
      expect(issues[0].description).toBe('Issue 1');
      expect(issues[1].description).toBe('Issue 2');
    });

    it('should update issue status', () => {
      const issue = db.createIssue(iterationId, 'codex_review', 'Test issue');

      const resolvedAt = new Date().toISOString();
      db.updateIssueStatus(issue.id, 'fixed', resolvedAt);

      const issues = db.getIssues(iterationId);
      expect(issues[0].status).toBe('fixed');
      expect(issues[0].resolvedAt).toBe(resolvedAt);
    });

    it('should get open issues for a step', () => {
      const iteration1 = db.createIteration(stepId, 1, 'implementation');
      const iteration2 = db.createIteration(stepId, 2, 'build_fix');

      db.createIssue(iteration1.id, 'codex_review', 'Open issue 1');
      db.createIssue(iteration1.id, 'codex_review', 'Fixed issue', null, null, null, 'fixed');
      const openIssue = db.createIssue(iteration2.id, 'ci_failure', 'Open issue 2');
      db.updateIssueStatus(openIssue.id, 'fixed');

      const issue3 = db.createIssue(iteration2.id, 'codex_review', 'Open issue 3');

      const openIssues = db.getOpenIssues(stepId);

      expect(openIssues).toHaveLength(2);
      expect(openIssues[0].description).toBe('Open issue 1');
      expect(openIssues[1].description).toBe('Open issue 3');
    });

    it('should return empty array when no open issues', () => {
      const issue = db.createIssue(iterationId, 'codex_review', 'Test issue');
      db.updateIssueStatus(issue.id, 'fixed');

      const openIssues = db.getOpenIssues(stepId);
      expect(openIssues).toEqual([]);
    });
  });

  describe('foreign key constraints', () => {
    it('should cascade delete steps when plan is deleted', () => {
      const plan = db.createPlan('/path/to/plan.md', '/path/to/workdir');
      const step = db.createStep(plan.id, 1, 'Setup');

      (db as any).db.prepare('DELETE FROM plans WHERE id = ?').run(plan.id);

      const steps = db.getSteps(plan.id);
      expect(steps).toEqual([]);
    });

    it('should cascade delete iterations when step is deleted', () => {
      const plan = db.createPlan('/path/to/plan.md', '/path/to/workdir');
      const step = db.createStep(plan.id, 1, 'Setup');
      const iteration = db.createIteration(step.id, 1, 'implementation');

      (db as any).db.prepare('DELETE FROM steps WHERE id = ?').run(step.id);

      const iterations = db.getIterations(step.id);
      expect(iterations).toEqual([]);
    });

    it('should cascade delete issues when iteration is deleted', () => {
      const plan = db.createPlan('/path/to/plan.md', '/path/to/workdir');
      const step = db.createStep(plan.id, 1, 'Setup');
      const iteration = db.createIteration(step.id, 1, 'implementation');
      db.createIssue(iteration.id, 'codex_review', 'Test issue');

      (db as any).db.prepare('DELETE FROM iterations WHERE id = ?').run(iteration.id);

      const issues = db.getIssues(iteration.id);
      expect(issues).toEqual([]);
    });
  });

  describe('in-memory database', () => {
    it('should support in-memory database for testing', () => {
      const memDb = new Database(':memory:', ':memory:');

      const plan = memDb.createPlan('/plan.md', '/workdir');
      const step = memDb.createStep(plan.id, 1, 'Test');

      expect(step.title).toBe('Test');

      memDb.close();
    });
  });

  describe('bulk operations', () => {
    it('should handle multiple steps with same plan', () => {
      const plan = db.createPlan('/path/to/plan.md', '/path/to/workdir');

      const steps = [];
      for (let i = 1; i <= 10; i++) {
        steps.push(db.createStep(plan.id, i, `Step ${i}`));
      }

      const retrieved = db.getSteps(plan.id);
      expect(retrieved).toHaveLength(10);
      expect(retrieved[0].stepNumber).toBe(1);
      expect(retrieved[9].stepNumber).toBe(10);
    });

    it('should handle multiple iterations with same step', () => {
      const plan = db.createPlan('/path/to/plan.md', '/path/to/workdir');
      const step = db.createStep(plan.id, 1, 'Setup');

      for (let i = 1; i <= 5; i++) {
        db.createIteration(step.id, i, 'review_fix');
      }

      const iterations = db.getIterations(step.id);
      expect(iterations).toHaveLength(5);
    });

    it('should handle multiple issues with same iteration', () => {
      const plan = db.createPlan('/path/to/plan.md', '/path/to/workdir');
      const step = db.createStep(plan.id, 1, 'Setup');
      const iteration = db.createIteration(step.id, 1, 'implementation');

      for (let i = 1; i <= 20; i++) {
        db.createIssue(iteration.id, 'codex_review', `Issue ${i}`);
      }

      const issues = db.getIssues(iteration.id);
      expect(issues).toHaveLength(20);
    });
  });
});
