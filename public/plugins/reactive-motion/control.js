(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = { createReactiveMotionControl: factory };
  }
  if (root?.ASAPluginHost) {
    const reducedMotionQuery = root.matchMedia?.('(prefers-reduced-motion: reduce)');
    root.ASReactiveMotion = factory(root.ASAPluginHost, {
      document: root.document,
      storage: root.localStorage,
      prefersReducedMotion: () => reducedMotionQuery?.matches === true,
      subscribeReducedMotion(handler) {
        reducedMotionQuery?.addEventListener?.('change', handler);
        return () => reducedMotionQuery?.removeEventListener?.('change', handler);
      }
    });
  }
})(typeof window !== 'undefined' ? window : null, function createReactiveMotionControl(host, options) {
  'use strict';

  options = options || {};
  const pluginId = 'reactive-motion';
  const storageKey = 'as-plugin-reactive-motion';
  const storage = options.storage || null;
  const setTimer = options.setTimer || setTimeout;
  const clearTimer = options.clearTimer || clearTimeout;
  const defaults = {
    schemaVersion: 2,
    enabled: false,
    preset: 'calm',
    intensity: 0.5,
    reducedMotion: 'system'
  };
  let currentLevel = 0;
  let lastLevelSentAt = 0;
  let panel = null;
  let previewTimer = null;

  function copy(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function valid(value) {
    return value?.schemaVersion === 2 && typeof value.enabled === 'boolean' &&
      ['calm', 'bouncy', 'elastic'].includes(value.preset) &&
      Number.isFinite(value.intensity) && value.intensity >= 0 && value.intensity <= 1 &&
      ['system', 'always', 'never'].includes(value.reducedMotion);
  }

  function migrate(value) {
    if (!value || value.schemaVersion === 2) return value;
    if (value.schemaVersion !== undefined && value.schemaVersion !== 1) return null;
    return {
      schemaVersion: 2,
      enabled: value.enabled === true,
      preset: value.preset,
      intensity: value.intensity,
      reducedMotion: 'system'
    };
  }

  function load() {
    let stored = null;
    try {
      stored = JSON.parse(storage?.getItem(storageKey) || 'null');
    } catch {
      stored = null;
    }
    const migrated = migrate(stored);
    const loaded = valid(migrated) ? migrated : defaults;
    if (stored && (stored.schemaVersion === undefined || stored.schemaVersion === 1) && valid(migrated)) {
      storage?.setItem(storageKey, JSON.stringify(migrated));
    }
    return copy(loaded);
  }

  let config = load();

  function reduced() {
    if (config.reducedMotion === 'always') return true;
    if (config.reducedMotion === 'never') return false;
    return options.prefersReducedMotion?.() === true;
  }

  function sendState(preview, previewLevel) {
    host.sendPluginEvent(pluginId, 'state', {
      schemaVersion: config.schemaVersion,
      enabled: config.enabled,
      preset: config.preset,
      intensity: config.intensity,
      reduced: reduced(),
      level: preview === true ? previewLevel : currentLevel,
      preview: preview === true
    });
  }

  function persistAndSend() {
    storage?.setItem(storageKey, JSON.stringify(config));
    sendState(false);
  }

  function updateConfig(nextConfig) {
    if (!valid(nextConfig)) return { ok: false, error: 'invalid_config' };
    if (previewTimer !== null) clearTimer(previewTimer);
    previewTimer = null;
    config = copy(nextConfig);
    if (!config.enabled) currentLevel = 0;
    persistAndSend();
    return { ok: true };
  }

  function previewMotion() {
    if (previewTimer !== null) clearTimer(previewTimer);
    sendState(true, 0.8);
    previewTimer = setTimer(() => {
      previewTimer = null;
      sendState(false);
    }, 1500);
  }

  const unsubscribeTransport = host.on('transport-open', () => sendState(false));
  const unsubscribeAudio = host.on('audio-level', audio => {
    if (!config.enabled || audio.timestamp - lastLevelSentAt < 50) return;
    currentLevel = Math.min(1, Math.max(0, Number(audio.value) || 0));
    lastLevelSentAt = audio.timestamp;
    sendState(false);
  });
  const unsubscribeReducedMotion = options.subscribeReducedMotion?.(() => {
    if (config.reducedMotion === 'system') sendState(false);
  }) || (() => {});

  const mount = options.document?.getElementById('plugin-panels');
  if (mount) {
    panel = options.document.createElement('section');
    panel.className = 'card reactive-motion-panel';
    panel.innerHTML = `
      <div class="card-header"><h2>Reactive Motion</h2></div>
      <div class="card-body">
        <label class="reactive-motion-toggle"><input type="checkbox" data-field="enabled"> Enable motion</label>
        <label>Preset
          <select data-field="preset"><option value="calm">Calm</option><option value="bouncy">Bouncy</option><option value="elastic">Elastic</option></select>
        </label>
        <label>Intensity <span data-value="intensity"></span>
          <input type="range" min="0" max="1" step="0.05" data-field="intensity">
        </label>
        <label>Reduced motion
          <select data-field="reduced-motion"><option value="system">Use Windows setting</option><option value="always">Always reduce</option><option value="never">Never reduce</option></select>
        </label>
        <button type="button" class="btn btn-secondary" data-action="preview">Preview motion</button>
        <p class="help-text">Uses the existing microphone analysis; it does not request another media permission.</p>
      </div>`;
    mount.appendChild(panel);
    const enabled = panel.querySelector('[data-field="enabled"]');
    const preset = panel.querySelector('[data-field="preset"]');
    const intensity = panel.querySelector('[data-field="intensity"]');
    const intensityValue = panel.querySelector('[data-value="intensity"]');
    const reducedMotion = panel.querySelector('[data-field="reduced-motion"]');
    enabled.checked = config.enabled;
    preset.value = config.preset;
    intensity.value = String(config.intensity);
    intensityValue.textContent = `${Math.round(config.intensity * 100)}%`;
    reducedMotion.value = config.reducedMotion;
    enabled.addEventListener('change', () => {
      config.enabled = enabled.checked;
      if (!config.enabled) currentLevel = 0;
      persistAndSend();
    });
    preset.addEventListener('change', () => {
      config.preset = preset.value;
      persistAndSend();
    });
    intensity.addEventListener('input', () => {
      config.intensity = Number(intensity.value);
      intensityValue.textContent = `${Math.round(config.intensity * 100)}%`;
      persistAndSend();
    });
    reducedMotion.addEventListener('change', () => {
      config.reducedMotion = reducedMotion.value;
      persistAndSend();
    });
    panel.querySelector('[data-action="preview"]').addEventListener('click', previewMotion);
  }

  if (host.isTransportOpen()) sendState(false);

  return Object.freeze({
    getConfig: () => copy(config),
    update: updateConfig,
    preview: previewMotion,
    destroy() {
      if (previewTimer !== null) clearTimer(previewTimer);
      previewTimer = null;
      unsubscribeTransport();
      unsubscribeAudio();
      unsubscribeReducedMotion();
      panel?.remove();
      panel = null;
    }
  });
});
