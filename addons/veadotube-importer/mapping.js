'use strict';

const { isSupportedTextureFormat } = require('./textures');

const CORE_TARGET_NAMES = Object.freeze(['neutral', 'happy', 'sad', 'surprised']);
const CORE_TARGETS = new Set(CORE_TARGET_NAMES);
const IMAGE_ROLES = ['idle', 'speaking', 'blinking_idle', 'blinking_speaking'];
const EFFECT_LISTS = [
  ['closedEffects', 'closed'],
  ['openEffects', 'open'],
  ['closedToOpenTransitions', 'closed_to_open'],
  ['openToClosedTransitions', 'open_to_closed']
];

function createImportPlan(document, selections, options) {
  const statesById = new Map(document.states.map(state => [state.id, state]));
  const imagesById = new Map(document.images.map(image => [image.id, image]));
  validateSelections(selections, statesById, new Set(options?.assetStates || []));
  const selectedByState = new Map(selections.map(selection => [selection.stateId, selection.target]));
  const mappings = [...selectedByState].map(([stateId, target]) => {
    const state = statesById.get(stateId);
    return { stateId, sourceName: state.name, target };
  }).sort((left, right) => left.stateId - right.stateId);
  const assets = [];
  const reviewAssets = [];
  const unmappedStates = [];
  const warnings = [];

  for (const state of document.states) {
    const target = selectedByState.get(state.id);
    if (!target) {
      unmappedStates.push({ stateId: state.id, name: state.name, imageIds: [...state.images] });
      state.images.forEach((imageId, index) => {
        reviewAssets.push(reviewAsset(
          state.id, imageId, IMAGE_ROLES[index], 'unmapped_state', imagesById
        ));
      });
      warnings.push({ code: 'unmapped_state', stateId: state.id });
      continue;
    }
    assets.push(plannedAsset(`${target}_idle`, state.images[0], imagesById, state.id, 'idle'));
    assets.push(plannedAsset(
      `${target}_speaking`, state.images[1], imagesById, state.id, 'speaking'
    ));
    if (target === 'neutral') {
      assets.push(plannedAsset(
        'eyes_closed', state.images[2], imagesById, state.id, 'blinking_idle'
      ));
    } else {
      reviewAssets.push(reviewAsset(
        state.id, state.images[2], 'blinking_idle', 'unrepresentable_blink_variant', imagesById
      ));
      warnings.push({
        code: 'unrepresentable_blink_variant', stateId: state.id, imageId: state.images[2]
      });
    }
    reviewAssets.push(reviewAsset(
      state.id, state.images[3], 'blinking_speaking', 'unrepresentable_blink_variant', imagesById
    ));
    warnings.push({
      code: 'unrepresentable_blink_variant', stateId: state.id, imageId: state.images[3]
    });
  }
  for (const asset of assets) {
    if (asset.kind === 'animated_unresolved') {
      warnings.push({
        code: 'animated_output_unresolved', state: asset.state, imageId: asset.sourceImageId
      });
    } else if (asset.kind === 'unsupported_texture') {
      warnings.push({
        code: 'unsupported_texture_asset', state: asset.state,
        imageId: asset.sourceImageId, formats: asset.unsupportedFormats
      });
    }
  }
  for (const asset of reviewAssets) {
    if (asset.kind === 'animated_unresolved') {
      warnings.push({
        code: 'animated_output_unresolved', role: asset.role, imageId: asset.sourceImageId
      });
    } else if (asset.kind === 'unsupported_texture') {
      warnings.push({
        code: 'unsupported_texture_asset', role: asset.role,
        imageId: asset.sourceImageId, formats: asset.unsupportedFormats
      });
    }
  }
  const conversion = conversionReport(document);
  for (const format of conversion.formats) {
    if (format.status === 'unsupported') {
      warnings.push({ code: 'unsupported_texture_format', format: format.sourceFormat });
    }
  }

  return {
    schemaVersion: 1,
    conversion,
    mappings,
    assets: assets.sort((left, right) => compareText(left.state, right.state)),
    reviewAssets,
    unmappedStates,
    effectSuggestions: collectEffects(document.states),
    shortcutSuggestions: collectShortcuts(document.states),
    warnings
  };
}

function suggestMappings(document) {
  return document.states.flatMap(state => {
    const target = state.name.toLowerCase().replace(/[^a-z0-9]+/g, '');
    if (!CORE_TARGETS.has(target)) return [];
    return [{
      stateId: state.id,
      sourceName: state.name,
      target,
      reason: 'normalized_name_match',
      requiresConfirmation: true
    }];
  });
}

function validateSelections(selections, statesById, assetStates) {
  const stateIds = new Set();
  const targets = new Set();
  for (const selection of selections) {
    if (stateIds.has(selection.stateId)) {
      throw planError('duplicate_state_mapping', `State ${selection.stateId} is mapped more than once`);
    }
    if (targets.has(selection.target)) {
      throw planError('duplicate_target_mapping', `Target ${selection.target} is mapped more than once`);
    }
    if (!statesById.has(selection.stateId)) {
      throw planError('missing_state', `Mini state ${selection.stateId} does not exist`);
    }
    if (!isSafeName(selection.target)) {
      throw planError('invalid_target', `Target ${selection.target} is not a safe asset name`);
    }
    if (!CORE_TARGETS.has(selection.target) && !(
      assetStates.has(`${selection.target}_idle`) && assetStates.has(`${selection.target}_speaking`)
    )) {
      throw planError('unsupported_target', `Target ${selection.target} is not declared by AngelSword`);
    }
    stateIds.add(selection.stateId);
    targets.add(selection.target);
  }
}

function planError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function plannedAsset(state, imageId, imagesById, stateId, role) {
  const image = imagesById.get(imageId);
  if (!image) {
    const error = planError('missing_image', `State ${stateId} has no image for ${role}`);
    error.stateId = stateId;
    error.role = role;
    error.imageId = imageId;
    throw error;
  }
  const summary = imageSummary(image);
  return {
    state,
    fileName: summary.kind === 'static_png' ? `${state}.png` : null,
    sourceImageId: imageId,
    ...summary
  };
}

function reviewAsset(stateId, imageId, role, reason, imagesById) {
  const image = imagesById.get(imageId);
  if (!image) {
    return {
      stateId, sourceImageId: imageId, role, fileName: null, reason,
      kind: 'missing', width: null, height: null, frameCount: 0,
      duration: 0, loopCount: 0, timingChange: 'unresolved'
    };
  }
  const summary = imageSummary(image);
  return {
    stateId,
    sourceImageId: imageId,
    role,
    fileName: summary.kind === 'static_png'
      ? `review/state-${stateId}-${role.replaceAll('_', '-')}.png`
      : null,
    reason,
    ...summary
  };
}

function imageSummary(image) {
  const unsupportedFormats = [...new Set(image.frames.map(frame => frame.texture.format))]
    .filter(format => !isSupportedTextureFormat(format))
    .sort(compareText);
  const isStatic = image.frames.length === 1;
  const kind = unsupportedFormats.length > 0
    ? 'unsupported_texture'
    : isStatic ? 'static_png' : 'animated_unresolved';
  return {
    kind,
    width: image.width,
    height: image.height,
    frameCount: image.frames.length,
    duration: image.frames.reduce((total, frame) => total + frame.duration, 0),
    loopCount: image.loopCount,
    timingChange: kind === 'static_png' ? 'none' : 'unresolved',
    ...(unsupportedFormats.length > 0 ? { unsupportedFormats } : {})
  };
}

function conversionReport(document) {
  const sourceFormats = new Set();
  for (const image of document.images) {
    for (const frame of image.frames) sourceFormats.add(frame.texture.format);
  }
  return { formats: [...sourceFormats].sort(compareText).map(sourceFormat => {
    if (!isSupportedTextureFormat(sourceFormat)) {
      return { sourceFormat, status: 'unsupported' };
    }
    return {
      sourceFormat,
      status: 'supported',
      decodedPixelFormat: 'RGBA8',
      sourceRowOrder: 'bottom_up',
      decodedRowOrder: 'top_down',
      colorChannels: 'preserved',
      alphaChannel: 'preserved'
    };
  }) };
}

function isSafeName(value) {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(value);
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function collectEffects(states) {
  return states.flatMap(state => EFFECT_LISTS.flatMap(([property, phase]) => (
    state[property].map(effect => ({
      stateId: state.id,
      phase,
      type: effect.type,
      active: effect.active,
      ...(effect.presetId ? { presetId: effect.presetId } : {}),
      ...(effect.customPresetChunkId ? { customPresetChunkId: effect.customPresetChunkId } : {}),
      values: [...effect.values],
      enabled: false
    }))
  )));
}

function collectShortcuts(states) {
  return states.flatMap(state => state.shortcuts.map(shortcut => ({
    stateId: state.id,
    provider: shortcut.provider,
    signal: shortcut.signal,
    enabled: false
  })));
}

module.exports = { CORE_TARGET_NAMES, createImportPlan, suggestMappings };
