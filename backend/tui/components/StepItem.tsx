import React from 'react';
import { Box, Text } from 'ink';
import { DbStep, Iteration, Issue } from '../../models.js';
import { IterationItem } from './IterationItem.js';

interface StepItemProps {
  step: DbStep;
  iterations: Iteration[];
  issues: Map<number, Issue[]>;
}

export const StepItem: React.FC<StepItemProps> = ({ step, iterations, issues }) => {
  const getStatusIcon = (status: string): string => {
    switch (status) {
      case 'pending': return '○';
      case 'in_progress': return '◉';
      case 'completed': return '✓';
      case 'failed': return '✗';
      default: return '·';
    }
  };

  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'pending': return 'gray';
      case 'in_progress': return 'cyan';
      case 'completed': return 'green';
      case 'failed': return 'red';
      default: return 'white';
    }
  };

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text bold color={getStatusColor(step.status)}>
          {getStatusIcon(step.status)}
        </Text>
        <Text bold> Step {step.stepNumber}: </Text>
        <Text>{step.title}</Text>
      </Box>

      {iterations.length > 0 && (
        <Box flexDirection="column" marginTop={0}>
          {iterations.map((iteration, index) => {
            const displayNumber = index + 1;
            return (
              <IterationItem
                key={iteration.id}
                iteration={iteration}
                issues={issues.get(iteration.id) || []}
                displayNumber={displayNumber}
              />
            );
          })}
        </Box>
      )}
    </Box>
  );
};
