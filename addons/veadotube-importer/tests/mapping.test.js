'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createImportPlan, suggestMappings } = require('../mapping');

function image(id, frameCount = 1) {
  return {
    id, width: 64, height: 32, loopCount: frameCount > 1 ? 2 : 0,
    frames: Array.from({ length: frameCount }, (_, index) => ({
      textureId: id + index + 100, offsetX: 0, offsetY: 0, duration: 0.1,
      texture: { width: 64, height: 32, format: 'VDD.', dataLength: 20 }
    }))
  };
}

function miniDocument() {
  return {
    schemaVersion: 1,
    states: [{
      id: 3,
      name: 'Neutral',
      images: [14, 15, 16, 17],
      closedEffects: [{ type: 'randommove', active: true, values: [2, 1] }],
      openEffects: [],
      closedToOpenTransitions: [],
      openToClosedTransitions: [],
      shortcuts: [{ provider: 'keyboard', signal: 'Space' }]
    }, {
      id: 4,
      name: 'Costume / Alt',
      images: [24, 25, 26, 27],
      closedEffects: [], openEffects: [], closedToOpenTransitions: [],
      openToClosedTransitions: [], shortcuts: []
    }],
    images: [14, 15, 16, 17, 24, 25, 26, 27].map(id => image(id))
  };
}

test('creates an explicit deterministic core-state plan without hiding losses', () => {
  const plan = createImportPlan(miniDocument(), [{ stateId: 3, target: 'neutral' }]);

  assert.deepEqual(plan, {
    schemaVersion: 1,
    mappings: [{ stateId: 3, sourceName: 'Neutral', target: 'neutral' }],
    assets: [{
      state: 'eyes_closed', fileName: 'eyes_closed.png', sourceImageId: 16,
      kind: 'static_png', width: 64, height: 32, frameCount: 1, duration: 0.1, loopCount: 0
    }, {
      state: 'neutral_idle', fileName: 'neutral_idle.png', sourceImageId: 14,
      kind: 'static_png', width: 64, height: 32, frameCount: 1, duration: 0.1, loopCount: 0
    }, {
      state: 'neutral_speaking', fileName: 'neutral_speaking.png', sourceImageId: 15,
      kind: 'static_png', width: 64, height: 32, frameCount: 1, duration: 0.1, loopCount: 0
    }],
    reviewAssets: [{
      stateId: 3, sourceImageId: 17, role: 'blinking_speaking',
      fileName: 'review/state-3-blinking-speaking.png', reason: 'unrepresentable_blink_variant'
    }, {
      stateId: 4, sourceImageId: 24, role: 'idle',
      fileName: 'review/state-4-idle.png', reason: 'unmapped_state'
    }, {
      stateId: 4, sourceImageId: 25, role: 'speaking',
      fileName: 'review/state-4-speaking.png', reason: 'unmapped_state'
    }, {
      stateId: 4, sourceImageId: 26, role: 'blinking_idle',
      fileName: 'review/state-4-blinking-idle.png', reason: 'unmapped_state'
    }, {
      stateId: 4, sourceImageId: 27, role: 'blinking_speaking',
      fileName: 'review/state-4-blinking-speaking.png', reason: 'unmapped_state'
    }],
    unmappedStates: [{ stateId: 4, name: 'Costume / Alt', imageIds: [24, 25, 26, 27] }],
    effectSuggestions: [{
      stateId: 3, phase: 'closed', type: 'randommove', active: true,
      values: [2, 1], enabled: false
    }],
    shortcutSuggestions: [{
      stateId: 3, provider: 'keyboard', signal: 'Space', enabled: false
    }],
    warnings: [
      { code: 'unrepresentable_blink_variant', stateId: 3, imageId: 17 },
      { code: 'unmapped_state', stateId: 4 }
    ]
  });
});

test('rejects ambiguous, missing, and undeclared mapping targets', () => {
  const document = miniDocument();
  const cases = [
    [[{ stateId: 3, target: 'neutral' }, { stateId: 3, target: 'happy' }], 'duplicate_state_mapping'],
    [[{ stateId: 3, target: 'neutral' }, { stateId: 4, target: 'neutral' }], 'duplicate_target_mapping'],
    [[{ stateId: 999, target: 'neutral' }], 'missing_state'],
    [[{ stateId: 3, target: 'costume' }], 'unsupported_target']
  ];

  for (const [selections, code] of cases) {
    assert.throws(() => createImportPlan(document, selections), error => error.code === code);
  }
});

test('allows an extra expression only when both plugin asset states are declared', () => {
  const plan = createImportPlan(miniDocument(), [{ stateId: 3, target: 'costume' }], {
    assetStates: ['costume_idle', 'costume_speaking']
  });

  assert.deepEqual(plan.assets.map(asset => asset.state), ['costume_idle', 'costume_speaking']);
  assert.equal(plan.reviewAssets.filter(asset => asset.stateId === 3).length, 2);
  assert.throws(() => createImportPlan(miniDocument(), [{ stateId: 3, target: 'costume' }], {
    assetStates: ['costume_idle']
  }), error => error.code === 'unsupported_target');
});

test('marks animated mappings unresolved instead of promising a lossy PNG', () => {
  const document = miniDocument();
  document.images[0] = image(14, 2);

  const plan = createImportPlan(document, [{ stateId: 3, target: 'neutral' }]);
  const idle = plan.assets.find(asset => asset.state === 'neutral_idle');

  assert.equal(idle.kind, 'animated_unresolved');
  assert.equal(idle.fileName, null);
  assert.deepEqual(plan.warnings.find(warning => warning.code === 'animated_output_unresolved'), {
    code: 'animated_output_unresolved', state: 'neutral_idle', imageId: 14
  });
});

test('suggests normalized core names but never confirms them automatically', () => {
  const document = miniDocument();
  document.states[0].name = '  HAPPY!!  ';

  assert.deepEqual(suggestMappings(document), [{
    stateId: 3,
    sourceName: '  HAPPY!!  ',
    target: 'happy',
    reason: 'normalized_name_match',
    requiresConfirmation: true
  }]);
});
