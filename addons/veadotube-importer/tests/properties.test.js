const test = require('node:test');
const assert = require('node:assert/strict');

const { parseProperties } = require('../properties');

function string(value) {
  const bytes = Buffer.from(value);
  return Buffer.concat([Buffer.from([bytes.length]), bytes]);
}

test('decodes stacked property keys and typed values', () => {
  const number = Buffer.alloc(8);
  number.writeDoubleLE(1.5);
  const bytes = Buffer.concat([
    Buffer.from([1]), string('transform/position'), Buffer.from([3]), Buffer.from('top'),
    Buffer.from([4, 1]), string('rotation'), Buffer.from([8]), number,
    Buffer.from([0])
  ]);

  assert.deepEqual(parseProperties(bytes), {
    'transform/position': 'top',
    'transform/rotation': 1.5
  });
});

test('rejects invalid stack movement and oversized values', () => {
  const invalidPop = Buffer.concat([
    Buffer.from([1]), string('a'), Buffer.from([1, 0]),
    Buffer.from([1, 2]), string('b'), Buffer.from([1, 0]), Buffer.from([0])
  ]);
  assert.throws(() => parseProperties(invalidPop), error => error.code === 'invalid_property_stack');

  const oversized = Buffer.concat([
    Buffer.from([1]), string('a'), Buffer.from([4, 1, 2, 3, 4]), Buffer.from([0])
  ]);
  assert.throws(() => parseProperties(oversized, { maxPropertyValueBytes: 3 }), error => (
    error.code === 'property_value_too_large'
  ));
});
