// API routes for /api/epics/*
// Epic creation + single-epic rollup read + a thin epic list. Mirrors the
// structure/style of api-features.ts (same getProject/resolveProjectPath,
// getPathSegments, isPathSafe, jsonResponse/errorResponse/parseBody patterns).
//
// An epic is a folder under docs/features/ holding child feature subfolders.
// The web/MCP read path detects an epic via epic-overview.md OR epic-requirements.md
// (a folder created by "Add Epic"/create_epic has only the latter, until
// /plan-epic writes epic-overview.md). See feature-store.ts for the detection
// contract and .claude/epic-resolution.md for the strict CLI marker.

import { existsSync, mkdirSync, writeFileSync, readdirSync } from "fs";
import { join, resolve } from "path";
import { jsonResponse, errorResponse, parseBody, getPathSegments } from "./http-helpers.ts";
import { getProject, resolveProjectPath } from "./registry.ts";
import {
  isEpicDir,
  isEpicMarked,
  getEpicStatus,
  listEpicChildren,
} from "./feature-store.ts";
import { getBugCount } from "./bug-store.ts";
import type { Config } from "./types.ts";
import { CreateEpicPayloadSchema } from "./types.ts";

// Path traversal guard: resolved path must be under base. (Same as api-features.ts.)

function isPathSafe(base: string, ...segments: string[]): boolean {
  const resolved = resolve(join(base, ...segments));
  return resolved.startsWith(resolve(base));
}

// Validate kebab-case name: alphanumeric + hyphens only. (Same as api-features.ts.)
// This also rejects ".", "..", "/", and empty — so an epic name can never be a
// traversal segment.

function isKebabCase(name: string): boolean {
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(name);
}

// Humanize a kebab-case name: "my-epic" → "My Epic". (Same as api-features.ts.)

function humanize(name: string): string {
  return name
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

// A :epic path segment must be a single safe directory name (no traversal).

function isSafeEpicSegment(name: string): boolean {
  return name !== "" && name !== "." && name !== ".." && !name.includes("/");
}

export async function handleApiEpicsRoutes(
  req: Request,
  url: URL,
  config: Config
): Promise<Response | null> {
  if (!url.pathname.startsWith("/api/epics")) return null;

  const segments = getPathSegments(url, "/api/epics");

  // All routes need at least a project name.
  if (segments.length === 0) return null;

  const projectName = segments[0];
  const project = getProject(projectName);
  if (!project) return errorResponse("Project not found", 404);

  const projectPath = resolveProjectPath(project, config);
  const featuresDir = join(projectPath, "docs", "features");
  const bugsDir = join(projectPath, "docs", "bugs");

  // GET /api/epics/:project — thin list of every epic under docs/features/.
  // (Added in Phase 1 for symmetry with list_features; backs the MCP list_epics
  // tool so the epic list isn't derived client-side.)
  if (req.method === "GET" && segments.length === 1) {
    if (!existsSync(featuresDir)) {
      return jsonResponse({ epics: [] });
    }

    let entries;
    try {
      entries = readdirSync(featuresDir, { withFileTypes: true });
    } catch {
      return jsonResponse({ epics: [] });
    }

    const epics = entries
      .filter((e) => e.isDirectory() && isEpicDir(join(featuresDir, e.name)))
      .map((e) => {
        const epicPath = join(featuresDir, e.name);
        const children = listEpicChildren(epicPath);
        return {
          name: e.name,
          status: getEpicStatus(epicPath),
          childCount: children.length,
          children: children.map((c) => ({
            name: c.name,
            status: c.status,
            completion: c.completion,
            openBugCount: getBugCount(bugsDir, `${e.name}/${c.name}`),
          })),
        };
      });

    return jsonResponse({ epics });
  }

  // POST /api/epics/:project — create an epic folder + epic-requirements.md.
  // Deliberately scaffolds ONLY epic-requirements.md (not epic-overview.md) so the
  // epic stays in the "planning" pre-state until /plan-epic runs.
  if (req.method === "POST" && segments.length === 1) {
    const parsed = await parseBody(req, CreateEpicPayloadSchema);
    if (!parsed.ok) return parsed.response;

    const { name, requirements } = parsed.data;

    if (!isKebabCase(name)) {
      return errorResponse("Epic name must be kebab-case (lowercase alphanumeric + hyphens)", 400);
    }

    // Defense-in-depth: even though isKebabCase already forbids traversal chars,
    // confirm the resolved path stays under docs/features/.
    if (!isPathSafe(projectPath, "docs", "features", name)) {
      return errorResponse("Invalid path", 400);
    }

    const epicPath = join(featuresDir, name);
    if (existsSync(epicPath)) {
      return errorResponse(`Epic "${name}" already exists`, 409);
    }

    try {
      mkdirSync(epicPath, { recursive: true });
      const content = `# ${humanize(name)} — Epic Requirements\n\n${requirements}\n`;
      writeFileSync(join(epicPath, "epic-requirements.md"), content, "utf8");
      return jsonResponse({ ok: true, name });
    } catch (err) {
      return errorResponse(`Failed to create epic: ${String(err)}`, 500);
    }
  }

  // GET /api/epics/:project/:epic — single-epic rollup + children.
  if (req.method === "GET" && segments.length === 2) {
    const epicName = segments[1];

    if (!isSafeEpicSegment(epicName)) {
      return errorResponse("Invalid path", 400);
    }
    if (!isPathSafe(projectPath, "docs", "features", epicName)) {
      return errorResponse("Invalid path", 400);
    }

    const epicPath = join(featuresDir, epicName);

    // 404 unless this is actually an epic dir (marker or requirements present).
    if (!existsSync(epicPath) || !isEpicDir(epicPath)) {
      return errorResponse("Epic not found", 404);
    }

    const hasOverview = isEpicMarked(epicPath);
    const hasRequirements = existsSync(join(epicPath, "epic-requirements.md"));

    const children = listEpicChildren(epicPath).map((c) => ({
      ...c,
      openBugCount: getBugCount(bugsDir, `${epicName}/${c.name}`),
    }));

    return jsonResponse({
      name: epicName,
      status: getEpicStatus(epicPath),
      isPlanning: !hasOverview,
      children,
      hasOverview,
      hasRequirements,
    });
  }

  return null;
}
