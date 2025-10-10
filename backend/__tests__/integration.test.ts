import { Database } from '../database';
import { StepParser } from '../step-parser';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('Database and StepParser Integration Tests', () => {
  let tempDir: string;
  let planFile: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'integration-test-'));

    const planContent = `# Test Plan

## Step 1: Initialize Database

Create the database schema and initialize tables.

## Step 2: Add Features

Implement new features with proper error handling.
`;
    planFile = join(tempDir, 'plan.md');
    writeFileSync(planFile, planContent, 'utf-8');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('plan parsing and database storage', () => {
    it('should parse plan, create database, and store steps', () => {
      const parser = new StepParser(planFile);
      const steps = parser.parseSteps();

      expect(steps).toHaveLength(2);
      expect(steps[0].number).toBe(1);
      expect(steps[0].title).toBe('Initialize Database');
      expect(steps[1].number).toBe(2);
      expect(steps[1].title).toBe('Add Features');

      const db = new Database(tempDir);
      const plan = db.createPlan(planFile, tempDir, 'test-owner', 'test-repo');

      expect(plan.id).toBeGreaterThan(0);

      for (const step of steps) {
        db.createStep(plan.id, step.number, step.title);
      }

      const dbSteps = db.getSteps(plan.id);
      expect(dbSteps).toHaveLength(2);
      expect(dbSteps[0].title).toBe('Initialize Database');
      expect(dbSteps[1].title).toBe('Add Features');

      db.close();
    });

    it('should track iteration lifecycle', () => {
      const parser = new StepParser(planFile);
      const steps = parser.parseSteps();

      const db = new Database(tempDir);
      const plan = db.createPlan(planFile, tempDir, 'test-owner', 'test-repo');
      const step = db.createStep(plan.id, steps[0].number, steps[0].title);

      const iteration = db.createIteration(step.id, 1, 'implementation');
      expect(iteration.status).toBe('in_progress');
      expect(iteration.commitSha).toBeNull();

      db.updateIteration(iteration.id, {
        commitSha: 'abc123',
        claudeLog: 'Claude completed successfully',
        status: 'completed',
      });

      const iterations = db.getIterations(step.id);
      expect(iterations[0].status).toBe('completed');
      expect(iterations[0].commitSha).toBe('abc123');

      db.close();
    });

    it('should track issues across iterations', () => {
      const db = new Database(tempDir);
      const plan = db.createPlan(planFile, tempDir, 'test-owner', 'test-repo');
      const step = db.createStep(plan.id, 1, 'Test Step');

      const iteration1 = db.createIteration(step.id, 1, 'implementation');
      db.updateIteration(iteration1.id, { commitSha: 'abc123', status: 'completed' });

      const iteration2 = db.createIteration(step.id, 2, 'review_fix');

      const issue1 = db.createIssue(
        iteration2.id,
        'codex_review',
        'Missing error handling',
        'src/app.ts',
        42,
        'error',
        'open'
      );

      const issue2 = db.createIssue(
        iteration2.id,
        'codex_review',
        'Incorrect type annotation',
        'src/types.ts',
        10,
        'warning',
        'open'
      );

      const openIssues = db.getOpenIssues(step.id);
      expect(openIssues).toHaveLength(2);

      db.updateIssueStatus(issue1.id, 'fixed', new Date().toISOString());

      const remainingIssues = db.getOpenIssues(step.id);
      expect(remainingIssues).toHaveLength(1);
      expect(remainingIssues[0].id).toBe(issue2.id);

      db.close();
    });

    it('should support resume functionality', () => {
      const parser = new StepParser(planFile);
      const steps = parser.parseSteps();

      const db = new Database(tempDir);
      const plan = db.createPlan(planFile, tempDir, 'test-owner', 'test-repo');

      for (const step of steps) {
        db.createStep(plan.id, step.number, step.title);
      }

      const dbSteps = db.getSteps(plan.id);
      db.updateStepStatus(dbSteps[0].id, 'completed');

      db.close();

      const db2 = new Database(tempDir);
      const resumedPlan = db2.getPlan(plan.id);

      expect(resumedPlan).toBeDefined();
      expect(resumedPlan!.id).toBe(plan.id);

      const resumedSteps = db2.getSteps(plan.id);
      expect(resumedSteps[0].status).toBe('completed');
      expect(resumedSteps[1].status).toBe('pending');

      db2.close();
    });

    it('should handle multiple iterations per step', () => {
      const db = new Database(tempDir);
      const plan = db.createPlan(planFile, tempDir, 'test-owner', 'test-repo');
      const step = db.createStep(plan.id, 1, 'Complex Step');

      db.createIteration(step.id, 1, 'implementation');
      db.createIteration(step.id, 2, 'build_fix');
      db.createIteration(step.id, 3, 'review_fix');
      db.createIteration(step.id, 4, 'review_fix');

      const iterations = db.getIterations(step.id);
      expect(iterations).toHaveLength(4);
      expect(iterations[0].type).toBe('implementation');
      expect(iterations[1].type).toBe('build_fix');
      expect(iterations[2].type).toBe('review_fix');
      expect(iterations[3].type).toBe('review_fix');

      db.close();
    });

    it('should maintain referential integrity', () => {
      const db = new Database(tempDir);
      const plan = db.createPlan(planFile, tempDir, 'test-owner', 'test-repo');
      const step = db.createStep(plan.id, 1, 'Test Step');
      const iteration = db.createIteration(step.id, 1, 'implementation');
      const issue = db.createIssue(iteration.id, 'codex_review', 'Test issue');

      expect(issue.iterationId).toBe(iteration.id);

      const issues = db.getIssues(iteration.id);
      expect(issues[0].id).toBe(issue.id);

      db.close();
    });
  });

  describe('error scenarios', () => {
    it('should handle step status transitions', () => {
      const db = new Database(tempDir);
      const plan = db.createPlan(planFile, tempDir, 'test-owner', 'test-repo');
      const step = db.createStep(plan.id, 1, 'Test Step');

      expect(step.status).toBe('pending');

      db.updateStepStatus(step.id, 'in_progress');
      let steps = db.getSteps(plan.id);
      expect(steps[0].status).toBe('in_progress');

      db.updateStepStatus(step.id, 'completed');
      steps = db.getSteps(plan.id);
      expect(steps[0].status).toBe('completed');

      db.close();
    });

    it('should handle failed step status', () => {
      const db = new Database(tempDir);
      const plan = db.createPlan(planFile, tempDir, 'test-owner', 'test-repo');
      const step = db.createStep(plan.id, 1, 'Test Step');

      db.updateStepStatus(step.id, 'in_progress');
      db.updateStepStatus(step.id, 'failed');

      const steps = db.getSteps(plan.id);
      expect(steps[0].status).toBe('failed');

      db.close();
    });
  });

  describe('state persistence', () => {
    it('should persist all data to disk', () => {
      const db = new Database(tempDir);
      const plan = db.createPlan(planFile, tempDir, 'test-owner', 'test-repo');
      const step = db.createStep(plan.id, 1, 'Test Step');
      const iteration = db.createIteration(step.id, 1, 'implementation');
      db.updateIteration(iteration.id, { commitSha: 'xyz789', status: 'completed' });
      db.close();

      const db2 = new Database(tempDir);
      const retrievedPlan = db2.getPlan(plan.id);
      const retrievedSteps = db2.getSteps(plan.id);
      const retrievedIterations = db2.getIterations(step.id);

      expect(retrievedPlan!.id).toBe(plan.id);
      expect(retrievedSteps[0].id).toBe(step.id);
      expect(retrievedIterations[0].commitSha).toBe('xyz789');
      expect(retrievedIterations[0].status).toBe('completed');

      db2.close();
    });
  });

  describe('complex scenarios', () => {
    it('should handle multiple steps with varying statuses', () => {
      const parser = new StepParser(planFile);
      const steps = parser.parseSteps();

      const db = new Database(tempDir);
      const plan = db.createPlan(planFile, tempDir, 'test-owner', 'test-repo');

      const dbStep1 = db.createStep(plan.id, steps[0].number, steps[0].title);
      const dbStep2 = db.createStep(plan.id, steps[1].number, steps[1].title);

      db.updateStepStatus(dbStep1.id, 'completed');
      db.updateStepStatus(dbStep2.id, 'in_progress');

      const allSteps = db.getSteps(plan.id);
      expect(allSteps[0].status).toBe('completed');
      expect(allSteps[1].status).toBe('in_progress');

      db.close();
    });

    it('should track multiple issue types', () => {
      const db = new Database(tempDir);
      const plan = db.createPlan(planFile, tempDir, 'test-owner', 'test-repo');
      const step = db.createStep(plan.id, 1, 'Test Step');
      const iteration = db.createIteration(step.id, 1, 'implementation');

      db.createIssue(iteration.id, 'ci_failure', 'Build failed');
      db.createIssue(iteration.id, 'codex_review', 'Code quality issue');

      const issues = db.getIssues(iteration.id);
      expect(issues).toHaveLength(2);
      expect(issues[0].type).toBe('ci_failure');
      expect(issues[1].type).toBe('codex_review');

      db.close();
    });
  });
});
