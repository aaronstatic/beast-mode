// installer/adapters/index.js
//
// The adapter registry, keyed by CLI harness id. A future harness owner
// adds a second adapter here with one import and one registry line, and
// changes no file under installer/lib/.

import { UnknownHarnessError } from '../lib/errors.js';
import claude from './claude.js';
import dsh from './dsh.js';

/**
 * @typedef {import('../lib/source.js').Entry} Entry
 */

/**
 * The whole adapter interface of implementation.md section 3.2. An adapter
 * returns paths and strings only. It never touches the file system, apart
 * from the read-only checks that check() runs.
 *
 * @typedef {Object} Adapter
 * @property {string} id The command-line argument and the basename of the glossary file.
 * @property {string} glossaryHarnessId The value the glossary "**Harness:**" line must hold.
 * @property {string} harnessRoot The harness root, project-relative.
 * @property {(entry: Entry) => string | null} destination
 *   Map one entry to a project-relative destination. Return null to drop the entry.
 * @property {(entry: Entry, data: Record<string, string> | undefined) => Record<string, string> | null} mapFrontmatter
 *   Map the frontmatter of a skill or an agent. Return null to keep the source bytes.
 * @property {(entry: Entry, body: string) => string} renderBody
 *   Transform the body. Return the input to keep the source bytes.
 * @property {(ctx: { version: string }) => { destination: string, content: string }[]} extraFiles
 *   Files the adapter owns that have no source file.
 * @property {(ctx: { projectRoot: string, skillNames: string[], pluginRoot: string }) => { ok: boolean, notes: string[] }} check
 *   Run after apply. Report a problem. Never change a file.
 */

/** @type {Record<string, Adapter>} */
export const adapters = {
  claude,
  dsh,
};

/**
 * @param {string} id The CLI harness argument.
 * @returns {Adapter}
 */
export function getAdapter(id) {
  const adapter = adapters[id];
  if (!adapter) {
    throw new UnknownHarnessError(
      `No adapter for the harness "${id}".`,
      `installer/adapters/ holds no adapter with id "${id}".`,
      `Check the harness id, or add "templates/harness/${id}.md" and a matching adapter, then run the command again.`
    );
  }
  return adapter;
}
