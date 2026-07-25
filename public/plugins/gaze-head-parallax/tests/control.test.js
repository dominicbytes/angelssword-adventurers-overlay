const test = require('node:test');
const assert = require('node:assert/strict');

const { createGazeHeadParallaxControl } = require('../control');

function createHost() {
  const handlers = new Map();
  const messages = [];
  return {
    messages,
    on(name, handler) {
      handlers.set(name, handler);
      return () => handlers.delete(name);
    },
    emit(name, value) {
      handlers.get(name)?.(value);
    },
    sendPluginEvent(pluginId, event, data) {
      messages.push({ pluginId, event, data });
      return true;
    },
    isTransportOpen() {
      return true;
    }
  };
}

function faceFrame({ offsetX = 0, irisOffsetX = 0, timestamp = 100 } = {}) {
  const landmarks = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  const set = (index, x, y) => { landmarks[index] = { x: x + offsetX, y, z: 0 }; };
  set(10, 0.5, 0.2);
  set(152, 0.5, 0.8);
  set(234, 0.3, 0.5);
  set(454, 0.7, 0.5);
  set(1, 0.5, 0.5);
  set(33, 0.38, 0.42);
  set(133, 0.46, 0.42);
  set(159, 0.42, 0.40);
  set(145, 0.42, 0.44);
  set(468, 0.42 + irisOffsetX, 0.42);
  set(362, 0.54, 0.42);
  set(263, 0.62, 0.42);
  set(386, 0.58, 0.40);
  set(374, 0.58, 0.44);
  set(473, 0.58 + irisOffsetX, 0.42);
  return { timestamp, faceDetected: true, blendShapes: {}, landmarks };
}

test('calibrates a neutral face and publishes bounded head and gaze movement', () => {
  const host = createHost();
  const controller = createGazeHeadParallaxControl(host, {
    initialConfig: {
      schemaVersion: 1,
      enabled: true,
      headStrength: 0.75,
      gazeStrength: 0.25,
      maxX: 24,
      maxY: 16,
      maxRotate: 5,
      smoothing: 0.2,
      invertX: false,
      invertY: false,
      calibration: null
    }
  });

  host.emit('tracking-frame', faceFrame());
  assert.deepEqual(controller.calibrate(), { ok: true });
  host.emit('tracking-frame', faceFrame({ offsetX: 0.04, irisOffsetX: 0.02, timestamp: 150 }));

  const message = host.messages.at(-1);
  assert.equal(message.pluginId, 'gaze-head-parallax');
  assert.equal(message.event, 'state');
  assert.equal(message.data.enabled, true);
  assert.ok(message.data.target.x > 0 && message.data.target.x <= 24);
  assert.ok(Math.abs(message.data.target.y) <= 16);
  assert.ok(Math.abs(message.data.target.rotate) <= 5);
  controller.destroy();
});

test('persists only validated settings and an explicit face calibration', () => {
  const host = createHost();
  let persisted = null;
  const controller = createGazeHeadParallaxControl(host, {
    storage: {
      getItem: () => null,
      setItem: (_key, value) => { persisted = value; }
    }
  });
  const valid = {
    schemaVersion: 1,
    enabled: true,
    headStrength: 0.8,
    gazeStrength: 0.2,
    maxX: 20,
    maxY: 12,
    maxRotate: 4,
    smoothing: 0.25,
    invertX: false,
    invertY: true,
    calibration: null
  };

  assert.deepEqual(
    controller.update({ ...valid, maxX: 100 }),
    { ok: false, error: 'invalid_max_x' }
  );
  assert.equal(persisted, null);
  assert.deepEqual(controller.update(valid), { ok: true });
  assert.deepEqual(JSON.parse(persisted), valid);

  host.emit('tracking-frame', faceFrame());
  assert.deepEqual(controller.calibrate(), { ok: true });
  const calibrated = JSON.parse(persisted);
  assert.equal(calibrated.calibration.headX, 0.5);
  assert.equal(calibrated.calibration.headY, 0.5);
  assert.deepEqual(controller.getConfig(), calibrated);
  controller.destroy();
});

test('throttles steady tracking but publishes face-loss edges immediately', () => {
  const host = createHost();
  const controller = createGazeHeadParallaxControl(host, {
    initialConfig: {
      schemaVersion: 1,
      enabled: true,
      headStrength: 0.75,
      gazeStrength: 0.25,
      maxX: 24,
      maxY: 16,
      maxRotate: 5,
      smoothing: 0.2,
      invertX: false,
      invertY: false,
      calibration: null
    }
  });

  host.emit('tracking-frame', faceFrame({ timestamp: 100 }));
  const afterFirstFrame = host.messages.length;
  host.emit('tracking-frame', faceFrame({ timestamp: 110, offsetX: 0.02 }));
  assert.equal(host.messages.length, afterFirstFrame);
  host.emit('tracking-frame', faceFrame({ timestamp: 150, offsetX: 0.02 }));
  assert.equal(host.messages.length, afterFirstFrame + 1);

  host.emit('tracking-frame', {
    timestamp: 151,
    faceDetected: false,
    blendShapes: {},
    landmarks: null
  });
  assert.deepEqual(host.messages.at(-1).data.target, { x: 0, y: 0, rotate: 0 });
  controller.destroy();
});

test('replays neutral configuration when the control transport reconnects', () => {
  const host = createHost();
  const controller = createGazeHeadParallaxControl(host, {
    initialConfig: {
      schemaVersion: 1,
      enabled: false,
      headStrength: 0.75,
      gazeStrength: 0.25,
      maxX: 24,
      maxY: 16,
      maxRotate: 5,
      smoothing: 0.2,
      invertX: false,
      invertY: false,
      calibration: null
    }
  });

  assert.equal(host.messages.length, 1);
  assert.equal(host.messages[0].data.enabled, false);
  assert.deepEqual(host.messages[0].data.target, { x: 0, y: 0, rotate: 0 });
  host.emit('transport-open');
  assert.equal(host.messages.length, 2);
  assert.equal(host.messages[1].data.enabled, false);
  controller.destroy();
});

test('cannot calibrate or reanimate from stale data after face loss', () => {
  const host = createHost();
  const controller = createGazeHeadParallaxControl(host, {
    initialConfig: {
      schemaVersion: 1,
      enabled: true,
      headStrength: 0.75,
      gazeStrength: 0.25,
      maxX: 24,
      maxY: 16,
      maxRotate: 5,
      smoothing: 0.2,
      invertX: false,
      invertY: false,
      calibration: null
    }
  });

  host.emit('tracking-frame', faceFrame({ timestamp: 100 }));
  controller.calibrate();
  host.emit('tracking-frame', faceFrame({ timestamp: 150, offsetX: 0.04 }));
  assert.ok(host.messages.at(-1).data.target.x > 0);
  host.emit('tracking-frame', { timestamp: 151, faceDetected: false, landmarks: null });

  assert.deepEqual(controller.calibrate(), { ok: false, error: 'face_unavailable' });
  const nextConfig = controller.getConfig();
  nextConfig.headStrength = 0.5;
  assert.deepEqual(controller.update(nextConfig), { ok: true });
  assert.deepEqual(host.messages.at(-1).data.target, { x: 0, y: 0, rotate: 0 });
  controller.destroy();
});

test('treats an unmeasurable landmark frame as immediate tracking loss', () => {
  const host = createHost();
  const controller = createGazeHeadParallaxControl(host, {
    initialConfig: {
      schemaVersion: 1,
      enabled: true,
      headStrength: 0.75,
      gazeStrength: 0.25,
      maxX: 24,
      maxY: 16,
      maxRotate: 5,
      smoothing: 0.2,
      invertX: false,
      invertY: false,
      calibration: null
    }
  });

  host.emit('tracking-frame', faceFrame({ timestamp: 100 }));
  host.emit('tracking-frame', { timestamp: 150, faceDetected: true, landmarks: [] });
  assert.deepEqual(host.messages.at(-1).data.target, { x: 0, y: 0, rotate: 0 });
  assert.deepEqual(controller.calibrate(), { ok: false, error: 'face_unavailable' });
  controller.destroy();
});
