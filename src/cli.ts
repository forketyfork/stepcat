#!/usr/bin/env node

import { Command } from 'commander';
import { Orchestrator } from './orchestrator';
import { resolve } from 'path';

const program = new Command();

program
  .name('stepcat')
  .description('Step-by-step agent orchestration solution')
  .version('0.1.0')
  .requiredOption('-f, --file <path>', 'Path to the implementation plan file')
  .requiredOption('-d, --dir <path>', 'Path to the work directory')
  .option('-t, --token <token>', 'GitHub token (defaults to GITHUB_TOKEN env var)')
  .option('--max-build-attempts <number>', 'Maximum build fix attempts (default: 3)', parseInt)
  .option('--build-timeout <minutes>', 'GitHub Actions check timeout in minutes (default: 30)', parseInt)
  .option('--agent-timeout <minutes>', 'Agent execution timeout in minutes (default: 30)', parseInt)
  .action(async (options) => {
    const startTime = Date.now();

    try {
      const planFile = resolve(options.file);
      const workDir = resolve(options.dir);

      console.log('═'.repeat(80));
      console.log('STEPCAT - Step-by-step Agent Orchestration');
      console.log('═'.repeat(80));
      console.log(`Plan file:      ${planFile}`);
      console.log(`Work directory: ${workDir}`);
      console.log(`GitHub token:   ${options.token ? '***provided***' : process.env.GITHUB_TOKEN ? '***from env***' : '⚠ NOT SET'}`);
      console.log('═'.repeat(80));

      if (!options.token && !process.env.GITHUB_TOKEN) {
        throw new Error(
          'GitHub token not provided.\n' +
          'Either:\n' +
          '  1. Set GITHUB_TOKEN environment variable\n' +
          '  2. Use --token flag'
        );
      }

      const orchestrator = new Orchestrator({
        planFile,
        workDir,
        githubToken: options.token,
        maxBuildAttempts: options.maxBuildAttempts,
        buildTimeoutMinutes: options.buildTimeout,
        agentTimeoutMinutes: options.agentTimeout
      });

      await orchestrator.run();

      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      const minutes = Math.floor(elapsed / 60);
      const seconds = elapsed % 60;

      console.log('\n' + '═'.repeat(80));
      console.log('✓✓✓ SUCCESS ✓✓✓');
      console.log('═'.repeat(80));
      console.log(`Total time: ${minutes}m ${seconds}s`);
      console.log('═'.repeat(80));

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

      process.exit(1);
    }
  });

program.parse();
