import { execSync } from 'child_process';

import { Octokit } from '@octokit/rest';

import type { OrchestratorEventEmitter } from './events.js';
import type { LogLevel } from './logger.js';
import { getLogger } from './logger.js';

type PullRequestDetails = {
  number: number;
  headSha: string;
  headRef: string;
  baseRef?: string;
  mergeableState: string | null;
};

export interface MergeConflictDetails {
  prNumber?: number;
  branch: string;
  base?: string;
}

export class MergeConflictError extends Error {
  details: MergeConflictDetails;

  constructor(message: string, details: MergeConflictDetails) {
    super(message);
    this.name = 'MergeConflictError';
    this.details = details;
  }
}

export interface GitHubConfig {
  owner: string;
  repo: string;
  token?: string;
  workDir: string;
  eventEmitter?: OrchestratorEventEmitter;
}

export class GitHubChecker {
  private readonly pollIntervalMs = 5000;
  private octokit: Octokit;
  private owner: string;
  private repo: string;
  private workDir: string;
  private eventEmitter?: OrchestratorEventEmitter;
  private lastTrackedSha: string | null = null;

  constructor(config: GitHubConfig) {
    this.octokit = new Octokit({
      auth: config.token ?? process.env.GITHUB_TOKEN
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

  getLastTrackedSha(): string | null {
    return this.lastTrackedSha;
  }

  async waitForChecksToPass(
    sha: string,
    maxWaitMinutes: number = 30,
    attempt: number = 1,
    maxAttempts: number = 1
  ): Promise<boolean> {
    const startTime = Date.now();
    const maxWaitMs = maxWaitMinutes * 60 * 1000;
    let targetSha = sha;
    this.lastTrackedSha = targetSha;

    this.log(`\nWaiting for GitHub Actions checks (max ${maxWaitMinutes} minutes)...`);
    this.log(`Repository: ${this.owner}/${this.repo}`);
    this.log(`Commit: ${sha}`);

    while (Date.now() - startTime < maxWaitMs) {
      try {
        const prDetails = await this.getPullRequestDetails();
        if (prDetails?.headSha && prDetails.headSha !== targetSha) {
          const comparison = await this.compareCommits(targetSha, prDetails.headSha);

          if (comparison === 'ahead' || comparison === 'identical') {
            this.log(
              `Detected PR #${prDetails.number} head at ${prDetails.headSha}, which includes ${targetSha}. Tracking the newer commit.`,
            );
            targetSha = prDetails.headSha;
            this.lastTrackedSha = targetSha;
          } else if (comparison === 'behind') {
            this.log(
              `PR #${prDetails.number} head ${prDetails.headSha} is behind current commit ${targetSha}. Waiting for checks on ${targetSha}.`,
            );
          } else if (comparison === 'diverged') {
            this.log(
              `PR #${prDetails.number} head ${prDetails.headSha} has diverged from ${targetSha}. Waiting for ${targetSha} checks.`,
              'warn',
            );
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- explicit check for enum clarity
          } else if (comparison === 'unknown') {
            this.log(
              `Unable to determine relationship between PR #${prDetails.number} head ${prDetails.headSha} and ${targetSha}. Waiting for ${targetSha} checks.`,
              'warn',
            );
          }
        }

        const { data: checkRuns } = await this.octokit.checks.listForRef({
          owner: this.owner,
          repo: this.repo,
          ref: targetSha,
        });

        const runsForTarget = checkRuns.check_runs.filter(run => run.head_sha === targetSha);

        if (runsForTarget.length === 0) {
          const conflict = await this.detectMergeConflict(prDetails);
          if (conflict) {
            const conflictMessageParts: string[] = [];
            if (conflict.prNumber) {
              conflictMessageParts.push(`PR #${conflict.prNumber}`);
            } else {
              conflictMessageParts.push('Current branch');
            }
            conflictMessageParts.push('has merge conflicts');
            if (conflict.base) {
              conflictMessageParts.push(`with ${conflict.base}`);
            }
            const conflictMessage = conflictMessageParts.join(' ') + '. GitHub actions will not run until conflicts are resolved.';
            this.log(conflictMessage, 'error');
            throw new MergeConflictError(conflictMessage, conflict);
          }

          const elapsed = Math.floor((Date.now() - startTime) / 1000);
          if (checkRuns.total_count > 0) {
            this.log(
              `[${elapsed}s] Checks found for other commits but not for ${targetSha}. Waiting for current commit checks...`,
            );
          } else {
            this.log(`[${elapsed}s] No checks found yet for ${targetSha}, waiting...`);
          }
          await this.sleep(this.pollIntervalMs);
          continue;
        }

        const completed = runsForTarget.filter(r => r.status === 'completed').length;
        const total = runsForTarget.length;

        if (completed < total) {
          const elapsed = Math.floor((Date.now() - startTime) / 1000);
          this.log(`[${elapsed}s] Checks in progress for ${targetSha}: ${completed}/${total} completed`);

          if (this.eventEmitter) {
            this.eventEmitter.emit('event', {
              type: 'github_check',
              timestamp: Date.now(),
              status: 'running',
              sha: targetSha,
              attempt,
              maxAttempts,
              checkName: `${completed}/${total} checks completed`,
            });
          }

          runsForTarget.forEach(run => {
            const status = run.status === 'completed'
              ? `✓ ${run.conclusion}`
              : `⏳ ${run.status}`;
            this.log(`  - ${run.name}: ${status}`);
          });

          await this.sleep(this.pollIntervalMs);
          continue;
        }

        const allPassed = runsForTarget.every(run =>
          run.conclusion === 'success' || run.conclusion === 'skipped'
        );

        if (allPassed) {
          this.lastTrackedSha = targetSha;
          this.log('\n✓ All checks passed:', 'success');
          runsForTarget.forEach(run => {
            this.log(`  ✓ ${run.name}: ${run.conclusion}`, 'success');
          });
          return true;
        } else {
          this.lastTrackedSha = targetSha;
          this.log('\n✗ Some checks failed:', 'error');
          runsForTarget.forEach(run => {
            const icon = (run.conclusion === 'success' || run.conclusion === 'skipped') ? '✓' : '✗';
            const level = (run.conclusion === 'success' || run.conclusion === 'skipped') ? 'success' : 'error';
            this.log(`  ${icon} ${run.name}: ${run.conclusion}`, level);
          });
          return false;
        }
      } catch (error) {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        const message = error instanceof Error ? error.message : String(error);
        this.log(`[${elapsed}s] Error checking GitHub status: ${message}`, 'error');
        this.log(`Retrying in ${this.pollIntervalMs / 1000} seconds...`, 'warn');
        await this.sleep(this.pollIntervalMs);
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

  private async compareCommits(baseSha: string, headSha: string): Promise<'ahead' | 'behind' | 'identical' | 'diverged' | 'unknown'> {
    if (baseSha === headSha) {
      return 'identical';
    }

    try {
      const { data } = await this.octokit.repos.compareCommitsWithBasehead({
        owner: this.owner,
        repo: this.repo,
        basehead: `${baseSha}...${headSha}`,
      });

      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- explicit enum check for clarity and future-proofing
      if (data.status === 'ahead' || data.status === 'behind' || data.status === 'identical' || data.status === 'diverged') {
        return data.status;
      }
    } catch (error) {
      this.log(
        `Failed to compare commits ${baseSha} and ${headSha}: ${error instanceof Error ? error.message : String(error)}`,
        'warn',
      );
    }

    if (this.isAncestor(baseSha, headSha)) {
      return 'ahead';
    }

    if (this.isAncestor(headSha, baseSha)) {
      return 'behind';
    }

    return 'unknown';
  }

  private isAncestor(potentialAncestor: string, commit: string): boolean {
    try {
      execSync(`git merge-base --is-ancestor ${potentialAncestor} ${commit}`, {
        cwd: this.workDir,
        stdio: 'ignore',
      });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      getLogger()?.debug(
        'GitHubChecker',
        `Failed ancestor check for ${potentialAncestor} -> ${commit}: ${message}`,
      );
      return false;
    }
  }

  private getCurrentBranch(): string | null {
    try {
      return execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: this.workDir,
        encoding: 'utf-8',
      }).trim();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      getLogger()?.debug('GitHubChecker', `Failed to read current branch: ${message}`);
      return null;
    }
  }

  private async getPullRequestDetails(): Promise<PullRequestDetails | null> {
    const branch = this.getCurrentBranch();
    if (!branch || branch === 'HEAD') {
      return null;
    }

    try {
      const pullList = await this.octokit.pulls.list({
        owner: this.owner,
        repo: this.repo,
        head: `${this.owner}:${branch}`,
        state: 'open',
        per_page: 1,
      });

      const pull = pullList.data[0];
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- array index access can return undefined at runtime
      if (!pull) {
        return null;
      }

      const pullDetailsResponse = await this.octokit.pulls.get({
        owner: this.owner,
        repo: this.repo,
        pull_number: pull.number,
      });

      const pullDetails = pullDetailsResponse.data;

      return {
        number: pullDetails.number,
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- defensive against API response variations
        headSha: pullDetails.head?.sha ?? pull.head.sha ?? '',
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- defensive against API response variations
        headRef: pullDetails.head?.ref ?? branch,
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- defensive against API response variations
        baseRef: pullDetails.base?.ref,
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- mergeable_state can be null from API
        mergeableState: pullDetails.mergeable_state ?? null,
      };
    } catch (error) {
      this.log(`Failed to retrieve pull request details: ${error instanceof Error ? error.message : String(error)}`, 'warn');
      return null;
    }
  }

  private async detectMergeConflict(prDetails?: PullRequestDetails | null): Promise<MergeConflictDetails | null> {
    const details = prDetails ?? (await this.getPullRequestDetails());
    if (!details) {
      return null;
    }

    if (details.mergeableState === 'dirty') {
      return {
        prNumber: details.number,
        branch: details.headRef,
        base: details.baseRef,
      };
    }

    return null;
  }

  private log(message: string, level: 'info' | 'warn' | 'error' | 'success' = 'info'): void {
    const lines = message.split('\n');
    const logLevel: LogLevel = level === 'success' ? 'info' : level;

    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }

      getLogger()?.log(logLevel, 'GitHubChecker', line);

      if (this.eventEmitter) {
        this.eventEmitter.emit('event', {
          type: 'log',
          timestamp: Date.now(),
          level,
          message: line
        });
      } else {
        const stream = logLevel === 'error' || logLevel === 'warn'
          ? process.stderr
          : process.stdout;
        stream.write(`${line}\n`);
      }
    }
  }
}
