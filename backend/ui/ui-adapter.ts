import { OrchestratorEvent } from '../events';
import { Storage } from '../storage';

export interface UIAdapterConfig {
  storage?: Storage;
}

export interface UIAdapter {
  initialize(): Promise<void>;

  onEvent(event: OrchestratorEvent): void;

  shutdown(): Promise<void>;

  getName(): string;
}
