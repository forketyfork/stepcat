import { Plan, DbStep, Iteration, Issue } from './models.js';

export type IterationUpdate = Partial<
  Omit<Iteration, 'id' | 'stepId' | 'iterationNumber' | 'type' | 'createdAt'>
>;

export type ExecutionState = {
  steps: DbStep[];
  iterations: Iteration[];
  issues: Issue[];
};

export type PlanStepInput = {
  stepNumber: number;
  title: string;
};

export interface Storage {
  createPlan(planFilePath: string, workDir: string, owner: string, repo: string): Plan;
  getPlan(id: number): Plan | undefined;

  createStep(planId: number, stepNumber: number, title: string): DbStep;
  getSteps(planId: number): DbStep[];
  updateStepStatus(stepId: number, status: DbStep['status']): void;
  updateStepTitle(stepId: number, title: string): void;
  replacePendingStepsFromPlan(
    planId: number,
    startStepNumber: number,
    steps: PlanStepInput[]
  ): { deletedCount: number; createdCount: number };

  createIteration(
    stepId: number,
    iterationNumber: number,
    type: Iteration['type'],
    implementationAgent: 'claude' | 'codex',
    reviewAgent: 'claude' | 'codex' | null
  ): Iteration;
  getIterations(stepId: number): Iteration[];
  getIterationsForPlan(planId: number): Iteration[];
  updateIteration(iterationId: number, updates: IterationUpdate): void;

  createIssue(
    iterationId: number,
    type: Issue['type'],
    description: string,
    filePath?: string | null,
    lineNumber?: number | null,
    severity?: Issue['severity'],
    status?: Issue['status'],
  ): Issue;
  getIssues(iterationId: number): Issue[];
  getIssuesForStepByType(stepId: number, issueType: Issue['type']): Issue[];
  updateIssueStatus(issueId: number, status: Issue['status'], resolvedAt?: string): void;
  getOpenIssues(stepId: number): Issue[];
  getExecutionState(planId: number): ExecutionState;

  close(): void;
}
