(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = { createReactiveMotionOverlay: factory };
  }
  if (root?.ASAPluginHost) factory(root.ASAPluginHost);
})(typeof window !== 'undefined' ? window : null, function createReactiveMotionOverlay(host, options) {
  'use strict';

  options = options || {};
  const requestFrame = options.requestFrame || (callback => requestAnimationFrame(callback));
  const cancelFrame = options.cancelFrame || (handle => cancelAnimationFrame(handle));
  const pluginId = 'reactive-motion';
  let config = { enabled: false, preview: false, reduced: false, preset: 'calm', intensity: 0.5 };
  let level = 0;
  let smoothedLevel = 0;
  let frameHandle = null;

  function clamp(value, min, max, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
  }

  function shouldAnimate() {
    return (config.enabled || config.preview) && !config.reduced;
  }

  function schedule() {
    if (shouldAnimate() && frameHandle === null) {
      frameHandle = requestFrame(render);
    }
  }

  function stop() {
    if (frameHandle !== null) cancelFrame(frameHandle);
    frameHandle = null;
    smoothedLevel = 0;
    host.clearMotionContribution(pluginId);
  }

  function render(timestamp) {
    frameHandle = null;
    if (!shouldAnimate()) return;

    smoothedLevel += (level - smoothedLevel) * 0.2;
    const intensity = config.intensity;
    const phase = (Number(timestamp) || 0) / 1800 * Math.PI * 2;
    const idle = Math.sin(phase);
    let y = idle * 1.5 * intensity;
    let rotate = idle * 0.35 * intensity;
    let scale = 1 + smoothedLevel * 0.015 * intensity;

    if (config.preset === 'bouncy') {
      y = idle * 2 * intensity - smoothedLevel * 8 * intensity;
      rotate = idle * 0.6 * intensity;
      scale = 1 + smoothedLevel * 0.08 * intensity;
    } else if (config.preset === 'elastic') {
      y = idle * 2.5 * intensity - smoothedLevel * 5 * intensity;
      rotate = idle * 0.8 * intensity;
      scale = 1 + smoothedLevel * 0.1 * intensity;
    }

    host.setMotionContribution(pluginId, { y, rotate, scale });
    schedule();
  }

  const unsubscribe = host.on('plugin-event', message => {
    if (message?.pluginId !== pluginId) return;
    if (message.event === 'state') {
      const next = message.data || {};
      config = {
        enabled: next.enabled === true,
        preview: next.preview === true,
        reduced: next.reduced === true,
        preset: ['calm', 'bouncy', 'elastic'].includes(next.preset) ? next.preset : 'calm',
        intensity: clamp(next.intensity, 0, 1, 0.5)
      };
      level = clamp(next.level, 0, 1, 0);
      if (shouldAnimate()) schedule();
      else stop();
    }
});
  return Object.freeze({
    destroy() {
      unsubscribe();
      stop();
    }
  });
});
