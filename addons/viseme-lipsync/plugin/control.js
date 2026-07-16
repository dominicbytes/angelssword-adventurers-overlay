(() => {
  'use strict';

  const PLUGIN_ID = 'viseme-lipsync';
  const STORAGE_KEY = 'as-adventurer-viseme-lipsync-enabled';
  const WORKLET_URL = '/plugins/viseme-lipsync/vendor/headworklet.min.mjs';
  const MODULE_URL = '/plugins/viseme-lipsync/vendor/headaudio.min.mjs';
  const MODEL_URL = '/plugins/viseme-lipsync/vendor/model-en-mixed.bin';
  const VISEME_NAMES = ['aa', 'E', 'I', 'O', 'U', 'PP', 'SS', 'TH', 'DD', 'FF', 'kk', 'nn', 'RR', 'CH', 'sil'];

  const host = window.ASAPluginHost;
  const panelRoot = document.getElementById('plugin-panels');
  if (!host || !panelRoot) return;

  panelRoot.insertAdjacentHTML('beforeend', `
    <div class="card viseme-plugin-card">
      <div class="card-header">
        <h2>Viseme Lip Sync</h2>
        <label class="viseme-plugin-toggle">
          <input type="checkbox" id="viseme-plugin-enabled">
          <span>Enabled</span>
        </label>
      </div>
      <div class="card-body">
        <p class="help-text">Uses the selected microphone to choose closed, open, wide, and round mouth loops locally.</p>
        <div class="viseme-plugin-live">
          <span id="viseme-plugin-shape" class="viseme-plugin-shape">REST</span>
          <span id="viseme-plugin-status" class="viseme-plugin-status">Waiting for microphone</span>
        </div>
        <p class="help-text viseme-plugin-files">
          Optional files: <code>neutral_viseme_closed</code>, <code>neutral_viseme_open</code>,
          <code>neutral_viseme_wide</code>, and <code>neutral_viseme_round</code>.
          Existing <code>*_speaking</code> files remain fallbacks.
        </p>
      </div>
    </div>
  `);

  const enabledInput = document.getElementById('viseme-plugin-enabled');
  const shapeElement = document.getElementById('viseme-plugin-shape');
  const statusElement = document.getElementById('viseme-plugin-status');
  enabledInput.checked = localStorage.getItem(STORAGE_KEY) !== 'false';

  let detector = null;
  let detectorSource = null;
  let heartbeat = null;
  let generation = 0;
  let detectorRunning = false;
  let currentViseme = 'rest';
  let candidateViseme = null;
  let candidateCount = 0;
  let lastChange = 0;

  function setStatus(message, state = '') {
    statusElement.textContent = message;
    statusElement.dataset.state = state;
  }

  function mapViseme(value) {
    let id = value;
    if (typeof value === 'string') {
      const name = value.replace(/^viseme_/, '');
      id = VISEME_NAMES.indexOf(name);
    }
    if (!Number.isInteger(id) || id < 0 || id >= VISEME_NAMES.length) return null;
    if (id === 14) return 'rest';
    if (id === 5) return 'closed';
    if (id === 0 || id === 1) return 'open';
    if (id === 3 || id === 4) return 'round';
    return 'wide';
  }

  function publishViseme(viseme, force = false) {
    if (!detectorRunning) return;
    if (!force && viseme === currentViseme) return;
    currentViseme = viseme;
    lastChange = performance.now();
    shapeElement.textContent = viseme.toUpperCase();
    shapeElement.dataset.shape = viseme;
    host.sendPluginEvent(PLUGIN_ID, 'viseme', { viseme });
  }

  function observeViseme(value) {
    if (!detectorRunning) return;
    const viseme = mapViseme(value);
    if (!viseme || viseme === currentViseme) {
      candidateViseme = null;
      candidateCount = 0;
      return;
    }

    if (viseme === candidateViseme) {
      candidateCount++;
    } else {
      candidateViseme = viseme;
      candidateCount = 1;
    }

    const requiredPredictions = viseme === 'rest' ? 1 : 2;
    const heldLongEnough = viseme === 'rest' || performance.now() - lastChange >= 60;
    if (candidateCount >= requiredPredictions && heldLongEnough) {
      publishViseme(viseme);
      candidateViseme = null;
      candidateCount = 0;
    }
  }

  function stopDetector(announceInactive = true) {
    generation++;
    detectorRunning = false;
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = null;

    if (detectorSource && detector) {
      try { detectorSource.disconnect(detector); } catch {}
    }
    if (detector) {
      try { detector.stop(); } catch {}
      try { detector.port.close(); } catch {}
    }
    detector = null;
    detectorSource = null;
    candidateViseme = null;
    candidateCount = 0;
    currentViseme = 'rest';
    shapeElement.textContent = 'REST';
    shapeElement.dataset.shape = 'rest';

    if (announceInactive) {
      host.sendPluginEvent(PLUGIN_ID, 'detector-state', { active: false });
    }
  }

  async function startDetector(input) {
    stopDetector(true);
    if (!enabledInput.checked || !input) {
      setStatus(enabledInput.checked ? 'Waiting for microphone' : 'Disabled');
      return;
    }

    const token = ++generation;
    setStatus('Loading local detector...', 'loading');

    let node = null;
    try {
      const { audioContext, sourceNode } = input;
      await audioContext.audioWorklet.addModule(WORKLET_URL);
      const { HeadAudio } = await import(MODULE_URL);
      if (token !== generation) return;

      node = new HeadAudio(audioContext, {
        processorOptions: { visemeEventsEnabled: true },
        parameterData: {
          vadMode: 1,
          vadGateActiveDb: -45,
          vadGateInactiveDb: -55,
          silMode: 0
        }
      });

      node.onviseme = data => observeViseme(data.viseme);
      node.onended = () => observeViseme(14);
      node.onprocessorerror = error => {
        console.warn('[plugin:viseme-lipsync] Audio processor error:', error);
        if (detector === node) stopDetector(true);
        setStatus('Detector error; using normal speaking mode', 'error');
      };

      await node.loadModel(MODEL_URL);
      if (token !== generation) {
        node.stop();
        node.port.close();
        return;
      }

      detector = node;
      detectorSource = sourceNode;
      sourceNode.connect(node);
      node.start();
      detectorRunning = true;
      host.sendPluginEvent(PLUGIN_ID, 'detector-state', { active: true });
      publishViseme('rest', true);
      heartbeat = setInterval(() => publishViseme(currentViseme, true), 1000);
      setStatus('Active - local audio only', 'active');
    } catch (error) {
      console.warn('[plugin:viseme-lipsync] Could not start detector:', error);
      if (node && detector !== node) {
        try { node.stop(); } catch {}
        try { node.port.close(); } catch {}
      }
      stopDetector(true);
      setStatus('Unavailable; using normal speaking mode', 'error');
    }
  }

  enabledInput.addEventListener('change', () => {
    localStorage.setItem(STORAGE_KEY, String(enabledInput.checked));
    if (enabledInput.checked) {
      startDetector(host.getAudioInput());
    } else {
      stopDetector(true);
      setStatus('Disabled');
    }
  });

  host.on('audio-input', input => {
    if (input && enabledInput.checked) startDetector(input);
    else {
      stopDetector(true);
      setStatus(enabledInput.checked ? 'Waiting for microphone' : 'Disabled');
    }
  });

  function announceDetectorState() {
    host.sendPluginEvent(PLUGIN_ID, 'detector-state', { active: detectorRunning });
    if (detectorRunning) publishViseme(currentViseme, true);
  }

  host.on('transport-open', announceDetectorState);
  if (host.isTransportOpen()) announceDetectorState();

  const currentInput = host.getAudioInput();
  if (currentInput && enabledInput.checked) startDetector(currentInput);
})();
