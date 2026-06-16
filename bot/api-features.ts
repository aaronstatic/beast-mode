// API routes for /api/features/*
// Lists features, reads/writes feature doc files, creates new features.

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "fs";
import { join, resolve } from "path";
import { jsonResponse, errorResponse, parseBody, getPathSegments } from "./http-helpers.ts";
import { getProject, resolveProjectPath } from "./registry.ts";
import { listFeatures, getFeatureStatus, getTaskCompletion, getFeatureDescription, getFeaturePhases, isEpicDir } from "./feature-store.ts";
import { getBugCount, getBugCountForEpic } from "./bug-store.ts";
import type { Config } from "./types.ts";
import { CreateFeaturePayloadSchema } from "./types.ts";

// Path traversal guard: resolved path must be under base.

function isPathSafe(base: string, ...segments: string[]): boolean {
  const resolved = resolve(join(base, ...segments));
  return resolved.startsWith(resolve(base));
}

// Parse the segments after :project into a feature reference (1–2 segments, e.g.
// "user-auth" or "epics/core") and an optional .md file. The feature ref is the
// run of path segments that is NOT the trailing .md file:
//   - read/write: last segment ends in ".md" → file = last, ref = the rest
//   - detail:     no trailing .md file        → ref = all segments
// Returns an error Response when the shape is invalid. The ref is capped at TWO
// segments because epics are flat (<epic>/<feature> is the deepest path), and any
// "."/".."/empty segment is rejected BEFORE resolution — so a traversing or
// over-deep ref can never reach isPathSafe / the filesystem.

type ParsedFeatureRef = { refSegments: string[]; fileName: string | null };

function parseFeatureRef(
  rest: string[]
): { ok: true; value: ParsedFeatureRef } | { ok: false; response: Response } {
  // Split off a trailing .md file from the feature-ref segments.
  let refSegments: string[];
  let fileName: string | null;
  const last = rest[rest.length - 1];
  if (last !== undefined && last.endsWith(".md")) {
    fileName = last;
    refSegments = rest.slice(0, -1);
  } else {
    fileName = null;
    refSegments = rest;
  }

  // Feature ref must be 1 or 2 segments: <feature> or <epic>/<feature>.
  // 0 (e.g. a bare ".../foo.md" with no feature) or >2 (deeper than flat epics)
  // is rejected as a bad path.
  if (refSegments.length < 1 || refSegments.length > 2) {
    return { ok: false, response: errorResponse("Invalid path", 400) };
  }

  // Reject traversal / empty segments before any resolution.
  for (const seg of refSegments) {
    if (seg === "" || seg === "." || seg === "..") {
      return { ok: false, response: errorResponse("Invalid path", 400) };
    }
  }

  return { ok: true, value: { refSegments, fileName } };
}

// Validate kebab-case name: alphanumeric + hyphens only.

function isKebabCase(name: string): boolean {
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(name);
}

// Humanize a kebab-case name: "my-feature" → "My Feature"

function humanize(name: string): string {
  return name
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export async function handleApiFeaturesRoutes(
  req: Request,
  url: URL,
  config: Config
): Promise<Response | null> {
  if (!url.pathname.startsWith("/api/features")) return null;

  const segments = getPathSegments(url, "/api/features");

  // All routes need at least a project name
  if (segments.length === 0) return null;

  const projectName = segments[0];
  const project = getProject(projectName);
  if (!project) return errorResponse("Project not found", 404);

  const projectPath = resolveProjectPath(project, config);
  const featuresDir = join(projectPath, "docs", "features");
  const bugsDir = join(projectPath, "docs", "bugs");

  // GET /api/features/:project — list all features
  if (req.method === "GET" && segments.length === 1) {
    if (!existsSync(projectPath)) {
      return jsonResponse({ features: [], pathAccessible: false });
    }
    const features = listFeatures(projectPath);
    const result = features.map((f) => {
      // Epic: roll up its bug count across the epic + its nested features, and
      // enumerate children (each child carrying its own exact-match bug count).
      if (f.isEpic) {
        return {
          name: f.name,
          status: f.status,
          completion: f.completion,
          files: f.files,
          isEpic: true,
          openBugCount: getBugCountForEpic(bugsDir, f.name),
          children: (f.children ?? []).map((c) => ({
            name: c.name,
            status: c.status,
            completion: c.completion,
            files: c.files,
            isEpic: false,
            openBugCount: getBugCount(bugsDir, `${f.name}/${c.name}`),
          })),
        };
      }
      // Plain feature: unchanged shape plus the additive isEpic flag.
      return {
        name: f.name,
        status: f.status,
        completion: f.completion,
        files: f.files,
        isEpic: false,
        openBugCount: getBugCount(bugsDir, f.name),
      };
    });
    return jsonResponse({ features: result, pathAccessible: true });
  }

  // POST /api/features/:project — create a new feature. When `epic` is set in the
  // body the feature is created INSIDE that epic at docs/features/<epic>/<name>
  // (the epic must already exist); otherwise it is a top-level feature. Either way
  // only requirements.md is seeded, so the new feature starts in "planning".
  if (req.method === "POST" && segments.length === 1) {
    const parsed = await parseBody(req, CreateFeaturePayloadSchema);
    if (!parsed.ok) return parsed.response;

    const { name, requirements, epic } = parsed.data;

    if (!isKebabCase(name)) {
      return errorResponse("Feature name must be kebab-case (lowercase alphanumeric + hyphens)", 400);
    }

    // Feature ref segments: [<epic>, <name>] when nested, else [<name>].
    const refSegments = epic ? [epic, name] : [name];

    if (epic) {
      if (!isKebabCase(epic)) {
        return errorResponse("Epic name must be kebab-case (lowercase alphanumeric + hyphens)", 400);
      }
      // The epic must already exist and actually be an epic folder.
      const epicPath = join(featuresDir, epic);
      if (
        !isPathSafe(projectPath, "docs", "features", epic) ||
        !existsSync(epicPath) ||
        !isEpicDir(epicPath)
      ) {
        return errorResponse(`Epic "${epic}" not found`, 404);
      }
    }

    // Guard the fully-resolved feature directory path (epic + feature segments).
    if (!isPathSafe(projectPath, "docs", "features", ...refSegments)) {
      return errorResponse("Invalid path", 400);
    }

    const featurePath = join(featuresDir, ...refSegments);
    if (existsSync(featurePath)) {
      return errorResponse(`Feature "${refSegments.join("/")}" already exists`, 409);
    }

    try {
      mkdirSync(featurePath, { recursive: true });
      const content = `# ${humanize(name)} — Requirements\n\n${requirements}\n`;
      writeFileSync(join(featurePath, "requirements.md"), content, "utf8");
      return jsonResponse({ ok: true, name, ...(epic ? { epic } : {}) });
    } catch (err) {
      return errorResponse(`Failed to create feature: ${String(err)}`, 500);
    }
  }

  // The remaining routes address a feature by reference, which may be a plain
  // feature ("user-auth") or a feature inside an epic ("epics/core"). They share
  // one parser so the path-traversal guard is applied identically:
  //   GET  .../<feature-ref>            → feature detail   (no trailing .md)
  //   GET  .../<feature-ref>/<file>.md  → read a doc file
  //   PUT  .../<feature-ref>/<file>.md  → write a doc file
  // <feature-ref> is 1–2 segments (epics are flat); see parseFeatureRef.

  if (
    segments.length >= 2 &&
    (req.method === "GET" || req.method === "PUT")
  ) {
    const parsedRef = parseFeatureRef(segments.slice(1));
    if (!parsedRef.ok) return parsedRef.response;
    const { refSegments, fileName } = parsedRef.value;

    // GET /api/features/:project/<feature-ref> — feature detail (no file).
    if (req.method === "GET" && fileName === null) {
      // Guard the fully-resolved feature directory path.
      if (!isPathSafe(projectPath, "docs", "features", ...refSegments)) {
        return errorResponse("Invalid path", 400);
      }

      const featurePath = join(featuresDir, ...refSegments);
      if (!existsSync(featurePath)) {
        return errorResponse("Feature not found", 404);
      }

      const status = getFeatureStatus(featurePath);
      const completion = status === "in-progress"
        ? getTaskCompletion(join(featurePath, "tasks.md"))
        : null;

      const files = readdirSync(featurePath)
        .filter((f) => {
          try {
            return statSync(join(featurePath, f)).isFile();
          } catch {
            return false;
          }
        });

      const description = getFeatureDescription(featurePath);
      const phases = getFeaturePhases(featurePath);

      return jsonResponse({
        name: refSegments.join("/"),
        status,
        completion,
        files,
        description,
        phases,
      });
    }

    // GET/PUT /api/features/:project/<feature-ref>/<file>.md — read/write a file.
    if (fileName !== null) {
      // Defense-in-depth: parseFeatureRef already required a .md suffix to treat
      // the last segment as a file, but keep the explicit check.
      if (!fileName.endsWith(".md")) {
        return errorResponse("Only .md files are allowed", 400);
      }

      // Guard the fully-resolved file path (every ref segment + the file).
      if (!isPathSafe(projectPath, "docs", "features", ...refSegments, fileName)) {
        return errorResponse("Invalid path", 400);
      }

      const dirPath = join(featuresDir, ...refSegments);

      if (req.method === "GET") {
        const filePath = join(dirPath, fileName);
        if (!existsSync(filePath)) {
          return errorResponse("File not found", 404);
        }
        try {
          const content = readFileSync(filePath, "utf8");
          return new Response(content, {
            status: 200,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          });
        } catch {
          return errorResponse("Failed to read file", 500);
        }
      }

      // PUT — write the file.
      try {
        const content = await req.text();
        mkdirSync(dirPath, { recursive: true });
        writeFileSync(join(dirPath, fileName), content, "utf8");
        return jsonResponse({ ok: true });
      } catch (err) {
        return errorResponse(`Failed to write file: ${String(err)}`, 500);
      }
    }
  }

  return null;
}
