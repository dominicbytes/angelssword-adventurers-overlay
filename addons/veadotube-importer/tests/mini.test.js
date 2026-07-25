const test = require('node:test');
const assert = require('node:assert/strict');

const { parseChunkInventory } = require('../inventory');
const { decodeMiniAvatar } = require('../mini');

function string(value) {
  const bytes = Buffer.from(value, 'utf8');
  return Buffer.concat([Buffer.from([bytes.length]), bytes]);
}

function u32(value) {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(value);
  return bytes;
}

function f64(value) {
  const bytes = Buffer.alloc(8);
  bytes.writeDoubleLE(value);
  return bytes;
}

function chunk(id, type, data) {
  const header = Buffer.alloc(12);
  header.writeUInt32LE(id, 0);
  header.write(type, 4, 4, 'ascii');
  header.writeUInt32LE(data.length, 8);
  return Buffer.concat([header, data]);
}

function miniFixture(options) {
  const imageIds = options?.imageIds || [10, 11, 12, 13, 14, 15, 16, 17];
  const extendedValues = options?.extendedValues || null;
  const frameCount = options?.frameCount || 1;
  const frameDuration = options?.frameDuration ?? 0.1;
  const loopCount = options?.loopCount || 0;
  const effectCounts = options?.effectCounts || [1, 0, 0, 0];
  const effectValueCount = options?.effectValueCount ?? 2;
  const shortcutCount = options?.shortcutCount ?? 1;
  const effectList = count => Buffer.concat([
    Buffer.from([count]),
    ...Array.from({ length: count }, () => Buffer.concat([
      string('randommove'), Buffer.from([1, effectValueCount]),
      ...Array.from({ length: effectValueCount }, (_, index) => f64(index + 1.25))
    ]))
  ]);
  const state = Buffer.concat([
    string('Happy'),
    Buffer.from([0x7]),
    ...(extendedValues ? [Buffer.alloc(3)] : []),
    ...imageIds.map(u32),
    ...(extendedValues ? extendedValues.map(f64) : []),
    ...effectCounts.map(effectList),
    Buffer.from([shortcutCount]),
    ...Array.from({ length: shortcutCount }, () => Buffer.concat([
      string('keyboard'), string('Space')
    ])),
    Buffer.from('TGL.', 'ascii')
  ]);
  const parts = [
    Buffer.from('VEADOTUBE', 'ascii'),
    ...(options?.metadata ? [chunk(1, 'META', Buffer.concat([
      string(options.metadata.software), string(options.metadata.author), string(options.metadata.description)
    ]))] : []),
    chunk(2, 'MLST', u32(3)),
    chunk(3, 'MSTA', state)
  ];
  for (const id of imageIds) {
    const textureId = id + 1000;
    parts.push(chunk(id, 'AIMG', Buffer.concat([
      u32(2), u32(2), Buffer.from([frameCount]),
      ...(frameCount > 1 ? [Buffer.from([loopCount])] : []),
      ...Array.from({ length: frameCount }, () => Buffer.concat([
        u32(textureId), u32(0), u32(0), f64(frameDuration)
      ]))
    ])));
    parts.push(chunk(textureId, 'ABMP', Buffer.concat([
      u32(2), u32(2), Buffer.from('RAW.', 'ascii'), Buffer.alloc(16)
    ])));
  }
  parts.push(Buffer.alloc(12));
  return Buffer.concat(parts);
}

test('decodes Mini state images, effects, shortcuts, and flags', () => {
  const bytes = miniFixture();
  const report = decodeMiniAvatar(bytes, parseChunkInventory(bytes));

  assert.deepEqual(report.states, [{
    id: 3,
    name: 'Happy',
    flags: { pixelated: true, syncBlink: true, resetOnActivate: true },
    thumbnails: [10, 11, 12, 13],
    images: [14, 15, 16, 17],
    closedEffects: [{
      type: 'randommove', active: true, presetId: null, customPresetChunkId: null,
      values: [1.25, 2.25]
    }],
    openEffects: [],
    closedToOpenTransitions: [],
    openToClosedTransitions: [],
    shortcuts: [{ provider: 'keyboard', signal: 'Space' }],
    shortcutMode: 'TGL.',
    undocumentedValues: []
  }]);
});

test('reports aligned compatibility values without guessing their meaning', () => {
  const bytes = miniFixture({ extendedValues: [0.4, 5, 8] });
  const report = decodeMiniAvatar(bytes, parseChunkInventory(bytes));

  assert.deepEqual(report.states[0].undocumentedValues, [0.4, 5, 8]);
});

test('reports bounded image frames and texture formats', () => {
  const bytes = miniFixture();
  const report = decodeMiniAvatar(bytes, parseChunkInventory(bytes));

  assert.deepEqual(report.images[0], {
    id: 10,
    width: 2,
    height: 2,
    loopCount: 0,
    frames: [{
      textureId: 1010,
      offsetX: 0,
      offsetY: 0,
      duration: 0.1,
      texture: { width: 2, height: 2, format: 'RAW.', dataLength: 16 }
    }]
  });
  assert.equal(report.images.length, 8);
  assert.equal(report.decodedPixelBudget, 32);
});

test('decodes bounded file metadata', () => {
  const bytes = miniFixture({
    metadata: { software: 'veadotube mini', author: 'tester', description: 'fixture' }
  });
  const report = decodeMiniAvatar(bytes, parseChunkInventory(bytes));

  assert.deepEqual(report.metadata, {
    software: 'veadotube mini', author: 'tester', description: 'fixture'
  });
});

test('rejects decoded pixel budgets before texture allocation', () => {
  const bytes = miniFixture();
  assert.throws(() => decodeMiniAvatar(bytes, parseChunkInventory(bytes), {
    maxDecodedPixels: 31
  }), error => error.code === 'pixel_budget_exceeded');
});

test('rejects total frame amplification even when textures are shared', () => {
  const bytes = miniFixture({ frameCount: 2 });
  assert.throws(() => decodeMiniAvatar(bytes, parseChunkInventory(bytes), {
    maxTotalFrames: 15
  }), error => error.code === 'frame_budget_exceeded');
});

test('rejects cumulative effect, value, and shortcut report amplification', () => {
  const effects = miniFixture({ effectCounts: [1, 1, 1, 1] });
  assert.throws(() => decodeMiniAvatar(effects, parseChunkInventory(effects), {
    maxTotalEffects: 3
  }), error => error.code === 'effect_budget_exceeded');

  const values = miniFixture({ effectCounts: [1, 1, 1, 1], effectValueCount: 2 });
  assert.throws(() => decodeMiniAvatar(values, parseChunkInventory(values), {
    maxTotalEffectValues: 7
  }), error => error.code === 'effect_value_budget_exceeded');

  const shortcuts = miniFixture({ shortcutCount: 2 });
  assert.throws(() => decodeMiniAvatar(shortcuts, parseChunkInventory(shortcuts), {
    maxTotalShortcuts: 1
  }), error => error.code === 'shortcut_budget_exceeded');
});

test('rejects excessive frame duration and loop counts', () => {
  const longFrame = miniFixture({ frameDuration: 3601 });
  assert.throws(() => decodeMiniAvatar(longFrame, parseChunkInventory(longFrame)), error => (
    error.code === 'frame_duration_exceeded'
  ));
  const excessiveLoop = miniFixture({ frameCount: 2, loopCount: 101 });
  assert.throws(() => decodeMiniAvatar(excessiveLoop, parseChunkInventory(excessiveLoop), {
    maxLoopCount: 100
  }), error => error.code === 'loop_count_exceeded');
});

test('rejects missing and mistyped Mini state references', () => {
  const bytes = miniFixture();
  const inventory = parseChunkInventory(bytes);
  inventory.chunks = inventory.chunks.filter(chunk => chunk.id !== 17);
  const stateChunk = inventory.chunks.find(chunk => chunk.type === 'MSTA');

  assert.throws(() => decodeMiniAvatar(bytes, inventory), error => (
    error.code === 'missing_reference' && error.referenceId === 17 &&
    error.offset === stateChunk.dataOffset + 35
  ));
});
