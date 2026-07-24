(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = { createMotionCompositor: factory };
  }
  if (root) root.ASAMotionCompositor = { create: factory };
})(typeof window !== 'undefined' ? window : null, function createMotionCompositor(target) {
  'use strict';

  if (!target || !target.style) throw new TypeError('Motion compositor requires a styled target');

  const baseTransform = target.style.transform || '';
  const contributions = new Map();

  function clamp(value, min, max, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
  }

  function format(value) {
    return String(Math.round(value * 10000) / 10000);
  }

  function render() {
    if (contributions.size === 0) {
      target.style.transform = baseTransform;
      return;
    }

    let x = 0;
    let y = 0;
    let rotate = 0;
    let scale = 1;
    for (const contribution of contributions.values()) {
      x += contribution.x;
      y += contribution.y;
      rotate += contribution.rotate;
      scale *= contribution.scale;
    }

    x = clamp(x, -100, 100, 0);
    y = clamp(y, -100, 100, 0);
    rotate = clamp(rotate, -30, 30, 0);
    scale = clamp(scale, 0.5, 2, 1);

    const motion = `translate3d(${format(x)}px, ${format(y)}px, 0) rotate(${format(rotate)}deg) scale(${format(scale)})`;
    target.style.transform = baseTransform ? `${baseTransform} ${motion}` : motion;
  }

  return Object.freeze({
    set(ownerId, contribution) {
      if (typeof ownerId !== 'string' || !ownerId) throw new TypeError('Motion owner ID is required');
      const value = contribution || {};
      contributions.set(ownerId, {
        x: clamp(value.x, -100, 100, 0),
        y: clamp(value.y, -100, 100, 0),
        rotate: clamp(value.rotate, -30, 30, 0),
        scale: clamp(value.scale, 0.5, 2, 1)
      });
      render();
    },

    clear(ownerId) {
      contributions.delete(ownerId);
      render();
    },

    clearAll() {
      contributions.clear();
      render();
    }
  });
});

