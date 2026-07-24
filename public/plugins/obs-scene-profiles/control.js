(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = { createObsSceneProfiles: factory };
  }
  if (root?.ASAPluginHost && root.document) {
    root.ASObsSceneProfiles = factory(root.ASAPluginHost, {
      document: root.document,
      storage: root.localStorage,
      WebSocket: root.WebSocket,
      crypto: root.crypto,
      defaultUrl: `ws://${root.location.hostname}:4455`
    });
  }
})(typeof window !== 'undefined' ? window : null, function createObsSceneProfiles(host, options) {
  'use strict';

  options = options || {};
  const createSocket = options.createSocket || ((url, protocol) => new options.WebSocket(url, protocol));
  const createRequestId = options.createRequestId || (() => globalThis.crypto.randomUUID());
  const schedule = options.schedule || ((callback, delay) => setTimeout(callback, delay));
  const setRequestTimer = options.setRequestTimer || ((callback, delay) => {
    const timer = setTimeout(callback, delay);
    timer.unref?.();
    return timer;
  });
  const clearRequestTimer = options.clearRequestTimer || (timer => clearTimeout(timer));
  const requestTimeoutMs = options.requestTimeoutMs || 5000;
  const maxPendingRequests = 64;
  const op = Object.freeze({ hello: 0, identify: 1, identified: 2, event: 5, request: 6, response: 7 });
  const eventSubscriptions = (1 << 1) | (1 << 2);
  const storageKey = 'as-plugin-obs-scene-profiles';
  const defaultUrl = options.defaultUrl || 'ws://localhost:4455';
  let socket = null;
  let connection = null;
  let connectionState = 'disconnected';
  let currentScene = null;
  let obsBusy = false;
  let reconnectAttempt = 0;
  let manualDisconnect = false;
  let stateListener = null;
  let profileQueue = Promise.resolve();
  const pendingRequests = new Map();

  function copy(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function normalize(value) {
    return {
      schemaVersion: 1,
      url: typeof value?.url === 'string' ? value.url : defaultUrl,
      profiles: Array.isArray(value?.profiles) ? copy(value.profiles) : []
    };
  }

  function validateUrl(value) {
    let parsed;
    try {
      parsed = new URL(value);
    } catch {
      return { ok: false, error: 'invalid_url' };
    }
    if (!['ws:', 'wss:'].includes(parsed.protocol)) return { ok: false, error: 'invalid_url' };
    if (!['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)) {
      return { ok: false, error: 'non_loopback_url' };
    }
    return { ok: true };
  }

  function validate(candidate) {
    if (!candidate || candidate.schemaVersion !== 1 || !Array.isArray(candidate.profiles)) {
      return { ok: false, error: 'invalid_schema' };
    }
    const urlResult = validateUrl(candidate.url);
    if (!urlResult.ok) return urlResult;
    if (candidate.profiles.length > 64) return { ok: false, error: 'profile_limit' };
    const sceneNames = new Set();
    for (const profile of candidate.profiles) {
      if (!profile || typeof profile.sceneName !== 'string' || !profile.sceneName ||
          !Array.isArray(profile.actions) || profile.actions.length > 32) {
        return { ok: false, error: 'invalid_profile', sceneName: profile?.sceneName || null };
      }
      if (sceneNames.has(profile.sceneName)) {
        return { ok: false, error: 'duplicate_scene_profile', sceneName: profile.sceneName };
      }
      sceneNames.add(profile.sceneName);
      for (const action of profile.actions) {
        if (!action || typeof action.actionId !== 'string' || !action.actionId ||
            !action.parameters || typeof action.parameters !== 'object' || Array.isArray(action.parameters)) {
          return { ok: false, error: 'invalid_action', sceneName: profile.sceneName };
        }
      }
    }
    return { ok: true };
  }

  function load() {
    let candidate = options.initialConfig;
    if (!candidate) {
      try {
        candidate = JSON.parse(options.storage?.getItem(storageKey) || 'null');
      } catch {
        candidate = null;
      }
    }
    const normalized = normalize(candidate);
    return validate(normalized).ok ? normalized : normalize(null);
  }

  let config = load();

  function toBase64(bytes) {
    if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }

  async function sha256Base64(value) {
    const cryptoRef = options.crypto || globalThis.crypto;
    const bytes = new TextEncoder().encode(value);
    return toBase64(new Uint8Array(await cryptoRef.subtle.digest('SHA-256', bytes)));
  }

  async function createAuthentication(password, authentication) {
    const secret = await sha256Base64(password + authentication.salt);
    return sha256Base64(secret + authentication.challenge);
  }

  function send(message) {
    if (!socket) return false;
    if (socket.bufferedAmount > 1024 * 1024) {
      const congestedSocket = socket;
      connectionState = 'backpressure';
      notifyState();
      congestedSocket.close(1008, 'OBS client backpressure');
      return false;
    }
    socket.send(JSON.stringify(message));
    return true;
  }

  function request(requestType, requestData) {
    if (pendingRequests.size >= maxPendingRequests) {
      return { ok: false, error: 'obs_request_limit' };
    }
    const requestId = createRequestId();
    let resolveCompletion;
    const completion = new Promise(resolve => { resolveCompletion = resolve; });
    const timer = setRequestTimer(() => {
      if (!pendingRequests.delete(requestId)) return;
      resolveCompletion({ ok: false, error: 'obs_timeout' });
    }, requestTimeoutMs);
    pendingRequests.set(requestId, { requestType, resolveCompletion, timer });
    const data = { requestType, requestId };
    if (requestData) data.requestData = requestData;
    if (!send({ op: op.request, d: data })) {
      pendingRequests.delete(requestId);
      clearRequestTimer(timer);
      resolveCompletion({ ok: false, error: 'obs_backpressure' });
      return { ok: false, error: 'obs_backpressure' };
    }
    return { ok: true, requestId, completion };
  }

  async function applyProfile(sceneName) {
    const profile = config.profiles.find(candidate => candidate.sceneName === sceneName);
    if (!profile) return { ok: true, matched: false };
    for (const action of profile.actions) {
      const result = await host.invokeAction(action.actionId, action.parameters);
      if (!result?.ok) return { ok: false, error: 'action_failed', actionId: action.actionId };
    }
    return { ok: true, matched: true };
  }

  function queueScene(sceneName) {
    currentScene = sceneName;
    notifyState();
    const application = profileQueue.then(() => applyProfile(sceneName));
    profileQueue = application.catch(() => {});
    return application;
  }

  function clearPending(error) {
    for (const pending of pendingRequests.values()) {
      clearRequestTimer(pending.timer);
      pending.resolveCompletion({ ok: false, error });
    }
    pendingRequests.clear();
  }

  async function handleMessage(event, password) {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    if (message.op === op.hello) {
      const identify = {
        rpcVersion: 1,
        eventSubscriptions
      };
      if (message.d?.authentication) {
        identify.authentication = await createAuthentication(password || '', message.d.authentication);
      }
      send({ op: op.identify, d: identify });
    } else if (message.op === op.identified) {
      connectionState = 'connected';
      reconnectAttempt = 0;
      notifyState();
      request('GetCurrentProgramScene');
    } else if (message.op === op.response) {
      const pending = pendingRequests.get(message.d?.requestId);
      if (!pending) return;
      pendingRequests.delete(message.d.requestId);
      clearRequestTimer(pending.timer);
      if (!message.d.requestStatus?.result) {
        pending.resolveCompletion({
          ok: false,
          error: 'obs_request_failed',
          code: message.d.requestStatus?.code,
          comment: message.d.requestStatus?.comment
        });
        return;
      }
      pending.resolveCompletion({ ok: true, responseData: message.d.responseData || {} });
      if (pending.requestType === 'GetCurrentProgramScene') {
        await queueScene(message.d.responseData?.sceneName || message.d.responseData?.currentProgramSceneName);
      }
    } else if (message.op === op.event) {
      if (message.d?.eventType === 'CurrentProgramSceneChanged') {
        await queueScene(message.d.eventData?.sceneName);
      } else if (message.d?.eventType === 'CurrentSceneCollectionChanging') {
        obsBusy = true;
        notifyState();
      } else if (message.d?.eventType === 'CurrentSceneCollectionChanged') {
        obsBusy = false;
        notifyState();
        request('GetCurrentProgramScene');
      }
    }
  }

  function notifyState() {
    if (stateListener) stateListener({ connectionState, currentScene, obsBusy });
  }

  const controller = {
    connect(connection) {
      if (!connection || typeof connection.url !== 'string') {
        return { ok: false, error: 'invalid_connection' };
      }
      const urlResult = validateUrl(connection.url);
      if (!urlResult.ok) return urlResult;
      if (socket) {
        const previous = socket;
        socket = null;
        previous.close();
      }
      manualDisconnect = false;
      return openConnection(connection);
    },
    disconnect() {
      manualDisconnect = true;
      const previous = socket;
      socket = null;
      if (previous) previous.close();
      connection = null;
      clearPending('obs_disconnected');
      connectionState = 'disconnected';
      notifyState();
    },
    async setScene(sceneName) {
      if (connectionState !== 'connected') return { ok: false, error: 'obs_disconnected' };
      if (obsBusy) return { ok: false, error: 'obs_busy' };
      if (typeof sceneName !== 'string' || !sceneName) return { ok: false, error: 'invalid_scene' };
      const pending = request('SetCurrentProgramScene', { sceneName });
      if (!pending.ok) return pending;
      const result = await pending.completion;
      return result.ok ? { ok: true, requestId: pending.requestId } : result;
    },
    update(nextConfig) {
      const candidate = normalize(nextConfig);
      const result = validate(candidate);
      if (!result.ok) return result;
      config = candidate;
      options.storage?.setItem(storageKey, JSON.stringify(config));
      return { ok: true };
    },
    getConfig() {
      return copy(config);
    },
    onStateChange(listener) {
      stateListener = typeof listener === 'function' ? listener : null;
      notifyState();
      return () => {
        if (stateListener === listener) stateListener = null;
      };
    },
    async reapplyProfile() {
      if (!currentScene) return { ok: false, error: 'scene_unavailable' };
      return queueScene(currentScene);
    },
    destroy() {
      unregisterSetScene?.();
      unregisterReapply?.();
      controller.disconnect();
    },
    getState() {
      return { connectionState, currentScene, obsBusy };
    }
  };

  function openConnection(nextConnection) {
      connection = { url: nextConnection.url, password: nextConnection.password || '' };
      connectionState = 'connecting';
      notifyState();
      const connectedSocket = createSocket(connection.url, 'obswebsocket.json');
      socket = connectedSocket;
      connectedSocket.addEventListener('message', event => {
        if (socket !== connectedSocket) return;
        return handleMessage(event, nextConnection.password || '').catch(() => {
          connectionState = 'error';
          notifyState();
        });
      });
      connectedSocket.addEventListener('close', event => {
        if (socket !== connectedSocket || manualDisconnect) return;
        socket = null;
        clearPending('obs_disconnected');
        if (event.code === 4011 || event.code === 4009) {
          connectionState = event.code === 4011 ? 'invalidated' : 'authentication_failed';
          notifyState();
          return;
        }
        connectionState = 'reconnecting';
        notifyState();
        const delay = Math.min(1000 * (2 ** reconnectAttempt), 30000);
        reconnectAttempt += 1;
        schedule(() => {
          if (connectionState === 'reconnecting' && connection) openConnection(connection);
        }, delay);
      });
      return { ok: true };
  }

  const unregisterSetScene = host.registerAction?.('obs.scene.set', {
    label: 'Switch OBS program scene',
    parameters: [{ name: 'sceneName', label: 'Scene', options: [] }],
    invoke: ({ sceneName }) => controller.setScene(sceneName)
  });
  const unregisterReapply = host.registerAction?.('obs.profile.reapply', {
    label: 'Reapply current OBS scene profile',
    invoke: () => controller.reapplyProfile()
  });

  function buildPanel() {
    const documentRef = options.document;
    const mount = documentRef?.getElementById('plugin-panels');
    if (!mount) return;
    const panel = documentRef.createElement('section');
    panel.className = 'card obs-scene-profiles-panel';
    panel.innerHTML = `
      <div class="card-header"><h2>OBS Scene-Aware Profiles</h2></div>
      <div class="card-body">
        <label>OBS WebSocket URL <input type="text" data-field="url"></label>
        <label>Password <input type="password" data-field="password" autocomplete="current-password"></label>
        <div class="obs-profile-buttons">
          <button type="button" class="btn btn-primary" data-field="connect">Connect</button>
          <button type="button" class="btn btn-secondary" data-field="disconnect">Disconnect</button>
        </div>
        <p data-field="connection-status" role="status"></p>
        <details>
          <summary>Edit scene profiles</summary>
          <textarea data-field="profiles" rows="10"></textarea>
          <button type="button" class="btn btn-secondary" data-field="save">Validate and save</button>
        </details>
        <p data-field="save-status" role="status"></p>
        <p class="help-text">The password stays in memory only. Connections are restricted to this computer.</p>
      </div>`;
    mount.appendChild(panel);
    const url = panel.querySelector('[data-field="url"]');
    const password = panel.querySelector('[data-field="password"]');
    const profiles = panel.querySelector('[data-field="profiles"]');
    const connectionStatus = panel.querySelector('[data-field="connection-status"]');
    const saveStatus = panel.querySelector('[data-field="save-status"]');
    url.value = config.url;
    profiles.value = JSON.stringify(config.profiles, null, 2);

    controller.onStateChange(state => {
      connectionStatus.textContent = state.currentScene
        ? `${state.connectionState}; scene: ${state.currentScene}`
        : state.connectionState;
    });
    panel.querySelector('[data-field="connect"]').addEventListener('click', () => {
      const result = controller.connect({ url: url.value.trim(), password: password.value });
      if (!result.ok) connectionStatus.textContent = result.error;
    });
    panel.querySelector('[data-field="disconnect"]').addEventListener('click', () => controller.disconnect());
    panel.querySelector('[data-field="save"]').addEventListener('click', () => {
      let parsedProfiles;
      try {
        parsedProfiles = JSON.parse(profiles.value);
      } catch {
        saveStatus.textContent = 'Invalid JSON.';
        return;
      }
      const result = controller.update({ schemaVersion: 1, url: url.value.trim(), profiles: parsedProfiles });
      saveStatus.textContent = result.ok ? 'Profiles saved.' : `Validation failed: ${result.error}.`;
    });
  }

  buildPanel();

  return Object.freeze(controller);
});
