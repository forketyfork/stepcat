import { StepParser, Step } from './step-parser';
import { ClaudeRunner } from './claude-runner';
import { CodexRunner } from './codex-runner';
import { GitHubChecker } from './github-checker';
import { execSync } from 'child_process';
import { OrchestratorEventEmitter } from './events';

export interface OrchestratorConfig {
  planFile: string;
  workDir: string;
  githubToken?: string;
  maxBuildAttempts?: number;
  buildTimeoutMinutes?: number;
  agentTimeoutMinutes?: number;
  eventEmitter?: OrchestratorEventEmitter;
  silent?: boolean;
}

export class Orchestrator {
  private parser: StepParser;
  private claudeRunner: ClaudeRunner;
  private codexRunner: CodexRunner;
  private githubChecker: GitHubChecker;
  private workDir: string;
  private planFile: string;
  private maxBuildAttempts: number;
  private buildTimeoutMinutes: number;
  private agentTimeoutMinutes: number;
  private eventEmitter: OrchestratorEventEmitter;
  private silent: boolean;

  constructor(config: OrchestratorConfig) {
    this.parser = new StepParser(config.planFile);
    this.planFile = config.planFile;
    this.claudeRunner = new ClaudeRunner();
    this.codexRunner = new CodexRunner();
    this.workDir = config.workDir;
    this.maxBuildAttempts = config.maxBuildAttempts ?? 3;
    this.buildTimeoutMinutes = config.buildTimeoutMinutes ?? 30;
    this.agentTimeoutMinutes = config.agentTimeoutMinutes ?? 30;
    this.eventEmitter = config.eventEmitter ?? new OrchestratorEventEmitter();
    this.silent = config.silent ?? false;

    const repoInfo = GitHubChecker.parseRepoInfo(config.workDir);

    this.githubChecker = new GitHubChecker({
      owner: repoInfo.owner,
      repo: repoInfo.repo,
      token: config.githubToken,
      workDir: config.workDir,
      eventEmitter: this.eventEmitter
    });
  }

  getEventEmitter(): OrchestratorEventEmitter {
    return this.eventEmitter;
  }

  private log(message: string, level: 'info' | 'warn' | 'error' | 'success' = 'info', stepNumber?: number) {
    if (!this.silent) {
      console.log(message);
    }
    this.eventEmitter.emit('event', {
      type: 'log',
      timestamp: Date.now(),
      level,
      message,
      stepNumber
    });
  }

  async run(): Promise<void> {
    const startTime = Date.now();
    const allSteps = this.parser.parseSteps();
    const pendingSteps = allSteps.filter(s => s.phase !== 'done');

    this.eventEmitter.emit('event', {
      type: 'init',
      timestamp: Date.now(),
      totalSteps: allSteps.length,
      pendingSteps: pendingSteps.length,
      doneSteps: allSteps.length - pendingSteps.length,
      steps: allSteps.map(s => ({
        number: s.number,
        title: s.title,
        phase: s.phase
      }))
    });

    this.log('═'.repeat(80));
    this.log(`Found ${allSteps.length} steps (${allSteps.length - pendingSteps.length} done, ${pendingSteps.length} pending)`);
    this.log('═'.repeat(80));
    allSteps.forEach(s => {
      const statusSymbol = s.phase === 'done' ? '✓' : s.phase === 'review' ? '◐' : s.phase === 'implementation' ? '◔' : ' ';
      const phaseLabel = s.phase !== 'pending' ? ` [${s.phase}]` : '';
      this.log(`  [${statusSymbol}] ${s.number}. ${s.title}${phaseLabel}`);
    });
    this.log('═'.repeat(80));

    if (pendingSteps.length === 0) {
      this.log('\n✓ All steps are already marked as done!', 'success');
      return;
    }

    this.log(`\nStarting from step ${pendingSteps[0].number}...`);

    for (let i = 0; i < pendingSteps.length; i++) {
      const step = pendingSteps[i];

      this.eventEmitter.emit('event', {
        type: 'step_start',
        timestamp: Date.now(),
        stepNumber: step.number,
        stepTitle: step.title,
        phase: step.phase,
        progress: {
          current: i + 1,
          total: pendingSteps.length
        }
      });

      this.log(`\n${'═'.repeat(80)}`);
      this.log(`STEP ${step.number}/${allSteps.length}: ${step.title}`);
      this.log(`Progress: ${i + 1}/${pendingSteps.length} pending steps | Current phase: ${step.phase}`);
      this.log('═'.repeat(80));

      await this.executeStep(step);

      this.githubChecker.ensureNoUncommittedChanges();

      this.eventEmitter.emit('event', {
        type: 'step_complete',
        timestamp: Date.now(),
        stepNumber: step.number,
        stepTitle: step.title
      });

      this.log('═'.repeat(80));
      this.log(`✓ STEP ${step.number}/${allSteps.length} COMPLETED`, 'success');
      this.log('═'.repeat(80));
    }

    const totalTime = Date.now() - startTime;

    this.eventEmitter.emit('event', {
      type: 'all_complete',
      timestamp: Date.now(),
      totalTime
    });

    this.log('\n' + '═'.repeat(80));
    this.log('✓✓✓ ALL STEPS COMPLETED SUCCESSFULLY ✓✓✓', 'success');
    this.log('═'.repeat(80));
  }

  private async executeStep(step: Step): Promise<void> {
    if (step.phase === 'pending') {
      this.eventEmitter.emit('event', {
        type: 'phase_start',
        timestamp: Date.now(),
        stepNumber: step.number,
        phase: 'implementation',
        phaseLabel: '[1/3] Implementation Phase'
      });

      this.log('\n[1/3] Implementation Phase');
      this.log('─'.repeat(80));

      const prompt = this.claudeRunner.buildImplementationPrompt(step.number, this.parser.getContent());
      await this.claudeRunner.run({
        workDir: this.workDir,
        prompt,
        timeoutMinutes: this.agentTimeoutMinutes
      });

      this.parser.updateStepPhase(step.number, 'implementation');
      this.amendPlanFileAndPush();
      step.phase = 'implementation';

      this.eventEmitter.emit('event', {
        type: 'phase_complete',
        timestamp: Date.now(),
        stepNumber: step.number,
        phase: 'implementation'
      });
    } else {
      this.log('\n[1/3] Implementation Phase (skipped - already completed)');
    }

    if (step.phase === 'implementation') {
      this.eventEmitter.emit('event', {
        type: 'phase_start',
        timestamp: Date.now(),
        stepNumber: step.number,
        phase: 'build',
        phaseLabel: '[2/3] Build Verification Phase'
      });

      this.log('\n[2/3] Build Verification Phase');
      this.log('─'.repeat(80));

      await this.ensureBuildPasses();

      this.parser.updateStepPhase(step.number, 'review');
      this.amendPlanFileAndPush();
      step.phase = 'review';

      this.eventEmitter.emit('event', {
        type: 'phase_complete',
        timestamp: Date.now(),
        stepNumber: step.number,
        phase: 'build'
      });
    } else {
      this.log('\n[2/3] Build Verification Phase (skipped - already completed)');
    }

    if (step.phase === 'review') {
      this.eventEmitter.emit('event', {
        type: 'phase_start',
        timestamp: Date.now(),
        stepNumber: step.number,
        phase: 'review',
        phaseLabel: '[3/3] Code Review Phase'
      });

      this.log('\n[3/3] Code Review Phase');
      this.log('─'.repeat(80));

      await this.performCodeReview();

      this.parser.updateStepPhase(step.number, 'done');
      this.amendPlanFileAndPush();
      step.phase = 'done';

      this.eventEmitter.emit('event', {
        type: 'phase_complete',
        timestamp: Date.now(),
        stepNumber: step.number,
        phase: 'review'
      });
    } else {
      this.log('\n[3/3] Code Review Phase (skipped - already completed)');
    }
  }

  private async ensureBuildPasses(): Promise<void> {
    let attempt = 0;

    while (attempt < this.maxBuildAttempts) {
      attempt++;
      const sha = this.githubChecker.getLatestCommitSha();

      this.eventEmitter.emit('event', {
        type: 'build_attempt',
        timestamp: Date.now(),
        attempt,
        maxAttempts: this.maxBuildAttempts,
        sha
      });

      this.log(`\nChecking GitHub Actions (attempt ${attempt}/${this.maxBuildAttempts})`);
      this.log(`Commit SHA: ${sha}`);

      this.eventEmitter.emit('event', {
        type: 'github_check',
        timestamp: Date.now(),
        status: 'waiting',
        sha,
        attempt,
        maxAttempts: this.maxBuildAttempts
      });

      const buildPassed = await this.githubChecker.waitForChecksToPass(sha, this.buildTimeoutMinutes);

      if (buildPassed) {
        this.eventEmitter.emit('event', {
          type: 'github_check',
          timestamp: Date.now(),
          status: 'success',
          sha,
          attempt,
          maxAttempts: this.maxBuildAttempts
        });

        this.log('─'.repeat(80));
        this.log('✓ All GitHub Actions checks passed', 'success');
        this.log('─'.repeat(80));
        return;
      }

      this.eventEmitter.emit('event', {
        type: 'github_check',
        timestamp: Date.now(),
        status: 'failure',
        sha,
        attempt,
        maxAttempts: this.maxBuildAttempts
      });

      if (attempt >= this.maxBuildAttempts) {
        throw new Error(`Build failed after ${this.maxBuildAttempts} attempts. Aborting.`);
      }

      this.log('─'.repeat(80));
      this.log(`⚠ Build failed. Attempting to fix (${attempt}/${this.maxBuildAttempts})...`, 'warn');
      this.log('─'.repeat(80));

      const fixPrompt = this.claudeRunner.buildFixPrompt(
        'Build checks failed. Please review the GitHub Actions logs and fix the issues.'
      );

      await this.claudeRunner.run({
        workDir: this.workDir,
        prompt: fixPrompt,
        timeoutMinutes: this.agentTimeoutMinutes
      });

      try {
        execSync('git push --force-with-lease', { cwd: this.workDir, stdio: 'inherit' });
        this.log('✓ Pushed build fix to GitHub', 'success');
      } catch (error) {
        this.log(`⚠ Failed to push build fix: ${error instanceof Error ? error.message : String(error)}`, 'warn');
        throw new Error('Failed to push build fix to GitHub');
      }
    }

    throw new Error('Build verification exhausted all retry attempts');
  }

  private reviewHasIssues(reviewOutput: string): boolean {
    const structuredMarkerPass = /\[STEPCAT_REVIEW_RESULT:\s*PASS\s*\]/i;
    const structuredMarkerFail = /\[STEPCAT_REVIEW_RESULT:\s*FAIL\s*\]/i;

    if (structuredMarkerPass.test(reviewOutput)) {
      return false;
    }
    if (structuredMarkerFail.test(reviewOutput)) {
      return true;
    }

    const normalized = reviewOutput
      .toLowerCase()
      .replace(/[.,;:!?]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    const noIssuesPatterns = [
      /^no issues found$/,
      /^no issues$/,
      /^no issues? (?:were? )?(?:found|detected|identified)$/,
      /^(?:i found )?no issues?$/,
      /^there (?:are|were) no issues?$/
    ];

    const hasNoIssues = noIssuesPatterns.some(pattern => pattern.test(normalized));

    return !hasNoIssues;
  }

  private async performCodeReview(): Promise<void> {
    this.eventEmitter.emit('event', {
      type: 'review_start',
      timestamp: Date.now(),
      stepNumber: 0
    });

    this.log('\nRunning Codex code review...');

    const reviewPrompt = this.codexRunner.buildReviewPrompt(this.planFile);
    const reviewResult = await this.codexRunner.run({
      workDir: this.workDir,
      prompt: reviewPrompt,
      timeoutMinutes: this.agentTimeoutMinutes
    });

    this.log('\nCodex Review Output:');
    this.log('─'.repeat(80));
    this.log(reviewResult.output);
    this.log('─'.repeat(80));

    const hasIssues = this.reviewHasIssues(reviewResult.output);

    this.eventEmitter.emit('event', {
      type: 'review_complete',
      timestamp: Date.now(),
      stepNumber: 0,
      hasIssues
    });

    if (!hasIssues) {
      this.log('✓ Code review passed with no issues found', 'success');
      return;
    }

    this.log('\nCodex identified issues. Running Claude Code to address them...');

    const fixPrompt = this.claudeRunner.buildReviewFixPrompt(reviewResult.output);
    await this.claudeRunner.run({
      workDir: this.workDir,
      prompt: fixPrompt,
      timeoutMinutes: this.agentTimeoutMinutes
    });

    this.log('✓ Review feedback addressed', 'success');
    this.log('\nVerifying build after review fixes...');

    await this.ensureBuildPasses();

    this.log('✓ Build passed after review fixes', 'success');
  }

  private amendPlanFileAndPush(): void {
    try {
      execSync(`git add "${this.planFile}"`, { cwd: this.workDir, stdio: 'inherit' });
      execSync('git commit --amend --no-edit', { cwd: this.workDir, stdio: 'inherit' });
      execSync('git push --force-with-lease', { cwd: this.workDir, stdio: 'inherit' });
      this.log('✓ Amended commit with plan file and pushed to GitHub', 'success');
    } catch (error) {
      this.log(`⚠ Failed to amend and push: ${error instanceof Error ? error.message : String(error)}`, 'warn');
      throw new Error('Failed to amend commit with plan file and push to GitHub');
    }
  }
}
