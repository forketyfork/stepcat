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

  const iconContent = iteration.status === 'in_progress' ? '⟳' : iteration.status === 'completed' ? '✓' : '✗';

  const buildStatusIcons = {
    pending: '🔨',
    in_progress: '🔨',
    passed: '✓',
    failed: '✗',
  };

  const reviewStatusIcons = {
    pending: '🔍',
    in_progress: '🔍',
    passed: '✓',
    failed: '✗',
  };

  return (
    <div className={`iteration ${statusClass}`}>
      <div className="iteration-header" onClick={onToggle}>
        <div className="iteration-title">
          <div className="iteration-icon">{iconContent}</div>
          <span>Iteration {iteration.iterationNumber}</span>
          <span className="iteration-type">{typeLabel}</span>
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
              {iteration.buildStatus === 'in_progress'
                ? 'Building'
                : iteration.buildStatus === 'passed'
                ? 'Build OK'
                : iteration.buildStatus === 'failed'
                ? 'Build Failed'
                : 'Pending'}
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
