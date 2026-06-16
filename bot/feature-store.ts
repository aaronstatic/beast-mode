// Feature status derivation helpers.
// Scans docs/features/ directories and derives status from file presence.

import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";

export type FeatureStatus = "planning" | "planned" | "in-progress" | "complete";

export interface FeatureInfo {
  name: string;
  status: FeatureStatus;
  completion: number | null; // percentage, only for in-progress
  files: string[]; // filenames in the feature dir
  isEpic: boolean; // true if this dir is an epic (has epic-overview.md or epic-requirements.md)
  children?: FeatureInfo[]; // only present for epics: the epic's child feature subfolders
}

// Derive status from file presence:
// - "planning"    = has requirements.md but no implementation.md
// - "planned"     = has implementation.md but no context.md or tasks.md
// - "in-progress" = has context.md AND tasks.md
// - "complete"    = tasks.md header contains "100%"

export function getFeatureStatus(featurePath: string): FeatureStatus {
  const hasImplementation = existsSync(join(featurePath, "implementation.md"));
  const hasContext = existsSync(join(featurePath, "context.md"));
  const hasTasks = existsSync(join(featurePath, "tasks.md"));

  if (hasTasks) {
    const completion = getTaskCompletion(join(featurePath, "tasks.md"));
    if (completion === 100) {
      return "complete";
    }
  }

  if (hasContext && hasTasks) {
    return "in-progress";
  }

  if (hasImplementation) {
    return "planned";
  }

  return "planning";
}

// Parses the Progress line in tasks.md header.
// Looks for patterns like:
//   "Progress: 38/38 (100%)"  → 100
//   "**Progress:** 11/52 tasks complete (21%)"  → 21
// Returns null if can't parse.

export function getTaskCompletion(tasksPath: string): number | null {
  if (!existsSync(tasksPath)) return null;

  try {
    const content = readFileSync(tasksPath, "utf8");
    // Look for percentage in parentheses on a Progress line
    const match = content.match(/[Pp]rogress.*?\((\d+)%\)/);
    if (match) {
      return parseInt(match[1], 10);
    }

    // Fallback: count checkboxes in the file
    const checked = (content.match(/- \[x\]/gi) || []).length;
    const unchecked = (content.match(/- \[ \]/g) || []).length;
    const total = checked + unchecked;
    if (total > 0) {
      return Math.round((checked / total) * 100);
    }

    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Epic detection + status rollup + child enumeration
//
// An epic is a feature folder that groups child feature subfolders. The CLI
// (.claude/epic-resolution.md) defines the load-bearing marker strictly as
// `epic-overview.md`. The web/MCP read path is intentionally one step broader:
// a folder scaffolded by "Add Epic" / create_epic has only `epic-requirements.md`
// (because /plan-epic writes `epic-overview.md` later), so we surface it as a
// "planning" epic. The strict CLI signal is still exposed via isEpicMarked().
// Epics are flat — children are feature subfolders only, never nested epics.
// ---------------------------------------------------------------------------

// Broad detection (web/MCP read path): epic if it has the marker OR requirements.

export function isEpicDir(featurePath: string): boolean {
  return (
    existsSync(join(featurePath, "epic-overview.md")) ||
    existsSync(join(featurePath, "epic-requirements.md"))
  );
}

// Strict CLI marker (epic-resolution.md §1): epic iff `epic-overview.md` exists.
// Use this for any caller that must agree exactly with the CLI's marker contract.

export function isEpicMarked(featurePath: string): boolean {
  return existsSync(join(featurePath, "epic-overview.md"));
}

// List an epic's child directory names (subdirectories only; ignores files and
// the epic-*.md markers). This is the set of feature subfolders inside an epic.

function epicChildDirNames(epicPath: string): string[] {
  if (!existsSync(epicPath)) return [];
  let entries;
  try {
    entries = readdirSync(epicPath, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}

// Roll an epic's status up from its children + marker presence:
// - "planning"    = requirements only (no epic-overview.md) — scaffolded, not yet planned
// - "planned"     = has epic-overview.md + >=1 child, but NO child has implementation.md
// - "in-progress" = has epic-overview.md + >=1 child has implementation.md (and not all complete)
// - "complete"    = every child's tasks.md reports 100%
// A childless overview-only epic reports "planned" (planned shell, nothing built).

export function getEpicStatus(epicPath: string): FeatureStatus {
  const hasOverview = existsSync(join(epicPath, "epic-overview.md"));

  // Planning pre-state: created via "Add Epic", awaiting /plan-epic.
  if (!hasOverview) {
    return "planning";
  }

  const childNames = epicChildDirNames(epicPath);

  // Overview present but no children built yet → planned shell.
  if (childNames.length === 0) {
    return "planned";
  }

  let anyImplementation = false;
  let allComplete = true;

  for (const child of childNames) {
    const childPath = join(epicPath, child);
    if (existsSync(join(childPath, "implementation.md"))) {
      anyImplementation = true;
    }
    const completion = getTaskCompletion(join(childPath, "tasks.md"));
    if (completion !== 100) {
      allComplete = false;
    }
  }

  // All children done → complete (requires every child's tasks.md at 100%).
  if (allComplete) {
    return "complete";
  }

  // At least one child has started implementation → building.
  if (anyImplementation) {
    return "in-progress";
  }

  // Children exist but none has an implementation.md yet → planned.
  return "planned";
}

// Enumerate an epic's child feature subfolders, each rendered exactly like a
// plain feature (reusing getFeatureStatus/getTaskCompletion) so a child card is
// shape-identical to a top-level plain feature. Children are never epics.

export function listEpicChildren(epicPath: string): FeatureInfo[] {
  const children: FeatureInfo[] = [];

  for (const child of epicChildDirNames(epicPath)) {
    const childPath = join(epicPath, child);
    const status = getFeatureStatus(childPath);

    let completion: number | null = null;
    if (status === "in-progress") {
      completion = getTaskCompletion(join(childPath, "tasks.md"));
    }

    const files = readdirSync(childPath).filter((f) => {
      try {
        return statSync(join(childPath, f)).isFile();
      } catch {
        return false;
      }
    });

    children.push({
      name: child,
      status,
      completion,
      files,
      isEpic: false,
    });
  }

  return children;
}

// Scans docs/features/ directory, returns info for each top-level feature.
// Epics carry an `isEpic: true` flag, a rolled-up `status`, and an enumerated
// `children` array; plain features are shape-identical to before plus
// `isEpic: false` (no `children` field).

export function listFeatures(projectPath: string): FeatureInfo[] {
  const featuresDir = join(projectPath, "docs", "features");
  if (!existsSync(featuresDir)) return [];

  const entries = readdirSync(featuresDir, { withFileTypes: true });
  const features: FeatureInfo[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const featurePath = join(featuresDir, entry.name);

    const files = readdirSync(featurePath)
      .filter((f) => {
        try {
          return statSync(join(featurePath, f)).isFile();
        } catch {
          return false;
        }
      });

    if (isEpicDir(featurePath)) {
      // Epic: roll up status from children, enumerate child subfolders.
      const status = getEpicStatus(featurePath);
      const children = listEpicChildren(featurePath);
      features.push({
        name: entry.name,
        status,
        completion: null,
        files,
        isEpic: true,
        children,
      });
      continue;
    }

    // Plain feature — unchanged behavior plus the additive `isEpic: false`.
    const status = getFeatureStatus(featurePath);

    let completion: number | null = null;
    if (status === "in-progress") {
      completion = getTaskCompletion(join(featurePath, "tasks.md"));
    }

    features.push({
      name: entry.name,
      status,
      completion,
      files,
      isEpic: false,
    });
  }

  return features;
}

// Extracts phases from implementation.md and optionally cross-references
// tasks.md to determine per-phase completion.
// Looks for lines like: ### Phase 1: EditorSettingsModule skeleton + persistence

export interface PhaseInfo {
  number: number;
  title: string;
  completion: number | null; // percentage 0-100, null if no tasks found
}

export function getFeaturePhases(featurePath: string): PhaseInfo[] {
  const implPath = join(featurePath, "implementation.md");
  if (!existsSync(implPath)) return [];

  try {
    const content = readFileSync(implPath, "utf8");
    const phasePattern = /^#{2,3}\s+Phase\s+(\d+):\s*(.+)$/gm;
    const phases: PhaseInfo[] = [];
    let match: RegExpExecArray | null;

    while ((match = phasePattern.exec(content)) !== null) {
      phases.push({
        number: parseInt(match[1], 10),
        title: match[2].replace(/\s*\([\d/]+ complete\)\s*$/, "").trim(),
        completion: null,
      });
    }

    if (phases.length === 0) return [];

    // Try to get per-phase completion from tasks.md
    const tasksPath = join(featurePath, "tasks.md");
    if (existsSync(tasksPath)) {
      const tasksContent = readFileSync(tasksPath, "utf8");
      const taskLines = tasksContent.split("\n");

      let currentPhase: number | null = null;
      const phaseCounts = new Map<number, { checked: number; total: number }>();

      for (const line of taskLines) {
        const phaseMatch = line.match(/^#{2,3}\s+Phase\s+(\d+)/);
        if (phaseMatch) {
          currentPhase = parseInt(phaseMatch[1], 10);
          if (!phaseCounts.has(currentPhase)) {
            phaseCounts.set(currentPhase, { checked: 0, total: 0 });
          }
          continue;
        }

        // Reset current phase when we hit a non-phase ## heading
        if (/^#{2,3}\s+/.test(line)) {
          currentPhase = null;
          continue;
        }

        if (currentPhase !== null) {
          if (/- \[x\]/i.test(line)) {
            const counts = phaseCounts.get(currentPhase)!;
            counts.checked++;
            counts.total++;
          } else if (/- \[ \]/.test(line)) {
            const counts = phaseCounts.get(currentPhase)!;
            counts.total++;
          }
        }
      }

      for (const phase of phases) {
        const counts = phaseCounts.get(phase.number);
        if (counts && counts.total > 0) {
          phase.completion = Math.round((counts.checked / counts.total) * 100);
        }
      }
    }

    return phases;
  } catch {
    return [];
  }
}

// Reads first paragraph from implementation.md (after the header block).
// Returns null if implementation.md doesn't exist.

export function getFeatureDescription(featurePath: string): string | null {
  const implPath = join(featurePath, "implementation.md");
  if (!existsSync(implPath)) return null;

  try {
    const content = readFileSync(implPath, "utf8");
    const lines = content.split("\n");

    // Skip leading blank lines and header lines (starting with #)
    let i = 0;
    // Skip YAML frontmatter if present
    if (lines[0]?.trim() === "---") {
      i = 1;
      while (i < lines.length && lines[i]?.trim() !== "---") i++;
      i++; // skip closing ---
    }

    // Skip blank lines, heading lines, metadata lines (**Key:** value), and --- separators
    while (i < lines.length && (
      lines[i].trim() === "" ||
      lines[i].trim().startsWith("#") ||
      lines[i].trim().startsWith("**") ||
      lines[i].trim() === "---"
    )) {
      i++;
    }

    // Collect first paragraph (non-empty lines until blank line or heading)
    const paragraph: string[] = [];
    while (i < lines.length && lines[i].trim() !== "") {
      paragraph.push(lines[i].trim());
      i++;
    }

    if (paragraph.length === 0) return null;
    return paragraph.join("\n");
  } catch {
    return null;
  }
}
