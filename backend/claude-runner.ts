import { spawn, execSync } from "child_process";
import { existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { PROMPTS } from "./prompts.js";

const moduleDir = (() => {
  try {
    const url = new Function("return import.meta.url")() as string;
    return dirname(fileURLToPath(url));
  } catch {
    return typeof __dirname !== "undefined" ? __dirname : process.cwd();
  }
})();

export interface ClaudeRunOptions {
  workDir: string;
  prompt: string;
  timeoutMinutes?: number;
}

export class ClaudeRunner {
  private getClaudePath(): string {
    const localBin = resolve(moduleDir, "../node_modules/.bin/claude");

    console.log(`Looking for Claude Code binary at: ${localBin}`);

    if (!existsSync(localBin)) {
      throw new Error(
        `Claude Code binary not found at ${localBin}\n` +
          "Please ensure @anthropic-ai/claude-code is installed:\n" +
          "  npm install @anthropic-ai/claude-code",
      );
    }

    return localBin;
  }

  private tryGetHeadCommit(workDir: string): string | null {
    try {
      return execSync("git rev-parse HEAD", {
        cwd: workDir,
        encoding: "utf-8",
      }).trim();
    } catch (error) {
      console.warn(
        `Warning: Could not get HEAD commit (repo may be empty or unborn): ${error}`,
      );
      return null;
    }
  }

  async run(
    options: ClaudeRunOptions,
  ): Promise<{ success: boolean; commitSha: string | null }> {
    const claudePath = this.getClaudePath();

    console.log("─".repeat(80));
    console.log(`Running Claude Code in ${options.workDir}`);
    console.log(`Binary: ${claudePath}`);
    console.log(`Timeout: ${options.timeoutMinutes || 30} minutes`);
    console.log("─".repeat(80));

    const headBefore = this.tryGetHeadCommit(options.workDir);
    console.log(`HEAD before: ${headBefore ?? "(no commit yet)"}`);
    console.log("─".repeat(80));

    const timeout = (options.timeoutMinutes ?? 30) * 60 * 1000;

    const result = await new Promise<{
      exitCode: number | null;
      error?: Error;
    }>((resolve) => {
      const child = spawn(
        claudePath,
        [
          "--print",
          "--verbose",
          "--add-dir",
          options.workDir,
          "--permission-mode",
          "acceptEdits",
        ],
        {
          cwd: options.workDir,
          // Inherit stdout/stderr to enable true realtime streaming from Claude Code
          stdio: ["pipe", "inherit", "inherit"],
        },
      );

      let timeoutId: NodeJS.Timeout | undefined;

      if (timeout > 0) {
        timeoutId = setTimeout(() => {
          child.kill("SIGTERM");
          resolve({
            exitCode: null,
            error: new Error("Claude Code execution timed out"),
          });
        }, timeout);
      }

      child.stdin.write(options.prompt);
      child.stdin.end();

      // Stdout is inherited; no need to listen and re-print here

      child.on("error", (error) => {
        if (timeoutId) clearTimeout(timeoutId);
        resolve({ exitCode: null, error });
      });

      child.on("close", (code) => {
        if (timeoutId) clearTimeout(timeoutId);
        resolve({ exitCode: code });
      });
    });

    if (result.error) {
      console.error("─".repeat(80));
      console.error("✗ Error running Claude Code");
      console.error("─".repeat(80));
      throw result.error;
    }

    if (result.exitCode !== 0) {
      console.error("─".repeat(80));
      console.error(`✗ Claude Code exited with status ${result.exitCode}`);
      console.error("─".repeat(80));
      throw new Error(`Claude Code failed with exit code ${result.exitCode}`);
    }

    const headAfter = this.tryGetHeadCommit(options.workDir);
    console.log("─".repeat(80));
    console.log(`HEAD after: ${headAfter ?? "(no commit yet)"}`);

    if (!headAfter) {
      console.log(
        "⚠ Claude Code completed but could not read HEAD commit",
      );
      console.log("─".repeat(80));
      return { success: true, commitSha: null };
    }

    if (headBefore === headAfter) {
      console.log("✓ Claude Code completed (no commit created)");
      console.log("─".repeat(80));
      return { success: true, commitSha: null };
    }

    console.log("✓ Claude Code completed successfully and created a commit");
    console.log(`Commit SHA: ${headAfter}`);
    console.log("─".repeat(80));

    return { success: true, commitSha: headAfter };
  }

  buildImplementationPrompt(stepNumber: number, planFilePath: string): string {
    return PROMPTS.implementation(stepNumber, planFilePath);
  }

  buildFixPrompt(buildErrors: string): string {
    return PROMPTS.buildFix(buildErrors);
  }

  buildReviewFixPrompt(reviewComments: string): string {
    return PROMPTS.reviewFix(reviewComments);
  }
}
