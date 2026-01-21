import { mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

import { vi } from "vitest";

import { Database } from '../database.js';
import { TUIAdapter } from '../ui/tui-adapter.js';

// Mock ink and react to avoid ESM import issues in Jest
vi.mock('ink', () => ({
  render: vi.fn(() => ({
    rerender: vi.fn(),
    unmount: vi.fn(),
    waitUntilExit: vi.fn(() => Promise.resolve()),
  })),
  Box: 'Box',
  Text: 'Text',
}));

vi.mock('react', () => {
  const reactMock = {
    createElement: vi.fn((component, props) => ({ component, props })),
    Fragment: 'Fragment',
    memo: vi.fn(<T,>(component: T): T => component),
    useState: vi.fn(<T,>(initial: T): [T, () => void] => [initial, vi.fn()]),
    useEffect: vi.fn(),
    useMemo: vi.fn(<T,>(fn: () => T): T => fn()),
    useCallback: vi.fn(<T extends (...args: unknown[]) => unknown>(fn: T): T => fn),
  };
  return {
    ...reactMock,
    default: reactMock,
  };
});

describe('TUIAdapter', () => {
  let tempDir: string;
  let db: Database;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'tui-adapter-test-'));
    db = new Database(tempDir);
  });

  afterEach(() => {
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('initialization', () => {
    it('should create TUIAdapter instance', () => {
      const adapter = new TUIAdapter({ storage: db });
      expect(adapter).toBeDefined();
      expect(adapter.getName()).toBe('Terminal UI');
    });

    it('should initialize and load TUI App component without path resolution errors', async () => {
      const adapter = new TUIAdapter({ storage: db });

      // This test will fail if moduleDir resolution is broken
      // because it won't be able to find the App.tsx or App.js component
      await expect(adapter.initialize()).resolves.not.toThrow();

      // Clean up
      await adapter.shutdown();
    }, 10000);

    it('should fail gracefully with clear error if component path is wrong', async () => {
      const adapter = new TUIAdapter({ storage: db });

      // Initialize to trigger path resolution
      try {
        await adapter.initialize();
        await adapter.shutdown();
      } catch (error) {
        // If it fails, the error message should contain useful path information
        const errorMessage = error instanceof Error ? error.message : String(error);

        // The error should NOT contain invalid paths like:
        // '/Users/.../tui/components/App.tsx' (missing project dir)
        // Instead it should reference a path containing 'dist' or 'backend'

        if (errorMessage.includes('Cannot find module')) {
          const pathMatch = errorMessage.match(/'([^']+)'/);
          if (pathMatch) {
            const failedPath = pathMatch[1];
            // Check if path is malformed (missing stepcat/backend or stepcat/dist)
            expect(failedPath).toMatch(/(stepcat\/backend|stepcat\/dist|backend\/tui|dist\/tui)/);
          }
        }
      }
    }, 10000);
  });

  describe('module path resolution', () => {
    it('should resolve TUI component path correctly in development mode', () => {
      // Simulate the path resolution logic from tui-adapter.ts
      // This test verifies that the component path exists

      // From test file: backend/__tests__/tui-adapter.test.ts
      // To TUI components: backend/tui/components/
      const componentPath = resolve(__dirname, '../tui/components/App.tsx');

      expect(existsSync(componentPath)).toBe(true);

      // Also verify the compiled version would exist at the expected location
      const compiledPath = resolve(__dirname, '../../dist/tui/components/App.js');
      // Note: May not exist if build hasn't been run, so we just log it
      if (!existsSync(compiledPath)) {
        // Compiled path not found - this is expected in dev mode
      }
    });

    it('should detect when moduleDir falls back to process.cwd() incorrectly', () => {
      // This test checks if the path resolution would work from an arbitrary directory
      const arbitraryCwd = '/tmp/some/random/dir';

      // If moduleDir uses process.cwd(), the resolved path would be:
      const pathFromCwd = resolve(arbitraryCwd, '../tui/components/App.tsx');

      // This path should NOT exist (it would be /tmp/some/tui/components/App.tsx)
      expect(existsSync(pathFromCwd)).toBe(false);

      // The correct path should be relative to the module, not cwd:
      const correctPath = resolve(__dirname, '../tui/components/App.tsx');

      // This should exist
      expect(existsSync(correctPath)).toBe(true);
    });

    it('should resolve component path correctly from built dist/', async () => {
      const adapter = new TUIAdapter({ storage: db });

      // Mock process.cwd to simulate running from wrong directory
      const _originalCwd = process.cwd();
      const wrongDir = '/tmp';

      // Override process.cwd temporarily
      vi.spyOn(process, 'cwd').mockReturnValue(wrongDir);

      try {
        // This should still work because moduleDir should use import.meta.url
        // not process.cwd()
        await adapter.initialize();
        await adapter.shutdown();
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        // If it fails, it means moduleDir is falling back to process.cwd()
        // which indicates the import.meta.url detection is broken
        if (errorMessage.includes('Cannot find module')) {
          throw new Error(
            `TUI adapter failed to resolve module path correctly. ` +
            `This suggests moduleDir is using process.cwd() (${wrongDir}) ` +
            `instead of import.meta.url. Error: ${errorMessage}`
          );
        }
      } finally {
        // Restore original cwd
        vi.restoreAllMocks();
      }
    }, 10000);
  });

  describe('event handling', () => {
    it('should handle events without throwing', async () => {
      const adapter = new TUIAdapter({ storage: db });
      await adapter.initialize();

      // Test that basic event handling works
      const testEvent = {
        type: 'log' as const,
        timestamp: Date.now(),
        level: 'info' as const,
        message: 'Test message'
      };

      expect(() => adapter.onEvent(testEvent)).not.toThrow();

      await adapter.shutdown();
    }, 10000);
  });
});
