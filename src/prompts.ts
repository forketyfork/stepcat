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
2. Create a git commit for your changes with a clear commit message, e.g.:

---
Plan: docs/plans/PLAN.md
Step: 3
Stage: implementation

<summary of your changes>
---

CRITICAL REQUIREMENTS:
- You MUST create a git commit for your changes - this is not optional
- Do NOT ask for approval or confirmation - just create the commit
- Do NOT use git commit --amend - create a NEW commit
- Do NOT push to remote - the orchestrator will handle pushing
- Do not modify the plan file yourself - the orchestrator will update phase markers
- Creating a commit is a required part of completing this task`,

  buildFix: (
    buildErrors: string,
  ) => `The GitHub Actions build has failed with the following errors:

---
${buildErrors}
---

Please fix these errors, then create a git commit for your changes with a clear commit message, e.g.:

---
Plan: docs/plans/PLAN.md
Step: 3
Stage: build fix

<summary of your changes>
---

CRITICAL REQUIREMENTS:
- You MUST create a git commit for your changes - this is not optional
- Do NOT ask for approval or confirmation - just create the commit
- Do NOT use git commit --amend - create a NEW commit
- Do NOT push to remote - the orchestrator will handle pushing
- Creating a commit is a required part of completing this task
`,
  reviewFix: (
    reviewComments: string,
  ) => `A code review has identified the following possible issues:

---
${reviewComments}
---

Please review these comments and fix any legitimate issues, then create a git commit for your changes with a clear commit message, e.g.:

---
Plan: docs/plans/PLAN.md
Step: 3
Stage: code review fix

<summary of your changes>
---

CRITICAL REQUIREMENTS:
- You MUST create a git commit for your changes - this is not optional
- Do NOT ask for approval or confirmation - just create the commit
- Do NOT use git commit --amend - create a NEW commit
- Do NOT push to remote - the orchestrator will handle pushing
- Creating a commit is a required part of completing this task
`,

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
