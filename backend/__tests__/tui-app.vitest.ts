import React from 'react';
import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';
import { App } from '../tui/components/App.js';
import { TUIState, initialState } from '../tui/types.js';

describe('TUI App log rendering', () => {
  it('displays log messages when available', () => {
    const state: TUIState = {
      ...initialState,
      logs: [
        {
          level: 'info',
          message: 'Test log entry\nfor display',
          timestamp: new Date('2024-01-01T10:45:54Z').getTime(),
        },
      ],
      terminalWidth: 80,
      terminalHeight: 24,
      stateVersion: initialState.stateVersion + 1,
      steps: [],
      iterations: new Map(),
      issues: new Map(),
    };

    const { lastFrame, unmount } = render(
      React.createElement(App, {
        state,
        onStateChange: () => {},
        onRequestStopAfterStep: () => {},
      })
    );

    try {
      expect(lastFrame()).toContain('Test log entry for display');
    } finally {
      unmount();
    }
  });
});
