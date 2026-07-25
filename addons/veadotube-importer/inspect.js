'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DEFAULT_LIMITS, inspectBytes } = require('./inventory');

function inspectFile(sourcePath, options) {
  const limits = { ...DEFAULT_LIMITS, ...(options || {}) };
  const byteLength = fs.statSync(sourcePath).size;
  if (byteLength > limits.maxFileBytes) {
    const error = new Error('VeadoTube file exceeds the configured size limit');
    error.code = 'file_too_large';
    error.offset = 0;
    throw error;
  }
  const bytes = fs.readFileSync(sourcePath);
  const report = inspectBytes(bytes, path.basename(sourcePath), limits);
  const counts = new Map();
  for (const chunk of report.chunks) counts.set(chunk.type, (counts.get(chunk.type) || 0) + 1);
  return {
    importerVersion: '0.1.0',
    source: {
      name: path.basename(sourcePath),
      byteLength: bytes.length,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex')
    },
    ...report,
    chunkTypes: Object.fromEntries([...counts].sort(([left], [right]) => left.localeCompare(right)))
  };
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
