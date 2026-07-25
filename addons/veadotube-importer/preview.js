'use strict';

const crypto = require('node:crypto');
const { composeStaticImage } = require('./compositor');
const { encodePng, validatePng } = require('./png');
const { decodeTexturePayload } = require('./textures');

function* generateStaticPreviews(bytes, document, plan, options) {
  const source = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const imagesById = new Map(document.images.map(image => [image.id, image]));
  const entries = [...plan.assets, ...plan.reviewAssets]
    .filter(asset => asset.kind === 'static_png');
  const limits = {
    maxPreviewCount: options?.maxPreviewCount ?? 1000,
    maxTotalPreviewPixels: options?.maxTotalPreviewPixels ?? 256 * 1024 * 1024,
    maxTotalPngBytes: options?.maxTotalPngBytes ?? 512 * 1024 * 1024
  };
  if (entries.length > limits.maxPreviewCount) {
    throw previewError('preview_count_exceeded', 'Preview count exceeds configured limit');
  }
  const fileNames = new Set();
  let totalPixels = 0;
  let totalPngBytes = 0;
  for (const entry of entries) {
    validateFileName(entry.fileName, fileNames);
    const image = imagesById.get(entry.sourceImageId);
    if (!image) throw previewError('missing_image', `Preview image ${entry.sourceImageId} is missing`);
    totalPixels += image.width * image.height;
    if (!Number.isSafeInteger(totalPixels) || totalPixels > limits.maxTotalPreviewPixels) {
      throw previewError('preview_pixel_budget_exceeded', 'Preview pixels exceed configured limit');
    }
    const frame = image.frames[0];
    const descriptor = frame.texture;
    const end = descriptor.dataOffset + descriptor.dataLength;
    if (!Number.isSafeInteger(descriptor.dataOffset) || !Number.isSafeInteger(end) ||
        descriptor.dataOffset < 0 || end > source.length) {
      throw previewError('truncated_data', 'Preview texture exceeds source bounds');
    }
    const rgba = decodeTexturePayload({
      ...descriptor,
      data: source.subarray(descriptor.dataOffset, end)
    }, options);
    const composed = composeStaticImage(image, {
      textureId: frame.textureId,
      width: descriptor.width,
      height: descriptor.height,
      rgba
    }, options);
    const png = encodePng(composed, options);
    const validated = validatePng(png, options);
    if (validated.width !== composed.width || validated.height !== composed.height ||
        !validated.rgba.equals(composed.rgba)) {
      throw previewError('preview_validation_failed', 'PNG preview did not validate losslessly');
    }
    totalPngBytes += png.length;
    if (!Number.isSafeInteger(totalPngBytes) || totalPngBytes > limits.maxTotalPngBytes) {
      throw previewError('preview_byte_budget_exceeded', 'Preview PNG bytes exceed configured limit');
    }
    yield {
      fileName: entry.fileName,
      sourceImageId: entry.sourceImageId,
      width: composed.width,
      height: composed.height,
      byteLength: png.length,
      sha256: crypto.createHash('sha256').update(png).digest('hex'),
      png
    };
  }
}

function validateFileName(fileName, seen) {
  if (typeof fileName !== 'string' ||
      !/^(?:review\/)?[a-z0-9][a-z0-9_-]{0,127}\.png$/.test(fileName)) {
    throw previewError('invalid_preview_filename', 'Preview filename is not safe');
  }
  if (seen.has(fileName)) {
    throw previewError('duplicate_preview_filename', `Duplicate preview filename ${fileName}`);
  }
  seen.add(fileName);
}

function previewError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

module.exports = { generateStaticPreviews };
