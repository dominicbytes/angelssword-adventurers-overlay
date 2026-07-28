'use strict';

const { CORE_TARGET_NAMES, createImportPlan, suggestMappings } = require('./mapping');

function createConfirmationView(document, options) {
  const plan = createImportPlan(document, [], options);
  const suggestions = new Map(suggestMappings(document).map(item => [item.stateId, item]));
  const assetsByState = new Map();
  for (const asset of plan.reviewAssets) {
    const assets = assetsByState.get(asset.stateId) || [];
    assets.push({
      role: asset.role,
      sourceImageId: asset.sourceImageId,
      kind: asset.kind,
      width: asset.width,
      height: asset.height
    });
    assetsByState.set(asset.stateId, assets);
  }

  return {
    targets: availableTargets(options?.assetStates),
    states: document.states.map(state => {
      const suggestion = suggestions.get(state.id);
      return {
        stateId: state.id,
        sourceName: state.name,
        suggestedTarget: suggestion?.target || null,
        requiresConfirmation: true,
        assets: assetsByState.get(state.id) || []
      };
    })
  };
}

function confirmImportMappings(document, confirmation, options) {
  if (confirmation?.confirmed !== true) {
    throw confirmationError('confirmation_required', 'Import mappings require explicit confirmation');
  }
  if (!Array.isArray(confirmation.selections) || confirmation.selections.length === 0) {
    throw confirmationError('mapping_required', 'At least one state mapping is required');
  }
  const plan = createImportPlan(document, confirmation.selections, options);
  const unresolved = plan.assets.filter(asset => asset.kind !== 'static_png');
  if (unresolved.length > 0) {
    const error = confirmationError(
      'mapped_asset_unresolved',
      'Every mapped asset must have a lossless static PNG conversion'
    );
    error.assets = unresolved.map(asset => ({
      state: asset.state,
      sourceImageId: asset.sourceImageId,
      kind: asset.kind
    }));
    throw error;
  }
  return plan;
}

function availableTargets(assetStates) {
  const declared = new Set(Array.isArray(assetStates) ? assetStates : []);
  const extras = [];
  for (const state of declared) {
    if (!state.endsWith('_idle')) continue;
    const target = state.slice(0, -5);
    if (declared.has(`${target}_speaking`) && !CORE_TARGET_NAMES.includes(target)) {
      extras.push(target);
    }
  }
  return [...CORE_TARGET_NAMES, ...new Set(extras)].sort(compareCoreFirst);
}

function compareCoreFirst(left, right) {
  const leftCore = CORE_TARGET_NAMES.indexOf(left);
  const rightCore = CORE_TARGET_NAMES.indexOf(right);
  if (leftCore !== -1 || rightCore !== -1) {
    if (leftCore === -1) return 1;
    if (rightCore === -1) return -1;
    return leftCore - rightCore;
  }
  return left < right ? -1 : left > right ? 1 : 0;
}

function confirmationError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

module.exports = { confirmImportMappings, createConfirmationView };
