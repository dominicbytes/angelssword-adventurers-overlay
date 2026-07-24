const test = require('node:test');
const assert = require('node:assert/strict');

const { createObsSceneProfiles } = require('../control');

function createSocketHarness() {
  const sockets = [];
  return {
    sockets,
    createSocket(url, protocol) {
      const listeners = new Map();
      const socket = {
        url,
        protocol,
        bufferedAmount: 0,
        sent: [],
        closeCalls: [],
        addEventListener(name, handler) {
          if (!listeners.has(name)) listeners.set(name, []);
          listeners.get(name).push(handler);
        },
        send(message) { this.sent.push(JSON.parse(message)); },
        close(...args) { this.closeCalls.push(args); },
        async emit(name, value) {
          await Promise.all((listeners.get(name) || []).map(handler => handler(value)));
        }
      };
      sockets.push(socket);
      return socket;
    }
  };
}

test('identifies with the official OBS WebSocket 5.x authentication example', async () => {
  const harness = createSocketHarness();
  const controller = createObsSceneProfiles({ invokeAction() {} }, {
    createSocket: harness.createSocket,
    createRequestId: () => 'request-1'
  });

  controller.connect({ url: 'ws://localhost:4455', password: 'supersecretpassword' });
  const socket = harness.sockets[0];
  assert.equal(socket.protocol, 'obswebsocket.json');
  await socket.emit('message', { data: JSON.stringify({
    op: 0,
    d: {
      rpcVersion: 1,
      authentication: {
        challenge: '+IxH4CnCiqpX1rM9scsNynZzbOe4KhDeYcTNS3PDaeY=',
        salt: 'lM1GncleQOaCu9lT1yeUZhFYnqhsLLP1G5lAGo3ixaI='
      }
    }
  }) });
  assert.deepEqual(socket.sent, [{
    op: 1,
    d: {
      rpcVersion: 1,
      eventSubscriptions: 6,
      authentication: '1Ct943GAT+6YQUUX47Ia/ncufilbe6+oD6lY+5kaCu4='
    }
  }]);
});

test('applies matching action profiles from initial scene and scene-change events', async () => {
  const harness = createSocketHarness();
  const invocations = [];
  const requestIds = ['initial-scene'];
  const controller = createObsSceneProfiles({
    invokeAction: async (actionId, parameters) => {
      invocations.push([actionId, parameters]);
      return { ok: true };
    }
  }, {
    createSocket: harness.createSocket,
    createRequestId: () => requestIds.shift(),
    initialConfig: {
      schemaVersion: 1,
      profiles: [
        {
          sceneName: 'Gameplay',
          actions: [{ actionId: 'state.set', parameters: { state: 'happy' } }]
        },
        {
          sceneName: 'BRB',
          actions: [{ actionId: 'state.set', parameters: { state: 'typing' } }]
        }
      ]
    }
  });

  controller.connect({ url: 'ws://localhost:4455', password: '' });
  const socket = harness.sockets[0];
  await socket.emit('message', { data: JSON.stringify({ op: 0, d: { rpcVersion: 1 } }) });
  await socket.emit('message', { data: JSON.stringify({ op: 2, d: { negotiatedRpcVersion: 1 } }) });
  assert.deepEqual(socket.sent[1], {
    op: 6,
    d: { requestType: 'GetCurrentProgramScene', requestId: 'initial-scene' }
  });

  await socket.emit('message', { data: JSON.stringify({
    op: 7,
    d: {
      requestType: 'GetCurrentProgramScene',
      requestId: 'initial-scene',
      requestStatus: { result: true, code: 100 },
      responseData: { sceneName: 'Gameplay' }
    }
  }) });
  await socket.emit('message', { data: JSON.stringify({
    op: 5,
    d: { eventType: 'CurrentProgramSceneChanged', eventData: { sceneName: 'BRB' } }
  }) });

  assert.deepEqual(invocations, [
    ['state.set', { state: 'happy' }],
    ['state.set', { state: 'typing' }]
  ]);
});

test('pauses requests during a scene collection change and refreshes afterward', async () => {
  const harness = createSocketHarness();
  const requestIds = ['initial', 'refresh', 'switch'];
  const controller = createObsSceneProfiles({ invokeAction() {} }, {
    createSocket: harness.createSocket,
    createRequestId: () => requestIds.shift()
  });

  controller.connect({ url: 'ws://localhost:4455', password: '' });
  const socket = harness.sockets[0];
  await socket.emit('message', { data: JSON.stringify({ op: 0, d: { rpcVersion: 1 } }) });
  await socket.emit('message', { data: JSON.stringify({ op: 2, d: { negotiatedRpcVersion: 1 } }) });
  await socket.emit('message', { data: JSON.stringify({
    op: 5,
    d: { eventType: 'CurrentSceneCollectionChanging', eventData: { sceneCollectionName: 'Shows' } }
  }) });

  assert.deepEqual(await controller.setScene('Gameplay'), { ok: false, error: 'obs_busy' });
  await socket.emit('message', { data: JSON.stringify({
    op: 5,
    d: { eventType: 'CurrentSceneCollectionChanged', eventData: { sceneCollectionName: 'Shows' } }
  }) });
  assert.deepEqual(socket.sent.at(-1), {
    op: 6,
    d: { requestType: 'GetCurrentProgramScene', requestId: 'refresh' }
  });
  const switchResult = controller.setScene('Gameplay');
  assert.deepEqual(socket.sent.at(-1), {
    op: 6,
    d: {
      requestType: 'SetCurrentProgramScene',
      requestId: 'switch',
      requestData: { sceneName: 'Gameplay' }
    }
  });
  await socket.emit('message', { data: JSON.stringify({
    op: 7,
    d: {
      requestType: 'SetCurrentProgramScene',
      requestId: 'switch',
      requestStatus: { result: true, code: 100 },
      responseData: {}
    }
  }) });
  assert.deepEqual(await switchResult, { ok: true, requestId: 'switch' });
});

test('reconnects ordinary closures but not invalidated sessions or manual disconnects', async () => {
  const harness = createSocketHarness();
  const scheduled = [];
  const controller = createObsSceneProfiles({ invokeAction() {} }, {
    createSocket: harness.createSocket,
    schedule: (callback, delay) => scheduled.push({ callback, delay })
  });

  controller.connect({ url: 'ws://localhost:4455', password: '' });
  await harness.sockets[0].emit('close', { code: 1006 });
  assert.equal(controller.getState().connectionState, 'reconnecting');
  assert.equal(scheduled[0].delay, 1000);
  scheduled.shift().callback();
  assert.equal(harness.sockets.length, 2);

  await harness.sockets[1].emit('close', { code: 4011 });
  assert.equal(controller.getState().connectionState, 'invalidated');
  assert.equal(scheduled.length, 0);

  controller.connect({ url: 'ws://localhost:4455', password: '' });
  controller.disconnect();
  await harness.sockets[2].emit('close', { code: 1000 });
  assert.equal(controller.getState().connectionState, 'disconnected');
  assert.equal(scheduled.length, 0);
});

test('disconnects instead of adding OBS WebSocket backpressure', async () => {
  const harness = createSocketHarness();
  const scheduled = [];
  const controller = createObsSceneProfiles({ invokeAction() {} }, {
    createSocket: harness.createSocket,
    createRequestId: () => 'switch',
    schedule: (callback, delay) => scheduled.push({ callback, delay })
  });
  controller.connect({ url: 'ws://localhost:4455', password: '' });
  const socket = harness.sockets[0];
  await socket.emit('message', { data: JSON.stringify({ op: 0, d: { rpcVersion: 1 } }) });
  await socket.emit('message', { data: JSON.stringify({ op: 2, d: { negotiatedRpcVersion: 1 } }) });
  socket.bufferedAmount = (1024 * 1024) + 1;

  assert.deepEqual(await controller.setScene('Gameplay'), { ok: false, error: 'obs_backpressure' });
  assert.deepEqual(socket.closeCalls.at(-1), [1008, 'OBS client backpressure']);
  assert.equal(controller.getState().connectionState, 'backpressure');
  await socket.emit('close', { code: 1008 });
  assert.equal(controller.getState().connectionState, 'reconnecting');
  assert.equal(scheduled[0].delay, 1000);
});

test('reports rejected OBS requests and ignores messages from replaced sockets', async () => {
  const harness = createSocketHarness();
  const requestIds = ['initial', 'switch'];
  const controller = createObsSceneProfiles({ invokeAction() {} }, {
    createSocket: harness.createSocket,
    createRequestId: () => requestIds.shift()
  });

  controller.connect({ url: 'ws://localhost:4455', password: 'old' });
  const oldSocket = harness.sockets[0];
  controller.connect({ url: 'ws://localhost:4455', password: 'new' });
  const socket = harness.sockets[1];
  await oldSocket.emit('message', { data: JSON.stringify({ op: 0, d: { rpcVersion: 1 } }) });
  assert.deepEqual(oldSocket.sent, []);
  assert.deepEqual(socket.sent, []);

  await socket.emit('message', { data: JSON.stringify({ op: 0, d: { rpcVersion: 1 } }) });
  await socket.emit('message', { data: JSON.stringify({ op: 2, d: { negotiatedRpcVersion: 1 } }) });
  const result = controller.setScene('Missing Scene');
  await socket.emit('message', { data: JSON.stringify({
    op: 7,
    d: {
      requestType: 'SetCurrentProgramScene',
      requestId: 'switch',
      requestStatus: { result: false, code: 600, comment: 'No scene was found' }
    }
  }) });
  assert.deepEqual(await result, {
    ok: false,
    error: 'obs_request_failed',
    code: 600,
    comment: 'No scene was found'
  });
});

test('times out unanswered requests and caps pending OBS work', async () => {
  const harness = createSocketHarness();
  const timers = [];
  let requestNumber = 0;
  const controller = createObsSceneProfiles({ invokeAction() {} }, {
    createSocket: harness.createSocket,
    createRequestId: () => `request-${++requestNumber}`,
    setRequestTimer: callback => {
      const timer = { callback };
      timers.push(timer);
      return timer;
    },
    clearRequestTimer() {}
  });

  controller.connect({ url: 'ws://localhost:4455', password: '' });
  const socket = harness.sockets[0];
  await socket.emit('message', { data: JSON.stringify({ op: 2, d: { negotiatedRpcVersion: 1 } }) });

  const pending = controller.setScene('Gameplay');
  timers[1].callback();
  assert.deepEqual(await pending, { ok: false, error: 'obs_timeout' });

  const queued = Array.from({ length: 63 }, () => controller.setScene('Gameplay'));
  assert.deepEqual(await controller.setScene('Overflow'), { ok: false, error: 'obs_request_limit' });
  controller.disconnect();
  await Promise.all(queued);
});

test('serializes profiles so the latest scene finishes last', async () => {
  const harness = createSocketHarness();
  const order = [];
  let releaseGameplay;
  const controller = createObsSceneProfiles({
    invokeAction: async (_actionId, parameters) => {
      order.push(`${parameters.scene}-start`);
      if (parameters.scene === 'Gameplay') {
        await new Promise(resolve => { releaseGameplay = resolve; });
      }
      order.push(`${parameters.scene}-end`);
      return { ok: true };
    }
  }, {
    createSocket: harness.createSocket,
    initialConfig: {
      schemaVersion: 1,
      profiles: [
        { sceneName: 'Gameplay', actions: [{ actionId: 'state.set', parameters: { scene: 'Gameplay' } }] },
        { sceneName: 'BRB', actions: [{ actionId: 'state.set', parameters: { scene: 'BRB' } }] }
      ]
    }
  });

  controller.connect({ url: 'ws://localhost:4455', password: '' });
  const socket = harness.sockets[0];
  const gameplay = socket.emit('message', { data: JSON.stringify({
    op: 5,
    d: { eventType: 'CurrentProgramSceneChanged', eventData: { sceneName: 'Gameplay' } }
  }) });
  await Promise.resolve();
  const brb = socket.emit('message', { data: JSON.stringify({
    op: 5,
    d: { eventType: 'CurrentProgramSceneChanged', eventData: { sceneName: 'BRB' } }
  }) });
  await Promise.resolve();
  assert.deepEqual(order, ['Gameplay-start']);
  releaseGameplay();
  await Promise.all([gameplay, brb]);
  assert.deepEqual(order, ['Gameplay-start', 'Gameplay-end', 'BRB-start', 'BRB-end']);
});

test('persists only validated loopback profiles and never stores the OBS password', () => {
  let persisted = null;
  const controller = createObsSceneProfiles({ invokeAction() {} }, {
    storage: { getItem: () => null, setItem: (_key, value) => { persisted = value; } },
    createSocket: () => ({ addEventListener() {}, close() {} })
  });

  assert.deepEqual(controller.update({
    schemaVersion: 1,
    url: 'ws://remote.example:4455',
    profiles: []
  }), { ok: false, error: 'non_loopback_url' });
  assert.equal(persisted, null);

  const valid = {
    schemaVersion: 1,
    url: 'ws://localhost:4455',
    profiles: [{
      sceneName: 'Gameplay',
      actions: [{ actionId: 'state.set', parameters: { state: 'happy' } }]
    }]
  };
  assert.deepEqual(controller.update(valid), { ok: true });
  controller.connect({ url: valid.url, password: 'do-not-store-this' });
  assert.deepEqual(JSON.parse(persisted), valid);
  assert.equal(persisted.includes('do-not-store-this'), false);
});

test('registers standalone OBS actions and unregisters them on destroy', async () => {
  const registrations = new Map();
  const unregistered = [];
  const controller = createObsSceneProfiles({
    invokeAction() {},
    registerAction(actionId, definition) {
      registrations.set(actionId, definition);
      return () => unregistered.push(actionId);
    }
  }, {
    createSocket: () => ({ addEventListener() {}, close() {} })
  });

  assert.deepEqual([...registrations], [
    ['obs.scene.set', {
      label: 'Switch OBS program scene',
      parameters: [{ name: 'sceneName', label: 'Scene', options: [] }],
      invoke: registrations.get('obs.scene.set').invoke
    }],
    ['obs.profile.reapply', {
      label: 'Reapply current OBS scene profile',
      invoke: registrations.get('obs.profile.reapply').invoke
    }]
  ]);
  assert.deepEqual(
    await registrations.get('obs.profile.reapply').invoke(),
    { ok: false, error: 'scene_unavailable' }
  );

  controller.destroy();
  assert.deepEqual(unregistered, ['obs.scene.set', 'obs.profile.reapply']);
});
