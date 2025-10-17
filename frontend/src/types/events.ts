export interface Plan {
  id: number;
  owner?: string;
  repo?: string;
}

export interface Step {
  id: number;
  stepNumber: number;
  title: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  iterations: number[];
}

export interface Iteration {
  id: number;
  stepId: number;
  iterationNumber: number;
  type: 'implementation' | 'build_fix' | 'review_fix';
  commitSha: string | null;
  claudeLog: string | null;
  codexLog: string | null;
  status: 'in_progress' | 'completed' | 'failed' | 'aborted';
  implementationAgent: 'claude' | 'codex';
  reviewAgent: 'claude' | 'codex' | null;
  createdAt: string;
  updatedAt: string;
  issues: number[];
  buildStatus?: 'pending' | 'in_progress' | 'passed' | 'failed' | 'merge_conflict';
  reviewStatus?: 'pending' | 'in_progress' | 'passed' | 'failed';
}

export interface Issue {
  id: number;
  iterationId: number;
  type: 'ci_failure' | 'codex_review' | 'merge_conflict';
  description: string;
  filePath: string | null;
  lineNumber: number | null;
  severity: 'error' | 'warning' | null;
  status: 'open' | 'fixed';
  createdAt: string;
  resolvedAt: string | null;
}

export type LogLevel = 'info' | 'success' | 'warn' | 'error';

export interface BaseEvent {
  type: string;
  timestamp: number;
}

export interface ExecutionStartedEvent extends BaseEvent {
  type: 'execution_started';
  executionId: number;
  isResume: boolean;
}

export interface StateSyncEvent extends BaseEvent {
  type: 'state_sync';
  plan: Plan;
  steps: Step[];
  iterations: Iteration[];
  issues: Issue[];
}

export interface InitEvent extends BaseEvent {
  type: 'init';
  totalSteps: number;
  doneSteps: number;
  pendingSteps: number;
}

export interface StepStartEvent extends BaseEvent {
  type: 'step_start';
  stepNumber: number;
}

export interface StepCompleteEvent extends BaseEvent {
  type: 'step_complete';
  stepNumber: number;
}

export interface IterationStartEvent extends BaseEvent {
  type: 'iteration_start';
  stepId: number;
  iterationId: number;
  iterationNumber: number;
  iterationType: 'implementation' | 'build_fix' | 'review_fix';
  implementationAgent: 'claude' | 'codex';
  reviewAgent: 'claude' | 'codex' | null;
}

export interface IterationCompleteEvent extends BaseEvent {
  type: 'iteration_complete';
  stepId: number;
  iterationNumber: number;
  status: 'completed' | 'failed';
  commitSha: string | null;
}

export interface IssueFoundEvent extends BaseEvent {
  type: 'issue_found';
  issueId: number;
  iterationId: number;
  issueType: 'ci_failure' | 'codex_review' | 'merge_conflict';
  description: string;
  filePath?: string;
  lineNumber?: number;
  severity?: 'error' | 'warning';
}

export interface IssueResolvedEvent extends BaseEvent {
  type: 'issue_resolved';
  issueId: number;
}

export interface CodexReviewStartEvent extends BaseEvent {
  type: 'codex_review_start';
  iterationId?: number;
  promptType: string;
  agent?: 'claude' | 'codex';
}

export interface CodexReviewCompleteEvent extends BaseEvent {
  type: 'codex_review_complete';
  iterationId?: number;
  result: 'PASS' | 'FAIL';
  issueCount: number;
  agent?: 'claude' | 'codex';
}

export interface LogEvent extends BaseEvent {
  type: 'log';
  message: string;
  level: LogLevel;
}

export interface GitHubCheckEvent extends BaseEvent {
  type: 'github_check';
  iterationId?: number;
  status: 'waiting' | 'running' | 'success' | 'failure' | 'blocked';
}

export interface ErrorEvent extends BaseEvent {
  type: 'error';
  error: string;
}

export interface AllCompleteEvent extends BaseEvent {
  type: 'all_complete';
  totalTime: number;
}

export type OrchestratorEvent =
  | ExecutionStartedEvent
  | StateSyncEvent
  | InitEvent
  | StepStartEvent
  | StepCompleteEvent
  | IterationStartEvent
  | IterationCompleteEvent
  | IssueFoundEvent
  | IssueResolvedEvent
  | CodexReviewStartEvent
  | CodexReviewCompleteEvent
  | LogEvent
  | GitHubCheckEvent
  | ErrorEvent
  | AllCompleteEvent;
