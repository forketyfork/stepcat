import { getLogger } from "./logger.js";

export interface ReviewResult {
  result: 'PASS' | 'FAIL';
  issues: Array<{
    file: string;
    line?: number;
    severity: 'error' | 'warning';
    description: string;
  }>;
}

export class ReviewParser {
  parseReviewOutput(rawOutput: string): ReviewResult {
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

    getLogger()?.warn("ReviewParser", `Failed to parse review output as JSON. Raw output (first 200 chars): ${rawOutput.substring(0, 200)}`);

    return {
      result: 'FAIL',
      issues: [{
        file: 'unknown',
        severity: 'error',
        description: `Failed to parse review output as JSON.\n\nRaw output:\n${rawOutput.substring(0, 500)}`,
      }],
    };
  }

  private tryParseJSON(text: string): ReviewResult | null {
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

  private createErrorResult(message: string): ReviewResult {
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
