import { EventEmitter } from 'events';
import type { Plan, DbStep, Iteration, Issue } from './models';

export interface StepCatEvent {
  type: string;
  timestamp: number;
}

export interface InitEvent extends StepCatEvent {
  type: 'init';
  totalSteps: number;
  pendingSteps: number;
  doneSteps: number;
  steps: Array<{
    number: number;
    title: string;
    phase: string;
  }>;
}

export interface StepStartEvent extends StepCatEvent {
  type: 'step_start';
  stepNumber: number;
  stepTitle: string;
  phase: string;
  progress: {
    current: number;
    total: number;
  };
}

export interface PhaseStartEvent extends StepCatEvent {
  type: 'phase_start';
  stepNumber: number;
  phase: 'implementation' | 'build' | 'review';
  phaseLabel: string;
}

export interface PhaseCompleteEvent extends StepCatEvent {
  type: 'phase_complete';
  stepNumber: number;
  phase: 'implementation' | 'build' | 'review';
}

export interface StepCompleteEvent extends StepCatEvent {
  type: 'step_complete';
  stepNumber: number;
  stepTitle: string;
}

export interface LogEvent extends StepCatEvent {
  type: 'log';
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
  stepNumber?: number;
}

export interface GitHubCheckEvent extends StepCatEvent {
  type: 'github_check';
  status: 'waiting' | 'running' | 'success' | 'failure';
  sha: string;
  attempt: number;
  maxAttempts: number;
  checkName?: string;
  iterationId?: number;
}

export interface BuildAttemptEvent extends StepCatEvent {
  type: 'build_attempt';
  attempt: number;
  maxAttempts: number;
  sha: string;
  iterationId?: number;
}

export interface ReviewStartEvent extends StepCatEvent {
  type: 'review_start';
  stepNumber: number;
}

export interface ReviewCompleteEvent extends StepCatEvent {
  type: 'review_complete';
  stepNumber: number;
  hasIssues: boolean;
}

export interface AllCompleteEvent extends StepCatEvent {
  type: 'all_complete';
  totalTime: number;
}

export interface ErrorEvent extends StepCatEvent {
  type: 'error';
  error: string;
  stepNumber?: number;
}

export interface IterationStartEvent extends StepCatEvent {
  type: 'iteration_start';
  stepId: number;
  iterationNumber: number;
  iterationType: 'implementation' | 'build_fix' | 'review_fix';
}

export interface IterationCompleteEvent extends StepCatEvent {
  type: 'iteration_complete';
  stepId: number;
  iterationNumber: number;
  commitSha: string | null;
  status: 'completed' | 'failed';
}

export interface IssueFoundEvent extends StepCatEvent {
  type: 'issue_found';
  iterationId: number;
  issueType: 'ci_failure' | 'codex_review';
  description: string;
  filePath?: string;
  lineNumber?: number;
  severity?: 'error' | 'warning';
}

export interface IssueResolvedEvent extends StepCatEvent {
  type: 'issue_resolved';
  issueId: number;
}

export interface CodexReviewStartEvent extends StepCatEvent {
  type: 'codex_review_start';
  iterationId: number;
  promptType: 'implementation' | 'build_fix' | 'review_fix';
}

export interface CodexReviewCompleteEvent extends StepCatEvent {
  type: 'codex_review_complete';
  iterationId: number;
  result: 'PASS' | 'FAIL';
  issueCount: number;
}

export interface StateSyncEvent extends StepCatEvent {
  type: 'state_sync';
  plan: Plan;
  steps: DbStep[];
  iterations: Iteration[];
  issues: Issue[];
}

export type OrchestratorEvent =
  | InitEvent
  | StepStartEvent
  | PhaseStartEvent
  | PhaseCompleteEvent
  | StepCompleteEvent
  | LogEvent
  | GitHubCheckEvent
  | BuildAttemptEvent
  | ReviewStartEvent
  | ReviewCompleteEvent
  | AllCompleteEvent
  | ErrorEvent
  | IterationStartEvent
  | IterationCompleteEvent
  | IssueFoundEvent
  | IssueResolvedEvent
  | CodexReviewStartEvent
  | CodexReviewCompleteEvent
  | StateSyncEvent;

export class OrchestratorEventEmitter extends EventEmitter {
  emit(event: 'event', data: OrchestratorEvent): boolean {
    return super.emit(event, data);
  }

  on(event: 'event', listener: (data: OrchestratorEvent) => void): this {
    return super.on(event, listener);
  }
}
