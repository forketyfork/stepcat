import React, { forwardRef } from 'react';
import { Step, Iteration, Issue } from '../types/events';
import { IterationsContainer } from './IterationsContainer';
import './StepCard.css';

interface StepCardProps {
  step: Step;
  iterations: Map<number, Iteration>;
  issues: Map<number, Issue>;
  isExpanded: boolean;
  expandedIterations: Set<number>;
  onToggle: () => void;
  onToggleIteration: (iterationId: number) => void;
  animationDelay: number;
  owner: string;
  repo: string;
}

export const StepCard = forwardRef<HTMLDivElement, StepCardProps>(function StepCard(
  {
    step,
    iterations,
    issues,
    isExpanded,
    expandedIterations,
    onToggle,
    onToggleIteration,
    animationDelay,
    owner,
    repo,
  },
  ref
) {
  const isActive = step.status === 'in_progress';
  const isCompleted = step.status === 'completed';
  const isFailed = step.status === 'failed';

  const stepIterations = step.iterations
    .map((id) => iterations.get(id))
    .filter((i): i is Iteration => i !== undefined);

  const statusIcon = isCompleted ? '✓' : isActive ? '⟳' : isFailed ? '✗' : '◯';
  const statusText = isCompleted ? 'Complete' : isActive ? 'In Progress' : isFailed ? 'Failed' : 'Pending';

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onToggle();
    }
  };

  return (
    <div
      ref={ref}
      className={`step-card ${isActive ? 'active' : ''} ${isCompleted ? 'completed' : ''}`}
      style={{ animationDelay: `${animationDelay}s` }}
    >
      <div
        className="step-header step-header-clickable"
        onClick={onToggle}
        onKeyDown={handleKeyDown}
        role="button"
        tabIndex={0}
      >
        <div className="step-number">{step.stepNumber}</div>
        <div className="step-title">{step.title}</div>
        <div className="step-meta">
          {stepIterations.length} iteration{stepIterations.length !== 1 ? 's' : ''}
        </div>
        <div className="step-status">
          {statusIcon} {statusText}
        </div>
        <span className={`expand-icon ${isExpanded ? 'expanded' : ''}`}>▸</span>
      </div>
      <IterationsContainer
        iterations={stepIterations}
        issues={issues}
        isExpanded={isExpanded}
        expandedIterations={expandedIterations}
        onToggleIteration={onToggleIteration}
        owner={owner}
        repo={repo}
      />
    </div>
  );
});
