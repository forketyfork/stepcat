import { spawn } from "child_process";
import { existsSync } from "fs";
import { resolve } from "path";
import { PROMPTS } from "./prompts";

export interface CodexRunOptions {
  workDir: string;
  prompt: string;
  timeoutMinutes?: number;
}

export class CodexRunner {
  private getCodexPath(): string {
    const localBin = resolve(__dirname, "../node_modules/.bin/codex");

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

  async run(
    options: CodexRunOptions,
  ): Promise<{ success: boolean; output: string }> {
    const codexPath = this.getCodexPath();

    console.log("─".repeat(80));
    console.log(`Running Codex in ${options.workDir}`);
    console.log(`Binary: ${codexPath}`);
    console.log(`Timeout: ${options.timeoutMinutes || 30} minutes`);
    console.log("─".repeat(80));

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

    console.log("─".repeat(80));
    console.log("✓ Codex completed successfully");
    console.log("─".repeat(80));

    return { success: true, output: result.output };
  }

  buildReviewPrompt(stepNumber: number, planFilePath: string): string {
    return PROMPTS.codexReview(stepNumber, planFilePath);
  }
}
