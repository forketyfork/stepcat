import React from 'react';
import { Box, Text } from 'ink';
import { TUIState } from '../types.js';
import { Header } from './Header.js';
import { StepItem } from './StepItem.js';
import { ITERATION_DISPLAY_HEIGHT } from './IterationItem.js';
import { DbStep, Iteration } from '../../models.js';

interface AppProps {
  state: TUIState;
}

const STEP_SPACING = 1;
const LOG_LINES_TO_DISPLAY = 5;
const LOG_PANEL_HEIGHT = LOG_LINES_TO_DISPLAY + 2; // title + log rows
const HEADER_BASE_HEIGHT = 5;

const calculateStepHeight = (_step: DbStep, iterations: Iteration[]): number => {
  const stepIterations = iterations ?? [];
  return 1 + (stepIterations.length * ITERATION_DISPLAY_HEIGHT) + STEP_SPACING;
};

export const App: React.FC<AppProps> = ({ state }) => {
  const headerHeight = HEADER_BASE_HEIGHT + 1; // +1 for spacing after header
  const showCurrentPhase = Boolean(state.currentPhase && !state.isComplete && !state.error);
  const currentPhaseHeight = showCurrentPhase ? 1 : 0;
  const showLoading = state.steps.length === 0 && !state.error;
  const loadingHeight = showLoading ? 1 : 0;
  const showCompletion = state.isComplete && !state.error;
  const completionHeight = showCompletion ? 1 : 0;
  const errorHeight = state.error ? 3 : 0; // double border box
  const errorSpacing = state.error && showCurrentPhase ? 1 : 0;
  const completionSpacing = showCompletion && (showCurrentPhase || state.error) ? 1 : 0;
  const loadingSpacing =
    showLoading && (showCurrentPhase || state.error || showCompletion) ? 1 : 0;
  const reservedHeight =
    headerHeight +
    currentPhaseHeight +
    errorHeight +
    errorSpacing +
    completionHeight +
    completionSpacing +
    loadingHeight +
    loadingSpacing +
    LOG_PANEL_HEIGHT;

  const stepsAreaHeight = Math.max(1, state.terminalHeight - reservedHeight);

  const { visibleSteps, reserveMessageLine } = React.useMemo(() => {
    const computeVisible = (heightLimit: number): DbStep[] => {
      if (state.steps.length === 0) return [];

      let totalHeight = 0;
      const stepsToShow: DbStep[] = [];

      for (let i = state.steps.length - 1; i >= 0; i--) {
        const step = state.steps[i];
        const iterations = state.iterations.get(step.id) || [];
        const stepHeight = calculateStepHeight(step, iterations);
        const willFit = totalHeight + stepHeight <= heightLimit;

        if (willFit || stepsToShow.length === 0) {
          stepsToShow.unshift(step);
          totalHeight += stepHeight;
        } else {
          break;
        }
      }

      return stepsToShow;
    };

    const initialSteps = computeVisible(stepsAreaHeight);

    if (initialSteps.length === state.steps.length) {
      return { visibleSteps: initialSteps, reserveMessageLine: false };
    }

    const adjustedSteps = computeVisible(Math.max(1, stepsAreaHeight - 1));
    return { visibleSteps: adjustedSteps, reserveMessageLine: true };
  }, [state.steps, state.iterations, stepsAreaHeight, state.stateVersion]);

  const hiddenStepsCount = Math.max(0, state.steps.length - visibleSteps.length);
  const showHiddenStepsMessage = reserveMessageLine && hiddenStepsCount > 0;

  const logEntries = state.logs.slice(-LOG_LINES_TO_DISPLAY);
  const hasLogs = logEntries.length > 0;
  const logMessageRows = hasLogs ? 0 : 1;
  const emptyLogRows = Math.max(0, LOG_LINES_TO_DISPLAY - logEntries.length - logMessageRows);

  return (
    <Box flexDirection="column" width={state.terminalWidth} height={state.terminalHeight}>
      <Box flexDirection="column" flexShrink={0}>
        <Box marginBottom={1}>
          <Header state={state} />
        </Box>

        {showCurrentPhase && (
          <Box>
            <Text dimColor>Current: </Text>
            <Text color="cyan">{state.currentPhase}</Text>
          </Box>
        )}

        {state.error && (
          <Box
            borderStyle="double"
            borderColor="red"
            paddingX={1}
            marginTop={errorSpacing ? 1 : 0}
          >
            <Text bold color="red">ERROR: </Text>
            <Text color="red">{state.error}</Text>
          </Box>
        )}

        {showCompletion && (
          <Box marginTop={completionSpacing ? 1 : 0}>
            <Text color="green">✓ All steps completed successfully!</Text>
          </Box>
        )}

        {showLoading && (
          <Box marginTop={loadingSpacing ? 1 : 0}>
            <Text dimColor>Loading steps...</Text>
          </Box>
        )}
      </Box>

      <Box flexDirection="column" flexGrow={1} height={stepsAreaHeight} minHeight={1}>
        {showHiddenStepsMessage && (
          <Box>
            <Text dimColor>... ({hiddenStepsCount} earlier steps hidden)</Text>
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

      <Box
        flexDirection="column"
        borderStyle="single"
        borderColor="gray"
        paddingX={1}
        height={LOG_PANEL_HEIGHT}
        flexShrink={0}
      >
        <Text bold>Recent Logs:</Text>
        {hasLogs
          ? logEntries.map((log, idx) => (
              <Box key={`${log.timestamp}-${idx}`}>
                <Text dimColor>[{new Date(log.timestamp).toLocaleTimeString()}] </Text>
                <Text
                  color={
                    log.level === 'error'
                      ? 'red'
                      : log.level === 'warn'
                      ? 'yellow'
                      : log.level === 'success'
                      ? 'green'
                      : 'white'
                  }
                >
                  {log.message}
                </Text>
              </Box>
            ))
          : (
            <Box>
              <Text dimColor>No logs yet</Text>
            </Box>
          )}
        {Array.from({ length: emptyLogRows }).map((_, idx) => (
          <Box key={`log-placeholder-${idx}`}>
            <Text dimColor> </Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
};
