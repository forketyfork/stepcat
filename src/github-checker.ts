import { Octokit } from '@octokit/rest';
import { execSync } from 'child_process';
import { OrchestratorEventEmitter } from './events';

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

  async waitForChecksToPass(
    sha: string,
    maxWaitMinutes: number = 30,
    attempt: number = 1,
    maxAttempts: number = 1
  ): Promise<boolean> {
    const startTime = Date.now();
    const maxWaitMs = maxWaitMinutes * 60 * 1000;

    console.log(`\nWaiting for GitHub Actions checks (max ${maxWaitMinutes} minutes)...`);
    console.log(`Repository: ${this.owner}/${this.repo}`);
    console.log(`Commit: ${sha}`);

    while (Date.now() - startTime < maxWaitMs) {
      try {
        const { data: checkRuns } = await this.octokit.checks.listForRef({
          owner: this.owner,
          repo: this.repo,
          ref: sha
        });

        if (checkRuns.total_count === 0) {
          const elapsed = Math.floor((Date.now() - startTime) / 1000);
          console.log(`[${elapsed}s] No checks found yet, waiting...`);
          await this.sleep(30000);
          continue;
        }

        const completed = checkRuns.check_runs.filter(r => r.status === 'completed').length;
        const total = checkRuns.total_count;

        if (completed < total) {
          const elapsed = Math.floor((Date.now() - startTime) / 1000);
          console.log(`[${elapsed}s] Checks in progress: ${completed}/${total} completed`);

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
            console.log(`  - ${run.name}: ${status}`);
          });

          await this.sleep(30000);
          continue;
        }

        const allPassed = checkRuns.check_runs.every(run =>
          run.conclusion === 'success' || run.conclusion === 'skipped'
        );

        if (allPassed) {
          console.log('\n✓ All checks passed:');
          checkRuns.check_runs.forEach(run => {
            console.log(`  ✓ ${run.name}: ${run.conclusion}`);
          });
          return true;
        } else {
          console.log('\n✗ Some checks failed:');
          checkRuns.check_runs.forEach(run => {
            const icon = (run.conclusion === 'success' || run.conclusion === 'skipped') ? '✓' : '✗';
            console.log(`  ${icon} ${run.name}: ${run.conclusion}`);
          });
          return false;
        }
      } catch (error) {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        console.error(`[${elapsed}s] Error checking GitHub status:`, error instanceof Error ? error.message : String(error));
        console.log('Retrying in 30 seconds...');
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
    console.log(`Latest commit: ${sha}`);
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

      console.log(`Git remote URL: ${remoteUrl}`);

      const match = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
      if (match) {
        const owner = match[1];
        const repo = match[2];
        console.log(`Parsed repository: ${owner}/${repo}`);
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
}
