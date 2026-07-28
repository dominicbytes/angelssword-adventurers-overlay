'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const { confirmImportMappings, createConfirmationView } = require('./confirmation');
const { inspectBytes } = require('./inventory');
const { decodeMiniAvatar } = require('./mini');
const { generateStaticPreviews } = require('./preview');
const { installStaticModel } = require('./staging');

function createImportSession(input) {
  const bytes = Buffer.from(input?.bytes || []);
  const fileName = validateFileName(input?.fileName);
  const assetStates = Array.isArray(input?.assetStates) ? [...input.assetStates] : [];
  const limits = input?.limits || {};
  const inventory = inspectBytes(bytes, fileName, limits);
  const document = decodeMiniAvatar(bytes, inventory, limits);
  const mappingOptions = { assetStates };
  const view = createConfirmationView(document, mappingOptions);
  const source = Object.freeze({
    name: fileName,
    byteLength: bytes.length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex')
  });
  const previewEntries = new Map();
  for (const state of view.states) {
    for (const asset of state.assets) {
      if (asset.kind === 'static_png' && !previewEntries.has(asset.sourceImageId)) {
        previewEntries.set(asset.sourceImageId, {
          fileName: `preview-${asset.sourceImageId}.png`,
          sourceImageId: asset.sourceImageId,
          kind: 'static_png'
        });
      }
    }
  }

  function preview(sourceImageId) {
    if (!Number.isSafeInteger(sourceImageId) || !previewEntries.has(sourceImageId)) {
      throw sessionError('preview_not_available', 'A static preview is not available for this image');
    }
    const previews = generateStaticPreviews(bytes, document, {
      assets: [previewEntries.get(sourceImageId)],
      reviewAssets: []
    }, { maxPreviewCount: 1 });
    const result = previews.next();
    if (result.done) {
      throw sessionError('preview_not_available', 'A static preview is not available for this image');
    }
    return result.value;
  }

  function install(confirmation) {
    const plan = confirmImportMappings(document, confirmation, mappingOptions);
    const previews = [...generateStaticPreviews(bytes, document, {
      assets: plan.assets,
      reviewAssets: []
    })];
    return installStaticModel({
      assetsRoot: input.assetsRoot,
      modelName: confirmation.modelName,
      source,
      previews
    });
  }

  return Object.freeze({
    source,
    format: inventory.format,
    warnings: Object.freeze([...inventory.warnings]),
    metadata: document.metadata,
    view,
    preview,
    install
  });
}

function validateFileName(fileName) {
  if (typeof fileName !== 'string') {
    throw sessionError('invalid_source_name', 'Source filename is required');
  }
  const name = path.basename(fileName);
  if (name.length === 0 || name.length > 255 || /[\u0000-\u001f]/.test(name)) {
    throw sessionError('invalid_source_name', 'Source filename is invalid');
  }
  return name;
}

function sessionError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

module.exports = { createImportSession };
