import { EventEmitter } from 'events';
import * as fs from 'fs';
import { join } from 'path';

import { vi, type MockInstance } from 'vitest';

import { CodexRunner } from '../codex-runner.js';

const { mockExistsSync } = vi.hoisted(() => ({
  mockExistsSync: vi.fn<typeof fs.existsSync>(),
}));

vi.mock('child_process', async () => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports -- Required for vi.importActual typing
  const actual = await vi.importActual<typeof import('child_process')>('child_process');
  return {
    ...actual,
    spawn: vi.fn(),
    execSync: vi.fn(),
  };
});

vi.mock('fs', async () => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports -- Required for vi.importActual typing
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: mockExistsSync,
  };
});

function createMockChildProcess(
  exitCode: number,
  stdout: string,
): EventEmitter & { stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> }; stdout: EventEmitter; stderr: EventEmitter } {
  const child = new EventEmitter() as EventEmitter & {
    stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
    stdout: EventEmitter;
    stderr: EventEmitter;
  };
  child.stdin = { write: vi.fn(), end: vi.fn() };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();

  process.nextTick(() => {
    child.stdout.emit('data', Buffer.from(stdout));
    child.emit('close', exitCode);
  });

  return child;
}

describe('CodexRunner', () => {
  let runner: CodexRunner;

  beforeEach(async () => {
    vi.restoreAllMocks();
    // eslint-disable-next-line @typescript-eslint/consistent-type-imports -- Required for vi.importActual typing
    const { existsSync: realExistsSync } = await vi.importActual<typeof import('fs')>('fs');
    mockExistsSync.mockImplementation(realExistsSync);
    runner = new CodexRunner();
  });

  describe('parseCodexOutput', () => {
    describe('valid JSON parsing', () => {
      it('should parse plain JSON with PASS result', () => {
        const output = JSON.stringify({
          result: 'PASS',
          issues: [],
        });

        const result = runner.parseCodexOutput(output);

        expect(result.result).toBe('PASS');
        expect(result.issues).toEqual([]);
      });

      it('should parse plain JSON with FAIL result and issues', () => {
        const output = JSON.stringify({
          result: 'FAIL',
          issues: [
            {
              file: 'src/example.ts',
              line: 42,
              severity: 'error',
              description: 'Invalid type annotation',
            },
          ],
        });

        const result = runner.parseCodexOutput(output);

        expect(result.result).toBe('FAIL');
        expect(result.issues).toHaveLength(1);
        expect(result.issues[0]).toEqual({
          file: 'src/example.ts',
          line: 42,
          severity: 'error',
          description: 'Invalid type annotation',
        });
      });

      it('should parse JSON with optional line and default severity', () => {
        const output = JSON.stringify({
          result: 'FAIL',
          issues: [
            {
              file: 'src/test.ts',
              description: 'Missing documentation',
            },
          ],
        });

        const result = runner.parseCodexOutput(output);

        expect(result.result).toBe('FAIL');
        expect(result.issues[0].line).toBeUndefined();
        expect(result.issues[0].severity).toBe('error');
      });
    });

    describe('fenced code blocks', () => {
      it('should extract JSON from ```json fenced block', () => {
        const output = `Here is the review result:
\`\`\`json
{
  "result": "PASS",
  "issues": []
}
\`\`\`
All checks passed.`;

        const result = runner.parseCodexOutput(output);

        expect(result.result).toBe('PASS');
        expect(result.issues).toEqual([]);
      });

      it('should extract JSON from ``` fenced block without language', () => {
        const output = `Review complete:
\`\`\`
{
  "result": "FAIL",
  "issues": [{"file": "test.ts", "severity": "warning", "description": "Consider refactoring"}]
}
\`\`\``;

        const result = runner.parseCodexOutput(output);

        expect(result.result).toBe('FAIL');
        expect(result.issues).toHaveLength(1);
      });

      it('should handle uppercase JSON language identifier', () => {
        const output = `\`\`\`JSON
{
  "result": "PASS",
  "issues": []
}
\`\`\``;

        const result = runner.parseCodexOutput(output);

        expect(result.result).toBe('PASS');
        expect(result.issues).toEqual([]);
      });

      it('should handle jsonc language identifier', () => {
        const output = `\`\`\`jsonc
{
  "result": "PASS",
  "issues": []
}
\`\`\``;

        const result = runner.parseCodexOutput(output);

        expect(result.result).toBe('PASS');
        expect(result.issues).toEqual([]);
      });

      it('should handle code block without newline before closing backticks', () => {
        const output = `\`\`\`json
{"result": "PASS", "issues": []}\`\`\``;

        const result = runner.parseCodexOutput(output);

        expect(result.result).toBe('PASS');
        expect(result.issues).toEqual([]);
      });

      it('should handle JSON with trailing text after code block', () => {
        const output = `\`\`\`json
{
  "result": "FAIL",
  "issues": [{"file": "app.ts", "severity": "error", "description": "Syntax error"}]
}
\`\`\`
Additional notes: please review carefully.`;

        const result = runner.parseCodexOutput(output);

        expect(result.result).toBe('FAIL');
        expect(result.issues).toHaveLength(1);
      });

      it('should prefer first valid JSON code block when multiple exist', () => {
        const output = `\`\`\`json
{
  "result": "PASS",
  "issues": []
}
\`\`\`
Some text here.
\`\`\`json
{
  "result": "FAIL",
  "issues": [{"file": "bad.ts", "severity": "error", "description": "Error"}]
}
\`\`\``;

        const result = runner.parseCodexOutput(output);

        expect(result.result).toBe('PASS');
        expect(result.issues).toEqual([]);
      });
    });

    describe('unfenced JSON extraction', () => {
      it('should extract JSON object from surrounding text', () => {
        const output = `The review is complete. Here are the results: {"result": "PASS", "issues": []} as you can see everything looks good.`;

        const result = runner.parseCodexOutput(output);

        expect(result.result).toBe('PASS');
        expect(result.issues).toEqual([]);
      });

      it('should extract complex JSON from text', () => {
        const output = `Analysis complete. Result: {"result": "FAIL", "issues": [{"file": "main.ts", "line": 10, "severity": "warning", "description": "Potential issue"}]} - please review.`;

        const result = runner.parseCodexOutput(output);

        expect(result.result).toBe('FAIL');
        expect(result.issues).toHaveLength(1);
        expect(result.issues[0].file).toBe('main.ts');
      });

      it('should handle JSON with nested objects', () => {
        const output = `Here is the data: {"result": "FAIL", "issues": [{"file": "config.ts", "severity": "error", "description": "Invalid config", "metadata": {"key": "value"}}]} done.`;

        const result = runner.parseCodexOutput(output);

        expect(result.result).toBe('FAIL');
        expect(result.issues).toHaveLength(1);
      });
    });

    describe('malformed JSON fallback', () => {
      it('should return FAIL with diagnostic for unparseable JSON', () => {
        const output = `{invalid json here`;

        const result = runner.parseCodexOutput(output);

        expect(result.result).toBe('FAIL');
        expect(result.issues).toHaveLength(1);
        expect(result.issues[0].file).toBe('unknown');
        expect(result.issues[0].severity).toBe('error');
        expect(result.issues[0].description).toContain('Failed to parse review output');
      });

      it('should include raw output snippet in diagnostic', () => {
        const output = `This is not JSON at all`;

        const result = runner.parseCodexOutput(output);

        expect(result.result).toBe('FAIL');
        expect(result.issues[0].description).toContain('Raw output:');
        expect(result.issues[0].description).toContain('This is not JSON at all');
      });

      it('should truncate long output in diagnostic', () => {
        const output = 'x'.repeat(1000);

        const result = runner.parseCodexOutput(output);

        expect(result.issues[0].description.length).toBeLessThan(600);
      });
    });

    describe('invalid JSON structure', () => {
      it('should reject JSON without result field', () => {
        const output = JSON.stringify({
          issues: [],
        });

        const result = runner.parseCodexOutput(output);

        expect(result.result).toBe('FAIL');
        expect(result.issues[0].description).toContain('Invalid or missing "result" field');
      });

      it('should reject JSON with invalid result value', () => {
        const output = JSON.stringify({
          result: 'MAYBE',
          issues: [],
        });

        const result = runner.parseCodexOutput(output);

        expect(result.result).toBe('FAIL');
        expect(result.issues[0].description).toContain('Invalid or missing "result" field');
      });

      it('should reject JSON without issues array', () => {
        const output = JSON.stringify({
          result: 'PASS',
        });

        const result = runner.parseCodexOutput(output);

        expect(result.result).toBe('FAIL');
        expect(result.issues[0].description).toContain('Invalid or missing "issues" field');
      });

      it('should reject JSON with non-array issues', () => {
        const output = JSON.stringify({
          result: 'PASS',
          issues: 'not an array',
        });

        const result = runner.parseCodexOutput(output);

        expect(result.result).toBe('FAIL');
        expect(result.issues[0].description).toContain('Invalid or missing "issues" field');
      });

      it('should reject issue without file field', () => {
        const output = JSON.stringify({
          result: 'FAIL',
          issues: [
            {
              severity: 'error',
              description: 'Some error',
            },
          ],
        });

        const result = runner.parseCodexOutput(output);

        expect(result.result).toBe('FAIL');
        expect(result.issues[0].description).toContain('missing "file" field');
      });

      it('should reject issue without description field', () => {
        const output = JSON.stringify({
          result: 'FAIL',
          issues: [
            {
              file: 'test.ts',
              severity: 'error',
            },
          ],
        });

        const result = runner.parseCodexOutput(output);

        expect(result.result).toBe('FAIL');
        expect(result.issues[0].description).toContain('missing "description" field');
      });

      it('should reject issue with invalid severity', () => {
        const output = JSON.stringify({
          result: 'FAIL',
          issues: [
            {
              file: 'test.ts',
              severity: 'critical',
              description: 'Error',
            },
          ],
        });

        const result = runner.parseCodexOutput(output);

        expect(result.result).toBe('FAIL');
        expect(result.issues[0].description).toContain('invalid "severity"');
      });
    });
  });

  describe('run with outputMode review_json', () => {
    let spawnMock: MockInstance;

    beforeEach(async () => {
      const cp = await import('child_process');
      spawnMock = vi.mocked(cp.spawn);
      spawnMock.mockReset();
    });

    function stubCodexBinary(): void {
      const codexBinPath = join(
        import.meta.dirname,
        '../../node_modules/.bin/codex',
      );
      const currentImpl = mockExistsSync.getMockImplementation();
      mockExistsSync.mockImplementation(
        (p) => String(p) === codexBinPath || (currentImpl ? currentImpl(p) : false),
      );
    }

    it('should create temp files and pass --output-last-message and --output-schema flags', async () => {
      stubCodexBinary();

      spawnMock.mockImplementation((_cmd: string, args: string[]) => {
        const lastMsgIndex = args.indexOf('--output-last-message');
        if (lastMsgIndex !== -1) {
          const lastMsgPath = args[lastMsgIndex + 1];
          fs.writeFileSync(lastMsgPath, JSON.stringify({ result: 'PASS', issues: [] }));
        }
        return createMockChildProcess(0, 'stdout output');
      });

      const result = await runner.run({
        workDir: '/tmp',
        prompt: 'review this',
        outputMode: 'review_json',
      });

      expect(result.success).toBe(true);
      expect(result.parsedOutput).toBe(JSON.stringify({ result: 'PASS', issues: [] }));

      const spawnArgs = spawnMock.mock.calls[0][1] as string[];
      expect(spawnArgs).toContain('--output-last-message');
      expect(spawnArgs).toContain('--output-schema');
    });

    it('should return undefined parsedOutput when capture file is missing', async () => {
      stubCodexBinary();

      spawnMock.mockImplementation(() => createMockChildProcess(0, 'stdout'));

      const result = await runner.run({
        workDir: '/tmp',
        prompt: 'review this',
        outputMode: 'review_json',
      });

      expect(result.success).toBe(true);
      expect(result.parsedOutput).toBeUndefined();
    });

    it('should return undefined parsedOutput when capture file is empty', async () => {
      stubCodexBinary();

      spawnMock.mockImplementation((_cmd: string, args: string[]) => {
        const lastMsgIndex = args.indexOf('--output-last-message');
        if (lastMsgIndex !== -1) {
          fs.writeFileSync(args[lastMsgIndex + 1], '');
        }
        return createMockChildProcess(0, 'stdout');
      });

      const result = await runner.run({
        workDir: '/tmp',
        prompt: 'review this',
        outputMode: 'review_json',
      });

      expect(result.success).toBe(true);
      expect(result.parsedOutput).toBeUndefined();
    });

    it('should not pass capture flags when outputMode is default', async () => {
      stubCodexBinary();

      spawnMock.mockImplementation(() => createMockChildProcess(0, 'stdout'));

      await runner.run({
        workDir: '/tmp',
        prompt: 'do something',
      });

      const spawnArgs = spawnMock.mock.calls[0][1] as string[];
      expect(spawnArgs).not.toContain('--output-last-message');
      expect(spawnArgs).not.toContain('--output-schema');
    });

    it('should clean up temp directory after successful run', async () => {
      stubCodexBinary();

      let capturedTempDir: string | undefined;
      spawnMock.mockImplementation((_cmd: string, args: string[]) => {
        const lastMsgIndex = args.indexOf('--output-last-message');
        if (lastMsgIndex !== -1) {
          const lastMsgPath = args[lastMsgIndex + 1];
          capturedTempDir = join(lastMsgPath, '..');
          fs.writeFileSync(lastMsgPath, '{"result":"PASS","issues":[]}');
        }
        return createMockChildProcess(0, 'stdout');
      });

      await runner.run({
        workDir: '/tmp',
        prompt: 'review',
        outputMode: 'review_json',
      });

      expect(capturedTempDir).toBeDefined();
      expect(fs.existsSync(capturedTempDir!)).toBe(false);
    });

    it('should clean up temp directory even when codex fails', async () => {
      stubCodexBinary();

      let capturedTempDir: string | undefined;
      spawnMock.mockImplementation((_cmd: string, args: string[]) => {
        const lastMsgIndex = args.indexOf('--output-last-message');
        if (lastMsgIndex !== -1) {
          const lastMsgPath = args[lastMsgIndex + 1];
          capturedTempDir = join(lastMsgPath, '..');
        }
        return createMockChildProcess(1, 'error output');
      });

      await expect(
        runner.run({ workDir: '/tmp', prompt: 'review', outputMode: 'review_json' }),
      ).rejects.toThrow();

      expect(capturedTempDir).toBeDefined();
      expect(fs.existsSync(capturedTempDir!)).toBe(false);
    });

    it('should write valid JSON schema to temp directory', async () => {
      stubCodexBinary();

      let schemaContent: string | undefined;
      spawnMock.mockImplementation((_cmd: string, args: string[]) => {
        const schemaIndex = args.indexOf('--output-schema');
        if (schemaIndex !== -1) {
          schemaContent = fs.readFileSync(args[schemaIndex + 1], 'utf-8');
        }
        return createMockChildProcess(0, 'stdout');
      });

      await runner.run({
        workDir: '/tmp',
        prompt: 'review',
        outputMode: 'review_json',
      });

      expect(schemaContent).toBeDefined();
      const schema = JSON.parse(schemaContent!);
      expect(schema.type).toBe('object');
      expect(schema.required).toContain('result');
      expect(schema.required).toContain('issues');

      const issueRequired = schema.properties.issues.items.required as string[];
      expect(issueRequired).toContain('file');
      expect(issueRequired).toContain('severity');
      expect(issueRequired).toContain('description');
      expect(issueRequired).toContain('line');
    });
  });
});
