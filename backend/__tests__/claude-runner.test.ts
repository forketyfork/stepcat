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
      expect(prompt).toContain('/path/to/plan.md');
      expect(prompt).toContain('MUST create a git commit');
      expect(prompt).toContain('Do NOT use git commit --amend');
    });

    it('should build fix prompt', () => {
      const buildErrors = 'TypeError: Cannot read property "foo" of undefined';
      const prompt = runner.buildFixPrompt(buildErrors);

      expect(prompt).toContain(buildErrors);
      expect(prompt).toContain('MUST create a git commit');
      expect(prompt).toContain('Do NOT use git commit --amend');
    });

    it('should build review fix prompt', () => {
      const reviewComments = JSON.stringify([
        { file: 'src/app.ts', line: 42, severity: 'error', description: 'Missing error handling' },
      ]);
      const prompt = runner.buildReviewFixPrompt(reviewComments);

      expect(prompt).toContain('src/app.ts');
      expect(prompt).toContain('Missing error handling');
      expect(prompt).toContain('MUST create a git commit');
      expect(prompt).toContain('Do NOT use git commit --amend');
    });

    it('should delegate to PROMPTS module', () => {
      const implPrompt = runner.buildImplementationPrompt(1, '/plan.md');
      const expectedImplPrompt = PROMPTS.implementation(1, '/plan.md');
      expect(implPrompt).toBe(expectedImplPrompt);

      const fixPrompt = runner.buildFixPrompt('error');
      const expectedFixPrompt = PROMPTS.buildFix('error');
      expect(fixPrompt).toBe(expectedFixPrompt);

      const reviewPrompt = runner.buildReviewFixPrompt('issues');
      const expectedReviewPrompt = PROMPTS.reviewFix('issues');
      expect(reviewPrompt).toBe(expectedReviewPrompt);
    });
  });

  describe('getClaudePath', () => {
    it('should throw error if binary not found', () => {
      const fs = require('fs');
      const originalExistsSync = fs.existsSync;

      jest.spyOn(fs, 'existsSync').mockReturnValue(false);

      const invalidRunner = new ClaudeRunner();

      expect(() => (invalidRunner as any).getClaudePath()).toThrow('Claude Code binary not found');
      expect(() => (invalidRunner as any).getClaudePath()).toThrow('npm install @anthropic-ai/claude-code');

      fs.existsSync = originalExistsSync;
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

      const fixPrompt = runner.buildFixPrompt('errors');
      expect(fixPrompt).toContain('Do NOT use git commit --amend');

      const reviewPrompt = runner.buildReviewFixPrompt('comments');
      expect(reviewPrompt).toContain('Do NOT use git commit --amend');
    });

    it('should instruct to create new commits', () => {
      const implPrompt = runner.buildImplementationPrompt(1, '/plan.md');
      expect(implPrompt.toLowerCase()).toContain('create a new commit');

      const fixPrompt = runner.buildFixPrompt('errors');
      expect(fixPrompt.toLowerCase()).toContain('create a new commit');

      const reviewPrompt = runner.buildReviewFixPrompt('comments');
      expect(reviewPrompt.toLowerCase()).toContain('create a new commit');
    });

    it('should instruct not to push', () => {
      const implPrompt = runner.buildImplementationPrompt(1, '/plan.md');
      expect(implPrompt.toLowerCase()).toContain('do not push');

      const fixPrompt = runner.buildFixPrompt('errors');
      expect(fixPrompt.toLowerCase()).toContain('do not push');

      const reviewPrompt = runner.buildReviewFixPrompt('comments');
      expect(reviewPrompt.toLowerCase()).toContain('do not push');
    });
  });
});
