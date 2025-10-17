import { useState, useCallback } from 'react';
import { Header } from './components/Header';
import { StatusBanner } from './components/StatusBanner';
import { StepsContainer } from './components/StepsContainer';
import { useWebSocket } from './hooks/useWebSocket';
import { useLocalStorage } from './hooks/useLocalStorage';
import {
  Step,
  Iteration,
  Issue,
  OrchestratorEvent,
  StateSyncEvent,
  StepStartEvent,
  StepCompleteEvent,
  IterationStartEvent,
  IterationCompleteEvent,
  IssueFoundEvent,
  IssueResolvedEvent,
  GitHubCheckEvent,
  CodexReviewStartEvent,
  CodexReviewCompleteEvent,
  ExecutionStartedEvent,
} from './types/events';
import './App.css';

interface AppState {
  executionId: string;
  totalSteps: number;
  completedSteps: number;
  remainingSteps: number;
  steps: Map<number, Step>;
  iterations: Map<number, Iteration>;
  issues: Map<number, Issue>;
  owner: string;
  repo: string;
}

interface ExpansionState {
  steps: number[];
  iterations: number[];
}

function App() {
  const [state, setState] = useState<AppState>({
    executionId: '-',
    totalSteps: 0,
    completedSteps: 0,
    remainingSteps: 0,
    steps: new Map(),
    iterations: new Map(),
    issues: new Map(),
    owner: '',
    repo: '',
  });

  const [expansionState, setExpansionState] = useLocalStorage<ExpansionState>('stepcat_expanded_state', {
    steps: [],
    iterations: [],
  });

  const expandedSteps = new Set(expansionState.steps);
  const expandedIterations = new Set(expansionState.iterations);

  function handleExecutionStarted(event: ExecutionStartedEvent) {
    setState((prev) => ({
      ...prev,
      executionId: event.executionId.toString(),
    }));
  }

  function handleStateSync(event: StateSyncEvent) {
    const newSteps = new Map<number, Step>();
    const newIterations = new Map<number, Iteration>();
    const newIssues = new Map<number, Issue>();

    event.steps.forEach((step) => {
      newSteps.set(step.id, { ...step, iterations: [] });
    });

    event.iterations.forEach((iteration) => {
      newIterations.set(iteration.id, { ...iteration, issues: [] });
      const step = newSteps.get(iteration.stepId);
      if (step) {
        step.iterations.push(iteration.id);
      }
    });

    event.issues.forEach((issue) => {
      newIssues.set(issue.id, issue);
      const iteration = newIterations.get(issue.iterationId);
      if (iteration) {
        iteration.issues.push(issue.id);
      }
    });

    const totalSteps = newSteps.size;
    const completedSteps = Array.from(newSteps.values()).filter((s) => s.status === 'completed').length;
    const remainingSteps = totalSteps - completedSteps;

    setState((prev) => ({
      ...prev,
      executionId: event.plan.id.toString(),
      totalSteps,
      completedSteps,
      remainingSteps,
      steps: newSteps,
      iterations: newIterations,
      issues: newIssues,
      owner: event.plan.owner || '',
      repo: event.plan.repo || '',
    }));
  }

  function handleStepStart(event: StepStartEvent) {
    setState((prev) => {
      const newSteps = new Map(prev.steps);
      const step = Array.from(newSteps.values()).find((s) => s.stepNumber === event.stepNumber);
      if (step) {
        step.status = 'in_progress';
        setExpansionState((prevExp) => ({
          ...prevExp,
          steps: [...new Set([...prevExp.steps, step.id])],
        }));
      }
      return { ...prev, steps: newSteps };
    });
  }

  function handleStepComplete(event: StepCompleteEvent) {
    setState((prev) => {
      const newSteps = new Map(prev.steps);
      const step = Array.from(newSteps.values()).find((s) => s.stepNumber === event.stepNumber);
      if (step && step.status !== 'completed') {
        step.status = 'completed';
      }
      const completedSteps = Array.from(newSteps.values()).filter((s) => s.status === 'completed').length;
      const remainingSteps = prev.totalSteps - completedSteps;
      return { ...prev, steps: newSteps, completedSteps, remainingSteps };
    });
  }

  function handleIterationStart(event: IterationStartEvent) {
    setState((prev) => {
      const existingIteration = prev.iterations.get(event.iterationId);

      if (existingIteration) {
        const newIterations = new Map(prev.iterations);
        newIterations.set(event.iterationId, {
          ...existingIteration,
          status: 'in_progress',
          updatedAt: new Date().toISOString(),
        });

        setExpansionState((prevExp) => ({
          ...prevExp,
          steps: [...new Set([...prevExp.steps, event.stepId])],
          iterations: [...new Set([...prevExp.iterations, event.iterationId])],
        }));

        return { ...prev, iterations: newIterations };
      } else {
        const newIteration: Iteration = {
          id: event.iterationId,
          stepId: event.stepId,
          iterationNumber: event.iterationNumber,
          type: event.iterationType,
          commitSha: null,
          claudeLog: null,
          codexLog: null,
          status: 'in_progress',
          implementationAgent: event.implementationAgent,
          reviewAgent: event.reviewAgent,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          issues: [],
        };

        const newIterations = new Map(prev.iterations);
        newIterations.set(newIteration.id, newIteration);

        const newSteps = new Map(prev.steps);
        const step = newSteps.get(event.stepId);
        if (step) {
          step.iterations = [...step.iterations, newIteration.id];
        }

        setExpansionState((prevExp) => ({
          ...prevExp,
          steps: [...new Set([...prevExp.steps, event.stepId])],
          iterations: [...new Set([...prevExp.iterations, newIteration.id])],
        }));

        return { ...prev, steps: newSteps, iterations: newIterations };
      }
    });
  }

  function handleIterationComplete(event: IterationCompleteEvent) {
    setState((prev) => {
      const newIterations = new Map(prev.iterations);
      const iteration = Array.from(newIterations.values()).find(
        (i) => i.stepId === event.stepId && i.iterationNumber === event.iterationNumber
      );
      if (iteration) {
        newIterations.set(iteration.id, {
          ...iteration,
          status: event.status,
          commitSha: event.commitSha,
          updatedAt: new Date().toISOString(),
        });
      }
      return { ...prev, iterations: newIterations };
    });
  }

  function handleIssueFound(event: IssueFoundEvent) {
    setState((prev) => {
      const existingIssue = prev.issues.get(event.issueId);

      if (!existingIssue) {
        const newIssue: Issue = {
          id: event.issueId,
          iterationId: event.iterationId,
          type: event.issueType,
          description: event.description,
          filePath: event.filePath || null,
          lineNumber: event.lineNumber || null,
          severity: event.severity || null,
          status: 'open',
          createdAt: new Date().toISOString(),
          resolvedAt: null,
        };

        const newIssues = new Map(prev.issues);
        newIssues.set(newIssue.id, newIssue);

        const newIterations = new Map(prev.iterations);
        const iteration = newIterations.get(event.iterationId);
        if (iteration) {
          newIterations.set(iteration.id, {
            ...iteration,
            issues: [...iteration.issues, newIssue.id],
          });
        }

        setExpansionState((prevExp) => ({
          ...prevExp,
          iterations: [...new Set([...prevExp.iterations, event.iterationId])],
        }));

        return { ...prev, issues: newIssues, iterations: newIterations };
      }

      return prev;
    });
  }

  function handleIssueResolved(event: IssueResolvedEvent) {
    setState((prev) => {
      const newIssues = new Map(prev.issues);
      const issue = newIssues.get(event.issueId);
      if (issue) {
        newIssues.set(event.issueId, {
          ...issue,
          status: 'fixed',
          resolvedAt: new Date().toISOString(),
        });
      }
      return { ...prev, issues: newIssues };
    });
  }

  function handleGitHubCheck(event: GitHubCheckEvent) {
    if (event.iterationId) {
      setState((prev) => {
        const newIterations = new Map(prev.iterations);
        const iteration = newIterations.get(event.iterationId!);
        if (iteration) {
          const buildStatusMap: Record<string, Iteration['buildStatus']> = {
            waiting: 'pending',
            running: 'in_progress',
            success: 'passed',
            failure: 'failed',
            blocked: 'merge_conflict',
          };
          const statusOverride = buildStatusMap[event.status] ?? 'pending';
          newIterations.set(iteration.id, {
            ...iteration,
            buildStatus: statusOverride,
          });
        }
        return { ...prev, iterations: newIterations };
      });
    }
  }

  function handleCodexReviewStart(event: CodexReviewStartEvent) {
    if (event.iterationId) {
      setState((prev) => {
        const newIterations = new Map(prev.iterations);
        const iteration = newIterations.get(event.iterationId!);
        if (iteration) {
          newIterations.set(iteration.id, {
            ...iteration,
            reviewStatus: 'in_progress',
          });
        }
        return { ...prev, iterations: newIterations };
      });
    }
  }

  function handleCodexReviewComplete(event: CodexReviewCompleteEvent) {
    if (event.iterationId) {
      setState((prev) => {
        const newIterations = new Map(prev.iterations);
        const iteration = newIterations.get(event.iterationId!);
        if (iteration) {
          newIterations.set(iteration.id, {
            ...iteration,
            reviewStatus: event.result === 'PASS' ? 'passed' : 'failed',
          });
        }
        return { ...prev, iterations: newIterations };
      });
    }
  }

  function handleToggleStep(stepId: number) {
    setExpansionState((prev) => {
      const newSteps = new Set(prev.steps);
      if (newSteps.has(stepId)) {
        newSteps.delete(stepId);
      } else {
        newSteps.add(stepId);
      }
      return { ...prev, steps: Array.from(newSteps) };
    });
  }

  function handleToggleIteration(iterationId: number) {
    setExpansionState((prev) => {
      const newIterations = new Set(prev.iterations);
      if (newIterations.has(iterationId)) {
        newIterations.delete(iterationId);
      } else {
        newIterations.add(iterationId);
      }
      return { ...prev, iterations: Array.from(newIterations) };
    });
  }

  const handleEvent = useCallback((event: OrchestratorEvent) => {
    console.log('Event:', event);

    switch (event.type) {
      case 'execution_started':
        handleExecutionStarted(event as ExecutionStartedEvent);
        break;
      case 'state_sync':
        handleStateSync(event as StateSyncEvent);
        break;
      case 'step_start':
        handleStepStart(event as StepStartEvent);
        break;
      case 'step_complete':
        handleStepComplete(event as StepCompleteEvent);
        break;
      case 'iteration_start':
        handleIterationStart(event as IterationStartEvent);
        break;
      case 'iteration_complete':
        handleIterationComplete(event as IterationCompleteEvent);
        break;
      case 'issue_found':
        handleIssueFound(event as IssueFoundEvent);
        break;
      case 'issue_resolved':
        handleIssueResolved(event as IssueResolvedEvent);
        break;
      case 'github_check':
        handleGitHubCheck(event as GitHubCheckEvent);
        break;
      case 'codex_review_start':
        handleCodexReviewStart(event as CodexReviewStartEvent);
        break;
      case 'codex_review_complete':
        handleCodexReviewComplete(event as CodexReviewCompleteEvent);
        break;
      case 'log':
        break;
      case 'all_complete':
        break;
      case 'error':
        break;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setExpansionState]);

  const { isConnected } = useWebSocket(handleEvent);

  return (
    <div className="container">
      <Header />
      <StatusBanner
        executionId={state.executionId}
        totalSteps={state.totalSteps}
        completedSteps={state.completedSteps}
        remainingSteps={state.remainingSteps}
        isConnected={isConnected}
      />
      <StepsContainer
        steps={state.steps}
        iterations={state.iterations}
        issues={state.issues}
        expandedSteps={expandedSteps}
        expandedIterations={expandedIterations}
        onToggleStep={handleToggleStep}
        onToggleIteration={handleToggleIteration}
        owner={state.owner}
        repo={state.repo}
      />
    </div>
  );
}

export default App;
