import { Plan, DbStep, Iteration, Issue } from './models';

export type IterationUpdate = Partial<
  Omit<Iteration, 'id' | 'stepId' | 'iterationNumber' | 'type' | 'createdAt'>
>;

export interface Storage {
  createPlan(planFilePath: string, workDir: string, owner: string, repo: string): Plan;
  getPlan(id: number): Plan | undefined;

  createStep(planId: number, stepNumber: number, title: string): DbStep;
  getSteps(planId: number): DbStep[];
  updateStepStatus(stepId: number, status: DbStep['status']): void;

  createIteration(stepId: number, iterationNumber: number, type: Iteration['type']): Iteration;
  getIterations(stepId: number): Iteration[];
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
  updateIssueStatus(issueId: number, status: Issue['status'], resolvedAt?: string): void;
  getOpenIssues(stepId: number): Issue[];

  close(): void;
}
