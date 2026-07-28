'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const { validatePng } = require('../png');
const { createImporterServer } = require('../serve');
const { withAssetsRoot } = require('./helpers/assets-root');
const { miniFixture } = require('./helpers/mini-fixture');

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
      assert.match(report.sessionId, /^[a-f0-9]{64}$/);

      const preview = await fetch(`${origin}/api/preview/${report.sessionId}/14`, {
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
          sessionId: report.sessionId,
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

test('rejects a confirmation after another source replaces the reviewed session', async () => {
  await withAssetsRoot(async assetsRoot => {
    const server = createImporterServer({ assetsRoot });
    const origin = await listen(server);
    try {
      const root = await fetch(`${origin}/`);
      const cookie = root.headers.get('set-cookie').split(';', 1)[0];
      await root.text();
      const headers = {
        'Content-Type': 'application/octet-stream',
        Cookie: cookie,
        Origin: origin
      };
      const firstResponse = await fetch(`${origin}/api/source?name=first.veado`, {
        method: 'POST',
        headers,
        body: miniFixture({
          metadata: { software: 'veadotube mini', author: 'first', description: 'first' }
        })
      });
      const first = await firstResponse.json();
      const secondResponse = await fetch(`${origin}/api/source?name=second.veado`, {
        method: 'POST',
        headers,
        body: miniFixture({
          metadata: { software: 'veadotube mini', author: 'second', description: 'second' }
        })
      });
      const second = await secondResponse.json();
      assert.notEqual(second.sessionId, first.sessionId);

      const stalePreview = await fetch(`${origin}/api/preview/${first.sessionId}/14`, {
        headers: { Cookie: cookie }
      });
      assert.equal(stalePreview.status, 409);
      assert.equal((await stalePreview.json()).error, 'stale_source');

      const staleImport = await fetch(`${origin}/api/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: origin },
        body: JSON.stringify({
          sessionId: first.sessionId,
          modelName: 'Stale Source',
          confirmed: true,
          selections: [{ stateId: 3, target: 'happy' }]
        })
      });
      assert.equal(staleImport.status, 409);
      assert.equal((await staleImport.json()).error, 'stale_source');
      assert.equal(fs.existsSync(path.join(assetsRoot, 'Stale Source')), false);
    } finally {
      await close(server);
    }
  });
});

test('does not expose unexpected filesystem failures to the browser', async () => {
  await withAssetsRoot(async assetsRoot => {
    const server = createImporterServer({
      assetsRoot,
      fileSystem: {
        readFileSync() {
          const error = new Error('D:\\private\\path was not found');
          error.code = 'ENOENT';
          throw error;
        }
      }
    });
    const origin = await listen(server);
    try {
      const response = await fetch(`${origin}/`);
      assert.equal(response.status, 500);
      assert.deepEqual(await response.json(), {
        error: 'internal_error',
        message: 'Importer request failed'
      });
    } finally {
      await close(server);
    }
  });
});

test('rejects a non-loopback socket even when it claims a localhost Host', async t => {
  const externalAddress = Object.values(os.networkInterfaces()).flat().find(address => (
    address && address.family === 'IPv4' && !address.internal
  ));
  if (!externalAddress) {
    t.skip('No non-loopback IPv4 interface is available');
    return;
  }
  await withAssetsRoot(async assetsRoot => {
    const server = createImporterServer({ assetsRoot });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '0.0.0.0', () => {
        server.removeListener('error', reject);
        resolve();
      });
    });
    try {
      const port = server.address().port;
      const response = await requestWithHost(
        `http://${externalAddress.address}:${port}/`,
        `localhost:${port}`
      );
      assert.equal(response.statusCode, 403);
    } finally {
      await close(server);
    }
  });
});
