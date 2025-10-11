import { UIAdapter, UIAdapterConfig } from './ui-adapter';
import { OrchestratorEvent } from '../events';

export class TUIAdapter implements UIAdapter {
  constructor(_config: UIAdapterConfig) {
  }

  getName(): string {
    return 'Terminal UI';
  }

  async initialize(): Promise<void> {
  }

  onEvent(_event: OrchestratorEvent): void {
  }

  async shutdown(): Promise<void> {
  }
}
