// installer/adapters/dsh.js
//
// The DeepSeek Harness (dsh) adapter, the shape of implementation.md
// section 3.6 (harness-support/dsh-plugin). It renders the command
// skills into ".agents/skills/<name>/SKILL.md" and the shipped agents
// into the flat file ".agents/skills/<name>.md".
//
// A command skill returns null from mapFrontmatter(). The core then keeps
// the exact source frontmatter bytes and joins no YAML (Decision 8). A
// shipped agent takes the join instead, because dsh reads no
// project-level markdown agent and needs the extra
// "user-invocable: false" key.
//
// This adapter transforms no shared file: every entry outside "skill" and
// "agent" falls through mapFrontmatter() and renderBody() unchanged, so the
// shared dev-doc root stays byte-identical across every harness (Decision 9).
// The core owns that shared root and its destination path, not this file.

import fs from 'node:fs';
import path from 'node:path';

/** @typedef {import('../lib/source.js').Entry} Entry */

/**
 * The note a rendered skill gains when its source body holds at least one
 * "$ARGUMENTS" token. dsh does not substitute the token, so the note states
 * the rule once, at the top of the body, and changes no token in the body
 * that follows. Holds exactly three "$ARGUMENTS" occurrences.
 *
 * @type {string}
 */
export const ARGUMENTS_NOTE = `> **Arguments on this harness.** This harness does not substitute \`$ARGUMENTS\`.
> Read the text that follows \`/<name>\` in the same user message, and use that text
> wherever this skill writes \`$ARGUMENTS\`. When another skill loads this skill, use
> the arguments that the caller states. When no such text exists, treat \`$ARGUMENTS\`
> as empty.`;

/**
 * @param {Entry} entry
 * @returns {string | null}
 */
function destination(entry) {
  if (entry.kind === 'skill') {
    return `.agents/skills/${entry.name}/${entry.relPath}`;
  }
  if (entry.kind === 'agent') {
    return `.agents/skills/${entry.name}.md`;
  }
  return null;
}

/**
 * A skill keeps its source frontmatter bytes, so this returns null for a
 * skill entry. An agent gains "user-invocable: false" on top of every
 * source key, because dsh reads a flat skill file only, and a user must
 * never run an agent directly. Every other entry kind (a dev-doc, a format
 * reference, or the glossary) also returns null, so this adapter transforms
 * no shared file.
 *
 * @param {Entry} entry
 * @param {Record<string, string> | undefined} data
 * @returns {Record<string, string> | null}
 */
function mapFrontmatter(entry, data) {
  if (entry.kind === 'agent') {
    return { ...data, 'user-invocable': 'false' };
  }
  return null;
}

/**
 * Insert the arguments note above a command skill body that holds the
 * token. Every other body, including a body with no token and every
 * non-skill entry, returns unchanged.
 *
 * @param {Entry} entry
 * @param {string} body
 * @returns {string}
 */
function renderBody(entry, body) {
  if (entry.kind === 'skill' && body.includes('$ARGUMENTS')) {
    const note = ARGUMENTS_NOTE.replace('<name>', entry.name);
    return `${note}\n\n${body}`;
  }
  return body;
}

/**
 * @param {{ version: string }} ctx
 * @returns {{ destination: string, content: string }[]}
 */
function extraFiles(ctx) {
  return [{ destination: '.agents/.beast-mode-version', content: `${ctx.version}\n` }];
}

/**
 * List the agent names this plugin ships, read from the plugin's own
 * templates/agents/ folder. The check() context carries a skill name list
 * only (ctx.skillNames), and no agent name list, so this adapter reads the
 * agent names itself rather than hard-coding a shipped agent name.
 *
 * @param {string} pluginRoot
 * @returns {string[]}
 */
function readAgentNames(pluginRoot) {
  const agentsDir = path.join(pluginRoot, 'templates', 'agents');
  if (!fs.existsSync(agentsDir)) return [];
  return fs
    .readdirSync(agentsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => entry.name.slice(0, -3));
}

/**
 * The dsh shadow and collision check. dsh reads a ".dsh/skills" entry at
 * rank 100 and an ".agents/skills" entry at rank 200 (Decision 6). A lower
 * rank wins a duplicate name, so a ".dsh/skills/<name>" entry always
 * answers "/<name>" ahead of the file this adapter wrote. A flat file and a
 * folder of the same name also collide, in either direction. This function
 * reports every hit. It changes no file.
 *
 * @param {{ projectRoot: string, skillNames: string[], pluginRoot: string }} ctx
 * @returns {{ ok: boolean, notes: string[] }}
 */
function check({ projectRoot, skillNames, pluginRoot }) {
  const notes = [];

  // Rule 1: a ".dsh/skills/<name>" entry, file or folder, shadows a
  // rendered command at a lower rank.
  for (const name of skillNames) {
    const shadowPath = path.join(projectRoot, '.dsh', 'skills', name);
    if (fs.existsSync(shadowPath)) {
      notes.push(
        `".dsh/skills/${name}" exists. dsh reads a ".dsh/skills" entry at rank 100, ` +
          `ahead of the ".agents/skills" entry this adapter wrote at rank 200, so ` +
          `"/${name}" answers the ".dsh" copy.`
      );
    }
  }

  // Rule 2: a flat file sits where this adapter writes a skill folder.
  for (const name of skillNames) {
    const flatPath = path.join(projectRoot, '.agents', 'skills', `${name}.md`);
    if (fs.existsSync(flatPath) && fs.statSync(flatPath).isFile()) {
      notes.push(
        `".agents/skills/${name}.md" is a flat file, but this adapter writes the ` +
          `command "${name}" as a folder at ".agents/skills/${name}/SKILL.md". ` +
          'The flat file and the folder collide on the same name.'
      );
    }
  }

  // Rule 3: a folder sits where this adapter writes a flat agent file.
  for (const name of readAgentNames(pluginRoot)) {
    const folderPath = path.join(projectRoot, '.agents', 'skills', name);
    if (fs.existsSync(folderPath) && fs.statSync(folderPath).isDirectory()) {
      notes.push(
        `".agents/skills/${name}/" is a folder, but this adapter writes the agent ` +
          `"${name}" as a flat file at ".agents/skills/${name}.md". ` +
          'The folder and the flat file collide on the same name.'
      );
    }
  }

  return notes.length > 0 ? { ok: false, notes } : { ok: true, notes: [] };
}

/** @type {import('./index.js').Adapter} */
export const dsh = {
  id: 'dsh',
  glossaryHarnessId: 'dsh',
  harnessRoot: '.agents',
  destination,
  mapFrontmatter,
  renderBody,
  extraFiles,
  check,
};

export default dsh;
