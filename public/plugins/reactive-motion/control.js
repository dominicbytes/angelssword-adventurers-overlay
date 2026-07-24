(() => {
  'use strict';

  const host = window.ASAPluginHost;
  const pluginId = 'reactive-motion';
  const storageKey = 'as-plugin-reactive-motion';
  if (!host) return;

  let analyser = null;
  let samples = null;
  let frameHandle = null;
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

  function stopMeter() {
    if (frameHandle !== null) cancelAnimationFrame(frameHandle);
    frameHandle = null;
    try { analyser?.disconnect(); } catch {}
    analyser = null;
    samples = null;
    currentLevel = 0;
    sendState();
  }

  function readLevel(timestamp) {
    frameHandle = null;
    if (!analyser || !config.enabled) return;
    analyser.getByteTimeDomainData(samples);
    let energy = 0;
    for (const sample of samples) {
      const normalized = (sample - 128) / 128;
      energy += normalized * normalized;
    }
    const rms = Math.sqrt(energy / samples.length);
    if (timestamp - lastLevelSentAt >= 50) {
      currentLevel = Math.min(1, rms * 8);
      sendState();
      lastLevelSentAt = timestamp;
    }
    frameHandle = requestAnimationFrame(readLevel);
  }

  function startMeter(input) {
    stopMeter();
    if (!config.enabled || !input?.audioContext || !input?.sourceNode) return;
    analyser = input.audioContext.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.65;
    samples = new Uint8Array(analyser.fftSize);
    input.sourceNode.connect(analyser);
    frameHandle = requestAnimationFrame(readLevel);
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
        <p class="help-text">Uses the existing microphone source; it does not request another media permission.</p>
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
      saveAndSendConfig();
      if (config.enabled) startMeter(host.getAudioInput());
      else stopMeter();
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
  host.on('audio-input', input => startMeter(input));
  buildPanel();
  if (host.isTransportOpen()) saveAndSendConfig();
  if (config.enabled) startMeter(host.getAudioInput());
})();
