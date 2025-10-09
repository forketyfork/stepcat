import { spawn, execSync } from 'child_process';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { PROMPTS } from './prompts';

export interface ClaudeRunOptions {
  workDir: string;
  prompt: string;
  timeoutMinutes?: number;
}

export class ClaudeRunner {
  private getClaudePath(): string {
    const localBin = resolve(__dirname, '../node_modules/.bin/claude');

    console.log(`Looking for Claude Code binary at: ${localBin}`);

    if (!existsSync(localBin)) {
      throw new Error(
        `Claude Code binary not found at ${localBin}\n` +
        'Please ensure @anthropic-ai/claude-code is installed:\n' +
        '  npm install @anthropic-ai/claude-code'
      );
    }

    console.log('Note: Using assumed CLI flags: --print, --verbose, --add-dir, --permission-mode acceptEdits');
    console.log('If these flags are incorrect for your version, please update src/claude-runner.ts');

    return localBin;
  }

  private getHeadCommit(workDir: string): string {
    return execSync('git rev-parse HEAD', { cwd: workDir, encoding: 'utf-8' }).trim();
  }

  async run(options: ClaudeRunOptions): Promise<{ success: boolean; output: string }> {
    const claudePath = this.getClaudePath();

    console.log('─'.repeat(80));
    console.log(`Running Claude Code in ${options.workDir}`);
    console.log(`Binary: ${claudePath}`);
    console.log(`Timeout: ${options.timeoutMinutes || 30} minutes`);
    console.log('─'.repeat(80));

    const headBefore = this.getHeadCommit(options.workDir);
    console.log(`HEAD before: ${headBefore}`);
    console.log('─'.repeat(80));

    const timeout = (options.timeoutMinutes ?? 30) * 60 * 1000;

    const result = await new Promise<{ exitCode: number | null; error?: Error }>((resolve) => {
      const child = spawn(
        claudePath,
        [
          '--print',
          '--verbose',
          '--add-dir', options.workDir,
          '--permission-mode', 'acceptEdits'
        ],
        {
          cwd: options.workDir,
          // Inherit stdout/stderr to enable true realtime streaming from Claude Code
          stdio: ['pipe', 'inherit', 'inherit']
        }
      );

      let timeoutId: NodeJS.Timeout | undefined;

      if (timeout > 0) {
        timeoutId = setTimeout(() => {
          child.kill('SIGTERM');
          resolve({ exitCode: null, error: new Error('Claude Code execution timed out') });
        }, timeout);
      }

      child.stdin.write(options.prompt);
      child.stdin.end();

      // Stdout is inherited; no need to listen and re-print here

      child.on('error', (error) => {
        if (timeoutId) clearTimeout(timeoutId);
        resolve({ exitCode: null, error });
      });

      child.on('close', (code) => {
        if (timeoutId) clearTimeout(timeoutId);
        resolve({ exitCode: code });
      });
    });

    if (result.error) {
      console.error('─'.repeat(80));
      console.error('✗ Error running Claude Code');
      console.error('─'.repeat(80));
      throw result.error;
    }

    if (result.exitCode !== 0) {
      console.error('─'.repeat(80));
      console.error(`✗ Claude Code exited with status ${result.exitCode}`);
      console.error('─'.repeat(80));
      throw new Error(`Claude Code failed with exit code ${result.exitCode}`);
    }

    const headAfter = this.getHeadCommit(options.workDir);
    console.log('─'.repeat(80));
    console.log(`HEAD after: ${headAfter}`);

    if (headBefore === headAfter) {
      console.error('─'.repeat(80));
      console.error('✗ Claude Code did not create a commit');
      console.error('─'.repeat(80));
      throw new Error('Claude Code completed but did not create a commit');
    }

    const commitCount = execSync(`git rev-list ${headBefore}..${headAfter} --count`, {
      cwd: options.workDir,
      encoding: 'utf-8'
    }).trim();

    if (commitCount !== '1') {
      console.warn('─'.repeat(80));
      console.warn(`⚠ Warning: Expected 1 commit but found ${commitCount} commits`);
      console.warn('Consider squashing multiple commits into one for cleaner history');
      console.warn('─'.repeat(80));
    }

    console.log('✓ Claude Code completed successfully and created a commit');
    console.log('─'.repeat(80));

    return { success: true, output: '' };
  }

  buildImplementationPrompt(stepNumber: number, planContent: string): string {
    return PROMPTS.implementation(stepNumber, planContent);
  }

  buildFixPrompt(buildErrors: string): string {
    return PROMPTS.buildFix(buildErrors);
  }

  buildReviewFixPrompt(reviewComments: string): string {
    return PROMPTS.reviewFix(reviewComments);
  }
}
