import React from 'react';
import { Box, Text } from 'ink';
import { TUIState } from '../types';

interface HeaderProps {
  state: TUIState;
}

export const Header: React.FC<HeaderProps> = ({ state }) => {
  const totalSteps = state.steps.length;
  const completedSteps = state.steps.filter(s => s.status === 'completed').length;
  const remainingSteps = totalSteps - completedSteps;

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text bold color="magenta">╔══════════════════════════════════════════════════════════════════════════════╗</Text>
      </Box>
      <Box>
        <Text bold color="magenta">║ </Text>
        <Text bold color="cyan">STEPCAT - Step-by-step Agent Orchestration</Text>
        <Text bold color="magenta">                                ║</Text>
      </Box>
      <Box>
        <Text bold color="magenta">╠══════════════════════════════════════════════════════════════════════════════╣</Text>
      </Box>
      <Box>
        <Text bold color="magenta">║ </Text>
        <Text>Execution ID: </Text>
        <Text bold color="yellow">{state.plan?.id || 'N/A'}</Text>
        <Text>  │  Steps: </Text>
        <Text bold color="green">{completedSteps}</Text>
        <Text>/</Text>
        <Text bold color="cyan">{totalSteps}</Text>
        <Text>  │  Remaining: </Text>
        <Text bold color="yellow">{remainingSteps}</Text>
        <Text bold color="magenta">                           ║</Text>
      </Box>
      <Box>
        <Text bold color="magenta">╚══════════════════════════════════════════════════════════════════════════════╝</Text>
      </Box>

      {state.error && (
        <Box marginTop={1}>
          <Text bold color="red">✗ Error: {state.error}</Text>
        </Box>
      )}

      {state.isComplete && (
        <Box marginTop={1}>
          <Text bold color="green">✓ All steps completed successfully!</Text>
        </Box>
      )}
    </Box>
  );
};
