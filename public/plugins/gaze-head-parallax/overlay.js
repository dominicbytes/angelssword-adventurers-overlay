(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = { createGazeHeadParallaxOverlay: factory };
  }
  if (root?.ASAPluginHost) factory(root.ASAPluginHost);
})(typeof window !== 'undefined' ? window : null, function createGazeHeadParallaxOverlay(host, options) {
  'use strict';

  options = options || {};
  const pluginId = 'gaze-head-parallax';
  const requestFrame = options.requestFrame || (callback => requestAnimationFrame(callback));
  const cancelFrame = options.cancelFrame || (handle => cancelAnimationFrame(handle));
  const now = options.now || (() => performance.now());
  const staleAfterMs = 300;
  let enabled = false;
  let smoothing = 0.2;
  let target = { x: 0, y: 0, rotate: 0 };
  let current = { x: 0, y: 0, rotate: 0 };
  let lastUpdateAt = 0;
  let frameHandle = null;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, Number(value) || 0));
  }

  function schedule() {
    if (enabled && frameHandle === null) frameHandle = requestFrame(render);
  }

  function stop() {
    if (frameHandle !== null) cancelFrame(frameHandle);
    frameHandle = null;
    target = { x: 0, y: 0, rotate: 0 };
    current = { x: 0, y: 0, rotate: 0 };
    host.clearMotionContribution(pluginId);
  }

  function render() {
    frameHandle = null;
    if (!enabled) return;
    const stale = now() - lastUpdateAt > staleAfterMs;
    const nextTarget = stale
      ? { x: 0, y: 0, rotate: 0 }
      : target;
    current = {
      x: current.x + (nextTarget.x - current.x) * smoothing,
      y: current.y + (nextTarget.y - current.y) * smoothing,
      rotate: current.rotate + (nextTarget.rotate - current.rotate) * smoothing
    };
    if (stale && Math.abs(current.x) < 0.01 && Math.abs(current.y) < 0.01 &&
        Math.abs(current.rotate) < 0.01) {
      current = { x: 0, y: 0, rotate: 0 };
      host.clearMotionContribution(pluginId);
      return;
    }
    host.setMotionContribution(pluginId, current);
    schedule();
  }

  const unsubscribe = host.on('plugin-event', message => {
    if (message?.pluginId !== pluginId || message.event !== 'state') return;
    const data = message.data || {};
    enabled = data.enabled === true;
    smoothing = clamp(data.smoothing, 0.05, 1);
    target = {
      x: clamp(data.target?.x, -40, 40),
      y: clamp(data.target?.y, -30, 30),
      rotate: clamp(data.target?.rotate, -10, 10)
    };
    lastUpdateAt = now();
    if (enabled) schedule();
    else stop();
  });

  return Object.freeze({
    destroy() {
      unsubscribe();
      enabled = false;
      stop();
    }
  });
});
