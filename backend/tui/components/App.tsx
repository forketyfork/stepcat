import React from 'react';
import { Box, Text } from 'ink';
import { TUIState } from '../types.js';
import { Header } from './Header.js';
import { StepItem } from './StepItem.js';

interface AppProps {
  state: TUIState;
}

export const App: React.FC<AppProps> = ({ state }) => {
  return (
    <Box flexDirection="column" width={state.terminalWidth} height={state.terminalHeight}>
      <Header state={state} />

      {state.currentPhase && !state.isComplete && !state.error && (
        <Box marginBottom={1}>
          <Text dimColor>Current: </Text>
          <Text color="cyan">{state.currentPhase}</Text>
        </Box>
      )}

      {state.steps.length === 0 && !state.error ? (
        <Box>
          <Text dimColor>Loading steps...</Text>
        </Box>
      ) : (
        <Box flexDirection="column">
          {state.steps.map(step => (
            <StepItem
              key={step.id}
              step={step}
              iterations={state.iterations.get(step.id) || []}
              issues={state.issues}
            />
          ))}
        </Box>
      )}

      {state.logs.length > 0 && (
        <Box flexDirection="column" marginTop={1} borderStyle="single" borderColor="gray" paddingX={1}>
          <Text bold>Recent Logs:</Text>
          {state.logs.slice(-5).map((log, idx) => (
            <Box key={idx}>
              <Text dimColor>[{new Date(log.timestamp).toLocaleTimeString()}] </Text>
              <Text color={log.level === 'error' ? 'red' : log.level === 'warn' ? 'yellow' : log.level === 'success' ? 'green' : 'white'}>
                {log.message}
              </Text>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
};
