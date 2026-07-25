'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { composeStaticImage } = require('../compositor');

test('composes a bottom-origin VeadoTube frame onto a top-down transparent canvas', () => {
  const image = {
    id: 7,
    width: 3,
    height: 2,
    frames: [{ textureId: 9, offsetX: 1, offsetY: 0, duration: 0.25 }]
  };
  const texture = {
    textureId: 9,
    width: 2,
    height: 1,
    rgba: Buffer.from([
      255, 0, 0, 255,
      0, 255, 0, 128
    ])
  };

  const composed = composeStaticImage(image, texture);

  assert.deepEqual(composed, {
    width: 3,
    height: 2,
    rgba: Buffer.from([
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 255, 0, 0, 255, 0, 255, 0, 128
    ])
  });
});

test('rejects animated, mismatched, out-of-bounds, and excessive compositions', () => {
  const image = {
    id: 7, width: 2, height: 2,
    frames: [{ textureId: 9, offsetX: 0, offsetY: 0, duration: 0.1 }]
  };
  const texture = { textureId: 9, width: 2, height: 2, rgba: Buffer.alloc(16) };

  assert.throws(() => composeStaticImage({ ...image, frames: [...image.frames, image.frames[0]] }, texture),
    error => error.code === 'animation_not_static');
  assert.throws(() => composeStaticImage(image, { ...texture, textureId: 10 }),
    error => error.code === 'texture_reference_mismatch');
  assert.throws(() => composeStaticImage(image, { ...texture, rgba: Buffer.alloc(15) }),
    error => error.code === 'invalid_rgba_texture');
  assert.throws(() => composeStaticImage({
    ...image, frames: [{ ...image.frames[0], offsetX: 1 }]
  }, texture), error => error.code === 'frame_out_of_bounds');
  assert.throws(() => composeStaticImage(image, texture, { maxCanvasPixels: 3 }),
    error => error.code === 'pixel_budget_exceeded');
});
