const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { inspectFile } = require('../inspect');

function miniFixture() {
  const header = Buffer.alloc(12);
  header.writeUInt32LE(1, 0);
  header.write('MLST', 4, 4, 'ascii');
  header.writeUInt32LE(4, 8);
  return Buffer.concat([
    Buffer.from('VEADOTUBE', 'ascii'),
    header,
    Buffer.from([2, 0, 0, 0]),
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
  assert.deepEqual(first.chunkTypes, { MLST: 1 });
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
