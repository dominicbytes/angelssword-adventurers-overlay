'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { generateStaticPreviews } = require('../preview');
const { validatePng } = require('../png');

test('generates and validates deterministic PNG previews from a dry-run plan', () => {
  const bytes = Buffer.concat([Buffer.alloc(3), Buffer.from([10, 20, 30, 128])]);
  const document = {
    images: [{
      id: 14, width: 1, height: 1, loopCount: 0,
      frames: [{
        textureId: 20, offsetX: 0, offsetY: 0, duration: 0.1,
        texture: {
          width: 1, height: 1, format: 'RAW.', dataOffset: 3, dataLength: 4
        }
      }]
    }]
  };
  const plan = {
    assets: [{
      state: 'neutral_idle', fileName: 'neutral_idle.png', sourceImageId: 14,
      kind: 'static_png'
    }],
    reviewAssets: [{
      role: 'blinking_speaking', fileName: null, sourceImageId: 14,
      kind: 'animated_unresolved'
    }]
  };

  const previews = [...generateStaticPreviews(bytes, document, plan)];

  assert.equal(previews.length, 1);
  assert.deepEqual({ ...previews[0], png: undefined }, {
    fileName: 'neutral_idle.png', sourceImageId: 14, width: 1, height: 1,
    byteLength: previews[0].png.length,
    sha256: crypto.createHash('sha256').update(previews[0].png).digest('hex'),
    png: undefined
  });
  assert.deepEqual(validatePng(previews[0].png), {
    width: 1, height: 1, rgba: Buffer.from([10, 20, 30, 128])
  });
  assert.deepEqual(
    [...generateStaticPreviews(bytes, document, plan)][0].png,
    previews[0].png
  );
});

test('rejects unsafe, duplicate, and excessive preview plans before yielding files', () => {
  const bytes = Buffer.from([1, 2, 3, 4]);
  const document = {
    images: [{
      id: 1, width: 1, height: 1,
      frames: [{
        textureId: 2, offsetX: 0, offsetY: 0,
        texture: { width: 1, height: 1, format: 'RAW.', dataOffset: 0, dataLength: 4 }
      }]
    }]
  };
  const asset = { fileName: 'neutral_idle.png', sourceImageId: 1, kind: 'static_png' };

  assert.throws(() => [...generateStaticPreviews(bytes, document, {
    assets: [{ ...asset, fileName: '../escape.png' }], reviewAssets: []
  })], error => error.code === 'invalid_preview_filename');
  assert.throws(() => [...generateStaticPreviews(bytes, document, {
    assets: [asset, asset], reviewAssets: []
  })], error => error.code === 'duplicate_preview_filename');
  assert.throws(() => [...generateStaticPreviews(bytes, document, {
    assets: [asset], reviewAssets: []
  }, { maxPreviewCount: 0 })], error => error.code === 'preview_count_exceeded');
  assert.throws(() => [...generateStaticPreviews(bytes, document, {
    assets: [asset], reviewAssets: []
  }, { maxTotalPreviewPixels: 0 })], error => error.code === 'preview_pixel_budget_exceeded');
});
