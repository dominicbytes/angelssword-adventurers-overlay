(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) {
    root.ASVisemeStateResolver = api;
    if (root.ASAPluginHost) api.installBrowserPlugin(root.ASAPluginHost);
  }
})(typeof window !== 'undefined' ? window : null, function (root) {
  'use strict';

  const PLUGIN_ID = 'viseme-lipsync';
  const VISEMES = new Set(['rest', 'closed', 'open', 'wide', 'round']);
  const ACTIVE_VISEMES = ['closed', 'open', 'wide', 'round'];

  function isSafeAssetPath(value) {
    if (typeof value !== 'string' || !value) return false;
    let decoded = value;
    try {
      for (let pass = 0; pass < 2; pass++) {
        const next = decodeURIComponent(decoded);
        if (next === decoded) break;
        decoded = next;
      }
    } catch {
      return false;
    }
    return !decoded.startsWith('/') &&
      !decoded.includes('\\') &&
      !/^[a-z][a-z0-9+.-]*:/i.test(decoded) &&
      decoded.split('/').every(part => part && part !== '.' && part !== '..');
  }

  function normalizeAnchor(anchor) {
    if (!anchor || !Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) return null;
    return {
      x: anchor.x,
      y: anchor.y,
      scale: Number.isFinite(anchor.scale) ? anchor.scale : 1,
      rotation: Number.isFinite(anchor.rotation) ? anchor.rotation : 0,
      scaleX: Number.isFinite(anchor.scaleX) ? anchor.scaleX : 1
    };
  }

  function normalizeSpriteManifest(input) {
    if (!input || input.version !== 1) return null;
    if (!Array.isArray(input.mouth?.size) || input.mouth.size.length !== 2 ||
        !input.mouth.size.every(value => Number.isFinite(value) && value > 0)) return null;

    const neutral = input.sprites?.neutral;
    if (!neutral || !ACTIVE_VISEMES.every(shape =>
      Array.isArray(neutral[shape]) && neutral[shape].length > 0 &&
      neutral[shape].every(isSafeAssetPath))) return null;

    const sprites = {};
    for (const [expression, shapes] of Object.entries(input.sprites)) {
      const validShapes = {};
      for (const [shape, files] of Object.entries(shapes || {})) {
        if (!ACTIVE_VISEMES.includes(shape) || !Array.isArray(files) ||
            !files.length || !files.every(isSafeAssetPath)) continue;
        validShapes[shape] = [...files];
      }
      if (Object.keys(validShapes).length) sprites[expression] = validShapes;
    }

    const anchors = {};
    for (const [state, value] of Object.entries(input.anchors || {})) {
      const values = Array.isArray(value) ? value : [value];
      const normalized = values.map(normalizeAnchor);
      if (normalized.length && normalized.every(Boolean)) anchors[state] = normalized;
    }
    if (!Object.keys(anchors).length) return null;

    return {
      version: 1,
      fps: Number.isFinite(input.fps) && input.fps > 0 ? input.fps : 24,
      mouth: { size: [...input.mouth.size] },
      sprites,
      anchors
    };
  }

  function selectSprite(manifest, expression, viseme, openness) {
    if (!manifest || !ACTIVE_VISEMES.includes(viseme)) return null;
    const files = manifest.sprites[expression]?.[viseme] || manifest.sprites.neutral[viseme];
    if (!files?.length) return null;
    const amount = Math.min(1, Math.max(0, Number(openness) || 0));
    return files[Math.min(files.length - 1, Math.floor(amount * files.length))];
  }

  function selectAnchor(manifest, stateKey, frameIndex) {
    if (!manifest) return null;
    const suffix = stateKey.endsWith('_idle') ? 'idle' : 'speaking';
    const anchors = manifest.anchors[stateKey] ||
      manifest.anchors[`neutral_${suffix}`] ||
      manifest.anchors.default;
    if (!anchors?.length) return null;
    const index = Math.max(0, Math.floor(Number(frameIndex) || 0)) % anchors.length;
    return anchors[index];
  }

  function assetRootFromContext(context) {
    const assetUrl = context.assets[context.baseStateKey] ||
      context.assets[`${context.expression}_idle`] ||
      context.assets.neutral_idle;
    if (typeof assetUrl !== 'string') return null;
    return assetUrl.slice(0, assetUrl.lastIndexOf('/') + 1);
  }

  function createSpriteRenderer(host) {
    if (!root?.document || typeof root.fetch !== 'function') return null;

    const overlay = root.document.getElementById('overlay-container');
    if (!overlay) return null;

    const canvas = root.document.createElement('canvas');
    canvas.id = 'viseme-sprite-layer';
    Object.assign(canvas.style, {
      position: 'absolute',
      left: '50%',
      bottom: '0',
      height: '100%',
      width: 'auto',
      transform: 'translateX(-50%)',
      pointerEvents: 'none',
      zIndex: '9',
      display: 'none'
    });
    overlay.appendChild(canvas);

    const debugEnabled = new URLSearchParams(root.location.search).has('debugmouth');
    const debugLabel = root.document.createElement('div');
    if (debugEnabled) {
      debugLabel.id = 'viseme-sprite-debug';
      Object.assign(debugLabel.style, {
        position: 'fixed',
        top: '10px',
        left: '10px',
        padding: '6px 9px',
        borderRadius: '6px',
        background: 'rgba(0,0,0,.75)',
        color: '#7cff7c',
        font: '12px monospace',
        zIndex: '9999'
      });
      root.document.body.appendChild(debugLabel);
    }

    const context2d = canvas.getContext('2d');
    const manifests = new Map();
    const images = new Map();
    let manifest = null;
    let manifestRoot = null;
    let displayContext = null;
    let viseme = 'rest';
    let openness = 0;
    let detectorActive = false;

    function loadImage(url) {
      if (!images.has(url)) {
        const image = new Image();
        const promise = new Promise((resolve, reject) => {
          image.onload = () => resolve(image);
          image.onerror = () => reject(new Error(`Could not load mouth sprite ${url}`));
        });
        image.src = url;
        images.set(url, promise);
      }
      return images.get(url);
    }

    async function loadManifest(assetRoot) {
      const manifestUrl = `${assetRoot}viseme/manifest.json`;
      try {
        const response = await root.fetch(manifestUrl, { cache: 'no-cache' });
        if (!response.ok) return null;
        const normalized = normalizeSpriteManifest(await response.json());
        if (!normalized) {
          console.warn(`[plugin:${PLUGIN_ID}] Ignoring invalid sprite manifest at ${manifestUrl}`);
          return null;
        }
        normalized.baseUrl = new URL('viseme/', new URL(assetRoot, root.location.origin)).href;
        const files = new Set();
        for (const shapes of Object.values(normalized.sprites)) {
          for (const list of Object.values(shapes)) list.forEach(file => files.add(file));
        }
        await Promise.all([...files].map(file =>
          loadImage(new URL(file, normalized.baseUrl).href)));
        return normalized;
      } catch (error) {
        console.warn(`[plugin:${PLUGIN_ID}] Sprite manifest unavailable:`, error);
        return null;
      }
    }

    function prepare(context) {
      displayContext = context;
      const assetRoot = assetRootFromContext(context);
      if (!assetRoot) return false;

      if (assetRoot !== manifestRoot) {
        manifestRoot = assetRoot;
        manifest = null;
        if (!manifests.has(assetRoot)) manifests.set(assetRoot, loadManifest(assetRoot));
        manifests.get(assetRoot).then(result => {
          if (manifestRoot !== assetRoot) return;
          manifest = result;
          host.requestDisplayUpdate();
        });
      }
      return Boolean(manifest);
    }

    function setDetectorState(active, nextViseme, nextOpenness) {
      detectorActive = active;
      viseme = active ? nextViseme : 'rest';
      openness = active ? Math.min(1, Math.max(0, Number(nextOpenness) || 0)) : 0;
    }

    function clear() {
      context2d.clearRect(0, 0, canvas.width, canvas.height);
      canvas.style.display = 'none';
      if (debugEnabled) debugLabel.textContent = 'sprite: inactive';
    }

    function draw() {
      root.requestAnimationFrame(draw);
      if (!manifest || !displayContext || !detectorActive ||
          viseme === 'rest' || !displayContext.speaking) {
        clear();
        return;
      }

      const layer = root.document.getElementById(`layer-${displayContext.baseStateKey}`);
      const media = layer?.querySelector('video, img');
      if (!media) {
        clear();
        return;
      }

      const mediaWidth = media.videoWidth || media.naturalWidth;
      const mediaHeight = media.videoHeight || media.naturalHeight;
      if (!mediaWidth || !mediaHeight) return;
      if (canvas.width !== mediaWidth || canvas.height !== mediaHeight) {
        canvas.width = mediaWidth;
        canvas.height = mediaHeight;
      }

      const frame = media.tagName === 'VIDEO'
        ? Math.floor(media.currentTime * manifest.fps)
        : 0;
      const anchor = selectAnchor(manifest, displayContext.baseStateKey, frame);
      const spriteFile = selectSprite(manifest, displayContext.expression, viseme, openness);
      if (!anchor || !spriteFile) {
        clear();
        return;
      }

      const spriteUrl = new URL(spriteFile, manifest.baseUrl).href;
      const imagePromise = images.get(spriteUrl);
      if (!imagePromise) return;
      imagePromise.then(image => {
        if (!manifest || spriteFile !== selectSprite(
          manifest,
          displayContext.expression,
          viseme,
          openness
        )) return;
        const [mouthWidth, mouthHeight] = manifest.mouth.size;
        context2d.clearRect(0, 0, canvas.width, canvas.height);
        context2d.save();
        context2d.translate(anchor.x, anchor.y);
        context2d.rotate(anchor.rotation);
        context2d.scale(anchor.scale * anchor.scaleX, anchor.scale);
        context2d.drawImage(image, -mouthWidth / 2, -mouthHeight / 2, mouthWidth, mouthHeight);
        if (debugEnabled) {
          context2d.strokeStyle = '#ff3355';
          context2d.lineWidth = 2 / Math.max(0.01, anchor.scale);
          context2d.strokeRect(-mouthWidth / 2, -mouthHeight / 2, mouthWidth, mouthHeight);
        }
        context2d.restore();
        canvas.style.display = 'block';
        if (debugEnabled) {
          debugLabel.textContent = `sprite: ${viseme} @ ${openness.toFixed(2)} frame ${frame}`;
        }
      });
    }

    root.requestAnimationFrame(draw);
    return { prepare, setDetectorState };
  }

  function resolveVisemeState(context) {
    const previewSpeaking = Boolean(
      context.preview && context.viseme && context.viseme !== 'rest' && !context.speaking
    );
    const baseStateKey = previewSpeaking
      ? `${context.expression}_speaking`
      : context.baseStateKey;
    if (context.spriteMode) return context.spriteBaseStateKey || baseStateKey;
    if (context.viseme === 'rest') {
      const expressionIdleState = `${context.expression}_idle`;
      if (context.assets[expressionIdleState]) return expressionIdleState;
      if (context.assets.neutral_idle) return 'neutral_idle';
    }
    if ((!context.speaking && !previewSpeaking) || !context.viseme) return context.baseStateKey;

    const visemeState = `${context.expression}_viseme_${context.viseme}`;
    if (context.assets[visemeState]) return visemeState;
    if (context.assets[baseStateKey]) return baseStateKey;

    const neutralVisemeState = `neutral_viseme_${context.viseme}`;
    if (context.assets[neutralVisemeState]) return neutralVisemeState;
    if (context.assets.neutral_speaking) return 'neutral_speaking';
    return context.baseStateKey;
  }

  function installBrowserPlugin(host) {
    let currentViseme = null;
    let currentOpenness = 0;
    let detectorActive = false;
    let previewMode = false;
    const spriteRenderer = createSpriteRenderer(host);

    host.registerDisplayStateResolver(PLUGIN_ID, context => {
      const previewSpeaking = Boolean(
        previewMode && currentViseme && currentViseme !== 'rest' && !context.speaking
      );
      let spriteBaseStateKey = context.baseStateKey;
      if (previewSpeaking) {
        const expressionSpeaking = `${context.expression}_speaking`;
        if (context.assets[expressionSpeaking]) spriteBaseStateKey = expressionSpeaking;
        else if (context.assets.neutral_speaking) spriteBaseStateKey = 'neutral_speaking';
      }
      const spriteMode = Boolean(spriteRenderer?.prepare({
        ...context,
        baseStateKey: spriteBaseStateKey,
        speaking: context.speaking || previewSpeaking
      }));
      return resolveVisemeState({
        ...context,
        viseme: detectorActive ? currentViseme : null,
        preview: previewMode,
        spriteMode,
        spriteBaseStateKey
      });
    });

    host.on('plugin-event', message => {
      if (message?.pluginId !== PLUGIN_ID) return;

      if (message.event === 'detector-state' && typeof message?.data?.active === 'boolean') {
        detectorActive = message.data.active;
        previewMode = detectorActive && Boolean(message.data.preview);
        if (!detectorActive) {
          currentViseme = null;
          currentOpenness = 0;
        }
      } else if (message.event === 'viseme' && VISEMES.has(message?.data?.viseme)) {
        detectorActive = true;
        currentViseme = message.data.viseme;
        currentOpenness = Math.min(1, Math.max(0, Number(message.data.openness) || 0));
        if (typeof message.data.preview === 'boolean') previewMode = message.data.preview;
      } else {
        return;
      }
      spriteRenderer?.setDetectorState(detectorActive, currentViseme, currentOpenness);
      host.requestDisplayUpdate();
    });

    host.requestDisplayUpdate();
  }

  return {
    resolveVisemeState,
    installBrowserPlugin,
    normalizeSpriteManifest,
    selectSprite,
    selectAnchor
  };
});
