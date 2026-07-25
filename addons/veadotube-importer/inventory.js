'use strict';

const { readFourCC } = require('./reader');

const MAGIC = Buffer.from('VEADOTUBE', 'ascii');
const DEFAULT_LIMITS = Object.freeze({
  maxFileBytes: 256 * 1024 * 1024,
  maxChunkBytes: 128 * 1024 * 1024,
  maxChunks: 100000
});

function parseError(code, offset, message) {
  const error = new Error(message);
  error.code = code;
  error.offset = offset;
  return error;
}

function parseChunkInventory(input, options) {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const limits = { ...DEFAULT_LIMITS, ...(options || {}) };
  if (bytes.length > limits.maxFileBytes) {
    throw parseError('file_too_large', 0, 'VeadoTube file exceeds the configured size limit');
  }
  if (bytes.subarray(0, 4).equals(Buffer.from('PK\x03\x04', 'binary'))) {
    throw parseError('legacy_format', 0, 'Legacy ZIP-based VeadoTube format is unsupported');
  }
  if (bytes.length < MAGIC.length || !bytes.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw parseError('invalid_magic', 0, 'Invalid VEADOTUBE magic header');
  }

  const chunks = [];
  let offset = MAGIC.length;
  let terminated = false;
  let terminatorOffset = null;
  let trailingBytes = 0;
  while (offset < bytes.length) {
    if (bytes.length - offset < 12) {
      throw parseError('truncated_header', offset, 'Truncated VeadoTube chunk header');
    }
    const id = bytes.readUInt32LE(offset);
    const typeValue = bytes.readUInt32LE(offset + 4);
    const length = bytes.readUInt32LE(offset + 8);
    if (id === 0 || typeValue === 0 || length === 0) {
      terminated = true;
      terminatorOffset = offset;
      trailingBytes = bytes.length - (offset + 12);
      break;
    }
    if (chunks.length >= limits.maxChunks) {
      throw parseError('too_many_chunks', offset, 'VeadoTube chunk count exceeds the configured limit');
    }
    if (length > limits.maxChunkBytes) {
      throw parseError('chunk_too_large', offset + 8, 'VeadoTube chunk exceeds the configured size limit');
    }
    const dataOffset = offset + 12;
    const dataEnd = dataOffset + length;
    if (dataEnd > bytes.length) {
      throw parseError('truncated_chunk', dataOffset, 'VeadoTube chunk payload is truncated');
    }
    chunks.push({
      id,
      type: readFourCC(bytes, offset + 4),
      offset,
      dataOffset,
      length
    });
    offset = dataEnd;
  }

  const types = new Set(chunks.map(chunk => chunk.type));
  const format = types.has('MLST') && types.has('DART')
    ? 'ambiguous'
    : types.has('MLST') ? 'mini' : types.has('DART') ? 'dynamic' : 'modern_unknown';
  return { format, byteLength: bytes.length, terminated, terminatorOffset, trailingBytes, chunks };
}

function inspectBytes(bytes, fileName, options) {
  const inventory = parseChunkInventory(bytes, options);
  const lowerName = String(fileName || '').toLowerCase();
  const warnings = [];
  if (lowerName.endsWith('.vaedo')) warnings.push('extension_alias_vaedo');
  else if (!lowerName.endsWith('.veado')) warnings.push('unexpected_extension');
  return { ...inventory, warnings };
}

module.exports = { DEFAULT_LIMITS, inspectBytes, parseChunkInventory };
