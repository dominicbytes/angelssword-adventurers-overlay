const test = require('node:test');
const assert = require('node:assert/strict');

const { createPluginHost } = require('../public/plugin-host');

test('retains transport readiness for plugins loaded after the connection opens', () => {
  const host = createPluginHost();
  host.notifyTransportOpen();
  assert.equal(host.isTransportOpen(), true);

  host.notifyTransportClosed();
  assert.equal(host.isTransportOpen(), false);
});

test('accepts only display states present in the current model assets', () => {
  const host = createPluginHost();
  host.registerDisplayStateResolver('example-plugin', () => 'neutral_example');

  assert.equal(host.resolveDisplayState({
    baseStateKey: 'neutral_idle',
    assets: { neutral_idle: '/idle.webm', neutral_example: '/example.webm' }
  }), 'neutral_example');

  assert.equal(host.resolveDisplayState({
    baseStateKey: 'neutral_idle',
    assets: { neutral_idle: '/idle.webm' }
  }), 'neutral_idle');
});

test('formats control-to-overlay events without exposing the WebSocket', () => {
  const host = createPluginHost();
  let sent;
  host.setPluginSender(message => {
    sent = message;
    return true;
  });

  assert.equal(host.sendPluginEvent('example-plugin', 'changed', { value: 2 }), true);
  assert.deepEqual(sent, {
    type: 'plugin_event',
    pluginId: 'example-plugin',
    event: 'changed',
    data: { value: 2 }
  });
});

test('replays an overlay event received before the plugin subscribes', () => {
  const host = createPluginHost();
  const message = {
    type: 'plugin_event',
    pluginId: 'example-plugin',
    event: 'restored',
    data: { value: 3 }
  };

  host.emitPluginEvent(message);
  const received = [];
  host.on('plugin-event', event => received.push(event));

  assert.deepEqual(received, [message]);
});

test('publishes sanitized tracking frames to local plugin subscribers', () => {
  const host = createPluginHost();
  const received = [];
  host.on('tracking-frame', frame => received.push(frame));

  const frame = { timestamp: 42, faceDetected: true, blendShapes: { jawOpen: 12 } };
  host.emitTrackingFrame(frame);

  assert.deepEqual(received, [frame]);
});

test('publishes the core microphone analysis without another analyser', () => {
  const host = createPluginHost();
  const received = [];
  host.on('audio-level', level => received.push(level));

  const level = { timestamp: 42, value: 0.4, speaking: true, typing: false };
  host.emitAudioLevel(level);

  assert.deepEqual(received, [level]);
});

test('delegates bounded motion contributions through the host interface', () => {
  const host = createPluginHost();
  const calls = [];
  host.setMotionCompositor({
    set: (ownerId, value) => calls.push(['set', ownerId, value]),
    clear: ownerId => calls.push(['clear', ownerId])
  });

  assert.equal(host.setMotionContribution('reactive-motion', { y: -3 }), true);
  assert.equal(host.clearMotionContribution('reactive-motion'), true);
  assert.deepEqual(calls, [
    ['set', 'reactive-motion', { y: -3 }],
    ['clear', 'reactive-motion']
  ]);
});

test('registers and invokes typed actions through one host interface', async () => {
  const host = createPluginHost();
  const unregister = host.registerAction('state.set', {
    label: 'Set expression',
    parameters: [{ name: 'state', options: ['happy', 'sad'] }],
    invoke: parameters => ({ ok: true, state: parameters.state })
  });

  assert.deepEqual(host.listActions(), [{
    id: 'state.set',
    label: 'Set expression',
    parameters: [{ name: 'state', options: ['happy', 'sad'] }]
  }]);
  assert.deepEqual(await host.invokeAction('state.set', { state: 'happy' }), {
    ok: true,
    state: 'happy'
  });

  unregister();
  assert.deepEqual(await host.invokeAction('state.set', { state: 'sad' }), {
    ok: false,
    error: 'action_unavailable'
  });
});
