import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

function reviewHasIssues(reviewOutput: string): boolean {
  const structuredMarkerPass = /\[STEPCAT_REVIEW_RESULT:\s*PASS\s*\]/i;
  const structuredMarkerFail = /\[STEPCAT_REVIEW_RESULT:\s*FAIL\s*\]/i;

  if (structuredMarkerPass.test(reviewOutput)) {
    return false;
  }
  if (structuredMarkerFail.test(reviewOutput)) {
    return true;
  }

  const normalized = reviewOutput
    .toLowerCase()
    .replace(/[.,;:!?]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const noIssuesPatterns = [
    /^no issues found$/,
    /^no issues$/,
    /^no issues? (?:were? )?(?:found|detected|identified)$/,
    /^(?:i found )?no issues?$/,
    /^there (?:are|were) no issues?$/
  ];

  const hasNoIssues = noIssuesPatterns.some(pattern => pattern.test(normalized));

  return !hasNoIssues;
}

describe('Review Detection Logic', () => {
  describe('reviewHasIssues', () => {
    it('should detect structured PASS marker', () => {
      const output = '[STEPCAT_REVIEW_RESULT: PASS]\nNo issues found';
      expect(reviewHasIssues(output)).toBe(false);
    });

    it('should detect structured PASS marker (case insensitive)', () => {
      const output = '[stepcat_review_result: pass]\nNo issues found';
      expect(reviewHasIssues(output)).toBe(false);
    });

    it('should detect structured PASS marker with extra whitespace', () => {
      const output = '[STEPCAT_REVIEW_RESULT:   PASS  ]\nNo issues found';
      expect(reviewHasIssues(output)).toBe(false);
    });

    it('should detect structured FAIL marker', () => {
      const output = '[STEPCAT_REVIEW_RESULT: FAIL]\n1. Missing error handling';
      expect(reviewHasIssues(output)).toBe(true);
    });

    it('should detect structured FAIL marker (case insensitive)', () => {
      const output = '[stepcat_review_result: fail]\n1. Issue found';
      expect(reviewHasIssues(output)).toBe(true);
    });

    it('should handle "no issues found" without punctuation', () => {
      const output = 'no issues found';
      expect(reviewHasIssues(output)).toBe(false);
    });

    it('should handle "no issues found" with period', () => {
      const output = 'No issues found.';
      expect(reviewHasIssues(output)).toBe(false);
    });

    it('should handle "no issues found" with exclamation', () => {
      const output = 'No issues found!';
      expect(reviewHasIssues(output)).toBe(false);
    });

    it('should handle "No issues"', () => {
      const output = 'No issues';
      expect(reviewHasIssues(output)).toBe(false);
    });

    it('should handle "No issue found"', () => {
      const output = 'No issue found';
      expect(reviewHasIssues(output)).toBe(false);
    });

    it('should handle "No issues were found"', () => {
      const output = 'No issues were found.';
      expect(reviewHasIssues(output)).toBe(false);
    });

    it('should handle "No issues detected"', () => {
      const output = 'No issues detected';
      expect(reviewHasIssues(output)).toBe(false);
    });

    it('should handle "No issues identified"', () => {
      const output = 'No issues identified.';
      expect(reviewHasIssues(output)).toBe(false);
    });

    it('should handle "There are no issues"', () => {
      const output = 'There are no issues';
      expect(reviewHasIssues(output)).toBe(false);
    });

    it('should handle "I found no issues"', () => {
      const output = 'I found no issues';
      expect(reviewHasIssues(output)).toBe(false);
    });

    it('should handle extra whitespace', () => {
      const output = '  No   issues   found  ';
      expect(reviewHasIssues(output)).toBe(false);
    });

    it('should detect issues when output contains issue list', () => {
      const output = '1. Missing error handling in function X\n2. Test Y does not cover edge cases';
      expect(reviewHasIssues(output)).toBe(true);
    });

    it('should detect issues when output contains text about problems', () => {
      const output = 'Found several issues with the implementation';
      expect(reviewHasIssues(output)).toBe(true);
    });

    it('should give priority to structured marker over legacy text', () => {
      const output = '[STEPCAT_REVIEW_RESULT: PASS]\nSome text mentioning issues but review passed';
      expect(reviewHasIssues(output)).toBe(false);
    });

    it('should handle multiline output with PASS marker', () => {
      const output = `[STEPCAT_REVIEW_RESULT: PASS]

All checks completed successfully.
No issues found with the implementation.`;
      expect(reviewHasIssues(output)).toBe(false);
    });

    it('should handle multiline output with FAIL marker', () => {
      const output = `[STEPCAT_REVIEW_RESULT: FAIL]

Found the following issues:
1. Missing error handling
2. Inadequate test coverage`;
      expect(reviewHasIssues(output)).toBe(true);
    });
  });
});
