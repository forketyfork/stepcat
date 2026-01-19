import { OrchestratorEvent } from '../events.js';
import { Storage } from '../storage.js';
import type { StopController } from '../stop-controller.js';

export interface UIAdapterConfig {
  storage?: Storage;
  stopController?: StopController;
}

export interface UIAdapter {
  initialize(): Promise<void>;

  onEvent(event: OrchestratorEvent): void;

  shutdown(): Promise<void>;

  getName(): string;
}
