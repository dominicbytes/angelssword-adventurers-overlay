const test = require('node:test');
const assert = require('node:assert/strict');

const { createPropsEffectsControl } = require('../control');

test('registers effect actions and publishes reconnect-safe snapshots', async () => {
  const actions = new Map();
  const messages = [];
  const listeners = new Map();
  let now = 1000;
  const host = {
    registerAction(id, definition) {
      actions.set(id, definition);
      return () => actions.delete(id);
    },
    sendPluginEvent(pluginId, event, data) {
      messages.push({ pluginId, event, data });
      return true;
    },
    on(name, handler) {
      listeners.set(name, handler);
      return () => listeners.delete(name);
    },
    isTransportOpen: () => false
  };
  const control = createPropsEffectsControl(host, {
    now: () => now,
    setTimer: () => 1,
    clearTimer() {}
  });

  assert.deepEqual([...actions], [
    ['effects.spawn', actions.get('effects.spawn')],
    ['effects.hold', actions.get('effects.hold')],
    ['effects.release', actions.get('effects.release')],
    ['effects.clear', actions.get('effects.clear')]
  ]);
  assert.deepEqual(await actions.get('effects.spawn').invoke({ preset: 'toss-star' }), {
    ok: true,
    id: 'effect-1'
  });
  await actions.get('effects.hold').invoke({ preset: 'held-star' });

  assert.equal(messages.at(-1).event, 'snapshot');
  assert.deepEqual(messages.at(-1).data.items.map(item => [item.id, item.preset, item.kind]), [
    ['effect-1', 'toss-star', 'tossable'],
    ['effect-2', 'held-star', 'prop']
  ]);

  listeners.get('transport-open')();
  assert.deepEqual(messages.at(-1).data.items.map(item => item.id), ['effect-1', 'effect-2']);

  now = 1200;
  await actions.get('effects.release').invoke({ preset: 'held-star' });
  assert.deepEqual(messages.at(-1).data.items.map(item => item.id), ['effect-1']);
  await actions.get('effects.clear').invoke({});
  assert.deepEqual(messages.at(-1).data.items, []);

  control.destroy();
  assert.equal(actions.size, 0);
});

test('rejects unknown presets and caps active effects', async () => {
  const actions = new Map();
  const host = {
    registerAction(id, definition) {
      actions.set(id, definition);
      return () => {};
    },
    sendPluginEvent() { return true; },
    on() { return () => {}; },
    isTransportOpen: () => false
  };
  const control = createPropsEffectsControl(host, {
    now: () => 1000,
    maxActive: 2,
    setTimer: () => 1,
    clearTimer() {}
  });

  assert.deepEqual(await actions.get('effects.spawn').invoke({ preset: 'unknown' }), {
    ok: false,
    error: 'unknown_preset'
  });
  await actions.get('effects.spawn').invoke({ preset: 'confetti' });
  await actions.get('effects.spawn').invoke({ preset: 'toss-star' });
  assert.deepEqual(await actions.get('effects.spawn').invoke({ preset: 'confetti' }), {
    ok: false,
    error: 'effect_limit'
  });
  control.destroy();
});

test('publishes timer cleanup and clears held effects on destroy', async () => {
  const actions = new Map();
  const messages = [];
  const timers = [];
  const host = {
    registerAction(id, definition) {
      actions.set(id, definition);
      return () => actions.delete(id);
    },
    sendPluginEvent(_pluginId, _event, data) {
      messages.push(data);
      return true;
    },
    on() { return () => {}; },
    isTransportOpen: () => true
  };
  const control = createPropsEffectsControl(host, {
    now: () => 1000,
    setTimer(callback) {
      timers.push(callback);
      return timers.length;
    },
    clearTimer() {}
  });

  await actions.get('effects.spawn').invoke({ preset: 'confetti' });
  timers[0]();
  assert.deepEqual(messages.at(-1).items, []);

  await actions.get('effects.hold').invoke({ preset: 'held-star' });
  control.destroy();
  assert.deepEqual(messages.at(-1).items, []);
});
