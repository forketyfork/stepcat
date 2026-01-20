import { spawn } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { PROMPTS } from './prompts.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const moduleDir = __dirname;

export interface PreflightResult {
  success: boolean;
  analysis?: {
    detected_commands: Array<{ command: string; reason: string }>;
    currently_allowed: string[];
    missing_permissions: string[];
  };
  recommendations?: {
    settings_json: {
      path: string;
      content: {
        permissions: {
          allow: string[];
        };
      };
    };
    explanation: string;
  };
  error?: string;
  rawOutput?: string;
}

export interface PreflightOptions {
  planFile: string;
  workDir: string;
  timeoutMinutes?: number;
}

export class PreflightRunner {
  private getClaudePath(): string {
    const localBin = resolve(moduleDir, '../node_modules/.bin/claude');

    if (!existsSync(localBin)) {
      throw new Error(
        `Claude Code binary not found at ${localBin}\n` +
        'Please ensure @anthropic-ai/claude-code is installed:\n' +
        '  npm install @anthropic-ai/claude-code'
      );
    }

    return localBin;
  }

  private readFileIfExists(filePath: string): string | null {
    if (existsSync(filePath)) {
      try {
        return readFileSync(filePath, 'utf-8');
      } catch {
        return null;
      }
    }
    return null;
  }

  private writeLine(line: string): void {
    process.stdout.write(`${line}\n`);
  }

  async run(options: PreflightOptions): Promise<PreflightResult> {
    const claudePath = this.getClaudePath();

    // Read plan file
    if (!existsSync(options.planFile)) {
      return {
        success: false,
        error: `Plan file not found: ${options.planFile}`,
      };
    }
    const planContent = readFileSync(options.planFile, 'utf-8');

    // Read CLAUDE.md if it exists
    const claudeMdPath = resolve(options.workDir, 'CLAUDE.md');
    const claudeMdContent = this.readFileIfExists(claudeMdPath);

    // Read .claude/settings.json or .claude/settings.local.json if they exist
    const claudeSettingsPath = resolve(options.workDir, '.claude', 'settings.json');
    const claudeSettingsLocalPath = resolve(options.workDir, '.claude', 'settings.local.json');
    const claudeSettingsBase = this.readFileIfExists(claudeSettingsPath);
    const claudeSettingsLocal = this.readFileIfExists(claudeSettingsLocalPath);

    // Determine settings status for display
    const settingsStatus = claudeSettingsBase && claudeSettingsLocal
      ? 'Found (settings.json + settings.local.json)'
      : claudeSettingsBase
        ? 'Found (settings.json)'
        : claudeSettingsLocal
          ? 'Found (settings.local.json)'
          : 'Not found';

    // Combine both settings files for analysis
    let claudeSettingsContent: string | null = null;
    if (claudeSettingsBase && claudeSettingsLocal) {
      claudeSettingsContent = `settings.json:\n${claudeSettingsBase}\n\nsettings.local.json:\n${claudeSettingsLocal}`;
    } else if (claudeSettingsBase) {
      claudeSettingsContent = `settings.json:\n${claudeSettingsBase}`;
    } else if (claudeSettingsLocal) {
      claudeSettingsContent = `settings.local.json:\n${claudeSettingsLocal}`;
    }

    // Build the prompt
    const prompt = PROMPTS.preflight(planContent, claudeMdContent, claudeSettingsContent);

    this.writeLine('═'.repeat(80));
    this.writeLine('STEPCAT PREFLIGHT CHECK');
    this.writeLine('═'.repeat(80));
    this.writeLine(`Plan file:      ${options.planFile}`);
    this.writeLine(`Work directory: ${options.workDir}`);
    this.writeLine(`CLAUDE.md:      ${claudeMdContent ? 'Found' : 'Not found'}`);
    this.writeLine(`Settings:       ${settingsStatus}`);
    this.writeLine('═'.repeat(80));
    this.writeLine('Running Claude Code to analyze required permissions...');
    this.writeLine('─'.repeat(80));

    const timeout = (options.timeoutMinutes ?? 5) * 60 * 1000;

    const result = await new Promise<{
      exitCode: number | null;
      error?: Error;
      stdout: string;
    }>((resolve) => {
      const child = spawn(
        claudePath,
        [
          '--print',
          '--add-dir',
          options.workDir,
        ],
        {
          cwd: options.workDir,
          stdio: ['pipe', 'pipe', 'inherit'],
        }
      );

      let timeoutId: NodeJS.Timeout | undefined;
      let stdoutData = '';

      if (timeout > 0) {
        timeoutId = setTimeout(() => {
          child.kill('SIGTERM');
          resolve({
            exitCode: null,
            error: new Error('Preflight check timed out'),
            stdout: stdoutData,
          });
        }, timeout);
      }

      if (!child.stdin) {
        throw new Error('Claude Code process did not provide stdin stream');
      }

      child.stdin.write(prompt);
      child.stdin.end();

      if (child.stdout) {
        child.stdout.on('data', (chunk) => {
          stdoutData += chunk.toString();
        });
      }

      child.on('error', (error) => {
        if (timeoutId) clearTimeout(timeoutId);
        resolve({ exitCode: null, error, stdout: stdoutData });
      });

      child.on('close', (code) => {
        if (timeoutId) clearTimeout(timeoutId);
        resolve({ exitCode: code, stdout: stdoutData });
      });
    });

    if (result.error) {
      return {
        success: false,
        error: result.error.message,
        rawOutput: result.stdout,
      };
    }

    if (result.exitCode !== 0) {
      return {
        success: false,
        error: `Claude Code exited with code ${result.exitCode}`,
        rawOutput: result.stdout,
      };
    }

    // Parse the JSON output from Claude
    const output = result.stdout.trim();

    // Try to extract JSON from the output
    const jsonMatch = output.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return {
        success: false,
        error: 'Could not find JSON in Claude output',
        rawOutput: output,
      };
    }

    try {
      const parsed = JSON.parse(jsonMatch[0]);

      return {
        success: true,
        analysis: parsed.analysis,
        recommendations: parsed.recommendations,
        rawOutput: output,
      };
    } catch (parseError) {
      return {
        success: false,
        error: `Failed to parse Claude output as JSON: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
        rawOutput: output,
      };
    }
  }

  formatOutput(result: PreflightResult): string {
    const lines: string[] = [];

    lines.push('');
    lines.push('═'.repeat(80));
    lines.push('PREFLIGHT CHECK RESULTS');
    lines.push('═'.repeat(80));

    if (!result.success) {
      lines.push('');
      lines.push('❌ PREFLIGHT CHECK FAILED');
      lines.push('─'.repeat(80));
      lines.push(`Error: ${result.error}`);
      if (result.rawOutput) {
        lines.push('');
        lines.push('Raw output:');
        lines.push(result.rawOutput.substring(0, 1000));
      }
      lines.push('═'.repeat(80));
      return lines.join('\n');
    }

    // Analysis section
    if (result.analysis) {
      lines.push('');
      lines.push('📋 DETECTED COMMANDS');
      lines.push('─'.repeat(80));
      for (const cmd of result.analysis.detected_commands) {
        lines.push(`  • ${cmd.command}`);
        lines.push(`    └─ ${cmd.reason}`);
      }

      lines.push('');
      lines.push('✅ CURRENTLY ALLOWED');
      lines.push('─'.repeat(80));
      if (result.analysis.currently_allowed.length > 0) {
        for (const perm of result.analysis.currently_allowed) {
          lines.push(`  • ${perm}`);
        }
      } else {
        lines.push('  (none)');
      }

      lines.push('');
      if (result.analysis.missing_permissions.length > 0) {
        lines.push('⚠️  MISSING PERMISSIONS');
        lines.push('─'.repeat(80));
        for (const perm of result.analysis.missing_permissions) {
          lines.push(`  • ${perm}`);
        }
      } else {
        lines.push('✅ ALL REQUIRED PERMISSIONS ARE CONFIGURED');
        lines.push('─'.repeat(80));
        lines.push('  No additional configuration needed.');
      }
    }

    // Recommendations section
    if (result.recommendations && result.analysis && result.analysis.missing_permissions.length > 0) {
      lines.push('');
      lines.push('📝 RECOMMENDED CONFIGURATION');
      lines.push('═'.repeat(80));
      lines.push('');
      lines.push(`Add the following to ${result.recommendations.settings_json.path}:`);
      lines.push('');
      lines.push('```json');
      lines.push(JSON.stringify(result.recommendations.settings_json.content, null, 2));
      lines.push('```');
      lines.push('');
      lines.push(result.recommendations.explanation);
    }

    lines.push('');
    lines.push('═'.repeat(80));

    return lines.join('\n');
  }
}
