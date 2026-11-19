// installer/adapters/claude.js
//
// The Claude Code adapter, the shape of implementation.md section 3.2. It is
// copy-shaped: mapFrontmatter() returns null and renderBody() returns its
// input, so the core always takes the byte-identical fast path for this
// adapter. Only this file names ".claude" under installer/.

import fs from 'node:fs';
import path from 'node:path';

/** @typedef {import('../lib/source.js').Entry} Entry */

/**
 * @param {Entry} entry
 * @returns {string | null}
 */
function destination(entry) {
  if (entry.kind === 'skill') {
    return `.claude/skills/${entry.name}/${entry.relPath}`;
  }
  if (entry.kind === 'agent') {
    return `.claude/agents/${entry.name}.md`;
  }
  return null;
}

/**
 * @param {{ version: string }} ctx
 * @returns {{ destination: string, content: string }[]}
 */
function extraFiles(ctx) {
  return [{ destination: '.claude/.beast-mode-version', content: `${ctx.version}\n` }];
}

/**
 * The stale-command scan. A version 4 project keeps the Beast Mode commands
 * in .claude/commands/. Those files answer the same /name as the new
 * skills, so the harness finds two copies. This check reports the clash
 * with the same wording the Beast Mode 5.0.0 bash installer used, before
 * this CLI replaced it. It never changes a file.
 *
 * @param {{ projectRoot: string, skillNames: string[], pluginRoot: string }} ctx
 * @returns {{ ok: boolean, notes: string[] }}
 */
function check(ctx) {
  const commandsDir = path.join(ctx.projectRoot, '.claude', 'commands');
  if (!fs.existsSync(commandsDir)) {
    return { ok: true, notes: [] };
  }

  let staleCount = 0;
  for (const name of ctx.skillNames) {
    if (fs.existsSync(path.join(commandsDir, `${name}.md`))) {
      staleCount += 1;
    }
  }

  if (staleCount === 0) {
    return { ok: true, notes: [] };
  }

  return {
    ok: false,
    notes: [
      `${staleCount} Beast Mode command file(s) still live in .claude/commands/`,
      'Both copies answer the same /name, so the harness may run the old one.',
      'Move this project onto the version 5 layout:',
      `bash ${ctx.pluginRoot}/scripts/migrate-v4-to-v5.sh ${ctx.pluginRoot}`,
    ],
  };
}

/** @type {import('./index.js').Adapter} */
export const claude = {
  id: 'claude',
  glossaryHarnessId: 'claude-code',
  harnessRoot: '.claude',
  destination,
  mapFrontmatter(_entry, _data) {
    return null;
  },
  renderBody(_entry, body) {
    return body;
  },
  extraFiles,
  check,
};

export default claude;
