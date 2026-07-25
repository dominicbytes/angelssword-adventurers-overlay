(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = { createGazeHeadParallaxControl: factory };
  }
  if (root?.ASAPluginHost) {
    root.ASGazeHeadParallax = factory(root.ASAPluginHost, {
      document: root.document,
      storage: root.localStorage
    });
  }
})(typeof window !== 'undefined' ? window : null, function createGazeHeadParallaxControl(host, options) {
  'use strict';

  options = options || {};
  const pluginId = 'gaze-head-parallax';
  const storageKey = 'as-plugin-gaze-head-parallax';
  const storage = options.storage || null;
  const landmark = Object.freeze({
    forehead: 10,
    chin: 152,
    leftCheek: 234,
    rightCheek: 454,
    nose: 1,
    leftEyeOuter: 33,
    leftEyeInner: 133,
    rightEyeInner: 362,
    rightEyeOuter: 263,
    leftIris: 468,
    rightIris: 473,
    leftEyeTop: 159,
    leftEyeBottom: 145,
    rightEyeTop: 386,
    rightEyeBottom: 374
  });
  const defaults = {
    schemaVersion: 1,
    enabled: false,
    headStrength: 0.75,
    gazeStrength: 0.25,
    maxX: 24,
    maxY: 16,
    maxRotate: 5,
    smoothing: 0.2,
    invertX: false,
    invertY: false,
    calibration: null
  };
  function copy(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function validNumber(value, min, max) {
    return Number.isFinite(value) && value >= min && value <= max;
  }

  function validate(candidate) {
    if (!candidate || candidate.schemaVersion !== 1 || typeof candidate.enabled !== 'boolean') {
      return { ok: false, error: 'invalid_schema' };
    }
    if (!validNumber(candidate.headStrength, 0, 1)) return { ok: false, error: 'invalid_head_strength' };
    if (!validNumber(candidate.gazeStrength, 0, 1)) return { ok: false, error: 'invalid_gaze_strength' };
    if (!validNumber(candidate.maxX, 0, 40)) return { ok: false, error: 'invalid_max_x' };
    if (!validNumber(candidate.maxY, 0, 30)) return { ok: false, error: 'invalid_max_y' };
    if (!validNumber(candidate.maxRotate, 0, 10)) return { ok: false, error: 'invalid_max_rotate' };
    if (!validNumber(candidate.smoothing, 0.05, 1)) return { ok: false, error: 'invalid_smoothing' };
    if (typeof candidate.invertX !== 'boolean' || typeof candidate.invertY !== 'boolean') {
      return { ok: false, error: 'invalid_direction' };
    }
    if (candidate.calibration !== null) {
      const fields = ['headX', 'headY', 'roll', 'gazeX', 'gazeY'];
      if (!candidate.calibration || fields.some(field => !Number.isFinite(candidate.calibration[field]))) {
        return { ok: false, error: 'invalid_calibration' };
      }
    }
    return { ok: true };
  }

  function normalize(candidate) {
    const value = { ...defaults, ...(candidate || {}) };
    return {
      schemaVersion: 1,
      enabled: value.enabled,
      headStrength: value.headStrength,
      gazeStrength: value.gazeStrength,
      maxX: value.maxX,
      maxY: value.maxY,
      maxRotate: value.maxRotate,
      smoothing: value.smoothing,
      invertX: value.invertX,
      invertY: value.invertY,
      calibration: value.calibration ? copy(value.calibration) : null
    };
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
  let latestMeasurement = null;
  let automaticCalibration = null;
  let faceTracked = false;
  let lastTrackingSentAt = -Infinity;
  let panel = null;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, Number(value) || 0));
  }

  function point(landmarks, index) {
    const value = landmarks?.[index];
    return value && Number.isFinite(value.x) && Number.isFinite(value.y) ? value : null;
  }

  function normalizedPosition(value, first, second) {
    const low = Math.min(first, second);
    const span = Math.abs(second - first);
    return span > 1e-6 ? ((value - low) / span) * 2 - 1 : 0;
  }

  function measure(landmarks) {
    const forehead = point(landmarks, landmark.forehead);
    const chin = point(landmarks, landmark.chin);
    const leftCheek = point(landmarks, landmark.leftCheek);
    const rightCheek = point(landmarks, landmark.rightCheek);
    const nose = point(landmarks, landmark.nose);
    const leftEyeOuter = point(landmarks, landmark.leftEyeOuter);
    const leftEyeInner = point(landmarks, landmark.leftEyeInner);
    const rightEyeInner = point(landmarks, landmark.rightEyeInner);
    const rightEyeOuter = point(landmarks, landmark.rightEyeOuter);
    if (!forehead || !chin || !leftCheek || !rightCheek || !nose ||
        !leftEyeOuter || !rightEyeOuter) return null;

    const faceWidth = Math.abs(rightCheek.x - leftCheek.x);
    const faceHeight = Math.abs(chin.y - forehead.y);
    if (faceWidth < 1e-6 || faceHeight < 1e-6) return null;

    const leftIris = point(landmarks, landmark.leftIris);
    const rightIris = point(landmarks, landmark.rightIris);
    const leftEyeTop = point(landmarks, landmark.leftEyeTop);
    const leftEyeBottom = point(landmarks, landmark.leftEyeBottom);
    const rightEyeTop = point(landmarks, landmark.rightEyeTop);
    const rightEyeBottom = point(landmarks, landmark.rightEyeBottom);
    let gazeX = 0;
    let gazeY = 0;
    let hasGaze = false;
    if (leftEyeInner && rightEyeInner && leftIris && rightIris &&
        leftEyeTop && leftEyeBottom && rightEyeTop && rightEyeBottom) {
      gazeX = (
        normalizedPosition(leftIris.x, leftEyeOuter.x, leftEyeInner.x) +
        normalizedPosition(rightIris.x, rightEyeInner.x, rightEyeOuter.x)
      ) / 2;
      gazeY = (
        normalizedPosition(leftIris.y, leftEyeTop.y, leftEyeBottom.y) +
        normalizedPosition(rightIris.y, rightEyeTop.y, rightEyeBottom.y)
      ) / 2;
      hasGaze = true;
    }

    return {
      headX: nose.x,
      headY: nose.y,
      faceWidth,
      faceHeight,
      roll: Math.atan2(rightEyeOuter.y - leftEyeOuter.y, rightEyeOuter.x - leftEyeOuter.x),
      gazeX,
      gazeY,
      hasGaze
    };
  }

  function calibrationValue(measurement) {
    return {
      headX: measurement.headX,
      headY: measurement.headY,
      roll: measurement.roll,
      gazeX: measurement.gazeX,
      gazeY: measurement.gazeY
    };
  }

  function publish(target) {
    host.sendPluginEvent(pluginId, 'state', {
      enabled: config.enabled,
      smoothing: config.smoothing,
      target
    });
  }

  function persist() {
    storage?.setItem(storageKey, JSON.stringify(config));
  }

  function targetFor(measurement) {
    const baseline = config.calibration || automaticCalibration;
    if (!baseline) return { x: 0, y: 0, rotate: 0 };
    const headX = clamp((measurement.headX - baseline.headX) / measurement.faceWidth / 0.35, -1, 1);
    const headY = clamp((measurement.headY - baseline.headY) / measurement.faceHeight / 0.25, -1, 1);
    const gazeX = measurement.hasGaze
      ? clamp((measurement.gazeX - baseline.gazeX) / 0.5, -1, 1)
      : 0;
    const gazeY = measurement.hasGaze
      ? clamp((measurement.gazeY - baseline.gazeY) / 0.5, -1, 1)
      : 0;
    const directionX = config.invertX ? -1 : 1;
    const directionY = config.invertY ? -1 : 1;
    return {
      x: clamp((headX * config.headStrength + gazeX * config.gazeStrength) * config.maxX * directionX,
        -config.maxX, config.maxX),
      y: clamp((headY * config.headStrength + gazeY * config.gazeStrength) * config.maxY * directionY,
        -config.maxY, config.maxY),
      rotate: clamp(((measurement.roll - baseline.roll) / 0.35) * config.maxRotate * config.headStrength,
        -config.maxRotate, config.maxRotate)
    };
  }

  function loseTracking() {
    if (faceTracked) publish({ x: 0, y: 0, rotate: 0 });
    faceTracked = false;
    latestMeasurement = null;
  }

  const unsubscribeTracking = host.on('tracking-frame', frame => {
    if (!config.enabled) return;
    if (!frame?.faceDetected || !frame.landmarks) {
      loseTracking();
      return;
    }
    const measurement = measure(frame.landmarks);
    if (!measurement) {
      loseTracking();
      return;
    }
    latestMeasurement = measurement;
    if (!config.calibration && !automaticCalibration) {
      automaticCalibration = calibrationValue(measurement);
    }
    const detectionEdge = !faceTracked;
    faceTracked = true;
    const timestamp = Number(frame.timestamp);
    if (!detectionEdge && Number.isFinite(timestamp) && timestamp - lastTrackingSentAt < 50) return;
    if (Number.isFinite(timestamp)) lastTrackingSentAt = timestamp;
    publish(targetFor(measurement));
  });
  const unsubscribeTransport = host.on('transport-open', () => {
    publish({ x: 0, y: 0, rotate: 0 });
  });
  if (host.isTransportOpen?.()) publish({ x: 0, y: 0, rotate: 0 });

  const controller = {
    calibrate() {
      if (!faceTracked || !latestMeasurement) return { ok: false, error: 'face_unavailable' };
      config.calibration = calibrationValue(latestMeasurement);
      automaticCalibration = null;
      persist();
      publish({ x: 0, y: 0, rotate: 0 });
      return { ok: true };
    },
    update(nextConfig) {
      const candidate = normalize(nextConfig);
      const result = validate(candidate);
      if (!result.ok) return result;
      config = candidate;
      automaticCalibration = null;
      faceTracked = false;
      latestMeasurement = null;
      lastTrackingSentAt = -Infinity;
      persist();
      publish({ x: 0, y: 0, rotate: 0 });
      return { ok: true };
    },
    getConfig() {
      return copy(config);
    },
    destroy() {
      unsubscribeTracking();
      unsubscribeTransport();
      panel?.remove();
    }
  };

  function buildPanel() {
    const documentRef = options.document;
    const mount = documentRef?.getElementById('plugin-panels');
    if (!mount) return;
    panel = documentRef.createElement('section');
    panel.className = 'card gaze-head-parallax-panel';
    panel.innerHTML = `
      <div class="card-header"><h2>Gaze and Head Parallax</h2></div>
      <div class="card-body">
        <label class="gaze-parallax-toggle"><input type="checkbox" data-field="enabled"> Enable parallax</label>
        <label>Head strength <span data-value="headStrength"></span>
          <input type="range" min="0" max="1" step="0.05" data-field="headStrength">
        </label>
        <label>Gaze strength <span data-value="gazeStrength"></span>
          <input type="range" min="0" max="1" step="0.05" data-field="gazeStrength">
        </label>
        <label>Horizontal travel <span data-value="maxX"></span>
          <input type="range" min="0" max="40" step="1" data-field="maxX">
        </label>
        <label>Vertical travel <span data-value="maxY"></span>
          <input type="range" min="0" max="30" step="1" data-field="maxY">
        </label>
        <label>Maximum tilt <span data-value="maxRotate"></span>
          <input type="range" min="0" max="10" step="0.5" data-field="maxRotate">
        </label>
        <label>Smoothing <span data-value="smoothing"></span>
          <input type="range" min="0.05" max="1" step="0.05" data-field="smoothing">
        </label>
        <div class="gaze-parallax-directions">
          <label><input type="checkbox" data-field="invertX"> Invert horizontal</label>
          <label><input type="checkbox" data-field="invertY"> Invert vertical</label>
        </div>
        <button type="button" class="btn btn-secondary" data-field="calibrate">Calibrate neutral pose</button>
        <p data-field="status" role="status"></p>
        <p class="help-text">Uses the existing webcam tracker and never requests another camera.</p>
      </div>`;
    mount.appendChild(panel);

    const numberFields = ['headStrength', 'gazeStrength', 'maxX', 'maxY', 'maxRotate', 'smoothing'];
    const enabled = panel.querySelector('[data-field="enabled"]');
    const invertX = panel.querySelector('[data-field="invertX"]');
    const invertY = panel.querySelector('[data-field="invertY"]');
    const status = panel.querySelector('[data-field="status"]');

    function render() {
      const current = controller.getConfig();
      enabled.checked = current.enabled;
      invertX.checked = current.invertX;
      invertY.checked = current.invertY;
      for (const field of numberFields) {
        panel.querySelector(`[data-field="${field}"]`).value = current[field];
        const suffix = field === 'maxRotate' ? ' deg' : (field === 'maxX' || field === 'maxY' ? 'px' : '');
        panel.querySelector(`[data-value="${field}"]`).textContent = `${current[field]}${suffix}`;
      }
      status.textContent = current.calibration
        ? 'Neutral pose calibrated.'
        : 'Start the webcam, face forward, then calibrate.';
    }

    function save() {
      const next = controller.getConfig();
      next.enabled = enabled.checked;
      next.invertX = invertX.checked;
      next.invertY = invertY.checked;
      for (const field of numberFields) {
        next[field] = Number(panel.querySelector(`[data-field="${field}"]`).value);
      }
      const result = controller.update(next);
      status.textContent = result.ok ? 'Settings saved.' : `Validation failed: ${result.error}.`;
      if (result.ok) render();
    }

    enabled.addEventListener('change', save);
    invertX.addEventListener('change', save);
    invertY.addEventListener('change', save);
    for (const field of numberFields) {
      panel.querySelector(`[data-field="${field}"]`).addEventListener('change', save);
    }
    panel.querySelector('[data-field="calibrate"]').addEventListener('click', () => {
      const result = controller.calibrate();
      status.textContent = result.ok ? 'Neutral pose calibrated.' : 'No tracked face is available yet.';
      if (result.ok) render();
    });
    render();
  }

  buildPanel();

  return Object.freeze(controller);
});
