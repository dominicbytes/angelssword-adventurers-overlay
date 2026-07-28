'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { assertWindowsPlatform } = require('../platform');

test('refuses the importer runtime outside Windows', () => {
  assert.doesNotThrow(() => assertWindowsPlatform('win32'));
  assert.throws(
    () => assertWindowsPlatform('linux'),
    error => error.code === 'unsupported_platform'
  );
});
