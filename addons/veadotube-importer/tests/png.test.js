'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { encodePng, validatePng } = require('../png');

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) !== 0 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function emptyChunk(type) {
  const output = Buffer.alloc(12);
  const typeBytes = Buffer.from(type, 'latin1');
  typeBytes.copy(output, 4);
  output.writeUInt32BE(crc32(typeBytes), 8);
  return output;
}

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

test('rejects high-bit chunk aliases and excessive chunk counts', () => {
  const png = encodePng({ width: 1, height: 1, rgba: Buffer.from([1, 2, 3, 4]) });
  const aliased = Buffer.from(png);
  aliased[12] = 0xc9;
  aliased.writeUInt32BE(crc32(aliased.subarray(12, 29)), 29);
  assert.throws(() => validatePng(aliased), error => error.code === 'invalid_png_chunk_type');

  const withAncillary = Buffer.concat([
    png.subarray(0, png.length - 12), emptyChunk('ruSt'), png.subarray(png.length - 12)
  ]);
  assert.throws(() => validatePng(withAncillary, { maxChunks: 3 }),
    error => error.code === 'png_chunk_limit_exceeded');
});
