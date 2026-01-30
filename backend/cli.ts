#!/usr/bin/env node
/* eslint-disable n/no-process-exit -- CLI entry point requires process.exit for exit codes */

import { existsSync } from 'fs';
import { resolve } from 'path';

import { Command } from 'commander';

import { Database } from './database.js';
import { OrchestratorEventEmitter } from './events.js';
import { getLogger } from './logger.js';
import { Orchestrator } from './orchestrator.js';
import { PreflightRunner } from './preflight-runner.js';
import { StopController } from './stop-controller.js';
import type { UIAdapter } from './ui/index.js';
import { TUIAdapter } from './ui/index.js';

interface CliOptions {
  file?: string;
  dir?: string;
  executionId?: number;
  token?: string;
  buildTimeout?: number;
  agentTimeout?: number;
  maxIterations?: number;
  exitOnComplete?: boolean;
  implementationAgent?: string;
  reviewAgent?: string;
  preflight?: boolean;
  status?: boolean;
}

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
  .option('--exit-on-complete', 'Exit the TUI after execution completes (default: stay open)')
  .option('--implementation-agent <agent>', 'Agent to use for implementation (claude|codex)')
  .option('--review-agent <agent>', 'Agent to use for code review (claude|codex)')
  .option('--preflight', 'Run preflight check to detect missing permissions')
  .option('--status', 'Show execution status without starting TUI')
  .action(async (options: CliOptions) => {
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

    // Handle status command
    if (options.status) {
      const workDir = options.dir ? resolve(options.dir) : process.cwd();
      const dbPath = resolve(workDir, '.stepcat', 'executions.db');

      if (!existsSync(dbPath)) {
        writeErrorLine(`No database found at ${dbPath}`);
        writeErrorLine('No executions have been run in this directory.');
        process.exit(1);
      }

      const database = new Database(workDir);

      try {
        let plan;
        if (options.executionId) {
          plan = database.getPlan(options.executionId);
          if (!plan) {
            writeErrorLine(`Execution ID ${options.executionId} not found.`);
            process.exit(1);
          }
        } else {
          const plans = database.getAllPlans();
          if (plans.length === 0) {
            writeErrorLine('No executions found in database.');
            process.exit(1);
          }
          plan = plans[0];
        }

        const state = database.getExecutionState(plan.id);

        process.stdout.write('\n');
        process.stdout.write('═'.repeat(80) + '\n');
        process.stdout.write(`EXECUTION STATUS: #${plan.id}\n`);
        process.stdout.write('═'.repeat(80) + '\n');
        process.stdout.write(`Plan: ${plan.planFilePath}\n`);
        process.stdout.write(`Work dir: ${plan.workDir}\n`);
        process.stdout.write(`Started: ${plan.createdAt}\n`);
        process.stdout.write('─'.repeat(80) + '\n');

        const completedSteps = state.steps.filter(step => step.status === 'completed').length;
        const failedSteps = state.steps.filter(step => step.status === 'failed').length;
        const inProgressSteps = state.steps.filter(step => step.status === 'in_progress').length;
        const pendingSteps = state.steps.filter(step => step.status === 'pending').length;

        process.stdout.write(`Steps: ${completedSteps} completed, ${inProgressSteps} in progress, ${pendingSteps} pending, ${failedSteps} failed\n`);
        process.stdout.write('─'.repeat(80) + '\n');

        for (const step of state.steps) {
          const statusIcon: Record<string, string> = {
            'completed': '✓',
            'in_progress': '●',
            'pending': '○',
            'failed': '✗',
          };

          const stepIterations = state.iterations.filter(iteration => iteration.stepId === step.id);
          const iterationCount = stepIterations.length;

          process.stdout.write(`${statusIcon[step.status]} Step ${step.stepNumber}: ${step.title}\n`);
          process.stdout.write(`  Status: ${step.status}, Iterations: ${iterationCount}\n`);

          if ((step.status === 'in_progress' || step.status === 'failed') && stepIterations.length > 0) {
            const currentIteration = stepIterations[stepIterations.length - 1];
            process.stdout.write(`  Current: #${currentIteration.iterationNumber} (${currentIteration.type})\n`);
            if (currentIteration.phase) {
              process.stdout.write(`  Phase: ${currentIteration.phase}\n`);
            }
            if (currentIteration.commitSha) {
              process.stdout.write(`  Commit: ${currentIteration.commitSha.substring(0, 7)}\n`);
            }
            if (currentIteration.buildStatus) {
              process.stdout.write(`  Build: ${currentIteration.buildStatus}\n`);
            }
            if (currentIteration.reviewStatus) {
              process.stdout.write(`  Review: ${currentIteration.reviewStatus}\n`);
            }
            if (currentIteration.interruptionReason) {
              process.stdout.write(`  Interruption: ${currentIteration.interruptionReason}\n`);
            }

            const stepIssues = state.issues.filter(issue =>
              stepIterations.some(iter => iter.id === issue.iterationId) && issue.status === 'open'
            );
            if (stepIssues.length > 0) {
              process.stdout.write(`  Open issues: ${stepIssues.length}\n`);
            }
          }
        }

        process.stdout.write('═'.repeat(80) + '\n');
      } finally {
        database.close();
      }

      process.exit(0);
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
        return normalized;
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

      // Set up signal handlers for graceful shutdown
      const cleanup = async (reason: string): Promise<void> => {
        getLogger()?.error('CLI', `Process terminating, starting cleanup: ${reason}`);
        for (const adapter of uiAdapters) {
          try {
            await adapter.shutdown();
          } catch {
            // Ignore shutdown errors during termination
          }
        }
        if (storage) {
          storage.close();
        }
        getLogger()?.close();
      };

      process.on('SIGINT', () => {
        void cleanup('Received SIGINT').then(() => process.exit(130));
      });

      process.on('SIGTERM', () => {
        void cleanup('Received SIGTERM').then(() => process.exit(143));
      });

      process.on('uncaughtException', (error: Error) => {
        getLogger()?.error('CLI', `Uncaught exception: ${error.message}`);
        if (error.stack) {
          getLogger()?.error('CLI', error.stack);
        }
        void cleanup('Uncaught exception').then(() => process.exit(1));
      });

      process.on('unhandledRejection', (reason: unknown) => {
        const message = reason instanceof Error ? reason.message : String(reason);
        getLogger()?.error('CLI', `Unhandled rejection: ${message}`);
        void cleanup('Unhandled rejection').then(() => process.exit(1));
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

      const stoppedAfterStep = stopController.wasStopAfterStepTriggered();

      if (stoppedAfterStep) {
        for (const adapter of uiAdapters) {
          await adapter.shutdown();
        }
        storage.close();
        process.exit(0);
      }

      if (!options.exitOnComplete) {
        await new Promise(() => {});
      }

      for (const adapter of uiAdapters) {
        await adapter.shutdown();
      }

      storage.close();

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
