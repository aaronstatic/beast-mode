// dsh/test/panel-http.test.js
//
// Covers the Node-to-Web adapter of implementation.md section 3.4
// (harness-support/dsh-web-panel, Phase 2): the request adapter, the
// response adapter, the API path rewrite, the API handler, the UI
// handler, and the cordis patch shape.
//
// Every test runs with plain Node. No test starts dsh and no test opens a
// real socket — a fake stream from node:stream stands in for the Node
// request and response objects.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  createApiHandler,
  createUiHandler,
  rewriteApiPath,
  sendWebResponse,
  toWebRequest,
} from '../lib/panel-http.js';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** Build a fake `IncomingMessage`-shaped Readable stream. */
function fakeIncomingMessage({ method = 'GET', url = '/', headers = {}, body = null }) {
  const stream = new Readable({
    read() {
      if (body !== null) {
        this.push(body);
        body = null;
      }
      this.push(null);
    },
  });
  stream.method = method;
  stream.url = url;
  stream.headers = headers;
  return stream;
}

/** Build a fake `ServerResponse`-shaped object that records every call. */
function fakeServerResponse() {
  return {
    statusCode: undefined,
    headers: undefined,
    body: undefined,
    ended: false,
    writeHead(status, headers) {
      this.statusCode = status;
      this.headers = headers;
    },
    end(buffer) {
      this.body = buffer;
      this.ended = true;
    },
  };
}

// ---------------------------------------------------------------------------
// toWebRequest
// ---------------------------------------------------------------------------

test('toWebRequest builds the absolute URL from the host header', async () => {
  const req = fakeIncomingMessage({ url: '/beast/api/projects', headers: { host: 'example.test:9000' } });
  const request = await toWebRequest(req);
  assert.equal(request.url, 'http://example.test:9000/beast/api/projects');
});

test('toWebRequest falls back to localhost with no host header', async () => {
  const req = fakeIncomingMessage({ url: '/beast/api/projects', headers: {} });
  const request = await toWebRequest(req);
  assert.equal(request.url, 'http://localhost/beast/api/projects');
});

test('toWebRequest copies the method and one header', async () => {
  const req = fakeIncomingMessage({
    method: 'GET',
    url: '/beast/api/projects',
    headers: { host: 'localhost', 'x-custom': 'one' },
  });
  const request = await toWebRequest(req);
  assert.equal(request.method, 'GET');
  assert.equal(request.headers.get('x-custom'), 'one');
});

test('toWebRequest joins an array header value with a comma and a space', async () => {
  const req = fakeIncomingMessage({
    url: '/beast/api/projects',
    headers: { host: 'localhost', 'x-multi': ['a', 'b'] },
  });
  const request = await toWebRequest(req);
  assert.equal(request.headers.get('x-multi'), 'a, b');
});

test('toWebRequest carries no body for GET or HEAD', async () => {
  const req = fakeIncomingMessage({ method: 'GET', url: '/beast/api/projects', body: 'ignored' });
  const request = await toWebRequest(req);
  assert.equal(request.body, null);
});

test('toWebRequest buffers the body bytes of a POST', async () => {
  const req = fakeIncomingMessage({
    method: 'POST',
    url: '/beast/api/bugs',
    headers: { host: 'localhost', 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'one' }),
  });
  const request = await toWebRequest(req);
  const text = await request.text();
  assert.equal(text, JSON.stringify({ title: 'one' }));
});

// ---------------------------------------------------------------------------
// sendWebResponse
// ---------------------------------------------------------------------------

test('sendWebResponse writes the status, the headers, and the body', async () => {
  const res = fakeServerResponse();
  const response = new Response(JSON.stringify({ ok: true }), {
    status: 201,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
  await sendWebResponse(res, response);
  assert.equal(res.statusCode, 201);
  assert.equal(res.headers['content-type'], 'application/json; charset=utf-8');
  assert.ok(res.ended);
  assert.equal(res.body.toString('utf8'), JSON.stringify({ ok: true }));
});

// ---------------------------------------------------------------------------
// rewriteApiPath
// ---------------------------------------------------------------------------

test('rewriteApiPath maps a plain path', () => {
  assert.equal(rewriteApiPath('/beast/api/projects'), '/api/projects');
});

test('rewriteApiPath maps a nested path', () => {
  assert.equal(rewriteApiPath('/beast/api/features/one/tasks'), '/api/features/one/tasks');
});

test('rewriteApiPath maps the panel index path', () => {
  assert.equal(rewriteApiPath('/beast/api/panel'), '/api/panel');
});

test('rewriteApiPath rejects a decoded dot-dot segment', () => {
  assert.equal(rewriteApiPath('/beast/api/../secret'), null);
  assert.equal(rewriteApiPath('/beast/api/%2e%2e/secret'), null);
});

test('rewriteApiPath rejects a path outside the prefix', () => {
  assert.equal(rewriteApiPath('/other/path'), null);
  assert.equal(rewriteApiPath('/beast/apifoo'), null);
});

// ---------------------------------------------------------------------------
// createApiHandler
// ---------------------------------------------------------------------------

test('createApiHandler answers /beast/api/panel with no backend call', async () => {
  let backendCalled = false;
  const backend = {
    async handle() {
      backendCalled = true;
      return null;
    },
  };
  const panelIndex = () => ({ version: 1, beastModeVersion: '5.5.0', workspaces: [] });
  const handler = createApiHandler({ backend, panelIndex });

  const request = new Request('http://localhost/beast/api/panel');
  const response = await handler(request);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(backendCalled, false);
  assert.deepEqual(body, { version: 1, beastModeVersion: '5.5.0', workspaces: [] });
});

test('createApiHandler delegates a non-panel path to backend.handle with the rewritten URL', async () => {
  let seenUrl;
  const backend = {
    async handle(req, url) {
      seenUrl = url;
      return new Response(JSON.stringify({ hit: true }), { status: 200 });
    },
  };
  const handler = createApiHandler({ backend, panelIndex: () => ({}) });
  const request = new Request('http://localhost/beast/api/projects');
  const response = await handler(request);

  assert.equal(response.status, 200);
  assert.equal(seenUrl.pathname, '/api/projects');
});

test('createApiHandler answers a 404 JSON body when backend.handle returns null', async () => {
  const backend = { async handle() { return null; } };
  const handler = createApiHandler({ backend, panelIndex: () => ({}) });
  const request = new Request('http://localhost/beast/api/no-such-route');
  const response = await handler(request);

  assert.equal(response.status, 404);
  assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
  const body = await response.json();
  assert.ok(body.error);
});

test('createApiHandler answers a 400 JSON body for a dot-dot path', async () => {
  const backend = { async handle() { throw new Error('must not be called'); } };
  const handler = createApiHandler({ backend, panelIndex: () => ({}) });
  const request = new Request('http://localhost/beast/api/%2e%2e/secret');
  const response = await handler(request);

  assert.equal(response.status, 400);
  assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
});

test('createApiHandler answers a 500 JSON body and never throws when backend.handle throws', async () => {
  const backend = { async handle() { throw new Error('boom'); } };
  const handler = createApiHandler({ backend, panelIndex: () => ({}) });
  const request = new Request('http://localhost/beast/api/projects');
  const response = await handler(request);

  assert.equal(response.status, 500);
  assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
});

// ---------------------------------------------------------------------------
// createUiHandler
// ---------------------------------------------------------------------------

test('createUiHandler strips the prefix before it calls the static handler', async () => {
  let seenPathname;
  const staticHandler = async (req) => {
    seenPathname = new URL(req.url).pathname;
    return new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } });
  };
  const handler = createUiHandler({ staticHandler, prefix: '/beast/ui' });
  const request = new Request('http://localhost/beast/ui/assets/app.js');
  const response = await handler(request);

  assert.equal(seenPathname, '/assets/app.js');
  assert.equal(response.status, 200);
});

test('createUiHandler answers a 500 JSON body and never throws when the static handler throws', async () => {
  const staticHandler = async () => {
    throw new Error('boom');
  };
  const handler = createUiHandler({ staticHandler, prefix: '/beast/ui' });
  const request = new Request('http://localhost/beast/ui/');
  const response = await handler(request);

  assert.equal(response.status, 500);
});

// CR-26. The built static handler confines every candidate file to its root,
// and it builds that test from the root plus one separator. A root with a
// trailing separator therefore matched no file, and every asset answered
// with the SPA fallback, so the panel SPA never started in a browser. The
// handler now strips the trailing separators, and `SPA_ROOT` passes none.
test('the built static handler serves an asset through the UI prefix', async (t) => {
  const artifact = path.join(REPO_ROOT, 'dsh', 'panel', 'api.js');
  const spaDir = path.join(REPO_ROOT, 'dsh', 'panel', 'spa');
  if (!fs.existsSync(artifact) || !fs.existsSync(spaDir)) {
    t.skip('dsh/panel/ is absent. Run "node dsh/build.mjs" at the repository root.');
    return;
  }

  const { createStaticHandler } = await import('../../dsh/panel/api.js');
  const indexHtml = fs.readFileSync(path.join(spaDir, 'index.html'), 'utf8');
  const assetPath = indexHtml.match(/\/beast\/ui(\/assets\/[^"']+\.js)/)?.[1];
  assert.ok(assetPath, 'the built index.html must name one script asset');

  // Both root forms must work. The trailing form is the CR-26 case.
  for (const root of [spaDir, `${spaDir}/`]) {
    const handler = createUiHandler({
      staticHandler: createStaticHandler({ root }),
      prefix: '/beast/ui',
    });

    const asset = await handler(new Request(`http://localhost/beast/ui${assetPath}`));
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get('content-type') ?? '', /javascript/);

    // The SPA fallback still answers a client route and a traversal attempt.
    const route = await handler(new Request('http://localhost/beast/ui/projects/demo'));
    assert.equal(route.status, 200);
    assert.match(route.headers.get('content-type') ?? '', /text\/html/);

    const escape = await handler(new Request('http://localhost/beast/ui/../../etc/passwd'));
    assert.equal(escape.status, 200);
    assert.match(escape.headers.get('content-type') ?? '', /text\/html/);
  }
});

// ---------------------------------------------------------------------------
// The cordis patch shape
// ---------------------------------------------------------------------------

// CR-24. The patch held two rows until the live check of Phase 6. The root
// package.json declares a `dsh.client` bundle, and the dsh client module
// registry allows one active loader row per package. A second row of the
// same package makes `reconcilePackage` throw "resolves from multiple active
// Loader sources", and that error fails the whole dsh boot. The bundle entry
// `dsh/lib/index.js` now mounts the panel as a child plugin instead.
test('the patch file parses as an array of one insert entry that holds one row', () => {
  const patchPath = path.join(REPO_ROOT, 'dsh', 'cordis.patch.yml');
  const text = fs.readFileSync(patchPath, 'utf8');
  const lines = text.split('\n');
  const insertLines = lines.filter((line) => line.trim() === '- insert:');
  assert.equal(insertLines.length, 1, 'the patch file must hold exactly one top-level "- insert:" entry');

  const insertIndex = lines.findIndex((line) => line.trim() === '- insert:');
  const rowLines = lines.slice(insertIndex + 1).filter((line) => line.trim().length > 0);
  const idLines = rowLines.filter((line) => line.trim().startsWith('- id:'));
  assert.equal(idLines.length, 1, 'the insert entry must hold one row, per CR-24');

  const ids = idLines.map((line) => line.split(':').slice(1).join(':').trim());
  assert.deepEqual(ids, ['beast-mode']);

  const nameLines = rowLines.filter((line) => line.trim().startsWith('name:'));
  assert.deepEqual(
    nameLines.map((line) => line.split(':').slice(1).join(':').trim()),
    ['./lib/index.js'],
  );
});
