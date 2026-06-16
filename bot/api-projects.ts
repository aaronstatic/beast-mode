// API routes for /api/projects/*
// Lists registered projects and serves project-level documentation files.

import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { jsonResponse, errorResponse, getPathSegments } from "./http-helpers.ts";
import { getAllProjects, getProject, resolveProjectPath } from "./registry.ts";
import { parseBugFile } from "./bug-store.ts";
import type { Config, ProjectEntry } from "./types.ts";

// Returns the installed Beast Mode version string, or null if not present.
function getBeastModeVersion(localPath: string): string | null {
  const versionFile = join(localPath, ".claude", ".beast-mode-version");
  if (!existsSync(versionFile)) return null;
  try {
    const v = readFileSync(versionFile, "utf8").trim();
    return v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

// Semver-ish numeric compare. Returns negative / 0 / positive.
// Strips non-numeric suffix from each segment (e.g. "1-beta" → 1).
// Missing segments are treated as 0, so "3.1" == "3.1.0".
// Correctly ranks 3.10.0 > 3.9.0 (numeric, not lexicographic).
function compareVersions(a: string, b: string): number {
  const parseSeg = (s: string) => parseInt(s.replace(/[^0-9].*$/, ""), 10) || 0;
  const aParts = a.split(".").map(parseSeg);
  const bParts = b.split(".").map(parseSeg);
  const len = Math.max(aParts.length, bParts.length);
  for (let i = 0; i < len; i++) {
    const diff = (aParts[i] ?? 0) - (bParts[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

// Returns the highest version string among all registered projects, or null if none have one.
function computeMaxVersion(config: Config): string | null {
  let max: string | null = null;
  for (const entry of getAllProjects()) {
    const localPath = resolveProjectPath(entry, config);
    const v = getBeastModeVersion(localPath);
    if (v !== null) {
      if (max === null || compareVersions(v, max) > 0) max = v;
    }
  }
  return max;
}

type VersionStatus = "current" | "outdated";

function versionStatus(version: string | null, maxVersion: string | null): VersionStatus | null {
  if (version === null || maxVersion === null) return null;
  return compareVersions(version, maxVersion) < 0 ? "outdated" : "current";
}

const ALLOWED_DOCS = ["overview.md", "mission-statement.md", "technical-design.md"];
const WRITABLE_DOCS = ["mission-statement.md", "technical-design.md"];

// Strip hmacSecret and add doc existence flags to a project entry.

function countOpenBugs(bugsDir: string): number {
  if (!existsSync(bugsDir)) return 0;
  const files = readdirSync(bugsDir).filter((f) => f.endsWith(".md"));
  let count = 0;
  for (const file of files) {
    const bug = parseBugFile(join(bugsDir, file));
    if (bug && bug.frontmatter.status !== "closed") count++;
  }
  return count;
}

function enrichProject(entry: ProjectEntry, config: Config, maxVersion: string | null = null) {
  const { hmacSecret: _secret, ...safe } = entry;
  const localPath = resolveProjectPath(entry, config);
  const beastModeVersion = getBeastModeVersion(localPath);
  return {
    ...safe,
    hasOverview: existsSync(join(localPath, "docs", "overview.md")),
    hasMission: existsSync(join(localPath, "docs", "mission-statement.md")),
    hasTechDesign: existsSync(join(localPath, "docs", "technical-design.md")),
    openBugCount: countOpenBugs(join(localPath, "docs", "bugs")),
    beastModeVersion,
    versionStatus: versionStatus(beastModeVersion, maxVersion),
  };
}

export async function handleApiProjectsRoutes(
  req: Request,
  url: URL,
  config: Config
): Promise<Response | null> {
  if (!url.pathname.startsWith("/api/projects")) return null;

  const segments = getPathSegments(url, "/api/projects");

  // GET /api/projects
  if (req.method === "GET" && segments.length === 0) {
    const maxVersion = computeMaxVersion(config);
    const projects = getAllProjects().map((p) => enrichProject(p, config, maxVersion));
    return jsonResponse(projects);
  }

  // GET /api/projects/:name
  if (req.method === "GET" && segments.length === 1) {
    const project = getProject(segments[0]);
    if (!project) return errorResponse("Project not found", 404);
    const maxVersion = computeMaxVersion(config);
    return jsonResponse(enrichProject(project, config, maxVersion));
  }

  // GET /api/projects/:name/doc/:docName
  if (req.method === "GET" && segments.length === 3 && segments[1] === "doc") {
    const projectName = segments[0];
    const docName = segments[2];

    const project = getProject(projectName);
    if (!project) return errorResponse("Project not found", 404);

    if (!ALLOWED_DOCS.includes(docName)) {
      return errorResponse(
        `Document not allowed. Allowed: ${ALLOWED_DOCS.join(", ")}`,
        400
      );
    }

    const localPath = resolveProjectPath(project, config);
    const docPath = join(localPath, "docs", docName);
    if (!existsSync(docPath)) {
      return errorResponse("Document not found", 404);
    }

    try {
      const content = readFileSync(docPath, "utf8");
      return new Response(content, {
        status: 200,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    } catch {
      return errorResponse("Failed to read document", 500);
    }
  }

  // PUT /api/projects/:name/doc/:docName
  if (req.method === "PUT" && segments.length === 3 && segments[1] === "doc") {
    const projectName = segments[0];
    const docName = segments[2];

    const project = getProject(projectName);
    if (!project) return errorResponse("Project not found", 404);

    if (!ALLOWED_DOCS.includes(docName)) {
      return errorResponse(
        `Document not allowed. Allowed: ${ALLOWED_DOCS.join(", ")}`,
        400
      );
    }

    if (docName === "overview.md") {
      return errorResponse("overview.md is read-only", 403);
    }

    if (!WRITABLE_DOCS.includes(docName)) {
      return errorResponse("Document is not writable", 403);
    }

    const body = await req.text();
    const localPath = resolveProjectPath(project, config);
    const docsDir = join(localPath, "docs");
    mkdirSync(docsDir, { recursive: true });
    const docPath = join(docsDir, docName);

    try {
      writeFileSync(docPath, body, "utf8");
      return jsonResponse({ ok: true });
    } catch {
      return errorResponse("Failed to write document", 500);
    }
  }

  return null;
}
