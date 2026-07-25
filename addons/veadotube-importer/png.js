'use strict';

const zlib = require('node:zlib');

const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');
const CRC_TABLE = buildCrcTable();

function encodePng(image, options) {
  const limits = pngLimits(options);
  const pixels = validateImageShape(image, limits);
  const rowBytes = image.width * 4;
  const scanlines = Buffer.alloc(pixels * 4 + image.height);
  for (let row = 0; row < image.height; row += 1) {
    const scanlineStart = row * (rowBytes + 1);
    scanlines[scanlineStart] = 0;
    image.rgba.copy(scanlines, scanlineStart + 1, row * rowBytes, (row + 1) * rowBytes);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(image.width, 0);
  header.writeUInt32BE(image.height, 4);
  header[8] = 8;
  header[9] = 6;
  const compressed = zlib.deflateSync(scanlines, { level: 9 });
  const png = Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', header),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
  if (png.length > limits.maxPngBytes) {
    throw pngError('png_too_large', 'Encoded PNG exceeds configured limit');
  }
  return png;
}

function validatePng(input, options) {
  const limits = pngLimits(options);
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input || []);
  if (bytes.length > limits.maxPngBytes) {
    throw pngError('png_too_large', 'PNG exceeds configured limit');
  }
  if (bytes.length < PNG_SIGNATURE.length ||
      !bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw pngError('invalid_png_signature', 'Invalid PNG signature');
  }
  let offset = PNG_SIGNATURE.length;
  let header = null;
  let ended = false;
  const imageData = [];
  let compressedBytes = 0;
  while (offset < bytes.length) {
    if (bytes.length - offset < 12) throw pngError('truncated_png', 'Truncated PNG chunk');
    const length = bytes.readUInt32BE(offset);
    const dataOffset = offset + 8;
    const dataEnd = dataOffset + length;
    const chunkEnd = dataEnd + 4;
    if (length > 0x7fffffff || chunkEnd > bytes.length) {
      throw pngError('truncated_png', 'PNG chunk exceeds source bounds');
    }
    const typeBytes = bytes.subarray(offset + 4, offset + 8);
    const type = typeBytes.toString('ascii');
    const data = bytes.subarray(dataOffset, dataEnd);
    const expectedCrc = bytes.readUInt32BE(dataEnd);
    if (crc32(Buffer.concat([typeBytes, data])) !== expectedCrc) {
      throw pngError('invalid_png_crc', `Invalid ${type} chunk CRC`);
    }
    if (type === 'IHDR') {
      if (header || offset !== PNG_SIGNATURE.length || length !== 13) {
        throw pngError('invalid_png_header', 'Invalid PNG IHDR chunk');
      }
      header = parseHeader(data, limits);
    } else if (type === 'IDAT') {
      if (!header || ended) throw pngError('invalid_png_order', 'PNG IDAT is out of order');
      compressedBytes += data.length;
      if (compressedBytes > limits.maxPngBytes) {
        throw pngError('png_too_large', 'PNG image data exceeds configured limit');
      }
      imageData.push(data);
    } else if (type === 'IEND') {
      if (!header || length !== 0 || imageData.length === 0) {
        throw pngError('invalid_png_order', 'Invalid PNG IEND chunk');
      }
      ended = true;
    } else if ((typeBytes[0] & 0x20) === 0) {
      throw pngError('unsupported_png_chunk', `Unsupported critical PNG chunk ${type}`);
    }
    offset = chunkEnd;
    if (ended) break;
  }
  if (!ended || offset !== bytes.length) throw pngError('truncated_png', 'PNG has no final IEND');

  const rowBytes = header.width * 4;
  const expectedLength = (rowBytes + 1) * header.height;
  let scanlines;
  try {
    scanlines = zlib.inflateSync(Buffer.concat(imageData), { maxOutputLength: expectedLength });
  } catch {
    throw pngError('invalid_png_data', 'PNG image data could not be decompressed');
  }
  if (scanlines.length !== expectedLength) {
    throw pngError('invalid_png_data', 'PNG scanline length does not match dimensions');
  }
  const rgba = Buffer.alloc(header.width * header.height * 4);
  for (let row = 0; row < header.height; row += 1) {
    const scanlineStart = row * (rowBytes + 1);
    if (scanlines[scanlineStart] !== 0) {
      throw pngError('unsupported_png_filter', 'Preview PNG uses an unsupported filter');
    }
    scanlines.copy(rgba, row * rowBytes, scanlineStart + 1, scanlineStart + 1 + rowBytes);
  }
  return { width: header.width, height: header.height, rgba };
}

function parseHeader(data, limits) {
  const width = data.readUInt32BE(0);
  const height = data.readUInt32BE(4);
  validateDimensions(width, height, limits);
  if (data[8] !== 8 || data[9] !== 6 || data[10] !== 0 ||
      data[11] !== 0 || data[12] !== 0) {
    throw pngError('unsupported_png_header', 'PNG must be non-interlaced RGBA8');
  }
  return { width, height };
}

function validateImageShape(image, limits) {
  const pixels = validateDimensions(image?.width, image?.height, limits);
  if (!Buffer.isBuffer(image.rgba) || image.rgba.length !== pixels * 4) {
    throw pngError('invalid_rgba_image', 'RGBA byte length does not match dimensions');
  }
  return pixels;
}

function validateDimensions(width, height, limits) {
  const pixels = width * height;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
      width <= 0 || height <= 0 || !Number.isSafeInteger(pixels)) {
    throw pngError('invalid_dimensions', 'PNG dimensions must be positive integers');
  }
  if (width > limits.maxDimension || height > limits.maxDimension) {
    throw pngError('dimension_limit_exceeded', 'PNG dimensions exceed configured limit');
  }
  if (pixels > limits.maxPixels) {
    throw pngError('pixel_budget_exceeded', 'PNG pixels exceed configured limit');
  }
  return pixels;
}

function pngLimits(options) {
  return {
    maxDimension: options?.maxDimension ?? 16384,
    maxPixels: options?.maxPixels ?? 64 * 1024 * 1024,
    maxPngBytes: options?.maxPngBytes ?? 256 * 1024 * 1024
  };
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const output = Buffer.alloc(12 + data.length);
  output.writeUInt32BE(data.length, 0);
  typeBytes.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 8 + data.length);
  return output;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function buildCrcTable() {
  return Array.from({ length: 256 }, (_, value) => {
    let crc = value;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) !== 0 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    return crc >>> 0;
  });
}

function pngError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

module.exports = { encodePng, validatePng };
