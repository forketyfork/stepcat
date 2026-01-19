export const PERMISSION_REQUEST_INSTRUCTIONS = `
If you are blocked by missing permissions (for example you see "requested permissions" or "PermissionDenied"):
1. STOP immediately and do not continue executing the task.
2. Output ONLY the JSON object below (no extra text or markdown).
3. Do NOT create a commit in this case.

{
  "result": "PERMISSION_REQUEST",
  "permissions_to_add": ["Read(/path/to/file)", "Bash(tool command:*)"],
  "reason": "why the permission is needed",
  "settings_local_json": {
    "permissions": {
      "allow": ["Read(/path/to/file)", "Bash(tool command:*)"]
    }
  }
}
`;

export const PROMPTS = {
  preflight: (
    planContent: string,
    claudeMdContent: string | null,
    claudeSettingsContent: string | null,
  ) => `You are performing a preflight check for an automated development workflow.

The workflow will run Claude Code autonomously to implement a multi-step plan. Claude Code will need to execute various bash commands without user approval, so we need to ensure all required permissions are pre-configured.

## Your Task

Analyze the following plan and determine what bash commands Claude Code will likely need to execute. Then check if these commands are allowed in the current .claude/ configuration.

## Plan Content
---
${planContent}
---

## Current CLAUDE.md Content
---
${claudeMdContent ?? '(No CLAUDE.md file found)'}
---

## Current .claude/settings.json Content
---
${claudeSettingsContent ?? '(No .claude/settings.json file found)'}
---

## Analysis Instructions

1. Read the plan carefully and identify ALL bash commands that will be needed during implementation, including:
   - Build commands (e.g., \`just build\`, \`zig build\`, \`npm run build\`, \`cargo build\`, \`make\`)
   - Test commands (e.g., \`just test\`, \`npm test\`, \`pytest\`, \`cargo test\`)
   - Lint commands (e.g., \`just lint\`, \`npm run lint\`, \`eslint\`)
   - Format commands (e.g., \`just fmt\`, \`prettier\`, \`cargo fmt\`)
   - Language-specific tools mentioned in the plan
   - Any other commands mentioned or implied by the plan

2. Check the current .claude/settings.json to see what's already allowed

3. Determine what additional permissions are needed

## Output Format

Respond with ONLY a JSON object in this exact format (no other text or markdown):

{
  "analysis": {
    "detected_commands": [
      {"command": "zig build", "reason": "Plan mentions Zig language implementation"},
      {"command": "just build", "reason": "Standard build command from plan"}
    ],
    "currently_allowed": ["git:*"],
    "missing_permissions": ["zig build", "just build", "just test", "just lint"]
  },
  "recommendations": {
    "settings_json": {
      "path": ".claude/settings.json",
      "content": {
        "permissions": {
          "allow": [
            "Bash(git:*)",
            "Bash(zig build:*)",
            "Bash(just:*)"
          ]
        }
      }
    },
    "explanation": "Add these permissions to allow Claude Code to run build and test commands autonomously."
  }
}

CRITICAL: Output ONLY valid JSON, no additional text, markdown formatting, or code blocks.`,


  implementation: (
    stepNumber: number,
    planFilePath: string,
  ) => `You are implementing Step ${stepNumber} of the implementation plan located at ${planFilePath}.

Please implement Step ${stepNumber} following the plan exactly as described.

Before implementation:
1. Verify that preconditions defined in the "Status Quo" section are implemented.

After implementation:
1. Run the project's build, lint, and test commands to verify your changes work correctly
   - Check CLAUDE.md, justfile, Makefile, package.json, or similar for the appropriate commands
   - Fix any issues before proceeding
2. Create a git commit for your changes with a clear commit message, e.g.:

---
Plan: docs/plans/PLAN.md
Step: ${stepNumber}
Stage: implementation

<summary of your changes>
---

CRITICAL REQUIREMENTS:
- You MUST create a git commit for your changes - this is not optional
- Do NOT ask for approval or confirmation - just create the commit
- Do NOT use git commit --amend - create a NEW commit
- Do NOT push to remote - the orchestrator will handle pushing
- Do not modify the plan file yourself - the orchestrator will update phase markers
- Creating a commit is a required part of completing this task
${PERMISSION_REQUEST_INSTRUCTIONS}`,

  buildFix: (
    stepNumber: number,
    buildErrors: string,
  ) => `The GitHub Actions build has failed with the following errors:

---
${buildErrors}
---

Please analyze and fix these errors, then create a git commit with a clear message, e.g.:

---
Plan: docs/plans/PLAN.md
Step: ${stepNumber}
Stage: build fix

<summary of your changes>
---

CRITICAL REQUIREMENTS:
- You MUST create a git commit - this is not optional
- If the errors are already fixed or were flaky (no changes needed), create an EMPTY commit:
  git commit --allow-empty -m "No changes needed: <brief explanation>"
- Do NOT ask for approval or confirmation - just create the commit
- Do NOT use git commit --amend - create a NEW commit
- Do NOT push to remote - the orchestrator will handle pushing
- Creating a commit is a required part of completing this task
${PERMISSION_REQUEST_INSTRUCTIONS}
`,
  reviewFix: (
    stepNumber: number,
    reviewComments: string,
  ) => `A code review has identified the following possible issues:

---
${reviewComments}
---

Please review these comments carefully. For each issue:
1. If it's a legitimate issue, fix it
2. If it's a false positive (the code is already correct), note why

After your analysis, create a git commit with a clear message, e.g.:

---
Plan: docs/plans/PLAN.md
Step: ${stepNumber}
Stage: code review fix

<summary of your changes or explanation of why issues are false positives>
---

CRITICAL REQUIREMENTS:
- You MUST create a git commit - this is not optional
- If all issues are false positives and no changes are needed, create an EMPTY commit:
  git commit --allow-empty -m "No changes needed: <brief explanation>"
- Do NOT ask for approval or confirmation - just create the commit
- Do NOT use git commit --amend - create a NEW commit
- Do NOT push to remote - the orchestrator will handle pushing
- Creating a commit is a required part of completing this task
${PERMISSION_REQUEST_INSTRUCTIONS}
`,

  codexReviewImplementation: (
    stepNumber: number,
    stepTitle: string,
    planContent: string,
    commitSha: string,
  ) => `This is the initial implementation of Step ${stepNumber}: ${stepTitle} from the following plan:

---
${planContent}
---

Review commit ${commitSha} for code quality, correctness, and adherence to the plan.
Use \`git show ${commitSha}\` to see the exact changes in this commit.

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
    commitSha: string,
  ) => `This commit attempts to fix the following build failures:

---
${buildErrors}
---

Review commit ${commitSha} to verify it properly addresses the build issues.
Use \`git show ${commitSha}\` to see the exact changes in this commit.

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
    commitSha: string,
  ) => `This commit attempts to fix the following code review issues from the previous iteration:

---
${JSON.stringify(issues, null, 2)}
---

Review commit ${commitSha} to verify it properly addresses these concerns.
Use \`git show ${commitSha}\` to see the exact changes in this commit.

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
