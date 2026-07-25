const test = require('node:test');
const assert = require('node:assert/strict');

const { createGazeHeadParallaxOverlay } = require('../overlay');

function createHost() {
  const handlers = new Map();
  const calls = [];
  return {
    calls,
    on(name, handler) {
      handlers.set(name, handler);
      return () => handlers.delete(name);
    },
    emit(name, value) {
      handlers.get(name)?.(value);
    },
    setMotionContribution(pluginId, contribution) {
      calls.push(['set', pluginId, contribution]);
    },
    clearMotionContribution(pluginId) {
      calls.push(['clear', pluginId]);
    }
  };
}

test('smooths gaze motion and decays toward neutral when tracking stops', () => {
  const host = createHost();
  let frame = null;
  let now = 0;
  const controller = createGazeHeadParallaxOverlay(host, {
    now: () => now,
    requestFrame(callback) {
      frame = callback;
      return 1;
    },
    cancelFrame() {
      frame = null;
    }
  });

  host.emit('plugin-event', {
    pluginId: 'gaze-head-parallax',
    event: 'state',
    data: {
      enabled: true,
      smoothing: 0.5,
      target: { x: 20, y: -10, rotate: 4 }
    }
  });
  frame();
  assert.deepEqual(host.calls.at(-1), [
    'set',
    'gaze-head-parallax',
    { x: 10, y: -5, rotate: 2 }
  ]);

  now = 400;
  frame();
  assert.deepEqual(host.calls.at(-1), [
    'set',
    'gaze-head-parallax',
    { x: 5, y: -2.5, rotate: 1 }
  ]);

  controller.destroy();
  assert.deepEqual(host.calls.at(-1), ['clear', 'gaze-head-parallax']);
});

test('stops the frame loop at stale neutral and restarts for new tracking', () => {
  const host = createHost();
  let scheduled = null;
  let now = 0;
  createGazeHeadParallaxOverlay(host, {
    now: () => now,
    requestFrame(callback) {
      scheduled = () => {
        scheduled = null;
        callback();
      };
      return 1;
    },
    cancelFrame() {
      scheduled = null;
    }
  });
  const state = {
    pluginId: 'gaze-head-parallax',
    event: 'state',
    data: { enabled: true, smoothing: 1, target: { x: 12, y: 0, rotate: 0 } }
  };

  host.emit('plugin-event', state);
  scheduled();
  now = 400;
  scheduled();
  assert.equal(scheduled, null);
  assert.deepEqual(host.calls.at(-1), ['clear', 'gaze-head-parallax']);

  now = 450;
  host.emit('plugin-event', state);
  assert.equal(typeof scheduled, 'function');
});
