export interface DagConfig {
  version?: number;
  nodes: DagNodeConfig[];
}

export type DagNodeConfig = DagTaskConfig | DagGroupConfig;

export interface DagBaseConfig {
  name: string;
  depends_on?: string[];
}

export type DagTaskKind = 'agent' | 'action';

export interface DagTaskConfig extends DagBaseConfig {
  kind?: DagTaskKind;
  prompt?: string;
  agent?: string;
  action?: string;
}

export interface DagGroupConfig extends DagBaseConfig {
  nodes: DagNodeConfig[];
  for_each?: DagForEachConfig;
  repeat_until?: DagRepeatUntilConfig;
}

export interface DagForEachConfig {
  var: string;
  in: string;
}

export interface DagRepeatUntilConfig {
  condition: string;
  max_iterations?: number;
}

export interface DagTaskExecution extends DagTaskConfig {
  resolvedPrompt?: string;
  handlerId: string;
  kind: DagTaskKind;
}

export interface DagExecutionContext {
  data: Record<string, unknown>;
  locals: Record<string, unknown>;
}

export interface DagNodeResult {
  status: 'success' | 'failed';
  output?: unknown;
  error?: Error;
}

export interface DagRunResult {
  status: 'success' | 'failed';
  results: Map<string, DagNodeResult>;
}
