(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = { createUniversalInputMapper: factory };
  }
  if (root?.ASAPluginHost && root.document) {
    factory(root.ASAPluginHost, {
      eventTarget: root,
      document: root.document,
      storage: root.localStorage
    });
  }
})(typeof window !== 'undefined' ? window : null, function createUniversalInputMapper(host, options) {
  'use strict';

  options = options || {};
  const eventTarget = options.eventTarget;
  const documentRef = options.document || null;
  const storage = options.storage || null;
  const storageKey = 'as-plugin-universal-input-mapper';
  let capturing = false;

  function defaults() {
    return {
      schemaVersion: 1,
      enabled: false,
      mapping: { code: '', actionId: 'state.set', parameters: { state: 'happy' } }
    };
  }

  function normalize(value) {
    const fallback = defaults();
    if (!value || value.schemaVersion !== 1) return fallback;
    return {
      schemaVersion: 1,
      enabled: value.enabled === true,
      mapping: {
        code: typeof value.mapping?.code === 'string' ? value.mapping.code : '',
        actionId: typeof value.mapping?.actionId === 'string' ? value.mapping.actionId : 'state.set',
        parameters: value.mapping?.parameters && typeof value.mapping.parameters === 'object'
          ? { ...value.mapping.parameters }
          : {}
      }
    };
  }

  function load() {
    if (options.initialConfig) return normalize(options.initialConfig);
    try {
      return normalize(JSON.parse(storage?.getItem(storageKey) || 'null'));
    } catch {
      return defaults();
    }
  }

  let config = load();

  function persist() {
    storage?.setItem(storageKey, JSON.stringify(config));
  }

  function handleKey(event) {
    if (!config.enabled || capturing || event.repeat || event.code !== config.mapping.code) return;
    const tagName = event.target?.tagName;
    if (['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(tagName)) return;
    event.preventDefault?.();
    host.invokeAction(config.mapping.actionId, config.mapping.parameters);
  }

  eventTarget?.addEventListener('keydown', handleKey);

  const controller = {
    update(nextConfig) {
      config = normalize(nextConfig);
      persist();
    },
    getConfig() {
      return normalize(config);
    },
    destroy() {
      eventTarget?.removeEventListener('keydown', handleKey);
    }
  };

  function buildPanel() {
    const mount = documentRef?.getElementById('plugin-panels');
    if (!mount) return;
    const actions = host.listActions();
    const panel = documentRef.createElement('section');
    panel.className = 'card universal-input-mapper-panel';
    panel.innerHTML = `
      <div class="card-header"><h2>Universal Input Mapper</h2></div>
      <div class="card-body">
        <label class="input-mapper-toggle"><input type="checkbox" data-field="enabled"> Enable mapping</label>
        <label>Keyboard input <button type="button" class="btn btn-secondary" data-field="key"></button></label>
        <label>Action <select data-field="action"></select></label>
        <label data-parameter-row>Value <select data-field="parameter"></select></label>
        <button type="button" class="btn btn-primary" data-field="save">Save mapping</button>
        <p class="help-text">Keyboard mappings work while the control page has focus.</p>
      </div>`;
    mount.appendChild(panel);

    const enabled = panel.querySelector('[data-field="enabled"]');
    const keyButton = panel.querySelector('[data-field="key"]');
    const actionSelect = panel.querySelector('[data-field="action"]');
    const parameterRow = panel.querySelector('[data-parameter-row]');
    const parameterSelect = panel.querySelector('[data-field="parameter"]');
    const saveButton = panel.querySelector('[data-field="save"]');
    let selectedCode = config.mapping.code;

    for (const action of actions) {
      const option = documentRef.createElement('option');
      option.value = action.id;
      option.textContent = action.label;
      actionSelect.appendChild(option);
    }
    if (actions.some(action => action.id === config.mapping.actionId)) {
      actionSelect.value = config.mapping.actionId;
    }

    function renderParameter() {
      const action = actions.find(candidate => candidate.id === actionSelect.value);
      const parameter = action?.parameters?.[0];
      parameterSelect.replaceChildren();
      parameterRow.hidden = !parameter;
      if (!parameter) return;
      for (const value of parameter.options || []) {
        const option = documentRef.createElement('option');
        option.value = value;
        option.textContent = value;
        parameterSelect.appendChild(option);
      }
      if (config.mapping.actionId === action.id && config.mapping.parameters[parameter.name] !== undefined) {
        parameterSelect.value = config.mapping.parameters[parameter.name];
      }
      parameterSelect.dataset.name = parameter.name;
    }

    enabled.checked = config.enabled;
    keyButton.textContent = selectedCode || 'Press a key';
    renderParameter();
    actionSelect.addEventListener('change', renderParameter);
    keyButton.addEventListener('click', () => {
      capturing = true;
      keyButton.textContent = 'Waiting...';
      const capture = event => {
        event.preventDefault();
        selectedCode = event.code;
        keyButton.textContent = selectedCode;
        capturing = false;
        eventTarget.removeEventListener('keydown', capture, true);
      };
      eventTarget.addEventListener('keydown', capture, true);
    });
    saveButton.addEventListener('click', () => {
      const parameters = parameterRow.hidden ? {} : { [parameterSelect.dataset.name]: parameterSelect.value };
      controller.update({
        schemaVersion: 1,
        enabled: enabled.checked,
        mapping: { code: selectedCode, actionId: actionSelect.value, parameters }
      });
      saveButton.textContent = 'Saved';
      setTimeout(() => { saveButton.textContent = 'Save mapping'; }, 1000);
    });
  }

  buildPanel();
  return Object.freeze(controller);
});
