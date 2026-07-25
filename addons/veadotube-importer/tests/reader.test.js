const test = require('node:test');
const assert = require('node:assert/strict');

const { BinaryReader } = require('../reader');

test('reads bounded 7-bit integers and UTF-8 strings', () => {
  const bytes = Buffer.from([0xac, 0x02, 0x05, 0x68, 0xc3, 0xa9, 0x21, 0x21]);
  const reader = new BinaryReader(bytes);

  assert.equal(reader.varUint(), 300);
  assert.equal(reader.string(), 'hé!!');
  assert.equal(reader.remaining, 0);
});

test('reports varint overflow, truncation, and invalid UTF-8 at stable offsets', () => {
  assert.throws(() => new BinaryReader(Buffer.from([0x80])).varUint(), error => (
    error.code === 'truncated_data' && error.offset === 1
  ));
  assert.throws(() => new BinaryReader(Buffer.from([0xff, 0xff, 0xff, 0xff, 0x10])).varUint(), error => (
    error.code === 'varint_overflow' && error.offset === 4
  ));
  assert.throws(() => new BinaryReader(Buffer.from([0x02, 0xc3, 0x28])).string(), error => (
    error.code === 'invalid_utf8' && error.offset === 1
  ));
});

test('enforces string allocation limits before decoding', () => {
  const reader = new BinaryReader(Buffer.from([0x04, 1, 2, 3, 4]), 0, undefined, {
    maxStringBytes: 3
  });
  assert.throws(() => reader.string(), error => error.code === 'string_too_large');
});
