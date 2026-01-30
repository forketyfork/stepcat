export interface Plan {
  id: number;
  planFilePath: string;
  workDir: string;
  owner: string;
  repo: string;
  createdAt: string;
}

export interface DbStep {
  id: number;
  planId: number;
  stepNumber: number;
  title: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  createdAt: string;
  updatedAt: string;
}

export interface Iteration {
  id: number;
  stepId: number;
  iterationNumber: number;
  type: 'implementation' | 'build_fix' | 'review_fix';
  commitSha: string | null;
  claudeLog: string | null;
  codexLog: string | null;
  buildStatus: 'pending' | 'in_progress' | 'passed' | 'failed' | 'merge_conflict' | null;
  reviewStatus: 'pending' | 'in_progress' | 'passed' | 'failed' | null;
  status: 'in_progress' | 'completed' | 'failed' | 'aborted';
  phase: 'implementation' | 'pushing' | 'build_check' | 'review' | 'done' | null;
  interruptionReason: string | null;
  implementationAgent: 'claude' | 'codex';
  reviewAgent: 'claude' | 'codex' | null;
  createdAt: string;
  updatedAt: string;
}

export interface Issue {
  id: number;
  iterationId: number;
  type: 'ci_failure' | 'codex_review' | 'merge_conflict' | 'permission_request';
  description: string;
  filePath: string | null;
  lineNumber: number | null;
  severity: 'error' | 'warning' | null;
  status: 'open' | 'fixed';
  createdAt: string;
  resolvedAt: string | null;
}
