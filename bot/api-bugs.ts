// API routes for /api/bugs/*
// Bug tracker CRUD: list, detail, create, update.

import { join, resolve } from "path";
import { jsonResponse, errorResponse, parseBody, getPathSegments } from "./http-helpers.ts";
import { getProject, resolveProjectPath } from "./registry.ts";
import {
  parseBugFile,
  writeBugFile,
  nextBugId,
  listBugs,
  ensureBugsDir,
} from "./bug-store.ts";
import type { Bug } from "./bug-store.ts";
import type { Config } from "./types.ts";
import { CreateBugPayloadSchema, UpdateBugPayloadSchema } from "./types.ts";

// Path traversal guard.

function isPathSafe(base: string, ...segments: string[]): boolean {
  const resolved = resolve(join(base, ...segments));
  return resolved.startsWith(resolve(base));
}

export async function handleApiBugsRoutes(
  req: Request,
  url: URL,
  config: Config
): Promise<Response | null> {
  if (!url.pathname.startsWith("/api/bugs")) return null;

  const segments = getPathSegments(url, "/api/bugs");

  // All routes need at least a project name
  if (segments.length === 0) return null;

  const projectName = segments[0];
  const project = getProject(projectName);
  if (!project) return errorResponse("Project not found", 404);

  const localPath = resolveProjectPath(project, config);
  const bugsDir = join(localPath, "docs", "bugs");

  // GET /api/bugs/:project/unlinked — bugs without a linked feature
  if (req.method === "GET" && segments.length === 2 && segments[1] === "unlinked") {
    const bugs = listBugs(bugsDir);
    const unlinked = bugs.filter((b) => !b.frontmatter.linkedFeature);
    return jsonResponse(
      unlinked.map((b) => ({ ...b.frontmatter, body: b.body }))
    );
  }

  // GET /api/bugs/:project — list bugs with optional filters
  if (req.method === "GET" && segments.length === 1) {
    const status = url.searchParams.get("status") || undefined;
    const priority = url.searchParams.get("priority") || undefined;
    const linkedFeature = url.searchParams.get("linkedFeature") || undefined;

    const bugs = listBugs(bugsDir, { status, priority, linkedFeature });
    return jsonResponse(
      bugs.map((b) => ({ ...b.frontmatter, body: b.body }))
    );
  }

  // POST /api/bugs/:project — create a new bug
  if (req.method === "POST" && segments.length === 1) {
    const parsed = await parseBody(req, CreateBugPayloadSchema);
    if (!parsed.ok) return parsed.response;

    const { title, description, priority, linkedFeature } = parsed.data;

    try {
      ensureBugsDir(bugsDir);
      const id = nextBugId(bugsDir);
      const now = new Date().toISOString();

      const bug: Bug = {
        frontmatter: {
          id,
          title,
          status: "open",
          priority,
          createdAt: now,
          updatedAt: now,
        },
        body: description,
      };

      if (linkedFeature) {
        bug.frontmatter.linkedFeature = linkedFeature;
      }

      const filePath = join(bugsDir, `${id}.md`);
      writeBugFile(filePath, bug);

      return jsonResponse({ ok: true, id, bug: { ...bug.frontmatter, body: bug.body } });
    } catch (err) {
      return errorResponse(`Failed to create bug: ${String(err)}`, 500);
    }
  }

  // GET /api/bugs/:project/:id — get a single bug
  if (req.method === "GET" && segments.length === 2) {
    const bugId = segments[1];

    if (!isPathSafe(bugsDir, `${bugId}.md`)) {
      return errorResponse("Invalid path", 400);
    }

    const filePath = join(bugsDir, `${bugId}.md`);
    const bug = parseBugFile(filePath);
    if (!bug) return errorResponse("Bug not found", 404);

    return jsonResponse({ ...bug.frontmatter, body: bug.body });
  }

  // PATCH /api/bugs/:project/:id — update a bug
  if (req.method === "PATCH" && segments.length === 2) {
    const bugId = segments[1];

    if (!isPathSafe(bugsDir, `${bugId}.md`)) {
      return errorResponse("Invalid path", 400);
    }

    const filePath = join(bugsDir, `${bugId}.md`);
    const existing = parseBugFile(filePath);
    if (!existing) return errorResponse("Bug not found", 404);

    const parsed = await parseBody(req, UpdateBugPayloadSchema);
    if (!parsed.ok) return parsed.response;

    const updates = parsed.data;

    // Merge updates into existing frontmatter
    if (updates.title !== undefined) existing.frontmatter.title = updates.title;
    if (updates.status !== undefined) existing.frontmatter.status = updates.status;
    if (updates.priority !== undefined) existing.frontmatter.priority = updates.priority;
    if (updates.linkedFeature !== undefined) existing.frontmatter.linkedFeature = updates.linkedFeature;
    if (updates.description !== undefined) existing.body = updates.description;

    existing.frontmatter.updatedAt = new Date().toISOString();

    try {
      writeBugFile(filePath, existing);
      return jsonResponse({ ...existing.frontmatter, body: existing.body });
    } catch (err) {
      return errorResponse(`Failed to update bug: ${String(err)}`, 500);
    }
  }

  return null;
}
