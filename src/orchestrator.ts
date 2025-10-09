import { StepParser, Step } from './step-parser';
import { ClaudeRunner } from './claude-runner';
import { CodexRunner } from './codex-runner';
import { GitHubChecker } from './github-checker';
import { execSync } from 'child_process';

export interface OrchestratorConfig {
  planFile: string;
  workDir: string;
  githubToken?: string;
  maxBuildAttempts?: number;
  buildTimeoutMinutes?: number;
  agentTimeoutMinutes?: number;
}

export class Orchestrator {
  private parser: StepParser;
  private claudeRunner: ClaudeRunner;
  private codexRunner: CodexRunner;
  private githubChecker: GitHubChecker;
  private workDir: string;
  private planFile: string;
  private planContent: string;
  private maxBuildAttempts: number;
  private buildTimeoutMinutes: number;
  private agentTimeoutMinutes: number;

  constructor(config: OrchestratorConfig) {
    this.parser = new StepParser(config.planFile);
    this.planFile = config.planFile;
    this.planContent = this.parser.getContent();
    this.claudeRunner = new ClaudeRunner();
    this.codexRunner = new CodexRunner();
    this.workDir = config.workDir;
    this.maxBuildAttempts = config.maxBuildAttempts || 3;
    this.buildTimeoutMinutes = config.buildTimeoutMinutes || 30;
    this.agentTimeoutMinutes = config.agentTimeoutMinutes || 30;

    const repoInfo = GitHubChecker.parseRepoInfo(config.workDir);

    this.githubChecker = new GitHubChecker({
      owner: repoInfo.owner,
      repo: repoInfo.repo,
      token: config.githubToken,
      workDir: config.workDir
    });
  }

  async run(): Promise<void> {
    const allSteps = this.parser.parseSteps();
    const pendingSteps = allSteps.filter(s => s.phase !== 'done');

    console.log('═'.repeat(80));
    console.log(`Found ${allSteps.length} steps (${allSteps.length - pendingSteps.length} done, ${pendingSteps.length} pending)`);
    console.log('═'.repeat(80));
    allSteps.forEach(s => {
      const statusSymbol = s.phase === 'done' ? '✓' : s.phase === 'review' ? '◐' : s.phase === 'implementation' ? '◔' : ' ';
      const phaseLabel = s.phase !== 'pending' ? ` [${s.phase}]` : '';
      console.log(`  [${statusSymbol}] ${s.number}. ${s.title}${phaseLabel}`);
    });
    console.log('═'.repeat(80));

    if (pendingSteps.length === 0) {
      console.log('\n✓ All steps are already marked as done!');
      return;
    }

    console.log(`\nStarting from step ${pendingSteps[0].number}...`);

    for (let i = 0; i < pendingSteps.length; i++) {
      const step = pendingSteps[i];
      console.log(`\n${'═'.repeat(80)}`);
      console.log(`STEP ${step.number}/${allSteps.length}: ${step.title}`);
      console.log(`Progress: ${i + 1}/${pendingSteps.length} pending steps | Current phase: ${step.phase}`);
      console.log('═'.repeat(80));

      await this.executeStep(step);

      this.githubChecker.ensureNoUncommittedChanges();

      console.log('═'.repeat(80));
      console.log(`✓ STEP ${step.number}/${allSteps.length} COMPLETED`);
      console.log('═'.repeat(80));
    }

    console.log('\n' + '═'.repeat(80));
    console.log('✓✓✓ ALL STEPS COMPLETED SUCCESSFULLY ✓✓✓');
    console.log('═'.repeat(80));
  }

  private async executeStep(step: Step): Promise<void> {
    if (step.phase === 'pending') {
      console.log('\n[1/3] Implementation Phase');
      console.log('─'.repeat(80));

      const prompt = this.claudeRunner.buildImplementationPrompt(step.number, this.planContent);
      await this.claudeRunner.run({
        workDir: this.workDir,
        prompt,
        timeoutMinutes: this.agentTimeoutMinutes
      });

      this.parser.updateStepPhase(step.number, 'implementation');
      await this.amendCommitWithPlanFile();
      step.phase = 'implementation';
    } else {
      console.log('\n[1/3] Implementation Phase (skipped - already completed)');
    }

    if (step.phase === 'implementation') {
      console.log('\n[2/3] Build Verification Phase');
      console.log('─'.repeat(80));

      await this.ensureBuildPasses();

      this.parser.updateStepPhase(step.number, 'review');
      await this.amendCommitWithPlanFile();
      step.phase = 'review';
    } else {
      console.log('\n[2/3] Build Verification Phase (skipped - already completed)');
    }

    if (step.phase === 'review') {
      console.log('\n[3/3] Code Review Phase');
      console.log('─'.repeat(80));

      await this.performCodeReview();

      this.parser.updateStepPhase(step.number, 'done');
      await this.amendCommitWithPlanFile();
      step.phase = 'done';
    } else {
      console.log('\n[3/3] Code Review Phase (skipped - already completed)');
    }
  }

  private async ensureBuildPasses(): Promise<void> {
    let attempt = 0;

    while (attempt < this.maxBuildAttempts) {
      attempt++;
      console.log(`\nChecking GitHub Actions (attempt ${attempt}/${this.maxBuildAttempts})`);

      const sha = this.githubChecker.getLatestCommitSha();
      console.log(`Commit SHA: ${sha}`);

      const buildPassed = await this.githubChecker.waitForChecksToPass(sha, this.buildTimeoutMinutes);

      if (buildPassed) {
        console.log('─'.repeat(80));
        console.log('✓ All GitHub Actions checks passed');
        console.log('─'.repeat(80));
        return;
      }

      if (attempt >= this.maxBuildAttempts) {
        throw new Error(`Build failed after ${this.maxBuildAttempts} attempts. Aborting.`);
      }

      console.log('─'.repeat(80));
      console.log(`⚠ Build failed. Attempting to fix (${attempt}/${this.maxBuildAttempts})...`);
      console.log('─'.repeat(80));

      const fixPrompt = this.claudeRunner.buildFixPrompt(
        'Build checks failed. Please review the GitHub Actions logs and fix the issues.'
      );

      await this.claudeRunner.run({
        workDir: this.workDir,
        prompt: fixPrompt,
        timeoutMinutes: this.agentTimeoutMinutes
      });
    }

    throw new Error('Build verification exhausted all retry attempts');
  }

  private async performCodeReview(): Promise<void> {
    console.log('\nRunning Codex code review...');

    const reviewPrompt = this.codexRunner.buildReviewPrompt(this.planFile);
    const reviewResult = await this.codexRunner.run({
      workDir: this.workDir,
      prompt: reviewPrompt,
      timeoutMinutes: this.agentTimeoutMinutes
    });

    console.log('\nCodex Review Output:');
    console.log('─'.repeat(80));
    console.log(reviewResult.output);
    console.log('─'.repeat(80));

    if (reviewResult.output.toLowerCase().includes('no issues found')) {
      console.log('✓ Code review passed with no issues found');
      return;
    }

    console.log('\nCodex identified issues. Running Claude Code to address them...');

    const fixPrompt = this.claudeRunner.buildReviewFixPrompt(reviewResult.output);
    await this.claudeRunner.run({
      workDir: this.workDir,
      prompt: fixPrompt,
      timeoutMinutes: this.agentTimeoutMinutes
    });

    console.log('✓ Review feedback addressed');
    console.log('\nVerifying build after review fixes...');

    await this.ensureBuildPasses();

    console.log('✓ Build passed after review fixes');
  }

  private async amendCommitWithPlanFile(): Promise<void> {
    try {
      execSync(`git add "${this.planFile}"`, { cwd: this.workDir, stdio: 'inherit' });
      execSync('git commit --amend --no-edit', { cwd: this.workDir, stdio: 'inherit' });
      execSync('git push --force-with-lease', { cwd: this.workDir, stdio: 'inherit' });
      console.log('✓ Amended commit with plan file updates and pushed to GitHub');
    } catch (error) {
      console.warn('⚠ Failed to amend commit with plan file updates:', error instanceof Error ? error.message : String(error));
    }
  }
}
