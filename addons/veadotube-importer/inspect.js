'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { inspectBytes } = require('./inventory');

function inspectFile(sourcePath) {
  const byteLength = fs.statSync(sourcePath).size;
  if (byteLength > 256 * 1024 * 1024) {
    const error = new Error('VeadoTube file exceeds the configured size limit');
    error.code = 'file_too_large';
    error.offset = 0;
    throw error;
  }
  const bytes = fs.readFileSync(sourcePath);
  const report = inspectBytes(bytes, path.basename(sourcePath));
  return {
    importerVersion: '0.1.0',
    source: {
      name: path.basename(sourcePath),
      byteLength: bytes.length,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex')
    },
    ...report,
    chunkTypes: Object.fromEntries([...new Set(report.chunks.map(chunk => chunk.type))]
      .sort().map(type => [type, report.chunks.filter(chunk => chunk.type === type).length]))
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
