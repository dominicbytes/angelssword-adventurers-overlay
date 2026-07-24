const test = require('node:test');
const assert = require('node:assert/strict');

const { createRuleGraphSequencer } = require('../control');

function graph(overrides = {}) {
  return {
    id: 'scene-start',
    name: 'Scene start',
    enabled: true,
    nodes: [
      { id: 'a', actionId: 'state.set', parameters: { state: 'happy' }, delayMs: 0 },
      { id: 'b', actionId: 'state.clear', parameters: {}, delayMs: 0 }
    ],
    edges: [{ from: 'a', to: 'b' }],
    ...overrides
  };
}

test('rejects cyclic graphs without replacing persisted configuration', () => {
  let persisted = null;
  const sequencer = createRuleGraphSequencer({ invokeAction() {} }, {
    storage: { getItem: () => null, setItem: (_key, value) => { persisted = value; } }
  });

  const result = sequencer.update({
    schemaVersion: 1,
    graphs: [graph({ edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }] })]
  });

  assert.deepEqual(result, {
    ok: false,
    error: 'cycle_detected',
    graphId: 'scene-start',
    nodeIds: ['a', 'b']
  });
  assert.equal(persisted, null);
  assert.deepEqual(sequencer.getConfig(), { schemaVersion: 1, graphs: [] });

  assert.deepEqual(sequencer.update({
    schemaVersion: 1,
    graphs: [graph({ enabled: 'yes' })]
  }), {
    ok: false,
    error: 'invalid_graph_enabled',
    graphId: 'scene-start'
  });
});

test('executes a valid action chain in deterministic dependency order', async () => {
  const invocations = [];
  const delays = [];
  const sequencer = createRuleGraphSequencer({
    invokeAction: async (actionId, parameters) => {
      invocations.push([actionId, parameters]);
      return { ok: true };
    }
  }, {
    wait: async milliseconds => { delays.push(milliseconds); },
    initialConfig: {
      schemaVersion: 1,
      graphs: [graph({
        nodes: [
          { id: 'c', actionId: 'state.set', parameters: { state: 'sad' }, delayMs: 25 },
          { id: 'a', actionId: 'state.set', parameters: { state: 'happy' }, delayMs: 0 },
          { id: 'b', actionId: 'state.clear', parameters: {}, delayMs: 10 }
        ],
        edges: [{ from: 'b', to: 'c' }, { from: 'a', to: 'c' }]
      })]
    }
  });

  const result = await sequencer.execute('scene-start');

  assert.deepEqual(invocations, [
    ['state.set', { state: 'happy' }],
    ['state.clear', {}],
    ['state.set', { state: 'sad' }]
  ]);
  assert.deepEqual(delays, [10, 25]);
  assert.deepEqual(result, {
    ok: true,
    graphId: 'scene-start',
    nodeIds: ['a', 'b', 'c']
  });
});

test('prevents concurrent runs of the same graph', async () => {
  let releaseDelay;
  const sequencer = createRuleGraphSequencer({
    invokeAction: async () => ({ ok: true })
  }, {
    wait: () => new Promise(resolve => { releaseDelay = resolve; }),
    initialConfig: {
      schemaVersion: 1,
      graphs: [graph({
        nodes: [{ id: 'a', actionId: 'state.clear', parameters: {}, delayMs: 1 }],
        edges: []
      })]
    }
  });

  const firstRun = sequencer.execute('scene-start');
  await Promise.resolve();
  assert.deepEqual(await sequencer.execute('scene-start'), {
    ok: false,
    error: 'graph_running',
    graphId: 'scene-start'
  });
  releaseDelay();
  assert.equal((await firstRun).ok, true);
});
