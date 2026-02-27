import { spawn, execSync } from "child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";

import type { OrchestratorEventEmitter } from "./events.js";
import type { LogLevel } from "./logger.js";
import { getLogger } from "./logger.js";
import { ReviewParser } from "./review-parser.js";
import type { ReviewResult } from "./review-parser.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const moduleDir = __dirname;

export interface CodexRunOptions {
  workDir: string;
  prompt: string;
  timeoutMinutes?: number;
  expectCommit?: boolean;
  outputMode?: "default" | "review_json";
  eventEmitter?: OrchestratorEventEmitter;
}

export type CodexReviewResult = ReviewResult;

type OutputCapture = {
  tempDir: string;
  lastMessagePath: string;
  outputSchemaPath: string;
};

const REVIEW_OUTPUT_SCHEMA = {
  type: "object",
  required: ["result", "issues"],
  additionalProperties: false,
  properties: {
    result: {
      type: "string",
      enum: ["PASS", "FAIL"],
    },
    issues: {
      type: "array",
      items: {
        type: "object",
        required: ["file", "line", "severity", "description"],
        additionalProperties: false,
        properties: {
          file: { type: "string" },
          line: {
            type: ["number", "null"],
          },
          severity: {
            type: "string",
            enum: ["error", "warning"],
          },
          description: { type: "string" },
        },
      },
    },
  },
} as const;

export class CodexRunner {
  private createOutputCapture(
    outputMode: CodexRunOptions["outputMode"],
  ): OutputCapture | null {
    if (outputMode !== "review_json") {
      return null;
    }

    const tempDir = mkdtempSync(join(tmpdir(), "stepcat-codex-"));
    const lastMessagePath = join(tempDir, "last-message.txt");
    const outputSchemaPath = join(tempDir, "review-output-schema.json");

    writeFileSync(outputSchemaPath, JSON.stringify(REVIEW_OUTPUT_SCHEMA), "utf-8");

    return {
      tempDir,
      lastMessagePath,
      outputSchemaPath,
    };
  }

  private readCapturedLastMessage(
    capture: OutputCapture | null,
  ): string | null {
    if (!capture) {
      return null;
    }

    if (!existsSync(capture.lastMessagePath)) {
      return null;
    }

    const content = readFileSync(capture.lastMessagePath, "utf-8").trim();
    return content.length > 0 ? content : null;
  }

  private cleanupOutputCapture(capture: OutputCapture | null): void {
    if (!capture) {
      return;
    }

    try {
      rmSync(capture.tempDir, { recursive: true, force: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      getLogger()?.warn(
        "CodexRunner",
        `Failed to remove temporary Codex output directory ${capture.tempDir}: ${message}`,
      );
    }
  }

  private emitLog(
    message: string,
    eventEmitter?: OrchestratorEventEmitter,
    level: "info" | "warn" | "error" | "success" = "info",
  ): void {
    const lines = message.split(/\r?\n/);
    const logLevel: LogLevel = level === "success" ? "info" : level;

    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }

      getLogger()?.log(logLevel, "CodexRunner", line);

      if (eventEmitter) {
        eventEmitter.emit("event", {
          type: "log",
          timestamp: Date.now(),
          level,
          message: line,
        });
      } else {
        const stream = level === "error" || level === "warn"
          ? process.stderr
          : process.stdout;
        stream.write(`${line}\n`);
      }
    }
  }

  private getCodexPath(eventEmitter?: OrchestratorEventEmitter): string {
    const localBin = resolve(moduleDir, "../node_modules/.bin/codex");

    this.emitLog(`Looking for Codex binary at: ${localBin}`, eventEmitter);

    if (!existsSync(localBin)) {
      throw new Error(
        `Codex binary not found at ${localBin}\n` +
          "Please ensure @openai/codex is installed:\n" +
          "  npm install @openai/codex",
      );
    }

    return localBin;
  }

  private tryGetHeadCommit(
    workDir: string,
    eventEmitter?: OrchestratorEventEmitter,
  ): string | null {
    try {
      return execSync("git rev-parse HEAD", {
        cwd: workDir,
        encoding: "utf-8",
      }).trim();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emitLog(
        `Warning: Could not get HEAD commit (repo may be empty or unborn): ${message}`,
        eventEmitter,
        "warn",
      );
      return null;
    }
  }

  async run(
    options: CodexRunOptions,
  ): Promise<{ success: boolean; output: string; parsedOutput?: string; commitSha?: string | null }> {
    const codexPath = this.getCodexPath(options.eventEmitter);
    const capture = this.createOutputCapture(options.outputMode);

    try {
      this.emitLog("─".repeat(80), options.eventEmitter);
      this.emitLog(`Running Codex in ${options.workDir}`, options.eventEmitter);
      this.emitLog(`Binary: ${codexPath}`, options.eventEmitter);
      this.emitLog(`Timeout: ${options.timeoutMinutes ?? 30} minutes`, options.eventEmitter);
      this.emitLog("─".repeat(80), options.eventEmitter);

      let headBefore: string | null = null;
      if (options.expectCommit) {
        headBefore = this.tryGetHeadCommit(options.workDir, options.eventEmitter);
        this.emitLog(`HEAD before: ${headBefore ?? "(no commit yet)"}`, options.eventEmitter);
        this.emitLog("─".repeat(80), options.eventEmitter);
      }

      const timeout = (options.timeoutMinutes ?? 30) * 60 * 1000;

      const result = await new Promise<{
        exitCode: number | null;
        stdout: string;
        stderr: string;
        error?: Error;
      }>((resolve) => {
        const spawnArgs = ["exec", "--cd", options.workDir];
        if (capture) {
          spawnArgs.push("--output-last-message", capture.lastMessagePath);
          spawnArgs.push("--output-schema", capture.outputSchemaPath);
        }

        const child = spawn(codexPath, spawnArgs, {
          cwd: options.workDir,
          stdio: ["pipe", "pipe", "pipe"],
        });

        let stdoutData = "";
        let stderrData = "";
        let timeoutId: NodeJS.Timeout | undefined;

        if (timeout > 0) {
          timeoutId = setTimeout(() => {
            child.kill("SIGTERM");
            resolve({
              exitCode: null,
              stdout: stdoutData,
              stderr: stderrData,
              error: new Error("Codex execution timed out"),
            });
          }, timeout);
        }

        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- defensive check for clearer error message
        if (!child.stdin) {
          throw new Error("Codex process did not provide stdin stream");
        }

        child.stdin.write(options.prompt);
        child.stdin.end();

        child.stdout.on("data", (chunk: Buffer) => {
          const text = chunk.toString();
          stdoutData += text;
          if (options.eventEmitter) {
            this.emitLog(text, options.eventEmitter);
          } else {
            process.stdout.write(text);
          }
        });

        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- stderr is always defined with stdio: pipe, but optional chain is safer
        child.stderr?.on("data", (chunk: Buffer) => {
          const text = chunk.toString();
          stderrData += text;
          if (options.eventEmitter) {
            this.emitLog(text, options.eventEmitter, "warn");
          } else {
            process.stderr.write(text);
          }
        });

        child.on("error", (error) => {
          if (timeoutId) clearTimeout(timeoutId);
          resolve({ exitCode: null, stdout: stdoutData, stderr: stderrData, error });
        });

        child.on("close", (code) => {
          if (timeoutId) clearTimeout(timeoutId);
          resolve({ exitCode: code, stdout: stdoutData, stderr: stderrData });
        });
      });

      const combinedOutput = [
        result.stdout,
        result.stderr ? `\n--- stderr ---\n${result.stderr}` : "",
      ].join("");

      if (result.error) {
        this.emitLog("─".repeat(80), options.eventEmitter);
        this.emitLog("✗ Error running Codex", options.eventEmitter);
        this.emitLog("─".repeat(80), options.eventEmitter);
        const errorWithOutput = new Error(
          `${result.error.message}\n\n--- Codex output ---\n${combinedOutput || "(no output)"}`,
        );
        errorWithOutput.stack = result.error.stack;
        throw errorWithOutput;
      }

      if (result.exitCode !== 0) {
        this.emitLog("─".repeat(80), options.eventEmitter);
        this.emitLog(`✗ Codex exited with status ${result.exitCode}`, options.eventEmitter);
        this.emitLog("─".repeat(80), options.eventEmitter);
        throw new Error(
          `Codex failed with exit code ${result.exitCode}\n\n--- Codex output ---\n${combinedOutput || "(no output)"}`,
        );
      }

      const parsedOutput = this.readCapturedLastMessage(capture) ?? undefined;

      let commitSha: string | null | undefined = undefined;
      if (options.expectCommit) {
        const headAfter = this.tryGetHeadCommit(options.workDir, options.eventEmitter);
        this.emitLog("─".repeat(80), options.eventEmitter);
        this.emitLog(`HEAD after: ${headAfter ?? "(no commit yet)"}`, options.eventEmitter);

        if (!headAfter) {
          this.emitLog(
            "⚠ Codex completed but could not read HEAD commit",
            options.eventEmitter,
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

      return { success: true, output: result.stdout, parsedOutput, commitSha };
    } finally {
      this.cleanupOutputCapture(capture);
    }
  }

  parseCodexOutput(rawOutput: string): CodexReviewResult {
    const parser = new ReviewParser();
    return parser.parseReviewOutput(rawOutput);
  }
}
