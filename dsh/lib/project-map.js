/**
 * The workspace-to-project map for the dsh web panel.
 *
 * This module builds a `ProjectProvider` (see `web/src/backend/context.ts`)
 * over a dsh `workspaceRegistry` list, and it builds the host index body
 * that `GET /beast/api/panel` returns. Every function here is plain ESM
 * and imports Node built-in modules only.
 *
 * @module beast-mode/dsh/project-map
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The URL of the plugin manifest, resolved from this file's own location. */
const PLUGIN_MANIFEST_URL = new URL('../../.claude-plugin/plugin.json', import.meta.url);

/** A run of one or more characters outside the allowed slug set. */
const DISALLOWED_RUN = /[^A-Za-z0-9._-]+/g;

/** A leading or trailing run of hyphens. */
const EDGE_HYPHENS = /^-+|-+$/g;

/**
 * Read `beastModeVersion` from the plugin manifest. Guarded by a try, so a
 * missing or broken manifest never stops the panel index from building.
 * @returns {string | null} the version string, or null when it cannot be read.
 */
function readBeastModeVersion() {
  try {
    const raw = readFileSync(fileURLToPath(PLUGIN_MANIFEST_URL), 'utf8');
    const manifest = JSON.parse(raw);
    return typeof manifest.version === 'string' ? manifest.version : null;
  } catch {
    return null;
  }
}

/**
 * Turn a workspace title into a project name.
 *
 * The rule keeps `A-Z a-z 0-9 . _ -`, replaces every other run of
 * characters with one hyphen, and trims a leading or trailing hyphen. An
 * empty result becomes the workspace id.
 * @param {string} title - the workspace display title.
 * @param {string} id - the workspace id, used as the empty-title fallback.
 * @returns {string} the project name.
 */
export function projectNameFor(title, id) {
  const source = typeof title === 'string' ? title : '';
  const collapsed = source.replace(DISALLOWED_RUN, '-');
  const trimmed = collapsed.replace(EDGE_HYPHENS, '');
  return trimmed.length > 0 ? trimmed : String(id);
}

/**
 * Build one project entry per workspace, with a collision suffix.
 *
 * A duplicate project name gains a `-<first 6 of the id>` suffix, so two
 * workspaces with the same title still resolve to two distinct projects.
 * @param {ReadonlyArray<{id: unknown, path: string, title: string}>} workspaces
 * @returns {Array<{name: string, path: string, workspaceId: string, title: string}>}
 */
export function buildProjectList(workspaces) {
  const usedNames = new Set();
  const entries = [];
  for (const workspace of workspaces ?? []) {
    const workspaceId = String(workspace.id);
    const title = workspace.title;
    let name = projectNameFor(title, workspaceId);
    if (usedNames.has(name)) {
      name = `${name}-${workspaceId.slice(0, 6)}`;
    }
    usedNames.add(name);
    entries.push({ name, path: workspace.path, workspaceId, title });
  }
  return entries;
}

/**
 * Build a `ProjectProvider` over a live workspace read.
 *
 * `getAll()` calls `getWorkspaces()` on every call, so a workspace a user
 * adds after this provider is built still appears with no restart. The
 * provider carries no `prepare()`, because the registry read is already
 * live.
 * @param {() => ReadonlyArray<{id: unknown, path: string, title: string}>} getWorkspaces
 * @returns {{getAll: () => Array<{name: string, path: string}>, get: (name: string) => ({name: string, path: string} | undefined), resolvePath: (project: {path: string}) => string}}
 */
export function createWorkspaceProvider(getWorkspaces) {
  function getAll() {
    return buildProjectList(getWorkspaces()).map((entry) => ({
      name: entry.name,
      path: entry.path,
    }));
  }
  function get(name) {
    return getAll().find((project) => project.name === name);
  }
  function resolvePath(project) {
    return project.path;
  }
  return { getAll, get, resolvePath };
}

/**
 * Build the host index body for `GET /beast/api/panel`.
 *
 * `installed` is the result of one `exists` test on the workspace's
 * `docs/features` path. `exists` is injected, so a plain Node test can pass
 * a fake function and needs no real filesystem state.
 * @param {ReadonlyArray<{id: unknown, path: string, title: string}>} workspaces
 * @param {(path: string) => boolean} exists
 * @returns {{version: 1, beastModeVersion: (string | null), workspaces: Array<{workspaceId: string, title: string, project: string, installed: boolean}>}}
 */
export function buildPanelIndex(workspaces, exists) {
  const checkExists = typeof exists === 'function' ? exists : existsSync;
  const list = buildProjectList(workspaces);
  return {
    version: 1,
    beastModeVersion: readBeastModeVersion(),
    workspaces: list.map((entry) => ({
      workspaceId: entry.workspaceId,
      title: entry.title,
      project: entry.name,
      installed: checkExists(join(entry.path, 'docs', 'features')),
    })),
  };
}
