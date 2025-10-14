import { spawn, execSync } from "child_process";
import { existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { PROMPTS } from "./prompts.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const moduleDir = __dirname;

export interface ClaudeRunOptions {
  workDir: string;
  prompt: string;
  timeoutMinutes?: number;
  captureOutput?: boolean;
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
  ): Promise<{ success: boolean; commitSha: string | null; output?: string }> {
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

    const captureOutput = options.captureOutput ?? false;

    const result = await new Promise<{
      exitCode: number | null;
      error?: Error;
      stdout?: string;
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
          stdio: [
            "pipe",
            captureOutput ? "pipe" : "inherit",
            "inherit",
          ],
        },
      );

      let timeoutId: NodeJS.Timeout | undefined;
      let stdoutData = "";

      if (timeout > 0) {
        timeoutId = setTimeout(() => {
          child.kill("SIGTERM");
          resolve({
            exitCode: null,
            error: new Error("Claude Code execution timed out"),
          });
        }, timeout);
      }

      if (!child.stdin) {
        throw new Error('Claude Code process did not provide stdin stream');
      }

      child.stdin.write(options.prompt);
      child.stdin.end();

      if (captureOutput && child.stdout) {
        child.stdout.on("data", (chunk) => {
          const text = chunk.toString();
          stdoutData += text;
          process.stdout.write(text);
        });
      }

      child.on("error", (error) => {
        if (timeoutId) clearTimeout(timeoutId);
        resolve({ exitCode: null, error });
      });

      child.on("close", (code) => {
        if (timeoutId) clearTimeout(timeoutId);
        resolve({ exitCode: code, stdout: captureOutput ? stdoutData : undefined });
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

    const capturedOutput = captureOutput && result.stdout !== undefined
      ? result.stdout
      : undefined;

    const headAfter = this.tryGetHeadCommit(options.workDir);
    console.log("─".repeat(80));
    console.log(`HEAD after: ${headAfter ?? "(no commit yet)"}`);

    if (!headAfter) {
      console.log(
        "⚠ Claude Code completed but could not read HEAD commit",
      );
      console.log("─".repeat(80));
      return { success: true, commitSha: null, output: capturedOutput };
    }

    if (headBefore === headAfter) {
      console.log("✓ Claude Code completed (no commit created)");
      console.log("─".repeat(80));
      return { success: true, commitSha: null, output: capturedOutput };
    }

    console.log("✓ Claude Code completed successfully and created a commit");
    console.log(`Commit SHA: ${headAfter}`);
    console.log("─".repeat(80));

    const response: { success: boolean; commitSha: string | null; output?: string } = {
      success: true,
      commitSha: headAfter,
    };

    if (capturedOutput !== undefined) {
      response.output = capturedOutput;
    }

    return response;
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
