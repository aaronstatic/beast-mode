// installer/lib/marker.js
//
// The shared version marker of implementation.md section 3.1, at
// ".beast-mode/version.json". It records the Beast Mode version and the
// installed harness set of one project. It is the one record of that set,
// and the core composes ".beast-mode/harness.md" from it.
//
// The marker is derived data. It holds no hash and it drives no destructive
// decision, so read() throws nothing (Decision 4). Missing, unreadable, and
// unknown-schema input all read as no marker. The run warns, falls back to
// the detection pass, and writes the file again at the end. Every fact in
// the marker comes back from the per-harness manifests and from the
// per-harness version files.
//
// This module holds no harness name and no harness path. It imports no
// adapter module either: the caller passes the adapter registry in as
// data, and only the JSDoc type of that registry names the adapter file.

import fs from 'node:fs';
import path from 'node:path';

/** @typedef {import('../adapters/index.js').Adapter} Adapter */

/** The one schema version this module writes and accepts. */
export const SCHEMA = 1;

/** The project-relative path of the marker, forward slashes. */
export const MARKER_PATH = '.beast-mode/version.json';

/** The value a version reader returns when no file and no cache holds one. */
export const UNKNOWN_VERSION = 'unknown';

/**
 * @typedef {Object} MarkerEntry
 * @property {string} harnessRoot Project-relative, forward slashes.
 * @property {string} version The cached "<harnessRoot>/.beast-mode-version" value.
 * @property {string} installed ISO timestamp of the first run that recorded this harness.
 * @property {string} updated ISO timestamp of the last run that touched this harness.
 */

/**
 * @typedef {Object} Marker
 * @property {number} schema
 * @property {string} beastModeVersion
 * @property {string} generated ISO timestamp.
 * @property {Record<string, MarkerEntry>} harnesses Keyed by adapter id.
 */

/**
 * @typedef {Object} Harness One member of a resolved harness set.
 * @property {string} id The adapter id, and the key of the marker entry.
 * @property {string} harnessRoot Project-relative, forward slashes.
 * @property {string | null} glossaryHarnessId Null when this plugin ships no adapter for the id.
 */

/**
 * @param {string} projectRoot
 * @returns {string} The absolute marker path.
 */
export function markerPath(projectRoot) {
  return path.join(projectRoot, ...MARKER_PATH.split('/'));
}

/**
 * Read the cached version file of one harness. Returns null when the file
 * is missing or empty. This file is the authority for the version of one
 * harness, and the marker field is the cache (Decision 5).
 *
 * @param {string} projectRoot
 * @param {string} harnessRoot Project-relative harness root, from the adapter or from the marker.
 * @returns {string | null}
 */
export function readHarnessVersion(projectRoot, harnessRoot) {
  const file = path.join(projectRoot, ...harnessRoot.split('/'), '.beast-mode-version');
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  const value = text.trim();
  return value.length > 0 ? value : null;
}

/**
 * Read the marker. Throws nothing, for any input.
 *
 * A missing file returns a null marker and no note. That is the normal
 * state of a fresh install and of every project that a version before
 * 5.4.0 installed, so a warning there would fire on a healthy first run.
 * An unreadable file and an unknown schema each return a null marker plus
 * one note, because both name a real problem the user can fix.
 *
 * @param {string} projectRoot
 * @returns {{ marker: Marker | null, notes: string[] }}
 */
export function read(projectRoot) {
  const file = markerPath(projectRoot);
  /** @type {string[]} */
  const notes = [];

  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return { marker: null, notes };
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    notes.push(
      `The marker at "${MARKER_PATH}" is not valid JSON, so this run rebuilds it: ` +
        `${err instanceof Error ? err.message : String(err)}`
    );
    return { marker: null, notes };
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    notes.push(`The marker at "${MARKER_PATH}" holds no object, so this run rebuilds it.`);
    return { marker: null, notes };
  }

  if (data.schema !== SCHEMA) {
    notes.push(
      `The marker at "${MARKER_PATH}" holds the unknown schema ${JSON.stringify(data.schema)}, ` +
        `so this run rebuilds it with the schema ${SCHEMA}.`
    );
    return { marker: null, notes };
  }

  const source = data.harnesses;
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    notes.push(`The marker at "${MARKER_PATH}" names no harness list, so this run rebuilds it.`);
    return { marker: null, notes };
  }

  /** @type {Record<string, MarkerEntry>} */
  const harnesses = {};
  for (const [id, entry] of Object.entries(source)) {
    if (!entry || typeof entry !== 'object' || typeof entry.harnessRoot !== 'string') {
      notes.push(
        `The marker entry for the harness "${id}" names no harness root, so this run drops it.`
      );
      continue;
    }
    harnesses[id] = {
      harnessRoot: entry.harnessRoot,
      version: typeof entry.version === 'string' ? entry.version : UNKNOWN_VERSION,
      installed: typeof entry.installed === 'string' ? entry.installed : '',
      updated: typeof entry.updated === 'string' ? entry.updated : '',
    };
  }

  return {
    marker: {
      schema: SCHEMA,
      beastModeVersion: typeof data.beastModeVersion === 'string' ? data.beastModeVersion : '',
      generated: typeof data.generated === 'string' ? data.generated : '',
      harnesses,
    },
    notes,
  };
}

/**
 * Find every harness that already holds a Beast Mode manifest. Tests
 * "<harnessRoot>/.beast-mode-manifest.json" for every registry member, in
 * adapter id sort order. A project installed before 5.1.0 holds no
 * manifest, so the detection finds nothing there.
 *
 * @param {{ projectRoot: string, adapters: Record<string, Adapter> }} args
 * @returns {string[]} The detected adapter ids, sorted.
 */
export function detect({ projectRoot, adapters }) {
  const found = [];
  for (const id of Object.keys(adapters).sort()) {
    const adapter = adapters[id];
    const manifestFile = path.join(
      projectRoot,
      ...adapter.harnessRoot.split('/'),
      '.beast-mode-manifest.json'
    );
    if (fs.existsSync(manifestFile)) found.push(id);
  }
  return found;
}

/**
 * Resolve the harness set of one run: the marker entries, plus every
 * detected harness, plus the harness this run installs or upgrades. The
 * set drives the glossary composition and the marker write.
 *
 * The harness root comes from the adapter, or from the marker entry when
 * this plugin version ships no adapter for that id (field rule 5). Such an
 * entry stays in the set and keeps its marker entry, and the compose step
 * skips its section with one note.
 *
 * @param {{
 *   projectRoot: string,
 *   marker: Marker | null,
 *   adapters: Record<string, Adapter>,
 *   include?: string | null,
 * }} args
 * @returns {Harness[]} Sorted by adapter id.
 */
export function resolve({ projectRoot, marker, adapters, include = null }) {
  /** @type {Map<string, Harness>} */
  const set = new Map();

  const add = (id, fallbackRoot) => {
    if (set.has(id)) return;
    const adapter = adapters[id];
    const harnessRoot = adapter ? adapter.harnessRoot : fallbackRoot;
    if (!harnessRoot) return;
    set.set(id, {
      id,
      harnessRoot,
      glossaryHarnessId: adapter ? adapter.glossaryHarnessId : null,
    });
  };

  for (const [id, entry] of Object.entries(marker?.harnesses ?? {})) {
    add(id, entry.harnessRoot);
  }
  for (const id of detect({ projectRoot, adapters })) {
    add(id, null);
  }
  if (include) add(include, null);

  return [...set.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Record one harness in the marker. Returns a new object, so the caller's
 * marker never changes under it.
 *
 * The touched form sets "harnessRoot", "version", and "updated", and it
 * preserves "installed" from the entry that is already there (field rule
 * 7). The untouched form creates a missing entry only, and an entry that is
 * already there keeps all four values (field rule 9). Both forms set
 * "beastModeVersion" and "generated", because the run that writes the file
 * owns those two.
 *
 * @param {Marker | null} marker
 * @param {{
 *   id: string,
 *   harnessRoot: string,
 *   version: string,
 *   beastModeVersion: string,
 *   now?: string,
 *   touched?: boolean,
 * }} args
 * @returns {Marker}
 */
export function upsert(marker, { id, harnessRoot, version, beastModeVersion, now, touched = true }) {
  const stamp = now ?? new Date().toISOString();
  const harnesses = { ...(marker?.harnesses ?? {}) };
  const previous = harnesses[id];

  if (!previous) {
    harnesses[id] = { harnessRoot, version, installed: stamp, updated: stamp };
  } else if (touched) {
    harnesses[id] = {
      harnessRoot,
      version,
      installed: previous.installed || stamp,
      updated: stamp,
    };
  }

  return {
    schema: SCHEMA,
    beastModeVersion,
    generated: stamp,
    harnesses,
  };
}

/**
 * Write the marker. Sorts the harness keys, so two runs that record the
 * same set produce the same key order and only the timestamps move.
 * Pretty-prints with two spaces and ends the file with one newline, the
 * shape lib/manifest.js writes.
 *
 * @param {string} projectRoot
 * @param {Marker} marker
 * @returns {string} The absolute path the run wrote.
 */
export function write(projectRoot, marker) {
  /** @type {Record<string, MarkerEntry>} */
  const harnesses = {};
  for (const id of Object.keys(marker.harnesses).sort()) {
    const entry = marker.harnesses[id];
    harnesses[id] = {
      harnessRoot: entry.harnessRoot,
      version: entry.version,
      installed: entry.installed,
      updated: entry.updated,
    };
  }

  const data = {
    schema: SCHEMA,
    beastModeVersion: marker.beastModeVersion,
    generated: marker.generated,
    harnesses,
  };

  const file = markerPath(projectRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
  return file;
}
