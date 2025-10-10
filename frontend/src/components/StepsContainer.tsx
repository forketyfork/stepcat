import { Step, Iteration, Issue } from '../types/events';
import { StepCard } from './StepCard';
import './StepsContainer.css';

interface StepsContainerProps {
  steps: Map<number, Step>;
  iterations: Map<number, Iteration>;
  issues: Map<number, Issue>;
  expandedSteps: Set<number>;
  expandedIterations: Set<number>;
  onToggleStep: (stepId: number) => void;
  onToggleIteration: (iterationId: number) => void;
  owner: string;
  repo: string;
}

export function StepsContainer({
  steps,
  iterations,
  issues,
  expandedSteps,
  expandedIterations,
  onToggleStep,
  onToggleIteration,
  owner,
  repo,
}: StepsContainerProps) {
  if (steps.size === 0) {
    return (
      <div className="steps-container">
        <div className="empty-state">
          <div className="empty-state-icon">⏳</div>
          <div className="empty-state-text">Waiting for steps to load...</div>
        </div>
      </div>
    );
  }

  const stepsArray = Array.from(steps.values()).sort((a, b) => a.stepNumber - b.stepNumber);

  return (
    <div className="steps-container">
      {stepsArray.map((step) => (
        <StepCard
          key={step.id}
          step={step}
          iterations={iterations}
          issues={issues}
          isExpanded={expandedSteps.has(step.id)}
          expandedIterations={expandedIterations}
          onToggle={() => onToggleStep(step.id)}
          onToggleIteration={onToggleIteration}
          animationDelay={step.stepNumber * 0.1}
          owner={owner}
          repo={repo}
        />
      ))}
    </div>
  );
}
