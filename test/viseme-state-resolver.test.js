const test = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveVisemeState,
  installBrowserPlugin,
  normalizeSpriteManifest,
  selectSprite,
  selectAnchor
} = require('../addons/viseme-lipsync/plugin/state-resolver');

test('uses an expression-specific viseme asset while the avatar is speaking', () => {
  const state = resolveVisemeState({
    baseStateKey: 'happy_speaking',
    expression: 'happy',
    speaking: true,
    viseme: 'open',
    assets: {
      happy_speaking: '/assets/happy_speaking.webm',
      happy_viseme_open: '/assets/happy_viseme_open.webm'
    }
  });

  assert.equal(state, 'happy_viseme_open');
});

test('falls back to the neutral viseme when the expression has no talking asset', () => {
  const state = resolveVisemeState({
    baseStateKey: 'happy_speaking',
    expression: 'happy',
    speaking: true,
    viseme: 'round',
    assets: {
      neutral_speaking: '/assets/neutral_speaking.webm',
      neutral_viseme_round: '/assets/neutral_viseme_round.webm'
    }
  });

  assert.equal(state, 'neutral_viseme_round');
});

test('returns to the expression idle asset when the detector reports rest', () => {
  const state = resolveVisemeState({
    baseStateKey: 'sad_speaking',
    expression: 'sad',
    speaking: true,
    viseme: 'rest',
    assets: {
      sad_idle: '/assets/sad_idle.webm',
      sad_speaking: '/assets/sad_speaking.webm'
    }
  });

  assert.equal(state, 'sad_idle');
});

test('restores base speaking behavior when the detector becomes inactive', () => {
  let resolver;
  let pluginEventHandler;
  const host = {
    registerDisplayStateResolver(pluginId, candidate) {
      assert.equal(pluginId, 'viseme-lipsync');
      resolver = candidate;
    },
    on(event, handler) {
      assert.equal(event, 'plugin-event');
      pluginEventHandler = handler;
    },
    requestDisplayUpdate() {}
  };

  installBrowserPlugin(host);
  pluginEventHandler({
    pluginId: 'viseme-lipsync',
    event: 'viseme',
    data: { viseme: 'open' }
  });

  const speakingContext = {
    baseStateKey: 'neutral_speaking',
    expression: 'neutral',
    speaking: true,
    assets: {
      neutral_speaking: '/neutral_speaking.webm',
      neutral_viseme_open: '/neutral_viseme_open.webm'
    }
  };
  assert.equal(resolver(speakingContext), 'neutral_viseme_open');

  pluginEventHandler({
    pluginId: 'viseme-lipsync',
    event: 'detector-state',
    data: { active: false }
  });
  assert.equal(resolver(speakingContext), 'neutral_speaking');
});

test('shows a viseme preview while the base microphone state is idle', () => {
  let resolver;
  let pluginEventHandler;
  const host = {
    registerDisplayStateResolver(pluginId, candidate) {
      assert.equal(pluginId, 'viseme-lipsync');
      resolver = candidate;
    },
    on(event, handler) {
      assert.equal(event, 'plugin-event');
      pluginEventHandler = handler;
    },
    requestDisplayUpdate() {}
  };

  installBrowserPlugin(host);
  pluginEventHandler({
    pluginId: 'viseme-lipsync',
    event: 'viseme',
    data: { viseme: 'open', openness: 0.8, preview: true }
  });

  assert.equal(resolver({
    baseStateKey: 'happy_idle',
    expression: 'happy',
    speaking: false,
    assets: {
      happy_idle: '/happy_idle.webm',
      happy_viseme_open: '/happy_viseme_open.webm'
    }
  }), 'happy_viseme_open');
});

test('keeps the base animation active when sprite mode is available', () => {
  const state = resolveVisemeState({
    baseStateKey: 'happy_speaking',
    expression: 'happy',
    speaking: true,
    viseme: 'open',
    spriteMode: true,
    assets: {
      happy_speaking: '/assets/happy_speaking.webm',
      happy_viseme_open: '/assets/happy_viseme_open.webm'
    }
  });

  assert.equal(state, 'happy_speaking');
});

test('selects expression sprites by openness and falls back to neutral', () => {
  const manifest = normalizeSpriteManifest({
    version: 1,
    fps: 24,
    mouth: { size: [120, 80] },
    sprites: {
      neutral: {
        closed: ['sprites/closed.png'],
        open: ['sprites/open-0.png', 'sprites/open-1.png', 'sprites/open-2.png'],
        wide: ['sprites/wide.png'],
        round: ['sprites/round.png']
      },
      happy: {
        open: ['sprites/happy-open-0.png', 'sprites/happy-open-1.png']
      }
    },
    anchors: {
      happy_speaking: [{ x: 40, y: 60, scale: 1, rotation: 0, scaleX: 1 }]
    }
  });

  assert.equal(selectSprite(manifest, 'happy', 'open', 0.9), 'sprites/happy-open-1.png');
  assert.equal(selectSprite(manifest, 'happy', 'round', 0.9), 'sprites/round.png');
});

test('selects the per-frame anchor and wraps at the end of a loop', () => {
  const manifest = normalizeSpriteManifest({
    version: 1,
    fps: 24,
    mouth: { size: [120, 80] },
    sprites: {
      neutral: {
        closed: ['closed.png'],
        open: ['open.png'],
        wide: ['wide.png'],
        round: ['round.png']
      }
    },
    anchors: {
      neutral_speaking: [
        { x: 10, y: 20, scale: 1, rotation: 0, scaleX: 1 },
        { x: 12, y: 22, scale: 0.9, rotation: 0.1, scaleX: 0.8 }
      ]
    }
  });

  assert.deepEqual(selectAnchor(manifest, 'neutral_speaking', 3), {
    x: 12,
    y: 22,
    scale: 0.9,
    rotation: 0.1,
    scaleX: 0.8
  });
});

test('rejects sprite manifests that cannot render every major mouth shape', () => {
  assert.equal(normalizeSpriteManifest({
    version: 1,
    mouth: { size: [120, 80] },
    sprites: { neutral: { open: ['open.png'] } },
    anchors: { neutral_speaking: { x: 10, y: 20 } }
  }), null);
});

test('rejects percent-encoded traversal in sprite paths', () => {
  assert.equal(normalizeSpriteManifest({
    version: 1,
    mouth: { size: [120, 80] },
    sprites: {
      neutral: {
        closed: ['closed.png'],
        open: ['%2e%2e/private.png'],
        wide: ['wide.png'],
        round: ['round.png']
      }
    },
    anchors: { neutral_speaking: { x: 10, y: 20 } }
  }), null);
});
