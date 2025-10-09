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
- Make sure to commit your changes before completing this task
- DO NOT push to GitHub - the orchestrator will handle pushing
- Do not modify the plan file yourself - the orchestrator will update phase markers`,

  buildFix: (
    buildErrors: string,
  ) => `The GitHub Actions build has failed with the following errors:

---
${buildErrors}
---

Please fix these errors and amend your previous commit.

IMPORTANT:
- Use git commit --amend to fix the previous commit
- DO NOT push to GitHub - the orchestrator will handle pushing
- Commit your changes by appending a clear commit message to an existing one, starting with relative file path and implementation step, e.g.:

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
- If you make changes, use git commit --amend to amend the previous commit
- There should be only one commit for this step
- DO NOT push to GitHub - the orchestrator will handle pushing
- Commit your changes by appending a clear commit message to an existing one, starting with relative file path and implementation step, e.g.:

---
Plan: docs/plans/PLAN.md
Step: 3
Stage: code review fix

<summary of your changes>
---
`,

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
};
