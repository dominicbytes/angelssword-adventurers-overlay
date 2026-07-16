(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) {
    root.ASVisemeStateResolver = api;
    if (root.ASAPluginHost) api.installBrowserPlugin(root.ASAPluginHost);
  }
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  const PLUGIN_ID = 'viseme-lipsync';
  const VISEMES = new Set(['rest', 'closed', 'open', 'wide', 'round']);

  function resolveVisemeState(context) {
    if (context.viseme === 'rest') {
      const expressionIdleState = `${context.expression}_idle`;
      if (context.assets[expressionIdleState]) return expressionIdleState;
      if (context.assets.neutral_idle) return 'neutral_idle';
    }
    if (!context.speaking || !context.viseme) return context.baseStateKey;

    const visemeState = `${context.expression}_viseme_${context.viseme}`;
    if (context.assets[visemeState]) return visemeState;
    if (context.assets[context.baseStateKey]) return context.baseStateKey;

    const neutralVisemeState = `neutral_viseme_${context.viseme}`;
    if (context.assets[neutralVisemeState]) return neutralVisemeState;
    if (context.assets.neutral_speaking) return 'neutral_speaking';
    return context.baseStateKey;
  }

  function installBrowserPlugin(host) {
    let currentViseme = null;
    let detectorActive = false;

    host.registerDisplayStateResolver(PLUGIN_ID, context => resolveVisemeState({
      ...context,
      viseme: detectorActive ? currentViseme : null
    }));

    host.on('plugin-event', message => {
      if (message?.pluginId !== PLUGIN_ID) return;

      if (message.event === 'detector-state' && typeof message?.data?.active === 'boolean') {
        detectorActive = message.data.active;
        if (!detectorActive) currentViseme = null;
      } else if (message.event === 'viseme' && VISEMES.has(message?.data?.viseme)) {
        detectorActive = true;
        currentViseme = message.data.viseme;
      } else {
        return;
      }
      host.requestDisplayUpdate();
    });
  }

  return { resolveVisemeState, installBrowserPlugin };
});
