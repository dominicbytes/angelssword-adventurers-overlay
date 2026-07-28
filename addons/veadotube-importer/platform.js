'use strict';

function assertWindowsPlatform(platform = process.platform) {
  if (platform !== 'win32') {
    const error = new Error('VeadoTube static model installation currently supports Windows only');
    error.code = 'unsupported_platform';
    throw error;
  }
}

module.exports = { assertWindowsPlatform };
