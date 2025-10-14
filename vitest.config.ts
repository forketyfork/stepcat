import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['backend/__tests__/**/*.vitest.ts'],
    globals: true,
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['backend/**/*.ts'],
      exclude: ['backend/**/*.d.ts', 'backend/**/__tests__/**']
    }
  }
});
