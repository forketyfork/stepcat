import type {
  DagConfig,
  DagExecutionContext,
  DagGroupConfig,
  DagNodeConfig,
  DagNodeResult,
  DagRunResult,
  DagTaskConfig,
  DagTaskKind,
  DagTaskExecution,
} from './dag-models.js';

export type DagNodeHandler = (
  node: DagTaskExecution,
  executionContext: DagExecutionContext,
  runState: DagRunState,
) => Promise<DagNodeResult>;

export interface DagExecutorOptions {
  handlers: Partial<Record<string, DagNodeHandler>>;
  defaultHandler?: DagNodeHandler;
  maxRepeatIterations?: number;
}

export interface DagRunState {
  results: Map<string, DagNodeResult>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const resolvePath = (context: DagExecutionContext, path: string): unknown => {
  const fullContext: Record<string, unknown> = {
    ...context.data,
    ...context.locals,
  };
  const segments = path.split('.').filter(segment => segment.length > 0);
  let current: unknown = fullContext;
  for (const segment of segments) {
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (Number.isNaN(index) || index < 0 || index >= current.length) {
        return undefined;
      }
      current = current[index];
      continue;
    }
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
};

const stringifyTemplateValue = (value: unknown): string => {
  if (value === undefined || value === null) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return value.toString();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
};

const renderTemplate = (template: string, context: DagExecutionContext): string =>
  template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, path: string) =>
    stringifyTemplateValue(resolvePath(context, path)),
  );

const resolveNodeOrder = (nodes: DagNodeConfig[]): DagNodeConfig[] => {
  const nodeMap = new Map<string, DagNodeConfig>();
  nodes.forEach(node => {
    nodeMap.set(node.name, node);
  });

  const inDegree = new Map<string, number>();
  nodeMap.forEach((node, name) => {
    const dependencies = node.depends_on ?? [];
    dependencies.forEach(dependency => {
      if (!nodeMap.has(dependency)) {
        throw new Error(`Node '${name}' depends on unknown node '${dependency}'.`);
      }
    });
    inDegree.set(name, dependencies.length);
  });

  const ready = Array.from(inDegree.entries())
    .filter(([, degree]) => degree === 0)
    .map(([name]) => name);

  const order: DagNodeConfig[] = [];
  while (ready.length > 0) {
    const name = ready.shift();
    if (!name) {
      break;
    }
    const node = nodeMap.get(name);
    if (!node) {
      continue;
    }
    order.push(node);
    nodeMap.forEach((candidate, candidateName) => {
      const dependencies = candidate.depends_on ?? [];
      if (dependencies.includes(name)) {
        const updatedDegree = (inDegree.get(candidateName) ?? 0) - 1;
        inDegree.set(candidateName, updatedDegree);
        if (updatedDegree === 0) {
          ready.push(candidateName);
        }
      }
    });
  }

  if (order.length !== nodes.length) {
    throw new Error('Cycle detected in DAG configuration.');
  }
  return order;
};

const buildScopeName = (scope: string | undefined, nodeName: string): string => {
  if (!scope) {
    return nodeName;
  }
  return `${scope}.${nodeName}`;
};

const ensureArray = (value: unknown, label: string): unknown[] => {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must resolve to an array.`);
  }
  return value;
};

const resolveTaskHandler = (
  node: DagTaskConfig,
): { handlerId: string; kind: DagTaskKind } => {
  if (node.kind === 'action' || node.action) {
    if (!node.action) {
      throw new Error(`Action node '${node.name}' is missing action.`);
    }
    return { handlerId: node.action, kind: 'action' };
  }
  if (!node.agent) {
    throw new Error(`Agent node '${node.name}' is missing agent.`);
  }
  return { handlerId: node.agent, kind: 'agent' };
};

export class DagExecutor {
  private readonly config: DagConfig;
  private readonly handlers: Partial<Record<string, DagNodeHandler>>;
  private readonly defaultHandler?: DagNodeHandler;
  private readonly maxRepeatIterations: number;

  constructor(config: DagConfig, options: DagExecutorOptions) {
    this.config = config;
    this.handlers = options.handlers;
    this.defaultHandler = options.defaultHandler;
    this.maxRepeatIterations = options.maxRepeatIterations ?? 25;
  }

  async run(contextData: Record<string, unknown>): Promise<DagRunResult> {
    const runState: DagRunState = { results: new Map() };
    const executionContext: DagExecutionContext = {
      data: contextData,
      locals: {},
    };

    await this.runNodes(this.config.nodes, executionContext, runState, undefined);

    return {
      status: 'success',
      results: runState.results,
    };
  }

  private async runNodes(
    nodes: DagNodeConfig[],
    context: DagExecutionContext,
    runState: DagRunState,
    scope: string | undefined,
  ): Promise<void> {
    const orderedNodes = resolveNodeOrder(nodes);
    for (const node of orderedNodes) {
      if ('nodes' in node) {
        await this.runGroup(node, context, runState, scope);
      } else {
        await this.runTask(node, context, runState, scope);
      }
    }
  }

  private async runTask(
    node: DagTaskConfig,
    context: DagExecutionContext,
    runState: DagRunState,
    scope: string | undefined,
  ): Promise<void> {
    const fullName = buildScopeName(scope, node.name);
    const resolvedPrompt = node.prompt ? renderTemplate(node.prompt, context) : undefined;
    const { handlerId, kind } = resolveTaskHandler(node);
    const executionNode: DagTaskExecution = {
      ...node,
      resolvedPrompt,
      handlerId,
      kind,
    };

    const handler = this.handlers[handlerId] ?? this.defaultHandler;
    if (!handler) {
      throw new Error(`No handler registered for node '${node.name}' (${handlerId}).`);
    }

    const result = await handler(executionNode, context, runState);
    runState.results.set(fullName, result);
    if (result.status === 'failed') {
      throw result.error ?? new Error(`Node '${node.name}' failed.`);
    }
  }

  private async runGroup(
    node: DagGroupConfig,
    context: DagExecutionContext,
    runState: DagRunState,
    scope: string | undefined,
  ): Promise<void> {
    const groupScope = buildScopeName(scope, node.name);

    if (node.for_each) {
      const source = resolvePath(context, node.for_each.in);
      const items = ensureArray(source, `for_each '${node.for_each.in}'`);
      for (let index = 0; index < items.length; index += 1) {
        const locals = {
          ...context.locals,
          [node.for_each.var]: items[index],
          [`${node.for_each.var}_index`]: index,
        };
        const iterationContext: DagExecutionContext = {
          data: context.data,
          locals,
        };
        await this.runNodes(
          node.nodes,
          iterationContext,
          runState,
          `${groupScope}[${index}]`,
        );
      }
      return;
    }

    if (node.repeat_until) {
      const maxIterations = node.repeat_until.max_iterations ?? this.maxRepeatIterations;
      for (let iteration = 0; iteration < maxIterations; iteration += 1) {
        await this.runNodes(
          node.nodes,
          context,
          runState,
          `${groupScope}[${iteration}]`,
        );
        const conditionKey = `${groupScope}[${iteration}].${node.repeat_until.condition}`;
        const conditionResult = runState.results.get(conditionKey);
        if (!conditionResult) {
          throw new Error(
            `Repeat-until condition '${node.repeat_until.condition}' did not run in iteration ${iteration}.`,
          );
        }
        if (conditionResult.output) {
          return;
        }
      }
      throw new Error(
        `Repeat-until group '${node.name}' did not satisfy condition within ${maxIterations} iterations.`,
      );
    }

    await this.runNodes(node.nodes, context, runState, groupScope);
  }
}
