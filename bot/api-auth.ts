// Discord OAuth2 auth routes and requireAuth middleware.

import type { Config } from "./types.ts";
import type { Session } from "./sessions.ts";
import { createSession, getSession, deleteSession } from "./sessions.ts";
import { jsonResponse, errorResponse } from "./http-helpers.ts";
import { botLog } from "./logger.ts";

// Read session_id cookie from request, return session or null.

export function requireAuth(req: Request): Session | null {
  const cookieHeader = req.headers.get("Cookie") ?? "";
  const match = cookieHeader.match(/session_id=([^;]+)/);
  if (!match) return null;
  return getSession(match[1]);
}

// Check Bearer API key first, then fall back to cookie-based auth.

export function requireApiKeyOrAuth(req: Request, config: Config): Session | null {
  const authHeader = req.headers.get("Authorization") ?? "";
  if (authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    if (config.apiKeys.length > 0 && config.apiKeys.includes(token)) {
      return {
        userId: "api-key",
        username: "API Key",
        avatar: null,
        expiresAt: Infinity,
      };
    }
  }
  return requireAuth(req);
}

// Auth route handler — handles /auth/* routes.
// Returns a Response if matched, null otherwise.

export async function handleApiAuthRoutes(
  req: Request,
  url: URL,
  config: Config
): Promise<Response | null> {
  // GET /auth/login
  if (req.method === "GET" && url.pathname === "/auth/login") {
    if (!config.clientId || !config.webBaseUrl) {
      return jsonResponse({ error: "OAuth2 not configured" }, 501);
    }

    const redirectUri = encodeURIComponent(
      config.webBaseUrl + "/auth/callback"
    );
    const authUrl =
      `https://discord.com/oauth2/authorize?` +
      `client_id=${config.clientId}` +
      `&redirect_uri=${redirectUri}` +
      `&response_type=code` +
      `&scope=identify`;

    return new Response(null, {
      status: 302,
      headers: { Location: authUrl },
    });
  }

  // GET /auth/callback?code=...
  if (req.method === "GET" && url.pathname === "/auth/callback") {
    if (!config.clientId || !config.clientSecret || !config.webBaseUrl) {
      return jsonResponse({ error: "OAuth2 not configured" }, 501);
    }

    const code = url.searchParams.get("code");
    if (!code) {
      return errorResponse("Missing code parameter", 400);
    }

    const redirectUri = config.webBaseUrl + "/auth/callback";

    // Exchange code for token
    let accessToken: string;
    try {
      const tokenBody = new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
      });

      const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: tokenBody.toString(),
      });

      if (!tokenRes.ok) {
        const errText = await tokenRes.text();
        botLog.error("Discord token exchange failed", {
          status: tokenRes.status,
          body: errText,
        });
        return errorResponse("Failed to exchange code for token", 502);
      }

      const tokenData = (await tokenRes.json()) as { access_token?: string };
      if (!tokenData.access_token) {
        return errorResponse("No access_token in Discord response", 502);
      }
      accessToken = tokenData.access_token;
    } catch (err) {
      botLog.error("Discord token exchange error", { err: String(err) });
      return errorResponse("Failed to exchange code for token", 502);
    }

    // Fetch user info
    let userId: string;
    let username: string;
    let avatar: string | null;
    try {
      const userRes = await fetch("https://discord.com/api/users/@me", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!userRes.ok) {
        const errText = await userRes.text();
        botLog.error("Discord user fetch failed", {
          status: userRes.status,
          body: errText,
        });
        return errorResponse("Failed to fetch Discord user", 502);
      }

      const userData = (await userRes.json()) as {
        id: string;
        username: string;
        avatar: string | null;
      };
      userId = userData.id;
      username = userData.username;
      avatar = userData.avatar;
    } catch (err) {
      botLog.error("Discord user fetch error", { err: String(err) });
      return errorResponse("Failed to fetch Discord user", 502);
    }

    // Check allowedUsers — if the list is not empty, user must be in it
    if (config.allowedUsers.length > 0 && !config.allowedUsers.includes(userId) && !config.adminUsers.includes(userId)) {
      return new Response(
        `<!DOCTYPE html>
<html><head><title>Access Denied</title></head>
<body style="font-family:sans-serif;text-align:center;padding:4rem;">
<h1>Access Denied</h1>
<p>Your Discord account is not authorized.</p>
</body></html>`,
        {
          status: 403,
          headers: { "Content-Type": "text/html" },
        }
      );
    }

    // Create session
    const sessionId = createSession(userId, username, avatar);

    // Build cookie
    let cookie = `session_id=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`;
    if (config.webBaseUrl.startsWith("https://")) {
      cookie += "; Secure";
    }

    botLog.info("User authenticated via OAuth2", { userId, username });

    return new Response(null, {
      status: 302,
      headers: {
        Location: "/",
        "Set-Cookie": cookie,
      },
    });
  }

  // GET /auth/me
  if (req.method === "GET" && url.pathname === "/auth/me") {
    const session = requireAuth(req);
    if (!session) {
      return jsonResponse({ error: "Not authenticated" }, 401);
    }
    return jsonResponse({
      userId: session.userId,
      username: session.username,
      avatar: session.avatar,
    });
  }

  // POST /auth/logout
  if (req.method === "POST" && url.pathname === "/auth/logout") {
    const cookieHeader = req.headers.get("Cookie") ?? "";
    const match = cookieHeader.match(/session_id=([^;]+)/);
    if (match) {
      deleteSession(match[1]);
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": "session_id=; Path=/; HttpOnly; Max-Age=0",
      },
    });
  }

  return null;
}
