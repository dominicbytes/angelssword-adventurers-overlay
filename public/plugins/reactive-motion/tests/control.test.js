const test = require('node:test');
const assert = require('node:assert/strict');

const { createReactiveMotionControl } = require('../control');

function createHost() {
  const handlers = new Map();
  const messages = [];
  return {
    messages,
    on(name, handler) {
      handlers.set(name, handler);
      return () => handlers.delete(name);
    },
    emit(name, detail) { handlers.get(name)?.(detail); },
    sendPluginEvent(pluginId, event, data) {
      messages.push({ pluginId, event, data });
      return true;
    },
    isTransportOpen: () => false
  };
}

test('migrates legacy settings and replays validated state on reconnect', () => {
  const host = createHost();
  let persisted = null;
  const control = createReactiveMotionControl(host, {
    storage: {
      getItem: () => JSON.stringify({ enabled: true, preset: 'bouncy', intensity: 0.75 }),
      setItem: (_key, value) => { persisted = value; }
    },
    prefersReducedMotion: () => false
  });

  assert.deepEqual(control.getConfig(), {
    schemaVersion: 2,
    enabled: true,
    preset: 'bouncy',
    intensity: 0.75,
    reducedMotion: 'system'
  });
  assert.deepEqual(JSON.parse(persisted), control.getConfig());

  host.emit('transport-open');
  assert.deepEqual(host.messages.at(-1), {
    pluginId: 'reactive-motion',
    event: 'state',
    data: {
      schemaVersion: 2,
      enabled: true,
      preset: 'bouncy',
      intensity: 0.75,
      reduced: false,
      level: 0,
      preview: false
    }
  });
  control.destroy();
});

test('falls back from invalid persisted settings', () => {
  const host = createHost();
  const control = createReactiveMotionControl(host, {
    storage: {
      getItem: () => JSON.stringify({ schemaVersion: 2, enabled: true, preset: 'wild', intensity: 4 }),
      setItem() {}
    },
    prefersReducedMotion: () => false
  });

  assert.deepEqual(control.getConfig(), {
    schemaVersion: 2,
    enabled: false,
    preset: 'calm',
    intensity: 0.5,
    reducedMotion: 'system'
  });
  control.destroy();
});

test('does not overwrite settings from an unsupported future schema', () => {
  const host = createHost();
  let writes = 0;
  const control = createReactiveMotionControl(host, {
    storage: {
      getItem: () => JSON.stringify({
        schemaVersion: 3,
        enabled: true,
        preset: 'calm',
        intensity: 0.5,
        reducedMotion: 'system',
        futureOption: true
      }),
      setItem() { writes += 1; }
    },
    prefersReducedMotion: () => false
  });

  assert.equal(writes, 0);
  assert.equal(control.getConfig().enabled, false);
  control.destroy();
});

test('previews a saved preset temporarily without enabling it', () => {
  const host = createHost();
  let finishPreview;
  const control = createReactiveMotionControl(host, {
    storage: { getItem: () => null, setItem() {} },
    prefersReducedMotion: () => false,
    setTimer(callback) {
      finishPreview = callback;
      return 1;
    },
    clearTimer() {}
  });
  assert.deepEqual(control.update({
    schemaVersion: 2,
    enabled: false,
    preset: 'elastic',
    intensity: 0.8,
    reducedMotion: 'never'
  }), { ok: true });

  control.preview();
  assert.deepEqual(host.messages.at(-1).data, {
    schemaVersion: 2,
    enabled: false,
    preset: 'elastic',
    intensity: 0.8,
    reduced: false,
    level: 0.8,
    preview: true
  });
  finishPreview();
  assert.equal(host.messages.at(-1).data.preview, false);
  assert.equal(host.messages.at(-1).data.level, 0);
  control.destroy();
});

test('limits microphone state publication to twenty updates per second', () => {
  const host = createHost();
  const control = createReactiveMotionControl(host, {
    storage: {
      getItem: () => JSON.stringify({
        schemaVersion: 2,
        enabled: true,
        preset: 'calm',
        intensity: 0.5,
        reducedMotion: 'never'
      }),
      setItem() {}
    },
    prefersReducedMotion: () => false
  });

  host.emit('audio-level', { timestamp: 100, value: 0.2 });
  host.emit('audio-level', { timestamp: 120, value: 0.8 });
  host.emit('audio-level', { timestamp: 150, value: 0.4 });

  assert.deepEqual(host.messages.map(message => message.data.level), [0.2, 0.4]);
  control.destroy();
});

test('publishes system reduced-motion changes immediately while idle', () => {
  const host = createHost();
  let reduced = false;
  let changed;
  let unsubscribed = false;
  const control = createReactiveMotionControl(host, {
    storage: {
      getItem: () => JSON.stringify({
        schemaVersion: 2,
        enabled: true,
        preset: 'calm',
        intensity: 0.5,
        reducedMotion: 'system'
      }),
      setItem() {}
    },
    prefersReducedMotion: () => reduced,
    subscribeReducedMotion(handler) {
      changed = handler;
      return () => { unsubscribed = true; };
    }
  });

  reduced = true;
  changed();
  assert.equal(host.messages.at(-1).data.reduced, true);
  control.destroy();
  assert.equal(unsubscribed, true);
});
