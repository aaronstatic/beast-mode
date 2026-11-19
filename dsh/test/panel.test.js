// dsh/test/panel.test.js
//
// Covers the host plugin of implementation.md section 3.3
// (harness-support/dsh-web-panel): the plugin export shape, the bounded
// `webServer` retry loop, and the dsh web gate on both routes.
//
// The retry loop is the subject of CR-23. Before the fix, every retry timer
// held the Node event loop open, so `dsh --profile web web --help` took 60
// seconds: the profile composed, this plugin ran, and the command waited for
// the full retry budget. Every retry timer now calls `unref`.
//
// Every test runs with plain Node. No test starts dsh and no test opens a
// socket. One test starts a short-lived child process, which proves that the
// loop lets the process exit.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { __testing, apply, name } from '../lib/panel.js';

const PANEL_URL = new URL('../lib/panel.js', import.meta.url).href;
const NODE_BIN = process.execPath;

/** A context whose `get` always answers `undefined`, like a headless profile. */
function emptyContext() {
  return { get: () => undefined };
}

test('the module exports the plugin shape and declares no inject array', async () => {
  const mod = await import('../lib/panel.js');
  assert.equal(name, 'beast-mode-panel');
  assert.equal(typeof apply, 'function');
  // Section 3.3 rule 1. A hard inject would block `apply` for ever in a
  // profile that holds no `webServer`.
  assert.equal(mod.inject, undefined);
});

test('resolveWebServer answers at once when the context holds the service', async () => {
  const webServer = { register() {} };
  const ctx = { get: (service) => (service === 'webServer' ? webServer : undefined) };

  const resolved = await __testing.resolveWebServer(ctx, { intervalMs: 1, limit: 3 });

  assert.equal(resolved, webServer);
});

test('every retry timer carries unref, and the loop stops at the limit', async () => {
  const realSetTimeout = globalThis.setTimeout;
  const realConsoleError = console.error;
  const unrefCalls = [];
  const logLines = [];

  globalThis.setTimeout = (fn, ms, ...rest) => {
    const timer = realSetTimeout(fn, ms, ...rest);
    const realUnref = timer.unref.bind(timer);
    timer.unref = () => {
      unrefCalls.push(ms);
      return realUnref();
    };
    return timer;
  };
  console.error = (...parts) => logLines.push(parts.join(' '));

  try {
    const resolved = await __testing.resolveWebServer(emptyContext(), { intervalMs: 1, limit: 3 });

    assert.equal(resolved, null);
    // One timer per retry, and `unref` on each one.
    assert.equal(unrefCalls.length, 3);
    assert.deepEqual(unrefCalls, [1, 1, 1]);
    assert.equal(logLines.length, 1);
    assert.match(logLines[0], /webServer did not appear after 3 retries/);
  } finally {
    globalThis.setTimeout = realSetTimeout;
    console.error = realConsoleError;
  }
});

test('the retry loop lets a short-lived process exit (CR-23)', () => {
  // The child starts a retry loop with a 500 step budget at 20 ms, which is
  // 10 seconds of waiting when a timer holds the loop open. It must instead
  // exit as soon as the main script ends.
  const script = [
    `const { __testing } = await import(${JSON.stringify(PANEL_URL)});`,
    'const ctx = { get: () => undefined };',
    '__testing.resolveWebServer(ctx, { intervalMs: 20, limit: 500 }).catch(() => {});',
    "process.stdout.write('started');",
  ].join('\n');

  const started = Date.now();
  const child = spawnSync(NODE_BIN, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
    timeout: 2000,
  });
  const elapsed = Date.now() - started;

  assert.equal(child.signal, null, 'the child must exit on its own, not on a timeout kill');
  assert.equal(child.status, 0);
  assert.equal(child.stdout, 'started');
  assert.ok(elapsed < 2000, `the child took ${elapsed} ms, so a retry timer held the loop open`);
});

// ---------------------------------------------------------------------------
// The start order
// ---------------------------------------------------------------------------
//
// `start` resolves `webServer` first, and it imports the api bundle second.
// A headless profile therefore never parses the 194 kB artifact.

/** A fake api bundle. The two members answer every call with a 200. */
function fakeBackendModule() {
  return {
    createBeastBackend: () => ({ handle: async () => new Response('{}', { status: 200 }) }),
    createStaticHandler: () => async () => new Response('<html></html>', { status: 200 }),
  };
}

test('a headless profile never imports the api bundle', async () => {
  let loads = 0;
  const loadBackend = async () => {
    loads += 1;
    return fakeBackendModule();
  };

  await withConsole(async () => {
    await __testing.start(emptyContext(), { intervalMs: 1, limit: 1, loadBackend });
  });

  assert.equal(loads, 0, 'the import must wait for a webServer, so a headless profile skips it');
});

test('a profile with a webServer imports the bundle and registers both routes', async () => {
  const routes = [];
  const webServer = { register: (route) => routes.push(route) };
  const ctx = { get: (service) => (service === 'webServer' ? webServer : undefined) };
  let loads = 0;
  const loadBackend = async () => {
    loads += 1;
    return fakeBackendModule();
  };

  await withConsole(async () => {
    await __testing.start(ctx, { loadBackend });
  });

  assert.equal(loads, 1);
  assert.deepEqual(routes.map((route) => route.path), ['/beast/api', '/beast/ui']);
});

// ---------------------------------------------------------------------------
// The bundle entry, CR-24
// ---------------------------------------------------------------------------
//
// The bundle ships one cordis insert row, because the dsh client module
// registry allows one active loader row per npm package that declares a
// `dsh.client` bundle. `dsh/lib/index.js` therefore mounts both plugins as
// children.

test('the bundle entry mounts the skill provider and the panel as children', async () => {
  const entry = await import('../lib/index.js');
  const mounted = [];
  const ctx = { plugin: (plugin) => mounted.push(plugin) };

  entry.apply(ctx);

  assert.equal(entry.name, 'beast-mode');
  // A top-level `inject` would gate the panel behind the skills service.
  assert.equal(entry.inject, undefined);
  assert.equal(mounted.length, 2);

  const [skills, panel] = mounted;
  assert.equal(skills.name, 'beast-mode-skills');
  assert.deepEqual(skills.inject, ['skills']);
  assert.equal(typeof skills.apply, 'function');

  assert.equal(panel.name, 'beast-mode-panel');
  assert.equal(panel.apply, apply);
  assert.equal(panel.inject, undefined);
});

test('the skill provider child registers the bundled provider', async () => {
  const entry = await import('../lib/index.js');
  const registered = [];
  const ctx = { skills: { registerProvider: (factory) => registered.push(factory()) } };

  entry.__testing.skillProviderPlugin.apply(ctx);

  assert.equal(registered.length, 1);
  assert.equal(registered[0], entry.provider);
});

// ---------------------------------------------------------------------------
// The dsh web gate, CR-25
// ---------------------------------------------------------------------------
//
// The dsh gate is per route. `webServer.register` adds no gate, so the panel
// routes answered every caller with no token before this fix. Each route now
// asks the `connection` service for a rejection first. The service name and
// the three return values come from
// `packages/client/connection/src/rpc-host.ts` in the dsh source.
//
// Every test below drives the route handler with a fake connection service.
// No test starts dsh, and no test opens a socket.

/** A plain `IncomingMessage` stand-in. A GET carries no body to read. */
function fakeRequest(url = '/beast/api/projects') {
  return { method: 'GET', url, headers: { host: '127.0.0.1:3081' } };
}

/** A `ServerResponse` stand-in that records every call. */
function fakeResponse() {
  return {
    statusCode: undefined,
    headers: undefined,
    body: undefined,
    ended: false,
    writeHead(status, headers) {
      this.statusCode = status;
      this.headers = headers;
    },
    end(body) {
      this.body = body === undefined ? undefined : String(body);
      this.ended = true;
    },
  };
}

/** A context that answers one connection service and nothing else. */
function contextWith(connection) {
  return {
    get: (service) => (service === __testing.CONNECTION_SERVICE ? connection : undefined),
  };
}

/** Run `fn` with console.log and console.error captured. */
async function withConsole(fn) {
  const realLog = console.log;
  const realError = console.error;
  const lines = { log: [], error: [] };
  console.log = (...parts) => lines.log.push(parts.map(String).join(' '));
  console.error = (...parts) => lines.error.push(parts.map(String).join(' '));
  try {
    await fn(lines);
  } finally {
    console.log = realLog;
    console.error = realError;
  }
  return lines;
}

/**
 * Register one route over a backend spy.
 * @returns the registered route and the list of requests the backend saw.
 */
function routeUnderTest(ctx, options = {}) {
  const backendCalls = [];
  let route = null;
  const webServer = { register: (value) => { route = value; } };
  const webHandler = async (request) => {
    backendCalls.push(request.url);
    return new Response('{"ok":true}', {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  };
  __testing.registerRoute(ctx, webServer, '/beast/api', webHandler, options);
  return { backendCalls, route };
}

test('an accepted request reaches the backend', async () => {
  const ctx = contextWith({ requestRejection: () => undefined });
  const res = fakeResponse();

  await withConsole(async () => {
    const { backendCalls, route } = routeUnderTest(ctx, { jsonOnly: true });
    await route.handler(fakeRequest(), res);
    assert.deepEqual(backendCalls, ['http://127.0.0.1:3081/beast/api/projects']);
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body, '{"ok":true}');
});

test('a rejected request never reaches the backend, and the API prefix stays JSON', async () => {
  const ctx = contextWith({ requestRejection: () => 401 });
  const res = fakeResponse();

  await withConsole(async () => {
    const { backendCalls, route } = routeUnderTest(ctx, { jsonOnly: true });
    await route.handler(fakeRequest(), res);
    assert.equal(backendCalls.length, 0, 'the backend must never see a rejected request');
  });

  assert.equal(res.statusCode, 401);
  assert.equal(res.headers['content-type'], 'application/json; charset=utf-8');
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.deepEqual(JSON.parse(res.body), { error: 'unauthorized' });
});

test('a 403 on the UI prefix answers the shape of the dsh routes', async () => {
  const ctx = contextWith({ requestRejection: () => 403 });
  const res = fakeResponse();

  await withConsole(async () => {
    const { backendCalls, route } = routeUnderTest(ctx);
    await route.handler(fakeRequest('/beast/ui/index.html'), res);
    assert.equal(backendCalls.length, 0);
  });

  assert.equal(res.statusCode, 403);
  assert.equal(res.body, 'forbidden');
});

test('an absent connection service answers 503 JSON with one log line', async () => {
  const ctx = contextWith(undefined);
  const res = fakeResponse();

  const lines = await withConsole(async () => {
    const { backendCalls, route } = routeUnderTest(ctx, { jsonOnly: true });
    await route.handler(fakeRequest(), res);
    assert.equal(backendCalls.length, 0, 'a missing gate must never open the route');
  });

  assert.equal(res.statusCode, 503);
  assert.equal(res.headers['content-type'], 'application/json; charset=utf-8');
  assert.deepEqual(JSON.parse(res.body), { error: 'The dsh web gate is not available' });
  assert.equal(lines.error.length, 1);
  assert.match(lines.error[0], /connection service is absent/);
});

test('an absent connection service answers 503 plain text on the UI prefix', async () => {
  // The API prefix answers JSON for every status, and the UI prefix answers
  // the plain body of the dsh routes. A 503 takes the same split, so one
  // prefix never mixes two body shapes.
  const ctx = contextWith(undefined);
  const res = fakeResponse();

  const lines = await withConsole(async () => {
    const { backendCalls, route } = routeUnderTest(ctx);
    await route.handler(fakeRequest('/beast/ui/index.html'), res);
    assert.equal(backendCalls.length, 0, 'a missing gate must never open the route');
  });

  assert.equal(res.statusCode, 503);
  assert.equal(res.headers, undefined, 'the UI refusal shape carries no header map');
  assert.equal(res.body, 'service unavailable');
  assert.equal(lines.error.length, 1);
  assert.match(lines.error[0], /connection service is absent/);
});

test('a connection service with no requestRejection answers 503', async () => {
  const ctx = contextWith({});
  const res = fakeResponse();

  await withConsole(async () => {
    const { backendCalls, route } = routeUnderTest(ctx, { jsonOnly: true });
    await route.handler(fakeRequest(), res);
    assert.equal(backendCalls.length, 0);
  });

  assert.equal(res.statusCode, 503);
});

test('a gate that throws answers 503 and never opens the route', async () => {
  const ctx = contextWith({
    requestRejection: () => { throw new Error('the gate is broken'); },
  });
  const res = fakeResponse();

  const lines = await withConsole(async () => {
    const { backendCalls, route } = routeUnderTest(ctx, { jsonOnly: true });
    await route.handler(fakeRequest(), res);
    assert.equal(backendCalls.length, 0);
  });

  assert.equal(res.statusCode, 503);
  assert.equal(lines.error.length, 1);
  assert.match(lines.error[0], /the dsh web gate failed/);
});

test('the gate resolves the connection service at request time', async () => {
  // The `client-connection` plugin can reload, and each reload makes a new
  // service value. A value read once at registration time would go stale.
  let connection;
  const ctx = {
    get: (service) => (service === __testing.CONNECTION_SERVICE ? connection : undefined),
  };
  const first = fakeResponse();
  const second = fakeResponse();

  await withConsole(async () => {
    const { backendCalls, route } = routeUnderTest(ctx, { jsonOnly: true });

    await route.handler(fakeRequest(), first);
    assert.equal(backendCalls.length, 0);

    connection = { requestRejection: () => undefined };
    await route.handler(fakeRequest(), second);
    assert.equal(backendCalls.length, 1);
  });

  assert.equal(first.statusCode, 503);
  assert.equal(second.statusCode, 200);
});

test('the gate reads the raw Node request, so Host and Cookie stay intact', async () => {
  const seen = [];
  const ctx = contextWith({
    requestRejection: (req) => {
      seen.push(req);
      return undefined;
    },
  });
  const req = fakeRequest();
  req.headers.cookie = 'dsh-auth-abc=v1.body.signature';

  await withConsole(async () => {
    const { route } = routeUnderTest(ctx, { jsonOnly: true });
    await route.handler(req, fakeResponse());
  });

  assert.equal(seen.length, 1);
  assert.equal(seen[0], req, 'the gate must see the Node request, not the Web copy');
});

test('registerPanel puts both prefixes behind the gate', async () => {
  const apiCalls = [];
  const uiCalls = [];
  const backendModule = {
    createBeastBackend: () => ({
      handle: async () => {
        apiCalls.push(1);
        return new Response('{}', { status: 200 });
      },
    }),
    createStaticHandler: () => async () => {
      uiCalls.push(1);
      return new Response('<html></html>', { status: 200 });
    },
  };
  const ctx = contextWith({ requestRejection: () => 401 });
  const routes = [];
  const webServer = { register: (route) => routes.push(route) };

  await withConsole(async () => {
    __testing.registerPanel(ctx, webServer, backendModule);

    assert.deepEqual(routes.map((route) => route.path), ['/beast/api', '/beast/ui']);

    for (const route of routes) {
      const res = fakeResponse();
      await route.handler(fakeRequest(`${route.path}/anything`), res);
      assert.equal(res.statusCode, 401, `${route.path} must refuse an unauthenticated request`);
    }
  });

  assert.equal(apiCalls.length, 0, 'the API backend must never see a rejected request');
  assert.equal(uiCalls.length, 0, 'the static handler must never see a rejected request');
});
