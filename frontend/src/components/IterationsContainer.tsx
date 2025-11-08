import { Iteration as IterationType, Issue } from '../types/events';
import { Iteration } from './Iteration';
import './IterationsContainer.css';

interface IterationsContainerProps {
  iterations: IterationType[];
  issues: Map<number, Issue>;
  isExpanded: boolean;
  expandedIterations: Set<number>;
  onToggleIteration: (iterationId: number) => void;
  owner: string;
  repo: string;
}

export function IterationsContainer({
  iterations,
  issues,
  isExpanded,
  expandedIterations,
  onToggleIteration,
  owner,
  repo,
}: IterationsContainerProps) {
  if (!isExpanded) {
    return null;
  }

  if (iterations.length === 0) {
    return (
      <div className="iterations-container expanded">
        <div className="no-iterations">No iterations yet</div>
      </div>
    );
  }

  return (
    <div className="iterations-container expanded">
      {iterations.map((iteration, index) => {
        const iterationIssues = iteration.issues.map((id) => issues.get(id)).filter((i): i is Issue => i !== undefined);
        const displayNumber = iteration.displayNumber ?? index + 1;

        return (
          <Iteration
            key={iteration.id}
            iteration={iteration}
            displayNumber={displayNumber}
            issues={iterationIssues}
            isExpanded={expandedIterations.has(iteration.id)}
            onToggle={() => onToggleIteration(iteration.id)}
            owner={owner}
            repo={repo}
          />
        );
      })}
    </div>
  );
}
