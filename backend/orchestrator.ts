import { StepParser } from "./step-parser.js";
import { ClaudeRunner } from "./claude-runner.js";
import { CodexRunner } from "./codex-runner.js";
import { GitHubChecker, MergeConflictError } from "./github-checker.js";
import { execSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { OrchestratorEventEmitter, OrchestratorEvent } from "./events.js";
import { Database } from "./database.js";
import { Storage } from "./storage.js";
import { Plan, DbStep, Iteration, Issue } from "./models.js";
import { PERMISSION_REQUEST_INSTRUCTIONS, PROMPTS } from "./prompts.js";
import { UIAdapter } from "./ui/ui-adapter.js";
import { ReviewParser } from "./review-parser.js";
import { Logger, getLogger, LogLevel } from "./logger.js";
import { PermissionRequest, PermissionRequestParser, mergePermissionAllows } from "./permission-requests.js";
import type { StopController } from "./stop-controller.js";

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
  stopController?: StopController;
}

type AgentRunResult = {
  success: boolean;
  commitSha: string | null;
  output?: string;
  workingTreeStatus?: string | null;
};

type ImplementationAgentStrategy =
  | {
      supportsPermissionRequests: false;
      run: (prompt: string) => Promise<AgentRunResult>;
    }
  | {
      supportsPermissionRequests: true;
      run: (prompt: string) => Promise<AgentRunResult>;
      runContinue: (prompt: string) => Promise<AgentRunResult>;
    };

type ReviewAgentStrategy =
  | {
      supportsPermissionRequests: false;
      run: (prompt: string) => Promise<{ success: boolean; output: string }>;
    }
  | {
      supportsPermissionRequests: true;
      run: (prompt: string) => Promise<{ success: boolean; output: string }>;
      runContinue: (prompt: string) => Promise<{ success: boolean; output?: string }>;
    };

type PermissionHandlingResult = "applied" | "declined" | "noop";

type CheckRunOutput = {
  title?: string | null;
  summary?: string | null;
  text?: string | null;
};

type CheckRunSummary = {
  id: number;
  name: string;
  status?: string | null;
  conclusion?: string | null;
  output?: CheckRunOutput | null;
  details_url?: string | null;
};

type CheckRunAnnotation = {
  path: string;
  start_line?: number | null;
  end_line?: number | null;
  annotation_level?: string | null;
  message: string;
  title?: string | null;
  raw_details?: string | null;
};


export class Orchestrator {
  private static readonly MAX_PERMISSION_REQUEST_ATTEMPTS = 3;
  private static readonly MAX_BUILD_OUTPUT_CHARS = 8000;
  private static readonly MAX_ANNOTATIONS = 20;
  private static readonly MAX_ANNOTATION_CHARS = 500;
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
  private stopController?: StopController;

  constructor(config: OrchestratorConfig) {
    this.workDir = config.workDir;

    Logger.initialize({ workDir: config.workDir });

    this.parser = new StepParser(config.planFile);
    this.planFile = config.planFile;
    this.planContent = this.parser.getContent();
    this.claudeRunner = new ClaudeRunner();
    this.codexRunner = new CodexRunner();
    this.buildTimeoutMinutes = config.buildTimeoutMinutes ?? 30;
    this.agentTimeoutMinutes = config.agentTimeoutMinutes ?? 30;
    this.eventEmitter = config.eventEmitter ?? new OrchestratorEventEmitter();
    this.uiAdapters = config.uiAdapters ?? [];
    this.silent = config.silent ?? false;
    this.executionId = config.executionId;
    this.maxIterationsPerStep = config.maxIterationsPerStep ?? 3;
    this.implementationAgent = config.implementationAgent ?? 'claude';
    this.reviewAgent = config.reviewAgent ?? 'codex';
    this.stopController = config.stopController;

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
    const lines = message.split(/\r?\n/);
    const baseTimestamp = Date.now();
    const logLevel: LogLevel = level === "success" ? "info" : level;

    lines.forEach((line, index) => {
      const lineTimestamp = lines.length === 1 ? baseTimestamp : baseTimestamp + index;

      getLogger()?.log(logLevel, "Orchestrator", line);

      if (!this.silent) {
        process.stdout.write(`${line}\n`);
      }

      this.emitEvent({
        type: "log",
        timestamp: lineTimestamp,
        level,
        message: line,
        stepNumber,
      });
    });
  }

  private formatWorkingTreeSummary(
    workingTreeStatus?: string | null,
  ): string | null {
    if (workingTreeStatus === undefined || workingTreeStatus === null) {
      return null;
    }

    const lines = workingTreeStatus
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length === 0) {
      return null;
    }

    if (lines.length === 1) {
      return lines[0];
    }

    return `${lines[0]} (+${lines.length - 1} more)`;
  }

  private buildAgentLog(
    agentOutput?: string,
    workingTreeStatus?: string | null,
  ): string | null {
    const trimmedOutput = agentOutput?.trim() ?? "";
    const hasWorkingTreeStatus =
      workingTreeStatus !== undefined && workingTreeStatus !== null;
    const trimmedStatus = hasWorkingTreeStatus
      ? workingTreeStatus.trim()
      : "";
    const segments: string[] = [];

    if (trimmedOutput) {
      segments.push(trimmedOutput);
    }

    if (hasWorkingTreeStatus) {
      if (segments.length > 0) {
        segments.push("");
      }
      segments.push("Working tree status after run:");
      segments.push(trimmedStatus || "(clean)");
    } else if (workingTreeStatus === null) {
      if (segments.length > 0) {
        segments.push("");
      }
      segments.push("Working tree status after run:");
      segments.push("(unavailable)");
    }

    if (segments.length === 0) {
      return null;
    }

    return segments.join("\n");
  }

  private parsePermissionRequest(output?: string): PermissionRequest | null {
    const parser = new PermissionRequestParser();
    return parser.parse(output);
  }

  private formatPermissionRequestDescription(request: PermissionRequest): string {
    const permissionsList = request.permissions.map((permission) => `- ${permission}`).join("\n");
    const reasonLine = request.reason ? `Reason: ${request.reason}` : "Reason: (not provided)";

    return [
      "Claude Code requested additional permissions:",
      permissionsList || "- (none provided)",
      reasonLine,
    ].join("\n");
  }

  private buildPermissionRequestError(outcome: PermissionHandlingResult): string {
    if (outcome === "declined") {
      return "Permission update was not approved. Update .claude/settings.local.json and resume the execution.";
    }

    return "Requested permissions were already present but the agent still could not proceed. " +
      "Verify permissions in .claude/settings.local.json and resume the execution.";
  }

  private async confirmPermissionUpdate(
    permissions: string[],
    reason: string | undefined,
    stepNumber: number,
  ): Promise<boolean> {
    const permissionsList = permissions.map((permission) => `- ${permission}`).join("\n");
    const reasonLine = reason ? `Reason: ${reason}` : "Reason: (not provided)";
    const message = [
      "Claude Code cannot continue without additional permissions.",
      "Requested permissions:",
      permissionsList || "- (none provided)",
      reasonLine,
      "Approve updating .claude/settings.local.json? [y/N]",
    ].join("\n");

    this.log(message, "warn", stepNumber);

    if (!process.stdin.isTTY) {
      this.log(
        "Cannot prompt for permission approval without a TTY. " +
          "Run in an interactive terminal to approve permissions.",
        "warn",
        stepNumber,
      );
      throw new Error("Permission approval requires a TTY.");
    }

    const adapter = this.uiAdapters.find(
      (candidate) => typeof candidate.requestPermissionApproval === "function",
    );

    if (!adapter || !adapter.requestPermissionApproval) {
      throw new Error("Permission approval requires the TUI.");
    }

    return adapter.requestPermissionApproval({ permissions, reason }, stepNumber);
  }

  private loadSettingsLocal(settingsPath: string): Record<string, unknown> {
    if (!existsSync(settingsPath)) {
      return {};
    }

    const content = readFileSync(settingsPath, "utf-8").trim();
    if (!content) {
      return {};
    }

    const parsed = JSON.parse(content);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error(`Invalid JSON object in ${settingsPath}`);
    }

    return parsed as Record<string, unknown>;
  }

  private writeSettingsLocal(
    settingsPath: string,
    settings: Record<string, unknown>,
  ): void {
    const settingsDir = dirname(settingsPath);
    if (!existsSync(settingsDir)) {
      mkdirSync(settingsDir, { recursive: true });
    }

    const content = JSON.stringify(settings, null, 2);
    writeFileSync(settingsPath, `${content}\n`, "utf-8");
  }

  private applyPermissionUpdate(
    permissionsToAdd: string[],
    stepNumber: number,
  ): { settingsPath: string; added: string[] } {
    const settingsPath = resolve(this.workDir, ".claude", "settings.local.json");
    const currentSettings = this.loadSettingsLocal(settingsPath);
    const merged = mergePermissionAllows(currentSettings, permissionsToAdd);

    if (merged.added.length === 0) {
      this.log(
        "Requested permissions are already present in .claude/settings.local.json. " +
          "No changes were made.",
        "warn",
        stepNumber,
      );
    } else {
      this.writeSettingsLocal(settingsPath, merged.settings);
      this.log(
        `Updated .claude/settings.local.json with: ${merged.added.join(", ")}`,
        "success",
        stepNumber,
      );
    }

    return { settingsPath, added: merged.added };
  }

  private async handlePermissionRequest(
    iteration: Iteration,
    stepNumber: number,
    request: PermissionRequest,
  ): Promise<PermissionHandlingResult> {
    const description = this.formatPermissionRequestDescription(request);
    const issue = this.storage.createIssue(
      iteration.id,
      "permission_request",
      description,
      null,
      null,
      "error",
      "open",
    );

    this.emitEvent({
      type: "issue_found",
      timestamp: Date.now(),
      issueId: issue.id,
      iterationId: iteration.id,
      issueType: "permission_request",
      description: issue.description,
      severity: issue.severity ?? "error",
    });

    const approved = await this.confirmPermissionUpdate(
      request.permissions,
      request.reason,
      stepNumber,
    );

    if (!approved) {
      return "declined";
    }

    const applied = this.applyPermissionUpdate(request.permissions, stepNumber);
    if (applied.added.length > 0) {
      this.storage.updateIssueStatus(issue.id, "fixed", new Date().toISOString());
      this.emitEvent({
        type: "issue_resolved",
        timestamp: Date.now(),
        issueId: issue.id,
      });
    }

    return applied.added.length > 0 ? "applied" : "noop";
  }

  private buildPermissionContinuePrompt(stepNumber: number): string {
    return [
      `Permissions were updated for Step ${stepNumber}.`,
      "Please continue the previous task from where you left off.",
      "Do NOT ask for approval or confirmation.",
      "Do NOT use git commit --amend - create a NEW commit if needed.",
      "Do NOT push to remote - the orchestrator will handle pushing.",
      PERMISSION_REQUEST_INSTRUCTIONS.trim(),
    ].join("\n");
  }

  private buildReviewContinuePrompt(stepNumber: number): string {
    return [
      `Permissions were updated while reviewing Step ${stepNumber}.`,
      "Please continue the code review and output ONLY the required JSON result.",
      "Do NOT ask for approval or confirmation.",
      PERMISSION_REQUEST_INSTRUCTIONS.trim(),
    ].join("\n");
  }

  private getImplementationStrategy(): ImplementationAgentStrategy {
    if (this.implementationAgent === 'claude') {
      return {
        supportsPermissionRequests: true,
        run: (prompt: string) => this.claudeRunner.run({
          workDir: this.workDir,
          prompt,
          timeoutMinutes: this.agentTimeoutMinutes,
          captureOutput: true,
          eventEmitter: this.eventEmitter,
        }),
        runContinue: (prompt: string) => this.claudeRunner.runContinue({
          workDir: this.workDir,
          prompt,
          timeoutMinutes: this.agentTimeoutMinutes,
          captureOutput: true,
          eventEmitter: this.eventEmitter,
        }),
      };
    }

    return {
      supportsPermissionRequests: false,
      run: async (prompt: string) => {
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
      },
    };
  }

  private getReviewStrategy(): ReviewAgentStrategy {
    if (this.reviewAgent === 'codex') {
      return {
        supportsPermissionRequests: false,
        run: async (prompt: string) => {
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
        },
      };
    }

    return {
      supportsPermissionRequests: true,
      run: async (prompt: string) => {
        const promptWithPermissions = `${prompt}\n\n${PERMISSION_REQUEST_INSTRUCTIONS.trim()}`;
        const result = await this.claudeRunner.run({
          workDir: this.workDir,
          prompt: promptWithPermissions,
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
      },
      runContinue: async (prompt: string) => {
        const result = await this.claudeRunner.runContinue({
          workDir: this.workDir,
          prompt,
          timeoutMinutes: this.agentTimeoutMinutes,
          captureOutput: true,
          eventEmitter: this.eventEmitter,
        });

        return {
          success: result.success,
          output: result.output,
        };
      },
    };
  }

  private async runImplementationAgentWithPermissions(
    iteration: Iteration,
    stepNumber: number,
    prompt: string,
  ): Promise<AgentRunResult> {
    const strategy = this.getImplementationStrategy();
    const initialResult = await strategy.run(prompt);

    if (!strategy.supportsPermissionRequests) {
      return initialResult;
    }

    const maxPermissionAttempts = Orchestrator.MAX_PERMISSION_REQUEST_ATTEMPTS;
    let attempts = 0;
    let combinedOutput = initialResult.output ?? "";
    let latestOutput = initialResult.output;
    let currentResult: AgentRunResult = initialResult;

    while (attempts < maxPermissionAttempts) {
      const request = this.parsePermissionRequest(latestOutput);
      if (!request) {
        return {
          ...currentResult,
          output: combinedOutput || currentResult.output,
        };
      }

      const outcome = await this.handlePermissionRequest(iteration, stepNumber, request);
      if (outcome !== "applied") {
        const failureLog = this.buildAgentLog(combinedOutput, currentResult.workingTreeStatus);
        this.storage.updateIteration(iteration.id, {
          status: "failed",
          claudeLog: failureLog ?? null,
        });
        throw new Error(this.buildPermissionRequestError(outcome));
      }

      const continueResult = await strategy.runContinue(
        this.buildPermissionContinuePrompt(stepNumber),
      );

      if (!continueResult.success) {
        const failureLog = this.buildAgentLog(combinedOutput, currentResult.workingTreeStatus);
        this.storage.updateIteration(iteration.id, {
          status: "failed",
          claudeLog: failureLog ?? null,
        });
        throw new Error("Claude Code --continue failed after updating permissions.");
      }

      latestOutput = continueResult.output;
      if (continueResult.output) {
        combinedOutput = combinedOutput
          ? `${combinedOutput}\n\n--- Continue session ---\n\n${continueResult.output}`
          : continueResult.output;
      }

      currentResult = {
        success: continueResult.success,
        commitSha: continueResult.commitSha ?? null,
        output: combinedOutput,
      };

      attempts += 1;
    }

    throw new Error(
      `Exceeded ${maxPermissionAttempts} permission request attempts for Step ${stepNumber}.`,
    );
  }

  private async runReviewAgentWithPermissions(
    iteration: Iteration,
    stepNumber: number,
    prompt: string,
  ): Promise<{ success: boolean; output: string }> {
    const strategy = this.getReviewStrategy();
    let reviewRun = await strategy.run(prompt);

    if (!strategy.supportsPermissionRequests) {
      return reviewRun;
    }

    const maxPermissionAttempts = Orchestrator.MAX_PERMISSION_REQUEST_ATTEMPTS;
    let attempts = 0;
    let latestOutput: string | undefined = reviewRun.output;

    while (attempts < maxPermissionAttempts) {
      const request = this.parsePermissionRequest(latestOutput);
      if (!request) {
        return {
          success: reviewRun.success,
          output: latestOutput ?? reviewRun.output,
        };
      }

      const outcome = await this.handlePermissionRequest(iteration, stepNumber, request);
      if (outcome !== "applied") {
        throw new Error(this.buildPermissionRequestError(outcome));
      }

      const continueResult = await strategy.runContinue(
        this.buildReviewContinuePrompt(stepNumber),
      );

      if (!continueResult.success) {
        throw new Error("Claude Code --continue failed while resuming the review.");
      }

      latestOutput = continueResult.output;
      if (!latestOutput) {
        throw new Error("Claude Code --continue completed without review output.");
      }

      reviewRun = {
        success: continueResult.success,
        output: latestOutput,
      };

      attempts += 1;
    }

    throw new Error(
      `Exceeded ${maxPermissionAttempts} permission request attempts while reviewing Step ${stepNumber}.`,
    );
  }

  private logWorkingTreeStatusAfterAgent(
    workingTreeStatus: string | null | undefined,
    stepNumber: number,
  ): void {
    if (workingTreeStatus === undefined) {
      return;
    }

    if (workingTreeStatus === null) {
      this.log(
        "⚠ Unable to read working tree status after agent run",
        "warn",
        stepNumber,
      );
      return;
    }

    if (workingTreeStatus.length === 0) {
      this.log(
        "⚠ Working tree clean after agent run",
        "warn",
        stepNumber,
      );
      return;
    }

    this.log(
      `⚠ Working tree contains uncommitted changes after agent run:\n${workingTreeStatus}`,
      "warn",
      stepNumber,
    );
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
  ): Promise<{
    success: boolean;
    commitSha: string | null;
    output?: string;
    workingTreeStatus?: string | null;
  }> {
    const strategy = this.getImplementationStrategy();
    return strategy.run(prompt);
  }

  private async runReviewAgent(
    prompt: string,
  ): Promise<{ success: boolean; output: string }> {
    const strategy = this.getReviewStrategy();
    return strategy.run(prompt);
  }

  private cleanupIncompleteIterations(): void {
    if (!this.plan) {
      return;
    }

    const steps = this.storage.getSteps(this.plan.id);
    const iterations = this.storage.getIterationsForPlan(this.plan.id);
    const stepNumbersById = new Map<number, number>();
    for (const step of steps) {
      stepNumbersById.set(step.id, step.stepNumber);
    }
    let cleanedCount = 0;

    for (const iteration of iterations) {
      if (iteration.status === 'in_progress') {
        const stepNumber = stepNumbersById.get(iteration.stepId) ?? iteration.stepId;
        this.log(
          `Found incomplete iteration ${iteration.iterationNumber} for step ${stepNumber}, marking as aborted`,
          "warn"
        );
        this.storage.updateIteration(iteration.id, { status: 'aborted' });
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      this.log(`Cleaned up ${cleanedCount} aborted iteration(s)`, "info");
    }
  }

  private tryGetHeadCommit(): string | null {
    try {
      return execSync("git rev-parse HEAD", {
        cwd: this.workDir,
        encoding: "utf-8",
      }).trim();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log(`Failed to read HEAD commit in workDir "${this.workDir}": ${message}`, "warn");
      return null;
    }
  }

  private tryRecoverManualCommit(): void {
    if (!this.plan) {
      return;
    }

    const currentHead = this.tryGetHeadCommit();
    if (!currentHead) {
      return;
    }

    // Collect all known commit SHAs from this execution
    const steps = this.storage.getSteps(this.plan.id);
    const iterationsForPlan = this.storage.getIterationsForPlan(this.plan.id);
    const knownCommits = new Set<string>();
    const iterationsByStep = new Map<number, Iteration[]>();

    for (const iteration of iterationsForPlan) {
      if (iteration.commitSha) {
        knownCommits.add(iteration.commitSha);
      }
      const stepIterations = iterationsByStep.get(iteration.stepId);
      if (stepIterations) {
        stepIterations.push(iteration);
      } else {
        iterationsByStep.set(iteration.stepId, [iteration]);
      }
    }

    // If current HEAD is already known, nothing to recover
    if (knownCommits.has(currentHead)) {
      return;
    }

    // Look for in_progress steps with failed/aborted iterations that have no commit
    for (const step of steps) {
      if (step.status !== 'in_progress') {
        continue;
      }

      const iterations = iterationsByStep.get(step.id) ?? [];
      if (iterations.length === 0) {
        continue;
      }

      // Get the latest iteration for this step
      const latestIteration = iterations[iterations.length - 1];

      // Check if it's a failed/aborted iteration without a commit
      if (
        (latestIteration.status === 'failed' || latestIteration.status === 'aborted') &&
        !latestIteration.commitSha
      ) {
        this.log(
          `Detected manual commit ${currentHead.substring(0, 7)} for step ${step.stepNumber}, recovering iteration ${latestIteration.iterationNumber}`,
          "info"
        );

        // Update the iteration with the manual commit
        this.storage.updateIteration(latestIteration.id, {
          commitSha: currentHead,
          status: 'completed',
        });

        this.emitEvent({
          type: "iteration_complete",
          timestamp: Date.now(),
          stepId: step.id,
          iterationNumber: latestIteration.iterationNumber,
          commitSha: currentHead,
          status: 'completed',
        });

        // Only recover one iteration (the current step)
        return;
      }
    }
  }

  private countIterationsWithCommits(stepId: number): number {
    const iterations = this.storage.getIterations(stepId);
    return iterations.filter(iteration => iteration.commitSha !== null && iteration.status !== 'aborted').length;
  }

  private getLatestIterationWithCommit(stepId: number): Iteration | null {
    const iterations = this.storage.getIterations(stepId);
    for (let index = iterations.length - 1; index >= 0; index -= 1) {
      const iteration = iterations[index];
      if (iteration.commitSha !== null && iteration.status !== 'aborted') {
        return iteration;
      }
    }
    return null;
  }

  private getLatestIssuesForStep(stepId: number, issueType: Issue['type']): Issue[] {
    const issues = this.storage.getIssuesForStepByType(stepId, issueType);
    if (issues.length === 0) {
      return [];
    }
    const latestIterationId = issues[0].iterationId;
    return issues.filter(issue => issue.iterationId === latestIterationId);
  }

  private formatLatestBuildErrors(stepId: number): string {
    const buildIssues = this.getLatestIssuesForStep(stepId, 'ci_failure');
    if (buildIssues.length === 0) {
      return "Build checks failed. Please review the GitHub Actions logs and fix the issues.";
    }
    return buildIssues.map(issue => issue.description).join("\n");
  }

  private getWorkingTreeStatus(): string | null {
    try {
      const status = execSync("git status --short", {
        cwd: this.workDir,
        encoding: "utf-8",
      }).trim();
      return status.length > 0 ? status : null;
    } catch {
      return null;
    }
  }

  private async tryRecoverUncommittedChanges(): Promise<void> {
    if (!this.plan) {
      return;
    }

    const workingTreeStatus = this.getWorkingTreeStatus();
    if (!workingTreeStatus) {
      return;
    }

    this.log("─".repeat(80), "warn");
    this.log("Detected uncommitted changes in working directory:", "warn");
    this.log(workingTreeStatus, "warn");
    this.log("─".repeat(80), "warn");

    // Find the current step (in_progress or first pending)
    const steps = this.storage.getSteps(this.plan.id);
    const currentStep = steps.find(
      (s) => s.status === 'in_progress' || s.status === 'pending'
    );

    if (!currentStep) {
      this.log("No pending steps found, cannot recover uncommitted changes", "warn");
      return;
    }

    // Find the last aborted iteration for this step
    const iterations = this.storage.getIterations(currentStep.id);
    const abortedIterations = iterations.filter(i => i.status === 'aborted');

    if (abortedIterations.length === 0) {
      this.log("No aborted iterations found, will start fresh implementation", "info");
      return;
    }

    const lastAborted = abortedIterations[abortedIterations.length - 1];

    this.log(`Found aborted iteration ${lastAborted.iterationNumber} for step ${currentStep.stepNumber}`, "info");
    this.log("Attempting to resume Claude Code session to complete the work...", "info");

    // Build a prompt to continue the interrupted work
    const continuePrompt = `Your previous session was interrupted while implementing Step ${currentStep.stepNumber}: ${currentStep.title}.

There are uncommitted changes in the working directory. Please:
1. Review the current changes with \`git status\` and \`git diff\`
2. If the implementation looks complete, run the project's build, lint, and test commands to verify
   - Check CLAUDE.md, justfile, Makefile, package.json, or similar for the appropriate commands
3. If tests pass, stage all changes and create a commit
4. If the implementation is incomplete, complete it first, then test and commit

CRITICAL REQUIREMENTS:
- You MUST create a git commit for your changes - this is not optional
- Do NOT ask for approval or confirmation - just create the commit
- Do NOT use git commit --amend - create a NEW commit
- Do NOT push to remote - the orchestrator will handle pushing`;

    const result = await this.claudeRunner.runContinue({
      workDir: this.workDir,
      prompt: continuePrompt,
      timeoutMinutes: this.agentTimeoutMinutes,
      captureOutput: true,
      eventEmitter: this.eventEmitter,
    });

    if (result.success && result.commitSha) {
      this.log(`✓ Recovered interrupted session with commit ${result.commitSha}`, "success");

      // Update the aborted iteration with the commit info
      this.storage.updateIteration(lastAborted.id, {
        status: 'completed',
        commitSha: result.commitSha,
        claudeLog: result.output ?? null,
      });

      // Push the recovered commit to GitHub
      await this.pushCommit();

      this.emitEvent({
        type: "iteration_complete",
        timestamp: Date.now(),
        stepId: currentStep.id,
        iterationNumber: lastAborted.iterationNumber,
        commitSha: result.commitSha,
        status: 'completed',
      });
    } else {
      this.log("Failed to recover interrupted session, will start fresh", "warn");
    }
  }

  private emitInitialState(): void {
    if (!this.plan) return;

    const executionState = this.storage.getExecutionState(this.plan.id);

    this.emitEvent({
      type: "execution_started",
      timestamp: Date.now(),
      executionId: this.plan.id,
      isResume: !!this.executionId,
    });

    this.emitEvent({
      type: "state_sync",
      timestamp: Date.now(),
      plan: this.plan,
      steps: executionState.steps,
      iterations: executionState.iterations,
      issues: executionState.issues,
    });
  }

  private refreshPlanFromDisk(): void {
    this.parser = new StepParser(this.planFile);
    this.planContent = this.parser.getContent();
  }

  private syncPendingStepsFromPlan(): void {
    if (!this.plan) {
      return;
    }

    const steps = this.storage.getSteps(this.plan.id);
    const currentStep = steps.find(
      (step) => step.status === 'pending' || step.status === 'in_progress'
    );

    if (!currentStep) {
      this.log("No pending steps found, skipping plan refresh", "info");
      return;
    }

    const startStepNumber = currentStep.stepNumber + 1;
    const parsedSteps = this.parser.parseSteps();
    const futureSteps = parsedSteps.filter((step) => step.number >= startStepNumber);

    const { deletedCount, createdCount } = this.storage.replacePendingStepsFromPlan(
      this.plan.id,
      startStepNumber,
      futureSteps.map((step) => ({
        stepNumber: step.number,
        title: step.title,
      }))
    );

    if (deletedCount > 0 || createdCount > 0) {
      this.log(
        `Refreshed plan steps from step ${startStepNumber} (removed ${deletedCount}, added ${createdCount})`,
        "info"
      );
    }
  }

  private async initializeOrResumePlan(): Promise<void> {
    if (this.executionId) {
      this.log(`Resuming execution ID: ${this.executionId}`, "info");
      const plan = this.storage.getPlan(this.executionId);
      if (!plan) {
        throw new Error(`Execution ID ${this.executionId} not found in database`);
      }
      this.plan = plan;
      this.planFile = plan.planFilePath;
      this.refreshPlanFromDisk();
      this.log(`Loaded plan from database: ${plan.planFilePath}`, "info");
      this.syncPendingStepsFromPlan();

      // Emit initial state so UI updates immediately
      this.emitInitialState();

      this.cleanupIncompleteIterations();
      this.tryRecoverManualCommit();
      await this.tryRecoverUncommittedChanges();

      // Emit updated state after recovery
      this.emitInitialState();
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

      // Emit initial state for new execution
      this.emitInitialState();
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
      const output = execSync("git push", {
        cwd: this.workDir,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      if (output && output.trim()) {
        this.log(output.trim());
      }
      this.log("✓ Pushed commit to GitHub", "success");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.log(`⚠ Failed to push commit: ${errorMessage}`, "warn");
      throw new Error("Failed to push commit to GitHub");
    }
  }

  private truncateLog(log: string, maxChars: number): string {
    if (log.length <= maxChars) {
      return log;
    }
    const truncatedCount = log.length - maxChars;
    return `... (truncated ${truncatedCount} chars)\n${log.slice(truncatedCount)}`;
  }

  private singleLine(text: string): string {
    return text.replace(/\s+/g, " ").trim();
  }

  private formatAnnotations(annotations: CheckRunAnnotation[]): string | null {
    if (annotations.length === 0) {
      return null;
    }

    const limitedAnnotations = annotations.slice(0, Orchestrator.MAX_ANNOTATIONS);
    const lines = limitedAnnotations.map((annotation) => {
      const lineSuffix = annotation.start_line != null ? `:${annotation.start_line}` : "";
      const location = `${annotation.path}${lineSuffix}`;
      const level = annotation.annotation_level ?? "failure";
      const message = this.singleLine(
        this.truncateLog(annotation.message, Orchestrator.MAX_ANNOTATION_CHARS),
      );
      const detailParts: string[] = [];
      if (annotation.title) {
        detailParts.push(this.singleLine(annotation.title));
      }
      if (annotation.raw_details) {
        detailParts.push(
          this.singleLine(
            this.truncateLog(annotation.raw_details, Orchestrator.MAX_ANNOTATION_CHARS),
          ),
        );
      }
      const details = detailParts.length > 0 ? ` (${detailParts.join(" - ")})` : "";
      return `- ${location}: ${level}: ${message}${details}`;
    });

    if (annotations.length > limitedAnnotations.length) {
      lines.push(`... ${annotations.length - limitedAnnotations.length} more annotations omitted`);
    }

    return lines.join("\n");
  }

  private async fetchCheckRunAnnotations(checkRunId: number): Promise<CheckRunAnnotation[]> {
    try {
      const response = await this.githubChecker.getOctokit().request(
        "GET /repos/{owner}/{repo}/check-runs/{check_run_id}/annotations",
        {
          owner: this.githubChecker.getOwner(),
          repo: this.githubChecker.getRepo(),
          check_run_id: checkRunId,
          per_page: Orchestrator.MAX_ANNOTATIONS,
        },
      );
      return response.data as CheckRunAnnotation[];
    } catch (error) {
      this.log(
        `Warning: Could not fetch check run annotations: ${error instanceof Error ? error.message : String(error)}`,
        "warn",
      );
      return [];
    }
  }

  private async extractBuildErrors(sha: string): Promise<string> {
    try {
      const response = await this.githubChecker.getOctokit().checks.listForRef({
        owner: this.githubChecker.getOwner(),
        repo: this.githubChecker.getRepo(),
        ref: sha,
      });
      const checkRuns = response.data as { check_runs: CheckRunSummary[] };

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
          message += `Title: ${this.singleLine(check.output.title)}\n`;
        }
        if (check.output?.summary) {
          message += `Summary:\n${this.truncateLog(check.output.summary, Orchestrator.MAX_BUILD_OUTPUT_CHARS)}\n`;
        }
        if (check.output?.text) {
          message += `Output:\n${this.truncateLog(check.output.text, Orchestrator.MAX_BUILD_OUTPUT_CHARS)}\n`;
        }

        const annotations = await this.fetchCheckRunAnnotations(check.id);
        const formattedAnnotations = this.formatAnnotations(annotations);
        if (formattedAnnotations) {
          message += `Annotations:\n${formattedAnnotations}\n`;
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
    let stoppedEarly = false;

    if (!this.plan) {
      throw new Error("Plan not initialized");
    }

    const allSteps = this.storage.getSteps(this.plan.id);
    const pendingSteps = allSteps.filter((s) => s.status === 'pending' || s.status === 'in_progress');

    this.log("═".repeat(80));
    this.log(
      `Found ${allSteps.length} steps (${allSteps.length - pendingSteps.length} done, ${pendingSteps.length} pending)`,
    );
    this.log("═".repeat(80));

    if (pendingSteps.length === 0) {
      this.log("\n✓ All steps are already marked as done!", "success");

      this.emitEvent({
        type: "all_complete",
        timestamp: Date.now(),
        totalTime: 0,
      });

      return this.plan.id;
    }

    let step = this.getCurrentStep();
    while (step) {
      this.storage.updateStepStatus(step.id, 'in_progress');
      step = { ...step, status: 'in_progress' };

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
        const result = await this.runImplementationAgentWithPermissions(
          iteration,
          step.stepNumber,
          prompt,
        );

        if (!result || !result.commitSha) {
          const failureLog = this.buildAgentLog(result?.output, result?.workingTreeStatus);
          const workingTreeSummary = this.formatWorkingTreeSummary(
            result?.workingTreeStatus ?? null,
          );

          this.storage.updateIteration(iteration.id, {
            status: 'failed',
            claudeLog: failureLog ?? null,
          });

          this.logWorkingTreeStatusAfterAgent(
            result?.workingTreeStatus,
            step.stepNumber,
          );

          const agentName = this.getAgentDisplayName(this.implementationAgent);
          const errorSuffix = workingTreeSummary
            ? ` (working tree dirty: ${workingTreeSummary})`
            : "";
          const errorMessage = `${agentName} completed but did not create a commit${errorSuffix}`;

          this.emitEvent({
            type: "error",
            timestamp: Date.now(),
            error: errorMessage,
            stepNumber: step.stepNumber,
          });
          throw new Error(
            `${agentName} completed but did not create a commit for implementation${errorSuffix}`,
          );
        }

        this.storage.updateIteration(iteration.id, {
          commitSha: result.commitSha,
          claudeLog: this.buildAgentLog(result.output, result.workingTreeStatus) ?? null,
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
        const latestCommittedIteration = this.getLatestIterationWithCommit(step.id);
        const sha = latestCommittedIteration?.commitSha ?? this.githubChecker.getLatestCommitSha();
        const previousIterationId = latestCommittedIteration?.id;

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
          if (!previousIterationId) {
            throw new Error(`No committed iteration found for step ${step.stepNumber} while recording build failures.`);
          }
          const issue = this.storage.createIssue(previousIterationId, 'ci_failure', buildErrors);

          this.emitEvent({
            type: "issue_found",
            timestamp: Date.now(),
            issueId: issue.id,
            iterationId: previousIterationId,
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

          const prompt = PROMPTS.buildFix(step.stepNumber, buildErrors);
          const result = await this.runImplementationAgentWithPermissions(
            iteration,
            step.stepNumber,
            prompt,
          );

          if (!result || !result.commitSha) {
            const failureLog = this.buildAgentLog(result?.output, result?.workingTreeStatus);
            const workingTreeSummary = this.formatWorkingTreeSummary(
              result?.workingTreeStatus ?? null,
            );

            this.storage.updateIteration(iteration.id, {
              status: 'failed',
              claudeLog: failureLog ?? null,
            });

            this.logWorkingTreeStatusAfterAgent(
              result?.workingTreeStatus,
              step.stepNumber,
            );

            const agentName = this.getAgentDisplayName(this.implementationAgent);
            const errorSuffix = workingTreeSummary
              ? ` (working tree dirty: ${workingTreeSummary})`
              : "";
            const errorMessage = `${agentName} completed but did not create a commit${errorSuffix}`;

            this.emitEvent({
              type: "error",
              timestamp: Date.now(),
              error: errorMessage,
              stepNumber: step.stepNumber,
            });
            throw new Error(
              `${agentName} completed but did not create a commit for build fix${errorSuffix}`,
            );
          }

          this.storage.updateIteration(iteration.id, {
            commitSha: result.commitSha,
            claudeLog: this.buildAgentLog(result.output, result.workingTreeStatus) ?? null,
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

        const previousIteration = this.getLatestIterationWithCommit(step.id);
        if (!previousIteration) {
          throw new Error(`No committed iteration found for step ${step.stepNumber} to review.`);
        }
        const promptType = this.determineCodexPromptType(previousIteration);

        const commitSha = previousIteration.commitSha || 'HEAD';
        let codexPrompt: string;
        if (promptType === 'implementation') {
          codexPrompt = PROMPTS.codexReviewImplementation(step.stepNumber, step.title, this.planContent, commitSha);
        } else if (promptType === 'build_fix') {
          const buildErrors = this.formatLatestBuildErrors(step.id);
          codexPrompt = PROMPTS.codexReviewBuildFix(buildErrors, commitSha);
        } else {
          const openIssues = this.storage.getOpenIssues(step.id)
            .filter(i => i.type === 'codex_review')
            .map(i => ({
              file: i.filePath || 'unknown',
              line: i.lineNumber !== null ? i.lineNumber : undefined,
              severity: i.severity || 'error',
              description: i.description,
            }));
          codexPrompt = PROMPTS.codexReviewCodeFixes(openIssues, commitSha);
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

        let reviewRun: { success: boolean; output: string };
        try {
          reviewRun = await this.runReviewAgentWithPermissions(
            previousIteration,
            step.stepNumber,
            codexPrompt,
          );
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          const errorStack = error instanceof Error ? error.stack : undefined;
          const diagnosticLog = [
            `Review agent failed with error: ${errorMessage}`,
            errorStack ? `\nStack trace:\n${errorStack}` : '',
            `\nReview agent: ${this.reviewAgent}`,
            `Prompt type: ${promptType}`,
          ].join('');

          this.storage.updateIteration(previousIteration.id, {
            codexLog: diagnosticLog,
            reviewStatus: 'failed',
          });

          this.emitEvent({
            type: "error",
            timestamp: Date.now(),
            error: `Review agent failed: ${errorMessage}`,
            stepNumber: step.stepNumber,
          });

          this.log(`✗ Review agent failed: ${errorMessage}`, "error");
          throw error;
        }

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

          const prompt = PROMPTS.reviewFix(step.stepNumber, JSON.stringify(reviewResult.issues, null, 2));
          const result = await this.runImplementationAgentWithPermissions(
            iteration,
            step.stepNumber,
            prompt,
          );

          if (!result || !result.commitSha) {
            const failureLog = this.buildAgentLog(result?.output, result?.workingTreeStatus);
            const workingTreeSummary = this.formatWorkingTreeSummary(
              result?.workingTreeStatus ?? null,
            );

            this.storage.updateIteration(iteration.id, {
              status: 'failed',
              claudeLog: failureLog ?? null,
            });

            this.logWorkingTreeStatusAfterAgent(
              result?.workingTreeStatus,
              step.stepNumber,
            );

            const agentName = this.getAgentDisplayName(this.implementationAgent);
            const errorSuffix = workingTreeSummary
              ? ` (working tree dirty: ${workingTreeSummary})`
              : "";
            const errorMessage = `${agentName} completed but did not create a commit${errorSuffix}`;

            this.emitEvent({
              type: "error",
              timestamp: Date.now(),
              error: errorMessage,
              stepNumber: step.stepNumber,
            });
            throw new Error(
              `${agentName} completed but did not create a commit for review fix${errorSuffix}`,
            );
          }

          this.storage.updateIteration(iteration.id, {
            commitSha: result.commitSha,
            claudeLog: this.buildAgentLog(result.output, result.workingTreeStatus) ?? null,
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
          if (this.stopController?.isStopAfterStepRequested()) {
            this.stopController.markStopAfterStepTriggered();
            this.log(
              `Stop requested. Exiting after completing step ${step.stepNumber}.`,
              "warn"
            );
            stoppedEarly = true;
          }

          break;
        }
      }

      if (this.countIterationsWithCommits(step.id) > this.maxIterationsPerStep) {
        this.handleMaxIterationsExceeded(step);
      }

      if (stoppedEarly) {
        break;
      }

      step = this.getCurrentStep();
    }

    if (stoppedEarly) {
      if (this.storageOwned) {
        this.storage.close();
      }

      getLogger()?.close();
      return this.plan.id;
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

    getLogger()?.close();

    return this.plan.id;
  }
}
