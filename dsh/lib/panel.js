/**
 * The Beast Mode web panel host plugin for dsh.
 *
 * Registers two `webServer` prefix routes. `/beast/api/` serves the Beast
 * Mode API over a `ProjectProvider` built from `ctx.get('workspaceRegistry')`.
 * `/beast/ui/` serves the prebuilt dashboard SPA at `dsh/panel/spa/`.
 *
 * Both routes sit behind the dsh web gate. `webServer.register` applies no
 * gate of its own, so each route asks the `connection` service for a
 * rejection before it does any work (CR-25).
 *
 * The module declares no `inject` array. `webServer` is absent in a
 * headless profile, and a hard inject would block `apply` for ever. `apply`
 * calls `ctx.get('webServer')` at once, retries every 2 seconds up to 30
 * times when it is absent, then stops and logs one line. Every retry timer
 * carries `unref`, so the loop never holds the Node event loop open. Only a
 * profile that answers with a `webServer` goes on to import `../panel/api.js`,
 * and it does that with a dynamic `import()` inside a try. A missing or broken
 * build artifact therefore logs one line and registers no route, and the dsh
 * boot never fails.
 *
 * @module beast-mode/dsh/panel
 */

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createApiHandler, createUiHandler, sendWebResponse, toWebRequest } from './panel-http.js';
import { buildPanelIndex, createWorkspaceProvider } from './project-map.js';

const LOG_PREFIX = '[beast-mode-panel]';

/** How long to wait between one `webServer` resolve attempt and the next. */
const RETRY_INTERVAL_MS = 2000;

/** How many times to retry a `webServer` resolve before giving up. */
const RETRY_LIMIT = 30;

/** The two prefix paths. No trailing slash, per `webServer.register`. */
const API_PREFIX = '/beast/api';
const UI_PREFIX = '/beast/ui';

/**
 * The dsh service that holds the web gate.
 *
 * The `client-connection` plugin provides it under this name
 * (`packages/client/connection/src/rpc-host.ts`, `super(ctx, 'connection')`).
 * This file names the service as a string and reads it with `ctx.get`,
 * because `dsh/lib/` imports no dsh package of any kind. The dsh
 * `open-in-app` host plugin reads the same service in the same way.
 */
const CONNECTION_SERVICE = 'connection';

/**
 * The built SPA directory, resolved from this file's own location.
 *
 * The path carries no trailing separator on purpose. `createStaticHandler`
 * confines every candidate file to the root, and it builds that test from
 * the root plus one separator, so a trailing separator made every asset
 * answer with the SPA fallback (CR-26).
 */
const SPA_ROOT = fileURLToPath(new URL('../panel/spa', import.meta.url));

/** Cordis plugin name. */
export const name = 'beast-mode-panel';

/**
 * Import the built API bundle. Returns null on any failure, and logs one
 * line naming the cause.
 * @returns {Promise<{createBeastBackend: Function, createStaticHandler: Function} | null>}
 */
async function loadBackendModule() {
  try {
    return await import('../panel/api.js');
  } catch (error) {
    console.error(`${LOG_PREFIX} the panel api build is absent or broken, no route registered`, error);
    return null;
  }
}

/**
 * Resolve `webServer` from the context, with a bounded retry.
 *
 * Every retry timer calls `unref`, so the retry loop never holds the Node
 * event loop open. A short-lived command, for example `dsh web --help`,
 * composes the profile, runs this plugin, and then exits at once. It does
 * not wait for the full retry budget.
 *
 * @param {{get: (name: string) => unknown}} ctx
 * @param {{intervalMs?: number, limit?: number}} [options] A test hook. The
 *   dsh path passes no options, and it takes the two constants above.
 * @returns {Promise<object | null>}
 */
function resolveWebServer(ctx, options = {}) {
  const intervalMs = options.intervalMs ?? RETRY_INTERVAL_MS;
  const limit = options.limit ?? RETRY_LIMIT;
  return new Promise((resolve) => {
    const attempt = (count) => {
      const webServer = ctx.get('webServer');
      if (webServer !== undefined) {
        resolve(webServer);
        return;
      }
      if (count >= limit) {
        console.error(`${LOG_PREFIX} webServer did not appear after ${limit} retries, no route registered`);
        resolve(null);
        return;
      }
      const timer = setTimeout(() => attempt(count + 1), intervalMs);
      // A retry timer must never keep the process alive.
      if (typeof timer?.unref === 'function') timer.unref();
    };
    attempt(0);
  });
}

/** A minimal logger that forwards warn and error to the console with one prefix. */
function createLogger() {
  return {
    debug() {},
    info() {},
    warn(msg, data) {
      console.warn(LOG_PREFIX, msg, data ?? '');
    },
    error(msg, data) {
      console.error(LOG_PREFIX, msg, data ?? '');
    },
  };
}

/** The one sentence both 503 answers carry. */
const GATE_UNAVAILABLE = 'The dsh web gate is not available';

/**
 * Answer one request with a JSON body, from the Node layer.
 *
 * The gate answers before the Web handler runs, so this function writes the
 * Node response itself. `no-store` keeps a refusal out of every cache.
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {object} body
 */
function sendJson(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

/**
 * Answer one request with a plain body, from the Node layer.
 *
 * The dsh `/api` route answers a refusal with this exact shape: a bare status
 * and one lowercase reason. The UI prefix serves a browser document, so it
 * follows the dsh shape and never answers JSON.
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {string} reason
 */
function sendPlain(res, status, reason) {
  res.writeHead(status);
  res.end(reason);
}

/**
 * Close one route with 503, in the body shape of its own prefix.
 *
 * The API prefix answers JSON for every status, and the UI prefix answers a
 * plain body for every status. A 503 therefore takes the same split as a 401
 * and a 403, so one prefix never mixes two body shapes.
 * @param {import('node:http').ServerResponse} res
 * @param {boolean} jsonOnly True for the API prefix.
 */
function sendGateUnavailable(res, jsonOnly) {
  if (jsonOnly) {
    sendJson(res, 503, { error: GATE_UNAVAILABLE });
    return;
  }
  sendPlain(res, 503, 'service unavailable');
}

/**
 * Apply the dsh web gate to one request.
 *
 * The dsh gate is per route. `webServer.register` adds no gate, so a route of
 * this plugin must call the gate itself. The `connection` service holds it.
 * `requestRejection(req)` applies the Host and Origin fence first, then the
 * browser cookie check. It returns 403 for an untrusted Host or a cross-site
 * call, 401 for a request with no valid session cookie, and `undefined` for a
 * request that passes.
 *
 * The service resolves at request time, never at registration time. The
 * `client-connection` plugin can reload, and each reload makes a new service
 * value. `ctx.get` also answers `undefined` while the providing fiber is not
 * active.
 *
 * A gate that is absent, or a gate that throws, closes both routes with 503.
 * The API prefix answers a JSON body, and the UI prefix answers a plain body,
 * exactly as a 401 and a 403 do. An open route gives every client on the port
 * read and write access to the project files, so a closed panel is the safer
 * failure (CR-25).
 *
 * @param {{get: (name: string) => unknown}} ctx
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {boolean} jsonOnly True for the API prefix, which answers JSON only.
 * @returns {boolean} True when this function owns the answer, so the caller stops.
 */
function gateRejects(ctx, req, res, jsonOnly) {
  const connection = ctx.get(CONNECTION_SERVICE);
  if (connection === undefined || connection === null
    || typeof connection.requestRejection !== 'function') {
    console.error(`${LOG_PREFIX} the dsh connection service is absent, both routes answer 503`);
    sendGateUnavailable(res, jsonOnly);
    return true;
  }

  let rejection;
  try {
    rejection = connection.requestRejection(req);
  } catch (error) {
    console.error(`${LOG_PREFIX} the dsh web gate failed, both routes answer 503`, error);
    sendGateUnavailable(res, jsonOnly);
    return true;
  }

  if (rejection === undefined) return false;

  // The gate answers 401 or 403 today. Any other refusal value becomes 403,
  // so an unknown value from a later dsh keeps the route closed.
  const status = rejection === 401 ? 401 : 403;
  const reason = status === 401 ? 'unauthorized' : 'forbidden';
  if (jsonOnly) {
    sendJson(res, status, { error: reason });
    return true;
  }
  sendPlain(res, status, reason);
  return true;
}

/**
 * Register one Node-style route handler over a Web standard handler.
 *
 * The gate runs first, so a refused request never reaches the request
 * adapter, and it never reaches the backend.
 * @param {{get: (name: string) => unknown}} ctx
 * @param {object} webServer
 * @param {string} path
 * @param {(req: Request) => Promise<Response>} webHandler
 * @param {{jsonOnly?: boolean}} [options] `jsonOnly` marks the API prefix,
 *   which answers a JSON body for every status.
 */
function registerRoute(ctx, webServer, path, webHandler, options = {}) {
  const jsonOnly = options.jsonOnly === true;
  webServer.register({
    kind: 'prefix',
    path,
    async handler(req, res) {
      if (gateRejects(ctx, req, res, jsonOnly)) return;
      const request = await toWebRequest(req);
      const response = await webHandler(request);
      await sendWebResponse(res, response);
    },
  });
  console.log(`${LOG_PREFIX} registered prefix route ${path}`);
}

/**
 * Build the two route handlers and register them on `webServer`.
 * @param {object} ctx
 * @param {object} webServer
 * @param {{createBeastBackend: Function, createStaticHandler: Function}} backendModule
 */
function registerPanel(ctx, webServer, backendModule) {
  const { createBeastBackend, createStaticHandler } = backendModule;

  // Read the registry at request time, never at load time, so a workspace
  // a user adds later appears with no restart.
  const getWorkspaces = () => {
    const workspaceRegistry = ctx.get('workspaceRegistry');
    return workspaceRegistry ? workspaceRegistry.list() : [];
  };

  const projects = createWorkspaceProvider(getWorkspaces);
  const logger = createLogger();
  const backend = createBeastBackend({ context: { projects, logger }, worktrees: false });
  const staticHandler = createStaticHandler({ root: SPA_ROOT });

  const panelIndex = () => buildPanelIndex(getWorkspaces(), existsSync);
  const apiHandler = createApiHandler({ backend, panelIndex });
  const uiHandler = createUiHandler({ staticHandler, prefix: UI_PREFIX });

  // Both prefixes take the gate. The iframe loads inside the authenticated
  // dsh page, on the same origin, so the session cookie travels with the SPA
  // document and with every asset of it.
  registerRoute(ctx, webServer, API_PREFIX, apiHandler, { jsonOnly: true });
  registerRoute(ctx, webServer, UI_PREFIX, uiHandler);
}

/**
 * Resolve `webServer`, import the API bundle, then register both routes.
 *
 * The order matters. A headless profile holds no `webServer`, the retry loop
 * gives up, and this function returns before the dynamic import runs. That
 * profile therefore never parses the 194 kB API bundle, and it never builds
 * the backend.
 *
 * @param {{get: (name: string) => unknown}} ctx
 * @param {{intervalMs?: number, limit?: number, loadBackend?: () => Promise<object | null>}} [options]
 *   A test hook. The dsh path passes no options.
 */
async function start(ctx, options = {}) {
  const loadBackend = options.loadBackend ?? loadBackendModule;

  const webServer = await resolveWebServer(ctx, options);
  if (webServer === null) return;

  const backendModule = await loadBackend();
  if (backendModule === null) return;

  registerPanel(ctx, webServer, backendModule);
}

/**
 * Cordis plugin entry. Never throws — every failure path logs one line and
 * stops, so a broken panel never blocks dsh startup.
 * @param {object} ctx
 */
export function apply(ctx) {
  start(ctx).catch((error) => {
    console.error(`${LOG_PREFIX} the panel plugin failed to start`, error);
  });
}

/**
 * An internal export for the test suite only. No dsh path reads it, and the
 * Cordis loader ignores an export that it does not know. `dsh/test/panel.test.js`
 * drives `resolveWebServer` with a short interval and a small limit, so the
 * test proves the `unref` rule in under one second. The same file drives
 * `registerRoute` and `gateRejects` with a fake connection service, so the
 * test proves the gate of CR-25 with no dsh process.
 */
export const __testing = {
  CONNECTION_SERVICE,
  RETRY_INTERVAL_MS,
  RETRY_LIMIT,
  gateRejects,
  registerPanel,
  registerRoute,
  resolveWebServer,
  start,
};
