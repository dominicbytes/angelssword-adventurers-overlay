'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  commitStagedImport,
  discardStagedImport,
  installStaticModel,
  stageStaticImport,
  validateStagedImport
} = require('../staging');

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mPgEpFrAAABJQC9MRgrDgAAAABJRU5ErkJggg==',
  'base64'
);
const PNG_SHA256 = '70573fd934ef71e4c48e0dd2089c7732d0410d8e9845ab16716a030efb5c4f47';

function withAssetsRoot(run) {
  const privateRoot = path.join(process.cwd(), '.private-fixtures');
  fs.mkdirSync(privateRoot, { recursive: true });
  const directory = fs.mkdtempSync(path.join(privateRoot, 'staging-test-'));
  const assetsRoot = path.join(directory, 'assets');
  fs.mkdirSync(assetsRoot);
  try {
    return run(assetsRoot);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function importRequest(assetsRoot) {
  return {
    assetsRoot,
    modelName: 'Avatar One',
    source: {
      name: 'avatar.veado',
      byteLength: 1234,
      sha256: 'a'.repeat(64)
    },
    previews: [{
      fileName: 'neutral_idle.png',
      sourceImageId: 14,
      width: 1,
      height: 1,
      byteLength: PNG.length,
      sha256: PNG_SHA256,
      png: Buffer.from(PNG)
    }]
  };
}

test('stages and validates a static model without exposing it as installed', () => {
  withAssetsRoot(assetsRoot => {
    const staged = stageStaticImport(importRequest(assetsRoot));

    assert.equal(path.dirname(path.dirname(staged.stageDir)), fs.realpathSync(assetsRoot));
    assert.equal(path.basename(path.dirname(staged.stageDir)), '.veadotube-import-staging');
    assert.equal(staged.targetDir, path.join(fs.realpathSync(assetsRoot), 'Avatar One'));
    assert.equal(fs.existsSync(staged.targetDir), false);
    const discoverableModels = fs.readdirSync(assetsRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .filter(entry => fs.existsSync(path.join(assetsRoot, entry.name, 'neutral_idle.png')))
      .map(entry => entry.name);
    assert.deepEqual(discoverableModels, []);
    assert.deepEqual(fs.readdirSync(staged.stageDir).sort(), [
      '.as-adventurer-import.json',
      'neutral_idle.png'
    ]);

    assert.deepEqual(validateStagedImport(staged), {
      schemaVersion: 1,
      importer: '@as-adventurer/veadotube-importer',
      importerVersion: '0.5.0',
      modelName: 'Avatar One',
      source: {
        name: 'avatar.veado',
        byteLength: 1234,
        sha256: 'a'.repeat(64)
      },
      assets: [{
        state: 'neutral_idle',
        fileName: 'neutral_idle.png',
        sourceImageId: 14,
        width: 1,
        height: 1,
        byteLength: 70,
        sha256: PNG_SHA256
      }]
    });
  });
});

test('commits a validated stage as one complete model directory', () => {
  withAssetsRoot(assetsRoot => {
    const staged = stageStaticImport(importRequest(assetsRoot));
    const manifest = validateStagedImport(staged);
    const result = commitStagedImport(staged);

    assert.equal(result.targetDir, path.join(fs.realpathSync(assetsRoot), 'Avatar One'));
    assert.equal(fs.existsSync(staged.stageDir), false);
    assert.deepEqual(fs.readdirSync(result.targetDir).sort(), [
      '.as-adventurer-import.json',
      'neutral_idle.png'
    ]);
    assert.deepEqual(result.manifest, manifest);
  });
});

test('refuses a model collision without changing the existing directory', () => {
  withAssetsRoot(assetsRoot => {
    const targetDir = path.join(assetsRoot, 'Avatar One');
    fs.mkdirSync(targetDir);
    fs.writeFileSync(path.join(targetDir, 'sentinel.txt'), 'keep me');

    assert.throws(
      () => installStaticModel(importRequest(assetsRoot)),
      error => error.code === 'model_exists'
    );
    assert.equal(fs.readFileSync(path.join(targetDir, 'sentinel.txt'), 'utf8'), 'keep me');
    assert.deepEqual(
      fs.readdirSync(assetsRoot).filter(name => name.startsWith('.veadotube-import-')),
      []
    );
  });
});

test('refuses a tampered stage and permits explicit cleanup', () => {
  withAssetsRoot(assetsRoot => {
    const staged = stageStaticImport(importRequest(assetsRoot));
    fs.writeFileSync(path.join(staged.stageDir, 'neutral_idle.png'), 'not a PNG');

    assert.throws(
      () => commitStagedImport(staged),
      error => error.code === 'staged_asset_invalid'
    );
    assert.equal(fs.existsSync(staged.targetDir), false);
    assert.equal(discardStagedImport(staged), true);
    assert.equal(fs.existsSync(staged.stageDir), false);
  });
});

test('rejects tampered importer provenance in the staged manifest', () => {
  withAssetsRoot(assetsRoot => {
    const staged = stageStaticImport(importRequest(assetsRoot));
    const manifestPath = path.join(staged.stageDir, '.as-adventurer-import.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.importerVersion = '0.4.0';
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));

    assert.throws(
      () => validateStagedImport(staged),
      error => error.code === 'invalid_stage_manifest'
    );
    assert.equal(discardStagedImport(staged), true);
  });
});

test('rejects a staging directory replaced after it was created', () => {
  withAssetsRoot(assetsRoot => {
    const staged = stageStaticImport(importRequest(assetsRoot));
    const displaced = `${staged.stageDir}-displaced`;
    fs.renameSync(staged.stageDir, displaced);
    fs.mkdirSync(staged.stageDir);

    assert.throws(
      () => commitStagedImport(staged),
      error => error.code === 'invalid_stage_path'
    );
    assert.equal(fs.existsSync(staged.targetDir), false);
  });
});

test('rejects unsafe Windows model and asset names before writing', () => {
  withAssetsRoot(assetsRoot => {
    for (const modelName of ['../escape', 'CON', 'trailing.']) {
      assert.throws(
        () => stageStaticImport({ ...importRequest(assetsRoot), modelName }),
        error => error.code === 'invalid_model_name'
      );
    }
    assert.throws(() => stageStaticImport({
      ...importRequest(assetsRoot),
      previews: [{ ...importRequest(assetsRoot).previews[0], fileName: '../escape.png' }]
    }), error => error.code === 'invalid_asset_name');
    assert.deepEqual(fs.readdirSync(assetsRoot), []);
  });
});
