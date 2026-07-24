const test = require('node:test');
const assert = require('node:assert/strict');

const { createUniversalInputMapper } = require('../control');

function createEventTarget() {
  const listeners = new Map();
  return {
    addEventListener(name, handler) {
      if (!listeners.has(name)) listeners.set(name, []);
      listeners.get(name).push(handler);
    },
    removeEventListener(name, handler) {
      listeners.set(name, (listeners.get(name) || []).filter(candidate => candidate !== handler));
    },
    dispatch(name, event) {
      for (const handler of listeners.get(name) || []) handler(event);
    }
  };
}

function createStorage(initialValue = null) {
  let value = initialValue;
  return {
    getItem: () => value,
    setItem: (_key, nextValue) => { value = nextValue; },
    read: () => value
  };
}

function key(code, overrides = {}) {
  return {
    code,
    repeat: false,
    target: { tagName: 'BODY' },
    preventDefault() {},
    ...overrides
  };
}

test('migrates one schema-v1 mapping and persists multiple schema-v2 mappings', () => {
  const storage = createStorage(JSON.stringify({
    schemaVersion: 1,
    enabled: true,
    mapping: { code: 'KeyH', actionId: 'state.set', parameters: { state: 'happy' } }
  }));
  const mapper = createUniversalInputMapper({ listActions: () => [], invokeAction() {} }, {
    eventTarget: createEventTarget(),
    storage
  });

  assert.deepEqual(mapper.getConfig(), {
    schemaVersion: 2,
    enabled: true,
    mappings: [{
      id: 'mapping-1',
      code: 'KeyH',
      context: 'global',
      mode: 'press',
      press: { actionId: 'state.set', parameters: { state: 'happy' } },
      release: null
    }]
  });

  const result = mapper.update({
    schemaVersion: 2,
    enabled: true,
    mappings: [
      mapper.getConfig().mappings[0],
      {
        id: 'mapping-2',
        code: 'KeyS',
        context: 'global',
        mode: 'press',
        press: { actionId: 'state.set', parameters: { state: 'sad' } },
        release: null
      }
    ]
  });

  assert.deepEqual(result, { ok: true });
  assert.equal(JSON.parse(storage.read()).mappings.length, 2);
  mapper.destroy();
});

test('rejects conflicting bindings without replacing persisted configuration', () => {
  const storage = createStorage();
  const mapper = createUniversalInputMapper({ listActions: () => [], invokeAction() {} }, {
    eventTarget: createEventTarget(),
    storage
  });
  const result = mapper.update({
    schemaVersion: 2,
    enabled: true,
    mappings: ['first', 'second'].map(id => ({
      id,
      code: 'KeyH',
      context: 'global',
      mode: 'press',
      press: { actionId: 'state.clear', parameters: {} },
      release: null
    }))
  });

  assert.deepEqual(result, {
    ok: false,
    error: 'mapping_conflict',
    conflicts: [{ code: 'KeyH', context: 'global', mappingIds: ['first', 'second'] }]
  });
  assert.equal(storage.read(), null);
  assert.deepEqual(mapper.getConfig().mappings, []);

  const wildcardResult = mapper.update({
    schemaVersion: 2,
    enabled: true,
    mappings: [
      {
        id: 'everywhere', code: 'KeyT', context: '*', mode: 'press',
        press: { actionId: 'state.clear', parameters: {} }, release: null
      },
      {
        id: 'global-only', code: 'KeyT', context: 'global', mode: 'press',
        press: { actionId: 'state.clear', parameters: {} }, release: null
      }
    ]
  });
  assert.deepEqual(wildcardResult, {
    ok: false,
    error: 'mapping_conflict',
    conflicts: [{ code: 'KeyT', context: '*', mappingIds: ['everywhere', 'global-only'] }]
  });

  const duplicateIdResult = mapper.update({
    schemaVersion: 2,
    enabled: true,
    mappings: ['KeyA', 'KeyB'].map(code => ({
      id: 'duplicate', code, context: 'global', mode: 'toggle',
      press: { actionId: 'state.clear', parameters: {} }, release: null
    }))
  });
  assert.deepEqual(duplicateIdResult, {
    ok: false,
    error: 'duplicate_mapping_id',
    mappingIds: ['duplicate']
  });
  mapper.destroy();
});

test('maps press, hold, and toggle keyboard edges to registered actions', () => {
  const eventTarget = createEventTarget();
  const invocations = [];
  const mapper = createUniversalInputMapper({
    listActions: () => [],
    invokeAction: (id, parameters) => invocations.push([id, parameters])
  }, {
    eventTarget,
    initialConfig: {
      schemaVersion: 2,
      enabled: true,
      mappings: [
        {
          id: 'press', code: 'KeyP', context: 'global', mode: 'press',
          press: { actionId: 'state.set', parameters: { state: 'happy' } }, release: null
        },
        {
          id: 'hold', code: 'KeyH', context: 'global', mode: 'hold',
          press: { actionId: 'state.set', parameters: { state: 'sad' } },
          release: { actionId: 'state.clear', parameters: {} }
        },
        {
          id: 'toggle', code: 'KeyT', context: 'global', mode: 'toggle',
          press: { actionId: 'state.set', parameters: { state: 'typing' } },
          release: { actionId: 'state.clear', parameters: {} }
        }
      ]
    }
  });

  eventTarget.dispatch('keydown', key('KeyP'));
  eventTarget.dispatch('keydown', key('KeyP', { repeat: true }));
  eventTarget.dispatch('keyup', key('KeyP'));
  eventTarget.dispatch('keydown', key('KeyP', { target: { tagName: 'INPUT' } }));
  eventTarget.dispatch('keydown', key('KeyH'));
  eventTarget.dispatch('keyup', key('KeyH'));
  eventTarget.dispatch('keydown', key('KeyT'));
  eventTarget.dispatch('keyup', key('KeyT'));
  eventTarget.dispatch('keydown', key('KeyT'));

  assert.deepEqual(invocations, [
    ['state.set', { state: 'happy' }],
    ['state.set', { state: 'sad' }],
    ['state.clear', {}],
    ['state.set', { state: 'typing' }],
    ['state.clear', {}]
  ]);
  mapper.destroy();
});

test('filters mappings by context and imports or exports through the public controller', () => {
  const eventTarget = createEventTarget();
  const storage = createStorage();
  const invocations = [];
  const mapper = createUniversalInputMapper({
    listActions: () => [],
    invokeAction: id => invocations.push(id)
  }, { eventTarget, storage });

  const imported = mapper.importConfig(JSON.stringify({
    schemaVersion: 2,
    enabled: true,
    mappings: [
      {
        id: 'chat', code: 'KeyC', context: 'chatting', mode: 'press',
        press: { actionId: 'state.clear', parameters: {} }, release: null
      },
      {
        id: 'game', code: 'KeyG', context: 'gaming', mode: 'press',
        press: { actionId: 'state.clear', parameters: {} }, release: null
      }
    ]
  }));

  assert.deepEqual(imported, { ok: true });
  assert.equal(JSON.parse(mapper.exportConfig()).mappings.length, 2);
  eventTarget.dispatch('keydown', key('KeyC'));
  eventTarget.dispatch('keyup', key('KeyC'));
  mapper.setContext('chatting');
  eventTarget.dispatch('keydown', key('KeyC'));
  eventTarget.dispatch('keyup', key('KeyC'));
  eventTarget.dispatch('keydown', key('KeyG'));
  eventTarget.dispatch('keyup', key('KeyG'));
  mapper.setContext('gaming');
  eventTarget.dispatch('keydown', key('KeyG'));
  assert.deepEqual(invocations, ['state.clear', 'state.clear']);
  assert.deepEqual(mapper.importConfig('{not json'), { ok: false, error: 'invalid_json' });
  mapper.destroy();
});

test('releases active hold and toggle actions when configuration changes', () => {
  const eventTarget = createEventTarget();
  const invocations = [];
  const mapper = createUniversalInputMapper({
    listActions: () => [],
    invokeAction: id => invocations.push(id)
  }, {
    eventTarget,
    initialConfig: {
      schemaVersion: 2,
      enabled: true,
      mappings: [
        {
          id: 'hold', code: 'KeyH', context: 'global', mode: 'hold',
          press: { actionId: 'state.set', parameters: { state: 'happy' } },
          release: { actionId: 'state.clear', parameters: {} }
        },
        {
          id: 'toggle', code: 'KeyT', context: 'global', mode: 'toggle',
          press: { actionId: 'state.set', parameters: { state: 'typing' } },
          release: { actionId: 'state.clear', parameters: {} }
        }
      ]
    }
  });

  eventTarget.dispatch('keydown', key('KeyH'));
  eventTarget.dispatch('keydown', key('KeyT'));
  mapper.update({ ...mapper.getConfig(), enabled: false });

  assert.deepEqual(invocations, ['state.set', 'state.set', 'state.clear', 'state.clear']);
  mapper.destroy();
});
