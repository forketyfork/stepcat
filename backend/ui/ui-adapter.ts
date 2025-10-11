import { OrchestratorEvent } from '../events.js';
import { Storage } from '../storage.js';

export interface UIAdapterConfig {
  storage?: Storage;
}

export interface UIAdapter {
  initialize(): Promise<void>;

  onEvent(event: OrchestratorEvent): void;

  shutdown(): Promise<void>;

  getName(): string;
}
