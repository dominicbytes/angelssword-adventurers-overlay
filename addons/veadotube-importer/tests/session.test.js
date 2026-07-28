'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { validatePng } = require('../png');
const { createImportSession } = require('../session');
const { withAssetsRoot } = require('./helpers/assets-root');
const { miniFixture } = require('./helpers/mini-fixture');

test('previews and installs an explicitly confirmed Mini mapping', () => {
  withAssetsRoot(assetsRoot => {
    const bytes = miniFixture();
    const session = createImportSession({
      bytes,
      fileName: 'fixture.veado',
      assetsRoot
    });

    assert.deepEqual(session.source, {
      name: 'fixture.veado',
      byteLength: bytes.length,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex')
    });
    assert.equal(session.view.states[0].suggestedTarget, 'happy');
    assert.equal(session.view.states[0].requiresConfirmation, true);

    const preview = session.preview(14);
    assert.equal(preview.sourceImageId, 14);
    assert.deepEqual(validatePng(preview.png), {
      width: 2,
      height: 2,
      rgba: Buffer.alloc(16)
    });
    assert.throws(() => session.preview(10), error => error.code === 'preview_not_available');

    const installed = session.install({
      modelName: 'Fixture Avatar',
      confirmed: true,
      selections: [{ stateId: 3, target: 'happy' }]
    });

    assert.deepEqual(installed.manifest.assets.map(asset => asset.state), [
      'happy_idle',
      'happy_speaking'
    ]);
    assert.deepEqual(fs.readdirSync(installed.targetDir).sort(), [
      '.as-adventurer-import.json',
      'happy_idle.png',
      'happy_speaking.png'
    ]);
  });
});

test('rejects unsupported source containers before creating a session', () => {
  withAssetsRoot(assetsRoot => {
    assert.throws(() => createImportSession({
      bytes: Buffer.from('not a VeadoTube file'),
      fileName: 'fixture.veado',
      assetsRoot
    }), error => error.code === 'invalid_magic');
    assert.deepEqual(fs.readdirSync(assetsRoot), []);
  });
});

test('reports and blocks static assets above the session preview limit', () => {
  withAssetsRoot(assetsRoot => {
    const session = createImportSession({
      bytes: miniFixture(),
      fileName: 'fixture.veado',
      assetsRoot,
      limits: { maxPreviewPixels: 3 }
    });

    assert.equal(session.view.states[0].assets[0].kind, 'static_png');
    assert.equal(session.view.states[0].assets[0].previewAvailable, false);
    assert.throws(() => session.preview(14), error => error.code === 'preview_not_available');
    assert.throws(() => session.install({
      modelName: 'Oversized Fixture',
      confirmed: true,
      selections: [{ stateId: 3, target: 'happy' }]
    }), error => (
      error.code === 'mapped_asset_exceeds_limit' && error.assets.length === 2
    ));
    assert.deepEqual(fs.readdirSync(assetsRoot), []);
  });
});

test('takes ownership of an uploaded Buffer without copying the whole source', () => {
  withAssetsRoot(assetsRoot => {
    const bytes = miniFixture();
    const originalFrom = Buffer.from;
    let copiedWholeSource = false;
    Buffer.from = function trackedBufferFrom(value, ...args) {
      if (value === bytes) copiedWholeSource = true;
      return Reflect.apply(originalFrom, Buffer, [value, ...args]);
    };
    try {
      const session = createImportSession({
        bytes,
        fileName: 'owned-buffer.veado',
        assetsRoot
      });
      assert.equal(session.source.byteLength, bytes.length);
    } finally {
      Buffer.from = originalFrom;
    }
    assert.equal(copiedWholeSource, false);
  });
});
