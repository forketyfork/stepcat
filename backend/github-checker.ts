import { Octokit } from '@octokit/rest';
import { execSync } from 'child_process';
import { OrchestratorEventEmitter } from './events.js';

export interface GitHubConfig {
  owner: string;
  repo: string;
  token?: string;
  workDir: string;
  eventEmitter?: OrchestratorEventEmitter;
}

export class GitHubChecker {
  private octokit: Octokit;
  private owner: string;
  private repo: string;
  private workDir: string;
  private eventEmitter?: OrchestratorEventEmitter;

  constructor(config: GitHubConfig) {
    this.octokit = new Octokit({
      auth: config.token || process.env.GITHUB_TOKEN
    });
    this.owner = config.owner;
    this.repo = config.repo;
    this.workDir = config.workDir;
    this.eventEmitter = config.eventEmitter;
  }

  getOctokit(): Octokit {
    return this.octokit;
  }

  getOwner(): string {
    return this.owner;
  }

  getRepo(): string {
    return this.repo;
  }

  async waitForChecksToPass(
    sha: string,
    maxWaitMinutes: number = 30,
    attempt: number = 1,
    maxAttempts: number = 1
  ): Promise<boolean> {
    const startTime = Date.now();
    const maxWaitMs = maxWaitMinutes * 60 * 1000;

    this.log(`\nWaiting for GitHub Actions checks (max ${maxWaitMinutes} minutes)...`);
    this.log(`Repository: ${this.owner}/${this.repo}`);
    this.log(`Commit: ${sha}`);

    while (Date.now() - startTime < maxWaitMs) {
      try {
        const { data: checkRuns } = await this.octokit.checks.listForRef({
          owner: this.owner,
          repo: this.repo,
          ref: sha
        });

        if (checkRuns.total_count === 0) {
          const elapsed = Math.floor((Date.now() - startTime) / 1000);
          this.log(`[${elapsed}s] No checks found yet, waiting...`);
          await this.sleep(30000);
          continue;
        }

        const completed = checkRuns.check_runs.filter(r => r.status === 'completed').length;
        const total = checkRuns.total_count;

        if (completed < total) {
          const elapsed = Math.floor((Date.now() - startTime) / 1000);
          this.log(`[${elapsed}s] Checks in progress: ${completed}/${total} completed`);

          if (this.eventEmitter) {
            this.eventEmitter.emit('event', {
              type: 'github_check',
              timestamp: Date.now(),
              status: 'running',
              sha,
              attempt,
              maxAttempts,
              checkName: `${completed}/${total} checks completed`
            });
          }

          checkRuns.check_runs.forEach(run => {
            const status = run.status === 'completed'
              ? `✓ ${run.conclusion}`
              : `⏳ ${run.status}`;
            this.log(`  - ${run.name}: ${status}`);
          });

          await this.sleep(30000);
          continue;
        }

        const allPassed = checkRuns.check_runs.every(run =>
          run.conclusion === 'success' || run.conclusion === 'skipped'
        );

        if (allPassed) {
          this.log('\n✓ All checks passed:', 'success');
          checkRuns.check_runs.forEach(run => {
            this.log(`  ✓ ${run.name}: ${run.conclusion}`, 'success');
          });
          return true;
        } else {
          this.log('\n✗ Some checks failed:', 'error');
          checkRuns.check_runs.forEach(run => {
            const icon = (run.conclusion === 'success' || run.conclusion === 'skipped') ? '✓' : '✗';
            const level = (run.conclusion === 'success' || run.conclusion === 'skipped') ? 'success' : 'error';
            this.log(`  ${icon} ${run.name}: ${run.conclusion}`, level);
          });
          return false;
        }
      } catch (error) {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        this.log(`[${elapsed}s] Error checking GitHub status: ${error instanceof Error ? error.message : String(error)}`, 'error');
        this.log('Retrying in 30 seconds...', 'warn');
        await this.sleep(30000);
      }
    }

    throw new Error(`Timeout: Checks did not complete within ${maxWaitMinutes} minutes`);
  }

  getLatestCommitSha(): string {
    const sha = execSync('git rev-parse HEAD', {
      cwd: this.workDir,
      encoding: 'utf-8'
    }).trim();
    this.log(`Latest commit: ${sha}`);
    return sha;
  }

  ensureNoUncommittedChanges(): void {
    const status = execSync('git status --porcelain', {
      cwd: this.workDir,
      encoding: 'utf-8'
    }).trim();

    if (status) {
      throw new Error(
        'Uncommitted changes detected after step completion:\n' +
        status + '\n\n' +
        'All changes must be committed before proceeding to the next step.'
      );
    }
  }

  static parseRepoInfo(repoPath: string): { owner: string; repo: string } {
    try {
      const remoteUrl = execSync('git remote get-url origin', {
        cwd: repoPath,
        encoding: 'utf-8'
      }).trim();

      const match = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
      if (match) {
        const owner = match[1];
        const repo = match[2];
        return { owner, repo };
      }

      throw new Error(`Could not parse GitHub repository from URL: ${remoteUrl}`);
    } catch (error) {
      throw new Error(
        `Failed to get repository information: ${error instanceof Error ? error.message : String(error)}\n` +
        'Make sure you are in a git repository with a GitHub origin remote.'
      );
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private log(message: string, level: 'info' | 'warn' | 'error' | 'success' = 'info'): void {
    if (this.eventEmitter) {
      const lines = message.split('\n');
      for (const line of lines) {
        if (line.trim()) {
          this.eventEmitter.emit('event', {
            type: 'log',
            timestamp: Date.now(),
            level,
            message: line
          });
        }
      }
    } else {
      console.log(message);
    }
  }
}
