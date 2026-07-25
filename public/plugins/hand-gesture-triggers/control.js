(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = { createHandGestureTriggers: factory };
  }
  if (root?.ASAPluginHost) {
    root.ASHandGestureTriggers = factory(root.ASAPluginHost, {
      document: root.document,
      storage: root.localStorage,
      async createRecognizer() {
        const vision = await import('/plugins/hand-gesture-triggers/vendor/mediapipe/vision_bundle.mjs');
        const files = await vision.FilesetResolver.forVisionTasks(
          '/plugins/hand-gesture-triggers/vendor/mediapipe/wasm'
        );
        return vision.GestureRecognizer.createFromOptions(files, {
          baseOptions: {
            modelAssetPath: '/plugins/hand-gesture-triggers/gesture_recognizer.task',
            delegate: 'GPU'
          },
          runningMode: 'VIDEO',
          numHands: 2,
          minHandDetectionConfidence: 0.5,
          minHandPresenceConfidence: 0.5,
          minTrackingConfidence: 0.5
        });
      }
    });
  }
})(typeof window !== 'undefined' ? window : null, function createHandGestureTriggers(host, options) {
  'use strict';

  options = options || {};
  const pluginId = 'hand-gesture-triggers';
  const storageKey = 'as-plugin-hand-gesture-triggers';
  const storage = options.storage || null;
  const cannedGestures = [
    'Closed_Fist',
    'Open_Palm',
    'Pointing_Up',
    'Thumb_Down',
    'Thumb_Up',
    'Victory',
    'ILoveYou'
  ];
  const defaults = {
    schemaVersion: 1,
    enabled: false,
    confidence: 0.7,
    cooldownMs: 750,
    mappings: []
  };
  function copy(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function normalizeAction(value) {
    if (value === null || value === undefined) return null;
    return {
      actionId: value.actionId,
      parameters: value.parameters && typeof value.parameters === 'object'
        ? copy(value.parameters)
        : value.parameters
    };
  }

  function normalize(candidate) {
    const value = { ...defaults, ...(candidate || {}) };
    return {
      schemaVersion: 1,
      enabled: value.enabled,
      confidence: value.confidence,
      cooldownMs: value.cooldownMs,
      mappings: Array.isArray(value.mappings) ? value.mappings.map(mapping => ({
        gesture: mapping?.gesture,
        press: normalizeAction(mapping?.press),
        release: normalizeAction(mapping?.release)
      })) : value.mappings
    };
  }

  function validAction(action, required) {
    if (!action) return !required;
    return /^[a-z0-9][a-z0-9._-]{0,63}$/.test(action.actionId || '') &&
      action.parameters && typeof action.parameters === 'object' && !Array.isArray(action.parameters);
  }

  function validate(candidate) {
    if (!candidate || candidate.schemaVersion !== 1 || typeof candidate.enabled !== 'boolean' ||
        !Number.isFinite(candidate.confidence) || candidate.confidence < 0.5 || candidate.confidence > 1 ||
        !Number.isFinite(candidate.cooldownMs) || candidate.cooldownMs < 0 || candidate.cooldownMs > 10000 ||
        !Array.isArray(candidate.mappings) || candidate.mappings.length > cannedGestures.length) {
      return { ok: false, error: 'invalid_config' };
    }
    const gestures = new Set();
    for (const mapping of candidate.mappings) {
      if (!cannedGestures.includes(mapping.gesture) || !validAction(mapping.press, true) ||
          !validAction(mapping.release, false)) {
        return { ok: false, error: 'invalid_mapping', gesture: mapping.gesture || null };
      }
      if (gestures.has(mapping.gesture)) {
        return { ok: false, error: 'duplicate_gesture', gesture: mapping.gesture };
      }
      gestures.add(mapping.gesture);
    }
    return { ok: true };
  }

  function load() {
    let candidate = options.initialConfig;
    if (!candidate) {
      try {
        candidate = JSON.parse(storage?.getItem(storageKey) || 'null');
      } catch {
        candidate = null;
      }
    }
    const normalized = normalize(candidate);
    return validate(normalized).ok ? normalized : normalize(defaults);
  }

  let config = load();
  let recognizer = null;
  let unregisterProcessor = null;
  let observedGesture = null;
  let activeMapping = null;
  let destroyed = false;
  let panel = null;
  let status = 'loading';
  const lastTriggeredAt = new Map();

  function invoke(action) {
    if (action) host.invokeAction(action.actionId, action.parameters);
  }

  function resetGestureState() {
    if (activeMapping) invoke(activeMapping.release);
    activeMapping = null;
    observedGesture = null;
    lastTriggeredAt.clear();
  }

  function bestGesture(result) {
    let best = null;
    for (const hand of result?.gestures || []) {
      for (const candidate of hand || []) {
        if (candidate?.categoryName === 'None' || Number(candidate?.score) < config.confidence) continue;
        if (!best || candidate.score > best.score) best = candidate;
      }
    }
    return best?.categoryName || null;
  }

  function handleResult(result, timestamp) {
    if (!config.enabled) return;
    const gesture = bestGesture(result);
    if (gesture === observedGesture) return;

    if (activeMapping) invoke(activeMapping.release);
    activeMapping = null;
    observedGesture = gesture;
    if (!gesture) return;

    const mapping = config.mappings.find(candidate => candidate.gesture === gesture);
    if (!mapping?.press) return;
    const previous = lastTriggeredAt.get(gesture);
    const now = Number(timestamp) || 0;
    if (previous !== undefined && now - previous < config.cooldownMs) return;
    lastTriggeredAt.set(gesture, now);
    activeMapping = mapping;
    invoke(mapping.press);
  }

  async function initialize() {
    recognizer = options.recognizer || await options.createRecognizer?.();
    if (destroyed) {
      recognizer?.close?.();
      return;
    }
    if (!recognizer || typeof recognizer.recognizeForVideo !== 'function') {
      throw new Error('Gesture recognizer is unavailable');
    }
    try {
      unregisterProcessor = host.registerTrackingProcessor(pluginId, {
        everyNFrames: 2,
        process: (video, timestamp) => config.enabled
          ? recognizer.recognizeForVideo(video, timestamp)
          : null,
        onResult: handleResult,
        onStop: resetGestureState
      });
    } catch (error) {
      recognizer.close?.();
      recognizer = null;
      throw error;
    }
    if (typeof unregisterProcessor !== 'function') {
      recognizer.close?.();
      recognizer = null;
      throw new Error('Shared tracking processor registration is unavailable');
    }
  }

  function buildPanel(controller) {
    const documentRef = options.document;
    const mount = documentRef?.getElementById('plugin-panels');
    if (!mount) return;
    panel = documentRef.createElement('section');
    panel.className = 'card hand-gesture-triggers-panel';
    panel.innerHTML = `
      <div class="card-header"><h2>Hand Gesture Triggers</h2></div>
      <div class="card-body">
        <label><input data-field="enabled" type="checkbox"> Enable hand gestures</label>
        <label>Minimum confidence
          <input data-field="confidence" type="number" min="0.5" max="1" step="0.05">
        </label>
        <label>Gesture cooldown (milliseconds)
          <input data-field="cooldown" type="number" min="0" max="10000" step="50">
        </label>
        <label>Gesture mappings (JSON)
          <textarea data-field="mappings" rows="12" spellcheck="false"></textarea>
        </label>
        <button data-action="save" type="button" class="btn btn-primary">Save gesture settings</button>
        <p data-field="message" class="help-text" role="status"></p>
        <p class="help-text">Supported gestures: Closed_Fist, Open_Palm, Pointing_Up, Thumb_Down,
          Thumb_Up, Victory, and ILoveYou. This plugin uses the shared webcam scheduler.</p>
      </div>`;
    mount.appendChild(panel);

    const enabled = panel.querySelector('[data-field="enabled"]');
    const confidence = panel.querySelector('[data-field="confidence"]');
    const cooldown = panel.querySelector('[data-field="cooldown"]');
    const mappings = panel.querySelector('[data-field="mappings"]');
    const message = panel.querySelector('[data-field="message"]');
    const save = panel.querySelector('[data-action="save"]');

    function render() {
      const current = controller.getConfig();
      enabled.checked = current.enabled;
      confidence.value = String(current.confidence);
      cooldown.value = String(current.cooldownMs);
      mappings.value = JSON.stringify(current.mappings, null, 2);
    }

    function renderStatus(detail) {
      const labels = {
        loading: 'Loading the local gesture recognizer...',
        ready: 'Gesture recognizer ready.',
        error: 'Gesture recognizer could not be loaded.'
      };
      message.textContent = detail || labels[status];
    }

    save.addEventListener('click', () => {
      let parsedMappings;
      try {
        parsedMappings = JSON.parse(mappings.value);
      } catch {
        renderStatus('Mappings must be valid JSON.');
        return;
      }
      const result = controller.update({
        schemaVersion: 1,
        enabled: enabled.checked,
        confidence: Number(confidence.value),
        cooldownMs: Number(cooldown.value),
        mappings: parsedMappings
      });
      if (!result.ok) {
        renderStatus(`Settings were not saved: ${result.error}.`);
        return;
      }
      render();
      renderStatus('Gesture settings saved.');
    });

    render();
    renderStatus();
    controller.ready.then(() => {
      status = 'ready';
      renderStatus();
    }, error => {
      status = 'error';
      renderStatus(error?.message || undefined);
    });
  }

  const ready = initialize();
  const controller = {
    ready,
    update(nextConfig) {
      const candidate = normalize(nextConfig);
      const result = validate(candidate);
      if (!result.ok) return result;
      resetGestureState();
      config = candidate;
      storage?.setItem(storageKey, JSON.stringify(config));
      return { ok: true };
    },
    getConfig() {
      return copy(config);
    },
    destroy() {
      destroyed = true;
      resetGestureState();
      unregisterProcessor?.();
      unregisterProcessor = null;
      recognizer?.close?.();
      recognizer = null;
      panel?.remove();
      panel = null;
    }
  };

  buildPanel(controller);
  return Object.freeze(controller);
});
