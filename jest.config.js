export default {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/backend'],
  testMatch: ['**/__tests__/**/*.ts', '**/?(*.)+(spec|test).ts'],
  collectCoverageFrom: [
    'backend/**/*.ts',
    '!backend/**/*.d.ts'
  ],
  moduleNameMapper: {
    // Map only specific backend JS imports used by tests to TS sources
    '^\.\./database\.js$': '../database.ts',
    '^\.\./step-parser\.js$': '../step-parser.ts',
    '^\.\./orchestrator\.js$': '../orchestrator.ts',
    '^\.\./codex-runner\.js$': '../codex-runner.ts',
    '^\.\./claude-runner\.js$': '../claude-runner.ts',
    '^\.\./prompts\.js$': '../prompts.ts',
    '^@octokit/(.*)$': '<rootDir>/backend/__mocks__/@octokit/$1.ts'
  }
};
