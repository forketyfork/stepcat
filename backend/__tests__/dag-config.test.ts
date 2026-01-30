import { parseDagConfig } from '../dag-config.js';

describe('parseDagConfig', () => {
  it('parses a task-only DAG', () => {
    const config = parseDagConfig(`
version: 1
nodes:
  - name: implement
    prompt: "Do the work"
    agent: claude
  - name: review
    depends_on: [implement]
    agent: codex
`);

    expect(config.version).toBe(1);
    expect(config.nodes).toHaveLength(2);
    expect(config.nodes[0]).toMatchObject({
      name: 'implement',
      prompt: 'Do the work',
      agent: 'claude',
    });
  });

  it('parses for_each and repeat_until groups', () => {
    const config = parseDagConfig(`
nodes:
  - name: iterate-steps
    for_each:
      var: step
      in: plan.steps
    nodes:
      - name: implement
        prompt: "Implement {{step.title}}"
  - name: build-loop
    repeat_until:
      condition: build_green
      max_iterations: 2
    nodes:
      - name: build_green
        agent: github
`);

    expect(config.nodes).toHaveLength(2);
    const forEachNode = config.nodes[0];
    const repeatNode = config.nodes[1];

    if ('nodes' in forEachNode) {
      expect(forEachNode.for_each).toEqual({ var: 'step', in: 'plan.steps' });
    } else {
      throw new Error('Expected for_each group.');
    }

    if ('nodes' in repeatNode) {
      expect(repeatNode.repeat_until).toEqual({ condition: 'build_green', max_iterations: 2 });
    } else {
      throw new Error('Expected repeat_until group.');
    }
  });
});
