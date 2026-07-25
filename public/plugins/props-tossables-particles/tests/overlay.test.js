const test = require('node:test');
const assert = require('node:assert/strict');

const { effectFrame } = require('../overlay');

test('calculates bounded toss and particle motion through cleanup time', () => {
  const toss = { kind: 'tossable', startedAt: 1000, durationMs: 2000 };
  assert.deepEqual(effectFrame(toss, 1000), {
    x: 8, y: 72, rotate: 0, scale: 1, opacity: 1
  });
  const apex = effectFrame(toss, 2000);
  assert.equal(apex.x, 50);
  assert.equal(apex.y, 14);
  assert.equal(effectFrame(toss, 3000).opacity, 0);

  const particle = effectFrame({ kind: 'particle', seed: 5, startedAt: 0, durationMs: 1000 }, 500);
  assert.ok(particle.x >= 0 && particle.x <= 100);
  assert.ok(particle.y >= 0 && particle.y <= 100);
  assert.equal(particle.opacity, 0.5);
});

test('keeps held props stationary', () => {
  const item = { kind: 'prop', startedAt: 0, durationMs: 0 };
  assert.deepEqual(effectFrame(item, 0), effectFrame(item, 100000));
});
