'use strict';

const fs = require('node:fs');
const path = require('node:path');

function withAssetsRoot(run) {
  const privateRoot = path.resolve('.private-fixtures');
  fs.mkdirSync(privateRoot, { recursive: true });
  const directory = fs.mkdtempSync(path.join(privateRoot, 'importer-test-'));
  if (path.dirname(directory) !== privateRoot) {
    throw new Error('Importer test directory escaped the private fixture root');
  }
  const assetsRoot = path.join(directory, 'assets');
  fs.mkdirSync(assetsRoot);
  const cleanup = () => fs.rmSync(directory, { recursive: true, force: true });
  let result;
  try {
    result = run(assetsRoot);
  } catch (error) {
    cleanup();
    throw error;
  }
  if (result && typeof result.then === 'function') {
    return Promise.resolve(result).finally(cleanup);
  }
  cleanup();
  return result;
}

module.exports = { withAssetsRoot };
