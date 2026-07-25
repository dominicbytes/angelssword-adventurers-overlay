(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = { createEffectsOverlay: factory, effectFrame };
  }
  if (root?.ASAPluginHost) factory(root.ASAPluginHost, { document: root.document });
})(typeof window !== 'undefined' ? window : null, function createEffectsOverlay(host, options) {
  'use strict';

  options = options || {};
  const documentRef = options.document;
  const requestFrame = options.requestFrame || (callback => requestAnimationFrame(callback));
  const cancelFrame = options.cancelFrame || (handle => cancelAnimationFrame(handle));
  const now = options.now || (() => Date.now());
  const assets = {
    'held-star': '/plugins/props-tossables-particles/assets/held-star.svg',
    'toss-star': '/plugins/props-tossables-particles/assets/toss-star.svg',
    confetti: '/plugins/props-tossables-particles/assets/confetti.svg'
  };
  const layer = documentRef.createElement('div');
  layer.className = 'props-effects-layer';
  (documentRef.getElementById('overlay-container') || documentRef.body).appendChild(layer);
  const rendered = new Map();
  let frameHandle = null;

  function schedule() {
    if (rendered.size && frameHandle === null) frameHandle = requestFrame(render);
  }

  function render() {
    frameHandle = null;
    const timestamp = now();
    for (const entry of rendered.values()) {
      const frame = effectFrame(entry.item, timestamp);
      entry.element.style.left = `${frame.x}%`;
      entry.element.style.top = `${frame.y}%`;
      entry.element.style.opacity = String(frame.opacity);
      entry.element.style.transform = `translate(-50%, -50%) rotate(${frame.rotate}deg) scale(${frame.scale})`;
    }
    schedule();
  }

  function reconcile(items) {
    const incoming = new Set();
    for (const item of Array.isArray(items) ? items : []) {
      if (!assets[item?.preset] || typeof item.id !== 'string' || !Number.isFinite(item.startedAt)) continue;
      incoming.add(item.id);
      let entry = rendered.get(item.id);
      if (!entry) {
        const element = documentRef.createElement('img');
        element.className = `props-effect props-effect-${item.kind}`;
        element.src = assets[item.preset];
        element.alt = '';
        layer.appendChild(element);
        entry = { element, item };
        rendered.set(item.id, entry);
      }
      entry.item = { ...item };
    }
    for (const [id, entry] of rendered) {
      if (incoming.has(id)) continue;
      entry.element.remove();
      rendered.delete(id);
    }
    if (!rendered.size && frameHandle !== null) {
      cancelFrame(frameHandle);
      frameHandle = null;
    }
    schedule();
  }

  const unsubscribe = host.on('plugin-event', message => {
    if (message?.pluginId === 'props-tossables-particles' && message.event === 'snapshot') {
      reconcile(message.data?.items);
    }
  });

  return Object.freeze({
    destroy() {
      unsubscribe();
      if (frameHandle !== null) cancelFrame(frameHandle);
      frameHandle = null;
      layer.remove();
      rendered.clear();
    }
  });
});

function effectFrame(item, timestamp) {
  const duration = Math.max(1, Number(item.durationMs) || 1);
  const progress = Math.min(1, Math.max(0, (timestamp - item.startedAt) / duration));
  if (item.kind === 'prop') return { x: 72, y: 62, rotate: -12, scale: 1, opacity: 1 };
  if (item.kind === 'tossable') {
    return {
      x: 8 + progress * 84,
      y: 72 - Math.sin(progress * Math.PI) * 58,
      rotate: progress * 720,
      scale: 1,
      opacity: progress > 0.9 ? (1 - progress) * 10 : 1
    };
  }
  const drift = ((Number(item.seed) || 0) % 21) - 10;
  return {
    x: 50 + drift * progress,
    y: 12 + progress * 78,
    rotate: progress * (360 + Math.abs(drift) * 20),
    scale: 0.8 + progress * 0.4,
    opacity: 1 - progress
  };
}
