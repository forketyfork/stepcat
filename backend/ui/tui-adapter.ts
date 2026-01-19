import { UIAdapter, UIAdapterConfig } from './ui-adapter.js';
import { OrchestratorEvent } from '../events.js';
import { TUIState, initialState } from '../tui/types.js';
import { Storage } from '../storage.js';
import type * as ReactTypes from 'react';
import type { RenderOptions } from 'ink';
import { pathToFileURL, fileURLToPath } from 'url';
import { resolve, dirname, sep } from 'path';
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { spawnSync } from 'child_process';
import { getLogger } from '../logger.js';
import type { StopController } from '../stop-controller.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const moduleDir = __dirname;
const isBuiltArtifact = moduleDir.split(sep).includes('dist');

type InkModule = typeof import('ink');
type ReactModule = typeof import('react');
type InkInstance = { rerender: (node: ReactTypes.ReactNode) => void; unmount: () => void };
type AppComponent = ReactTypes.FC<{
  state: TUIState;
  onStateChange: () => void;
  onRequestStopAfterStep: () => void;
}>;

const RERENDER_THROTTLE_MS = 33; // ~30fps max
const DEFAULT_TUI_MAX_FPS = 20;
const RENDER_LOG_INTERVAL_MS = 2000;
const TUI_INCREMENTAL_RENDERING = process.env.STEPCAT_TUI_INCREMENTAL !== 'false';
const TUI_RENDER_DEBUG = process.env.STEPCAT_TUI_RENDER_DEBUG === '1';

type RenderMetrics = Parameters<NonNullable<RenderOptions['onRender']>>[0];

const parseMaxFps = (rawValue: string | undefined): number | undefined => {
  if (!rawValue) {
    return undefined;
  }
  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return parsed;
};

// Strip ANSI escape codes from strings to prevent rendering issues
// Matches all ANSI escape sequences: CSI sequences, OSC sequences, and simple escapes
// eslint-disable-next-line no-control-regex
const ANSI_REGEX = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;
function stripAnsi(str: string): string {
  return str.replace(ANSI_REGEX, '');
}

export class TUIAdapter implements UIAdapter {
  private state: TUIState;
  private inkInstance: InkInstance | null = null;
  private storage?: Storage;
  private stopController?: StopController;
  private ink: InkModule | null = null;
  private React: ReactModule | null = null;
  private App: AppComponent | null = null;
  private resizeHandler: (() => void) | null = null;
  private rerenderPending = false;
  private rerenderTimer: ReturnType<typeof setTimeout> | null = null;
  private renderOptions: RenderOptions | null = null;
  private renderLogState:
    | { lastLogAt: number; renderCount: number; totalRenderTime: number }
    | null = null;

  private refreshIteration(iterationId: number): void {
    if (!this.storage) return;

    for (const step of this.state.steps) {
      const iterations = this.storage.getIterations(step.id);
      if (iterations.some(iteration => iteration.id === iterationId)) {
        this.state.iterations.set(step.id, iterations);
        return;
      }
    }
  }

  constructor(config: UIAdapterConfig) {
    this.state = { ...initialState };
    this.storage = config.storage;
    this.stopController = config.stopController;
  }

  getName(): string {
    return 'Terminal UI';
  }

  async initialize(): Promise<void> {
    this.ink = await import('ink');
    this.React = await import('react');

    const isDev = process.env.NODE_ENV !== 'production' && !isBuiltArtifact;
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

    const maxFps = parseMaxFps(process.env.STEPCAT_TUI_MAX_FPS) ?? DEFAULT_TUI_MAX_FPS;
    const renderOptions: RenderOptions = {
      stdout: process.stdout,
      stdin: process.stdin,
      stderr: process.stderr,
      patchConsole: true,
      maxFps,
      incrementalRendering: TUI_INCREMENTAL_RENDERING,
    };

    if (TUI_RENDER_DEBUG) {
      this.renderLogState = {
        lastLogAt: Date.now(),
        renderCount: 0,
        totalRenderTime: 0,
      };
      renderOptions.onRender = (metrics) => this.logRenderMetrics(metrics, renderOptions);
    }

    this.renderOptions = renderOptions;
    this.inkInstance = this.ink.render(
      this.React.createElement(this.App, {
        state: this.state,
        onStateChange: this.rerender.bind(this),
        onRequestStopAfterStep: this.requestStopAfterStep.bind(this),
      }),
      renderOptions
    );
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

      case 'github_check':
        if (event.iterationId !== undefined && event.iterationId !== null) {
          this.refreshIteration(event.iterationId);
        }
        break;

      case 'codex_review_start':
      case 'codex_review_complete':
        this.refreshIteration(event.iterationId);
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
        {
          // Strip ANSI codes and normalize whitespace to prevent rendering issues
          const cleanMessage = stripAnsi(event.message).replace(/[\r\n]+/g, ' ');
          const hasContent = cleanMessage.trim().length > 0;
          this.appendLog({
            level: event.level,
            message: hasContent ? cleanMessage : '',
            timestamp: event.timestamp
          });
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

  private async displayLogWithPager(logContent: string): Promise<void> {
    const tempFile = join(tmpdir(), `stepcat-log-${Date.now()}.txt`);

    try {
      writeFileSync(tempFile, logContent, 'utf-8');

      if (this.inkInstance) {
        this.inkInstance.unmount();
        this.inkInstance = null;
      }

      // Use less with alternate screen (-R preserves colors, less uses alternate screen by default)
      spawnSync('less', ['-R', tempFile], {
        stdio: 'inherit',
      });

      // Restore Ink UI after pager exits
      if (this.React && this.App && this.renderOptions) {
        this.inkInstance = this.ink!.render(
          this.React.createElement(this.App, {
            state: this.state,
            onStateChange: this.rerender.bind(this),
            onRequestStopAfterStep: this.requestStopAfterStep.bind(this),
          }),
          this.renderOptions
        );
      }
    } finally {
      try {
        unlinkSync(tempFile);
      } catch {
        // ignore cleanup errors
      }
    }
  }

  private rerender(): void {
    this.state.stateVersion++;

    if (this.state.pendingLogView) {
      const logContent = this.state.pendingLogView;
      this.state.pendingLogView = null;
      this.state.viewMode = 'log_viewer';

      this.displayLogWithPager(logContent).catch(err => {
        console.error('Failed to display log:', err);
      });
      return;
    }

    this.scheduleRerender();
  }

  private scheduleRerender(): void {
    if (this.rerenderPending) {
      return;
    }

    this.rerenderPending = true;
    this.rerenderTimer = setTimeout(() => {
      this.rerenderPending = false;
      this.rerenderTimer = null;
      this.doRerender();
    }, RERENDER_THROTTLE_MS);
  }

  private doRerender(): void {
    if (this.inkInstance && this.React && this.App) {
      this.inkInstance.rerender(
        this.React.createElement(this.App, {
          state: this.state,
          onStateChange: this.rerender.bind(this),
          onRequestStopAfterStep: this.requestStopAfterStep.bind(this),
        })
      );
    }
  }

  private appendLog(entry: { level: string; message: string; timestamp: number }): void {
    this.state.logs.push(entry);
    if (this.state.logs.length > 50) {
      this.state.logs.shift();
    }
  }

  private requestStopAfterStep(): void {
    if (!this.stopController || this.stopController.isStopAfterStepRequested()) {
      return;
    }

    this.stopController.requestStopAfterStep();
    this.state.stopRequested = true;

    this.appendLog({
      level: 'warn',
      message: 'Stop requested. Stepcat will exit after the current step completes.',
      timestamp: Date.now(),
    });

    this.rerender();
  }

  private logRenderMetrics(metrics: RenderMetrics, renderOptions: RenderOptions): void {
    if (!this.renderLogState) {
      return;
    }

    this.renderLogState.renderCount += 1;
    this.renderLogState.totalRenderTime += metrics.renderTime;

    const now = Date.now();
    const elapsedMs = now - this.renderLogState.lastLogAt;

    if (elapsedMs < RENDER_LOG_INTERVAL_MS) {
      return;
    }

    const fps = (this.renderLogState.renderCount * 1000) / elapsedMs;
    const averageRenderTime = this.renderLogState.totalRenderTime / this.renderLogState.renderCount;

    getLogger()?.debug(
      'TUI',
      `render stats: fps=${fps.toFixed(1)} avgRenderTime=${averageRenderTime.toFixed(2)}ms maxFps=${renderOptions.maxFps ?? 'default'} incremental=${renderOptions.incrementalRendering ? 'on' : 'off'}`
    );

    this.renderLogState = {
      lastLogAt: now,
      renderCount: 0,
      totalRenderTime: 0,
    };
  }

  private handleResize(): void {
    this.state.terminalWidth = process.stdout.columns || 80;
    this.state.terminalHeight = process.stdout.rows || 24;
    this.rerender();
  }

  async shutdown(): Promise<void> {
    if (this.rerenderTimer) {
      clearTimeout(this.rerenderTimer);
      this.rerenderTimer = null;
      this.rerenderPending = false;
    }

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
