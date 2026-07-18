// Wires the Discord bot's registry + logger into the reusable @beast-mode/web
// backend. Builds a ProjectProvider over registry.ts (mapping each rich
// ProjectEntry down to the lib's secret-free ProjectRef, with hmacSecret
// stripped) and constructs the backend handle once, reused for every request.
//
// AUTH: intentionally NOT injected here. bot.ts keeps its existing /api/* gate
// (requireApiKeyOrAuth — cookie session OR Bearer API key) exactly as before, so
// behavior is byte-identical to the pre-extraction bot. Per implementation.md D7
// the Discord OAuth2 flow (/auth/*) stays entirely bot-owned; and per the Phase 2
// note an injected AuthMiddleware would have to early-return null for non-/api/*
// paths (this handler is called for every request, before the SPA serve) —
// keeping the bot's own path-scoped gate is the simplest zero-regression path.

import {
  createBeastBackend,
  type BeastBackendHandle,
  type ProjectProvider,
  type ProjectRef,
} from "@beast-mode/web/backend";
import { getAllProjects, getProject, resolveProjectPath } from "./registry.ts";
import { botLog } from "./logger.ts";
import type { Config, ProjectEntry } from "./types.ts";

// Map a registry ProjectEntry down to the lib's secret-free ProjectRef.
// hmacSecret is deliberately never copied across the boundary — it must never
// reach a web response (defense in depth; the lib also strips defensively).
function toProjectRef(entry: ProjectEntry): ProjectRef {
  return {
    name: entry.name,
    path: entry.path,
    port: entry.port,
    host: entry.host,
    status: entry.status,
    lastSeen: entry.lastSeen,
  };
}

/**
 * Build the @beast-mode/web backend handle for the Discord bot.
 *
 * The provider reads from the bot's module-global registry; `resolvePath` closes
 * over the bot's `config.pathMappings` via the registry's `resolveProjectPath`,
 * preserving today's path-override behavior exactly. Construct once per server
 * start and reuse the returned handle for every request.
 */
export function createBotBackend(config: Config): BeastBackendHandle {
  const projects: ProjectProvider = {
    getAll: () => getAllProjects().map(toProjectRef),
    get: (name) => {
      const entry = getProject(name);
      return entry ? toProjectRef(entry) : undefined;
    },
    // resolveProjectPath reads only `.name` and `.path` (both present on
    // ProjectRef) and applies config.pathMappings; the ref always originates
    // from getAll()/get() above (i.e. the registry), so the cast is safe and the
    // result is byte-identical to the pre-extraction resolveProjectPath(entry).
    resolvePath: (project) =>
      resolveProjectPath(project as unknown as ProjectEntry, config),
  };

  return createBeastBackend({
    context: { projects, logger: botLog },
  });
}
