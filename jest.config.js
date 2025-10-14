export default {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/backend'],
  testMatch: ['**/__tests__/**/*.test.ts', '**/?(*.)+(spec|test).ts'],
  testPathIgnorePatterns: [
    '/node_modules/',
    '\\.vitest\\.ts$'
  ],
  collectCoverageFrom: [
    'backend/**/*.ts',
    '!backend/**/*.d.ts'
  ],
  resolver: './jest.resolver.cjs',
  moduleNameMapper: {
    '^@octokit/(.*)$': '<rootDir>/backend/__mocks__/@octokit/$1.ts'
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: {
        module: 'commonjs',
        target: 'ES2022',
        esModuleInterop: true
      },
      diagnostics: {
        ignoreCodes: [1343]
      }
    }]
  }
};
