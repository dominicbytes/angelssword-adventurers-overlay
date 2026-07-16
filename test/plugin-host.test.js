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
