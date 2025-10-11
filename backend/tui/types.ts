import { Plan, DbStep, Iteration, Issue } from '../models.js';

export interface TUIState {
  plan: Plan | null;
  steps: DbStep[];
  iterations: Map<number, Iteration[]>;
  issues: Map<number, Issue[]>;
  currentPhase: string;
  isComplete: boolean;
  error: string | null;
  logs: Array<{ level: string; message: string; timestamp: number }>;
}

export const initialState: TUIState = {
  plan: null,
  steps: [],
  iterations: new Map(),
  issues: new Map(),
  currentPhase: 'Initializing...',
  isComplete: false,
  error: null,
  logs: []
};
