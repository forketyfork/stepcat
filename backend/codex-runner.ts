import { spawn, execSync } from "child_process";
import { existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { ReviewParser, ReviewResult } from "./review-parser.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const moduleDir = __dirname;

export interface CodexRunOptions {
  workDir: string;
  prompt: string;
  timeoutMinutes?: number;
  expectCommit?: boolean;
}

export type CodexReviewResult = ReviewResult;

export class CodexRunner {
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

    console.log("─".repeat(80));
    console.log(`Running Codex in ${options.workDir}`);
    console.log(`Binary: ${codexPath}`);
    console.log(`Timeout: ${options.timeoutMinutes || 30} minutes`);
    console.log("─".repeat(80));

    let headBefore: string | null = null;
    if (options.expectCommit) {
      headBefore = this.tryGetHeadCommit(options.workDir);
      console.log(`HEAD before: ${headBefore ?? "(no commit yet)"}`);
      console.log("─".repeat(80));
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
        process.stdout.write(text);
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
      console.error("─".repeat(80));
      console.error("✗ Error running Codex");
      console.error("─".repeat(80));
      throw result.error;
    }

    if (result.exitCode !== 0) {
      console.error("─".repeat(80));
      console.error(`✗ Codex exited with status ${result.exitCode}`);
      console.error("─".repeat(80));
      throw new Error(`Codex failed with exit code ${result.exitCode}`);
    }

    let commitSha: string | null | undefined = undefined;
    if (options.expectCommit) {
      const headAfter = this.tryGetHeadCommit(options.workDir);
      console.log("─".repeat(80));
      console.log(`HEAD after: ${headAfter ?? "(no commit yet)"}`);

      if (!headAfter) {
        console.log(
          "⚠ Codex completed but could not read HEAD commit",
        );
        console.log("─".repeat(80));
        commitSha = null;
      } else if (headBefore === headAfter) {
        console.log("✓ Codex completed (no commit created)");
        console.log("─".repeat(80));
        commitSha = null;
      } else {
        console.log("✓ Codex completed successfully and created a commit");
        console.log(`Commit SHA: ${headAfter}`);
        console.log("─".repeat(80));
        commitSha = headAfter;
      }
    } else {
      console.log("─".repeat(80));
      console.log("✓ Codex completed successfully");
      console.log("─".repeat(80));
    }

    return { success: true, output: result.output, commitSha };
  }

  parseCodexOutput(rawOutput: string): CodexReviewResult {
    const parser = new ReviewParser();
    return parser.parseReviewOutput(rawOutput);
  }
}
