(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = { createUniversalInputMapper: factory };
  }
  if (root?.ASAPluginHost && root.document) {
    root.ASUniversalInputMapper = factory(root.ASAPluginHost, {
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
  let captureHandler = null;
  let activeContext = 'global';

  function defaults() {
    return {
      schemaVersion: 2,
      enabled: false,
      mappings: []
    };
  }

  function normalizeAction(value) {
    if (!value || typeof value.actionId !== 'string' || !value.actionId) return null;
    return {
      actionId: value.actionId,
      parameters: value.parameters && typeof value.parameters === 'object'
        ? { ...value.parameters }
        : {}
    };
  }

  function normalizeMapping(value, index) {
    const mode = ['press', 'hold', 'toggle'].includes(value?.mode) ? value.mode : 'press';
    return {
      id: typeof value?.id === 'string' && value.id ? value.id : `mapping-${index + 1}`,
      code: typeof value?.code === 'string' ? value.code : '',
      context: typeof value?.context === 'string' && value.context ? value.context : 'global',
      mode,
      press: normalizeAction(value?.press),
      release: normalizeAction(value?.release)
    };
  }

  function normalize(value) {
    if (value?.schemaVersion === 1) {
      const legacy = value.mapping || {};
      return {
        schemaVersion: 2,
        enabled: value.enabled === true,
        mappings: legacy.code && legacy.actionId ? [{
          id: 'mapping-1',
          code: legacy.code,
          context: 'global',
          mode: 'press',
          press: normalizeAction(legacy),
          release: null
        }] : []
      };
    }
    if (!value || value.schemaVersion !== 2 || !Array.isArray(value.mappings)) return defaults();
    return {
      schemaVersion: 2,
      enabled: value.enabled === true,
      mappings: value.mappings.map(normalizeMapping)
    };
  }

  function findConflicts(value) {
    const bindingsByCode = new Map();
    for (const mapping of value.mappings) {
      if (!mapping.code) continue;
      if (!bindingsByCode.has(mapping.code)) bindingsByCode.set(mapping.code, []);
      bindingsByCode.get(mapping.code).push(mapping);
    }
    const conflicts = [];
    for (const [code, mappings] of bindingsByCode) {
      if (mappings.length > 1 && mappings.some(mapping => mapping.context === '*')) {
        conflicts.push({ code, context: '*', mappingIds: mappings.map(mapping => mapping.id) });
        continue;
      }
      const mappingsByContext = new Map();
      for (const mapping of mappings) {
        if (!mappingsByContext.has(mapping.context)) mappingsByContext.set(mapping.context, []);
        mappingsByContext.get(mapping.context).push(mapping.id);
      }
      for (const [context, mappingIds] of mappingsByContext) {
        if (mappingIds.length > 1) conflicts.push({ code, context, mappingIds });
      }
    }
    return conflicts;
  }

  function findDuplicateIds(value) {
    const counts = new Map();
    for (const mapping of value.mappings) counts.set(mapping.id, (counts.get(mapping.id) || 0) + 1);
    return [...counts].filter(([, count]) => count > 1).map(([id]) => id);
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
  const pressedCodes = new Set();
  const heldMappings = new Map();
  const toggledMappings = new Set();

  function persist() {
    storage?.setItem(storageKey, JSON.stringify(config));
  }

  function currentContext() {
    return typeof options.getContext === 'function' ? options.getContext() || 'global' : activeContext;
  }

  function isEditableTarget(event) {
    const tagName = event.target?.tagName;
    return ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(tagName) || event.target?.isContentEditable;
  }

  function invoke(action) {
    if (action) host.invokeAction(action.actionId, action.parameters);
  }

  function findMapping(code) {
    const context = currentContext();
    return config.mappings.find(mapping => (
      mapping.code === code && (mapping.context === context || mapping.context === '*')
    ));
  }

  function handleKeyDown(event) {
    if (!config.enabled || capturing || event.repeat || pressedCodes.has(event.code) || isEditableTarget(event)) return;
    const mapping = findMapping(event.code);
    if (!mapping || !mapping.press) return;
    pressedCodes.add(event.code);
    event.preventDefault?.();
    if (mapping.mode === 'toggle') {
      if (toggledMappings.has(mapping.id)) {
        invoke(mapping.release);
        toggledMappings.delete(mapping.id);
      } else {
        invoke(mapping.press);
        toggledMappings.add(mapping.id);
      }
      return;
    }
    invoke(mapping.press);
    if (mapping.mode === 'hold') heldMappings.set(event.code, mapping);
  }

  function handleKeyUp(event) {
    pressedCodes.delete(event.code);
    const mapping = heldMappings.get(event.code);
    if (!mapping) return;
    heldMappings.delete(event.code);
    event.preventDefault?.();
    invoke(mapping.release);
  }

  function releaseActiveMappings() {
    for (const mapping of heldMappings.values()) invoke(mapping.release);
    for (const mappingId of toggledMappings) {
      invoke(config.mappings.find(mapping => mapping.id === mappingId)?.release);
    }
    pressedCodes.clear();
    heldMappings.clear();
    toggledMappings.clear();
  }

  eventTarget?.addEventListener('keydown', handleKeyDown);
  eventTarget?.addEventListener('keyup', handleKeyUp);

  const controller = {
    update(nextConfig) {
      const candidate = normalize(nextConfig);
      const duplicateIds = findDuplicateIds(candidate);
      if (duplicateIds.length) return { ok: false, error: 'duplicate_mapping_id', mappingIds: duplicateIds };
      const conflicts = findConflicts(candidate);
      if (conflicts.length) return { ok: false, error: 'mapping_conflict', conflicts };
      releaseActiveMappings();
      config = candidate;
      persist();
      return { ok: true };
    },
    getConfig() {
      return normalize(config);
    },
    exportConfig() {
      return JSON.stringify(config, null, 2);
    },
    importConfig(serialized) {
      let parsed;
      try {
        parsed = JSON.parse(serialized);
      } catch {
        return { ok: false, error: 'invalid_json' };
      }
      if (!parsed || ![1, 2].includes(parsed.schemaVersion)) {
        return { ok: false, error: 'unsupported_schema' };
      }
      return controller.update(parsed);
    },
    setContext(context) {
      if (typeof context !== 'string' || !context.trim()) return { ok: false, error: 'invalid_context' };
      const nextContext = context.trim();
      if (nextContext !== activeContext) releaseActiveMappings();
      activeContext = nextContext;
      return { ok: true, context: activeContext };
    },
    getContext() {
      return currentContext();
    },
    destroy() {
      releaseActiveMappings();
      eventTarget?.removeEventListener('keydown', handleKeyDown);
      eventTarget?.removeEventListener('keyup', handleKeyUp);
      if (captureHandler) eventTarget?.removeEventListener('keydown', captureHandler, true);
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
        <label class="input-mapper-toggle"><input type="checkbox" data-field="enabled"> Enable mappings</label>
        <label>Active context <input type="text" data-field="active-context" value="global"></label>
        <div class="input-mapper-list" data-field="mapping-list"></div>
        <label>Keyboard input <button type="button" class="btn btn-secondary" data-field="key"></button></label>
        <label>Context <input type="text" data-field="context" value="global"></label>
        <label>Mode
          <select data-field="mode">
            <option value="press">Press</option>
            <option value="hold">Hold until key release</option>
            <option value="toggle">Toggle on/off</option>
          </select>
        </label>
        <label>Press action <select data-field="press-action"></select></label>
        <label data-press-parameter-row>Press value <select data-field="press-parameter"></select></label>
        <div data-release-fields>
          <label>Release action <select data-field="release-action"></select></label>
          <label data-release-parameter-row>Release value <select data-field="release-parameter"></select></label>
        </div>
        <button type="button" class="btn btn-primary" data-field="add">Add mapping</button>
        <p class="input-mapper-status" data-field="status" role="status"></p>
        <details>
          <summary>Import or export configuration</summary>
          <textarea data-field="configuration" rows="7"></textarea>
          <div class="input-mapper-buttons">
            <button type="button" class="btn btn-secondary" data-field="export">Export</button>
            <button type="button" class="btn btn-secondary" data-field="import">Import</button>
          </div>
        </details>
        <p class="help-text">Mappings work while the control page has focus. Context defaults to global.</p>
      </div>`;
    mount.appendChild(panel);

    const enabled = panel.querySelector('[data-field="enabled"]');
    const activeContextInput = panel.querySelector('[data-field="active-context"]');
    const mappingList = panel.querySelector('[data-field="mapping-list"]');
    const keyButton = panel.querySelector('[data-field="key"]');
    const contextInput = panel.querySelector('[data-field="context"]');
    const modeSelect = panel.querySelector('[data-field="mode"]');
    const pressAction = panel.querySelector('[data-field="press-action"]');
    const pressParameterRow = panel.querySelector('[data-press-parameter-row]');
    const pressParameter = panel.querySelector('[data-field="press-parameter"]');
    const releaseFields = panel.querySelector('[data-release-fields]');
    const releaseAction = panel.querySelector('[data-field="release-action"]');
    const releaseParameterRow = panel.querySelector('[data-release-parameter-row]');
    const releaseParameter = panel.querySelector('[data-field="release-parameter"]');
    const addButton = panel.querySelector('[data-field="add"]');
    const status = panel.querySelector('[data-field="status"]');
    const configuration = panel.querySelector('[data-field="configuration"]');
    const exportButton = panel.querySelector('[data-field="export"]');
    const importButton = panel.querySelector('[data-field="import"]');
    let selectedCode = '';

    function populateActions(select, allowNone) {
      if (allowNone) {
        const none = documentRef.createElement('option');
        none.value = '';
        none.textContent = 'None';
        select.appendChild(none);
      }
      for (const action of actions) {
        const option = documentRef.createElement('option');
        option.value = action.id;
        option.textContent = action.label;
        select.appendChild(option);
      }
    }

    populateActions(pressAction, false);
    populateActions(releaseAction, true);
    if (actions.some(action => action.id === 'state.clear')) releaseAction.value = 'state.clear';

    function renderParameter(actionSelect, parameterSelect, row) {
      const action = actions.find(candidate => candidate.id === actionSelect.value);
      const parameter = action?.parameters?.[0];
      parameterSelect.replaceChildren();
      row.hidden = !parameter;
      if (!parameter) {
        delete parameterSelect.dataset.name;
        return;
      }
      for (const value of parameter.options || []) {
        const option = documentRef.createElement('option');
        option.value = value;
        option.textContent = value;
        parameterSelect.appendChild(option);
      }
      parameterSelect.dataset.name = parameter.name;
    }

    function readAction(actionSelect, parameterSelect) {
      if (!actionSelect.value) return null;
      const parameters = parameterSelect.dataset.name
        ? { [parameterSelect.dataset.name]: parameterSelect.value }
        : {};
      return { actionId: actionSelect.value, parameters };
    }

    function nextMappingId() {
      let number = config.mappings.length + 1;
      while (config.mappings.some(mapping => mapping.id === `mapping-${number}`)) number += 1;
      return `mapping-${number}`;
    }

    function renderMappings() {
      mappingList.replaceChildren();
      for (const mapping of config.mappings) {
        const row = documentRef.createElement('div');
        row.className = 'input-mapper-row';
        const summary = documentRef.createElement('span');
        summary.textContent = `${mapping.code} · ${mapping.context} · ${mapping.mode} · ${mapping.press?.actionId || 'none'}`;
        const remove = documentRef.createElement('button');
        remove.type = 'button';
        remove.className = 'btn btn-secondary';
        remove.textContent = 'Remove';
        remove.addEventListener('click', () => {
          controller.update({ ...config, mappings: config.mappings.filter(candidate => candidate.id !== mapping.id) });
          renderMappings();
        });
        row.append(summary, remove);
        mappingList.appendChild(row);
      }
      if (!config.mappings.length) mappingList.textContent = 'No mappings configured.';
    }

    enabled.checked = config.enabled;
    activeContextInput.value = controller.getContext();
    keyButton.textContent = selectedCode || 'Press a key';
    renderParameter(pressAction, pressParameter, pressParameterRow);
    renderParameter(releaseAction, releaseParameter, releaseParameterRow);
    releaseFields.hidden = modeSelect.value === 'press';
    renderMappings();
    enabled.addEventListener('change', () => controller.update({ ...config, enabled: enabled.checked }));
    activeContextInput.addEventListener('change', () => {
      const result = controller.setContext(activeContextInput.value);
      status.textContent = result.ok ? `Active context: ${result.context}.` : 'Context cannot be empty.';
      if (!result.ok) activeContextInput.value = controller.getContext();
    });
    pressAction.addEventListener('change', () => renderParameter(pressAction, pressParameter, pressParameterRow));
    releaseAction.addEventListener('change', () => renderParameter(releaseAction, releaseParameter, releaseParameterRow));
    modeSelect.addEventListener('change', () => { releaseFields.hidden = modeSelect.value === 'press'; });
    keyButton.addEventListener('click', () => {
      capturing = true;
      keyButton.textContent = 'Waiting...';
      captureHandler = event => {
        event.preventDefault();
        selectedCode = event.code;
        keyButton.textContent = selectedCode;
        capturing = false;
        eventTarget.removeEventListener('keydown', captureHandler, true);
        captureHandler = null;
      };
      eventTarget.addEventListener('keydown', captureHandler, true);
    });
    addButton.addEventListener('click', () => {
      if (!selectedCode || !pressAction.value) {
        status.textContent = 'Choose a key and press action.';
        return;
      }
      const result = controller.update({
        ...config,
        enabled: enabled.checked,
        mappings: [...config.mappings, {
          id: nextMappingId(),
          code: selectedCode,
          context: contextInput.value.trim() || 'global',
          mode: modeSelect.value,
          press: readAction(pressAction, pressParameter),
          release: modeSelect.value === 'press' ? null : readAction(releaseAction, releaseParameter)
        }]
      });
      status.textContent = result.ok ? 'Mapping added.' : `Conflict: ${selectedCode} is already mapped in this context.`;
      if (result.ok) {
        selectedCode = '';
        keyButton.textContent = 'Press a key';
        renderMappings();
      }
    });
    exportButton.addEventListener('click', () => {
      configuration.value = controller.exportConfig();
      status.textContent = 'Configuration exported to the text box.';
    });
    importButton.addEventListener('click', () => {
      const result = controller.importConfig(configuration.value);
      status.textContent = result.ok ? 'Configuration imported.' : `Import failed: ${result.error}.`;
      if (result.ok) {
        enabled.checked = config.enabled;
        renderMappings();
      }
    });
  }

  buildPanel();
  return Object.freeze(controller);
});
