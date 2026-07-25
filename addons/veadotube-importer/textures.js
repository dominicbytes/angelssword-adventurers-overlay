'use strict';

const { readerError } = require('./reader');

const CONSTANT_CHANNEL = 0xffffff00;

function isSupportedTextureFormat(format) {
  return format === 'RAW.' || format === 'VDD.';
}

function* decodeDocumentTextures(bytes, document, options) {
  const source = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const maxTotalDecodedPixels = options?.maxTotalDecodedPixels ?? 256 * 1024 * 1024;
  const decodedIds = new Set();
  let totalPixels = 0;
  for (const image of document.images) {
    for (const frame of image.frames) {
      if (decodedIds.has(frame.textureId)) continue;
      const texture = frame.texture;
      const end = texture.dataOffset + texture.dataLength;
      if (!Number.isSafeInteger(texture.dataOffset) || !Number.isSafeInteger(end) ||
          texture.dataOffset < 0 || end > source.length) {
        throw readerError('truncated_data', texture.dataOffset, 'Texture payload exceeds source bounds');
      }
      totalPixels += texture.width * texture.height;
      if (!Number.isSafeInteger(totalPixels) || totalPixels > maxTotalDecodedPixels) {
        throw readerError(
          'pixel_budget_exceeded', texture.dataOffset,
          'Decoded document texture pixels exceed configured limit'
        );
      }
      const rgba = decodeTexturePayload({
        ...texture,
        data: source.subarray(texture.dataOffset, end)
      }, options);
      decodedIds.add(frame.textureId);
      yield { textureId: frame.textureId, width: texture.width, height: texture.height, rgba };
    }
  }
}

function decodeTexturePayload(texture, options) {
  const limits = {
    maxDecodedPixels: 64 * 1024 * 1024,
    ...(options || {})
  };
  const { format, width, height } = texture || {};
  const data = Buffer.isBuffer(texture?.data) ? texture.data : Buffer.from(texture?.data || []);
  const dataOffset = texture?.dataOffset || 0;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw readerError('invalid_dimensions', dataOffset, 'Texture dimensions must be positive integers');
  }
  const pixels = width * height;
  if (!Number.isSafeInteger(pixels) || pixels > limits.maxDecodedPixels) {
    throw readerError('pixel_budget_exceeded', dataOffset, 'Decoded texture pixels exceed configured limit');
  }
  if (!isSupportedTextureFormat(format)) {
    throw readerError('unsupported_texture_format', dataOffset, `Unsupported texture format ${format}`);
  }
  return format === 'RAW.'
    ? flipRows(decodeRaw(data, pixels, dataOffset), width, height)
    : flipRows(decodeVdd(data, pixels, dataOffset), width, height);
}

function decodeRaw(data, pixels, dataOffset) {
  if (data.length !== pixels * 4) {
    throw readerError('invalid_raw_texture', dataOffset, 'RAW texture length does not match dimensions');
  }
  return Buffer.from(data);
}

function decodeVdd(data, pixels, dataOffset) {
  if (data.length < 16) {
    throw readerError('invalid_vdd_texture', dataOffset, 'VDD texture is missing channel headers');
  }
  const headers = Array.from({ length: 4 }, (_, index) => data.readUInt32LE(index * 4));
  let cursor = 16;
  const channels = headers.map((header, index) => {
    if (header >= CONSTANT_CHANNEL) {
      return { constant: header & 0xff, offset: dataOffset + index * 4 };
    }
    const byteLength = header * 4;
    if (cursor + byteLength > data.length) {
      throw readerError(
        'invalid_vdd_texture', dataOffset + cursor,
        'VDD channel length exceeds texture payload'
      );
    }
    const channel = {
      data: data.subarray(cursor, cursor + byteLength),
      offset: dataOffset + cursor
    };
    cursor += byteLength;
    return channel;
  });
  if (cursor !== data.length) {
    throw readerError('invalid_vdd_texture', dataOffset + cursor, 'Unexpected bytes after VDD channels');
  }

  const alpha = decodeChannel(channels[0], pixels, 255);
  const visiblePixels = alpha.reduce((count, value) => count + (value === 0 ? 0 : 1), 0);
  const colors = channels.slice(1).map(channel => (
    channel.constant === undefined ? decodeChannel(channel, visiblePixels, 0) : null
  ));
  const rgba = Buffer.alloc(pixels * 4);
  let visibleIndex = 0;
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    const output = pixel * 4;
    const isVisible = alpha[pixel] !== 0;
    for (let channel = 0; channel < 3; channel += 1) {
      rgba[output + channel] = channels[channel + 1].constant ?? (
        isVisible ? colors[channel][visibleIndex] : 0
      );
    }
    rgba[output + 3] = alpha[pixel];
    if (isVisible) visibleIndex += 1;
  }
  return rgba;
}

function decodeChannel(channel, count, initialValue) {
  if (channel.constant !== undefined) return Buffer.alloc(count, channel.constant);
  if (count === 0) {
    if (channel.data.length !== 0) {
      throw readerError('invalid_vdd_texture', channel.offset, 'Unused VDD channel contains data');
    }
    return Buffer.alloc(0);
  }
  const bits = new BitReader(channel.data, channel.offset);
  const output = Buffer.alloc(count);
  let current = initialValue;
  let outputIndex = 0;
  while (outputIndex < count) {
    const tokenOffset = bits.sourceOffset;
    const token = readDelta(bits);
    if (outputIndex + token.repeat > count) {
      throw readerError('invalid_vdd_texture', tokenOffset, 'VDD run exceeds channel pixel count');
    }
    for (let repeat = 0; repeat < token.repeat; repeat += 1) {
      current = (current + token.delta + 256) & 0xff;
      output[outputIndex++] = current;
    }
  }
  return output;
}

function readDelta(bits) {
  let magnitude = 0;
  let repeat = 1;
  if (bits.read(1) === 1) {
    if (bits.read(1) === 1) magnitude = bits.read(1) + 1;
  } else if (bits.read(1) === 1) {
    magnitude = bits.read(1) === 0 ? bits.read(1) + 3 : bits.read(2) + 5;
  } else if (bits.read(1) === 1) {
    magnitude = bits.read(1) === 0 ? bits.read(3) + 9 : bits.read(4) + 17;
  } else if (bits.read(1) === 1) {
    magnitude = bits.read(1) === 0 ? bits.read(5) + 33 : bits.read(6) + 65;
  } else {
    repeat = bits.read(8) + 7;
  }
  const delta = magnitude === 0 ? 0 : (bits.read(1) === 1 ? magnitude : -magnitude);
  return { delta, repeat };
}

class BitReader {
  constructor(data, offset) {
    this.data = data;
    this.offset = offset;
    this.bitOffset = 0;
  }

  get sourceOffset() {
    return this.offset + Math.floor(this.bitOffset / 8);
  }

  read(count) {
    let value = 0;
    for (let index = 0; index < count; index += 1) {
      if (this.bitOffset >= this.data.length * 8) {
        throw readerError('invalid_vdd_texture', this.sourceOffset, 'Unexpected end of VDD channel');
      }
      const byte = this.data[Math.floor(this.bitOffset / 8)];
      value |= ((byte >>> (this.bitOffset % 8)) & 1) << index;
      this.bitOffset += 1;
    }
    return value;
  }
}

function flipRows(bottomUp, width, height) {
  const rowBytes = width * 4;
  const topDown = Buffer.alloc(bottomUp.length);
  for (let row = 0; row < height; row += 1) {
    bottomUp.copy(topDown, row * rowBytes, (height - row - 1) * rowBytes, (height - row) * rowBytes);
  }
  return topDown;
}

module.exports = { decodeDocumentTextures, decodeTexturePayload, isSupportedTextureFormat };
