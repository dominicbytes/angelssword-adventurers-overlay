const test = require('node:test');
const assert = require('node:assert/strict');

const { createReactiveMotionOverlay } = require('../overlay');

function createHost() {
  const handlers = new Map();
  const calls = [];
  return {
    calls,
    on(name, handler) {
      handlers.set(name, handler);
      return () => handlers.delete(name);
    },
    emit(name, detail) {
      handlers.get(name)?.(detail);
    },
    setMotionContribution(id, value) {
      calls.push(['set', id, value]);
    },
    clearMotionContribution(id) {
      calls.push(['clear', id]);
    }
  };
}

test('turns replayed configuration and audio level into bounded motion', () => {
  const host = createHost();
  let frame;
  const controller = createReactiveMotionOverlay(host, {
    requestFrame: callback => { frame = callback; return 1; },
    cancelFrame: () => { frame = null; }
  });

  host.emit('plugin-event', {
    pluginId: 'reactive-motion',
    event: 'state',
    data: { enabled: true, preset: 'bouncy', intensity: 0.5, level: 1 }
  });
  frame(250);

  const contribution = host.calls.at(-1);
  assert.equal(contribution[0], 'set');
  assert.equal(contribution[1], 'reactive-motion');
  assert.ok(contribution[2].scale > 1 && contribution[2].scale <= 1.08);
  assert.ok(contribution[2].y >= -12 && contribution[2].y <= 12);

  controller.destroy();
  assert.deepEqual(host.calls.at(-1), ['clear', 'reactive-motion']);
});

test('disabling the plugin clears its motion contribution', () => {
  const host = createHost();
  createReactiveMotionOverlay(host, {
    requestFrame: () => 1,
    cancelFrame: () => {}
  });

  host.emit('plugin-event', {
    pluginId: 'reactive-motion',
    event: 'state',
    data: { enabled: false }
  });

  assert.deepEqual(host.calls.at(-1), ['clear', 'reactive-motion']);
});
