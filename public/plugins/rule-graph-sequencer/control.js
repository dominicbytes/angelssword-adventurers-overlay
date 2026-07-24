(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = { createRuleGraphSequencer: factory };
  }
  if (root?.ASAPluginHost && root.document) {
    root.ASRuleGraphSequencer = factory(root.ASAPluginHost, {
      document: root.document,
      storage: root.localStorage
    });
  }
})(typeof window !== 'undefined' ? window : null, function createRuleGraphSequencer(host, options) {
  'use strict';

  options = options || {};
  const storageKey = 'as-plugin-rule-graph-sequencer';
  const wait = options.wait || (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
  const runningGraphIds = new Set();

  function defaults() {
    return { schemaVersion: 1, graphs: [] };
  }

  function copy(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function topologicalOrder(graph) {
    const nodesById = new Map(graph.nodes.map(node => [node.id, node]));
    const incoming = new Map(graph.nodes.map(node => [node.id, 0]));
    const outgoing = new Map(graph.nodes.map(node => [node.id, []]));
    for (const edge of graph.edges) {
      incoming.set(edge.to, incoming.get(edge.to) + 1);
      outgoing.get(edge.from).push(edge.to);
    }
    for (const targets of outgoing.values()) targets.sort();
    const ready = [...incoming].filter(([, count]) => count === 0).map(([id]) => id).sort();
    const order = [];
    while (ready.length) {
      const id = ready.shift();
      order.push(nodesById.get(id));
      for (const target of outgoing.get(id)) {
        incoming.set(target, incoming.get(target) - 1);
        if (incoming.get(target) === 0) {
          ready.push(target);
          ready.sort();
        }
      }
    }
    return {
      order,
      blocked: [...incoming].filter(([, count]) => count > 0).map(([id]) => id).sort()
    };
  }

  function validate(candidate) {
    if (!candidate || candidate.schemaVersion !== 1 || !Array.isArray(candidate.graphs)) {
      return { ok: false, error: 'invalid_schema' };
    }
    if (candidate.graphs.length > 32) return { ok: false, error: 'graph_limit' };
    const graphIds = new Set();
    for (const graph of candidate.graphs) {
      if (!graph || typeof graph.id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(graph.id) ||
          typeof graph.name !== 'string' || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
        return { ok: false, error: 'invalid_graph', graphId: graph?.id || null };
      }
      if (typeof graph.enabled !== 'boolean') {
        return { ok: false, error: 'invalid_graph_enabled', graphId: graph.id };
      }
      if (graphIds.has(graph.id)) return { ok: false, error: 'duplicate_graph_id', graphId: graph.id };
      graphIds.add(graph.id);
      if (graph.nodes.length > 64 || graph.edges.length > 256) {
        return { ok: false, error: 'graph_size_limit', graphId: graph.id };
      }
      const nodeIds = new Set();
      for (const node of graph.nodes) {
        if (!node || typeof node.id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(node.id) ||
            typeof node.actionId !== 'string' || !node.actionId ||
            !node.parameters || typeof node.parameters !== 'object' || Array.isArray(node.parameters) ||
            !Number.isInteger(node.delayMs) || node.delayMs < 0 || node.delayMs > 60000) {
          return { ok: false, error: 'invalid_node', graphId: graph.id, nodeId: node?.id || null };
        }
        if (nodeIds.has(node.id)) return { ok: false, error: 'duplicate_node_id', graphId: graph.id, nodeId: node.id };
        nodeIds.add(node.id);
      }
      for (const edge of graph.edges) {
        if (!edge || !nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
          return { ok: false, error: 'invalid_edge', graphId: graph.id };
        }
      }
      const { blocked } = topologicalOrder(graph);
      if (blocked.length) return { ok: false, error: 'cycle_detected', graphId: graph.id, nodeIds: blocked };
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
    return validate(candidate).ok ? copy(candidate) : defaults();
  }

  let config = load();

  function persist() {
    options.storage?.setItem(storageKey, JSON.stringify(config));
  }

  const controller = {
    update(nextConfig) {
      const result = validate(nextConfig);
      if (!result.ok) return result;
      config = copy(nextConfig);
      persist();
      return { ok: true };
    },
    getConfig() {
      return copy(config);
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
      return controller.update(parsed);
    },
    async execute(graphId) {
      const graph = config.graphs.find(candidate => candidate.id === graphId);
      if (!graph || graph.enabled !== true) return { ok: false, error: 'graph_unavailable', graphId };
      if (runningGraphIds.has(graphId)) return { ok: false, error: 'graph_running', graphId };
      runningGraphIds.add(graphId);
      try {
        const { order } = topologicalOrder(graph);
        const nodeIds = [];
        for (const node of order) {
          if (node.delayMs > 0) await wait(node.delayMs);
          const result = await host.invokeAction(node.actionId, node.parameters);
          nodeIds.push(node.id);
          if (!result?.ok) return { ok: false, error: 'action_failed', graphId, nodeId: node.id, result, nodeIds };
        }
        return { ok: true, graphId, nodeIds };
      } finally {
        runningGraphIds.delete(graphId);
      }
    }
  };

  function buildPanel() {
    const documentRef = options.document;
    const mount = documentRef?.getElementById('plugin-panels');
    if (!mount) return;
    const panel = documentRef.createElement('section');
    panel.className = 'card rule-graph-panel';
    panel.innerHTML = `
      <div class="card-header"><h2>Rule Graph and Sequencer</h2></div>
      <div class="card-body">
        <div data-field="graphs"></div>
        <details>
          <summary>Edit graph JSON</summary>
          <textarea data-field="configuration" rows="12"></textarea>
          <button type="button" class="btn btn-primary" data-field="save">Validate and save</button>
        </details>
        <p data-field="status" role="status"></p>
      </div>`;
    mount.appendChild(panel);
    const graphList = panel.querySelector('[data-field="graphs"]');
    const configuration = panel.querySelector('[data-field="configuration"]');
    const save = panel.querySelector('[data-field="save"]');
    const status = panel.querySelector('[data-field="status"]');

    function render() {
      graphList.replaceChildren();
      for (const graph of config.graphs) {
        const row = documentRef.createElement('div');
        row.className = 'rule-graph-row';
        const label = documentRef.createElement('span');
        label.textContent = `${graph.name} (${graph.nodes.length} actions)`;
        const run = documentRef.createElement('button');
        run.type = 'button';
        run.className = 'btn btn-secondary';
        run.textContent = 'Run';
        run.disabled = !graph.enabled;
        run.addEventListener('click', async () => {
          run.disabled = true;
          status.textContent = `Running ${graph.name}...`;
          try {
            const result = await controller.execute(graph.id);
            status.textContent = result.ok ? `${graph.name} complete.` : `${graph.name} failed: ${result.error}.`;
          } finally {
            run.disabled = !graph.enabled;
          }
        });
        row.append(label, run);
        graphList.appendChild(row);
      }
      if (!config.graphs.length) graphList.textContent = 'No graphs configured.';
      configuration.value = controller.exportConfig();
    }

    save.addEventListener('click', () => {
      const result = controller.importConfig(configuration.value);
      status.textContent = result.ok ? 'Graph configuration saved.' : `Validation failed: ${result.error}.`;
      if (result.ok) render();
    });
    render();
  }

  buildPanel();
  return Object.freeze(controller);
});
