'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { validatePng } = require('./png');

const IMPORTER_NAME = '@as-adventurer/veadotube-importer';
const MANIFEST_NAME = '.as-adventurer-import.json';
const STAGE_PREFIX = '.veadotube-import-';
const MAX_ASSETS = 1000;
const MAX_ASSET_BYTES = 64 * 1024 * 1024;
const MAX_TOTAL_BYTES = 256 * 1024 * 1024;
const MAX_PIXELS = 8 * 1024 * 1024;
const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

function stageStaticImport(request) {
  const assetsRoot = resolveAssetsRoot(request?.assetsRoot);
  const modelName = validateModelName(request?.modelName);
  const source = validateSource(request?.source);
  const prepared = validatePreviews(request?.previews);
  const targetDir = path.join(assetsRoot, modelName);
  const manifest = {
    schemaVersion: 1,
    importer: IMPORTER_NAME,
    modelName,
    source,
    assets: prepared.map(({ png, ...asset }) => asset)
  };
  const stageDir = fs.mkdtempSync(path.join(assetsRoot, STAGE_PREFIX));

  try {
    for (const asset of prepared) {
      fs.writeFileSync(path.join(stageDir, asset.fileName), asset.png, {
        flag: 'wx',
        mode: 0o600
      });
    }
    fs.writeFileSync(
      path.join(stageDir, MANIFEST_NAME),
      `${JSON.stringify(manifest, null, 2)}\n`,
      { flag: 'wx', mode: 0o600 }
    );
  } catch (error) {
    removeOwnedStage(assetsRoot, stageDir);
    throw error;
  }

  return Object.freeze({ assetsRoot, modelName, stageDir, targetDir });
}

function validateStagedImport(staged) {
  const assetsRoot = resolveAssetsRoot(staged?.assetsRoot);
  const modelName = validateModelName(staged?.modelName);
  const stageDir = validateStageDirectory(assetsRoot, staged?.stageDir);
  const expectedTarget = path.join(assetsRoot, modelName);
  if (path.resolve(staged?.targetDir || '') !== expectedTarget) {
    throw stageError('invalid_stage_target', 'Staged import target does not match its model name');
  }

  const manifestPath = path.join(stageDir, MANIFEST_NAME);
  const manifestStat = readRegularFileStat(manifestPath, 'invalid_stage_manifest');
  if (manifestStat.size > 1024 * 1024) {
    throw stageError('invalid_stage_manifest', 'Staged import manifest is too large');
  }
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    throw stageError('invalid_stage_manifest', 'Staged import manifest is not valid JSON', error);
  }
  const assets = validateManifest(manifest, modelName);
  const expectedNames = [MANIFEST_NAME, ...assets.map(asset => asset.fileName)].sort(compareText);
  const actualNames = fs.readdirSync(stageDir).sort(compareText);
  if (!sameNames(actualNames, expectedNames)) {
    throw stageError('staged_file_mismatch', 'Staged import contains missing or unexpected files');
  }

  let totalBytes = 0;
  for (const asset of assets) {
    const assetPath = path.join(stageDir, asset.fileName);
    const stat = readRegularFileStat(assetPath, 'staged_asset_invalid');
    if (stat.size !== asset.byteLength || stat.size > MAX_ASSET_BYTES) {
      throw stageError('staged_asset_invalid', `Staged asset ${asset.fileName} has the wrong size`);
    }
    totalBytes = addToBudget(totalBytes, stat.size);
    const png = fs.readFileSync(assetPath);
    const sha256 = sha256Hex(png);
    if (sha256 !== asset.sha256) {
      throw stageError('staged_asset_invalid', `Staged asset ${asset.fileName} has the wrong hash`);
    }
    let decoded;
    try {
      decoded = validatePng(png, {
        maxPngBytes: MAX_ASSET_BYTES,
        maxPixels: MAX_PIXELS
      });
    } catch (error) {
      throw stageError('staged_asset_invalid', `Staged asset ${asset.fileName} is not a valid PNG`, error);
    }
    if (decoded.width !== asset.width || decoded.height !== asset.height) {
      throw stageError('staged_asset_invalid', `Staged asset ${asset.fileName} has wrong dimensions`);
    }
  }
  return manifest;
}

function validatePreviews(previews) {
  if (!Array.isArray(previews) || previews.length === 0 || previews.length > MAX_ASSETS) {
    throw stageError('invalid_preview_count', 'Static import requires a bounded non-empty preview list');
  }
  const seen = new Set();
  let totalBytes = 0;
  return previews.map(preview => {
    const asset = validateAssetMetadata(preview, seen);
    if (!Buffer.isBuffer(preview.png) || preview.png.length !== asset.byteLength) {
      throw stageError('invalid_preview', `Preview ${asset.fileName} has the wrong byte length`);
    }
    totalBytes = addToBudget(totalBytes, preview.png.length);
    if (sha256Hex(preview.png) !== asset.sha256) {
      throw stageError('invalid_preview', `Preview ${asset.fileName} has the wrong hash`);
    }
    let decoded;
    try {
      decoded = validatePng(preview.png, {
        maxPngBytes: MAX_ASSET_BYTES,
        maxPixels: MAX_PIXELS
      });
    } catch (error) {
      throw stageError('invalid_preview', `Preview ${asset.fileName} is not a valid PNG`, error);
    }
    if (decoded.width !== asset.width || decoded.height !== asset.height) {
      throw stageError('invalid_preview', `Preview ${asset.fileName} has wrong dimensions`);
    }
    return { ...asset, png: preview.png };
  });
}

function validateManifest(manifest, modelName) {
  if (!isPlainObject(manifest) || manifest.schemaVersion !== 1 ||
      manifest.importer !== IMPORTER_NAME || manifest.modelName !== modelName) {
    throw stageError('invalid_stage_manifest', 'Staged import manifest identity is invalid');
  }
  validateSource(manifest.source);
  if (!Array.isArray(manifest.assets) || manifest.assets.length === 0 ||
      manifest.assets.length > MAX_ASSETS) {
    throw stageError('invalid_stage_manifest', 'Staged import manifest asset count is invalid');
  }
  const seen = new Set();
  return manifest.assets.map(asset => validateAssetMetadata(asset, seen));
}

function validateAssetMetadata(asset, seen) {
  if (!isPlainObject(asset) || typeof asset.fileName !== 'string' ||
      !/^[a-z0-9][a-z0-9_-]{0,127}\.png$/.test(asset.fileName)) {
    throw stageError('invalid_asset_name', 'Static import asset filename is not safe');
  }
  const foldedName = asset.fileName.toLowerCase();
  if (seen.has(foldedName)) {
    throw stageError('duplicate_asset_name', `Static import repeats ${asset.fileName}`);
  }
  seen.add(foldedName);
  const state = asset.fileName.slice(0, -4);
  if (asset.state !== undefined && asset.state !== state) {
    throw stageError('invalid_asset_state', `Static import state does not match ${asset.fileName}`);
  }
  const pixels = asset.width * asset.height;
  if (!Number.isSafeInteger(asset.sourceImageId) || asset.sourceImageId <= 0 ||
      !Number.isSafeInteger(asset.width) || !Number.isSafeInteger(asset.height) ||
      asset.width <= 0 || asset.height <= 0 || !Number.isSafeInteger(pixels) ||
      pixels > MAX_PIXELS || !Number.isSafeInteger(asset.byteLength) ||
      asset.byteLength <= 0 || asset.byteLength > MAX_ASSET_BYTES ||
      typeof asset.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(asset.sha256)) {
    throw stageError('invalid_asset_metadata', `Static import metadata is invalid for ${asset.fileName}`);
  }
  return {
    state,
    fileName: asset.fileName,
    sourceImageId: asset.sourceImageId,
    width: asset.width,
    height: asset.height,
    byteLength: asset.byteLength,
    sha256: asset.sha256
  };
}

function validateSource(source) {
  if (!isPlainObject(source) || typeof source.name !== 'string' || source.name.length === 0 ||
      source.name.length > 255 || path.basename(source.name) !== source.name ||
      /[\u0000-\u001f]/.test(source.name) || !Number.isSafeInteger(source.byteLength) ||
      source.byteLength < 0 || source.byteLength > 256 * 1024 * 1024 ||
      typeof source.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(source.sha256)) {
    throw stageError('invalid_source', 'Static import source metadata is invalid');
  }
  return {
    name: source.name,
    byteLength: source.byteLength,
    sha256: source.sha256
  };
}

function validateModelName(modelName) {
  if (typeof modelName !== 'string' || modelName.length > 64 ||
      !/^[A-Za-z0-9][A-Za-z0-9 _-]*$/.test(modelName) ||
      /[ .]$/.test(modelName) || WINDOWS_RESERVED_NAME.test(modelName)) {
    throw stageError('invalid_model_name', 'Model name is not safe for a Windows folder');
  }
  return modelName;
}

function resolveAssetsRoot(assetsRoot) {
  if (typeof assetsRoot !== 'string' || assetsRoot.length === 0) {
    throw stageError('invalid_assets_root', 'Assets root is required');
  }
  let stat;
  try {
    stat = fs.statSync(assetsRoot);
  } catch (error) {
    throw stageError('invalid_assets_root', 'Assets root does not exist', error);
  }
  if (!stat.isDirectory()) {
    throw stageError('invalid_assets_root', 'Assets root is not a directory');
  }
  return fs.realpathSync(assetsRoot);
}

function validateStageDirectory(assetsRoot, stageDir) {
  if (typeof stageDir !== 'string') {
    throw stageError('invalid_stage_path', 'Staged import path is invalid');
  }
  let stat;
  let resolved;
  try {
    stat = fs.lstatSync(stageDir);
    resolved = fs.realpathSync(stageDir);
  } catch (error) {
    throw stageError('invalid_stage_path', 'Staged import directory does not exist', error);
  }
  if (!stat.isDirectory() || stat.isSymbolicLink() || path.dirname(resolved) !== assetsRoot ||
      !path.basename(resolved).startsWith(STAGE_PREFIX)) {
    throw stageError('invalid_stage_path', 'Staged import is outside the assets root');
  }
  return resolved;
}

function readRegularFileStat(filePath, code) {
  let stat;
  try {
    stat = fs.lstatSync(filePath);
  } catch (error) {
    throw stageError(code, `Staged file ${path.basename(filePath)} is missing`, error);
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw stageError(code, `Staged file ${path.basename(filePath)} is not a regular file`);
  }
  return stat;
}

function addToBudget(total, amount) {
  const next = total + amount;
  if (!Number.isSafeInteger(next) || next > MAX_TOTAL_BYTES) {
    throw stageError('import_byte_budget_exceeded', 'Static import exceeds its byte budget');
  }
  return next;
}

function removeOwnedStage(assetsRoot, stageDir) {
  const resolved = path.resolve(stageDir);
  if (path.dirname(resolved) !== assetsRoot || !path.basename(resolved).startsWith(STAGE_PREFIX)) {
    return;
  }
  fs.rmSync(resolved, { recursive: true, force: true });
}

function sameNames(left, right) {
  return left.length === right.length && left.every((name, index) => name === right[index]);
}

function sha256Hex(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stageError(code, message, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  return error;
}

module.exports = { stageStaticImport, validateStagedImport };
