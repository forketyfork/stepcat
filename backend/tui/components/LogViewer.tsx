import React from 'react';
import { Box, Text } from 'ink';
import { LogViewerItem } from '../types.js';

interface LogViewerProps {
  items: LogViewerItem[];
  selectedIndex: number;
  terminalWidth: number;
  terminalHeight: number;
}

export const LogViewer: React.FC<LogViewerProps> = React.memo(({
  items,
  selectedIndex,
  terminalWidth,
  terminalHeight,
}) => {
  const HEADER_HEIGHT = 3;
  const FOOTER_HEIGHT = 2;
  const availableHeight = Math.max(3, terminalHeight - HEADER_HEIGHT - FOOTER_HEIGHT);

  const panelWidth = Math.max(4, terminalWidth);
  const innerWidth = Math.max(0, panelWidth - 2);

  const title = 'Log Viewer - Select a log to view';
  const titlePad = Math.max(0, innerWidth - 1 - title.length);
  const topLine =
    innerWidth > 0
      ? `┌─${title}${titlePad > 0 ? '─'.repeat(titlePad) : ''}┐`
      : '┌┐';
  const bottomLine =
    innerWidth > 0
      ? `└${'─'.repeat(innerWidth)}┘`
      : '└┘';

  const startIndex = Math.max(0, Math.min(selectedIndex - Math.floor(availableHeight / 2), items.length - availableHeight));
  const endIndex = Math.min(items.length, startIndex + availableHeight);
  const visibleItems = items.slice(startIndex, endIndex);

  const rows = visibleItems.map((item, idx) => {
    const actualIndex = startIndex + idx;
    const isSelected = actualIndex === selectedIndex;

    const logTypeLabel = item.logType === 'implementation' ? 'Implementation' : 'Review';
    const agentName = item.logType === 'implementation'
      ? (item.iteration.implementationAgent === 'claude' ? 'Claude Code' : 'Codex')
      : (item.iteration.reviewAgent === 'claude' ? 'Claude Code' : 'Codex');

    const hasContent = Boolean(item.logContent);
    const statusLabel = hasContent ? '' : ' (no log)';

    let text = `Step ${item.stepNumber}, Iter #${item.iterationNumber} - ${logTypeLabel} [${agentName}]${statusLabel}`;

    if (text.length > innerWidth - 2) {
      if (innerWidth <= 2) {
        text = '';
      } else if (innerWidth === 3) {
        text = '…';
      } else {
        text = `${text.slice(0, innerWidth - 3)}…`;
      }
    }

    const padding = ' '.repeat(Math.max(0, innerWidth - text.length - 2));

    return (
      <Box key={item.id} width={panelWidth}>
        <Text>│</Text>
        <Text color={isSelected ? 'cyan' : undefined} inverse={isSelected}>
          {isSelected ? '▶ ' : '  '}
          {text}
          {padding}
        </Text>
        <Text>│</Text>
      </Box>
    );
  });

  while (rows.length < availableHeight) {
    rows.push(
      <Box key={`padding-${rows.length}`} width={panelWidth}>
        <Text>│</Text>
        <Text>{' '.repeat(innerWidth)}</Text>
        <Text>│</Text>
      </Box>
    );
  }

  const footer = '↑↓: Navigate | Enter: View log | Esc: Back';
  const footerPad = Math.max(0, innerWidth - footer.length - 2);

  return (
    <Box flexDirection="column" width={terminalWidth} height={terminalHeight}>
      <Box flexDirection="column" width={panelWidth}>
        <Text>{topLine}</Text>
        {rows}
        <Text>{bottomLine}</Text>
        <Box width={panelWidth}>
          <Text> {footer}{' '.repeat(footerPad)} </Text>
        </Box>
      </Box>
    </Box>
  );
});
