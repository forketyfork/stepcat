export class Octokit {
  constructor(_options?: unknown) {}

  checks = {
    listForRef: jest.fn().mockResolvedValue({ data: { check_runs: [] } }),
  };

  repos = {
    getCommit: jest.fn(),
  };

  git = {
    getRef: jest.fn(),
  };
}
