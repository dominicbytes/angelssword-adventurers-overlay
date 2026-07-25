'use strict';

const utf8 = new TextDecoder('utf-8', { fatal: true });

function readerError(code, offset, message) {
  const error = new Error(message);
  error.code = code;
  error.offset = offset;
  return error;
}

class BinaryReader {
  constructor(input, start, end, options) {
    this.bytes = Buffer.isBuffer(input) ? input : Buffer.from(input);
    this.offset = start ?? 0;
    this.end = end ?? this.bytes.length;
    this.maxStringBytes = options?.maxStringBytes ?? 64 * 1024;
    if (this.offset < 0 || this.end < this.offset || this.end > this.bytes.length) {
      throw readerError('invalid_bounds', this.offset, 'Invalid binary reader bounds');
    }
  }

  get remaining() {
    return this.end - this.offset;
  }

  require(length) {
    if (!Number.isSafeInteger(length) || length < 0 || length > this.remaining) {
      throw readerError('truncated_data', this.offset, 'Unexpected end of VeadoTube data');
    }
  }

  u8() {
    this.require(1);
    return this.bytes[this.offset++];
  }

  u32() {
    this.require(4);
    const value = this.bytes.readUInt32LE(this.offset);
    this.offset += 4;
    return value;
  }

  f64() {
    this.require(8);
    const value = this.bytes.readDoubleLE(this.offset);
    this.offset += 8;
    if (!Number.isFinite(value)) {
      throw readerError('invalid_number', this.offset - 8, 'Non-finite VeadoTube number');
    }
    return value;
  }

  fourCC() {
    this.require(4);
    const value = this.bytes.toString('ascii', this.offset, this.offset + 4);
    this.offset += 4;
    return value;
  }

  varUint() {
    let value = 0;
    for (let index = 0; index < 5; index += 1) {
      const byteOffset = this.offset;
      const byte = this.u8();
      const payload = byte & 0x7f;
      if (index === 4 && (payload > 0x0f || (byte & 0x80) !== 0)) {
        throw readerError('varint_overflow', byteOffset, '7-bit integer exceeds uint32');
      }
      value += payload * (2 ** (index * 7));
      if ((byte & 0x80) === 0) return value;
    }
    throw readerError('varint_overflow', this.offset - 1, '7-bit integer exceeds uint32');
  }

  raw(length) {
    this.require(length);
    const value = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  string() {
    const length = this.varUint();
    if (length > this.maxStringBytes) {
      throw readerError('string_too_large', this.offset, 'VeadoTube string exceeds configured limit');
    }
    const stringOffset = this.offset;
    const value = this.raw(length);
    try {
      return utf8.decode(value);
    } catch {
      throw readerError('invalid_utf8', stringOffset, 'VeadoTube string is not valid UTF-8');
    }
  }
}

module.exports = { BinaryReader, readerError };
