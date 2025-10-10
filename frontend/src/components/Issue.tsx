import { Issue as IssueType } from '../types/events';
import './Issue.css';

interface IssueProps {
  issue: IssueType;
}

export function Issue({ issue }: IssueProps) {
  const severityIcon = issue.severity === 'error' ? '🔴' : issue.severity === 'warning' ? '⚠️' : 'ℹ️';
  const statusClass = issue.status;
  const location = issue.filePath
    ? `${issue.filePath}${issue.lineNumber ? ':' + issue.lineNumber : ''}`
    : '';

  return (
    <div className={`issue ${statusClass}`}>
      <div className="issue-header">
        <span className="issue-severity">{severityIcon}</span>
        <div className="issue-content">
          <div className="issue-description">{issue.description}</div>
          <div>
            {location && <span className="issue-location">{location}</span>}
            <span className={`issue-status ${statusClass}`}>
              {issue.status === 'fixed' ? '✓ Fixed' : '⚠ Open'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
