#!/usr/bin/env node

import { Command } from 'commander';
import { Orchestrator } from './orchestrator.js';
import { OrchestratorEventEmitter, OrchestratorEvent } from './events.js';
import { Database } from './database.js';
import { WebSocketUIAdapter, TUIAdapter, UIAdapter } from './ui/index.js';
import { StopController } from './stop-controller.js';
import { resolve } from 'path';
import { existsSync } from 'fs';

const writeLine = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

const writeErrorLine = (line: string): void => {
  process.stderr.write(`${line}\n`);
};

const program = new Command();

program
  .name('stepcat')
  .description('Step-by-step agent orchestration solution')
  .version('0.1.0')
  .option('-f, --file <path>', 'Path to the implementation plan file')
  .option('-d, --dir <path>', 'Path to the work directory')
  .option('-e, --execution-id <id>', 'Resume existing execution by ID (positive integer)', parseInt)
  .option('-t, --token <token>', 'GitHub token (defaults to GITHUB_TOKEN env var)')
  .option('--build-timeout <minutes>', 'GitHub Actions check timeout in minutes (default: 30)', parseInt)
  .option('--agent-timeout <minutes>', 'Agent execution timeout in minutes (default: 30)', parseInt)
  .option('--max-iterations <count>', 'Maximum iterations per step (default: 3)', parseInt)
  .option('--ui', 'Launch web UI (default: false)')
  .option('--tui', 'Launch terminal UI (default: false)')
  .option('--port <number>', 'Web UI port (default: 3742)', parseInt)
  .option('--no-auto-open', 'Do not automatically open browser when using --ui')
  .action(async (options) => {
    const startTime = Date.now();
    let uiAdapter: UIAdapter | null = null;
    const uiAdapters: UIAdapter[] = [];
    let storage: Database | null = null;

    try {
      let planFile: string;
      let workDir: string;
      const executionId: number | undefined = options.executionId;
      const rawMaxIterations: number | undefined = options.maxIterations;
      let maxIterationsPerStep: number | undefined;
      if (rawMaxIterations !== undefined) {
        if (!Number.isInteger(rawMaxIterations) || rawMaxIterations <= 0) {
          throw new Error(
            `Invalid --max-iterations: expected a positive integer, got: ${options.maxIterations}`
          );
        }
        maxIterationsPerStep = rawMaxIterations;
      }

      if (executionId) {
        if (!Number.isInteger(executionId) || executionId <= 0) {
          throw new Error(
            `Invalid --execution-id: expected a positive integer, got: ${options.executionId}`
          );
        }

        workDir = options.dir ? resolve(options.dir) : process.cwd();

        const dbPath = resolve(workDir, '.stepcat', 'executions.db');
        if (!existsSync(dbPath)) {
          throw new Error(
            `Database not found at ${dbPath}\n` +
            'Cannot resume execution. ' +
            (options.dir
              ? 'Ensure you specified the correct work directory with --dir.'
              : 'Try running from the project root directory or specify --dir.')
          );
        }

        const database = new Database(workDir);
        const plan = database.getPlan(executionId);
        database.close();

        if (!plan) {
          throw new Error(
            `Execution ID ${executionId} not found in database.\n` +
            `Database location: ${dbPath}`
          );
        }

        const dbWorkDir = resolve(plan.workDir);
        const actualWorkDir = resolve(workDir);

        if (dbWorkDir !== actualWorkDir) {
          throw new Error(
            `Work directory mismatch:\n` +
            `  Expected (from database): ${dbWorkDir}\n` +
            `  Actual (current):         ${actualWorkDir}\n` +
            (options.dir
              ? 'The --dir you provided does not match the execution\'s work directory.'
              : 'Try running from the correct directory or use --dir to specify it.')
          );
        }

        if (options.file) {
          const providedPlanFile = resolve(options.file);
          const dbPlanFile = resolve(plan.planFilePath);
          if (providedPlanFile !== dbPlanFile) {
            throw new Error(
              `Plan file mismatch when resuming execution ${executionId}:\n` +
              `  Expected (from database): ${dbPlanFile}\n` +
              `  Provided (--file):        ${providedPlanFile}\n` +
              'Remove --file flag when resuming, or ensure it matches the original plan file.'
            );
          }
        }

        planFile = plan.planFilePath;

        if (!existsSync(planFile)) {
          throw new Error(
            `Plan file not found: ${planFile}\n` +
            'The plan file may have been moved or deleted.'
          );
        }

        // Note: We no longer block on uncommitted changes here.
        // The Orchestrator's tryRecoverUncommittedChanges() will handle
        // resuming interrupted sessions with uncommitted changes.

        if (!options.ui && !options.tui) {
          writeLine('═'.repeat(80));
          writeLine('STEPCAT - Resuming Execution');
          writeLine('═'.repeat(80));
          writeLine(`Execution ID:   ${executionId}`);
          writeLine(`Plan file:      ${planFile}`);
          writeLine(`Work directory: ${workDir}`);
          writeLine(`GitHub token:   ${options.token ? '***provided***' : process.env.GITHUB_TOKEN ? '***from env***' : '⚠ NOT SET'}`);
          writeLine(`Max iterations: ${maxIterationsPerStep ?? 3}`);
          writeLine('═'.repeat(80));
        }
      } else {
        if (!options.file || !options.dir) {
          throw new Error(
            'Starting a new execution requires both --file and --dir options.\n' +
            'To resume an existing execution, use --execution-id (--dir is optional).\n\n' +
            'Examples:\n' +
            '  New execution:    stepcat --file plan.md --dir /path/to/project\n' +
            '  Resume execution: stepcat --execution-id 123\n' +
            '  Resume with dir:  stepcat --execution-id 123 --dir /path/to/project'
          );
        }

        planFile = resolve(options.file);
        workDir = resolve(options.dir);

        if (!options.ui && !options.tui) {
          writeLine('═'.repeat(80));
          writeLine('STEPCAT - Step-by-step Agent Orchestration');
          writeLine('═'.repeat(80));
          writeLine(`Plan file:      ${planFile}`);
          writeLine(`Work directory: ${workDir}`);
          writeLine(`GitHub token:   ${options.token ? '***provided***' : process.env.GITHUB_TOKEN ? '***from env***' : '⚠ NOT SET'}`);
          writeLine(`Max iterations: ${maxIterationsPerStep ?? 3}`);
          writeLine('═'.repeat(80));
        }
      }

      if (!options.token && !process.env.GITHUB_TOKEN) {
        throw new Error(
          'GitHub token not provided.\n' +
          'Either:\n' +
          '  1. Set GITHUB_TOKEN environment variable\n' +
          '  2. Use --token flag'
        );
      }

      const eventEmitter = new OrchestratorEventEmitter();
      storage = new Database(workDir);
      const stopController = options.tui ? new StopController() : undefined;

      if (options.ui) {
        uiAdapter = new WebSocketUIAdapter({
          port: options.port,
          autoOpen: options.autoOpen,
          storage
        });

        await uiAdapter.initialize();
        const uiPort = options.port ?? 3742;
        writeLine('═'.repeat(80));
        writeLine(`🎨 Stepcat Web UI is running at: http://localhost:${uiPort}`);
        writeLine('═'.repeat(80));
        uiAdapters.push(uiAdapter);
      }

      if (options.tui) {
        const tuiAdapter = new TUIAdapter({ storage, stopController });
        await tuiAdapter.initialize();
        uiAdapters.push(tuiAdapter);
      }

      const orchestrator = new Orchestrator({
        planFile,
        workDir,
        githubToken: options.token,
        buildTimeoutMinutes: options.buildTimeout,
        agentTimeoutMinutes: options.agentTimeout,
        eventEmitter,
        uiAdapters,
        silent: options.ui || options.tui,
        executionId,
        storage,
        maxIterationsPerStep,
        stopController
      });

      eventEmitter.on('event', (event: OrchestratorEvent) => {
        if (event.type === 'execution_started' && !options.ui && !options.tui) {
          writeLine('═'.repeat(80));
          writeLine(`Execution ID: ${event.executionId}`);
          writeLine('═'.repeat(80));
        }
      });

      let completedExecutionId: number;
      try {
        completedExecutionId = await orchestrator.run();
      } catch (error) {
        eventEmitter.emit('event', {
          type: 'error',
          timestamp: Date.now(),
          error: error instanceof Error ? error.message : String(error)
        });
        await new Promise(resolve => setTimeout(resolve, 100));
        throw error;
      }

      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      const minutes = Math.floor(elapsed / 60);
      const seconds = elapsed % 60;
      const stoppedAfterStep = stopController?.wasStopAfterStepTriggered() ?? false;

      if (!options.ui && !options.tui) {
        writeLine('\n' + '═'.repeat(80));
        writeLine('✓✓✓ SUCCESS ✓✓✓');
        writeLine('═'.repeat(80));
        writeLine(`Total time: ${minutes}m ${seconds}s`);

        if (!executionId) {
          writeLine('═'.repeat(80));
          writeLine(`Execution ID: ${completedExecutionId}`);
          writeLine('─'.repeat(80));
          writeLine('To resume this execution later, use:');
          writeLine(`  stepcat --execution-id ${completedExecutionId}`);
          writeLine('Or from a different directory:');
          writeLine(`  stepcat --execution-id ${completedExecutionId} --dir ${workDir}`);
        }

        writeLine('═'.repeat(80));
      }

      if (stoppedAfterStep) {
        for (const adapter of uiAdapters) {
          await adapter.shutdown();
        }
        if (storage) {
          storage.close();
        }
        process.exit(0);
      }

      if (uiAdapter) {
        writeLine('\n' + '═'.repeat(80));
        writeLine('All steps completed! Web UI will remain open for viewing.');
        writeLine('Press Ctrl+C to exit.');
        writeLine('═'.repeat(80));

        await new Promise(() => {});
      } else if (storage) {
        storage.close();
      }

      process.exit(0);
    } catch (error) {
      for (const adapter of uiAdapters) {
        await adapter.shutdown();
      }

      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      const minutes = Math.floor(elapsed / 60);
      const seconds = elapsed % 60;

      writeErrorLine('\n' + '═'.repeat(80));
      writeErrorLine('✗✗✗ FAILED ✗✗✗');
      writeErrorLine('═'.repeat(80));
      writeErrorLine(error instanceof Error ? error.message : String(error));
      writeErrorLine('═'.repeat(80));
      writeErrorLine(`Time before failure: ${minutes}m ${seconds}s`);
      writeErrorLine('═'.repeat(80));

      if (error instanceof Error && error.stack && process.env.DEBUG) {
        writeErrorLine('\nStack trace (DEBUG mode):');
        writeErrorLine(error.stack);
      }

      if (storage) {
        storage.close();
      }

      process.exit(1);
    }
  });

program.parse();
