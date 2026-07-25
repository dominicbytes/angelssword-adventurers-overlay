(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = { createPropsEffectsControl: factory };
  }
  if (root?.ASAPluginHost) {
    root.ASPropsEffects = factory(root.ASAPluginHost, {
      document: root.document,
      now: () => Date.now(),
      setTimer: (callback, delay) => root.setTimeout(callback, delay),
      clearTimer: handle => root.clearTimeout(handle)
    });
  }
})(typeof window !== 'undefined' ? window : null, function createPropsEffectsControl(host, options) {
  'use strict';

  options = options || {};
  const pluginId = 'props-tossables-particles';
  const now = options.now || (() => Date.now());
  const setTimer = options.setTimer || setTimeout;
  const clearTimer = options.clearTimer || clearTimeout;
  const maxActive = Math.max(1, Math.min(50, Number(options.maxActive) || 24));
  const presets = Object.freeze({
    'held-star': { kind: 'prop', durationMs: 0 },
    'toss-star': { kind: 'tossable', durationMs: 1800 },
    confetti: { kind: 'particle', durationMs: 1600 }
  });
  const items = [];
  const timers = new Map();
  const unregisterActions = [];
  let panel = null;
  let nextId = 1;
  let revision = 0;

  function publish() {
    revision += 1;
    host.sendPluginEvent(pluginId, 'snapshot', {
      schemaVersion: 1,
      revision,
      items: items.map(item => ({ ...item }))
    });
  }

  function remove(id) {
    const index = items.findIndex(item => item.id === id);
    if (index < 0) return false;
    items.splice(index, 1);
    const timer = timers.get(id);
    if (timer !== undefined) clearTimer(timer);
    timers.delete(id);
    return true;
  }

  function spawn(presetName, held) {
    const preset = presets[presetName];
    if (!preset) return { ok: false, error: 'unknown_preset' };
    if (items.length >= maxActive) return { ok: false, error: 'effect_limit' };
    const id = `effect-${nextId++}`;
    const item = {
      id,
      preset: presetName,
      kind: preset.kind,
      startedAt: now(),
      durationMs: held ? 0 : preset.durationMs,
      seed: nextId * 7919 % 65536
    };
    items.push(item);
    if (item.durationMs > 0) {
      timers.set(id, setTimer(() => {
        if (remove(id)) publish();
      }, item.durationMs));
    }
    publish();
    return { ok: true, id };
  }

  function registerAction(id, label, presetOptions, invoke) {
    unregisterActions.push(host.registerAction(id, {
      label,
      parameters: presetOptions ? [{ name: 'preset', options: presetOptions }] : [],
      invoke
    }));
  }

  registerAction('effects.spawn', 'Spawn overlay effect', ['toss-star', 'confetti'], parameters => (
    spawn(parameters.preset, false)
  ));
  registerAction('effects.hold', 'Hold overlay prop', ['held-star'], parameters => (
    spawn(parameters.preset, true)
  ));
  registerAction('effects.release', 'Release overlay prop', ['held-star'], parameters => {
    const removed = items.filter(item => item.preset === parameters.preset && item.durationMs === 0)
      .map(item => item.id);
    for (const id of removed) remove(id);
    if (removed.length) publish();
    return { ok: true, removed: removed.length };
  });
  registerAction('effects.clear', 'Clear overlay effects', null, () => {
    for (const item of [...items]) remove(item.id);
    publish();
    return { ok: true };
  });

  const unsubscribeTransport = host.on('transport-open', publish);
  if (host.isTransportOpen()) publish();

  const mount = options.document?.getElementById('plugin-panels');
  if (mount) {
    panel = options.document.createElement('section');
    panel.className = 'card props-effects-panel';
    panel.innerHTML = `
      <div class="card-header"><h2>Props, Tossables, and Particles</h2></div>
      <div class="card-body">
        <div class="props-effects-buttons">
          <button type="button" class="btn btn-secondary" data-preset="held-star">Hold star</button>
          <button type="button" class="btn btn-secondary" data-action="release">Release stars</button>
          <button type="button" class="btn btn-secondary" data-preset="toss-star">Toss star</button>
          <button type="button" class="btn btn-secondary" data-preset="confetti">Confetti</button>
          <button type="button" class="btn btn-secondary" data-action="clear">Clear effects</button>
        </div>
        <p class="help-text">Placeholder artwork can be replaced inside this standalone plugin folder.</p>
      </div>`;
    mount.appendChild(panel);
    for (const button of panel.querySelectorAll('[data-preset]')) {
      button.addEventListener('click', () => {
        const preset = button.dataset.preset;
        spawn(preset, preset === 'held-star');
      });
    }
    panel.querySelector('[data-action="clear"]').addEventListener('click', () => {
      for (const item of [...items]) remove(item.id);
      publish();
    });
    panel.querySelector('[data-action="release"]').addEventListener('click', () => {
      const held = items.filter(item => item.preset === 'held-star').map(item => item.id);
      for (const id of held) remove(id);
      if (held.length) publish();
    });
  }

  return Object.freeze({
    destroy() {
      unsubscribeTransport();
      for (const unregister of unregisterActions) unregister();
      for (const item of [...items]) remove(item.id);
      panel?.remove();
      panel = null;
    }
  });
});
