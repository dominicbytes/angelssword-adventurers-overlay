const test = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveVisemeState,
  installBrowserPlugin
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
