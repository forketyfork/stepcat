import React from 'react';
import { Box, Text } from 'ink';
import { Iteration, Issue } from '../../models.js';

interface IterationItemProps {
  iteration: Iteration;
  issues: Issue[];
}

export const IterationItem: React.FC<IterationItemProps> = ({ iteration, issues }) => {
  const getTypeLabel = (type: string): string => {
    switch (type) {
      case 'implementation': return 'Implementation';
      case 'build_fix': return 'Build Fix';
      case 'review_fix': return 'Review Fix';
      default: return type;
    }
  };

  const getStatusIcon = (status: string): string => {
    switch (status) {
      case 'in_progress': return '⟳';
      case 'completed': return '✓';
      case 'failed': return '✗';
      default: return '·';
    }
  };

  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'in_progress': return 'cyan';
      case 'completed': return 'green';
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
        <Text> Iteration #{iteration.iterationNumber} - </Text>
        <Text bold>{getTypeLabel(iteration.type)}</Text>
        {iteration.commitSha && (
          <>
            <Text dimColor> (</Text>
            <Text dimColor color="yellow">{iteration.commitSha.substring(0, 7)}</Text>
            <Text dimColor>)</Text>
          </>
        )}
      </Box>

      {iteration.buildStatus && (
        <Box marginLeft={2}>
          <Text dimColor>Build: </Text>
          <Text color={iteration.buildStatus === 'passed' ? 'green' : iteration.buildStatus === 'failed' ? 'red' : 'yellow'}>
            {iteration.buildStatus}
          </Text>
        </Box>
      )}

      {iteration.reviewStatus && (
        <Box marginLeft={2}>
          <Text dimColor>Review: </Text>
          <Text color={iteration.reviewStatus === 'passed' ? 'green' : iteration.reviewStatus === 'failed' ? 'red' : 'yellow'}>
            {iteration.reviewStatus}
          </Text>
        </Box>
      )}

      {openIssues.length > 0 && (
        <Box marginLeft={2}>
          <Text color="red">✗ {openIssues.length} open issue{openIssues.length > 1 ? 's' : ''}</Text>
        </Box>
      )}

      {fixedIssues.length > 0 && (
        <Box marginLeft={2}>
          <Text color="green">✓ {fixedIssues.length} fixed issue{fixedIssues.length > 1 ? 's' : ''}</Text>
        </Box>
      )}
    </Box>
  );
};
