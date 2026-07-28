'use strict';

const sourceFile = document.getElementById('source-file');
const loadSource = document.getElementById('load-source');
const sourceStatus = document.getElementById('source-status');
const mappingPanel = document.getElementById('mapping-panel');
const sourceSummary = document.getElementById('source-summary');
const stateList = document.getElementById('state-list');
const modelName = document.getElementById('model-name');
const confirmMappings = document.getElementById('confirm-mappings');
const installModel = document.getElementById('install-model');
const importStatus = document.getElementById('import-status');
const previewUrls = new Set();

loadSource.addEventListener('click', inspectSelectedFile);
installModel.addEventListener('click', installConfirmedModel);
modelName.addEventListener('input', updateInstallState);
confirmMappings.addEventListener('change', updateInstallState);
stateList.addEventListener('change', updateInstallState);
window.addEventListener('beforeunload', clearPreviewUrls);

async function inspectSelectedFile() {
  const file = sourceFile.files[0];
  if (!file) {
    setStatus(sourceStatus, 'Choose a .veado or .vaedo file first.', true);
    return;
  }
  loadSource.disabled = true;
  mappingPanel.hidden = true;
  setStatus(sourceStatus, 'Inspecting the local file…');
  try {
    const response = await fetch(`/api/source?name=${encodeURIComponent(file.name)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: file
    });
    const report = await readJsonResponse(response);
    renderReport(report);
    setStatus(sourceStatus, 'Inspection complete. Review the proposed mappings below.');
  } catch (error) {
    setStatus(sourceStatus, error.message, true);
  } finally {
    loadSource.disabled = false;
  }
}

function renderReport(report) {
  clearPreviewUrls();
  stateList.replaceChildren();
  confirmMappings.checked = false;
  importStatus.textContent = '';
  sourceSummary.textContent = `${report.source.name} — ${formatBytes(report.source.byteLength)} — ` +
    `${report.view.states.length} state${report.view.states.length === 1 ? '' : 's'}`;

  for (const state of report.view.states) {
    const card = document.createElement('article');
    card.className = 'state-card';
    card.dataset.stateId = String(state.stateId);

    const heading = document.createElement('h3');
    heading.textContent = state.sourceName || `State ${state.stateId}`;
    card.append(heading);

    const label = document.createElement('label');
    label.textContent = 'Map to';
    const select = document.createElement('select');
    select.className = 'target-select';
    select.append(new Option('Do not import', ''));
    for (const target of report.view.targets) {
      select.append(new Option(target.replaceAll('_', ' '), target));
    }
    if (state.suggestedTarget) select.value = state.suggestedTarget;
    label.append(select);
    card.append(label);

    if (state.suggestedTarget) {
      const note = document.createElement('p');
      note.className = 'suggestion';
      note.textContent = `Suggested from the name; confirmation is still required.`;
      card.append(note);
    }

    const assets = document.createElement('div');
    assets.className = 'asset-grid';
    for (const asset of state.assets) assets.append(renderAsset(asset));
    card.append(assets);
    stateList.append(card);
  }
  mappingPanel.hidden = false;
  updateInstallState();
}

function renderAsset(asset) {
  const figure = document.createElement('figure');
  const frame = document.createElement('div');
  frame.className = 'preview-frame';
  if (asset.previewAvailable) {
    const image = document.createElement('img');
    image.alt = `${asset.role.replaceAll('_', ' ')} preview`;
    frame.append(image);
    loadPreview(image, asset.sourceImageId);
  } else {
    const unavailable = document.createElement('span');
    unavailable.textContent = asset.kind === 'animated_unresolved'
      ? 'Animated'
      : asset.kind === 'static_png' ? 'Above size limit' : 'Unavailable';
    frame.append(unavailable);
  }
  const caption = document.createElement('figcaption');
  caption.textContent = `${asset.role.replaceAll('_', ' ')} · ${asset.width}×${asset.height}`;
  figure.append(frame, caption);
  return figure;
}

async function loadPreview(image, sourceImageId) {
  try {
    const response = await fetch(`/api/preview/${sourceImageId}`);
    if (!response.ok) throw new Error('Preview unavailable');
    const url = URL.createObjectURL(await response.blob());
    previewUrls.add(url);
    image.src = url;
  } catch {
    image.replaceWith(document.createTextNode('Preview unavailable'));
  }
}

async function installConfirmedModel() {
  const selections = [...stateList.querySelectorAll('.state-card')].flatMap(card => {
    const target = card.querySelector('.target-select').value;
    return target ? [{ stateId: Number(card.dataset.stateId), target }] : [];
  });
  installModel.disabled = true;
  setStatus(importStatus, 'Staging and validating the model…');
  try {
    const response = await fetch('/api/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        modelName: modelName.value.trim(),
        confirmed: confirmMappings.checked,
        selections
      })
    });
    const result = await readJsonResponse(response);
    setStatus(importStatus, `Installed ${result.modelName} with ${result.assets.length} static assets.`);
    confirmMappings.checked = false;
  } catch (error) {
    setStatus(importStatus, error.message, true);
  } finally {
    updateInstallState();
  }
}

function updateInstallState() {
  const targets = [...stateList.querySelectorAll('.target-select')]
    .map(select => select.value)
    .filter(Boolean);
  const unique = new Set(targets);
  installModel.disabled = !modelName.value.trim() || !confirmMappings.checked ||
    targets.length === 0 || unique.size !== targets.length;
  if (targets.length !== unique.size) {
    setStatus(importStatus, 'Each destination state can be selected only once.', true);
    importStatus.dataset.validation = 'duplicate';
  } else if (importStatus.dataset.validation === 'duplicate') {
    importStatus.textContent = '';
    delete importStatus.dataset.validation;
  }
}

async function readJsonResponse(response) {
  const value = await response.json();
  if (!response.ok) throw new Error(value.message || value.error || 'Importer request failed');
  return value;
}

function setStatus(element, message, isError = false) {
  element.textContent = message;
  element.classList.toggle('error', isError);
}

function clearPreviewUrls() {
  for (const url of previewUrls) URL.revokeObjectURL(url);
  previewUrls.clear();
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
