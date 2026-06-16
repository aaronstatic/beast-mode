// Bug file CRUD helpers.
// Reads/writes bug files with YAML frontmatter in docs/bugs/ directories.

import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";

export interface BugFrontmatter {
  id: string;
  title: string;
  status: "open" | "in-progress" | "closed";
  priority: "low" | "medium" | "high" | "critical";
  linkedFeature?: string;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}

export interface Bug {
  frontmatter: BugFrontmatter;
  body: string;
}

// Hand-parse YAML frontmatter: split on "---", parse key: value lines.
// Handles quoted and unquoted values.

function parseYamlValue(raw: string): string {
  const trimmed = raw.trim();
  // Strip surrounding quotes (single or double)
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).replace(/\\"/g, '"');
  }
  return trimmed;
}

export function parseBugFile(filePath: string): Bug | null {
  if (!existsSync(filePath)) return null;

  try {
    const content = readFileSync(filePath, "utf8");
    const lines = content.split("\n");

    // Expect first line to be "---"
    if (lines[0]?.trim() !== "---") return null;

    // Find closing "---"
    let closingIndex = -1;
    for (let i = 1; i < lines.length; i++) {
      if (lines[i]?.trim() === "---") {
        closingIndex = i;
        break;
      }
    }
    if (closingIndex === -1) return null;

    // Parse key: value pairs from frontmatter
    const frontmatterLines = lines.slice(1, closingIndex);
    const kvMap: Record<string, string> = {};
    for (const line of frontmatterLines) {
      const colonIndex = line.indexOf(":");
      if (colonIndex === -1) continue;
      const key = line.slice(0, colonIndex).trim();
      const value = line.slice(colonIndex + 1).trim();
      if (key && value) {
        kvMap[key] = parseYamlValue(value);
      }
    }

    // Validate required fields
    if (!kvMap.id || !kvMap.title || !kvMap.status || !kvMap.priority) {
      return null;
    }

    const frontmatter: BugFrontmatter = {
      id: kvMap.id,
      title: kvMap.title,
      status: kvMap.status as BugFrontmatter["status"],
      priority: kvMap.priority as BugFrontmatter["priority"],
      createdAt: kvMap.createdAt || new Date().toISOString(),
      updatedAt: kvMap.updatedAt || new Date().toISOString(),
    };

    if (kvMap.linkedFeature) {
      frontmatter.linkedFeature = kvMap.linkedFeature;
    }

    // Body is everything after the closing ---
    const body = lines.slice(closingIndex + 1).join("\n").trim();

    return { frontmatter, body };
  } catch {
    return null;
  }
}

// Write frontmatter block + body. Preserves field order:
// id, title, status, priority, linkedFeature, createdAt, updatedAt

export function writeBugFile(filePath: string, bug: Bug): void {
  const fm = bug.frontmatter;
  const lines: string[] = ["---"];
  lines.push(`id: ${fm.id}`);
  lines.push(`title: "${fm.title.replace(/"/g, '\\"')}"`);
  lines.push(`status: ${fm.status}`);
  lines.push(`priority: ${fm.priority}`);
  if (fm.linkedFeature) {
    lines.push(`linkedFeature: ${fm.linkedFeature}`);
  }
  lines.push(`createdAt: ${fm.createdAt}`);
  lines.push(`updatedAt: ${fm.updatedAt}`);
  lines.push("---");
  lines.push("");
  lines.push(bug.body);
  lines.push(""); // trailing newline

  writeFileSync(filePath, lines.join("\n"), "utf8");
}

// Scan directory for BUG-NNN.md files, find highest N, return "BUG-{N+1}" zero-padded to 3 digits.
// If no bugs exist, return "BUG-001".

export function nextBugId(bugsDir: string): string {
  if (!existsSync(bugsDir)) return "BUG-001";

  const files = readdirSync(bugsDir);
  let maxN = 0;

  for (const file of files) {
    const match = file.match(/^BUG-(\d+)\.md$/);
    if (match) {
      const n = parseInt(match[1], 10);
      if (n > maxN) maxN = n;
    }
  }

  const next = maxN + 1;
  return `BUG-${String(next).padStart(3, "0")}`;
}

// List all bugs, optionally filtered. Sort by updatedAt descending.

export function listBugs(
  bugsDir: string,
  filters?: { status?: string; priority?: string; linkedFeature?: string }
): Bug[] {
  if (!existsSync(bugsDir)) return [];

  const files = readdirSync(bugsDir).filter((f) => f.endsWith(".md"));
  const bugs: Bug[] = [];

  for (const file of files) {
    const bug = parseBugFile(join(bugsDir, file));
    if (!bug) continue;

    // Apply filters
    if (filters?.status && bug.frontmatter.status !== filters.status) continue;
    if (filters?.priority && bug.frontmatter.priority !== filters.priority) continue;
    if (filters?.linkedFeature && bug.frontmatter.linkedFeature !== filters.linkedFeature) continue;

    bugs.push(bug);
  }

  // Sort by updatedAt descending
  bugs.sort((a, b) => {
    const dateA = new Date(a.frontmatter.updatedAt).getTime() || 0;
    const dateB = new Date(b.frontmatter.updatedAt).getTime() || 0;
    return dateB - dateA;
  });

  return bugs;
}

// Count open bugs linked to a specific feature.

export function getBugCount(bugsDir: string, linkedFeature: string): number {
  if (!existsSync(bugsDir)) return 0;

  const files = readdirSync(bugsDir).filter((f) => f.endsWith(".md"));
  let count = 0;

  for (const file of files) {
    const bug = parseBugFile(join(bugsDir, file));
    if (!bug) continue;
    if (
      bug.frontmatter.linkedFeature === linkedFeature &&
      bug.frontmatter.status !== "closed"
    ) {
      count++;
    }
  }

  return count;
}

// Count open bugs belonging to an epic (Model A): a bug is "in epic X" when its
// linkedFeature is the bare epic name OR a nested feature under it
// (`linkedFeature === epicName || linkedFeature.startsWith(epicName + "/")`).
// The trailing "/" boundary is load-bearing: epic `web` must NOT match a sibling
// feature named `web-app` (which would happen with a naive startsWith(epicName)).

export function getBugCountForEpic(bugsDir: string, epicName: string): number {
  if (!existsSync(bugsDir)) return 0;

  const files = readdirSync(bugsDir).filter((f) => f.endsWith(".md"));
  const prefix = `${epicName}/`;
  let count = 0;

  for (const file of files) {
    const bug = parseBugFile(join(bugsDir, file));
    if (!bug) continue;
    const linked = bug.frontmatter.linkedFeature;
    if (!linked) continue;
    if (
      (linked === epicName || linked.startsWith(prefix)) &&
      bug.frontmatter.status !== "closed"
    ) {
      count++;
    }
  }

  return count;
}

// Ensure the bugs directory exists.

export function ensureBugsDir(bugsDir: string): void {
  if (!existsSync(bugsDir)) {
    mkdirSync(bugsDir, { recursive: true });
  }
}
