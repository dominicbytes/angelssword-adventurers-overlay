const test = require('node:test');
const assert = require('node:assert/strict');

const { createPluginEventState } = require('../lib/plugin-event-state');

test('replays the latest event for a plugin after an overlay reconnects', () => {
  const state = createPluginEventState();
  state.remember({
    type: 'plugin_event',
    pluginId: 'viseme-lipsync',
    event: 'viseme',
    data: { viseme: 'open' }
  });
  state.remember({
    type: 'plugin_event',
    pluginId: 'viseme-lipsync',
    event: 'detector-state',
    data: { active: false }
  });

  const replayed = [];
  state.replay(message => replayed.push(message));

  assert.deepEqual(replayed, [{
    type: 'plugin_event',
    pluginId: 'viseme-lipsync',
    event: 'detector-state',
    data: { active: false }
  }]);
});
