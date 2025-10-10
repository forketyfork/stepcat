import { StepParser } from "./step-parser";
import { ClaudeRunner } from "./claude-runner";
import { CodexRunner } from "./codex-runner";
import { GitHubChecker } from "./github-checker";
import { execSync } from "child_process";
import { OrchestratorEventEmitter } from "./events";
import { Database } from "./database";
import { Plan, DbStep, Iteration } from "./models";
import { PROMPTS } from "./prompts";

export interface OrchestratorConfig {
  planFile: string;
  workDir: string;
  githubToken?: string;
  buildTimeoutMinutes?: number;
  agentTimeoutMinutes?: number;
  eventEmitter?: OrchestratorEventEmitter;
  silent?: boolean;
  executionId?: number;
  maxIterationsPerStep?: number;
  databasePath?: string;
}

export class Orchestrator {
  private parser: StepParser;
  private claudeRunner: ClaudeRunner;
  private codexRunner: CodexRunner;
  private githubChecker: GitHubChecker;
  private database: Database;
  private workDir: string;
  private planFile: string;
  private buildTimeoutMinutes: number;
  private agentTimeoutMinutes: number;
  private eventEmitter: OrchestratorEventEmitter;
  private silent: boolean;
  private executionId?: number;
  private maxIterationsPerStep: number;
  private plan?: Plan;
  private planContent: string;

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
    this.silent = config.silent ?? false;
    this.executionId = config.executionId;
    this.maxIterationsPerStep = config.maxIterationsPerStep ?? 10;

    this.database = new Database(config.workDir, config.databasePath);

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

  private log(
    message: string,
    level: "info" | "warn" | "error" | "success" = "info",
    stepNumber?: number,
  ) {
    if (!this.silent) {
      console.log(message);
    }
    this.eventEmitter.emit("event", {
      type: "log",
      timestamp: Date.now(),
      level,
      message,
      stepNumber,
    });
  }

  private async initializeOrResumePlan(): Promise<void> {
    if (this.executionId) {
      this.log(`Resuming execution ID: ${this.executionId}`, "info");
      const plan = this.database.getPlan(this.executionId);
      if (!plan) {
        throw new Error(`Execution ID ${this.executionId} not found in database`);
      }
      this.plan = plan;
      this.log(`Loaded plan from database: ${plan.planFilePath}`, "info");
    } else {
      this.log("Starting new execution", "info");
      this.plan = this.database.createPlan(this.planFile, this.workDir);
      this.log(`Created new execution with ID: ${this.plan.id}`, "success");

      const parsedSteps = this.parser.parseSteps();
      for (const step of parsedSteps) {
        this.database.createStep(this.plan.id, step.number, step.title);
      }
      this.log(`Initialized ${parsedSteps.length} steps in database`, "info");
    }
  }

  private getCurrentStep(): DbStep | null {
    if (!this.plan) {
      throw new Error("Plan not initialized");
    }

    const steps = this.database.getSteps(this.plan.id);
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

    const allSteps = this.database.getSteps(this.plan.id);
    const allIterations = allSteps.flatMap((s) => this.database.getIterations(s.id));
    const allIssues = allIterations.flatMap((i) => this.database.getIssues(i.id));

    this.eventEmitter.emit("event", {
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
      const freshSteps = this.database.getSteps(this.plan.id);
      const completedCount = freshSteps.filter(s => s.status === 'completed').length;

      this.eventEmitter.emit("event", {
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

      this.database.updateStepStatus(step.id, 'in_progress');

      let iterationNumber = this.database.getIterations(step.id).length + 1;

      if (iterationNumber === 1) {
        const iteration = this.database.createIteration(step.id, 1, 'implementation');

        this.eventEmitter.emit("event", {
          type: "iteration_start",
          timestamp: Date.now(),
          stepId: step.id,
          iterationNumber: 1,
          iterationType: 'implementation',
        });

        this.log(`\nIteration 1: Implementation`);
        this.log("─".repeat(80));

        const prompt = PROMPTS.implementation(step.stepNumber, this.planFile);
        const result = await this.claudeRunner.run({
          workDir: this.workDir,
          prompt,
          timeoutMinutes: this.agentTimeoutMinutes,
        });

        if (!result.commitSha) {
          this.database.updateIteration(iteration.id, { status: 'failed' });
          this.eventEmitter.emit("event", {
            type: "error",
            timestamp: Date.now(),
            error: "Claude Code completed but did not create a commit",
            stepNumber: step.stepNumber,
          });
          throw new Error("Claude Code completed but did not create a commit for implementation");
        }

        this.database.updateIteration(iteration.id, {
          commitSha: result.commitSha,
          status: 'completed',
        });

        await this.pushCommit();

        this.eventEmitter.emit("event", {
          type: "iteration_complete",
          timestamp: Date.now(),
          stepId: step.id,
          iterationNumber: 1,
          commitSha: result.commitSha,
          status: 'completed',
        });

        iterationNumber++;
      }

      while (iterationNumber <= this.maxIterationsPerStep) {
        const sha = this.githubChecker.getLatestCommitSha();

        this.eventEmitter.emit("event", {
          type: "github_check",
          timestamp: Date.now(),
          status: "waiting",
          sha,
          attempt: iterationNumber - 1,
          maxAttempts: this.maxIterationsPerStep,
          iterationId: this.database.getIterations(step.id)[iterationNumber - 2]?.id,
        });

        this.log(`\nChecking GitHub Actions for commit ${sha}`);

        const checksPass = await this.githubChecker.waitForChecksToPass(
          sha,
          this.buildTimeoutMinutes,
          iterationNumber - 1,
          this.maxIterationsPerStep,
        );

        if (!checksPass) {
          const buildErrors = await this.extractBuildErrors(sha);
          const iteration = this.database.createIteration(step.id, iterationNumber, 'build_fix');

          this.database.createIssue(iteration.id, 'ci_failure', buildErrors);

          this.eventEmitter.emit("event", {
            type: "issue_found",
            timestamp: Date.now(),
            iterationId: iteration.id,
            issueType: 'ci_failure',
            description: buildErrors,
          });

          this.eventEmitter.emit("event", {
            type: "iteration_start",
            timestamp: Date.now(),
            stepId: step.id,
            iterationNumber,
            iterationType: 'build_fix',
          });

          this.log(`\nIteration ${iterationNumber}: Build Fix`);
          this.log("─".repeat(80));

          const prompt = PROMPTS.buildFix(buildErrors);
          const result = await this.claudeRunner.run({
            workDir: this.workDir,
            prompt,
            timeoutMinutes: this.agentTimeoutMinutes,
          });

          if (!result.commitSha) {
            this.database.updateIteration(iteration.id, { status: 'failed' });
            this.eventEmitter.emit("event", {
              type: "error",
              timestamp: Date.now(),
              error: "Claude Code completed but did not create a commit",
              stepNumber: step.stepNumber,
            });
            throw new Error("Claude Code completed but did not create a commit for build fix");
          }

          this.database.updateIteration(iteration.id, {
            commitSha: result.commitSha,
            status: 'completed',
          });

          await this.pushCommit();

          this.eventEmitter.emit("event", {
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

        this.eventEmitter.emit("event", {
          type: "github_check",
          timestamp: Date.now(),
          status: "success",
          sha,
          attempt: iterationNumber - 1,
          maxAttempts: this.maxIterationsPerStep,
        });

        this.log("✓ All GitHub Actions checks passed", "success");

        const previousIteration = this.database.getIterations(step.id)[iterationNumber - 2];
        const promptType = this.determineCodexPromptType(previousIteration);

        let codexPrompt: string;
        if (promptType === 'implementation') {
          codexPrompt = PROMPTS.codexReviewImplementation(step.stepNumber, step.title, this.planContent);
        } else if (promptType === 'build_fix') {
          const buildErrors = this.database.getIssues(previousIteration.id)
            .filter(i => i.type === 'ci_failure')
            .map(i => i.description)
            .join('\n');
          codexPrompt = PROMPTS.codexReviewBuildFix(buildErrors);
        } else {
          const openIssues = this.database.getOpenIssues(step.id)
            .filter(i => i.type === 'codex_review')
            .map(i => ({
              file: i.filePath || 'unknown',
              line: i.lineNumber !== null ? i.lineNumber : undefined,
              severity: i.severity || 'error',
              description: i.description,
            }));
          codexPrompt = PROMPTS.codexReviewCodeFixes(openIssues);
        }

        this.eventEmitter.emit("event", {
          type: "codex_review_start",
          timestamp: Date.now(),
          iterationId: previousIteration.id,
          promptType,
        });

        this.log(`\nRunning Codex code review (${promptType})...`);

        const codexOutput = await this.codexRunner.run({
          workDir: this.workDir,
          prompt: codexPrompt,
          timeoutMinutes: this.agentTimeoutMinutes,
        });

        const reviewResult = this.codexRunner.parseCodexOutput(codexOutput.output);

        this.database.updateIteration(previousIteration.id, { codexLog: codexOutput.output });

        this.eventEmitter.emit("event", {
          type: "codex_review_complete",
          timestamp: Date.now(),
          iterationId: previousIteration.id,
          result: reviewResult.result,
          issueCount: reviewResult.issues.length,
        });

        if (reviewResult.result === 'FAIL' && reviewResult.issues.length > 0) {
          const iteration = this.database.createIteration(step.id, iterationNumber, 'review_fix');

          for (const issue of reviewResult.issues) {
            this.database.createIssue(
              iteration.id,
              'codex_review',
              issue.description,
              issue.file,
              issue.line,
              issue.severity,
              'open'
            );

            this.eventEmitter.emit("event", {
              type: "issue_found",
              timestamp: Date.now(),
              iterationId: iteration.id,
              issueType: 'codex_review',
              description: issue.description,
              filePath: issue.file,
              lineNumber: issue.line,
              severity: issue.severity,
            });
          }

          this.eventEmitter.emit("event", {
            type: "iteration_start",
            timestamp: Date.now(),
            stepId: step.id,
            iterationNumber,
            iterationType: 'review_fix',
          });

          this.log(`\nIteration ${iterationNumber}: Review Fix`);
          this.log("─".repeat(80));

          const prompt = PROMPTS.reviewFix(JSON.stringify(reviewResult.issues, null, 2));
          const result = await this.claudeRunner.run({
            workDir: this.workDir,
            prompt,
            timeoutMinutes: this.agentTimeoutMinutes,
          });

          if (!result.commitSha) {
            this.database.updateIteration(iteration.id, { status: 'failed' });
            this.eventEmitter.emit("event", {
              type: "error",
              timestamp: Date.now(),
              error: "Claude Code completed but did not create a commit",
              stepNumber: step.stepNumber,
            });
            throw new Error("Claude Code completed but did not create a commit for review fix");
          }

          this.database.updateIteration(iteration.id, {
            commitSha: result.commitSha,
            status: 'completed',
          });

          await this.pushCommit();

          this.eventEmitter.emit("event", {
            type: "iteration_complete",
            timestamp: Date.now(),
            stepId: step.id,
            iterationNumber,
            commitSha: result.commitSha,
            status: 'completed',
          });

          const openIssues = this.database.getOpenIssues(step.id);
          for (const issue of openIssues) {
            this.database.updateIssueStatus(issue.id, 'fixed', new Date().toISOString());
            this.eventEmitter.emit("event", {
              type: "issue_resolved",
              timestamp: Date.now(),
              issueId: issue.id,
            });
          }

          iterationNumber++;
          continue;
        } else {
          this.log("✓ Code review passed with no issues", "success");
          this.database.updateStepStatus(step.id, 'completed');

          this.eventEmitter.emit("event", {
            type: "step_complete",
            timestamp: Date.now(),
            stepNumber: step.stepNumber,
            stepTitle: step.title,
          });

          break;
        }
      }

      if (iterationNumber > this.maxIterationsPerStep) {
        this.database.updateStepStatus(step.id, 'failed');
        this.eventEmitter.emit("event", {
          type: "error",
          timestamp: Date.now(),
          error: `Step ${step.stepNumber} exceeded maximum iterations`,
          stepNumber: step.stepNumber,
        });
        throw new Error(`Step ${step.stepNumber} exceeded maximum iterations (${this.maxIterationsPerStep})`);
      }

      step = this.getCurrentStep();
    }

    const totalTime = Date.now() - startTime;

    this.eventEmitter.emit("event", {
      type: "all_complete",
      timestamp: Date.now(),
      totalTime,
    });

    this.log("\n" + "═".repeat(80));
    this.log("✓✓✓ ALL STEPS COMPLETED SUCCESSFULLY ✓✓✓", "success");
    this.log("═".repeat(80));

    return this.plan.id;
  }
}
