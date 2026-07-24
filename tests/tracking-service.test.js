const test = require('node:test');
const assert = require('node:assert/strict');

const { createTrackingService } = require('../public/tracking-service');

function createFrameClock() {
  let callback = null;
  let requested = 0;

  return {
    requestFrame(next) {
      requested += 1;
      callback = next;
      return requested;
    },
    cancelFrame() {
      callback = null;
    },
    async step(time) {
      const next = callback;
      callback = null;
      assert.ok(next, 'a shared frame should be scheduled');
      next(time);
      await Promise.resolve();
    },
    get requested() {
      return requested;
    }
  };
}

test('runs multiple tracking processors from one shared frame scheduler', async () => {
  const clock = createFrameClock();
  const service = createTrackingService({
    requestFrame: callback => clock.requestFrame(callback),
    cancelFrame: handle => clock.cancelFrame(handle)
  });
  const video = { readyState: 2 };
  const faceTimes = [];
  const handTimes = [];

  service.registerProcessor('face', {
    process: (_source, time) => faceTimes.push(time)
  });
  service.registerProcessor('hands', {
    everyNFrames: 2,
    process: (_source, time) => handTimes.push(time)
  });

  service.start(video);
  await clock.step(10);
  await clock.step(20);
  await clock.step(30);

  assert.deepEqual(faceTimes, [10, 20, 30]);
  assert.deepEqual(handTimes, [20]);
  assert.equal(clock.requested, 4, 'only one next frame is requested per tick');

  service.stop();
  assert.deepEqual(service.getDiagnostics(), {
    running: false,
    frameNumber: 3,
    processorCount: 2,
    sourceAttached: false
  });
});

test('skips a busy processor instead of building an inference queue', async () => {
  const clock = createFrameClock();
  const service = createTrackingService({
    requestFrame: callback => clock.requestFrame(callback),
    cancelFrame: handle => clock.cancelFrame(handle)
  });
  let resolveInference;
  let calls = 0;

  service.registerProcessor('slow', {
    process() {
      calls += 1;
      return new Promise(resolve => { resolveInference = resolve; });
    }
  });

  service.start({ readyState: 2 });
  await clock.step(10);
  await clock.step(20);
  assert.equal(calls, 1);

  resolveInference();
  await new Promise(resolve => setImmediate(resolve));
  await clock.step(30);
  assert.equal(calls, 2);
});
