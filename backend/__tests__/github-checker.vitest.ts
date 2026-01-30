import { describe, expect, it, vi, beforeEach } from 'vitest';

import { GitHubChecker } from '../github-checker.js';

type CheckRun = {
  id: number;
  name: string;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion: 'success' | 'failure' | 'cancelled' | 'skipped' | null;
  head_sha: string;
  app?: { id: number; name: string };
};

type CheckSuiteConclusion = 'success' | 'failure' | 'neutral' | 'cancelled' | 'timed_out' | 'action_required' | null;

type CheckSuite = {
  id: number;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion: CheckSuiteConclusion;
  head_sha: string;
  app?: { id: number; name: string };
};

const createCheckRunsResponse = (runs: CheckRun[]) => ({
  total_count: runs.length,
  check_runs: runs,
});

const createCheckSuitesResponse = (suites: CheckSuite[]) => ({
  total_count: suites.length,
  check_suites: suites,
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

    // Main loop calls listForRef twice (once with no matching runs, once with matching runs)
    // Then verifyCheckSuites calls listForRef again to get app IDs
    const responses = [
      createCheckRunsResponse([
        {
          id: 1,
          name: 'CI',
          status: 'completed',
          conclusion: 'success',
          head_sha: previousSha,
          app: { id: 15368, name: 'GitHub Actions' },
        },
      ]),
      createCheckRunsResponse([
        {
          id: 2,
          name: 'CI',
          status: 'completed',
          conclusion: 'success',
          head_sha: currentSha,
          app: { id: 15368, name: 'GitHub Actions' },
        },
      ]),
    ];

    const listForRef = vi.fn().mockImplementation(() => {
      const next = responses.length > 1 ? responses.shift()! : responses[0];
      return Promise.resolve({ data: next });
    });

    const listSuitesForRef = vi.fn().mockResolvedValue({
      data: createCheckSuitesResponse([
        { id: 1, status: 'completed', conclusion: 'success', head_sha: currentSha, app: { id: 15368, name: 'GitHub Actions' } },
      ]),
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
      checks: { listForRef, listSuitesForRef },
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
    // Main loop: 2 calls, verifyCheckSuites: 1 call = 3 total
    expect(listForRef).toHaveBeenCalledTimes(3);
    expect(listForRef.mock.calls[0][0].ref).toBe(currentSha);
    expect(checker.getLastTrackedSha()).toBe(currentSha);
  });

  it('tracks newer PR head when it includes the current commit', async () => {
    const currentSha = 'cccccccccccccccccccccccccccccccccccccccc';
    const newerSha = 'dddddddddddddddddddddddddddddddddddddddd';

    // This response is reused for all calls - main loop and verifyCheckSuites
    const checkRunsResponse = createCheckRunsResponse([
      {
        id: 3,
        name: 'CI',
        status: 'completed',
        conclusion: 'success',
        head_sha: newerSha,
        app: { id: 15368, name: 'GitHub Actions' },
      },
    ]);

    const listForRef = vi.fn().mockResolvedValue({ data: checkRunsResponse });

    const listSuitesForRef = vi.fn().mockResolvedValue({
      data: createCheckSuitesResponse([
        { id: 1, status: 'completed', conclusion: 'success', head_sha: newerSha, app: { id: 15368, name: 'GitHub Actions' } },
      ]),
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
      checks: { listForRef, listSuitesForRef },
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
    // Main loop: 1 call, verifyCheckSuites: 1 call = 2 total
    expect(listForRef).toHaveBeenCalledTimes(2);
    expect(listForRef.mock.calls[0][0].ref).toBe(newerSha);
    expect(checker.getLastTrackedSha()).toBe(newerSha);
  });

  it('waits for check suites to complete when check runs pass but suites are pending', async () => {
    const sha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

    const listForRef = vi.fn().mockResolvedValue({
      data: createCheckRunsResponse([
        { id: 1, name: 'CI', status: 'completed', conclusion: 'success', head_sha: sha, app: { id: 15368, name: 'GitHub Actions' } },
      ]),
    });

    const suitesResponses = [
      createCheckSuitesResponse([
        { id: 1, status: 'queued', conclusion: null, head_sha: sha, app: { id: 15368, name: 'GitHub Actions' } },
      ]),
      createCheckSuitesResponse([
        { id: 1, status: 'in_progress', conclusion: null, head_sha: sha, app: { id: 15368, name: 'GitHub Actions' } },
      ]),
      createCheckSuitesResponse([
        { id: 1, status: 'completed', conclusion: 'success', head_sha: sha, app: { id: 15368, name: 'GitHub Actions' } },
      ]),
    ];

    const listSuitesForRef = vi.fn().mockImplementation(() => {
      const next = suitesResponses.length > 1 ? suitesResponses.shift()! : suitesResponses[0];
      return Promise.resolve({ data: next });
    });

    const pullsList = vi.fn().mockResolvedValue({ data: [] });

    const checker = new GitHubChecker({ owner, repo, workDir });
    (checker as any).octokit = {
      checks: { listForRef, listSuitesForRef },
      pulls: { list: pullsList, get: vi.fn() },
      repos: { compareCommitsWithBasehead: vi.fn() },
    };
    (checker as any).log = noopLog;
    vi.spyOn(checker as any, 'sleep').mockResolvedValue(undefined);
    vi.spyOn(checker as any, 'getCurrentBranch').mockReturnValue('main');

    const result = await checker.waitForChecksToPass(sha, 1);

    expect(result).toBe(true);
    expect(listSuitesForRef).toHaveBeenCalledTimes(3);
  });

  it('returns false when check suites fail', async () => {
    const sha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

    const listForRef = vi.fn().mockResolvedValue({
      data: createCheckRunsResponse([
        { id: 1, name: 'CI', status: 'completed', conclusion: 'success', head_sha: sha, app: { id: 15368, name: 'GitHub Actions' } },
      ]),
    });

    const listSuitesForRef = vi.fn().mockResolvedValue({
      data: createCheckSuitesResponse([
        { id: 1, status: 'completed', conclusion: 'failure', head_sha: sha, app: { id: 15368, name: 'GitHub Actions' } },
      ]),
    });

    const pullsList = vi.fn().mockResolvedValue({ data: [] });

    const checker = new GitHubChecker({ owner, repo, workDir });
    (checker as any).octokit = {
      checks: { listForRef, listSuitesForRef },
      pulls: { list: pullsList, get: vi.fn() },
      repos: { compareCommitsWithBasehead: vi.fn() },
    };
    (checker as any).log = noopLog;
    vi.spyOn(checker as any, 'sleep').mockResolvedValue(undefined);
    vi.spyOn(checker as any, 'getCurrentBranch').mockReturnValue('main');

    const result = await checker.waitForChecksToPass(sha, 1);

    expect(result).toBe(false);
  });

  it('returns false when check suite requires action', async () => {
    const sha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

    const listForRef = vi.fn().mockResolvedValue({
      data: createCheckRunsResponse([
        { id: 1, name: 'CI', status: 'completed', conclusion: 'success', head_sha: sha, app: { id: 15368, name: 'GitHub Actions' } },
      ]),
    });

    const listSuitesForRef = vi.fn().mockResolvedValue({
      data: createCheckSuitesResponse([
        { id: 1, status: 'completed', conclusion: 'action_required', head_sha: sha, app: { id: 15368, name: 'GitHub Actions' } },
      ]),
    });

    const pullsList = vi.fn().mockResolvedValue({ data: [] });

    const checker = new GitHubChecker({ owner, repo, workDir });
    (checker as any).octokit = {
      checks: { listForRef, listSuitesForRef },
      pulls: { list: pullsList, get: vi.fn() },
      repos: { compareCommitsWithBasehead: vi.fn() },
    };
    (checker as any).log = noopLog;
    vi.spyOn(checker as any, 'sleep').mockResolvedValue(undefined);
    vi.spyOn(checker as any, 'getCurrentBranch').mockReturnValue('main');

    const result = await checker.waitForChecksToPass(sha, 1);

    expect(result).toBe(false);
  });

  it('passes when no check suites exist', async () => {
    const sha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

    const listForRef = vi.fn().mockResolvedValue({
      data: createCheckRunsResponse([
        { id: 1, name: 'CI', status: 'completed', conclusion: 'success', head_sha: sha, app: { id: 15368, name: 'GitHub Actions' } },
      ]),
    });

    const listSuitesForRef = vi.fn().mockResolvedValue({
      data: createCheckSuitesResponse([]),
    });

    const pullsList = vi.fn().mockResolvedValue({ data: [] });

    const checker = new GitHubChecker({ owner, repo, workDir });
    (checker as any).octokit = {
      checks: { listForRef, listSuitesForRef },
      pulls: { list: pullsList, get: vi.fn() },
      repos: { compareCommitsWithBasehead: vi.fn() },
    };
    (checker as any).log = noopLog;
    vi.spyOn(checker as any, 'sleep').mockResolvedValue(undefined);
    vi.spyOn(checker as any, 'getCurrentBranch').mockReturnValue('main');

    const result = await checker.waitForChecksToPass(sha, 1);

    expect(result).toBe(true);
    expect(listSuitesForRef).toHaveBeenCalledTimes(1);
  });
});

describe('GitHubChecker getDefaultBranch', () => {
  const owner = 'forketyfork';
  const repo = 'stepcat';
  const workDir = process.cwd();

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the default branch from the API', async () => {
    const checker = new GitHubChecker({ owner, repo, workDir });
    (checker as any).octokit = {
      repos: {
        get: vi.fn().mockResolvedValue({ data: { default_branch: 'develop' } }),
      },
    };
    (checker as any).log = noopLog;

    const result = await checker.getDefaultBranch();

    expect(result).toBe('develop');
  });

  it('falls back to main when API fails', async () => {
    const checker = new GitHubChecker({ owner, repo, workDir });
    (checker as any).octokit = {
      repos: {
        get: vi.fn().mockRejectedValue(new Error('Not found')),
      },
    };
    (checker as any).log = noopLog;

    const result = await checker.getDefaultBranch();

    expect(result).toBe('main');
  });
});

describe('GitHubChecker createPullRequest', () => {
  const owner = 'forketyfork';
  const repo = 'stepcat';
  const workDir = process.cwd();

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a pull request and returns details', async () => {
    const checker = new GitHubChecker({ owner, repo, workDir });
    (checker as any).octokit = {
      repos: {
        get: vi.fn().mockResolvedValue({ data: { default_branch: 'main' } }),
      },
      pulls: {
        create: vi.fn().mockResolvedValue({
          data: {
            number: 42,
            html_url: 'https://github.com/forketyfork/stepcat/pull/42',
            head: { sha: 'abc123' },
          },
        }),
      },
    };
    (checker as any).log = noopLog;
    vi.spyOn(checker, 'getCurrentBranch').mockReturnValue('feature/test');

    const result = await checker.createPullRequest('Test PR', 'Test body');

    expect(result).toEqual({
      number: 42,
      url: 'https://github.com/forketyfork/stepcat/pull/42',
      headSha: 'abc123',
    });
  });

  it('throws when on detached HEAD', async () => {
    const checker = new GitHubChecker({ owner, repo, workDir });
    (checker as any).log = noopLog;
    vi.spyOn(checker, 'getCurrentBranch').mockReturnValue('HEAD');

    await expect(checker.createPullRequest('Test PR', 'Test body')).rejects.toThrow(
      'Cannot create pull request: not on a branch'
    );
  });

  it('uses provided base branch instead of default', async () => {
    const checker = new GitHubChecker({ owner, repo, workDir });
    const createMock = vi.fn().mockResolvedValue({
      data: {
        number: 1,
        html_url: 'https://github.com/forketyfork/stepcat/pull/1',
        head: { sha: 'def456' },
      },
    });
    (checker as any).octokit = {
      pulls: { create: createMock },
    };
    (checker as any).log = noopLog;
    vi.spyOn(checker, 'getCurrentBranch').mockReturnValue('feature/branch');

    await checker.createPullRequest('PR Title', 'PR body', 'develop');

    expect(createMock).toHaveBeenCalledWith({
      owner: 'forketyfork',
      repo: 'stepcat',
      title: 'PR Title',
      body: 'PR body',
      head: 'feature/branch',
      base: 'develop',
    });
  });
});
