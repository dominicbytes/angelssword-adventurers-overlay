const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function loadAudioFeatures() {
  return import(pathToFileURL(path.join(
    __dirname,
    '..',
    'addons',
    'viseme-lipsync',
    'plugin',
    'audio-features.mjs'
  )));
}

test('normalizes microphone energy into a bounded openness value', async () => {
  const { normalizeOpenness } = await loadAudioFeatures();

  assert.equal(normalizeOpenness(0.01, 0.01, 0.09), 0);
  assert.equal(normalizeOpenness(0.05, 0.01, 0.09), 0.5);
  assert.equal(normalizeOpenness(0.2, 0.01, 0.09), 1);
});

test('selects the nearest calibrated MFCC template', async () => {
  const { classifyMfcc } = await loadAudioFeatures();
  const templates = {
    open: [[1, 0, 0]],
    wide: [[0, 1, 0]],
    round: [[0, 0, 1]]
  };

  assert.equal(classifyMfcc([0.9, 0.1, 0], templates), 'open');
  assert.equal(classifyMfcc([0.1, 0.8, 0.1], templates), 'wide');
});

test('builds a stable median calibration template', async () => {
  const { medianTemplate } = await loadAudioFeatures();

  const result = medianTemplate([
    [1, 0, 0],
    [0.8, 0.2, 0],
    [0.9, 0.1, 0]
  ]);

  assert.ok(Math.abs(result[0] - 0.9938837) < 0.000001);
  assert.ok(Math.abs(result[1] - 0.1104315) < 0.000001);
  assert.equal(result[2], 0);
});

test('extracts a normalized twelve-coefficient MFCC fingerprint', async () => {
  const { createMfccExtractor } = await loadAudioFeatures();
  const extractor = createMfccExtractor(16000, 64);
  const spectrum = Array.from({ length: 32 }, (_, index) => -90 + index * 2);

  const vector = extractor(spectrum);
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));

  assert.equal(vector.length, 12);
  assert.ok(vector.every(Number.isFinite));
  assert.ok(Math.abs(norm - 1) < 0.000001);
});

test('defers only vowel visemes to calibrated MFCC templates', async () => {
  const { shouldDeferVowelToCalibration } = await loadAudioFeatures();
  const templates = { open: [[1, 0]], wide: [[0, 1]], round: [[-1, 0]] };

  assert.equal(shouldDeferVowelToCalibration(0, templates), true);
  assert.equal(shouldDeferVowelToCalibration(4, templates), true);
  assert.equal(shouldDeferVowelToCalibration(5, templates), false);
  assert.equal(shouldDeferVowelToCalibration(14, templates), false);
  assert.equal(shouldDeferVowelToCalibration(0, null), false);
});
