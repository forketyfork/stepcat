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
    '^@octokit/(.*)$': '<rootDir>/backend/__mocks__/@octokit/$1.ts'
  }
};
