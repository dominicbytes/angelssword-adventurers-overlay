'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const { validatePng } = require('../png');
const { createImporterServer } = require('../serve');
const { miniFixture } = require('./helpers/mini-fixture');

function withAssetsRoot(run) {
  const privateRoot = path.join(process.cwd(), '.private-fixtures');
  fs.mkdirSync(privateRoot, { recursive: true });
  const directory = fs.mkdtempSync(path.join(privateRoot, 'server-test-'));
  const assetsRoot = path.join(directory, 'assets');
  fs.mkdirSync(assetsRoot);
  return Promise.resolve(run(assetsRoot)).finally(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve(`http://127.0.0.1:${server.address().port}`);
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
}

function requestWithHost(url, host) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, { headers: { Host: host } }, response => {
      response.resume();
      response.once('end', () => resolve(response));
    });
    request.once('error', reject);
  });
}

test('serves a protected local confirmation and import workflow', async () => {
  await withAssetsRoot(async assetsRoot => {
    const server = createImporterServer({ assetsRoot });
    const origin = await listen(server);
    try {
      const root = await fetch(`${origin}/`);
      assert.equal(root.status, 200);
      assert.match(root.headers.get('content-security-policy'), /default-src 'self'/);
      assert.match(await root.text(), /<title>VeadoTube Mini Importer<\/title>/);
      const cookie = root.headers.get('set-cookie').split(';', 1)[0];

      const forbidden = await fetch(`${origin}/api/source?name=fixture.veado`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', Origin: origin },
        body: miniFixture()
      });
      assert.equal(forbidden.status, 403);

      const source = await fetch(`${origin}/api/source?name=fixture.veado`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          Cookie: cookie,
          Origin: origin
        },
        body: miniFixture()
      });
      assert.equal(source.status, 200);
      const report = await source.json();
      assert.equal(report.view.states[0].suggestedTarget, 'happy');
      assert.equal(report.source.name, 'fixture.veado');

      const preview = await fetch(`${origin}/api/preview/14`, {
        headers: { Cookie: cookie }
      });
      assert.equal(preview.status, 200);
      assert.equal(preview.headers.get('content-type'), 'image/png');
      assert.deepEqual(validatePng(Buffer.from(await preview.arrayBuffer())).rgba, Buffer.alloc(16));

      const imported = await fetch(`${origin}/api/import`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookie,
          Origin: origin
        },
        body: JSON.stringify({
          modelName: 'Browser Fixture',
          confirmed: true,
          selections: [{ stateId: 3, target: 'happy' }]
        })
      });
      assert.equal(imported.status, 201);
      assert.deepEqual((await imported.json()).assets, ['happy_idle', 'happy_speaking']);
      assert.deepEqual(fs.readdirSync(path.join(assetsRoot, 'Browser Fixture')).sort(), [
        '.as-adventurer-import.json',
        'happy_idle.png',
        'happy_speaking.png'
      ]);

      assert.equal((await requestWithHost(`${origin}/`, 'example.test')).statusCode, 403);
    } finally {
      await close(server);
    }
  });
});
