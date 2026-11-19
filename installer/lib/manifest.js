// installer/lib/manifest.js
//
// Reads and writes the per-harness manifest of implementation.md section 3.3.
// The manifest lives inside the harness root, at
// "<harnessRoot>/.beast-mode-manifest.json". It lists every source-backed
// file the CLI wrote or skipped, with a sha256 of the written content. A
// synthesized extra file (for example the version marker) and the
// .gitignore edit carry no manifest entry, because they need no hash
// comparison on an upgrade.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { ManifestConflictError } from './errors.js';

/** The one schema version this CLI writes and reads. */
export const SCHEMA = 1;

/**
 * @param {string|Buffer} content
 * @returns {string} The lowercase hex sha256 digest of content.
 */
export function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * @param {string} p A path using any separator.
 * @returns {string} The same path using forward slashes.
 */
export function toPosix(p) {
  return p.split(path.sep).join('/');
}

/**
 * @param {string} projectRoot
 * @param {string} harnessRoot Project-relative harness root, one adapter's own root path.
 * @returns {string} The absolute manifest path.
 */
export function manifestPath(projectRoot, harnessRoot) {
  return path.join(projectRoot, ...harnessRoot.split('/'), '.beast-mode-manifest.json');
}

/**
 * @typedef {Object} ManifestFileEntry
 * @property {string} destination Project-relative, forward slashes.
 * @property {string} [source] Plugin-relative, forward slashes. Absent for a synthesized file.
 * @property {string} [sha256] Present when owned is true.
 * @property {boolean} owned
 * @property {string} [reason] Present when owned is false.
 */

/**
 * @typedef {Object} Manifest
 * @property {number} schema
 * @property {string} beastModeVersion
 * @property {string} harness
 * @property {string} harnessRoot
 * @property {string} generated ISO timestamp.
 * @property {ManifestFileEntry[]} files
 */

/**
 * Read a manifest file. Returns null when the file does not exist. Raises
 * ManifestConflictError (exit 5) on unreadable JSON, on a "harness" value
 * that differs from harnessId, or on a "schema" that is not SCHEMA.
 *
 * @param {{ path: string, harnessId: string }} args
 * @returns {Manifest | null}
 */
export function read({ path: manifestFile, harnessId }) {
  if (!fs.existsSync(manifestFile)) return null;

  let data;
  try {
    data = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  } catch (err) {
    throw new ManifestConflictError(
      `The manifest at "${manifestFile}" is not valid JSON.`,
      err instanceof Error ? err.message : String(err),
      `Fix or delete "${manifestFile}", then run the command again.`
    );
  }

  if (data.harness !== harnessId) {
    throw new ManifestConflictError(
      `The manifest at "${manifestFile}" names a different harness.`,
      `The manifest holds "harness": "${data.harness}", but this run is for the harness "${harnessId}".`,
      `Fix or delete "${manifestFile}", then run the command again.`
    );
  }

  if (data.schema !== SCHEMA) {
    throw new ManifestConflictError(
      `The manifest at "${manifestFile}" holds an unknown schema.`,
      `Expected "schema": ${SCHEMA}, found "schema": ${JSON.stringify(data.schema)}.`,
      `Fix or delete "${manifestFile}", then run the command again.`
    );
  }

  // An upgrade deletes and replaces the destinations this list names, so
  // every one of them must stay inside the project. A destination that is
  // absolute, or that climbs out with "..", stops the run. The CLI never
  // touches a path outside the project root.
  for (const entry of data.files ?? []) {
    if (!isSafeDestination(entry && entry.destination)) {
      throw new ManifestConflictError(
        `The manifest at "${manifestFile}" names a destination outside the project.`,
        `The entry "${JSON.stringify(entry && entry.destination)}" is not a relative path inside the project root.`,
        `Fix or delete "${manifestFile}", then run the command again.`
      );
    }
  }

  return data;
}

/**
 * True when a manifest destination is a plain relative path inside the
 * project: no absolute path, no drive letter, no "." or ".." segment.
 *
 * @param {unknown} destination
 * @returns {boolean}
 */
export function isSafeDestination(destination) {
  if (typeof destination !== 'string' || destination.length === 0) return false;
  if (destination.startsWith('/') || destination.startsWith('\\')) return false;
  if (/^[A-Za-z]:/.test(destination)) return false;
  const segments = destination.split(/[\\/]/);
  return segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

/**
 * Write a manifest, pretty-printed with a trailing newline. Creates the
 * parent directory when it does not exist.
 *
 * @param {string} manifestFile
 * @param {Manifest} data
 * @returns {void}
 */
export function write(manifestFile, data) {
  fs.mkdirSync(path.dirname(manifestFile), { recursive: true });
  fs.writeFileSync(manifestFile, `${JSON.stringify(data, null, 2)}\n`);
}
