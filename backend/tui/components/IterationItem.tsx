import React from 'react';
import { Box, Text } from 'ink';
import { Iteration, Issue } from '../../models.js';

export const ITERATION_DISPLAY_HEIGHT = 6;

interface IterationItemProps {
  iteration: Iteration;
  issues: Issue[];
}

export const IterationItem: React.FC<IterationItemProps> = ({ iteration, issues }) => {
  const getAgentDisplayName = (agent: 'claude' | 'codex'): string => {
    return agent === 'claude' ? 'Claude Code' : 'Codex';
  };

  const getStatusIcon = (status: string): string => {
    switch (status) {
      case 'in_progress': return '⟳';
      case 'completed': return '✓';
      case 'aborted': return '⚠';
      case 'failed': return '✗';
      default: return '·';
    }
  };

  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'in_progress': return 'cyan';
      case 'completed': return 'green';
      case 'aborted': return 'yellow';
      case 'failed': return 'red';
      default: return 'gray';
    }
  };

  const openIssues = issues.filter(i => i.status === 'open');
  const fixedIssues = issues.filter(i => i.status === 'fixed');

  return (
    <Box flexDirection="column" marginLeft={4}>
      <Box>
        <Text color={getStatusColor(iteration.status)}>
          {getStatusIcon(iteration.status)}
        </Text>
        <Text> Iteration #{iteration.iterationNumber}</Text>
      </Box>

      <Box marginLeft={2}>
        <Text dimColor>- Implementation [</Text>
        <Text dimColor>{getAgentDisplayName(iteration.implementationAgent)}</Text>
        <Text dimColor>]</Text>
        {iteration.commitSha && (
          <>
            <Text dimColor> (</Text>
            <Text dimColor color="yellow">{iteration.commitSha.substring(0, 7)}</Text>
            <Text dimColor>)</Text>
          </>
        )}
      </Box>

      <Box marginLeft={2}>
        {iteration.buildStatus ? (
          <>
            <Text dimColor>- Build: </Text>
            <Text color={iteration.buildStatus === 'passed' ? 'green' : iteration.buildStatus === 'failed' ? 'red' : 'yellow'}>
              {iteration.buildStatus}
            </Text>
          </>
        ) : (
          <Text> </Text>
        )}
      </Box>

      <Box marginLeft={2}>
        {iteration.reviewStatus ? (
          <>
            <Text dimColor>- Review</Text>
            {iteration.reviewAgent && (
              <>
                <Text dimColor> [</Text>
                <Text dimColor>{getAgentDisplayName(iteration.reviewAgent)}</Text>
                <Text dimColor>]</Text>
              </>
            )}
            <Text dimColor>: </Text>
            <Text color={iteration.reviewStatus === 'passed' ? 'green' : iteration.reviewStatus === 'failed' ? 'red' : 'yellow'}>
              {iteration.reviewStatus}
            </Text>
          </>
        ) : (
          <Text> </Text>
        )}
      </Box>

      <Box marginLeft={2}>
        {openIssues.length > 0 ? (
          <Text color="red">✗ {openIssues.length} open issue{openIssues.length > 1 ? 's' : ''}</Text>
        ) : (
          <Text> </Text>
        )}
      </Box>

      <Box marginLeft={2}>
        {fixedIssues.length > 0 ? (
          <Text color="green">✓ {fixedIssues.length} fixed issue{fixedIssues.length > 1 ? 's' : ''}</Text>
        ) : (
          <Text> </Text>
        )}
      </Box>
    </Box>
  );
};
