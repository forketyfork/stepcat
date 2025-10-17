import React from 'react';
import { Box, Text } from 'ink';
import { TUIState } from '../types.js';
import { basename } from 'path';

interface HeaderProps {
  state: TUIState;
}

const createLine = (width: number, start: string, end: string, fill: string): string => {
  const innerWidth = Math.max(0, width - start.length - end.length);
  return start + fill.repeat(innerWidth) + end;
};

export const Header: React.FC<HeaderProps> = ({ state }) => {
  const sortedSteps = [...state.steps].sort((a, b) => a.stepNumber - b.stepNumber);
  const totalSteps = sortedSteps.length;
  const completedByStatus = sortedSteps.filter(s => s.status === 'completed').length;
  const inProgressStep = sortedSteps.find(s => s.status === 'in_progress');
  const inferredCompleted = inProgressStep ? Math.max(0, inProgressStep.stepNumber - 1) : completedByStatus;
  const completedSteps = Math.max(completedByStatus, inferredCompleted);
  const width = state.terminalWidth;
  const planFileName = state.plan?.planFilePath ? basename(state.plan.planFilePath) : 'N/A';

  const topLine = createLine(width, '╔', '╗', '═');
  const middleLine = createLine(width, '╠', '╣', '═');
  const bottomLine = createLine(width, '╚', '╝', '═');

  const title = 'STEPCAT - Step-by-step Agent Orchestration';
  const executionId = state.plan?.id || 'N/A';
  const statsContent = `Execution ID: ${executionId}  │  Steps: ${completedSteps}/${totalSteps}  │  Plan: ${planFileName}`;

  return (
    <Box flexDirection="column">
      <Box>
        <Text bold color="magenta">{topLine}</Text>
      </Box>
      <Box>
        <Text bold color="magenta">║ </Text>
        <Text bold color="cyan">{title}</Text>
        <Text bold color="magenta">{' '.repeat(Math.max(0, width - title.length - 4))} ║</Text>
      </Box>
      <Box>
        <Text bold color="magenta">{middleLine}</Text>
      </Box>
      <Box>
        <Text bold color="magenta">║ </Text>
        <Text>Execution ID: </Text>
        <Text bold color="yellow">{executionId}</Text>
        <Text>  │  Steps: </Text>
        <Text bold color="green">{completedSteps}</Text>
        <Text>/</Text>
        <Text bold color="cyan">{totalSteps}</Text>
        <Text>  │  Plan: </Text>
        <Text bold color="cyan">{planFileName}</Text>
        <Text bold color="magenta">{' '.repeat(Math.max(0, width - statsContent.length - 4))} ║</Text>
      </Box>
      <Box>
        <Text bold color="magenta">{bottomLine}</Text>
      </Box>
    </Box>
  );
};
