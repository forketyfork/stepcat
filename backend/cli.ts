#!/usr/bin/env node

import { Command } from 'commander';
import { Orchestrator } from './orchestrator.js';
import { OrchestratorEventEmitter } from './events.js';
import { Database } from './database.js';
import { TUIAdapter, UIAdapter } from './ui/index.js';
import { PreflightRunner } from './preflight-runner.js';
import { StopController } from './stop-controller.js';
import { resolve } from 'path';
import { existsSync } from 'fs';

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
  .option('--implementation-agent <agent>', 'Agent to use for implementation (claude|codex)')
  .option('--review-agent <agent>', 'Agent to use for code review (claude|codex)')
  .option('--preflight', 'Run preflight check to detect missing permissions')
  .action(async (options) => {
    // Handle preflight check
    if (options.preflight) {
      if (!options.file || !options.dir) {
        writeErrorLine('Preflight check requires both --file and --dir options.');
        writeErrorLine('Usage: stepcat --preflight --file plan.md --dir /path/to/project');
        process.exit(1);
      }

      const planFile = resolve(options.file);
      const workDir = resolve(options.dir);

      if (!existsSync(planFile)) {
        writeErrorLine(`Plan file not found: ${planFile}`);
        process.exit(1);
      }

      if (!existsSync(workDir)) {
        writeErrorLine(`Work directory not found: ${workDir}`);
        process.exit(1);
      }

      const preflightRunner = new PreflightRunner();
      try {
        const result = await preflightRunner.run({ planFile, workDir });
        process.stdout.write(`${preflightRunner.formatOutput(result)}\n`);

        if (!result.success) {
          process.exit(1);
        }

        // Exit with code 2 if there are missing permissions (needs action)
        if (result.analysis && result.analysis.missing_permissions.length > 0) {
          process.exit(2);
        }

        process.exit(0);
      } catch (error) {
        writeErrorLine(`Preflight check failed: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    }

    const startTime = Date.now();
    let storage: Database | null = null;
    let uiAdapters: UIAdapter[] = [];

    try {
      let planFile: string;
      let workDir: string;
      const executionId: number | undefined = options.executionId;

      const normalizeAgentOption = (value: string, flag: string): 'claude' | 'codex' => {
        const normalized = value.toLowerCase();
        if (normalized !== 'claude' && normalized !== 'codex') {
          throw new Error(
            `Invalid ${flag} value: ${value}. Expected 'claude' or 'codex'.`
          );
        }
        return normalized as 'claude' | 'codex';
      };

      const implementationAgent = options.implementationAgent
        ? normalizeAgentOption(options.implementationAgent, '--implementation-agent')
        : undefined;
      const reviewAgent = options.reviewAgent
        ? normalizeAgentOption(options.reviewAgent, '--review-agent')
        : undefined;
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
      uiAdapters = [];
      const stopController = new StopController();
      const tuiAdapter = new TUIAdapter({ storage, stopController });
      await tuiAdapter.initialize();
      uiAdapters.push(tuiAdapter);

      const orchestrator = new Orchestrator({
        planFile,
        workDir,
        githubToken: options.token,
        buildTimeoutMinutes: options.buildTimeout,
        agentTimeoutMinutes: options.agentTimeout,
        eventEmitter,
        uiAdapters,
        silent: true,
        executionId,
        storage,
        implementationAgent,
        reviewAgent,
        maxIterationsPerStep,
        stopController,
      });

      try {
        await orchestrator.run();
      } catch (error) {
        eventEmitter.emit('event', {
          type: 'error',
          timestamp: Date.now(),
          error: error instanceof Error ? error.message : String(error)
        });
        throw error;
      }

      const stoppedAfterStep = stopController?.wasStopAfterStepTriggered() ?? false;

      if (stoppedAfterStep) {
        for (const adapter of uiAdapters) {
          await adapter.shutdown();
        }
        if (storage) {
          storage.close();
        }
        process.exit(0);
      }

      await new Promise(() => {});

      process.exit(0);
    } catch (error) {
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

      for (const adapter of uiAdapters) {
        await adapter.shutdown();
      }

      if (storage) {
        storage.close();
      }

      process.exit(1);
    }
  });

program.parse();
