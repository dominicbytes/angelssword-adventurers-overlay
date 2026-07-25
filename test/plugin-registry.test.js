const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { discoverPlugins } = require('../lib/plugin-registry');

test('discovers an installed plugin and exposes its browser assets and model states', () => {
  const publicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asa-plugins-'));
  const pluginDir = path.join(publicDir, 'plugins', 'viseme-lipsync');
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.writeFileSync(path.join(pluginDir, 'control.js'), '');
  fs.writeFileSync(path.join(pluginDir, 'overlay.js'), '');
  fs.writeFileSync(path.join(pluginDir, 'plugin.css'), '');
  fs.writeFileSync(path.join(pluginDir, 'plugin.json'), JSON.stringify({
    id: 'viseme-lipsync',
    name: 'Viseme Lip Sync',
    version: '1.0.0',
    controlScript: 'control.js',
    overlayScript: 'overlay.js',
    controlStyle: 'plugin.css',
    assetStates: ['neutral_viseme_open', 'neutral_viseme_round']
  }));

  assert.deepEqual(discoverPlugins(publicDir), [{
    id: 'viseme-lipsync',
    name: 'Viseme Lip Sync',
    version: '1.0.0',
    controlScript: '/plugins/viseme-lipsync/control.js',
    overlayScript: '/plugins/viseme-lipsync/overlay.js',
    controlStyle: '/plugins/viseme-lipsync/plugin.css',
    overlayStyle: undefined,
    assetStates: ['neutral_viseme_open', 'neutral_viseme_round']
  }]);
});

test('skips malformed and path-traversing plugin manifests without hiding valid plugins', () => {
  const publicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asa-plugins-'));
  const pluginsDir = path.join(publicDir, 'plugins');

  const validDir = path.join(pluginsDir, 'valid-plugin');
  fs.mkdirSync(validDir, { recursive: true });
  fs.writeFileSync(path.join(validDir, 'control.js'), '');
  fs.writeFileSync(path.join(validDir, 'plugin.json'), JSON.stringify({
    id: 'valid-plugin',
    name: 'Valid Plugin',
    version: '1.0.0',
    controlScript: 'control.js',
    assetStates: ['neutral_extra']
  }));

  const traversalDir = path.join(pluginsDir, 'traversal');
  fs.mkdirSync(traversalDir, { recursive: true });
  fs.writeFileSync(path.join(traversalDir, 'plugin.json'), JSON.stringify({
    id: 'traversal',
    name: 'Traversal',
    version: '1.0.0',
    controlScript: '../outside.js',
    assetStates: []
  }));

  const malformedDir = path.join(pluginsDir, 'malformed');
  fs.mkdirSync(malformedDir, { recursive: true });
  fs.writeFileSync(path.join(malformedDir, 'plugin.json'), '{not json');

  assert.deepEqual(discoverPlugins(publicDir), [{
    id: 'valid-plugin',
    name: 'Valid Plugin',
    version: '1.0.0',
    controlScript: '/plugins/valid-plugin/control.js',
    overlayScript: undefined,
    controlStyle: undefined,
    overlayStyle: undefined,
    assetStates: ['neutral_extra']
  }]);
});

test('the shipped Viseme Lip Sync add-on satisfies the install contract', () => {
  const publicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asa-plugins-'));
  const installedDir = path.join(publicDir, 'plugins', 'viseme-lipsync');
  fs.mkdirSync(path.dirname(installedDir), { recursive: true });
  fs.cpSync(
    path.join(__dirname, '..', 'addons', 'viseme-lipsync', 'plugin'),
    installedDir,
    { recursive: true }
  );

  const [plugin] = discoverPlugins(publicDir);
  assert.equal(plugin.id, 'viseme-lipsync');
  assert.equal(plugin.version, '2.0.0');
  assert.equal(plugin.controlScript, '/plugins/viseme-lipsync/control.js');
  assert.equal(plugin.overlayScript, '/plugins/viseme-lipsync/state-resolver.js');
  assert.equal(plugin.assetStates.length, 16);
  assert.ok(plugin.assetStates.includes('neutral_viseme_closed'));
  assert.ok(plugin.assetStates.includes('surprised_viseme_round'));
  assert.ok(fs.existsSync(path.join(installedDir, 'audio-features.mjs')));
  assert.ok(fs.existsSync(path.join(installedDir, 'vendor', 'VTUBERAVATARSTUDIO-LICENSE.txt')));
});
