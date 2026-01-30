import { DagExecutor } from '../dag-executor.js';
import type { DagNodeHandler } from '../dag-executor.js';
import type { DagConfig } from '../dag-models.js';

describe('DagExecutor', () => {
  it('executes tasks in dependency order and renders templates', async () => {
    const config: DagConfig = {
      nodes: [
        {
          name: 'implement',
          prompt: 'Implement {{step.title}}',
          agent: 'claude',
        },
        {
          name: 'review',
          depends_on: ['implement'],
          agent: 'codex',
        },
      ],
    };

    const seen: string[] = [];
    const handler: DagNodeHandler = (node, context) => {
      seen.push(node.name);
      return Promise.resolve({
        status: 'success',
        output: node.resolvedPrompt ?? context.locals.step,
      });
    };

    const executor = new DagExecutor(config, {
      handlers: { claude: handler, codex: handler },
    });

    const result = await executor.run({ step: { title: 'Feature' } });

    expect(result.status).toBe('success');
    expect(seen).toEqual(['implement', 'review']);
    expect(result.results.get('implement')?.output).toBe('Implement Feature');
  });

  it('runs for_each groups', async () => {
    const config: DagConfig = {
      nodes: [
        {
          name: 'plan-loop',
          for_each: { var: 'step', in: 'plan.steps' },
          nodes: [
            {
              name: 'implement',
              prompt: 'Implement {{step.title}}',
              agent: 'claude',
            },
          ],
        },
      ],
    };

    const outputs: string[] = [];
    const handler: DagNodeHandler = node => {
      outputs.push(node.resolvedPrompt ?? '');
      return Promise.resolve({ status: 'success', output: node.resolvedPrompt });
    };

    const executor = new DagExecutor(config, { handlers: { claude: handler } });
    await executor.run({ plan: { steps: [{ title: 'A' }, { title: 'B' }] } });

    expect(outputs).toEqual(['Implement A', 'Implement B']);
  });

  it('runs repeat_until groups until condition output is truthy', async () => {
    const config: DagConfig = {
      nodes: [
        {
          name: 'build-loop',
          repeat_until: { condition: 'build_green', max_iterations: 3 },
          nodes: [
            {
              name: 'build_green',
              agent: 'github',
            },
          ],
        },
      ],
    };

    let attempt = 0;
    const handler: DagNodeHandler = () => {
      attempt += 1;
      return Promise.resolve({ status: 'success', output: attempt >= 2 });
    };

    const executor = new DagExecutor(config, { handlers: { github: handler } });
    const result = await executor.run({});

    expect(result.status).toBe('success');
    expect(attempt).toBe(2);
  });
});
