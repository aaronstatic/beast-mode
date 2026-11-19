/**
 * The Node-to-Web adapter for the dsh web panel.
 *
 * `webServer.register` hands a route a Node-style handler,
 * `(req, res)`. The Beast Mode handlers are Web standard, `Request` to
 * `Response`. This module holds the small adapter between the two, plus
 * the API path rewrite and the two route handlers.
 *
 * Every function here is plain ESM and imports Node built-in modules only.
 *
 * @module beast-mode/dsh/panel-http
 */

import { Buffer } from 'node:buffer';

/** The prefix the API route is registered under. No trailing slash. */
const API_PREFIX = '/beast/api';

/** The exact path that answers the host index, with no backend call. */
const PANEL_INDEX_PATH = '/beast/api/panel';

/** Build one JSON `Response`. */
function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

/** Read a Node request body into one `Uint8Array`. Rejects on a stream error. */
function bufferBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(new Uint8Array(Buffer.concat(chunks))));
    req.on('error', reject);
  });
}

/**
 * Turn a Node `IncomingMessage` into a Web standard `Request`.
 *
 * `GET` and `HEAD` carry no body. Every other method buffers the stream
 * into one `Uint8Array`. Every `req.headers` entry is copied; an array
 * value is joined with `, `.
 * @param {import('node:http').IncomingMessage} req
 * @returns {Promise<Request>}
 */
export async function toWebRequest(req) {
  const host = req.headers.host ?? 'localhost';
  const url = new URL(req.url, `http://${host}`);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    headers.set(key, Array.isArray(value) ? value.join(', ') : value);
  }
  const method = req.method ?? 'GET';
  const hasBody = method !== 'GET' && method !== 'HEAD';
  const body = hasBody ? await bufferBody(req) : undefined;
  return new Request(url, { method, headers, body });
}

/**
 * Write a Web standard `Response` onto a Node `ServerResponse`.
 * @param {import('node:http').ServerResponse} res
 * @param {Response} response
 */
export async function sendWebResponse(res, response) {
  const headers = {};
  for (const [key, value] of response.headers.entries()) {
    headers[key] = value;
  }
  res.writeHead(response.status, headers);
  const buffer = Buffer.from(await response.arrayBuffer());
  res.end(buffer);
}

/**
 * Map `/beast/api/<rest>` to `/api/<rest>`.
 *
 * Returns null for a pathname outside the `/beast/api` prefix, and for a
 * pathname that holds a `..` segment once decoded.
 * @param {string} pathname
 * @returns {string | null}
 */
export function rewriteApiPath(pathname) {
  if (typeof pathname !== 'string' || !pathname.startsWith(API_PREFIX)) return null;
  const rest = pathname.slice(API_PREFIX.length);
  if (rest.length > 0 && !rest.startsWith('/')) return null;

  let decoded;
  try {
    decoded = decodeURIComponent(rest);
  } catch {
    return null;
  }
  const segments = decoded.split('/');
  if (segments.some((segment) => segment === '..')) return null;

  return `/api${rest}`;
}

/**
 * Build the `/beast/api/` route handler.
 *
 * `/beast/api/panel` answers `panelIndex()` with no backend call. Every
 * other path is rewritten and passed to `backend.handle(request, url)`. A
 * `null` result from `backend.handle` gives a 404 JSON body, a bad path
 * gives a 400 JSON body, and a throw gives a 500 JSON body and one log
 * line. The API prefix never returns HTML.
 * @param {{backend: {handle: (req: Request, url: URL) => Promise<Response | null>}, panelIndex: () => (object | Promise<object>)}} options
 * @returns {(req: Request) => Promise<Response>}
 */
export function createApiHandler({ backend, panelIndex }) {
  return async function handleApi(req) {
    try {
      const url = new URL(req.url);

      if (url.pathname === PANEL_INDEX_PATH) {
        const index = await panelIndex();
        return jsonResponse(index, 200);
      }

      const targetPath = rewriteApiPath(url.pathname);
      if (targetPath === null) {
        return jsonResponse({ error: 'Bad request' }, 400);
      }

      const rewrittenUrl = new URL(url);
      rewrittenUrl.pathname = targetPath;
      const response = await backend.handle(req, rewrittenUrl);
      if (response === null) {
        return jsonResponse({ error: 'Not found' }, 404);
      }
      return response;
    } catch (error) {
      console.error('[beast-mode-panel] the api handler failed', error);
      return jsonResponse({ error: 'Internal error' }, 500);
    }
  };
}

/**
 * Build the `/beast/ui/` route handler.
 *
 * Strips the prefix from the request URL and delegates to the static
 * handler. A throw gives a 500 JSON body and one log line.
 * @param {{staticHandler: (req: Request) => Promise<Response>, prefix: string}} options
 * @returns {(req: Request) => Promise<Response>}
 */
export function createUiHandler({ staticHandler, prefix }) {
  return async function handleUi(req) {
    try {
      const url = new URL(req.url);
      const stripped = url.pathname.slice(prefix.length);
      const rewrittenUrl = new URL(url);
      rewrittenUrl.pathname = stripped.startsWith('/') ? stripped : `/${stripped}`;
      const rewrittenRequest = new Request(rewrittenUrl, req);
      return await staticHandler(rewrittenRequest);
    } catch (error) {
      console.error('[beast-mode-panel] the ui handler failed', error);
      return jsonResponse({ error: 'Internal error' }, 500);
    }
  };
}
