(() => {
  'use strict';

  const PLUGIN_ID = 'viseme-lipsync';
  const STORAGE_KEY = 'as-adventurer-viseme-lipsync-enabled';
  const WORKLET_URL = '/plugins/viseme-lipsync/vendor/headworklet.min.mjs';
  const MODULE_URL = '/plugins/viseme-lipsync/vendor/headaudio.min.mjs';
  const MODEL_URL = '/plugins/viseme-lipsync/vendor/model-en-mixed.bin';
  const AUDIO_FEATURES_URL = '/plugins/viseme-lipsync/audio-features.mjs';
  const CALIBRATION_KEY = 'as-adventurer-viseme-lipsync-calibration-v2';
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
        <p class="help-text">Uses the selected microphone to choose closed, open, wide, and round mouth videos or sprites locally.</p>
        <div class="viseme-plugin-live">
          <span id="viseme-plugin-shape" class="viseme-plugin-shape">REST</span>
          <span id="viseme-plugin-status" class="viseme-plugin-status">Waiting for microphone</span>
        </div>
        <div class="viseme-plugin-openness">
          <span>Openness</span>
          <div class="viseme-plugin-meter"><span id="viseme-plugin-openness-bar"></span></div>
          <output id="viseme-plugin-openness-value">0%</output>
        </div>
        <div class="viseme-plugin-test" aria-label="Test mouth shapes without a microphone">
          <button type="button" data-viseme-test="rest">Rest</button>
          <button type="button" data-viseme-test="closed">Closed</button>
          <button type="button" data-viseme-test="open">Open</button>
          <button type="button" data-viseme-test="wide">Wide</button>
          <button type="button" data-viseme-test="round">Round</button>
          <button type="button" id="viseme-plugin-stop-test">Use mic</button>
        </div>
        <label class="viseme-plugin-test-level">
          Test openness
          <input type="range" id="viseme-plugin-test-openness" min="0.05" max="1" step="0.05" value="0.8">
        </label>
        <div class="viseme-plugin-calibration">
          <button type="button" id="viseme-plugin-calibrate">Calibrate voice</button>
          <button type="button" id="viseme-plugin-clear-calibration">Clear calibration</button>
          <span id="viseme-plugin-calibration-status">Not calibrated</span>
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
  const opennessBar = document.getElementById('viseme-plugin-openness-bar');
  const opennessValue = document.getElementById('viseme-plugin-openness-value');
  const testOpennessInput = document.getElementById('viseme-plugin-test-openness');
  const calibrationButton = document.getElementById('viseme-plugin-calibrate');
  const clearCalibrationButton = document.getElementById('viseme-plugin-clear-calibration');
  const calibrationStatus = document.getElementById('viseme-plugin-calibration-status');
  enabledInput.checked = localStorage.getItem(STORAGE_KEY) !== 'false';

  let detector = null;
  let detectorSource = null;
  let pluginAnalyser = null;
  let timeData = null;
  let frequencyData = null;
  let audioSampleTimer = null;
  let audioFeatures = null;
  let mfccExtractor = null;
  let generation = 0;
  let detectorRunning = false;
  let testMode = false;
  let calibrationRunning = false;
  let currentViseme = 'rest';
  let rawVisemeId = 14;
  let openness = 0;
  let noiseFloor = 0.008;
  let speechCeiling = 0.08;
  let calibratedTemplates = null;
  let candidateViseme = null;
  let candidateCount = 0;
  let lastChange = 0;

  function setStatus(message, state = '') {
    statusElement.textContent = message;
    statusElement.dataset.state = state;
  }

  function loadCalibration() {
    try {
      const saved = JSON.parse(localStorage.getItem(CALIBRATION_KEY));
      if (saved?.version !== 1 || !saved.templates) return;
      calibratedTemplates = saved.templates;
      if (Number.isFinite(saved.noiseFloor)) noiseFloor = saved.noiseFloor;
      if (Number.isFinite(saved.speechCeiling)) speechCeiling = saved.speechCeiling;
      calibrationStatus.textContent = 'Calibrated for this browser';
      calibrationStatus.dataset.state = 'active';
    } catch {
      localStorage.removeItem(CALIBRATION_KEY);
    }
  }

  function updateOpennessDisplay() {
    const percent = Math.round(openness * 100);
    opennessBar.style.width = `${percent}%`;
    opennessValue.textContent = `${percent}%`;
  }

  function rmsFromTimeData() {
    let squared = 0;
    for (const sample of timeData) squared += sample * sample;
    return Math.sqrt(squared / timeData.length);
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
    if (!detectorRunning && !testMode) return;
    if (!force && viseme === currentViseme) return;
    const changed = viseme !== currentViseme;
    currentViseme = viseme;
    if (changed) lastChange = performance.now();
    shapeElement.textContent = viseme.toUpperCase();
    shapeElement.dataset.shape = viseme;
    host.sendPluginEvent(PLUGIN_ID, 'viseme', {
      viseme,
      openness: viseme === 'rest' ? 0 : Math.round(openness * 100) / 100,
      preview: testMode
    });
  }

  function observeShape(viseme) {
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

  function observeViseme(value) {
    if (!detectorRunning) return;
    rawVisemeId = value;
    if (audioFeatures.shouldDeferVowelToCalibration(rawVisemeId, calibratedTemplates)) return;
    observeShape(mapViseme(value));
  }

  function sampleAudio() {
    if (!detectorRunning || !pluginAnalyser || calibrationRunning) return;
    pluginAnalyser.getFloatTimeDomainData(timeData);
    const rms = rmsFromTimeData();
    const target = audioFeatures.normalizeOpenness(rms, noiseFloor, speechCeiling);
    const smoothing = target > openness ? 0.55 : 0.18;
    openness += (target - openness) * smoothing;
    if (openness < 0.01) openness = 0;

    if (audioFeatures.shouldDeferVowelToCalibration(rawVisemeId, calibratedTemplates) &&
        openness > 0.05) {
      pluginAnalyser.getFloatFrequencyData(frequencyData);
      const calibrated = audioFeatures.classifyMfcc(
        mfccExtractor(frequencyData),
        calibratedTemplates
      );
      if (calibrated) observeShape(calibrated);
    }

    updateOpennessDisplay();
    publishViseme(currentViseme, true);
  }

  function stopDetector(announceInactive = true) {
    generation++;
    detectorRunning = false;
    if (audioSampleTimer) clearInterval(audioSampleTimer);
    audioSampleTimer = null;

    if (detectorSource && detector) {
      try { detectorSource.disconnect(detector); } catch {}
    }
    if (detectorSource && pluginAnalyser) {
      try { detectorSource.disconnect(pluginAnalyser); } catch {}
    }
    if (detector) {
      try { detector.stop(); } catch {}
      try { detector.port.close(); } catch {}
    }
    detector = null;
    detectorSource = null;
    pluginAnalyser = null;
    timeData = null;
    frequencyData = null;
    mfccExtractor = null;
    candidateViseme = null;
    candidateCount = 0;
    rawVisemeId = 14;
    currentViseme = 'rest';
    openness = 0;
    shapeElement.textContent = 'REST';
    shapeElement.dataset.shape = 'rest';
    updateOpennessDisplay();

    if (announceInactive) {
      host.sendPluginEvent(PLUGIN_ID, 'detector-state', { active: false, preview: false });
    }
  }

  async function startDetector(input) {
    stopDetector(true);
    testMode = false;
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
      const [{ HeadAudio }, features] = await Promise.all([
        import(MODULE_URL),
        import(AUDIO_FEATURES_URL)
      ]);
      if (token !== generation) return;

      audioFeatures = features;
      pluginAnalyser = audioContext.createAnalyser();
      pluginAnalyser.fftSize = 2048;
      pluginAnalyser.smoothingTimeConstant = 0.35;
      timeData = new Float32Array(pluginAnalyser.fftSize);
      frequencyData = new Float32Array(pluginAnalyser.frequencyBinCount);
      mfccExtractor = audioFeatures.createMfccExtractor(
        audioContext.sampleRate,
        pluginAnalyser.fftSize
      );

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
      sourceNode.connect(pluginAnalyser);
      node.start();
      detectorRunning = true;
      host.sendPluginEvent(PLUGIN_ID, 'detector-state', { active: true, preview: false });
      publishViseme('rest', true);
      audioSampleTimer = setInterval(sampleAudio, 33);
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

  function startShapeTest(viseme) {
    stopDetector(false);
    testMode = true;
    openness = viseme === 'rest' ? 0 : Number(testOpennessInput.value);
    updateOpennessDisplay();
    host.sendPluginEvent(PLUGIN_ID, 'detector-state', { active: true, preview: true });
    publishViseme(viseme, true);
    setStatus('Test mode - no microphone required', 'active');
  }

  function stopShapeTest() {
    testMode = false;
    currentViseme = 'rest';
    openness = 0;
    shapeElement.textContent = 'REST';
    shapeElement.dataset.shape = 'rest';
    updateOpennessDisplay();
    host.sendPluginEvent(PLUGIN_ID, 'detector-state', { active: false, preview: false });
    const input = host.getAudioInput();
    if (enabledInput.checked && input) startDetector(input);
    else setStatus(enabledInput.checked ? 'Waiting for microphone' : 'Disabled');
  }

  function wait(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
  }

  function median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }

  async function captureCalibrationFrames(durationMs, token, requireVoice) {
    const frames = [];
    const levels = [];
    const started = performance.now();
    while (performance.now() - started < durationMs) {
      if (token !== generation || !detectorRunning) throw new Error('Calibration stopped');
      pluginAnalyser.getFloatTimeDomainData(timeData);
      const rms = rmsFromTimeData();
      levels.push(rms);
      if (!requireVoice || rms > Math.max(0.006, noiseFloor * 1.3)) {
        pluginAnalyser.getFloatFrequencyData(frequencyData);
        frames.push(mfccExtractor(frequencyData));
      }
      await wait(33);
    }
    return { frames, levels };
  }

  async function startCalibration() {
    if (!detectorRunning || !pluginAnalyser || !audioFeatures) {
      calibrationStatus.textContent = 'Enable the microphone first';
      calibrationStatus.dataset.state = 'error';
      return;
    }

    const token = generation;
    calibrationRunning = true;
    calibrationButton.disabled = true;
    try {
      calibrationStatus.textContent = 'Stay quiet...';
      calibrationStatus.dataset.state = 'loading';
      const quiet = await captureCalibrationFrames(800, token, false);
      noiseFloor = Math.max(0.003, median(quiet.levels) * 1.8);

      const templates = {};
      const voiceLevels = [];
      const steps = [
        ['open', 'Hold “aaah”'],
        ['wide', 'Hold “eeee”'],
        ['round', 'Hold “ohhh”']
      ];
      for (const [shape, prompt] of steps) {
        calibrationStatus.textContent = `${prompt} - get ready`;
        await wait(800);
        calibrationStatus.textContent = prompt;
        const capture = await captureCalibrationFrames(1500, token, true);
        if (capture.frames.length < 8) throw new Error(`Could not hear ${prompt.slice(5)}`);
        voiceLevels.push(...capture.levels);
        const halfway = Math.floor(capture.frames.length / 2);
        templates[shape] = [
          audioFeatures.medianTemplate(capture.frames),
          audioFeatures.medianTemplate(capture.frames.slice(0, halfway)),
          audioFeatures.medianTemplate(capture.frames.slice(halfway))
        ];
      }

      const sortedLevels = voiceLevels.sort((a, b) => a - b);
      speechCeiling = Math.max(
        noiseFloor + 0.02,
        sortedLevels[Math.floor(sortedLevels.length * 0.8)]
      );
      calibratedTemplates = templates;
      localStorage.setItem(CALIBRATION_KEY, JSON.stringify({
        version: 1,
        templates,
        noiseFloor,
        speechCeiling
      }));
      calibrationStatus.textContent = 'Calibrated for this browser';
      calibrationStatus.dataset.state = 'active';
    } catch (error) {
      calibrationStatus.textContent = error.message;
      calibrationStatus.dataset.state = 'error';
    } finally {
      calibrationRunning = false;
      calibrationButton.disabled = false;
    }
  }

  document.querySelectorAll('[data-viseme-test]').forEach(button => {
    button.addEventListener('click', () => startShapeTest(button.dataset.visemeTest));
  });
  document.getElementById('viseme-plugin-stop-test').addEventListener('click', stopShapeTest);
  testOpennessInput.addEventListener('input', () => {
    if (!testMode || currentViseme === 'rest') return;
    openness = Number(testOpennessInput.value);
    updateOpennessDisplay();
    publishViseme(currentViseme, true);
  });
  calibrationButton.addEventListener('click', startCalibration);
  clearCalibrationButton.addEventListener('click', () => {
    localStorage.removeItem(CALIBRATION_KEY);
    calibratedTemplates = null;
    noiseFloor = 0.008;
    speechCeiling = 0.08;
    calibrationStatus.textContent = 'Not calibrated';
    calibrationStatus.dataset.state = '';
  });

  enabledInput.addEventListener('change', () => {
    localStorage.setItem(STORAGE_KEY, String(enabledInput.checked));
    testMode = false;
    if (enabledInput.checked) {
      startDetector(host.getAudioInput());
    } else {
      stopDetector(true);
      setStatus('Disabled');
    }
  });

  host.on('audio-input', input => {
    if (testMode) return;
    if (input && enabledInput.checked) startDetector(input);
    else {
      stopDetector(true);
      setStatus(enabledInput.checked ? 'Waiting for microphone' : 'Disabled');
    }
  });

  function announceDetectorState() {
    const active = detectorRunning || testMode;
    host.sendPluginEvent(PLUGIN_ID, 'detector-state', { active, preview: testMode });
    if (active) publishViseme(currentViseme, true);
  }

  host.on('transport-open', announceDetectorState);
  if (host.isTransportOpen()) announceDetectorState();

  const currentInput = host.getAudioInput();
  loadCalibration();
  if (currentInput && enabledInput.checked) startDetector(currentInput);
})();
