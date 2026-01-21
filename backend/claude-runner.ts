import { spawn, execSync } from "child_process";
import { existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

import type { OrchestratorEventEmitter } from "./events.js";
import { getLogger } from "./logger.js";
import { PROMPTS } from "./prompts.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const moduleDir = __dirname;

export interface ClaudeRunOptions {
  workDir: string;
  prompt: string;
  timeoutMinutes?: number;
  captureOutput?: boolean;
  eventEmitter?: OrchestratorEventEmitter;
}

interface ContinueOptions {
  workDir: string;
  prompt: string;
  timeoutMinutes?: number;
  captureOutput?: boolean;
  eventEmitter?: OrchestratorEventEmitter;
}

export class ClaudeRunner {
  private emitLog(message: string, eventEmitter?: OrchestratorEventEmitter): void {
    const lines = message.split('\n');
    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }

      getLogger()?.info("ClaudeRunner", line);

      if (eventEmitter) {
        eventEmitter.emit("event", {
          type: "log",
          timestamp: Date.now(),
          level: "info",
          message: line,
        });
      } else {
        process.stdout.write(`${line}\n`);
      }
    }
  }

  private getClaudePath(): string {
    const localBin = resolve(moduleDir, "../node_modules/.bin/claude");

    getLogger()?.debug("ClaudeRunner", `Looking for Claude Code binary at: ${localBin}`);

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
      getLogger()?.warn("ClaudeRunner", `Could not get HEAD commit (repo may be empty or unborn): ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  private getWorkingTreeStatus(
    workDir: string,
    eventEmitter?: OrchestratorEventEmitter,
  ): string | null {
    try {
      const status = execSync("git status --short", {
        cwd: workDir,
        encoding: "utf-8",
      }).trim();
      return status.length > 0 ? status : "";
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emitLog(
        `Warning: Could not read working tree status: ${message}`,
        eventEmitter,
      );
      return null;
    }
  }

  private async runWithContinue(
    options: ContinueOptions,
  ): Promise<{
    success: boolean;
    output?: string;
  }> {
    const claudePath = this.getClaudePath();
    const timeout = (options.timeoutMinutes ?? 5) * 60 * 1000;
    const captureOutput = options.captureOutput ?? false;

    this.emitLog("─".repeat(80), options.eventEmitter);
    this.emitLog("Retrying with --continue to complete the commit...", options.eventEmitter);
    this.emitLog("─".repeat(80), options.eventEmitter);

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
          "--continue",
          "--add-dir",
          options.workDir,
          "--permission-mode",
          "acceptEdits",
          "--allowedTools",
          "Bash(git:*)",
        ],
        {
          cwd: options.workDir,
          stdio: ["pipe", "pipe", "pipe"],
        },
      );

      let timeoutId: NodeJS.Timeout | undefined;
      let stdoutData = "";

      if (timeout > 0) {
        timeoutId = setTimeout(() => {
          child.kill("SIGTERM");
          resolve({
            exitCode: null,
            error: new Error("Claude Code --continue execution timed out"),
          });
        }, timeout);
      }

      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- defensive check for clearer error message
      if (!child.stdin) {
        throw new Error('Claude Code process did not provide stdin stream');
      }

      child.stdin.write(options.prompt);
      child.stdin.end();

      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- defensive guard for stream access
      if (child.stdout) {
        child.stdout.on("data", (chunk: Buffer) => {
          const text = chunk.toString();
          if (captureOutput) {
            stdoutData += text;
          }
          if (options.eventEmitter) {
            const lines = text.split('\n');
            for (const line of lines) {
              if (line.trim()) {
                this.emitLog(line, options.eventEmitter);
              }
            }
          } else {
            process.stdout.write(text);
          }
        });
      }

      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- defensive guard for stream access
      if (child.stderr) {
        child.stderr.on("data", (chunk: Buffer) => {
          const text = chunk.toString();
          if (options.eventEmitter) {
            const lines = text.split('\n');
            for (const line of lines) {
              if (line.trim()) {
                this.emitLog(line, options.eventEmitter);
              }
            }
          } else {
            process.stderr.write(text);
          }
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
      this.emitLog("─".repeat(80), options.eventEmitter);
      this.emitLog("✗ Error running Claude Code --continue", options.eventEmitter);
      this.emitLog("─".repeat(80), options.eventEmitter);
      return { success: false, output: result.stdout };
    }

    if (result.exitCode !== 0) {
      this.emitLog("─".repeat(80), options.eventEmitter);
      this.emitLog(`✗ Claude Code --continue exited with status ${result.exitCode}`, options.eventEmitter);
      this.emitLog("─".repeat(80), options.eventEmitter);
      return { success: false, output: result.stdout };
    }

    this.emitLog("─".repeat(80), options.eventEmitter);
    this.emitLog("✓ Claude Code --continue completed", options.eventEmitter);
    this.emitLog("─".repeat(80), options.eventEmitter);

    return {
      success: true,
      output: captureOutput ? result.stdout : undefined,
    };
  }

  async run(
    options: ClaudeRunOptions,
  ): Promise<{
    success: boolean;
    commitSha: string | null;
    output?: string;
    workingTreeStatus?: string | null;
  }> {
    const claudePath = this.getClaudePath();

    this.emitLog("─".repeat(80), options.eventEmitter);
    this.emitLog(`Running Claude Code in ${options.workDir}`, options.eventEmitter);
    this.emitLog(`Binary: ${claudePath}`, options.eventEmitter);
    this.emitLog(`Timeout: ${options.timeoutMinutes ?? 30} minutes`, options.eventEmitter);
    this.emitLog("─".repeat(80), options.eventEmitter);

    const headBefore = this.tryGetHeadCommit(options.workDir);
    this.emitLog(`HEAD before: ${headBefore ?? "(no commit yet)"}`, options.eventEmitter);
    this.emitLog("─".repeat(80), options.eventEmitter);

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
          "--allowedTools",
          "Bash(git:*)",
        ],
        {
          cwd: options.workDir,
          stdio: ["pipe", "pipe", "pipe"],
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

      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- defensive check for clearer error message
      if (!child.stdin) {
        throw new Error('Claude Code process did not provide stdin stream');
      }

      child.stdin.write(options.prompt);
      child.stdin.end();

      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- defensive guard for stream access
      if (child.stdout) {
        child.stdout.on("data", (chunk: Buffer) => {
          const text = chunk.toString();
          if (captureOutput) {
            stdoutData += text;
          }
          if (options.eventEmitter) {
            const lines = text.split('\n');
            for (const line of lines) {
              if (line.trim()) {
                this.emitLog(line, options.eventEmitter);
              }
            }
          } else {
            process.stdout.write(text);
          }
        });
      }

      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- defensive guard for stream access
      if (child.stderr) {
        child.stderr.on("data", (chunk: Buffer) => {
          const text = chunk.toString();
          if (options.eventEmitter) {
            const lines = text.split('\n');
            for (const line of lines) {
              if (line.trim()) {
                this.emitLog(line, options.eventEmitter);
              }
            }
          } else {
            process.stderr.write(text);
          }
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
      this.emitLog("─".repeat(80), options.eventEmitter);
      this.emitLog("✗ Error running Claude Code", options.eventEmitter);
      this.emitLog("─".repeat(80), options.eventEmitter);
      throw result.error;
    }

    if (result.exitCode !== 0) {
      this.emitLog("─".repeat(80), options.eventEmitter);
      this.emitLog(`✗ Claude Code exited with status ${result.exitCode}`, options.eventEmitter);
      this.emitLog("─".repeat(80), options.eventEmitter);
      throw new Error(`Claude Code failed with exit code ${result.exitCode}`);
    }

    const capturedOutput = captureOutput && result.stdout !== undefined
      ? result.stdout
      : undefined;

    const headAfter = this.tryGetHeadCommit(options.workDir);
    this.emitLog("─".repeat(80), options.eventEmitter);
    this.emitLog(`HEAD after: ${headAfter ?? "(no commit yet)"}`, options.eventEmitter);

    if (!headAfter) {
      const workingTreeStatus = this.getWorkingTreeStatus(
        options.workDir,
        options.eventEmitter,
      );
      if (workingTreeStatus !== null) {
        if (workingTreeStatus) {
          this.emitLog(
            "Working tree contains uncommitted changes after Claude Code run:",
            options.eventEmitter,
          );
          this.emitLog(workingTreeStatus, options.eventEmitter);
        } else {
          this.emitLog(
            "Working tree clean after Claude Code run",
            options.eventEmitter,
          );
        }
      }
      this.emitLog(
        "⚠ Claude Code completed but could not read HEAD commit",
        options.eventEmitter
      );
      this.emitLog("─".repeat(80), options.eventEmitter);
      return {
        success: true,
        commitSha: null,
        output: capturedOutput,
        workingTreeStatus,
      };
    }

    if (headBefore === headAfter) {
      const workingTreeStatus = this.getWorkingTreeStatus(
        options.workDir,
        options.eventEmitter,
      );
      if (workingTreeStatus !== null) {
        if (workingTreeStatus) {
          this.emitLog(
            "Working tree contains uncommitted changes after Claude Code run:",
            options.eventEmitter,
          );
          this.emitLog(workingTreeStatus, options.eventEmitter);

          // Retry with --continue to let Claude finish creating the commit
          const continuePrompt =
            "Your previous session made changes but did not create a commit. " +
            "Please stage all your changes with `git add` and create a commit using `git commit`. " +
            "Do NOT use `git commit --amend`. Create a NEW commit.";

          const continueResult = await this.runWithContinue({
            workDir: options.workDir,
            prompt: continuePrompt,
            timeoutMinutes: 5,
            captureOutput: options.captureOutput,
            eventEmitter: options.eventEmitter,
          });

          const headAfterRetry = this.tryGetHeadCommit(options.workDir);
          this.emitLog(`HEAD after retry: ${headAfterRetry ?? "(no commit yet)"}`, options.eventEmitter);

          if (headAfterRetry && headAfterRetry !== headBefore) {
            this.emitLog("✓ Claude Code created a commit after retry", options.eventEmitter);
            this.emitLog(`Commit SHA: ${headAfterRetry}`, options.eventEmitter);
            this.emitLog("─".repeat(80), options.eventEmitter);

            const combinedOutput = [capturedOutput, continueResult.output]
              .filter(Boolean)
              .join("\n\n--- Continue session ---\n\n");

            return {
              success: true,
              commitSha: headAfterRetry,
              output: combinedOutput || undefined,
            };
          }

          // Retry didn't create a commit either
          const workingTreeAfterRetry = this.getWorkingTreeStatus(
            options.workDir,
            options.eventEmitter,
          );
          this.emitLog("✓ Claude Code completed (no commit created after retry)", options.eventEmitter);
          this.emitLog("─".repeat(80), options.eventEmitter);

          const combinedOutput = [capturedOutput, continueResult.output]
            .filter(Boolean)
            .join("\n\n--- Continue session ---\n\n");

          return {
            success: true,
            commitSha: null,
            output: combinedOutput || undefined,
            workingTreeStatus: workingTreeAfterRetry,
          };
        } else {
          this.emitLog(
            "Working tree clean after Claude Code run",
            options.eventEmitter,
          );
        }
      }
      this.emitLog("✓ Claude Code completed (no commit created)", options.eventEmitter);
      this.emitLog("─".repeat(80), options.eventEmitter);
      return {
        success: true,
        commitSha: null,
        output: capturedOutput,
        workingTreeStatus,
      };
    }

    this.emitLog("✓ Claude Code completed successfully and created a commit", options.eventEmitter);
    this.emitLog(`Commit SHA: ${headAfter}`, options.eventEmitter);
    this.emitLog("─".repeat(80), options.eventEmitter);

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

  buildFixPrompt(stepNumber: number, buildErrors: string): string {
    return PROMPTS.buildFix(stepNumber, buildErrors);
  }

  buildReviewFixPrompt(stepNumber: number, reviewComments: string): string {
    return PROMPTS.reviewFix(stepNumber, reviewComments);
  }

  async runContinue(
    options: ClaudeRunOptions,
  ): Promise<{
    success: boolean;
    commitSha: string | null;
    output?: string;
  }> {
    const claudePath = this.getClaudePath();

    this.emitLog("─".repeat(80), options.eventEmitter);
    this.emitLog(`Resuming Claude Code session in ${options.workDir}`, options.eventEmitter);
    this.emitLog(`Binary: ${claudePath}`, options.eventEmitter);
    this.emitLog("─".repeat(80), options.eventEmitter);

    const headBefore = this.tryGetHeadCommit(options.workDir);
    this.emitLog(`HEAD before: ${headBefore ?? "(no commit yet)"}`, options.eventEmitter);
    this.emitLog("─".repeat(80), options.eventEmitter);

    const result = await this.runWithContinue({
      workDir: options.workDir,
      prompt: options.prompt,
      timeoutMinutes: options.timeoutMinutes,
      captureOutput: options.captureOutput,
      eventEmitter: options.eventEmitter,
    });

    if (!result.success) {
      return {
        success: false,
        commitSha: null,
        output: result.output,
      };
    }

    const headAfter = this.tryGetHeadCommit(options.workDir);
    this.emitLog(`HEAD after: ${headAfter ?? "(no commit yet)"}`, options.eventEmitter);

    if (headAfter && headAfter !== headBefore) {
      this.emitLog("✓ Claude Code --continue created a commit", options.eventEmitter);
      this.emitLog(`Commit SHA: ${headAfter}`, options.eventEmitter);
      this.emitLog("─".repeat(80), options.eventEmitter);
      return {
        success: true,
        commitSha: headAfter,
        output: result.output,
      };
    }

    this.emitLog("✓ Claude Code --continue completed (no commit created)", options.eventEmitter);
    this.emitLog("─".repeat(80), options.eventEmitter);
    return {
      success: true,
      commitSha: null,
      output: result.output,
    };
  }
}
