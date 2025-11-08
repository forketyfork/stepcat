import { vi } from "vitest";
import { ClaudeRunner } from '../claude-runner.js';
import { PROMPTS } from '../prompts.js';

describe('ClaudeRunner', () => {
  let runner: ClaudeRunner;

  beforeEach(() => {
    runner = new ClaudeRunner();
  });

  describe('prompt builders', () => {
    it('should build implementation prompt', () => {
      const prompt = runner.buildImplementationPrompt(1, '/path/to/plan.md');

      expect(prompt).toContain('Step 1');
      expect(prompt).toContain('Step: 1');
      expect(prompt).toContain('/path/to/plan.md');
      expect(prompt).toContain('MUST create a git commit');
      expect(prompt).toContain('Do NOT use git commit --amend');
    });

    it('should build fix prompt', () => {
      const buildErrors = 'TypeError: Cannot read property "foo" of undefined';
      const prompt = runner.buildFixPrompt(2, buildErrors);

      expect(prompt).toContain(buildErrors);
      expect(prompt).toContain('Step: 2');
      expect(prompt).toContain('MUST create a git commit');
      expect(prompt).toContain('Do NOT use git commit --amend');
    });

    it('should build review fix prompt', () => {
      const reviewComments = JSON.stringify([
        { file: 'src/app.ts', line: 42, severity: 'error', description: 'Missing error handling' },
      ]);
      const prompt = runner.buildReviewFixPrompt(3, reviewComments);

      expect(prompt).toContain('src/app.ts');
      expect(prompt).toContain('Missing error handling');
      expect(prompt).toContain('Step: 3');
      expect(prompt).toContain('MUST create a git commit');
      expect(prompt).toContain('Do NOT use git commit --amend');
    });

    it('should delegate to PROMPTS module', () => {
      const implPrompt = runner.buildImplementationPrompt(1, '/plan.md');
      const expectedImplPrompt = PROMPTS.implementation(1, '/plan.md');
      expect(implPrompt).toBe(expectedImplPrompt);

      const fixPrompt = runner.buildFixPrompt(2, 'error');
      const expectedFixPrompt = PROMPTS.buildFix(2, 'error');
      expect(fixPrompt).toBe(expectedFixPrompt);

      const reviewPrompt = runner.buildReviewFixPrompt(3, 'issues');
      const expectedReviewPrompt = PROMPTS.reviewFix(3, 'issues');
      expect(reviewPrompt).toBe(expectedReviewPrompt);
    });
  });

  describe('tryGetHeadCommit', () => {
    it('should return null when git command fails', () => {
      const result = (runner as any).tryGetHeadCommit('/nonexistent/directory');
      expect(result).toBeNull();
    });
  });

  describe('prompt instructions', () => {
    it('should explicitly warn against git commit --amend in all prompts', () => {
      const implPrompt = runner.buildImplementationPrompt(1, '/plan.md');
      expect(implPrompt).toContain('Do NOT use git commit --amend');

      const fixPrompt = runner.buildFixPrompt(2, 'errors');
      expect(fixPrompt).toContain('Do NOT use git commit --amend');

      const reviewPrompt = runner.buildReviewFixPrompt(3, 'comments');
      expect(reviewPrompt).toContain('Do NOT use git commit --amend');
    });

    it('should instruct to create new commits', () => {
      const implPrompt = runner.buildImplementationPrompt(1, '/plan.md');
      expect(implPrompt.toLowerCase()).toContain('create a new commit');

      const fixPrompt = runner.buildFixPrompt(2, 'errors');
      expect(fixPrompt.toLowerCase()).toContain('create a new commit');

      const reviewPrompt = runner.buildReviewFixPrompt(3, 'comments');
      expect(reviewPrompt.toLowerCase()).toContain('create a new commit');
    });

    it('should instruct not to push', () => {
      const implPrompt = runner.buildImplementationPrompt(1, '/plan.md');
      expect(implPrompt.toLowerCase()).toContain('do not push');

      const fixPrompt = runner.buildFixPrompt(2, 'errors');
      expect(fixPrompt.toLowerCase()).toContain('do not push');

      const reviewPrompt = runner.buildReviewFixPrompt(3, 'comments');
      expect(reviewPrompt.toLowerCase()).toContain('do not push');
    });
  });
});
