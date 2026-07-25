const test = require('node:test');
const assert = require('node:assert/strict');

const { inspectBytes, parseChunkInventory } = require('../inventory');

function fixture(chunks) {
  const parts = [Buffer.from('VEADOTUBE', 'ascii')];
  for (const chunk of chunks) {
    const header = Buffer.alloc(12);
    header.writeUInt32LE(chunk.id, 0);
    header.write(chunk.type, 4, 4, 'ascii');
    header.writeUInt32LE(chunk.data.length, 8);
    parts.push(header, chunk.data);
  }
  parts.push(Buffer.alloc(12));
  return Buffer.concat(parts);
}

test('identifies a modern Mini avatar and reports chunks without copying payloads', () => {
  const bytes = fixture([
    { id: 21, type: 'MLST', data: Buffer.from([1, 0, 0, 0]) },
    { id: 1, type: 'META', data: Buffer.from([0]) }
  ]);

  assert.deepEqual(parseChunkInventory(bytes), {
    format: 'mini',
    byteLength: bytes.length,
    terminated: true,
    terminatorOffset: 38,
    trailingBytes: 0,
    chunks: [
      { id: 21, type: 'MLST', offset: 9, dataOffset: 21, length: 4 },
      { id: 1, type: 'META', offset: 25, dataOffset: 37, length: 1 }
    ]
  });
});

test('classifies dynamic and legacy containers explicitly', () => {
  assert.equal(parseChunkInventory(fixture([
    { id: 1, type: 'DART', data: Buffer.from([0]) }
  ])).format, 'dynamic');
  assert.throws(() => parseChunkInventory(Buffer.from('PK\x03\x04legacy')), error => (
    error.code === 'legacy_format' && error.offset === 0
  ));
  assert.equal(parseChunkInventory(fixture([
    { id: 1, type: 'MLST', data: Buffer.from([0]) },
    { id: 2, type: 'DART', data: Buffer.from([0]) }
  ])).format, 'ambiguous');
});

test('reports bytes after a documented early terminator', () => {
  const bytes = Buffer.concat([fixture([]), Buffer.from('extra')]);
  const report = parseChunkInventory(bytes);

  assert.equal(report.terminated, true);
  assert.equal(report.terminatorOffset, 9);
  assert.equal(report.trailingBytes, 5);
});

test('rejects high-bit FourCC bytes instead of aliasing trusted types', () => {
  const bytes = fixture([{ id: 1, type: 'MLST', data: Buffer.from([0]) }]);
  bytes.set([0xcd, 0xcc, 0xd3, 0xd4], 13);

  assert.throws(() => parseChunkInventory(bytes), error => error.code === 'invalid_fourcc');
});

test('rejects truncated and resource-exhausting chunk declarations', () => {
  const truncated = fixture([{ id: 1, type: 'MLST', data: Buffer.from([1]) }]).subarray(0, 21);
  assert.throws(() => parseChunkInventory(truncated), error => error.code === 'truncated_chunk');
  assert.throws(() => parseChunkInventory(fixture([
    { id: 1, type: 'MLST', data: Buffer.alloc(5) }
  ]), { maxChunkBytes: 4 }), error => error.code === 'chunk_too_large');
});

test('accepts vaedo as a warned alias only after content validation', () => {
  const report = inspectBytes(fixture([
    { id: 1, type: 'MLST', data: Buffer.from([0]) }
  ]), 'avatar.vaedo');

  assert.equal(report.format, 'mini');
  assert.deepEqual(report.warnings, ['extension_alias_vaedo']);
  assert.throws(() => inspectBytes(Buffer.from('not a file'), 'avatar.vaedo'), /magic/i);
});
