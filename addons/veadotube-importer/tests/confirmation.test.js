'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { confirmImportMappings, createConfirmationView } = require('../confirmation');

function image(id, frameCount = 1) {
  return {
    id,
    width: 64,
    height: 32,
    loopCount: frameCount > 1 ? 2 : 0,
    frames: Array.from({ length: frameCount }, (_, index) => ({
      textureId: id + index + 100,
      offsetX: 0,
      offsetY: 0,
      duration: 0.1,
      texture: { width: 64, height: 32, format: 'RAW.', dataLength: 8192 }
    }))
  };
}

function state(id, name, firstImageId) {
  return {
    id,
    name,
    images: [firstImageId, firstImageId + 1, firstImageId + 2, firstImageId + 3],
    closedEffects: [],
    openEffects: [],
    closedToOpenTransitions: [],
    openToClosedTransitions: [],
    shortcuts: []
  };
}

function document() {
  return {
    schemaVersion: 1,
    states: [state(3, 'Neutral', 14), state(4, 'Costume / Alt', 24)],
    images: [14, 15, 16, 17, 24, 25, 26, 27].map(id => image(id))
  };
}

test('presents mapping suggestions without treating them as confirmed selections', () => {
  const view = createConfirmationView(document());

  assert.deepEqual(view.targets, ['neutral', 'happy', 'sad', 'surprised']);
  assert.deepEqual(view.states[0], {
    stateId: 3,
    sourceName: 'Neutral',
    suggestedTarget: 'neutral',
    requiresConfirmation: true,
    assets: [
      { role: 'idle', sourceImageId: 14, kind: 'static_png', width: 64, height: 32 },
      { role: 'speaking', sourceImageId: 15, kind: 'static_png', width: 64, height: 32 },
      { role: 'blinking_idle', sourceImageId: 16, kind: 'static_png', width: 64, height: 32 },
      { role: 'blinking_speaking', sourceImageId: 17, kind: 'static_png', width: 64, height: 32 }
    ]
  });
  assert.equal(view.states[1].suggestedTarget, null);
  assert.equal('selections' in view, false);
});

test('creates an install plan only from explicitly confirmed mappings', () => {
  const source = document();

  assert.throws(
    () => confirmImportMappings(source, {
      confirmed: false,
      selections: [{ stateId: 3, target: 'neutral' }]
    }),
    error => error.code === 'confirmation_required'
  );
  assert.throws(
    () => confirmImportMappings(source, { confirmed: true, selections: [] }),
    error => error.code === 'mapping_required'
  );

  const plan = confirmImportMappings(source, {
    confirmed: true,
    selections: [{ stateId: 3, target: 'neutral' }]
  });

  assert.deepEqual(plan.mappings, [{ stateId: 3, sourceName: 'Neutral', target: 'neutral' }]);
  assert.deepEqual(plan.assets.map(asset => asset.state), [
    'eyes_closed',
    'neutral_idle',
    'neutral_speaking'
  ]);
  assert.deepEqual(plan.unmappedStates.map(item => item.stateId), [4]);
});

test('blocks confirmation when a mapped asset cannot be imported losslessly', () => {
  const source = document();
  source.images[1] = image(15, 2);

  assert.throws(() => confirmImportMappings(source, {
    confirmed: true,
    selections: [{ stateId: 3, target: 'neutral' }]
  }), error => (
    error.code === 'mapped_asset_unresolved' &&
    error.assets.length === 1 &&
    error.assets[0].state === 'neutral_speaking'
  ));
});
