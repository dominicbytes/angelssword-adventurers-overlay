'use strict';

function composeStaticImage(image, texture, options) {
  if (!Array.isArray(image?.frames) || image.frames.length !== 1) {
    throw compositionError('animation_not_static', 'Static composition requires exactly one frame');
  }
  const frame = image.frames[0];
  if (frame.textureId !== texture?.textureId) {
    throw compositionError('texture_reference_mismatch', 'Decoded texture does not match the frame');
  }
  const canvasPixels = checkedPixels(image.width, image.height, 'canvas');
  const texturePixels = checkedPixels(texture.width, texture.height, 'texture');
  const maxCanvasPixels = options?.maxCanvasPixels ?? 64 * 1024 * 1024;
  if (canvasPixels > maxCanvasPixels) {
    throw compositionError('pixel_budget_exceeded', 'Composed canvas exceeds configured limit');
  }
  if (!Buffer.isBuffer(texture.rgba) || texture.rgba.length !== texturePixels * 4) {
    throw compositionError('invalid_rgba_texture', 'Decoded texture length does not match dimensions');
  }
  if (!Number.isSafeInteger(frame.offsetX) || !Number.isSafeInteger(frame.offsetY) ||
      frame.offsetX < 0 || frame.offsetY < 0 ||
      frame.offsetX + texture.width > image.width ||
      frame.offsetY + texture.height > image.height) {
    throw compositionError('frame_out_of_bounds', 'Frame texture exceeds its image canvas');
  }
  const canvas = Buffer.alloc(canvasPixels * 4);
  const destinationY = image.height - frame.offsetY - texture.height;
  const sourceRowBytes = texture.width * 4;
  const canvasRowBytes = image.width * 4;
  for (let row = 0; row < texture.height; row += 1) {
    const sourceStart = row * sourceRowBytes;
    const destinationStart = (destinationY + row) * canvasRowBytes + frame.offsetX * 4;
    texture.rgba.copy(canvas, destinationStart, sourceStart, sourceStart + sourceRowBytes);
  }
  return { width: image.width, height: image.height, rgba: canvas };
}

function checkedPixels(width, height, label) {
  const pixels = width * height;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
      width <= 0 || height <= 0 || !Number.isSafeInteger(pixels)) {
    throw compositionError('invalid_dimensions', `Invalid ${label} dimensions`);
  }
  return pixels;
}

function compositionError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

module.exports = { composeStaticImage };
