#!/usr/bin/env node

import { Command } from 'commander';
import { Orchestrator } from './orchestrator';
import { OrchestratorEventEmitter } from './events';
import { WebServer } from './web-server';
import { Database } from './database';
import { resolve } from 'path';
import { existsSync } from 'fs';
import { execSync } from 'child_process';

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
  .option('--ui', 'Launch web UI (default: false)')
  .option('--port <number>', 'Web UI port (default: 3742)', parseInt)
  .option('--no-auto-open', 'Do not automatically open browser when using --ui')
  .action(async (options) => {
    const startTime = Date.now();
    let webServer: WebServer | null = null;

    try {
      let planFile: string;
      let workDir: string;
      const executionId: number | undefined = options.executionId;

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

        try {
          const gitStatus = execSync('git status --porcelain', {
            cwd: workDir,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe']
          }).trim();

          if (gitStatus) {
            throw new Error(
              'Git working directory is not clean. Please commit or stash your changes before resuming.\n' +
              'Uncommitted changes:\n' + gitStatus
            );
          }
        } catch (error) {
          if (error instanceof Error) {
            if (error.message.includes('working directory is not clean')) {
              throw error;
            }
            if ('code' in error || error.message.toLowerCase().includes('git')) {
              throw new Error(
                'Failed to check git status. Ensure:\n' +
                '  1. You are in a git repository\n' +
                '  2. git is installed and available\n' +
                `  3. The work directory is correct: ${workDir}\n` +
                `Original error: ${error.message}`
              );
            }
          }
          throw error;
        }

        if (!options.ui) {
          console.log('═'.repeat(80));
          console.log('STEPCAT - Resuming Execution');
          console.log('═'.repeat(80));
          console.log(`Execution ID:   ${executionId}`);
          console.log(`Plan file:      ${planFile}`);
          console.log(`Work directory: ${workDir}`);
          console.log(`GitHub token:   ${options.token ? '***provided***' : process.env.GITHUB_TOKEN ? '***from env***' : '⚠ NOT SET'}`);
          console.log('═'.repeat(80));
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

        if (!options.ui) {
          console.log('═'.repeat(80));
          console.log('STEPCAT - Step-by-step Agent Orchestration');
          console.log('═'.repeat(80));
          console.log(`Plan file:      ${planFile}`);
          console.log(`Work directory: ${workDir}`);
          console.log(`GitHub token:   ${options.token ? '***provided***' : process.env.GITHUB_TOKEN ? '***from env***' : '⚠ NOT SET'}`);
          console.log('═'.repeat(80));
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
      const database = new Database(workDir);

      if (options.ui) {
        webServer = new WebServer({
          port: options.port,
          eventEmitter,
          autoOpen: options.autoOpen,
          database
        });

        await webServer.start();
      }

      const orchestrator = new Orchestrator({
        planFile,
        workDir,
        githubToken: options.token,
        buildTimeoutMinutes: options.buildTimeout,
        agentTimeoutMinutes: options.agentTimeout,
        eventEmitter,
        silent: options.ui,
        executionId
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
        throw error;
      }

      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      const minutes = Math.floor(elapsed / 60);
      const seconds = elapsed % 60;

      if (!options.ui) {
        console.log('\n' + '═'.repeat(80));
        console.log('✓✓✓ SUCCESS ✓✓✓');
        console.log('═'.repeat(80));
        console.log(`Total time: ${minutes}m ${seconds}s`);

        if (!executionId) {
          console.log('═'.repeat(80));
          console.log(`Execution ID: ${completedExecutionId}`);
          console.log('─'.repeat(80));
          console.log('To resume this execution later, use:');
          console.log(`  stepcat --execution-id ${completedExecutionId}`);
          console.log(`Or from a different directory:`);
          console.log(`  stepcat --execution-id ${completedExecutionId} --dir ${workDir}`);
        }

        console.log('═'.repeat(80));
      }

      if (webServer) {
        console.log('\n' + '═'.repeat(80));
        console.log('All steps completed! Web UI will remain open for viewing.');
        console.log('Press Ctrl+C to exit.');
        console.log('═'.repeat(80));

        await new Promise(() => {});
      }

      process.exit(0);
    } catch (error) {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      const minutes = Math.floor(elapsed / 60);
      const seconds = elapsed % 60;

      console.error('\n' + '═'.repeat(80));
      console.error('✗✗✗ FAILED ✗✗✗');
      console.error('═'.repeat(80));
      console.error(error instanceof Error ? error.message : String(error));
      console.error('═'.repeat(80));
      console.error(`Time before failure: ${minutes}m ${seconds}s`);
      console.error('═'.repeat(80));

      if (error instanceof Error && error.stack && process.env.DEBUG) {
        console.error('\nStack trace (DEBUG mode):');
        console.error(error.stack);
      }

      if (webServer) {
        await webServer.stop();
      }

      process.exit(1);
    }
  });

program.parse();
