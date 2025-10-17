import React from 'react';
import { Iteration as IterationType, Issue } from '../types/events';
import { IssuesContainer } from './IssuesContainer';
import './Iteration.css';

interface IterationProps {
  iteration: IterationType;
  issues: Issue[];
  isExpanded: boolean;
  onToggle: () => void;
  owner: string;
  repo: string;
}

export function Iteration({ iteration, issues, isExpanded, onToggle, owner, repo }: IterationProps) {
  const statusClass = iteration.status;
  const typeLabel = iteration.type.replace('_', ' ');

  const iconContent = (() => {
    switch (iteration.status) {
      case 'in_progress':
        return '⟳';
      case 'completed':
        return '✓';
      case 'aborted':
        return '⚠';
      case 'failed':
      default:
        return '✗';
    }
  })();

  const getAgentDisplayName = (agent: 'claude' | 'codex'): string => {
    return agent === 'claude' ? 'Claude Code' : 'Codex';
  };

  const buildStatusIcons = {
    pending: '🔨',
    in_progress: '🔨',
    passed: '✓',
    failed: '✗',
    merge_conflict: '⚠',
  } as const;

  const buildStatusText: Record<
    NonNullable<IterationType['buildStatus']>,
    string
  > = {
    pending: 'Build Pending',
    in_progress: 'Building',
    passed: 'Build OK',
    failed: 'Build Failed',
    merge_conflict: 'Merge conflict, waiting for resolution',
  };

  const reviewStatusIcons = {
    pending: '🔍',
    in_progress: '🔍',
    passed: '✓',
    failed: '✗',
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onToggle();
    }
  };

  return (
    <div className={`iteration ${statusClass}`}>
      <div
        className="iteration-header"
        onClick={onToggle}
        onKeyDown={handleKeyDown}
        role="button"
        tabIndex={0}
      >
        <div className="iteration-title">
          <div className="iteration-icon">{iconContent}</div>
          <span>Iteration {iteration.iterationNumber}</span>
          <span className="iteration-type">{typeLabel}</span>
          <span className="iteration-agents">
            [impl: {getAgentDisplayName(iteration.implementationAgent)}
            {iteration.reviewAgent && `, review: ${getAgentDisplayName(iteration.reviewAgent)}`}]
          </span>
        </div>
        <div className="iteration-meta">
          {iteration.commitSha && <span className="commit-sha">{iteration.commitSha.substring(0, 7)}</span>}
          {iteration.commitSha && iteration.buildStatus && (
            <a
              href={`https://github.com/${owner}/${repo}/commit/${iteration.commitSha}/checks`}
              target="_blank"
              rel="noopener noreferrer"
              className={`build-status-badge ${iteration.buildStatus}`}
              onClick={(e) => e.stopPropagation()}
            >
              {buildStatusIcons[iteration.buildStatus]}{' '}
              {buildStatusText[iteration.buildStatus]}
            </a>
          )}
          {iteration.reviewStatus && (
            <span className={`review-status-badge ${iteration.reviewStatus}`}>
              {reviewStatusIcons[iteration.reviewStatus]}{' '}
              {iteration.reviewStatus === 'in_progress'
                ? 'Reviewing'
                : iteration.reviewStatus === 'passed'
                ? 'Review OK'
                : iteration.reviewStatus === 'failed'
                ? 'Review Failed'
                : 'Pending'}
            </span>
          )}
          <span className="issue-count">
            {issues.length} issue{issues.length !== 1 ? 's' : ''}
          </span>
          <span className={`expand-icon ${isExpanded ? 'expanded' : ''}`}>▸</span>
        </div>
      </div>
      <IssuesContainer issues={issues} isExpanded={isExpanded} />
    </div>
  );
}
