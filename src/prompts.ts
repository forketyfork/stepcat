export const PROMPTS = {
  implementation: (
    stepNumber: number,
    planFilePath: string,
  ) => `You are implementing Step ${stepNumber} of the implementation plan located at ${planFilePath}.

Please implement Step ${stepNumber} following the plan exactly as described.

Before implementation:
1. Verify that preconditions defined in the "Status Quo" section are implemented.

After implementation:
1. Run \`just build\`, \`just lint\` and \`just test\` on the project, fix issues if any
2. Commit your changes with a clear commit message starting with relative file path and implementation step, e.g.:

---
Plan: docs/plans/PLAN.md
Step: 3
Stage: implementation

<summary of your changes>
---

IMPORTANT:
- Create a new commit for your changes. Do NOT use git commit --amend. Do NOT push to remote (the orchestrator will handle pushing)
- Make sure to commit your changes before completing this task
- Do not modify the plan file yourself - the orchestrator will update phase markers`,

  buildFix: (
    buildErrors: string,
  ) => `The GitHub Actions build has failed with the following errors:

---
${buildErrors}
---

Please fix these errors.

IMPORTANT:
- Create a new commit for your changes. Do NOT use git commit --amend. Do NOT push to remote (the orchestrator will handle pushing)
- Commit your changes with a clear commit message starting with relative file path and implementation step, e.g.:

---
Plan: docs/plans/PLAN.md
Step: 3
Stage: build fix

<summary of your changes>
---

`,
  reviewFix: (
    reviewComments: string,
  ) => `A code review has identified the following possible issues:

---
${reviewComments}
---

Please review these comments and fix any legitimate issues.

IMPORTANT:
- Create a new commit for your changes. Do NOT use git commit --amend. Do NOT push to remote (the orchestrator will handle pushing)
- Commit your changes with a clear commit message starting with relative file path and implementation step, e.g.:

---
Plan: docs/plans/PLAN.md
Step: 3
Stage: code review fix

<summary of your changes>
---
`,

  // @deprecated Use codexReviewImplementation, codexReviewBuildFix, or codexReviewCodeFixes instead
  codexReview: (
    stepNumber: number,
    planFilePath: string,
  ) => `Please review the last commit in this repository implementing Step ${stepNumber} of the plan ${planFilePath}

Identify the exact issues with this implementation (bugs, defects, shortcomings, useless or excessive code, tests that don't really test anything, etc.), if any, and output a numbered list of the issues with proposals on how to fix them.

Do not report on issues that are to be fixed in the next steps of the plan. Do not report on good parts of the code or that the code conforms to the implementation, output issues only.

IMPORTANT OUTPUT FORMAT:
- If you found issues, start your response with exactly: [STEPCAT_REVIEW_RESULT: FAIL]
- If you see no issues, start your response with exactly: [STEPCAT_REVIEW_RESULT: PASS]
- Follow the marker with your detailed findings (or "No issues found" if passing)

Example with issues:
[STEPCAT_REVIEW_RESULT: FAIL]
1. Missing error handling in function X...
2. Test Y doesn't validate edge cases...

Example without issues:
[STEPCAT_REVIEW_RESULT: PASS]
No issues found`,

  codexReviewImplementation: (
    stepNumber: number,
    stepTitle: string,
    planContent: string,
  ) => `This is the initial implementation of Step ${stepNumber}: ${stepTitle} from the following plan:

---
${planContent}
---

Review the last commit for code quality, correctness, and adherence to the plan.

Respond with a JSON object in the following format:
{
  "result": "PASS" or "FAIL",
  "issues": [
    {
      "file": "path/to/file",
      "line": 123,
      "severity": "error" or "warning",
      "description": "detailed description of the issue"
    }
  ]
}

If there are no issues, return:
{
  "result": "PASS",
  "issues": []
}

IMPORTANT:
- Output ONLY valid JSON, no additional text or markdown formatting
- The "line" field is optional and can be omitted if not applicable
- Use "error" severity for critical issues, "warning" for suggestions
- Be specific and actionable in issue descriptions`,

  codexReviewBuildFix: (
    buildErrors: string,
  ) => `This commit attempts to fix the following build failures:

---
${buildErrors}
---

Review the last commit to verify it properly addresses the build issues.

Respond with a JSON object in the following format:
{
  "result": "PASS" or "FAIL",
  "issues": [
    {
      "file": "path/to/file",
      "line": 123,
      "severity": "error" or "warning",
      "description": "detailed description of the issue"
    }
  ]
}

If there are no issues, return:
{
  "result": "PASS",
  "issues": []
}

IMPORTANT:
- Output ONLY valid JSON, no additional text or markdown formatting
- The "line" field is optional and can be omitted if not applicable
- Use "error" severity for critical issues, "warning" for suggestions
- Be specific and actionable in issue descriptions
- Focus on whether the build errors were properly fixed`,

  codexReviewCodeFixes: (
    issues: Array<{
      file: string;
      line?: number;
      severity: string;
      description: string;
    }>,
  ) => `This commit attempts to fix the following code review issues from the previous iteration:

---
${JSON.stringify(issues, null, 2)}
---

Review the last commit to verify it properly addresses these concerns.

Respond with a JSON object in the following format:
{
  "result": "PASS" or "FAIL",
  "issues": [
    {
      "file": "path/to/file",
      "line": 123,
      "severity": "error" or "warning",
      "description": "detailed description of the issue"
    }
  ]
}

If there are no issues, return:
{
  "result": "PASS",
  "issues": []
}

IMPORTANT:
- Output ONLY valid JSON, no additional text or markdown formatting
- The "line" field is optional and can be omitted if not applicable
- Use "error" severity for critical issues, "warning" for suggestions
- Be specific and actionable in issue descriptions
- Focus on whether the previous issues were properly addressed`,
};
