import React from "react";
import ReactDOM from "react-dom/client";
import {
  BeastWebProvider,
  BeastWebApp,
  type AuthAdapter,
  type WebUser,
} from "@beast-mode/web/frontend";
import "@beast-mode/web/styles.css";

/**
 * Discord-bridge shell for the reusable @beast-mode/web dashboard.
 *
 * Renders the default <BeastWebApp> from @beast-mode/web/frontend, injecting the
 * bot's Discord OAuth2 auth wiring so login / logout / 401 behavior is
 * byte-identical to the pre-extraction bot/web app (old lib/auth.tsx + lib/api.ts):
 *   - getUser()      → GET  /auth/me   (same-origin cookie session; the provider
 *                      then guards on `data.userId`, exactly as the old
 *                      AuthProvider did)
 *   - login()        → redirect to /auth/login (Discord OAuth2)
 *   - logout()       → POST /auth/logout, then redirect to /auth/login
 *   - onUnauthorized → a 401 from the API client redirects to /auth/login
 *                      (the old apiFetch's `window.location.href` on 401)
 *
 * baseUrl="" keeps every API request same-origin, exactly as today.
 */
const discordAuthAdapter: AuthAdapter = {
  async getUser(): Promise<WebUser | null> {
    const res = await fetch("/auth/me", { credentials: "same-origin" });
    if (!res.ok) return null;
    return (await res.json()) as WebUser;
  },
  login() {
    window.location.href = "/auth/login";
  },
  async logout() {
    await fetch("/auth/logout", { method: "POST", credentials: "same-origin" });
    window.location.href = "/auth/login";
  },
};

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BeastWebProvider
      baseUrl=""
      auth={discordAuthAdapter}
      onUnauthorized={() => {
        window.location.href = "/auth/login";
      }}
    >
      <BeastWebApp />
    </BeastWebProvider>
  </React.StrictMode>
);
