'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { encodePng, validatePng } = require('../png');

test('encodes deterministic lossless RGBA8 PNG bytes and validates the pixels', () => {
  const image = {
    width: 2,
    height: 1,
    rgba: Buffer.from([255, 0, 0, 255, 0, 0, 255, 64])
  };

  const first = encodePng(image);
  const second = encodePng(image);

  assert.equal(first.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.deepEqual(first, second);
  assert.deepEqual(validatePng(first), image);
});

test('rejects dimensions beyond the preview limit before encoding', () => {
  assert.throws(() => encodePng({
    width: 20000, height: 1, rgba: Buffer.alloc(20000 * 4)
  }), error => error.code === 'dimension_limit_exceeded');
});

test('rejects corrupted or oversized PNG data with structured errors', () => {
  const png = encodePng({ width: 1, height: 1, rgba: Buffer.from([1, 2, 3, 4]) });
  const corrupted = Buffer.from(png);
  corrupted[20] ^= 1;

  assert.throws(() => validatePng(corrupted), error => error.code === 'invalid_png_crc');
  assert.throws(() => validatePng(png, { maxPngBytes: png.length - 1 }),
    error => error.code === 'png_too_large');
});
