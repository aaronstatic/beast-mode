// HTTP response helpers, body parsing, and CORS utilities.
// Extracted from bot.ts so route modules can share them.

// JSON response helper

export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ error: message }, status);
}

// Parse and validate JSON body with a Zod schema

export async function parseBody<T>(
  req: Request,
  schema: { safeParse: (val: unknown) => { success: boolean; data?: T; error?: { message: string } } }
): Promise<{ ok: true; data: T } | { ok: false; response: Response }> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return { ok: false, response: errorResponse("Invalid JSON body") };
  }
  const result = schema.safeParse(body);
  if (!result.success) {
    return {
      ok: false,
      response: errorResponse(`Validation error: ${result.error?.message ?? "unknown"}`),
    };
  }
  return { ok: true, data: result.data as T };
}

// CORS helpers

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export function withCors(response: Response): Response {
  const newHeaders = new Headers(response.headers);
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    newHeaders.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}

export function corsPreflightResponse(): Response {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

// Private/local IP detection — used to restrict internal routes to local network only

const INTERNAL_ROUTES = new Set([
  "/register",
  "/unregister",
  "/progress",
  "/reply",
  "/ask",
  "/error",
  "/permission-request",
  "/command-complete",
  "/next-port",
]);

function isPrivateIP(ip: string): boolean {
  if (!ip || ip === "unknown") return false;
  if (ip === "::1") return true;

  // Strip IPv6-mapped IPv4 prefix (Bun returns "::ffff:10.3.1.20" for direct IPv4 connections)
  const normalised = ip.startsWith("::ffff:") ? ip.slice(7) : ip;

  if (normalised === "127.0.0.1") return true;
  // 10.0.0.0/8
  if (normalised.startsWith("10.")) return true;
  // 172.16.0.0/12
  if (normalised.startsWith("172.")) {
    const second = parseInt(normalised.split(".")[1], 10);
    if (second >= 16 && second <= 31) return true;
  }
  // 192.168.0.0/16
  if (normalised.startsWith("192.168.")) return true;
  return false;
}

/**
 * Get the real client IP, considering reverse proxy headers.
 * When behind Caddy, X-Forwarded-For contains the real client IP.
 * For direct connections, use the Bun server's requestIP.
 */
export function getClientIP(req: Request, server: { requestIP(req: Request): { address: string } | null }): string {
  // X-Forwarded-For from Caddy (first entry is the real client)
  const xff = req.headers.get("X-Forwarded-For");
  if (xff) {
    return xff.split(",")[0].trim();
  }
  // X-Real-IP header
  const xri = req.headers.get("X-Real-IP");
  if (xri) return xri.trim();
  // Direct connection IP from Bun
  return server.requestIP(req)?.address ?? "unknown";
}

/**
 * Check if a request to an internal route should be allowed.
 * Returns an error response if blocked, or null if allowed.
 */
export function checkInternalRouteAccess(req: Request, url: URL, server: { requestIP(req: Request): { address: string } | null }): Response | null {
  if (!INTERNAL_ROUTES.has(url.pathname)) return null;

  const clientIP = getClientIP(req, server);
  if (isPrivateIP(clientIP)) return null;

  return errorResponse("Forbidden — internal route not accessible from external networks", 403);
}

// Path segment extraction

export function getPathSegments(url: URL, prefix: string): string[] {
  const path = url.pathname;
  if (!path.startsWith(prefix)) return [];
  const rest = path.slice(prefix.length);
  // Remove leading slash, split, filter empty segments
  return rest.replace(/^\//, "").split("/").filter(Boolean);
}
