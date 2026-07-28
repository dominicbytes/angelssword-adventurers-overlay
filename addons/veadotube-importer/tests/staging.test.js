'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { stageStaticImport, validateStagedImport } = require('../staging');

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

    assert.equal(path.dirname(staged.stageDir), fs.realpathSync(assetsRoot));
    assert.equal(staged.targetDir, path.join(fs.realpathSync(assetsRoot), 'Avatar One'));
    assert.equal(fs.existsSync(staged.targetDir), false);
    assert.deepEqual(fs.readdirSync(staged.stageDir).sort(), [
      '.as-adventurer-import.json',
      'neutral_idle.png'
    ]);

    assert.deepEqual(validateStagedImport(staged), {
      schemaVersion: 1,
      importer: '@as-adventurer/veadotube-importer',
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
