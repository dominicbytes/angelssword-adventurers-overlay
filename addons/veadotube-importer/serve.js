'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { assertWindowsPlatform } = require('./platform');
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
  const fileSystem = options?.fileSystem || fs;
  const maxSourceBytes = Math.min(
    options?.maxSourceBytes ?? DEFAULT_MAX_SOURCE_BYTES,
    DEFAULT_MAX_SOURCE_BYTES
  );
  const cookieToken = crypto.randomBytes(32).toString('hex');
  let currentSession = null;

  const server = http.createServer((request, response) => {
    handleRequest(request, response).catch(error => sendError(response, error));
  });
  server.maxHeadersCount = 64;
  server.headersTimeout = 10_000;
  server.requestTimeout = 120_000;

  async function handleRequest(request, response) {
    setSecurityHeaders(response);
    if (!isLoopbackHost(request.headers.host) ||
        !isLoopbackAddress(request.socket.remoteAddress)) {
      throw httpError('request_forbidden', 403, 'Importer accepts only loopback connections');
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
      return sendUiFile(response, staticFile, fileSystem);
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
      currentSession = {
        id: crypto.randomBytes(32).toString('hex'),
        importer: nextSession
      };
      return sendJson(response, 200, {
        sessionId: currentSession.id,
        source: nextSession.source,
        format: nextSession.format,
        warnings: nextSession.warnings,
        metadata: nextSession.metadata,
        view: nextSession.view
      });
    }

    const previewMatch = /^\/api\/preview\/([a-f0-9]{64})\/([1-9][0-9]*)$/.exec(url.pathname);
    if (request.method === 'GET' && previewMatch) {
      const importer = requireSession(currentSession, previewMatch[1]);
      const preview = importer.preview(Number(previewMatch[2]));
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
      const confirmation = await readJson(request);
      const importer = requireSession(currentSession, confirmation.sessionId);
      const installed = importer.install(confirmation);
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
  assertWindowsPlatform();
  const port = options?.port ?? 3010;
  const server = createImporterServer(options);
  server.listen(port, '127.0.0.1', () => {
    console.log(`VeadoTube Mini Importer: http://127.0.0.1:${port}`);
    console.log('Open that address in a browser when you are ready to import.');
  });
  return server;
}

function sendUiFile(response, [fileName, contentType], fileSystem) {
  const bytes = fileSystem.readFileSync(path.join(__dirname, 'ui', fileName));
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

function isLoopbackAddress(address) {
  return typeof address === 'string' && (
    address === '::1' ||
    /^127(?:\.[0-9]{1,3}){3}$/.test(address) ||
    /^::ffff:127(?:\.[0-9]{1,3}){3}$/i.test(address)
  );
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

function requireSession(currentSession, sessionId) {
  if (!currentSession) throw httpError('source_required', 409, 'Load a VeadoTube source first');
  if (typeof sessionId !== 'string' || sessionId !== currentSession.id) {
    throw httpError('stale_source', 409, 'The reviewed source is no longer active');
  }
  return currentSession.importer;
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
    error: status === 500 ? 'internal_error' : error.code,
    message: status === 500 ? 'Importer request failed' : error.message
  });
}

function statusForCode(code) {
  if (code === 'model_exists' || code === 'source_required' || code === 'stale_source') return 409;
  if (code === 'file_too_large' || code === 'request_too_large') return 413;
  if (code === 'commit_failed' || code === 'path_check_failed') return 500;
  return typeof code === 'string' && /^[a-z][a-z0-9_]*$/.test(code) ? 400 : 500;
}

function httpError(code, status, message, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  error.status = status;
  return error;
}

if (require.main === module) startImporterServer();

module.exports = { createImporterServer, startImporterServer };
