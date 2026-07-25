const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { inspectFile } = require('../inspect');

function miniFixture() {
  function chunk(id, type, data) {
    const header = Buffer.alloc(12);
    header.writeUInt32LE(id, 0);
    header.write(type, 4, 4, 'ascii');
    header.writeUInt32LE(data.length, 8);
    return Buffer.concat([header, data]);
  }
  const list = Buffer.alloc(4);
  list.writeUInt32LE(3);
  const state = Buffer.concat([
    Buffer.from([4]), Buffer.from('Idle'), Buffer.from([0]), Buffer.alloc(32),
    Buffer.from([0, 0, 0, 0, 0]), Buffer.from('PRES')
  ]);
  return Buffer.concat([
    Buffer.from('VEADOTUBE', 'ascii'),
    chunk(2, 'MLST', list),
    chunk(3, 'MSTA', state),
    Buffer.alloc(12)
  ]);
}

test('inspects a file deterministically without changing the source', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'veado-inspect-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const sourcePath = path.join(directory, 'avatar.vaedo');
  const source = miniFixture();
  fs.writeFileSync(sourcePath, source);
  const expectedHash = crypto.createHash('sha256').update(source).digest('hex');

  const first = inspectFile(sourcePath);
  const second = inspectFile(sourcePath);

  assert.deepEqual(second, first);
  assert.equal(first.source.sha256, expectedHash);
  assert.deepEqual(first.chunkTypes, { MLST: 1, MSTA: 1 });
  assert.equal(first.mini.states[0].name, 'Idle');
  assert.deepEqual(fs.readFileSync(sourcePath), source);
});

test('checks the configured file limit before reading payload bytes', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'veado-limit-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const sourcePath = path.join(directory, 'avatar.veado');
  fs.writeFileSync(sourcePath, miniFixture());

  assert.throws(() => inspectFile(sourcePath, { maxFileBytes: 8 }), error => (
    error.code === 'file_too_large' && error.offset === 0
  ));
});
