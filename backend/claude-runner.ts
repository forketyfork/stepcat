import { spawn, execSync } from "child_process";
import { existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { PROMPTS } from "./prompts.js";
import { OrchestratorEventEmitter } from "./events.js";

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

export class ClaudeRunner {
  private emitLog(message: string, eventEmitter?: OrchestratorEventEmitter): void {
    if (eventEmitter) {
      eventEmitter.emit("event", {
        type: "log",
        timestamp: Date.now(),
        level: "info",
        message,
      });
    } else {
      console.log(message);
    }
  }

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

    this.emitLog("─".repeat(80), options.eventEmitter);
    this.emitLog(`Running Claude Code in ${options.workDir}`, options.eventEmitter);
    this.emitLog(`Binary: ${claudePath}`, options.eventEmitter);
    this.emitLog(`Timeout: ${options.timeoutMinutes || 30} minutes`, options.eventEmitter);
    this.emitLog("─".repeat(80), options.eventEmitter);

    const headBefore = this.tryGetHeadCommit(options.workDir);
    this.emitLog(`HEAD before: ${headBefore ?? "(no commit yet)"}`, options.eventEmitter);
    this.emitLog("─".repeat(80), options.eventEmitter);

    const timeout = (options.timeoutMinutes ?? 30) * 60 * 1000;

    const captureOutput = options.captureOutput ?? false;
    const shouldPipeStdout = captureOutput || !!options.eventEmitter;

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
            shouldPipeStdout ? "pipe" : "inherit",
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

      if (shouldPipeStdout && child.stdout) {
        child.stdout.on("data", (chunk) => {
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
      this.emitLog(
        "⚠ Claude Code completed but could not read HEAD commit",
        options.eventEmitter
      );
      this.emitLog("─".repeat(80), options.eventEmitter);
      return { success: true, commitSha: null, output: capturedOutput };
    }

    if (headBefore === headAfter) {
      this.emitLog("✓ Claude Code completed (no commit created)", options.eventEmitter);
      this.emitLog("─".repeat(80), options.eventEmitter);
      return { success: true, commitSha: null, output: capturedOutput };
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

  buildFixPrompt(buildErrors: string): string {
    return PROMPTS.buildFix(buildErrors);
  }

  buildReviewFixPrompt(reviewComments: string): string {
    return PROMPTS.reviewFix(reviewComments);
  }
}
