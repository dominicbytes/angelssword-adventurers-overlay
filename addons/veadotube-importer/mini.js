'use strict';

const { BinaryReader, readerError } = require('./reader');

function referenceError(offset, referenceId, expectedType) {
  const error = readerError(
    'missing_reference',
    offset,
    `Missing ${expectedType} chunk reference ${referenceId}`
  );
  error.referenceId = referenceId;
  error.expectedType = expectedType;
  return error;
}

function decodeMiniAvatar(bytes, inventory, options) {
  const limits = {
    maxStates: 256,
    maxListEntries: 256,
    maxEffectValues: 32,
    maxStringBytes: 64 * 1024,
    maxDimension: 16384,
    maxFrames: 1024,
    maxTotalFrames: 10000,
    maxFrameDuration: 3600,
    maxAnimationDuration: 24 * 60 * 60,
    maxLoopCount: 100000,
    maxDecodedPixels: 256 * 1024 * 1024,
    ...(options || {})
  };
  if (inventory.format !== 'mini') {
    throw readerError('unsupported_format', 0, 'Document is not an unambiguous Mini avatar');
  }
  const chunksById = new Map();
  for (const chunk of inventory.chunks) {
    if (chunksById.has(chunk.id)) {
      throw readerError('duplicate_chunk_id', chunk.offset, `Duplicate chunk id ${chunk.id}`);
    }
    chunksById.set(chunk.id, chunk);
  }

  const miniLists = inventory.chunks.filter(chunk => chunk.type === 'MLST');
  if (miniLists.length !== 1) {
    throw readerError('invalid_mini_list', miniLists[1]?.offset || 0, 'Mini avatar requires exactly one MLST chunk');
  }
  const listChunk = miniLists[0];
  if (listChunk.length % 4 !== 0 || listChunk.length / 4 > limits.maxStates) {
    throw readerError('invalid_state_count', listChunk.dataOffset, 'Invalid Mini state list length');
  }
  const listReader = readerFor(bytes, listChunk, limits);
  const stateReferences = [];
  while (listReader.remaining) {
    const referenceOffset = listReader.offset;
    stateReferences.push({ id: listReader.u32(), offset: referenceOffset });
  }

  const states = stateReferences.map(reference => {
    const stateChunk = chunksById.get(reference.id);
    if (!stateChunk || stateChunk.type !== 'MSTA') {
      throw referenceError(reference.offset, reference.id, 'MSTA');
    }
    return decodeState(bytes, stateChunk, chunksById, limits);
  });
  const referencedImageIds = [...new Set(states.flatMap(state => (
    [...state.thumbnails, ...state.images].filter(referenceId => referenceId !== 0)
  )))].sort((left, right) => left - right);
  const imageResult = decodeImages(bytes, referencedImageIds, chunksById, limits);
  const metadataChunks = inventory.chunks.filter(chunk => chunk.type === 'META');
  if (metadataChunks.length > 1) {
    throw readerError('duplicate_metadata', metadataChunks[1].offset, 'Document contains multiple META chunks');
  }
  return {
    schemaVersion: 1,
    metadata: metadataChunks.length ? decodeMetadata(bytes, metadataChunks[0], limits) : null,
    states,
    images: imageResult.images,
    decodedPixelBudget: imageResult.decodedPixelBudget
  };
}

function decodeMetadata(bytes, chunk, limits) {
  const reader = readerFor(bytes, chunk, limits);
  const metadata = {
    software: reader.string(),
    author: reader.string(),
    description: reader.string()
  };
  if (reader.remaining !== 0) {
    throw readerError('unexpected_metadata_data', reader.offset, 'Unexpected bytes at end of META chunk');
  }
  return metadata;
}

function readerFor(bytes, chunk, limits) {
  return new BinaryReader(bytes, chunk.dataOffset, chunk.dataOffset + chunk.length, limits);
}

function decodeState(bytes, chunk, chunksById, limits) {
  const reader = readerFor(bytes, chunk, limits);
  const name = reader.string();
  const rawFlags = reader.u8();
  const extendedLayout = hasExtendedStateLayout(reader, chunksById);
  if (extendedLayout) reader.raw(3);
  const thumbnailReferences = readReferences(reader, 4);
  const imageReferences = readReferences(reader, 4);
  const thumbnails = thumbnailReferences.map(reference => reference.id);
  const images = imageReferences.map(reference => reference.id);
  const undocumentedValues = extendedLayout
    ? Array.from({ length: 3 }, () => reader.f64())
    : [];
  const closedEffects = readEffectList(reader, chunksById, limits);
  const openEffects = readEffectList(reader, chunksById, limits);
  const closedToOpenTransitions = readEffectList(reader, chunksById, limits);
  const openToClosedTransitions = readEffectList(reader, chunksById, limits);
  const shortcuts = readShortcuts(reader, limits);
  const shortcutMode = reader.fourCC();
  if (reader.remaining !== 0) {
    throw readerError('unexpected_state_data', reader.offset, 'Unexpected bytes at end of MSTA chunk');
  }
  for (const reference of [...thumbnailReferences, ...imageReferences]) {
    if (reference.id === 0) continue;
    const target = chunksById.get(reference.id);
    if (!target || target.type !== 'AIMG') {
      throw referenceError(reference.offset, reference.id, 'AIMG');
    }
  }
  return {
    id: chunk.id,
    name,
    flags: {
      pixelated: (rawFlags & 0x1) !== 0,
      syncBlink: (rawFlags & 0x2) !== 0,
      resetOnActivate: (rawFlags & 0x4) !== 0
    },
    thumbnails,
    images,
    closedEffects,
    openEffects,
    closedToOpenTransitions,
    openToClosedTransitions,
    shortcuts,
    shortcutMode,
    undocumentedValues
  };
}

function readReferences(reader, count) {
  return Array.from({ length: count }, () => {
    const offset = reader.offset;
    return { id: reader.u32(), offset };
  });
}

function hasExtendedStateLayout(reader, chunksById) {
  if (reader.remaining < 3 + 32 + 24 || reader.bytes[reader.offset] !== 0 ||
      reader.bytes[reader.offset + 1] !== 0 || reader.bytes[reader.offset + 2] !== 0) {
    return false;
  }
  const firstReference = reader.offset + 3;
  for (let index = 0; index < 8; index += 1) {
    const referenceId = reader.bytes.readUInt32LE(firstReference + index * 4);
    if (referenceId !== 0 && chunksById.get(referenceId)?.type !== 'AIMG') return false;
  }
  return true;
}

function readCount(reader, limit, code) {
  const count = reader.varUint();
  if (count > limit) throw readerError(code, reader.offset, 'Mini list exceeds configured limit');
  return count;
}

function readEffectList(reader, chunksById, limits) {
  const count = readCount(reader, limits.maxListEntries, 'effect_limit');
  const effects = [];
  for (let index = 0; index < count; index += 1) {
    const type = reader.string();
    const flags = reader.u8();
    let customPresetChunkId = null;
    let presetId = null;
    if ((flags & 0x4) !== 0) {
      customPresetChunkId = reader.u32();
      const preset = chunksById.get(customPresetChunkId);
      if (!preset || preset.type !== 'MEPR') {
        throw referenceError(reader.offset - 4, customPresetChunkId, 'MEPR');
      }
    } else if ((flags & 0x2) !== 0) {
      presetId = reader.string();
    }
    const valueCount = readCount(reader, limits.maxEffectValues, 'effect_value_limit');
    const values = Array.from({ length: valueCount }, () => reader.f64());
    effects.push({
      type,
      active: (flags & 0x1) !== 0,
      presetId,
      customPresetChunkId,
      values
    });
  }
  return effects;
}

function readShortcuts(reader, limits) {
  const count = readCount(reader, limits.maxListEntries, 'shortcut_limit');
  return Array.from({ length: count }, () => ({
    provider: reader.string(),
    signal: reader.string()
  }));
}

function decodeImages(bytes, imageIds, chunksById, limits) {
  const textures = new Map();
  let decodedPixelBudget = 0;
  let totalFrames = 0;

  function decodeTexture(referenceId, referenceOffset) {
    if (textures.has(referenceId)) return textures.get(referenceId);
    const chunk = chunksById.get(referenceId);
    if (!chunk || chunk.type !== 'ABMP') throw referenceError(referenceOffset, referenceId, 'ABMP');
    const reader = readerFor(bytes, chunk, limits);
    const width = reader.u32();
    const height = reader.u32();
    validateDimensions(width, height, limits, chunk.dataOffset);
    const format = reader.fourCC();
    const dataLength = reader.remaining;
    const pixels = width * height;
    if (format === 'RAW.' && dataLength !== pixels * 4) {
      throw readerError('invalid_raw_texture', reader.offset, 'RAW texture length does not match dimensions');
    }
    if (format === 'VDD.' && dataLength < 16) {
      throw readerError('invalid_vdd_texture', reader.offset, 'VDD texture is missing channel headers');
    }
    decodedPixelBudget += pixels;
    if (decodedPixelBudget > limits.maxDecodedPixels) {
      throw readerError('pixel_budget_exceeded', chunk.dataOffset, 'Decoded texture pixels exceed configured limit');
    }
    const summary = { width, height, format, dataLength };
    textures.set(referenceId, summary);
    return summary;
  }

  const images = imageIds.map(imageId => {
    const chunk = chunksById.get(imageId);
    const reader = readerFor(bytes, chunk, limits);
    const width = reader.u32();
    const height = reader.u32();
    validateDimensions(width, height, limits, chunk.dataOffset);
    const frameCount = reader.varUint();
    if (frameCount === 0 || frameCount > limits.maxFrames) {
      throw readerError('invalid_frame_count', reader.offset, 'Image frame count exceeds configured limit');
    }
    totalFrames += frameCount;
    if (totalFrames > limits.maxTotalFrames) {
      throw readerError('frame_budget_exceeded', reader.offset, 'Total image frames exceed configured limit');
    }
    const loopCount = frameCount > 1 ? reader.varUint() : 0;
    if (loopCount > limits.maxLoopCount) {
      throw readerError('loop_count_exceeded', reader.offset, 'Image loop count exceeds configured limit');
    }
    let animationDuration = 0;
    const frames = Array.from({ length: frameCount }, () => {
      const referenceOffset = reader.offset;
      const textureId = reader.u32();
      const offsetX = reader.u32();
      const offsetY = reader.u32();
      const duration = reader.f64();
      if (duration < 0) throw readerError('invalid_frame_duration', reader.offset - 8, 'Negative frame duration');
      if (duration > limits.maxFrameDuration) {
        throw readerError('frame_duration_exceeded', reader.offset - 8, 'Frame duration exceeds configured limit');
      }
      animationDuration += duration;
      if (animationDuration > limits.maxAnimationDuration) {
        throw readerError('animation_duration_exceeded', reader.offset - 8, 'Animation duration exceeds configured limit');
      }
      const texture = decodeTexture(textureId, referenceOffset);
      if (offsetX + texture.width > width || offsetY + texture.height > height) {
        throw readerError('frame_out_of_bounds', referenceOffset + 4, 'Image frame exceeds canvas bounds');
      }
      return { textureId, offsetX, offsetY, duration, texture };
    });
    if (reader.remaining !== 0) {
      throw readerError('unexpected_image_data', reader.offset, 'Unexpected bytes at end of AIMG chunk');
    }
    return { id: imageId, width, height, loopCount, frames };
  });
  return { images, decodedPixelBudget };
}

function validateDimensions(width, height, limits, offset) {
  if (width === 0 || height === 0 || width > limits.maxDimension || height > limits.maxDimension) {
    throw readerError('invalid_dimensions', offset, 'Image dimensions exceed configured limits');
  }
}

module.exports = { decodeMiniAvatar };
