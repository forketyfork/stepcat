import React from 'react';
import { Box, Text } from 'ink';
import { TUIState } from '../types.js';
import { Header } from './Header.js';
import { DbStep, Iteration } from '../../models.js';

interface AppProps {
  state: TUIState;
}

const LOG_LINES_TO_DISPLAY = 5;
const LOG_PANEL_HEIGHT = LOG_LINES_TO_DISPLAY + 2;
const HEADER_BASE_HEIGHT = 5;
const STEP_PANEL_LABEL = 'Steps';
const LOG_PANEL_LABEL = 'Recent logs';

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

type LogRow = {
  key: string;
  message: string;
  level: 'info' | 'warn' | 'error' | 'success';
  timestamp?: number;
  showPrefix: boolean;
  dim?: boolean;
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

export const App: React.FC<AppProps> = ({ state }) => {
  const [gradientOffset, setGradientOffset] = React.useState(0);

  React.useEffect(() => {
    const interval = setInterval(() => {
      setGradientOffset(prev => (prev + 0.05) % 1);
    }, 100);

    return () => clearInterval(interval);
  }, []);

  const headerHeight = HEADER_BASE_HEIGHT + 1; // +1 for spacing after header
  const showCurrentPhase = Boolean(state.currentPhase && !state.isComplete && !state.error);
  const currentPhaseHeight = showCurrentPhase ? 1 : 0;
  const showCompletion = state.isComplete && !state.error;
  const completionHeight = showCompletion ? 1 : 0;
  const errorHeight = state.error ? 3 : 0; // double border box
  const errorSpacing = state.error && showCurrentPhase ? 1 : 0;
  const completionSpacing = showCompletion && (showCurrentPhase || state.error) ? 1 : 0;
  const reservedHeight =
    headerHeight +
    currentPhaseHeight +
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
      lines.push({
        key: `step-${step.id}`,
        text: ` ${getStepStatusIcon(step.status)} Step ${step.stepNumber}: ${step.title}`,
        color: getStepStatusColor(step.status),
      });

      const iterations = state.iterations.get(step.id) || [];
      iterations.forEach(iteration => {
        lines.push({
          key: `iteration-${iteration.id}-header`,
          text: `   ${getIterationStatusIcon(iteration.status)} Iteration #${iteration.iterationNumber}`,
          color: getIterationStatusColor(iteration.status),
        });

        const agentName = getAgentDisplayName(iteration.implementationAgent);
        lines.push({
          key: `iteration-${iteration.id}-implementation`,
          text: `      - Implementation [${agentName}]`,
          dim: true,
          commitHash: iteration.commitSha ? iteration.commitSha.substring(0, 7) : undefined,
          highlight: iteration.status === 'in_progress'
            ? {
                word: 'Implementation',
                startColor: '#72f1b8',
                endColor: '#2d9ff8',
              }
            : undefined,
        });

        if (iteration.buildStatus) {
          lines.push({
            key: `iteration-${iteration.id}-build`,
            text: `      - Build: ${iteration.buildStatus}`,
            color: getOutcomeColor(iteration.buildStatus) ?? undefined,
            highlight: iteration.buildStatus === 'in_progress'
              ? {
                  word: 'Build',
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

          lines.push({
            key: `iteration-${iteration.id}-review`,
            text: reviewLabel,
            color: getOutcomeColor(iteration.reviewStatus) ?? undefined,
            highlight: iteration.reviewStatus === 'in_progress'
              ? {
                  word: 'Review',
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
  let stepLinesToRender =
    stepsInnerHeight > 0 ? allStepLines.slice(-stepsInnerHeight) : ([] as StepLine[]);

  if (stepLinesToRender.length < stepsInnerHeight) {
    const padCount = stepsInnerHeight - stepLinesToRender.length;
    const padding: StepLine[] = Array.from({ length: padCount }, (_, idx) => ({
      key: `step-padding-${idx}`,
      text: '',
      dim: true,
    }));
    stepLinesToRender = [...padding, ...stepLinesToRender];
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

  const logPanelWidth = Math.max(4, state.terminalWidth);
  const logInnerWidth = Math.max(0, logPanelWidth - 2);
  const logLabelCapacity = Math.max(0, logInnerWidth - 1);

  let logLabel = LOG_PANEL_LABEL;
  if (logLabel.length > logLabelCapacity) {
    logLabel = logLabel.slice(0, logLabelCapacity);
  }
  const logLabelPad = Math.max(0, logInnerWidth - 1 - logLabel.length);

  const logTopLine =
    logInnerWidth > 0
      ? `┌─${logLabel}${logLabelPad > 0 ? '─'.repeat(logLabelPad) : ''}┐`
      : '┌┐';
  const logBottomLine =
    logInnerWidth > 0
      ? `└${'─'.repeat(logInnerWidth)}┘`
      : '└┘';

  const recentLogs = state.logs.slice(-LOG_LINES_TO_DISPLAY);

  const rows: LogRow[] =
    recentLogs.length > 0
      ? recentLogs.map((log, idx) => ({
          key: `${log.timestamp}-${idx}`,
          message: log.message,
          level: (log.level as LogRow['level']) ?? 'info',
          timestamp: log.timestamp,
          showPrefix: true,
        }))
      : [
          {
            key: 'log-empty',
            message: 'No logs yet',
            level: 'info',
            showPrefix: false,
            dim: true,
          },
        ];

  while (rows.length < LOG_LINES_TO_DISPLAY) {
    rows.push({
      key: `log-placeholder-${rows.length}`,
      message: '',
      level: 'info',
      showPrefix: false,
      dim: true,
    });
  }

  const maxPrefixLength = Math.max(0, logInnerWidth - 1);
  const prefixTemplate = '[00:00:00] ';

  const logRows = rows.slice(0, LOG_LINES_TO_DISPLAY).map(row => {
    let prefix = row.showPrefix && row.timestamp
      ? `[${new Date(row.timestamp).toLocaleTimeString()}] `
      : ''.padEnd(prefixTemplate.length, ' ');

    if (prefix.length > maxPrefixLength) {
      prefix = prefix.slice(prefix.length - maxPrefixLength);
    } else if (prefix.length < maxPrefixLength) {
      prefix = prefix.padEnd(maxPrefixLength, ' ');
    }

    const availableForMessage = Math.max(0, logInnerWidth - 1 - prefix.length);

    let messageText = row.message ?? '';
    if (messageText.length > availableForMessage) {
      if (availableForMessage <= 0) {
        messageText = '';
      } else if (availableForMessage === 1) {
        messageText = '…';
      } else {
        messageText = `${messageText.slice(0, availableForMessage - 1)}…`;
      }
    }

    const padding = ' '.repeat(Math.max(0, availableForMessage - messageText.length));

    const messageColor =
      row.dim || (!row.showPrefix && row.message === '')
        ? undefined
        : row.level === 'error'
        ? 'red'
        : row.level === 'warn'
        ? 'yellow'
        : row.level === 'success'
        ? 'green'
        : 'white';

    return (
      <Box key={row.key} width={logPanelWidth}>
        <Text>│</Text>
        <Text> </Text>
        <Text dimColor>{prefix}</Text>
        <Text color={messageColor} dimColor={row.dim && row.message.length > 0}>
          {messageText}
        </Text>
        <Text>{padding}</Text>
        <Text>│</Text>
      </Box>
    );
  });

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

      <Box flexDirection="column" flexShrink={0} width={logPanelWidth}>
        <Text>{logTopLine}</Text>
        {logRows}
        <Text>{logBottomLine}</Text>
      </Box>
    </Box>
  );
};
