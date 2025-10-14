import { UIAdapter, UIAdapterConfig } from './ui-adapter.js';
import { OrchestratorEvent } from '../events.js';
import { TUIState, initialState } from '../tui/types.js';
import { Storage } from '../storage.js';
import type * as ReactTypes from 'react';
import { pathToFileURL, fileURLToPath } from 'url';
import { resolve, dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const moduleDir = __dirname;

type InkModule = typeof import('ink');
type ReactModule = typeof import('react');
type InkInstance = { rerender: (node: ReactTypes.ReactNode) => void; unmount: () => void };
type AppComponent = ReactTypes.FC<{ state: TUIState }>;

export class TUIAdapter implements UIAdapter {
  private state: TUIState;
  private inkInstance: InkInstance | null = null;
  private storage?: Storage;
  private ink: InkModule | null = null;
  private React: ReactModule | null = null;
  private App: AppComponent | null = null;
  private resizeHandler: (() => void) | null = null;

  constructor(config: UIAdapterConfig) {
    this.state = { ...initialState };
    this.storage = config.storage;
  }

  getName(): string {
    return 'Terminal UI';
  }

  async initialize(): Promise<void> {
    this.ink = await import('ink');
    this.React = await import('react');

    const isDev = process.env.NODE_ENV !== 'production' && !moduleDir.includes('/dist/');
    const fileName = isDev ? 'App.tsx' : 'App.js';
    const componentPath = resolve(moduleDir, '../tui/components', fileName);
    const componentUrl = pathToFileURL(componentPath).href;

    const componentsModule = await import(componentUrl);
    this.App = componentsModule.App;

    if (!this.App) {
      throw new Error('Failed to load TUI App component');
    }

    this.resizeHandler = this.handleResize.bind(this);
    process.stdout.on('resize', this.resizeHandler);

    this.inkInstance = this.ink.render(this.React.createElement(this.App, { state: this.state }));
  }

  onEvent(event: OrchestratorEvent): void {
    switch (event.type) {
      case 'execution_started':
        if (this.storage) {
          const plan = this.storage.getPlan(event.executionId);
          if (plan) {
            this.state.plan = plan;
            this.state.steps = this.storage.getSteps(event.executionId);

            this.state.steps.forEach(step => {
              const iterations = this.storage!.getIterations(step.id);
              this.state.iterations.set(step.id, iterations);

              iterations.forEach(iteration => {
                const issues = this.storage!.getIssues(iteration.id);
                this.state.issues.set(iteration.id, issues);
              });
            });
          }
        }
        break;

      case 'state_sync':
        this.state.plan = event.plan;
        this.state.steps = event.steps;

        this.state.iterations.clear();
        this.state.issues.clear();

        event.steps.forEach(step => {
          const stepIterations = event.iterations.filter(i => i.stepId === step.id);
          this.state.iterations.set(step.id, stepIterations);

          stepIterations.forEach(iteration => {
            const iterationIssues = event.issues.filter(i => i.iterationId === iteration.id);
            this.state.issues.set(iteration.id, iterationIssues);
          });
        });
        break;

      case 'step_start':
        if (this.storage && this.state.plan) {
          this.state.steps = this.storage.getSteps(this.state.plan.id);
        }
        this.state.currentPhase = `Step ${event.stepNumber}: ${event.stepTitle}`;
        break;

      case 'phase_start':
        this.state.currentPhase = `Step ${event.stepNumber} - ${event.phaseLabel}`;
        break;

      case 'step_complete':
        if (this.storage && this.state.plan) {
          this.state.steps = this.storage.getSteps(this.state.plan.id);
        }
        break;

      case 'iteration_start':
        if (this.storage) {
          const step = this.state.steps.find(s => s.id === event.stepId);
          if (step) {
            const iterations = this.storage.getIterations(step.id);
            this.state.iterations.set(step.id, iterations);
          }
        }
        break;

      case 'iteration_complete':
        if (this.storage) {
          const step = this.state.steps.find(s => s.id === event.stepId);
          if (step) {
            const iterations = this.storage.getIterations(step.id);
            this.state.iterations.set(step.id, iterations);
          }
        }
        break;

      case 'issue_found':
        if (this.storage) {
          const issues = this.storage.getIssues(event.iterationId);
          this.state.issues.set(event.iterationId, issues);
        }
        break;

      case 'issue_resolved':
        if (this.storage && this.state.plan) {
          this.state.steps.forEach(step => {
            const iterations = this.storage!.getIterations(step.id);
            iterations.forEach(iteration => {
              const issues = this.storage!.getIssues(iteration.id);
              const hasResolvedIssue = issues.some(i => i.id === event.issueId);
              if (hasResolvedIssue) {
                this.state.issues.set(iteration.id, issues);
              }
            });
          });
        }
        break;

      case 'log':
        this.state.logs.push({
          level: event.level,
          message: event.message,
          timestamp: event.timestamp
        });
        if (this.state.logs.length > 50) {
          this.state.logs.shift();
        }
        break;

      case 'error':
        this.state.error = event.error;
        break;

      case 'all_complete':
        this.state.isComplete = true;
        this.state.currentPhase = '';
        break;
    }

    this.rerender();
  }

  private rerender(): void {
    if (this.inkInstance && this.React && this.App) {
      this.inkInstance.rerender(this.React.createElement(this.App, { state: this.state }));
    }
  }

  private handleResize(): void {
    this.state.terminalWidth = process.stdout.columns || 80;
    this.state.terminalHeight = process.stdout.rows || 24;
    this.rerender();
  }

  async shutdown(): Promise<void> {
    if (this.resizeHandler) {
      process.stdout.off('resize', this.resizeHandler);
      this.resizeHandler = null;
    }

    if (this.inkInstance) {
      this.inkInstance.unmount();
      this.inkInstance = null;
    }
  }
}
