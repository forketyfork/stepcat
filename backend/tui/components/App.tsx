import React from 'react';
import { Box, Text } from 'ink';
import { TUIState } from '../types.js';
import { Header } from './Header.js';
import { StepItem } from './StepItem.js';
import { DbStep, Iteration, Issue } from '../../models.js';

interface AppProps {
  state: TUIState;
}

const calculateStepHeight = (step: DbStep, iterations: Iteration[], issues: Map<number, Issue[]>): number => {
  let height = 1;

  const stepIterations = iterations || [];
  stepIterations.forEach(iteration => {
    height += 1;
    height += 1;
    if (iteration.buildStatus) height += 1;
    if (iteration.reviewStatus) height += 1;

    const iterationIssues = issues.get(iteration.id) || [];
    const openIssues = iterationIssues.filter(i => i.status === 'open');
    const fixedIssues = iterationIssues.filter(i => i.status === 'fixed');
    if (openIssues.length > 0) height += 1;
    if (fixedIssues.length > 0) height += 1;
  });

  return height;
};

export const App: React.FC<AppProps> = ({ state }) => {
  const headerHeight = 7;
  const errorHeight = state.error ? 3 : 0;
  const currentPhaseHeight = (state.currentPhase && !state.isComplete && !state.error) ? 2 : 0;
  const logsHeight = state.logs.length > 0 ? 8 : 0;
  const loadingHeight = state.steps.length === 0 && !state.error ? 1 : 0;

  const overheadHeight = headerHeight + errorHeight + currentPhaseHeight + logsHeight + loadingHeight;
  const availableHeight = Math.max(10, state.terminalHeight - overheadHeight);

  const visibleSteps = React.useMemo(() => {
    if (state.steps.length === 0) return [];

    let totalHeight = 0;
    const stepsToShow = [];

    for (let i = state.steps.length - 1; i >= 0; i--) {
      const step = state.steps[i];
      const iterations = state.iterations.get(step.id) || [];
      const stepHeight = calculateStepHeight(step, iterations, state.issues);

      if (totalHeight + stepHeight <= availableHeight) {
        stepsToShow.unshift(step);
        totalHeight += stepHeight;
      } else {
        break;
      }
    }

    return stepsToShow;
  }, [state.steps, state.iterations, state.issues, availableHeight, state.stateVersion]);

  return (
    <Box flexDirection="column" width={state.terminalWidth} height={state.terminalHeight}>
      <Box flexDirection="column">
        <Header state={state} />

        {state.error && (
          <Box marginBottom={1} borderStyle="double" borderColor="red" paddingX={1}>
            <Text bold color="red">ERROR: </Text>
            <Text color="red">{state.error}</Text>
          </Box>
        )}

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
          <Box flexDirection="column" height={availableHeight}>
            {visibleSteps.length < state.steps.length && (
              <Box marginBottom={1}>
                <Text dimColor>... ({state.steps.length - visibleSteps.length} earlier steps hidden)</Text>
              </Box>
            )}
            {visibleSteps.map(step => (
              <StepItem
                key={step.id}
                step={step}
                iterations={state.iterations.get(step.id) || []}
                issues={state.issues}
              />
            ))}
          </Box>
        )}
      </Box>

      {state.logs.length > 0 && (
        <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1}>
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
