import React from 'react';
import { Box, Text, useInput } from 'ink';
import { TUIState, LogViewerItem } from '../types.js';
import { Header } from './Header.js';
import { LogViewer } from './LogViewer.js';
import { LogPanel } from './LogPanel.js';
import { DbStep, Iteration } from '../../models.js';

interface AppProps {
  state: TUIState;
  onStateChange: () => void;
}

const LOG_PANEL_HEIGHT = 7; // 5 lines + 2 borders
const HEADER_BASE_HEIGHT = 5;
const STEP_PANEL_LABEL = 'Steps';

type GradientHighlight = {
  word: string;
  startColor: string;
  endColor: string;
};

type StepLine = {
  key: string;
  text: string;
  color?: string;
  dim?: boolean;
  highlight?: GradientHighlight;
  commitHash?: string;
};


const getStepStatusIcon = (status: DbStep['status']): string => {
  switch (status) {
    case 'pending':
      return '○';
    case 'in_progress':
      return '◉';
    case 'completed':
      return '✓';
    case 'failed':
      return '✗';
    default:
      return '·';
  }
};

const getStepStatusColor = (status: DbStep['status']): string => {
  switch (status) {
    case 'pending':
      return 'gray';
    case 'in_progress':
      return 'cyan';
    case 'completed':
      return 'green';
    case 'failed':
      return 'red';
    default:
      return 'white';
  }
};

const getIterationStatusIcon = (status: Iteration['status']): string => {
  switch (status) {
    case 'in_progress':
      return '⟳';
    case 'completed':
      return '✓';
    case 'aborted':
      return '⚠';
    case 'failed':
      return '✗';
    default:
      return '·';
  }
};

const getIterationStatusColor = (status: Iteration['status']): string => {
  switch (status) {
    case 'in_progress':
      return 'cyan';
    case 'completed':
      return 'green';
    case 'aborted':
      return 'yellow';
    case 'failed':
      return 'red';
    default:
      return 'gray';
  }
};

const getAgentDisplayName = (agent: 'claude' | 'codex'): string => {
  return agent === 'claude' ? 'Claude Code' : 'Codex';
};

const getOutcomeColor = (status: string | null | undefined): string | undefined => {
  switch (status) {
    case 'passed':
      return 'green';
    case 'failed':
      return 'red';
    case 'merge_conflict':
      return 'red';
    case 'in_progress':
    case 'pending':
      return 'yellow';
    default:
      return undefined;
  }
};

type RGB = { r: number; g: number; b: number };

const hexToRgb = (hex: string): RGB => {
  const normalized = hex.startsWith('#') ? hex.slice(1) : hex;
  const value = normalized.length === 3
    ? normalized.split('').map(char => char + char).join('')
    : normalized;

  const intVal = parseInt(value, 16);
  return {
    r: (intVal >> 16) & 255,
    g: (intVal >> 8) & 255,
    b: intVal & 255,
  };
};

const interpolateColor = (start: RGB, end: RGB, factor: number): string => {
  const clamp = (input: number) => Math.max(0, Math.min(255, Math.round(input)));
  const r = clamp(start.r + (end.r - start.r) * factor);
  const g = clamp(start.g + (end.g - start.g) * factor);
  const b = clamp(start.b + (end.b - start.b) * factor);
  return `#${[r, g, b].map(component => component.toString(16).padStart(2, '0')).join('')}`;
};

const createGradientSegments = (
  text: string,
  startColor: string,
  endColor: string,
  offset: number = 0
): Array<{ char: string; color: string }> => {
  if (text.length === 0) {
    return [];
  }

  const start = hexToRgb(startColor);
  const end = hexToRgb(endColor);

  return text.split('').map((char, index) => {
    const baseFactor = text.length === 1 ? 0 : index / (text.length - 1);
    const shiftedFactor = (baseFactor + offset) % 1;
    const cycleFactor = shiftedFactor < 0.5
      ? shiftedFactor * 2
      : 2 - shiftedFactor * 2;

    return {
      char,
      color: interpolateColor(start, end, cycleFactor),
    };
  });
};

export const App: React.FC<AppProps> = ({ state, onStateChange }) => {
  const [gradientOffset, setGradientOffset] = React.useState(0);

  React.useEffect(() => {
    const interval = setInterval(() => {
      setGradientOffset(prev => (prev + 0.05) % 1);
    }, 100);

    return () => clearInterval(interval);
  }, []);

  const buildLogViewerItems = React.useCallback((): LogViewerItem[] => {
    const items: LogViewerItem[] = [];

    state.steps.forEach(step => {
      const iterations = state.iterations.get(step.id) || [];
      iterations.forEach((iteration, iterationIndex) => {
        const displayNumber = iterationIndex + 1;
        if (iteration.claudeLog) {
          items.push({
            id: `${iteration.id}-impl`,
            stepNumber: step.stepNumber,
            stepTitle: step.title,
            iterationNumber: displayNumber,
            logType: 'implementation',
            logContent: iteration.claudeLog,
            iteration,
          });
        }
        if (iteration.codexLog) {
          items.push({
            id: `${iteration.id}-review`,
            stepNumber: step.stepNumber,
            stepTitle: step.title,
            iterationNumber: displayNumber,
            logType: 'review',
            logContent: iteration.codexLog,
            iteration,
          });
        }
      });
    });

    return items;
  }, [state.steps, state.iterations]);

  useInput((input, key) => {
    if (state.viewMode === 'normal') {
      if ((key.meta && input.toLowerCase() === 'l') || (key.ctrl && input.toLowerCase() === 'l')) {
        state.logViewerItems = buildLogViewerItems();
        state.selectedLogIndex = 0;
        state.viewMode = 'log_viewer';
        state.stateVersion++;
        onStateChange();
      }
    } else if (state.viewMode === 'log_viewer') {
      if (key.escape) {
        state.viewMode = 'normal';
        state.stateVersion++;
        onStateChange();
      } else if (key.upArrow) {
        if (state.selectedLogIndex > 0) {
          state.selectedLogIndex--;
          state.stateVersion++;
          onStateChange();
        }
      } else if (key.downArrow) {
        if (state.selectedLogIndex < state.logViewerItems.length - 1) {
          state.selectedLogIndex++;
          state.stateVersion++;
          onStateChange();
        }
      } else if (key.return) {
        const selectedItem = state.logViewerItems[state.selectedLogIndex];
        if (selectedItem && selectedItem.logContent) {
          state.pendingLogView = selectedItem.logContent;
          state.stateVersion++;
          onStateChange();
        }
      }
    }
  });

  const headerHeight = HEADER_BASE_HEIGHT;
  const showCurrentPhase = Boolean(state.currentPhase && !state.isComplete && !state.error);
  const showCompletion = state.isComplete && !state.error;
  const completionHeight = showCompletion ? 1 : 0;
  const errorHeight = state.error ? 3 : 0; // double border box
  const errorSpacing = state.error && showCurrentPhase ? 1 : 0;
  const completionSpacing = showCompletion && (showCurrentPhase || state.error) ? 1 : 0;
  const reservedHeight =
    headerHeight +
    errorHeight +
    errorSpacing +
    completionHeight +
    completionSpacing +
    LOG_PANEL_HEIGHT;

  const stepsAreaHeight = Math.max(3, state.terminalHeight - reservedHeight);

  const stepsPanelWidth = Math.max(4, state.terminalWidth);
  const stepsInnerWidth = Math.max(0, stepsPanelWidth - 2);
  const stepsLabelCapacity = Math.max(0, stepsInnerWidth - 1);
  let stepsLabel = STEP_PANEL_LABEL;
  if (stepsLabel.length > stepsLabelCapacity) {
    stepsLabel = stepsLabel.slice(0, stepsLabelCapacity);
  }
  const stepsLabelPad = Math.max(0, stepsInnerWidth - 1 - stepsLabel.length);
  const stepsTopLine =
    stepsInnerWidth > 0
      ? `┌─${stepsLabel}${stepsLabelPad > 0 ? '─'.repeat(stepsLabelPad) : ''}┐`
      : '┌┐';
  const stepsBottomLine =
    stepsInnerWidth > 0
      ? `└${'─'.repeat(stepsInnerWidth)}┘`
      : '└┘';

  const allStepLines = React.useMemo<StepLine[]>(() => {
    if (state.steps.length === 0) {
      return [
        {
          key: 'steps-empty',
          text: ' Loading steps...',
          dim: true,
        },
      ];
    }

    const lines: StepLine[] = [];

    state.steps.forEach((step, stepIndex) => {
      const isCurrentStep = step.status === 'in_progress';
      lines.push({
        key: `step-${step.id}`,
        text: ` ${getStepStatusIcon(step.status)} Step ${step.stepNumber}: ${step.title}`,
        color: getStepStatusColor(step.status),
      });

      const iterations = state.iterations.get(step.id) || [];
      iterations.forEach((iteration, iterationIndex) => {
        const displayNumber = iterationIndex + 1;
        const displayNumberText = String(displayNumber);
        lines.push({
          key: `iteration-${iteration.id}-header`,
          text: `   ${getIterationStatusIcon(iteration.status)} Iteration #${displayNumberText}`,
          color: getIterationStatusColor(iteration.status),
        });

        const agentName = getAgentDisplayName(iteration.implementationAgent);
        const implementationLabel = `Implementation [${agentName}]`;
        lines.push({
          key: `iteration-${iteration.id}-implementation`,
          text: `      - ${implementationLabel}`,
          dim: true,
          commitHash: iteration.commitSha ? iteration.commitSha.substring(0, 7) : undefined,
          highlight: iteration.status === 'in_progress'
            ? {
                word: implementationLabel,
                startColor: '#72f1b8',
                endColor: '#2d9ff8',
              }
            : undefined,
        });

        if (iteration.buildStatus) {
          const buildStatusDisplay: Record<NonNullable<Iteration['buildStatus']>, string> = {
            pending: 'Pending',
            in_progress: 'In progress',
            passed: 'OK',
            failed: 'Failed',
            merge_conflict: 'Merge conflict, waiting for resolution',
          };
          const buildActive = isCurrentStep && (iteration.buildStatus === 'pending' || iteration.buildStatus === 'in_progress');
          const buildLabel = `Build: ${buildStatusDisplay[iteration.buildStatus]}`;
          lines.push({
            key: `iteration-${iteration.id}-build`,
            text: `      - ${buildLabel}`,
            color: getOutcomeColor(iteration.buildStatus) ?? undefined,
            highlight: buildActive
              ? {
                  word: buildLabel,
                  startColor: '#fdd070',
                  endColor: '#f78fb3',
                }
              : undefined,
          });
        }

        if (iteration.reviewStatus) {
          const reviewAgentName = iteration.reviewAgent ? getAgentDisplayName(iteration.reviewAgent) : null;
          const reviewLabel = reviewAgentName
            ? `      - Review [${reviewAgentName}]: ${iteration.reviewStatus}`
            : `      - Review: ${iteration.reviewStatus}`;
          const reviewActive = isCurrentStep && (iteration.reviewStatus === 'pending' || iteration.reviewStatus === 'in_progress');

          lines.push({
            key: `iteration-${iteration.id}-review`,
            text: reviewLabel,
            color: getOutcomeColor(iteration.reviewStatus) ?? undefined,
            highlight: reviewActive
              ? {
                  word: reviewAgentName
                    ? `Review [${reviewAgentName}]: ${iteration.reviewStatus}`
                    : `Review: ${iteration.reviewStatus}`,
                  startColor: '#ad7cff',
                  endColor: '#5bd2ff',
                }
              : undefined,
          });
        }

        const issues = state.issues.get(iteration.id) || [];
        const openIssues = issues.filter(issue => issue.status === 'open');
        const fixedIssues = issues.filter(issue => issue.status === 'fixed');

        if (openIssues.length > 0) {
          lines.push({
            key: `iteration-${iteration.id}-open`,
            text: `      ✗ ${openIssues.length} open issue${openIssues.length > 1 ? 's' : ''}`,
            color: 'red',
          });
        }

        if (fixedIssues.length > 0) {
          lines.push({
            key: `iteration-${iteration.id}-fixed`,
            text: `      ✓ ${fixedIssues.length} fixed issue${fixedIssues.length > 1 ? 's' : ''}`,
            color: 'green',
          });
        }
      });

      if (stepIndex !== state.steps.length - 1) {
        lines.push({
          key: `step-${step.id}-separator`,
          text: '',
          dim: true,
        });
      }
    });

    return lines;
  }, [state.steps, state.iterations, state.issues, state.stateVersion]);

  const stepsInnerHeight = Math.max(0, stepsAreaHeight - 2);

  const activeStepLineIndex = React.useMemo(() => {
    const activeStep = state.steps.find(step => step.status === 'in_progress');
    if (!activeStep) return -1;
    return allStepLines.findIndex(line => line.key === `step-${activeStep.id}`);
  }, [allStepLines, state.steps]);

  let stepLinesToRender: StepLine[];
  if (stepsInnerHeight <= 0) {
    stepLinesToRender = [];
  } else if (allStepLines.length <= stepsInnerHeight) {
    stepLinesToRender = allStepLines;
  } else if (activeStepLineIndex === -1) {
    stepLinesToRender = allStepLines.slice(0, stepsInnerHeight);
  } else {
    const activeStepLines: number[] = [];
    const activeStep = state.steps.find(step => step.status === 'in_progress');
    if (activeStep) {
      for (let i = 0; i < allStepLines.length; i++) {
        const line = allStepLines[i];
        if (line.key.startsWith(`step-${activeStep.id}`) ||
            line.key.startsWith(`iteration-`)) {
          const iterations = state.iterations.get(activeStep.id) || [];
          const isActiveStepIteration = iterations.some(it => line.key.startsWith(`iteration-${it.id}`));
          if (line.key.startsWith(`step-${activeStep.id}`) || isActiveStepIteration) {
            activeStepLines.push(i);
          }
        }
      }
    }

    const lastActiveLineIndex = activeStepLines.length > 0
      ? activeStepLines[activeStepLines.length - 1]
      : activeStepLineIndex;

    let endIndex = Math.min(allStepLines.length, lastActiveLineIndex + 1);
    let startIndex = Math.max(0, endIndex - stepsInnerHeight);

    if (activeStepLineIndex < startIndex) {
      startIndex = activeStepLineIndex;
      endIndex = Math.min(allStepLines.length, startIndex + stepsInnerHeight);
    }

    stepLinesToRender = allStepLines.slice(startIndex, endIndex);
  }

  if (stepLinesToRender.length < stepsInnerHeight) {
    const padCount = stepsInnerHeight - stepLinesToRender.length;
    const padding: StepLine[] = Array.from({ length: padCount }, (_, idx) => ({
      key: `step-padding-${idx}`,
      text: '',
      dim: true,
    }));
    stepLinesToRender = [...stepLinesToRender, ...padding];
  }

  const stepsRows = stepLinesToRender.map((line, idx) => {
    const key = `${line.key}-${idx}`;
    const baseColor = line.color;
    const dim = Boolean(line.dim);

    let content = line.text ?? '';
    if (content.length > stepsInnerWidth) {
      if (stepsInnerWidth <= 0) {
        content = '';
      } else if (stepsInnerWidth === 1) {
        content = '…';
      } else {
        content = `${content.slice(0, stepsInnerWidth - 1)}…`;
      }
    }

    const highlight = line.highlight;
    const highlightIndex =
      highlight && content.includes(highlight.word)
        ? content.indexOf(highlight.word)
        : -1;

    const segments: React.ReactNode[] = [];
    let segmentCounter = 0;

    const pushSegment = (
      text: string,
      color: string | undefined,
      dimmed: boolean
    ): void => {
      if (!text) {
        return;
      }
      segments.push(
        <Text key={`seg-${key}-${segmentCounter++}`} color={color} dimColor={dimmed}>
          {text}
        </Text>
      );
    };

    if (highlight && highlightIndex >= 0) {
      const before = content.slice(0, highlightIndex);
      const highlightText = content.slice(highlightIndex, highlightIndex + highlight.word.length);
      const after = content.slice(highlightIndex + highlight.word.length);

      pushSegment(before, baseColor, dim);

      const gradientSegments = createGradientSegments(highlightText, highlight.startColor, highlight.endColor, gradientOffset);
      gradientSegments.forEach(({ char, color }) => {
        segments.push(
          <Text key={`grad-${key}-${segmentCounter++}`} color={color}>
            {char}
          </Text>
        );
      });

      pushSegment(after, baseColor, dim);
    } else {
      pushSegment(content, baseColor, dim);
    }

    let displayedLength = content.length;

    if (line.commitHash) {
      const commitText = ` [${line.commitHash}]`;
      if (displayedLength + commitText.length <= stepsInnerWidth) {
        pushSegment(commitText, '#ccaa00', false);
        displayedLength += commitText.length;
      }
    }

    const paddingLength = Math.max(0, stepsInnerWidth - displayedLength);
    if (paddingLength > 0) {
      pushSegment(' '.repeat(paddingLength), baseColor, dim);
    }

    return (
      <Box key={key} width={stepsPanelWidth}>
        <Text>│</Text>
        <Box flexDirection="row">{segments}</Box>
        <Text>│</Text>
      </Box>
    );
  });

  if (state.viewMode === 'log_viewer') {
    return (
      <LogViewer
        items={state.logViewerItems}
        selectedIndex={state.selectedLogIndex}
        terminalWidth={state.terminalWidth}
        terminalHeight={state.terminalHeight}
      />
    );
  }

  return (
    <Box flexDirection="column" width={state.terminalWidth} height={state.terminalHeight}>
      <Box flexDirection="column" flexShrink={0}>
        <Header state={state} />

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
      </Box>

      <Box
        flexDirection="column"
        flexGrow={1}
        height={stepsAreaHeight}
        minHeight={stepsAreaHeight}
        width={stepsPanelWidth}
      >
        <Text>{stepsTopLine}</Text>
        {stepsRows}
        <Text>{stepsBottomLine}</Text>
      </Box>

      <LogPanel logs={state.logs} terminalWidth={state.terminalWidth} />
    </Box>
  );
};
