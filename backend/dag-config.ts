import { parse as parseYaml } from 'yaml';

import type {
  DagConfig,
  DagForEachConfig,
  DagGroupConfig,
  DagNodeConfig,
  DagRepeatUntilConfig,
  DagTaskKind,
  DagTaskConfig,
} from './dag-models.js';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const coerceStringArray = (value: unknown, path: string): string[] | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === 'string') {
    return [value];
  }
  if (Array.isArray(value)) {
    const invalidIndex = value.findIndex(item => typeof item !== 'string');
    if (invalidIndex !== -1) {
      throw new Error(`${path} must contain only strings.`);
    }
    return value as string[];
  }
  throw new Error(`${path} must be a string or list of strings.`);
};

const parseForEach = (value: unknown, path: string): DagForEachConfig | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new Error(`${path} must be a mapping.`);
  }
  const variable = value.var;
  const input = value.in;
  if (typeof variable !== 'string' || variable.trim().length === 0) {
    throw new Error(`${path}.var must be a non-empty string.`);
  }
  if (typeof input !== 'string' || input.trim().length === 0) {
    throw new Error(`${path}.in must be a non-empty string.`);
  }
  return { var: variable, in: input };
};

const parseRepeatUntil = (value: unknown, path: string): DagRepeatUntilConfig | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new Error(`${path} must be a mapping.`);
  }
  const condition = value.condition;
  const maxIterations = value.max_iterations;
  if (typeof condition !== 'string' || condition.trim().length === 0) {
    throw new Error(`${path}.condition must be a non-empty string.`);
  }
  if (maxIterations !== undefined && typeof maxIterations !== 'number') {
    throw new Error(`${path}.max_iterations must be a number when provided.`);
  }
  return { condition, max_iterations: maxIterations };
};

const parseNode = (value: unknown, path: string): DagNodeConfig => {
  if (!isRecord(value)) {
    throw new Error(`${path} must be a mapping.`);
  }
  const name = value.name;
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new Error(`${path}.name must be a non-empty string.`);
  }
  const dependsOn = coerceStringArray(value.depends_on, `${path}.depends_on`);
  const forEach = parseForEach(value.for_each, `${path}.for_each`);
  const repeatUntil = parseRepeatUntil(value.repeat_until, `${path}.repeat_until`);

  if (forEach !== undefined && repeatUntil !== undefined) {
    throw new Error(`${path} cannot define both for_each and repeat_until.`);
  }

  if (value.nodes !== undefined) {
    if (!Array.isArray(value.nodes)) {
      throw new Error(`${path}.nodes must be a list.`);
    }
    if (value.prompt !== undefined || value.agent !== undefined) {
      throw new Error(`${path} cannot define prompt/agent when nodes is present.`);
    }
    const nodes = value.nodes.map((nodeValue, index) =>
      parseNode(nodeValue, `${path}.nodes[${index}]`),
    );
    const nodeNames = nodes.map(node => node.name);
    const duplicateName = nodeNames.find(
      (nodeName, index) => nodeNames.indexOf(nodeName) !== index,
    );
    if (duplicateName) {
      throw new Error(`${path}.nodes contains duplicate node name '${duplicateName}'.`);
    }
    const groupConfig: DagGroupConfig = {
      name,
      depends_on: dependsOn,
      nodes,
      for_each: forEach,
      repeat_until: repeatUntil,
    };
    return groupConfig;
  }

  if (forEach !== undefined || repeatUntil !== undefined) {
    throw new Error(`${path} defines a loop but is missing nodes.`);
  }

  const prompt = value.prompt;
  const agent = value.agent;
  const action = value.action;
  const kindValue = value.kind;
  if (prompt !== undefined && typeof prompt !== 'string') {
    throw new Error(`${path}.prompt must be a string.`);
  }
  if (agent !== undefined && typeof agent !== 'string') {
    throw new Error(`${path}.agent must be a string.`);
  }
  if (action !== undefined && typeof action !== 'string') {
    throw new Error(`${path}.action must be a string.`);
  }
  if (kindValue !== undefined && kindValue !== 'agent' && kindValue !== 'action') {
    throw new Error(`${path}.kind must be either 'agent' or 'action'.`);
  }
  if (agent && action) {
    throw new Error(`${path} cannot define both agent and action.`);
  }
  const kind: DagTaskKind | undefined = kindValue ?? (action ? 'action' : agent ? 'agent' : undefined);
  if (!kind) {
    throw new Error(`${path} must define either agent or action.`);
  }
  if (kind === 'agent' && !agent) {
    throw new Error(`${path} kind is 'agent' but agent is missing.`);
  }
  if (kind === 'action' && !action) {
    throw new Error(`${path} kind is 'action' but action is missing.`);
  }
  const taskConfig: DagTaskConfig = {
    name,
    depends_on: dependsOn,
    kind,
    prompt,
    agent,
    action,
  };
  return taskConfig;
};

const parseYamlContent = (yamlContent: string): unknown => {
  const parser = parseYaml as (content: string) => unknown;
  return parser(yamlContent);
};

export const parseDagConfig = (yamlContent: string): DagConfig => {
  const parsed = parseYamlContent(yamlContent);
  if (!isRecord(parsed)) {
    throw new Error('DAG config must be a YAML mapping.');
  }
  const nodesValue = parsed.nodes;
  if (!Array.isArray(nodesValue)) {
    throw new Error('DAG config must include a nodes list.');
  }
  const nodes = nodesValue.map((nodeValue, index) =>
    parseNode(nodeValue, `nodes[${index}]`),
  );
  const nodeNames = nodes.map(node => node.name);
  const duplicateName = nodeNames.find(
    (nodeName, index) => nodeNames.indexOf(nodeName) !== index,
  );
  if (duplicateName) {
    throw new Error(`nodes contains duplicate node name '${duplicateName}'.`);
  }
  const version = parsed.version;
  if (version !== undefined && typeof version !== 'number') {
    throw new Error('DAG config version must be a number when provided.');
  }
  return {
    version,
    nodes,
  };
};
