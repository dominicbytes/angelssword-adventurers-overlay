const test = require('node:test');
const assert = require('node:assert/strict');

const { createMotionCompositor } = require('../public/motion-compositor');

test('composes independent plugin motion without replacing the base transform', () => {
  const target = { style: { transform: 'translateX(-50%)' } };
  const motion = createMotionCompositor(target);

  motion.set('reactive-motion', { y: -4, scale: 1.03 });
  motion.set('head-parallax', { x: 6, y: 2, rotate: 3 });

  assert.equal(
    target.style.transform,
    'translateX(-50%) translate3d(6px, -2px, 0) rotate(3deg) scale(1.03)'
  );
});

test('clamps contributions and restores the base transform after cleanup', () => {
  const target = { style: { transform: '' } };
  const motion = createMotionCompositor(target);

  motion.set('unsafe', { x: 1000, y: -1000, rotate: 90, scale: 10 });
  assert.equal(
    target.style.transform,
    'translate3d(100px, -100px, 0) rotate(30deg) scale(2)'
  );

  motion.clear('unsafe');
  assert.equal(target.style.transform, '');
});

