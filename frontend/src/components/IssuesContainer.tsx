import { Issue as IssueType } from '../types/events';
import { Issue } from './Issue';
import './IssuesContainer.css';

interface IssuesContainerProps {
  issues: IssueType[];
  isExpanded: boolean;
}

export function IssuesContainer({ issues, isExpanded }: IssuesContainerProps) {
  if (!isExpanded) {
    return null;
  }

  if (issues.length === 0) {
    return (
      <div className="issues-container expanded">
        <div className="no-issues">No issues</div>
      </div>
    );
  }

  return (
    <div className="issues-container expanded">
      {issues.map((issue) => (
        <Issue key={issue.id} issue={issue} />
      ))}
    </div>
  );
}
