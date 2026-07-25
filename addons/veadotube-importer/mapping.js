'use strict';

const CORE_TARGETS = new Set(['neutral', 'happy', 'sad', 'surprised']);
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
        reviewAssets.push(reviewAsset(state.id, imageId, IMAGE_ROLES[index], 'unmapped_state'));
      });
      warnings.push({ code: 'unmapped_state', stateId: state.id });
      continue;
    }
    assets.push(plannedAsset(`${target}_idle`, state.images[0], imagesById));
    assets.push(plannedAsset(`${target}_speaking`, state.images[1], imagesById));
    if (target === 'neutral') {
      assets.push(plannedAsset('eyes_closed', state.images[2], imagesById));
    } else {
      reviewAssets.push(reviewAsset(
        state.id, state.images[2], 'blinking_idle', 'unrepresentable_blink_variant'
      ));
      warnings.push({
        code: 'unrepresentable_blink_variant', stateId: state.id, imageId: state.images[2]
      });
    }
    reviewAssets.push(reviewAsset(
      state.id, state.images[3], 'blinking_speaking', 'unrepresentable_blink_variant'
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
    }
  }

  return {
    schemaVersion: 1,
    mappings,
    assets: assets.sort((left, right) => left.state.localeCompare(right.state)),
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

function plannedAsset(state, imageId, imagesById) {
  const image = imagesById.get(imageId);
  const isStatic = image.frames.length === 1;
  return {
    state,
    fileName: isStatic ? `${state}.png` : null,
    sourceImageId: imageId,
    kind: isStatic ? 'static_png' : 'animated_unresolved',
    width: image.width,
    height: image.height,
    frameCount: image.frames.length,
    duration: image.frames.reduce((total, frame) => total + frame.duration, 0),
    loopCount: image.loopCount
  };
}

function reviewAsset(stateId, imageId, role, reason) {
  return {
    stateId,
    sourceImageId: imageId,
    role,
    fileName: `review/state-${stateId}-${role.replaceAll('_', '-')}.png`,
    reason
  };
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

module.exports = { CORE_TARGETS, createImportPlan, suggestMappings };
