import { StepParser } from "./step-parser.js";
import { ClaudeRunner } from "./claude-runner.js";
import { CodexRunner } from "./codex-runner.js";
import { GitHubChecker, MergeConflictError } from "./github-checker.js";
import { execSync } from "child_process";
import { OrchestratorEventEmitter, OrchestratorEvent } from "./events.js";
import { Database } from "./database.js";
import { Storage } from "./storage.js";
import { Plan, DbStep, Iteration } from "./models.js";
import { PROMPTS } from "./prompts.js";
import { UIAdapter } from "./ui/ui-adapter.js";
import { ReviewParser } from "./review-parser.js";

export interface OrchestratorConfig {
  planFile: string;
  workDir: string;
  githubToken?: string;
  buildTimeoutMinutes?: number;
  agentTimeoutMinutes?: number;
  eventEmitter?: OrchestratorEventEmitter;
  uiAdapters?: UIAdapter[];
  silent?: boolean;
  executionId?: number;
  maxIterationsPerStep?: number;
  databasePath?: string;
  storage?: Storage;
  implementationAgent?: 'claude' | 'codex';
  reviewAgent?: 'claude' | 'codex';
}

export class Orchestrator {
  private parser: StepParser;
  private claudeRunner: ClaudeRunner;
  private codexRunner: CodexRunner;
  private githubChecker: GitHubChecker;
  private storage: Storage;
  private storageOwned: boolean;
  private workDir: string;
  private planFile: string;
  private buildTimeoutMinutes: number;
  private agentTimeoutMinutes: number;
  private eventEmitter: OrchestratorEventEmitter;
  private uiAdapters: UIAdapter[];
  private silent: boolean;
  private executionId?: number;
  private maxIterationsPerStep: number;
  private plan?: Plan;
  private planContent: string;
  private implementationAgent: 'claude' | 'codex';
  private reviewAgent: 'claude' | 'codex';

  constructor(config: OrchestratorConfig) {
    this.parser = new StepParser(config.planFile);
    this.planFile = config.planFile;
    this.planContent = this.parser.getContent();
    this.claudeRunner = new ClaudeRunner();
    this.codexRunner = new CodexRunner();
    this.workDir = config.workDir;
    this.buildTimeoutMinutes = config.buildTimeoutMinutes ?? 30;
    this.agentTimeoutMinutes = config.agentTimeoutMinutes ?? 30;
    this.eventEmitter = config.eventEmitter ?? new OrchestratorEventEmitter();
    this.uiAdapters = config.uiAdapters ?? [];
    this.silent = config.silent ?? false;
    this.executionId = config.executionId;
    this.maxIterationsPerStep = config.maxIterationsPerStep ?? 3;
    this.implementationAgent = config.implementationAgent ?? 'claude';
    this.reviewAgent = config.reviewAgent ?? 'codex';

    this.storage = config.storage ?? new Database(config.workDir, config.databasePath);
    this.storageOwned = !config.storage;

    const repoInfo = GitHubChecker.parseRepoInfo(config.workDir);

    this.githubChecker = new GitHubChecker({
      owner: repoInfo.owner,
      repo: repoInfo.repo,
      token: config.githubToken,
      workDir: config.workDir,
      eventEmitter: this.eventEmitter,
    });
  }

  getEventEmitter(): OrchestratorEventEmitter {
    return this.eventEmitter;
  }

  private emitEvent(event: OrchestratorEvent): void {
    this.eventEmitter.emit("event", event);
    for (const adapter of this.uiAdapters) {
      adapter.onEvent(event);
    }
  }

  private log(
    message: string,
    level: "info" | "warn" | "error" | "success" = "info",
    stepNumber?: number,
  ) {
    if (!this.silent) {
      console.log(message);
    }
    this.emitEvent({
      type: "log",
      timestamp: Date.now(),
      level,
      message,
      stepNumber,
    });
  }

  private getAgentDisplayName(agent: 'claude' | 'codex'): string {
    return agent === 'claude' ? 'Claude Code' : 'Codex';
  }

  private handleMaxIterationsExceeded(step: DbStep): never {
    this.storage.updateStepStatus(step.id, 'failed');
    this.emitEvent({
      type: "error",
      timestamp: Date.now(),
      error: `Step ${step.stepNumber} exceeded maximum iterations`,
      stepNumber: step.stepNumber,
    });
    throw new Error(`Step ${step.stepNumber} exceeded maximum iterations (${this.maxIterationsPerStep})`);
  }

  private async runImplementationAgent(
    prompt: string,
  ): Promise<{ success: boolean; commitSha: string | null; output?: string }> {
    if (this.implementationAgent === 'claude') {
      return this.claudeRunner.run({
        workDir: this.workDir,
        prompt,
        timeoutMinutes: this.agentTimeoutMinutes,
        eventEmitter: this.eventEmitter,
      });
    }

    const result = await this.codexRunner.run({
      workDir: this.workDir,
      prompt,
      timeoutMinutes: this.agentTimeoutMinutes,
      expectCommit: true,
      eventEmitter: this.eventEmitter,
    });

    return {
      success: result.success,
      commitSha: result.commitSha ?? null,
      output: result.output,
    };
  }

  private async runReviewAgent(
    prompt: string,
  ): Promise<{ success: boolean; output: string }> {
    if (this.reviewAgent === 'codex') {
      const result = await this.codexRunner.run({
        workDir: this.workDir,
        prompt,
        timeoutMinutes: this.agentTimeoutMinutes,
        eventEmitter: this.eventEmitter,
      });

      return {
        success: result.success,
        output: result.output,
      };
    }

    const result = await this.claudeRunner.run({
      workDir: this.workDir,
      prompt,
      timeoutMinutes: this.agentTimeoutMinutes,
      captureOutput: true,
      eventEmitter: this.eventEmitter,
    });

    const output = result.output;

    if (!output) {
      throw new Error('Claude Code did not produce any review output');
    }

    return {
      success: result.success,
      output,
    };
  }

  private cleanupIncompleteIterations(): void {
    if (!this.plan) {
      return;
    }

    const steps = this.storage.getSteps(this.plan.id);
    let cleanedCount = 0;

    for (const step of steps) {
      const iterations = this.storage.getIterations(step.id);
      for (const iteration of iterations) {
        if (iteration.status === 'in_progress') {
          this.log(
            `Found incomplete iteration ${iteration.iterationNumber} for step ${step.stepNumber}, marking as aborted`,
            "warn"
          );
          this.storage.updateIteration(iteration.id, { status: 'aborted' });
          cleanedCount++;
        }
      }
    }

    if (cleanedCount > 0) {
      this.log(`Cleaned up ${cleanedCount} aborted iteration(s)`, "info");
    }
  }

  private countIterationsWithCommits(stepId: number): number {
    const iterations = this.storage.getIterations(stepId);
    return iterations.filter(iteration => iteration.commitSha !== null && iteration.status !== 'aborted').length;
  }

  private async initializeOrResumePlan(): Promise<void> {
    if (this.executionId) {
      this.log(`Resuming execution ID: ${this.executionId}`, "info");
      const plan = this.storage.getPlan(this.executionId);
      if (!plan) {
        throw new Error(`Execution ID ${this.executionId} not found in database`);
      }
      this.plan = plan;
      this.log(`Loaded plan from database: ${plan.planFilePath}`, "info");

      this.cleanupIncompleteIterations();
    } else {
      this.log("Starting new execution", "info");
      this.plan = this.storage.createPlan(
        this.planFile,
        this.workDir,
        this.githubChecker.getOwner(),
        this.githubChecker.getRepo()
      );
      this.log(`Created new execution with ID: ${this.plan.id}`, "success");

      const parsedSteps = this.parser.parseSteps();
      for (const step of parsedSteps) {
        this.storage.createStep(this.plan.id, step.number, step.title);
      }
      this.log(`Initialized ${parsedSteps.length} steps in database`, "info");
    }
  }

  private getCurrentStep(): DbStep | null {
    if (!this.plan) {
      throw new Error("Plan not initialized");
    }

    const steps = this.storage.getSteps(this.plan.id);
    const currentStep = steps.find(
      (s) => s.status === 'pending' || s.status === 'in_progress'
    );

    return currentStep || null;
  }

  private async pushCommit(): Promise<void> {
    try {
      execSync("git push", {
        cwd: this.workDir,
        stdio: "inherit",
      });
      this.log("✓ Pushed commit to GitHub", "success");
    } catch (error) {
      this.log(
        `⚠ Failed to push commit: ${error instanceof Error ? error.message : String(error)}`,
        "warn",
      );
      throw new Error("Failed to push commit to GitHub");
    }
  }

  private async extractBuildErrors(sha: string): Promise<string> {
    try {
      const { data: checkRuns } = await this.githubChecker.getOctokit().checks.listForRef({
        owner: this.githubChecker.getOwner(),
        repo: this.githubChecker.getRepo(),
        ref: sha,
      });

      const failedChecks = checkRuns.check_runs.filter(
        run => run.status === 'completed' && run.conclusion !== 'success' && run.conclusion !== 'skipped'
      );

      if (failedChecks.length === 0) {
        return "Build checks failed. Please review the GitHub Actions logs and fix the issues.";
      }

      const errorMessages: string[] = [];
      for (const check of failedChecks) {
        let message = `Check: ${check.name}\n`;
        message += `Conclusion: ${check.conclusion}\n`;
        if (check.output?.title) {
          message += `Title: ${check.output.title}\n`;
        }
        if (check.output?.summary) {
          message += `Summary: ${check.output.summary}\n`;
        }
        if (check.details_url) {
          message += `Details: ${check.details_url}\n`;
        }
        errorMessages.push(message);
      }

      return errorMessages.join('\n---\n');
    } catch (error) {
      this.log(
        `Warning: Could not extract detailed build errors: ${error instanceof Error ? error.message : String(error)}`,
        "warn"
      );
      return "Build checks failed. Please review the GitHub Actions logs and fix the issues.";
    }
  }

  private determineCodexPromptType(iteration: Iteration): 'implementation' | 'build_fix' | 'review_fix' {
    return iteration.type;
  }

  async run(): Promise<number> {
    const startTime = Date.now();
    await this.initializeOrResumePlan();

    if (!this.plan) {
      throw new Error("Plan not initialized");
    }

    this.emitEvent({
      type: "execution_started",
      timestamp: Date.now(),
      executionId: this.plan.id,
      isResume: !!this.executionId,
    });

    const allSteps = this.storage.getSteps(this.plan.id);
    const allIterations = allSteps.flatMap((s) => this.storage.getIterations(s.id));
    const allIssues = allIterations.flatMap((i) => this.storage.getIssues(i.id));

    this.emitEvent({
      type: "state_sync",
      timestamp: Date.now(),
      plan: this.plan,
      steps: allSteps,
      iterations: allIterations,
      issues: allIssues,
    });

    const pendingSteps = allSteps.filter((s) => s.status === 'pending' || s.status === 'in_progress');

    this.log("═".repeat(80));
    this.log(
      `Found ${allSteps.length} steps (${allSteps.length - pendingSteps.length} done, ${pendingSteps.length} pending)`,
    );
    this.log("═".repeat(80));

    if (pendingSteps.length === 0) {
      this.log("\n✓ All steps are already marked as done!", "success");
      return this.plan.id;
    }

    let step = this.getCurrentStep();
    while (step) {
      const freshSteps = this.storage.getSteps(this.plan.id);
      const completedCount = freshSteps.filter(s => s.status === 'completed').length;

      this.emitEvent({
        type: "step_start",
        timestamp: Date.now(),
        stepNumber: step.stepNumber,
        stepTitle: step.title,
        phase: step.status,
        progress: {
          current: completedCount + 1,
          total: freshSteps.length,
        },
      });

      this.log(`\n${"═".repeat(80)}`);
      this.log(`STEP ${step.stepNumber}: ${step.title}`);
      this.log("═".repeat(80));

      this.storage.updateStepStatus(step.id, 'in_progress');

      const allIterations = this.storage.getIterations(step.id);
      const highestIterationNumber = allIterations.reduce(
        (max, iteration) => Math.max(max, iteration.iterationNumber),
        0
      );
      const completedIterations = allIterations.filter(i => i.status === 'completed');
      const activeIterations = allIterations.filter(i => i.status !== 'aborted');
      const iterationsWithWork = activeIterations.filter(i => i.commitSha !== null);
      let iterationNumber: number;

      if (completedIterations.length === 0) {
        if (iterationsWithWork.length >= this.maxIterationsPerStep) {
          this.handleMaxIterationsExceeded(step);
        }

        const nextIterationNumber = highestIterationNumber + 1;
        const iteration = this.storage.createIteration(
          step.id,
          nextIterationNumber,
          'implementation',
          this.implementationAgent,
          this.reviewAgent
        );

        this.emitEvent({
          type: "iteration_start",
          timestamp: Date.now(),
          iterationId: iteration.id,
          stepId: step.id,
          iterationNumber: nextIterationNumber,
          iterationType: 'implementation',
          implementationAgent: this.implementationAgent,
          reviewAgent: this.reviewAgent,
        });

        this.log(`\nIteration ${nextIterationNumber}: Implementation`);
        this.log("─".repeat(80));

        const prompt = PROMPTS.implementation(step.stepNumber, this.planFile);
        const result = await this.runImplementationAgent(prompt);

        if (!result || !result.commitSha) {
          this.storage.updateIteration(iteration.id, { status: 'failed' });
          this.emitEvent({
            type: "error",
            timestamp: Date.now(),
            error: `${this.getAgentDisplayName(this.implementationAgent)} completed but did not create a commit`,
            stepNumber: step.stepNumber,
          });
          throw new Error(`${this.getAgentDisplayName(this.implementationAgent)} completed but did not create a commit for implementation`);
        }

        this.storage.updateIteration(iteration.id, {
          commitSha: result.commitSha,
          status: 'completed',
        });

        await this.pushCommit();

        this.emitEvent({
          type: "iteration_complete",
          timestamp: Date.now(),
          stepId: step.id,
          iterationNumber: iteration.iterationNumber,
          commitSha: result.commitSha,
          status: 'completed',
        });

        iterationNumber = iteration.iterationNumber + 1;
      } else {
        iterationNumber = highestIterationNumber + 1;
      }

      while (this.countIterationsWithCommits(step.id) <= this.maxIterationsPerStep) {
        const attemptsWithCommits = this.countIterationsWithCommits(step.id);
        const sha = this.githubChecker.getLatestCommitSha();
        const previousIterationId = this.storage.getIterations(step.id)[iterationNumber - 2]?.id;

        if (previousIterationId) {
          this.storage.updateIteration(previousIterationId, { buildStatus: 'pending' });
        }

        this.emitEvent({
          type: "github_check",
          timestamp: Date.now(),
          status: "waiting",
          sha,
          attempt: attemptsWithCommits,
          maxAttempts: this.maxIterationsPerStep,
          iterationId: previousIterationId,
        });

        this.log(`\nChecking GitHub Actions for commit ${sha}`);

        let checksPass: boolean;
        let trackedSha: string;
        try {
          checksPass = await this.githubChecker.waitForChecksToPass(
            sha,
            this.buildTimeoutMinutes,
            attemptsWithCommits,
            this.maxIterationsPerStep,
          );
          trackedSha = this.githubChecker.getLastTrackedSha() ?? sha;
        } catch (error) {
          trackedSha = this.githubChecker.getLastTrackedSha() ?? sha;
          if (error instanceof MergeConflictError) {
            const iterationsForStep = this.storage.getIterations(step.id);
            const latestIteration = iterationsForStep[iterationsForStep.length - 1];

            if (latestIteration) {
              this.storage.updateIteration(latestIteration.id, { buildStatus: 'merge_conflict' });

              const descriptionLines = [
                error.details.prNumber
                  ? `PR #${error.details.prNumber} is marked as having merge conflicts.`
                  : 'The current branch has merge conflicts with its base branch.',
                error.details.base
                  ? `Conflicts must be resolved against "${error.details.base}".`
                  : undefined,
                `Branch "${error.details.branch}" needs to be rebased or merged with the latest base before CI can run.`,
                'Resolve the conflicts and rerun this step.',
              ].filter((line): line is string => Boolean(line));

              const conflictIssue = this.storage.createIssue(
                latestIteration.id,
                'merge_conflict',
                descriptionLines.join('\n'),
                null,
                null,
                'error',
              );

              this.emitEvent({
                type: 'issue_found',
                timestamp: Date.now(),
                issueId: conflictIssue.id,
                iterationId: latestIteration.id,
                issueType: 'merge_conflict',
                description: conflictIssue.description,
              });
            }

            this.emitEvent({
              type: 'github_check',
              timestamp: Date.now(),
              status: 'blocked',
              sha: trackedSha,
              attempt: attemptsWithCommits,
              maxAttempts: this.maxIterationsPerStep,
              iterationId: latestIteration?.id ?? previousIterationId,
              checkName: 'Merge conflict detected',
            });

            this.storage.updateStepStatus(step.id, 'failed');

            this.emitEvent({
              type: 'error',
              timestamp: Date.now(),
              error: error.message,
              stepNumber: step.stepNumber,
            });

            throw error;
          }

          throw error;
        }

        if (!checksPass) {
          if (previousIterationId) {
            this.storage.updateIteration(previousIterationId, { buildStatus: 'failed' });
          }
          const buildErrors = await this.extractBuildErrors(trackedSha);
          const issue = this.storage.createIssue(previousIterationId!, 'ci_failure', buildErrors);

          this.emitEvent({
            type: "issue_found",
            timestamp: Date.now(),
            issueId: issue.id,
            iterationId: previousIterationId!,
            issueType: 'ci_failure',
            description: buildErrors,
          });

          if (attemptsWithCommits >= this.maxIterationsPerStep) {
            this.handleMaxIterationsExceeded(step);
          }

          const iteration = this.storage.createIteration(
            step.id,
            iterationNumber,
            'build_fix',
            this.implementationAgent,
            this.reviewAgent
          );

          this.emitEvent({
            type: "iteration_start",
            timestamp: Date.now(),
            iterationId: iteration.id,
            stepId: step.id,
            iterationNumber,
            iterationType: 'build_fix',
            implementationAgent: this.implementationAgent,
            reviewAgent: this.reviewAgent,
          });

          this.log(`\nIteration ${iterationNumber}: Build Fix`);
          this.log("─".repeat(80));

          const prompt = PROMPTS.buildFix(buildErrors);
          const result = await this.runImplementationAgent(prompt);

          if (!result || !result.commitSha) {
            this.storage.updateIteration(iteration.id, { status: 'failed' });
            this.emitEvent({
              type: "error",
              timestamp: Date.now(),
              error: `${this.getAgentDisplayName(this.implementationAgent)} completed but did not create a commit`,
              stepNumber: step.stepNumber,
            });
            throw new Error(`${this.getAgentDisplayName(this.implementationAgent)} completed but did not create a commit for build fix`);
          }

          this.storage.updateIteration(iteration.id, {
            commitSha: result.commitSha,
            status: 'completed',
          });

          await this.pushCommit();

          this.emitEvent({
            type: "iteration_complete",
            timestamp: Date.now(),
            stepId: step.id,
            iterationNumber,
            commitSha: result.commitSha,
            status: 'completed',
          });

          iterationNumber++;
          continue;
        }

        if (previousIterationId) {
          this.storage.updateIteration(previousIterationId, { buildStatus: 'passed' });
        }

        this.emitEvent({
          type: "github_check",
          timestamp: Date.now(),
          status: "success",
          sha: trackedSha,
          attempt: attemptsWithCommits,
          maxAttempts: this.maxIterationsPerStep,
          iterationId: previousIterationId,
        });

        this.log("✓ All GitHub Actions checks passed", "success");

        const previousIteration = this.storage.getIterations(step.id)[iterationNumber - 2];
        const promptType = this.determineCodexPromptType(previousIteration);

        let codexPrompt: string;
        if (promptType === 'implementation') {
          codexPrompt = PROMPTS.codexReviewImplementation(step.stepNumber, step.title, this.planContent);
        } else if (promptType === 'build_fix') {
          const buildErrors = this.storage.getIssues(previousIteration.id)
            .filter(i => i.type === 'ci_failure')
            .map(i => i.description)
            .join('\n');
          codexPrompt = PROMPTS.codexReviewBuildFix(buildErrors);
        } else {
          const openIssues = this.storage.getOpenIssues(step.id)
            .filter(i => i.type === 'codex_review')
            .map(i => ({
              file: i.filePath || 'unknown',
              line: i.lineNumber !== null ? i.lineNumber : undefined,
              severity: i.severity || 'error',
              description: i.description,
            }));
          codexPrompt = PROMPTS.codexReviewCodeFixes(openIssues);
        }

        this.storage.updateIteration(previousIteration.id, { reviewStatus: 'in_progress' });

        this.emitEvent({
          type: "codex_review_start",
          timestamp: Date.now(),
          iterationId: previousIteration.id,
          promptType,
          agent: this.reviewAgent,
        });

        this.log(`\nRunning ${this.getAgentDisplayName(this.reviewAgent)} code review (${promptType})...`);

        const reviewRun = await this.runReviewAgent(codexPrompt);

        const reviewParser = new ReviewParser();
        const reviewResult = reviewParser.parseReviewOutput(reviewRun.output);

        this.storage.updateIteration(previousIteration.id, {
          codexLog: reviewRun.output,
          reviewStatus: reviewResult.result === 'PASS' ? 'passed' : 'failed',
        });

        this.emitEvent({
          type: "codex_review_complete",
          timestamp: Date.now(),
          iterationId: previousIteration.id,
          result: reviewResult.result,
          issueCount: reviewResult.issues.length,
          agent: this.reviewAgent,
        });

        if (reviewResult.result === 'FAIL' && reviewResult.issues.length > 0) {
          for (const issue of reviewResult.issues) {
            const dbIssue = this.storage.createIssue(
              previousIteration.id,
              'codex_review',
              issue.description,
              issue.file,
              issue.line,
              issue.severity,
              'open'
            );

            this.emitEvent({
              type: "issue_found",
              timestamp: Date.now(),
              issueId: dbIssue.id,
              iterationId: previousIteration.id,
              issueType: 'codex_review',
              description: issue.description,
              filePath: issue.file,
              lineNumber: issue.line,
              severity: issue.severity,
            });
          }

          if (attemptsWithCommits >= this.maxIterationsPerStep) {
            this.handleMaxIterationsExceeded(step);
          }

          const iteration = this.storage.createIteration(
            step.id,
            iterationNumber,
            'review_fix',
            this.implementationAgent,
            this.reviewAgent
          );

          this.emitEvent({
            type: "iteration_start",
            timestamp: Date.now(),
            iterationId: iteration.id,
            stepId: step.id,
            iterationNumber,
            iterationType: 'review_fix',
            implementationAgent: this.implementationAgent,
            reviewAgent: this.reviewAgent,
          });

          this.log(`\nIteration ${iterationNumber}: Review Fix`);
          this.log("─".repeat(80));

          const prompt = PROMPTS.reviewFix(JSON.stringify(reviewResult.issues, null, 2));
          const result = await this.runImplementationAgent(prompt);

          if (!result || !result.commitSha) {
            this.storage.updateIteration(iteration.id, { status: 'failed' });
            this.emitEvent({
              type: "error",
              timestamp: Date.now(),
              error: `${this.getAgentDisplayName(this.implementationAgent)} completed but did not create a commit`,
              stepNumber: step.stepNumber,
            });
            throw new Error(`${this.getAgentDisplayName(this.implementationAgent)} completed but did not create a commit for review fix`);
          }

          this.storage.updateIteration(iteration.id, {
            commitSha: result.commitSha,
            status: 'completed',
          });

          await this.pushCommit();

          this.emitEvent({
            type: "iteration_complete",
            timestamp: Date.now(),
            stepId: step.id,
            iterationNumber,
            commitSha: result.commitSha,
            status: 'completed',
          });

          const openIssues = this.storage.getOpenIssues(step.id);
          for (const issue of openIssues) {
            this.storage.updateIssueStatus(issue.id, 'fixed', new Date().toISOString());
            this.emitEvent({
              type: "issue_resolved",
              timestamp: Date.now(),
              issueId: issue.id,
            });
          }

          iterationNumber++;
          continue;
        } else {
          this.log("✓ Code review passed with no issues", "success");
          this.storage.updateStepStatus(step.id, 'completed');

          this.emitEvent({
            type: "step_complete",
            timestamp: Date.now(),
            stepNumber: step.stepNumber,
            stepTitle: step.title,
          });

          break;
        }
      }

      if (this.countIterationsWithCommits(step.id) > this.maxIterationsPerStep) {
        this.handleMaxIterationsExceeded(step);
      }

      step = this.getCurrentStep();
    }

    const totalTime = Date.now() - startTime;

    this.emitEvent({
      type: "all_complete",
      timestamp: Date.now(),
      totalTime,
    });

    this.log("\n" + "═".repeat(80));
    this.log("✓✓✓ ALL STEPS COMPLETED SUCCESSFULLY ✓✓✓", "success");
    this.log("═".repeat(80));

    if (this.storageOwned) {
      this.storage.close();
    }

    return this.plan.id;
  }
}
