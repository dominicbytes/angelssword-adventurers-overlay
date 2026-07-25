const test = require('node:test');
const assert = require('node:assert/strict');

const { createHandGestureTriggers } = require('../control');

function gesture(name, score = 0.9) {
  return { gestures: [[{ categoryName: name, score }]] };
}

test('invokes mapped press and release actions on cooled gesture edges', async () => {
  const invocations = [];
  let processor = null;
  let unregistered = false;
  const recognizer = {
    recognizeForVideo: (_video, timestamp) => ({ timestamp }),
    close() {}
  };
  const host = {
    registerTrackingProcessor(pluginId, definition) {
      assert.equal(pluginId, 'hand-gesture-triggers');
      processor = definition;
      return () => { unregistered = true; };
    },
    invokeAction(actionId, parameters) {
      invocations.push([actionId, parameters]);
      return Promise.resolve({ ok: true });
    }
  };
  const controller = createHandGestureTriggers(host, {
    recognizer,
    initialConfig: {
      schemaVersion: 1,
      enabled: true,
      confidence: 0.7,
      cooldownMs: 500,
      mappings: [{
        gesture: 'Thumb_Up',
        press: { actionId: 'state.set', parameters: { state: 'happy' } },
        release: { actionId: 'state.clear', parameters: {} }
      }]
    }
  });
  await controller.ready;

  assert.equal(processor.everyNFrames, 2);
  assert.deepEqual(processor.process({}, 42), { timestamp: 42 });
  processor.onResult(gesture('Thumb_Up'), 100);
  processor.onResult(gesture('Thumb_Up'), 200);
  processor.onResult({ gestures: [] }, 250);
  processor.onResult(gesture('Thumb_Up'), 300);
  processor.onResult({ gestures: [] }, 350);
  processor.onResult(gesture('Thumb_Up'), 700);

  assert.deepEqual(invocations, [
    ['state.set', { state: 'happy' }],
    ['state.clear', {}],
    ['state.set', { state: 'happy' }]
  ]);
  controller.destroy();
  assert.equal(unregistered, true);
});

test('persists only unique valid mappings and releases active state on update', async () => {
  const invocations = [];
  let processor = null;
  let persisted = null;
  const mapping = {
    gesture: 'Open_Palm',
    press: { actionId: 'state.set', parameters: { state: 'surprised' } },
    release: { actionId: 'state.clear', parameters: {} }
  };
  const host = {
    registerTrackingProcessor(_pluginId, definition) {
      processor = definition;
      return () => {};
    },
    invokeAction(actionId, parameters) {
      invocations.push([actionId, parameters]);
      return Promise.resolve({ ok: true });
    }
  };
  const controller = createHandGestureTriggers(host, {
    recognizer: { recognizeForVideo() {}, close() {} },
    initialConfig: {
      schemaVersion: 1,
      enabled: true,
      confidence: 0.75,
      cooldownMs: 600,
      mappings: [mapping]
    },
    storage: {
      getItem: () => null,
      setItem: (_key, value) => { persisted = value; }
    }
  });
  await controller.ready;
  processor.onResult(gesture('Open_Palm'), 100);

  assert.deepEqual(controller.update({
    schemaVersion: 1,
    enabled: true,
    confidence: 0.75,
    cooldownMs: 600,
    mappings: [mapping, mapping]
  }), { ok: false, error: 'duplicate_gesture', gesture: 'Open_Palm' });
  assert.equal(persisted, null);

  const disabled = {
    schemaVersion: 1,
    enabled: false,
    confidence: 0.8,
    cooldownMs: 800,
    mappings: [mapping]
  };
  assert.deepEqual(controller.update(disabled), { ok: true });
  assert.deepEqual(JSON.parse(persisted), disabled);
  assert.deepEqual(controller.getConfig(), disabled);
  assert.deepEqual(invocations, [
    ['state.set', { state: 'surprised' }],
    ['state.clear', {}]
  ]);
  controller.destroy();
});

test('takes a snapshot of action parameters during configuration updates', async () => {
  const source = {
    schemaVersion: 1,
    enabled: true,
    confidence: 0.8,
    cooldownMs: 500,
    mappings: [{
      gesture: 'Victory',
      press: { actionId: 'state.set', parameters: { state: 'happy' } },
      release: null
    }]
  };
  const controller = createHandGestureTriggers({
    registerTrackingProcessor() { return () => {}; },
    invokeAction() { return Promise.resolve({ ok: true }); }
  }, {
    recognizer: { recognizeForVideo() {}, close() {} }
  });
  await controller.ready;

  assert.deepEqual(controller.update(source), { ok: true });
  source.mappings[0].press.parameters.state = 'angry';

  assert.equal(controller.getConfig().mappings[0].press.parameters.state, 'happy');
  controller.destroy();
});

test('closes the recognizer when shared processor registration is unavailable', async () => {
  let closed = false;
  const controller = createHandGestureTriggers({
    registerTrackingProcessor() { return null; },
    invokeAction() { return Promise.resolve({ ok: true }); }
  }, {
    recognizer: {
      recognizeForVideo() {},
      close() { closed = true; }
    }
  });

  await assert.rejects(controller.ready, /registration is unavailable/);
  assert.equal(closed, true);
  controller.destroy();
});
