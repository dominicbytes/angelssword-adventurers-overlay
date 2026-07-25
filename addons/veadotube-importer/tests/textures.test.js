'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { decodeDocumentTextures, decodeTexturePayload } = require('../textures');

test('decodes bottom-up RAW pixels into browser-order RGBA', () => {
  const bottomUp = Buffer.from([
    255, 0, 0, 255, 0, 255, 0, 128,
    0, 0, 255, 255, 255, 255, 255, 0
  ]);

  const decoded = decodeTexturePayload({
    format: 'RAW.', width: 2, height: 2, data: bottomUp, dataOffset: 40
  });

  assert.deepEqual([...decoded], [
    0, 0, 255, 255, 255, 255, 255, 0,
    255, 0, 0, 255, 0, 255, 0, 128
  ]);
});

test('decodes documented VDD prefix codes and constant color channels', () => {
  const data = Buffer.alloc(24);
  data.writeUInt32LE(2, 0);
  data.writeUInt32LE(0xffffff0a, 4);
  data.writeUInt32LE(0xffffff14, 8);
  data.writeUInt32LE(0xffffff1e, 12);
  data.writeUInt32LE(0xf83b527b, 16);
  data.writeUInt32LE(0x00000d40, 20);

  const decoded = decodeTexturePayload({
    format: 'VDD.', width: 7, height: 1, data, dataOffset: 100
  });

  assert.deepEqual([...decoded], [
    10, 20, 30, 0,
    10, 20, 30, 254,
    10, 20, 30, 1,
    10, 20, 30, 5,
    10, 20, 30, 255,
    10, 20, 30, 183,
    10, 20, 30, 197
  ]);
});

test('rejects malformed and excessive texture payloads with source offsets', () => {
  assert.throws(() => decodeTexturePayload({
    format: 'RAW.', width: 2, height: 2, data: Buffer.alloc(15), dataOffset: 50
  }), error => error.code === 'invalid_raw_texture' && error.offset === 50);

  const truncatedVdd = Buffer.alloc(16);
  truncatedVdd.writeUInt32LE(1, 0);
  for (let offset = 4; offset < 16; offset += 4) truncatedVdd.writeUInt32LE(0xffffffff, offset);
  assert.throws(() => decodeTexturePayload({
    format: 'VDD.', width: 1, height: 1, data: truncatedVdd, dataOffset: 75
  }), error => error.code === 'invalid_vdd_texture' && error.offset === 91);

  assert.throws(() => decodeTexturePayload({
    format: 'RAW.', width: 2, height: 2, data: Buffer.alloc(16), dataOffset: 0
  }, { maxDecodedPixels: 3 }), error => error.code === 'pixel_budget_exceeded');
});

test('streams each unique referenced document texture once', () => {
  const bytes = Buffer.concat([Buffer.alloc(5), Buffer.from([1, 2, 3, 4])]);
  const texture = { width: 1, height: 1, format: 'RAW.', dataOffset: 5, dataLength: 4 };
  const document = {
    images: [{ frames: [{ textureId: 9, texture }, { textureId: 9, texture }] }]
  };

  const decoded = [...decodeDocumentTextures(bytes, document)];

  assert.equal(decoded.length, 1);
  assert.deepEqual(decoded[0], {
    textureId: 9, width: 1, height: 1, rgba: Buffer.from([1, 2, 3, 4])
  });
});
