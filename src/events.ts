import { EventEmitter } from 'events';
import { Step } from './step-parser';

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
}

export interface BuildAttemptEvent extends StepCatEvent {
  type: 'build_attempt';
  attempt: number;
  maxAttempts: number;
  sha: string;
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
  | ErrorEvent;

export class OrchestratorEventEmitter extends EventEmitter {
  emit(event: 'event', data: OrchestratorEvent): boolean {
    return super.emit(event, data);
  }

  on(event: 'event', listener: (data: OrchestratorEvent) => void): this {
    return super.on(event, listener);
  }
}
