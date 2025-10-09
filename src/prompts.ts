export const PROMPTS = {
  implementation: (stepNumber: number, planContent: string) => `You are implementing Step ${stepNumber} of the following implementation plan:

---
${planContent}
---

Please implement Step ${stepNumber} following the plan exactly as described.

After implementation:
1. Run \`just build\`, \`just lint\` and \`just test\` on the project, fix issues if any
2. Commit your changes with a clear commit message

IMPORTANT:
- Make sure to commit your changes before completing this task
- DO NOT push to GitHub - the orchestrator will handle pushing
- Do not modify the plan file yourself - the orchestrator will update phase markers`,

  buildFix: (buildErrors: string) => `The GitHub Actions build has failed with the following errors:

---
${buildErrors}
---

Please fix these errors and amend your previous commit.

IMPORTANT:
- Use git commit --amend to fix the previous commit
- DO NOT push to GitHub - the orchestrator will handle pushing`,

  reviewFix: (reviewComments: string) => `A code review has identified the following possible issues:

---
${reviewComments}
---

Please review these comments and fix any legitimate issues.

IMPORTANT:
- If you make changes, use git commit --amend to amend the previous commit
- There should be only one commit for this step
- DO NOT push to GitHub - the orchestrator will handle pushing`,

  codexReview: (planFilePath: string) => `You are reviewing the last commit in this repository. The implementation plan is available at: ${planFilePath}

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
No issues found`
};
