'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DEFAULT_LIMITS, inspectBytes } = require('./inventory');
const { decodeMiniAvatar } = require('./mini');

function inspectFile(sourcePath, options) {
  const { fileSystem = fs, ...limitOverrides } = options || {};
  const limits = { ...DEFAULT_LIMITS, ...limitOverrides };
  const bytes = readBoundedFile(fileSystem, sourcePath, limits.maxFileBytes);
  const report = inspectBytes(bytes, path.basename(sourcePath), limits);
  const counts = new Map();
  for (const chunk of report.chunks) counts.set(chunk.type, (counts.get(chunk.type) || 0) + 1);
  return {
    importerVersion: '0.3.0',
    source: {
      name: path.basename(sourcePath),
      byteLength: bytes.length,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex')
    },
    ...report,
    chunkTypes: Object.fromEntries([...counts].sort(([left], [right]) => left.localeCompare(right))),
    mini: report.format === 'mini' ? decodeMiniAvatar(bytes, report, limits) : null
  };
}

function readBoundedFile(fileSystem, sourcePath, maxFileBytes) {
  const descriptor = fileSystem.openSync(sourcePath, 'r');
  try {
    const byteLength = fileSystem.fstatSync(descriptor).size;
    if (!Number.isSafeInteger(byteLength) || byteLength < 0 || byteLength > maxFileBytes) {
      const error = new Error('VeadoTube file exceeds the configured size limit');
      error.code = 'file_too_large';
      error.offset = 0;
      throw error;
    }
    const buffer = Buffer.alloc(byteLength + 1);
    let bytesRead = 0;
    while (bytesRead < buffer.length) {
      const count = fileSystem.readSync(
        descriptor,
        buffer,
        bytesRead,
        buffer.length - bytesRead,
        bytesRead
      );
      if (count === 0) break;
      bytesRead += count;
    }
    if (bytesRead !== byteLength) {
      const error = new Error('VeadoTube source changed during inspection');
      error.code = 'source_changed';
      error.offset = 0;
      throw error;
    }
    return buffer.subarray(0, byteLength);
  } finally {
    fileSystem.closeSync(descriptor);
  }
}

if (require.main === module) {
  const sourcePath = process.argv[2];
  if (!sourcePath) {
    console.error('Usage: node inspect.js <avatar.veado|avatar.vaedo>');
    process.exitCode = 2;
  } else {
    try {
      console.log(JSON.stringify(inspectFile(sourcePath), null, 2));
    } catch (error) {
      console.error(JSON.stringify({
        error: error.code || 'inspect_failed',
        offset: error.offset ?? null,
        message: error.message
      }, null, 2));
      process.exitCode = 1;
    }
  }
}

module.exports = { inspectFile };
