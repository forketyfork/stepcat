import type { OrchestratorEvent } from '../events.js';
import type { PermissionRequest } from '../permission-requests.js';
import type { StopController } from '../stop-controller.js';
import type { Storage } from '../storage.js';

export interface UIAdapterConfig {
  storage?: Storage;
  stopController?: StopController;
}

export interface UIAdapter {
  initialize(): Promise<void>;

  onEvent(event: OrchestratorEvent): void;

  shutdown(): Promise<void>;

  getName(): string;

  requestPermissionApproval?: (
    request: PermissionRequest,
    stepNumber: number,
  ) => Promise<boolean>;
}
