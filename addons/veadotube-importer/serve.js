'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { createImportSession } = require('./session');

const DEFAULT_MAX_SOURCE_BYTES = 256 * 1024 * 1024;
const MAX_JSON_BYTES = 64 * 1024;
const COOKIE_NAME = 'veado_importer_session';
const UI_FILES = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']]
]);

function createImporterServer(options) {
  const assetsRoot = options?.assetsRoot || path.resolve(__dirname, '..', '..', 'public', 'assets');
  const assetStates = Array.isArray(options?.assetStates) ? [...options.assetStates] : [];
  const maxSourceBytes = Math.min(
    options?.maxSourceBytes ?? DEFAULT_MAX_SOURCE_BYTES,
    DEFAULT_MAX_SOURCE_BYTES
  );
  const cookieToken = crypto.randomBytes(32).toString('hex');
  let session = null;

  const server = http.createServer((request, response) => {
    handleRequest(request, response).catch(error => sendError(response, error));
  });
  server.maxHeadersCount = 64;
  server.headersTimeout = 10_000;
  server.requestTimeout = 120_000;

  async function handleRequest(request, response) {
    setSecurityHeaders(response);
    if (!isLoopbackHost(request.headers.host)) {
      throw httpError('request_forbidden', 403, 'Importer accepts only loopback Host headers');
    }
    const url = new URL(request.url, 'http://127.0.0.1');
    const staticFile = UI_FILES.get(url.pathname);
    if (request.method === 'GET' && staticFile) {
      if (url.pathname === '/') {
        response.setHeader(
          'Set-Cookie',
          `${COOKIE_NAME}=${cookieToken}; HttpOnly; SameSite=Strict; Path=/`
        );
      }
      return sendUiFile(response, staticFile);
    }
    if (!hasSessionCookie(request.headers.cookie, cookieToken)) {
      throw httpError('request_forbidden', 403, 'Importer session cookie is required');
    }

    if (request.method === 'POST' && url.pathname === '/api/source') {
      requireSameOrigin(request);
      requireContentType(request, 'application/octet-stream');
      const bytes = await readBody(request, maxSourceBytes);
      const nextSession = createImportSession({
        bytes,
        fileName: url.searchParams.get('name'),
        assetsRoot,
        assetStates,
        limits: { maxFileBytes: maxSourceBytes }
      });
      session = nextSession;
      return sendJson(response, 200, {
        source: session.source,
        format: session.format,
        warnings: session.warnings,
        metadata: session.metadata,
        view: session.view
      });
    }

    const previewMatch = /^\/api\/preview\/([1-9][0-9]*)$/.exec(url.pathname);
    if (request.method === 'GET' && previewMatch) {
      requireSession(session);
      const preview = session.preview(Number(previewMatch[1]));
      response.writeHead(200, {
        'Content-Type': 'image/png',
        'Content-Length': preview.png.length
      });
      response.end(preview.png);
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/import') {
      requireSameOrigin(request);
      requireContentType(request, 'application/json');
      requireSession(session);
      const confirmation = await readJson(request);
      const installed = session.install(confirmation);
      return sendJson(response, 201, {
        modelName: installed.manifest.modelName,
        assets: installed.manifest.assets.map(asset => asset.state),
        source: installed.manifest.source
      });
    }

    throw httpError('not_found', 404, 'Importer route was not found');
  }

  return server;
}

function startImporterServer(options) {
  const port = options?.port ?? 3010;
  const server = createImporterServer(options);
  server.listen(port, '127.0.0.1', () => {
    console.log(`VeadoTube Mini Importer: http://127.0.0.1:${port}`);
    console.log('Open that address in a browser when you are ready to import.');
  });
  return server;
}

function sendUiFile(response, [fileName, contentType]) {
  const bytes = fs.readFileSync(path.join(__dirname, 'ui', fileName));
  response.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': bytes.length
  });
  response.end(bytes);
}

function setSecurityHeaders(response) {
  response.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; " +
      "object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
  );
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Content-Type-Options', 'nosniff');
}

function isLoopbackHost(host) {
  return typeof host === 'string' && /^(?:127\.0\.0\.1|localhost)(?::[0-9]{1,5})?$/i.test(host);
}

function hasSessionCookie(cookieHeader, token) {
  if (typeof cookieHeader !== 'string') return false;
  return cookieHeader.split(';').some(cookie => cookie.trim() === `${COOKIE_NAME}=${token}`);
}

function requireSameOrigin(request) {
  if (request.headers.origin !== `http://${request.headers.host}`) {
    throw httpError('request_forbidden', 403, 'Importer mutation requires a same-origin request');
  }
}

function requireContentType(request, expected) {
  const actual = String(request.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase();
  if (actual !== expected) {
    throw httpError('unsupported_media_type', 415, `Expected ${expected}`);
  }
}

function requireSession(session) {
  if (!session) throw httpError('source_required', 409, 'Load a VeadoTube source first');
}

async function readJson(request) {
  const bytes = await readBody(request, MAX_JSON_BYTES);
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw httpError('invalid_json', 400, 'Request body is not valid JSON', error);
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw httpError('invalid_json', 400, 'Request body must be a JSON object');
  }
  return value;
}

async function readBody(request, maxBytes) {
  const length = request.headers['content-length'];
  if (length !== undefined && (!/^[0-9]+$/.test(length) || Number(length) > maxBytes)) {
    throw httpError('request_too_large', 413, 'Request body exceeds the configured limit');
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (!Number.isSafeInteger(total) || total > maxBytes) {
      throw httpError('request_too_large', 413, 'Request body exceeds the configured limit');
    }
    chunks.push(chunk);
  }
  return chunks.length === 1 ? chunks[0] : Buffer.concat(chunks, total);
}

function sendJson(response, status, value) {
  const bytes = Buffer.from(JSON.stringify(value));
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': bytes.length
  });
  response.end(bytes);
}

function sendError(response, error) {
  if (response.headersSent) {
    response.destroy();
    return;
  }
  const status = error.status || statusForCode(error.code);
  sendJson(response, status, {
    error: error.code || 'internal_error',
    message: status === 500 ? 'Importer request failed' : error.message
  });
}

function statusForCode(code) {
  if (code === 'model_exists' || code === 'source_required') return 409;
  if (code === 'file_too_large' || code === 'request_too_large') return 413;
  return code ? 400 : 500;
}

function httpError(code, status, message, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  error.status = status;
  return error;
}

if (require.main === module) startImporterServer();

module.exports = { createImporterServer, startImporterServer };
