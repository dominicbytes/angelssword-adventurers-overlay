(() => {
  'use strict';

  const host = window.ASAPluginHost;
  const pluginId = 'reactive-motion';
  const storageKey = 'as-plugin-reactive-motion';
  if (!host) return;

  let lastLevelSentAt = 0;
  let currentLevel = 0;

  function loadConfig() {
    try {
      return {
        enabled: false,
        preset: 'calm',
        intensity: 0.5,
        ...JSON.parse(localStorage.getItem(storageKey) || '{}')
      };
    } catch {
      return { enabled: false, preset: 'calm', intensity: 0.5 };
    }
  }

  let config = loadConfig();

  function sendState() {
    host.sendPluginEvent(pluginId, 'state', { ...config, level: currentLevel });
  }

  function saveAndSendConfig() {
    localStorage.setItem(storageKey, JSON.stringify(config));
    sendState();
  }

  function buildPanel() {
    const mount = document.getElementById('plugin-panels');
    if (!mount) return;

    const panel = document.createElement('section');
    panel.className = 'card reactive-motion-panel';
    panel.innerHTML = `
      <div class="card-header"><h2>Reactive Motion</h2></div>
      <div class="card-body">
        <label class="reactive-motion-toggle">
          <input type="checkbox" data-field="enabled"> Enable motion
        </label>
        <label>Preset
          <select data-field="preset">
            <option value="calm">Calm</option>
            <option value="bouncy">Bouncy</option>
            <option value="elastic">Elastic</option>
          </select>
        </label>
        <label>Intensity <span data-value="intensity"></span>
          <input type="range" min="0" max="1" step="0.05" data-field="intensity">
        </label>
        <p class="help-text">Uses the existing microphone analysis; it does not request another media permission.</p>
      </div>`;
    mount.appendChild(panel);

    const enabled = panel.querySelector('[data-field="enabled"]');
    const preset = panel.querySelector('[data-field="preset"]');
    const intensity = panel.querySelector('[data-field="intensity"]');
    const intensityValue = panel.querySelector('[data-value="intensity"]');
    enabled.checked = config.enabled;
    preset.value = config.preset;
    intensity.value = config.intensity;
    intensityValue.textContent = `${Math.round(config.intensity * 100)}%`;

    enabled.addEventListener('change', () => {
      config.enabled = enabled.checked;
      if (!config.enabled) currentLevel = 0;
      saveAndSendConfig();
    });
    preset.addEventListener('change', () => {
      config.preset = preset.value;
      saveAndSendConfig();
    });
    intensity.addEventListener('input', () => {
      config.intensity = Number(intensity.value);
      intensityValue.textContent = `${Math.round(config.intensity * 100)}%`;
      saveAndSendConfig();
    });
  }

  host.on('transport-open', saveAndSendConfig);
  host.on('audio-level', audio => {
    if (!config.enabled || audio.timestamp - lastLevelSentAt < 50) return;
    currentLevel = Math.min(1, Math.max(0, Number(audio.value) || 0));
    lastLevelSentAt = audio.timestamp;
    sendState();
  });
  buildPanel();
  if (host.isTransportOpen()) saveAndSendConfig();
})();
