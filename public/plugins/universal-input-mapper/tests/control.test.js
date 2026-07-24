const test = require('node:test');
const assert = require('node:assert/strict');

const { createUniversalInputMapper } = require('../control');

test('maps one configured keyboard edge to a registered action', () => {
  let keyHandler;
  const invocations = [];
  const eventTarget = {
    addEventListener(name, handler) {
      if (name === 'keydown') keyHandler = handler;
    },
    removeEventListener() {}
  };
  const host = {
    listActions: () => [],
    invokeAction: (id, parameters) => invocations.push([id, parameters])
  };
  const mapper = createUniversalInputMapper(host, {
    eventTarget,
    initialConfig: {
      schemaVersion: 1,
      enabled: true,
      mapping: { code: 'KeyH', actionId: 'state.set', parameters: { state: 'happy' } }
    }
  });

  keyHandler({ code: 'KeyH', repeat: false, target: { tagName: 'BODY' }, preventDefault() {} });
  keyHandler({ code: 'KeyH', repeat: true, target: { tagName: 'BODY' }, preventDefault() {} });
  keyHandler({ code: 'KeyH', repeat: false, target: { tagName: 'INPUT' }, preventDefault() {} });

  assert.deepEqual(invocations, [['state.set', { state: 'happy' }]]);
  mapper.destroy();
});
