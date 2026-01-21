import { describe, expect, it, vi, beforeEach } from 'vitest';

import { GitHubChecker } from '../github-checker.js';

type CheckRun = {
  id: number;
  name: string;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion: 'success' | 'failure' | 'cancelled' | 'skipped' | null;
  head_sha: string;
};

const createCheckRunsResponse = (runs: CheckRun[]) => ({
  total_count: runs.length,
  check_runs: runs,
});

const noopLog = () => undefined;

describe('GitHubChecker waitForChecksToPass', () => {
  const owner = 'forketyfork';
  const repo = 'stepcat';
  const workDir = process.cwd();

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('waits for checks on the current commit when PR head is behind', async () => {
    const currentSha = 'cccccccccccccccccccccccccccccccccccccccc';
    const previousSha = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

    const responses = [
      createCheckRunsResponse([
        {
          id: 1,
          name: 'CI',
          status: 'completed',
          conclusion: 'success',
          head_sha: previousSha,
        },
      ]),
      createCheckRunsResponse([
        {
          id: 2,
          name: 'CI',
          status: 'completed',
          conclusion: 'success',
          head_sha: currentSha,
        },
      ]),
    ];

    const listForRef = vi.fn().mockImplementation(() => {
      const next = responses.length > 1 ? responses.shift()! : responses[0];
      return Promise.resolve({ data: next });
    });

    const pullsList = vi.fn().mockResolvedValue({
      data: [
        {
          number: 42,
          head: { sha: previousSha, ref: 'feature/test' },
        },
      ],
    });

    const pullsGet = vi.fn().mockResolvedValue({
      data: {
        number: 42,
        head: { sha: previousSha, ref: 'feature/test' },
        base: { ref: 'main' },
        mergeable_state: 'clean',
      },
    });

    const compare = vi.fn().mockResolvedValue({
      data: { status: 'behind' },
    });

    const checker = new GitHubChecker({ owner, repo, workDir });
    (checker as any).octokit = {
      checks: { listForRef },
      pulls: {
        list: pullsList,
        get: pullsGet,
      },
      repos: {
        compareCommitsWithBasehead: compare,
      },
    };
    (checker as any).log = noopLog;
    vi.spyOn(checker as any, 'sleep').mockResolvedValue(undefined);
    vi.spyOn(checker as any, 'getCurrentBranch').mockReturnValue('feature/test');

    const result = await checker.waitForChecksToPass(currentSha, 1);

    expect(result).toBe(true);
    expect(listForRef).toHaveBeenCalledTimes(2);
    expect(listForRef.mock.calls[0][0].ref).toBe(currentSha);
    expect(checker.getLastTrackedSha()).toBe(currentSha);
  });

  it('tracks newer PR head when it includes the current commit', async () => {
    const currentSha = 'cccccccccccccccccccccccccccccccccccccccc';
    const newerSha = 'dddddddddddddddddddddddddddddddddddddddd';

    const responses = [
      createCheckRunsResponse([
        {
          id: 3,
          name: 'CI',
          status: 'completed',
          conclusion: 'success',
          head_sha: newerSha,
        },
      ]),
    ];

    const listForRef = vi.fn().mockImplementation(() => {
      const next = responses.shift() ?? responses[responses.length - 1];
      return Promise.resolve({ data: next });
    });

    const pullsList = vi.fn().mockResolvedValue({
      data: [
        {
          number: 99,
          head: { sha: newerSha, ref: 'feature/next' },
        },
      ],
    });

    const pullsGet = vi.fn().mockResolvedValue({
      data: {
        number: 99,
        head: { sha: newerSha, ref: 'feature/next' },
        base: { ref: 'main' },
        mergeable_state: 'clean',
      },
    });

    const compare = vi.fn().mockResolvedValue({
      data: { status: 'ahead' },
    });

    const checker = new GitHubChecker({ owner, repo, workDir });
    (checker as any).octokit = {
      checks: { listForRef },
      pulls: {
        list: pullsList,
        get: pullsGet,
      },
      repos: {
        compareCommitsWithBasehead: compare,
      },
    };
    (checker as any).log = noopLog;
    vi.spyOn(checker as any, 'sleep').mockResolvedValue(undefined);
    vi.spyOn(checker as any, 'getCurrentBranch').mockReturnValue('feature/next');

    const result = await checker.waitForChecksToPass(currentSha, 1);

    expect(result).toBe(true);
    expect(listForRef).toHaveBeenCalledTimes(1);
    expect(listForRef.mock.calls[0][0].ref).toBe(newerSha);
    expect(checker.getLastTrackedSha()).toBe(newerSha);
  });
});
