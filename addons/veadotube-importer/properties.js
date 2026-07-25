'use strict';

const { BinaryReader, readerError } = require('./reader');

const utf8 = new TextDecoder('utf-8', { fatal: true });

function parseProperties(input, options) {
  const limits = {
    maxProperties: 1024,
    maxPropertyValueBytes: 1024 * 1024,
    maxPropertyDepth: 64,
    maxPropertyPathBytes: 64 * 1024,
    maxCumulativePropertyKeyBytes: 1024 * 1024,
    maxStringBytes: 64 * 1024,
    ...(options || {})
  };
  const reader = new BinaryReader(input, 0, undefined, limits);
  const stack = [];
  const entries = new Map();
  let terminated = false;
  let cumulativeKeyBytes = 0;
  while (reader.remaining > 0) {
    const typeOffset = reader.offset;
    const type = reader.u8();
    if (type === 0) {
      terminated = true;
      break;
    }
    if (entries.size >= limits.maxProperties) {
      throw readerError('property_limit', typeOffset, 'Property count exceeds configured limit');
    }
    if (stack.length) {
      const popCount = reader.varUint();
      if (popCount > stack.length) {
        throw readerError('invalid_property_stack', reader.offset, 'Property stack pop exceeds its depth');
      }
      stack.splice(stack.length - popCount, popCount);
    }
    const pushed = reader.string().split('/');
    if (pushed.some(segment => !segment)) {
      throw readerError('invalid_property_key', reader.offset, 'Property key contains an empty segment');
    }
    if (stack.length + pushed.length > limits.maxPropertyDepth) {
      throw readerError('property_depth_exceeded', reader.offset, 'Property path exceeds configured depth');
    }
    stack.push(...pushed);
    const key = stack.join('/');
    const keyBytes = Buffer.byteLength(key, 'utf8');
    cumulativeKeyBytes += keyBytes;
    if (keyBytes > limits.maxPropertyPathBytes ||
        cumulativeKeyBytes > limits.maxCumulativePropertyKeyBytes) {
      throw readerError('property_path_budget_exceeded', reader.offset, 'Property paths exceed configured budget');
    }
    if (entries.has(key)) throw readerError('duplicate_property', typeOffset, `Duplicate property '${key}'`);
    const valueLength = reader.varUint();
    if (valueLength > limits.maxPropertyValueBytes) {
      throw readerError('property_value_too_large', reader.offset, 'Property value exceeds configured limit');
    }
    const valueOffset = reader.offset;
    reader.require(valueLength);
    const valueReader = new BinaryReader(reader.bytes, valueOffset, valueOffset + valueLength, limits);
    reader.offset += valueLength;
    entries.set(key, decodeValue(type, valueReader, valueOffset));
  }
  if (!terminated) throw readerError('unterminated_properties', reader.offset, 'Property dictionary lacks terminator');
  if (reader.remaining !== 0) {
    throw readerError('trailing_property_data', reader.offset, 'Unexpected bytes after property terminator');
  }
  return Object.fromEntries(entries);
}

function decodeValue(type, reader, sourceOffset) {
  let value;
  if (type === 1) {
    try {
      value = utf8.decode(reader.raw(reader.remaining));
    } catch {
      throw readerError('invalid_utf8', sourceOffset, 'Property string is not valid UTF-8');
    }
  } else if (type === 2 || type === 3) {
    value = reader.varUint();
    if (type === 3) value = -value;
  } else if (type === 4) {
    if (reader.remaining === 0 || reader.remaining % 8 !== 0) {
      throw readerError('invalid_property_number', sourceOffset, 'Property number length must be a multiple of 8');
    }
    const values = [];
    while (reader.remaining) values.push(reader.f64());
    value = values.length === 1 ? values[0] : values;
  } else {
    throw readerError('unknown_property_type', sourceOffset, `Unknown property type ${type}`);
  }
  if (reader.remaining !== 0) {
    throw readerError('invalid_property_value', sourceOffset, 'Property value has trailing bytes');
  }
  return value;
}

module.exports = { parseProperties };
