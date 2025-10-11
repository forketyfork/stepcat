import { spawn } from "child_process";
import { existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface CodexRunOptions {
  workDir: string;
  prompt: string;
  timeoutMinutes?: number;
}

export interface CodexReviewResult {
  result: 'PASS' | 'FAIL';
  issues: Array<{
    file: string;
    line?: number;
    severity: 'error' | 'warning';
    description: string;
  }>;
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

  parseCodexOutput(rawOutput: string): CodexReviewResult {
    const trimmedOutput = rawOutput.trim();

    const fencedMatch = trimmedOutput.match(/```(?:json|jsonc)?\s*\n([\s\S]*?)\n?```/i);
    if (fencedMatch) {
      const jsonText = fencedMatch[1].trim();
      const result = this.tryParseJSON(jsonText);
      if (result) return result;
    }

    const unfencedResult = this.tryParseJSON(trimmedOutput);
    if (unfencedResult) return unfencedResult;

    const extractedJSON = this.extractJSONFromText(trimmedOutput);
    if (extractedJSON) {
      const result = this.tryParseJSON(extractedJSON);
      if (result) return result;
    }

    console.warn('Failed to parse Codex output as JSON');

    return {
      result: 'FAIL',
      issues: [{
        file: 'unknown',
        severity: 'error',
        description: `Failed to parse Codex output as JSON.\n\nRaw output:\n${rawOutput.substring(0, 500)}`,
      }],
    };
  }

  private tryParseJSON(text: string): CodexReviewResult | null {
    try {
      const parsed = JSON.parse(text);

      if (typeof parsed !== 'object' || parsed === null) {
        return this.createErrorResult('Parsed JSON is not an object');
      }

      if (!parsed.result || (parsed.result !== 'PASS' && parsed.result !== 'FAIL')) {
        return this.createErrorResult('Invalid or missing "result" field (must be PASS or FAIL)');
      }

      if (!Array.isArray(parsed.issues)) {
        return this.createErrorResult('Invalid or missing "issues" field (must be an array)');
      }

      const issues = parsed.issues.map((issue: unknown, index: number) => {
        if (typeof issue !== 'object' || issue === null) {
          throw new Error(`Issue at index ${index} is not an object`);
        }

        const issueObj = issue as Record<string, unknown>;

        if (typeof issueObj.file !== 'string') {
          throw new Error(`Issue at index ${index} missing "file" field`);
        }
        if (typeof issueObj.description !== 'string') {
          throw new Error(`Issue at index ${index} missing "description" field`);
        }
        if (issueObj.severity && issueObj.severity !== 'error' && issueObj.severity !== 'warning') {
          throw new Error(`Issue at index ${index} has invalid "severity" (must be error or warning)`);
        }

        return {
          file: issueObj.file,
          line: typeof issueObj.line === 'number' ? issueObj.line : undefined,
          severity: (issueObj.severity as 'error' | 'warning') || 'error',
          description: issueObj.description,
        };
      });

      return {
        result: parsed.result as 'PASS' | 'FAIL',
        issues,
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes('Issue at index')) {
        return this.createErrorResult(error.message);
      }
      return null;
    }
  }

  private createErrorResult(message: string): CodexReviewResult {
    return {
      result: 'FAIL',
      issues: [{
        file: 'unknown',
        severity: 'error',
        description: message,
      }],
    };
  }

  private extractJSONFromText(text: string): string | null {
    const firstBrace = text.indexOf('{');
    if (firstBrace === -1) return null;

    let braceCount = 0;
    let inString = false;
    let escapeNext = false;

    for (let i = firstBrace; i < text.length; i++) {
      const char = text[i];

      if (escapeNext) {
        escapeNext = false;
        continue;
      }

      if (char === '\\') {
        escapeNext = true;
        continue;
      }

      if (char === '"') {
        inString = !inString;
        continue;
      }

      if (inString) continue;

      if (char === '{') {
        braceCount++;
      } else if (char === '}') {
        braceCount--;
        if (braceCount === 0) {
          return text.substring(firstBrace, i + 1);
        }
      }
    }

    return null;
  }
}
