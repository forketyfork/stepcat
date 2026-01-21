import { Box, Text } from 'ink';
import React from 'react';

const LOG_LINES_TO_DISPLAY = 5;
const LOG_PANEL_LABEL = 'Recent logs';

type LogEntry = {
  level: string;
  message: string;
  timestamp: number;
};

type LogRow = {
  key: string;
  message: string;
  level: 'info' | 'warn' | 'error' | 'success';
  timestamp?: number;
  showPrefix: boolean;
  dim?: boolean;
};

interface LogPanelProps {
  logs: LogEntry[];
  terminalWidth: number;
}

export const LogPanel: React.FC<LogPanelProps> = React.memo(({ logs, terminalWidth }) => {
  const logPanelWidth = Math.max(4, terminalWidth);
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

  const recentLogs = logs.slice(-LOG_LINES_TO_DISPLAY);

  const rows: LogRow[] =
    recentLogs.length > 0
      ? recentLogs.map((log, idx) => {
          const sanitizedMessage = log.message.replace(/[\r\n]+/g, ' ');
          const hasContent = sanitizedMessage.trim().length > 0;
          return {
            key: `${log.timestamp}-${idx}`,
            message: hasContent ? sanitizedMessage : '',
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- fallback for empty string level
            level: (log.level as LogRow['level']) || 'info',
            timestamp: log.timestamp,
            showPrefix: hasContent,
            dim: !hasContent,
          };
        })
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

  const prefixTemplate = '[00:00:00 AM] ';
  const maxPrefixLength = Math.max(
    0,
    Math.min(prefixTemplate.length, logInnerWidth - 2)
  );

  const logRows = rows.slice(0, LOG_LINES_TO_DISPLAY).map(row => {
    const hasMessage = row.message.trim().length > 0;
    const shouldShowPrefix = row.showPrefix && row.timestamp && hasMessage;

    let prefix: string;
    if (shouldShowPrefix && row.timestamp) {
      prefix = `[${new Date(row.timestamp).toLocaleTimeString()}] `;
    } else {
      prefix = ''.padEnd(maxPrefixLength, ' ');
    }

    if (maxPrefixLength === 0) {
      prefix = '';
    } else if (prefix.length > maxPrefixLength) {
      prefix = prefix.slice(prefix.length - maxPrefixLength);
    } else if (prefix.length < maxPrefixLength) {
      prefix = prefix.padEnd(maxPrefixLength, ' ');
    }

    const availableForMessage = Math.max(0, logInnerWidth - 1 - prefix.length);

    let messageText = row.message.replace(/[\r\n]+/g, ' ');
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
    <Box flexDirection="column" flexShrink={0} width={logPanelWidth}>
      <Text>{logTopLine}</Text>
      {logRows}
      <Text>{logBottomLine}</Text>
    </Box>
  );
});
