import { spawn, execSync } from "child_process";
import { existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { ReviewParser, ReviewResult } from "./review-parser.js";
import { OrchestratorEventEmitter } from "./events.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const moduleDir = __dirname;

export interface CodexRunOptions {
  workDir: string;
  prompt: string;
  timeoutMinutes?: number;
  expectCommit?: boolean;
  eventEmitter?: OrchestratorEventEmitter;
}

export type CodexReviewResult = ReviewResult;

export class CodexRunner {
  private emitLog(message: string, eventEmitter?: OrchestratorEventEmitter): void {
    if (eventEmitter) {
      const lines = message.split('\n');
      for (const line of lines) {
        if (line.trim()) {
          eventEmitter.emit("event", {
            type: "log",
            timestamp: Date.now(),
            level: "info",
            message: line,
          });
        }
      }
    } else {
      console.log(message);
    }
  }

  private getCodexPath(): string {
    const localBin = resolve(moduleDir, "../node_modules/.bin/codex");

    console.log(`Looking for Codex binary at: ${localBin}`);

    if (!existsSync(localBin)) {
      throw new Error(
        `Codex binary not found at ${localBin}\n` +
          "Please ensure @openai/codex is installed:\n" +
          "  npm install @openai/codex",
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
    options: CodexRunOptions,
  ): Promise<{ success: boolean; output: string; commitSha?: string | null }> {
    const codexPath = this.getCodexPath();

    this.emitLog("─".repeat(80), options.eventEmitter);
    this.emitLog(`Running Codex in ${options.workDir}`, options.eventEmitter);
    this.emitLog(`Binary: ${codexPath}`, options.eventEmitter);
    this.emitLog(`Timeout: ${options.timeoutMinutes || 30} minutes`, options.eventEmitter);
    this.emitLog("─".repeat(80), options.eventEmitter);

    let headBefore: string | null = null;
    if (options.expectCommit) {
      headBefore = this.tryGetHeadCommit(options.workDir);
      this.emitLog(`HEAD before: ${headBefore ?? "(no commit yet)"}`, options.eventEmitter);
      this.emitLog("─".repeat(80), options.eventEmitter);
    }

    const timeout = (options.timeoutMinutes ?? 30) * 60 * 1000;

    const result = await new Promise<{
      exitCode: number | null;
      output: string;
      error?: Error;
    }>((resolve) => {
      const child = spawn(codexPath, ["exec", "--cd", options.workDir], {
        cwd: options.workDir,
        stdio: ["pipe", "pipe", "inherit"],
      });

      let stdoutData = "";
      let timeoutId: NodeJS.Timeout | undefined;

      if (timeout > 0) {
        timeoutId = setTimeout(() => {
          child.kill("SIGTERM");
          resolve({
            exitCode: null,
            output: stdoutData,
            error: new Error("Codex execution timed out"),
          });
        }, timeout);
      }

      if (!child.stdin) {
        throw new Error('Codex process did not provide stdin stream');
      }

      child.stdin.write(options.prompt);
      child.stdin.end();

      child.stdout.on("data", (chunk) => {
        const text = chunk.toString();
        stdoutData += text;
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

      child.on("error", (error) => {
        if (timeoutId) clearTimeout(timeoutId);
        resolve({ exitCode: null, output: stdoutData, error });
      });

      child.on("close", (code) => {
        if (timeoutId) clearTimeout(timeoutId);
        resolve({ exitCode: code, output: stdoutData });
      });
    });

    if (result.error) {
      this.emitLog("─".repeat(80), options.eventEmitter);
      this.emitLog("✗ Error running Codex", options.eventEmitter);
      this.emitLog("─".repeat(80), options.eventEmitter);
      throw result.error;
    }

    if (result.exitCode !== 0) {
      this.emitLog("─".repeat(80), options.eventEmitter);
      this.emitLog(`✗ Codex exited with status ${result.exitCode}`, options.eventEmitter);
      this.emitLog("─".repeat(80), options.eventEmitter);
      throw new Error(`Codex failed with exit code ${result.exitCode}`);
    }

    let commitSha: string | null | undefined = undefined;
    if (options.expectCommit) {
      const headAfter = this.tryGetHeadCommit(options.workDir);
      this.emitLog("─".repeat(80), options.eventEmitter);
      this.emitLog(`HEAD after: ${headAfter ?? "(no commit yet)"}`, options.eventEmitter);

      if (!headAfter) {
        this.emitLog(
          "⚠ Codex completed but could not read HEAD commit",
          options.eventEmitter
        );
        this.emitLog("─".repeat(80), options.eventEmitter);
        commitSha = null;
      } else if (headBefore === headAfter) {
        this.emitLog("✓ Codex completed (no commit created)", options.eventEmitter);
        this.emitLog("─".repeat(80), options.eventEmitter);
        commitSha = null;
      } else {
        this.emitLog("✓ Codex completed successfully and created a commit", options.eventEmitter);
        this.emitLog(`Commit SHA: ${headAfter}`, options.eventEmitter);
        this.emitLog("─".repeat(80), options.eventEmitter);
        commitSha = headAfter;
      }
    } else {
      this.emitLog("─".repeat(80), options.eventEmitter);
      this.emitLog("✓ Codex completed successfully", options.eventEmitter);
      this.emitLog("─".repeat(80), options.eventEmitter);
    }

    return { success: true, output: result.output, commitSha };
  }

  parseCodexOutput(rawOutput: string): CodexReviewResult {
    const parser = new ReviewParser();
    return parser.parseReviewOutput(rawOutput);
  }
}
