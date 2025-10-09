export const PROMPTS = {
  implementation: (stepNumber: number, planContent: string) => `You are implementing Step ${stepNumber} of the following implementation plan:

---
${planContent}
---

Please implement Step ${stepNumber} following the plan exactly as described.

After implementation:
1. Run \`just build\`, \`just lint\` and \`just test\` on the project, fix issues if any
2. Commit your changes with a clear commit message
3. Push the changes to GitHub

IMPORTANT: Make sure to commit and push your changes before completing this task.

Note: The orchestrator will automatically update the plan file phase markers, so do not modify the plan file yourself.`,

  buildFix: (buildErrors: string) => `The GitHub Actions build has failed with the following errors:

---
${buildErrors}
---

Please fix these errors and amend your previous commit. Then push the amended commit to GitHub.

IMPORTANT: Use git commit --amend to fix the previous commit, then force push the changes.`,

  reviewFix: (reviewComments: string) => `A code review has identified the following possible issues:

---
${reviewComments}
---

Please review these comments and fix any legitimate issues.

IMPORTANT: If you make changes, create a new commit (do NOT amend) and push. Keep the commit history clean and logical.`,

  codexReview: (planFilePath: string) => `You are reviewing the last commit in this repository. The implementation plan is available at: ${planFilePath}

Identify the exact issues with this implementation (bugs, defects, shortcomings, useless or excessive code, tests that don't really test anything, etc.), if any, and output a numbered list of the issues with proposals on how to fix them.

Do not report on issues that are to be fixed in the next steps of the plan. Do not report on good parts of the code or that the code conforms to the implementation, output issues only.

If you see no issues, output just "No issues found"

Do not output anything else.`
};
