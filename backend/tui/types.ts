import { Plan, DbStep, Iteration, Issue } from '../models.js';

export type LogViewerItem = {
  id: string;
  stepNumber: number;
  stepTitle: string;
  iterationNumber: number;
  logType: 'implementation' | 'review';
  logContent: string | null;
  iteration: Iteration;
};

export type ViewMode = 'normal' | 'log_viewer' | 'permission_prompt';

export type PermissionPrompt = {
  stepNumber: number;
  permissions: string[];
  reason?: string;
  previousViewMode: ViewMode;
  onDecision: (approved: boolean) => void;
};

export interface TUIState {
  plan: Plan | null;
  steps: DbStep[];
  iterations: Map<number, Iteration[]>;
  issues: Map<number, Issue[]>;
  currentPhase: string;
  isComplete: boolean;
  error: string | null;
  logs: Array<{ level: string; message: string; timestamp: number }>;
  terminalWidth: number;
  terminalHeight: number;
  stateVersion: number;
  viewMode: ViewMode;
  permissionPrompt: PermissionPrompt | null;
  selectedLogIndex: number;
  logViewerItems: LogViewerItem[];
  pendingLogView: string | null;
  stopRequested: boolean;
}

export const initialState: TUIState = {
  plan: null,
  steps: [],
  iterations: new Map(),
  issues: new Map(),
  currentPhase: 'Initializing...',
  isComplete: false,
  error: null,
  logs: [],
  terminalWidth: process.stdout.columns || 80,
  terminalHeight: process.stdout.rows || 24,
  stateVersion: 0,
  viewMode: 'normal',
  permissionPrompt: null,
  selectedLogIndex: 0,
  logViewerItems: [],
  pendingLogView: null,
  stopRequested: false
};
