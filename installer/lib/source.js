// installer/lib/source.js
//
// Locates the plugin root, reads the five source directories that
// docs/harness-neutral-source.md section 8 names, and validates the
// source per section 7 (the glossary) and section 4 (a command skill).
// Returns the Entry list plus the plugin version.

import fs from 'node:fs';
import path from 'node:path';

import { SourceInvalidError, UnknownHarnessError } from './errors.js';
import { split as splitFrontmatter } from './frontmatter.js';

const KEBAB_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * The seventeen neutral terms of contract section 6.1, in the canonical order.
 * Terms 1 to 10 and term 17 are the workflow terms. Terms 11 to 16 are the tool terms.
 * A unit test parses that section of docs/harness-neutral-source.md and
 * asserts that this constant matches it, so the two copies cannot drift.
 */
export const CANONICAL_TERMS = [
  'ask the user to choose',
  'delegate to the `<name>` agent',
  'run the `/<name>` command',
  'load the `<name>` skill',
  'search the web',
  'the harness skills directory',
  'the harness agents directory',
  'the project instruction file',
  'the browser automation tool',
  'the arguments token `$ARGUMENTS`',
  'edit a file',
  'write a file',
  'read a file range',
  'run a shell command',
  'evaluate in the browser',
  'take a page snapshot',
  'send a message to an agent',
];

/**
 * @typedef {Object} Entry
 * @property {'skill'|'agent'|'dev-doc'|'format'|'glossary'} kind
 * @property {string} sourcePath plugin-relative, forward slashes
 * @property {string} name skill folder name, agent stem, or file basename
 * @property {string} relPath path inside its source directory
 */

/**
 * Resolve the plugin root from a module directory two levels below it, for
 * example installer/bin or installer/lib.
 *
 * @param {string} importMetaDirname
 * @returns {string}
 */
export function findPluginRoot(importMetaDirname) {
  return path.resolve(importMetaDirname, '..', '..');
}

/**
 * @param {string} p A path relative to something, using the platform separator.
 * @returns {string} The same path using forward slashes.
 */
function toPosix(p) {
  return p.split(path.sep).join('/');
}

/**
 * @param {string} dir The absolute directory to require.
 * @param {string} pluginRoot
 * @returns {void}
 */
function requireDir(dir, pluginRoot) {
  const relDir = toPosix(path.relative(pluginRoot, dir));
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    throw new SourceInvalidError(
      `No source directory at "${relDir}".`,
      'The plugin holds no template source at that path.',
      'Reinstall the plugin, then run the command again.'
    );
  }
}

/**
 * @param {string} dir
 * @returns {string[]} Every file path inside dir, recursively.
 */
function walkFiles(dir) {
  const result = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...walkFiles(full));
    } else if (entry.isFile()) {
      result.push(full);
    }
  }
  return result;
}

/**
 * @param {string} pluginRoot
 * @returns {Entry[]}
 */
function readSkills(pluginRoot) {
  const skillsDir = path.join(pluginRoot, 'templates', 'skills');
  requireDir(skillsDir, pluginRoot);

  const entries = [];
  const folders = fs
    .readdirSync(skillsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory());

  for (const folder of folders) {
    const name = folder.name;
    const folderPath = path.join(skillsDir, name);
    for (const filePath of walkFiles(folderPath)) {
      entries.push({
        kind: 'skill',
        sourcePath: toPosix(path.relative(pluginRoot, filePath)),
        name,
        relPath: toPosix(path.relative(folderPath, filePath)),
      });
    }
  }
  return entries;
}

/**
 * @param {string} pluginRoot
 * @returns {Entry[]}
 */
function readAgents(pluginRoot) {
  const agentsDir = path.join(pluginRoot, 'templates', 'agents');
  requireDir(agentsDir, pluginRoot);

  const entries = [];
  for (const entry of fs.readdirSync(agentsDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const filePath = path.join(agentsDir, entry.name);
    entries.push({
      kind: 'agent',
      sourcePath: toPosix(path.relative(pluginRoot, filePath)),
      name: entry.name.slice(0, -3),
      relPath: entry.name,
    });
  }
  return entries;
}

/**
 * Read a flat source directory (dev-docs or formats) into Entry values.
 *
 * @param {string} pluginRoot
 * @param {string} dirName Directory under templates/, for example "dev-docs".
 * @param {'dev-doc'|'format'} kind
 * @returns {Entry[]}
 */
function readFlat(pluginRoot, dirName, kind) {
  const dir = path.join(pluginRoot, 'templates', dirName);
  requireDir(dir, pluginRoot);

  const entries = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const filePath = path.join(dir, entry.name);
    entries.push({
      kind,
      sourcePath: toPosix(path.relative(pluginRoot, filePath)),
      name: entry.name.slice(0, -3),
      relPath: entry.name,
    });
  }
  return entries;
}

/**
 * @param {string} pluginRoot
 * @param {string} harnessId The basename of the glossary file, for example "claude".
 * @returns {Entry}
 */
function readGlossary(pluginRoot, harnessId) {
  const filePath = path.join(pluginRoot, 'templates', 'harness', `${harnessId}.md`);
  if (!fs.existsSync(filePath)) {
    throw new UnknownHarnessError(
      `No glossary for the harness "${harnessId}".`,
      `The plugin holds no file at "templates/harness/${harnessId}.md".`,
      'Check the harness id, or add the glossary file, then run the command again.'
    );
  }
  return {
    kind: 'glossary',
    sourcePath: toPosix(path.relative(pluginRoot, filePath)),
    name: harnessId,
    relPath: `${harnessId}.md`,
  };
}

/**
 * @param {string} pluginRoot
 * @returns {string} The plugin version from .claude-plugin/plugin.json.
 */
export function readVersion(pluginRoot) {
  const manifestPath = path.join(pluginRoot, '.claude-plugin', 'plugin.json');
  if (!fs.existsSync(manifestPath)) {
    throw new SourceInvalidError(
      `No plugin manifest at "${toPosix(path.relative(pluginRoot, manifestPath))}".`,
      'The CLI reads the plugin version from that file.',
      'Reinstall the plugin, then run the command again.'
    );
  }
  let data;
  try {
    data = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    throw new SourceInvalidError(
      'The plugin manifest is not valid JSON.',
      err instanceof Error ? err.message : String(err),
      'Reinstall the plugin, then run the command again.'
    );
  }
  return data.version;
}

/**
 * Raise SourceInvalidError for a file that failed one validation rule.
 *
 * @param {string} kind Human label, for example "skill" or "glossary".
 * @param {string} sourcePath
 * @param {string} rule The rule text that failed.
 * @returns {never}
 */
function raiseInvalid(kind, sourcePath, rule) {
  throw new SourceInvalidError(
    `The ${kind} at "${sourcePath}" fails validation.`,
    rule,
    'Fix the file, then run the command again.'
  );
}

/**
 * Split a table row of the shape "| a | b |" into trimmed cells.
 *
 * @param {string} line
 * @returns {string[]}
 */
function splitTableRow(line) {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((cell) => cell.trim());
}

/**
 * Validate a glossary file against contract section 7, five rules.
 *
 * @param {string} text
 * @param {string} sourcePath
 * @param {string} glossaryHarnessId The value the "**Harness:**" line must hold.
 * @returns {void}
 */
export function validateGlossary(text, sourcePath, glossaryHarnessId) {
  const lines = text.split('\n');

  // Rule 1: the first non-empty line is one H1.
  const firstLine = lines.find((l) => l.trim() !== '');
  if (!firstLine || !/^# [^#]/.test(firstLine.trim())) {
    raiseInvalid('glossary', sourcePath, 'Rule 1: the first non-empty line must be one H1 title.');
  }

  // Rule 2: a "**Harness:**" line holds a kebab-case value that equals
  // glossaryHarnessId.
  const harnessLine = lines.find((l) => l.trim().startsWith('**Harness:**'));
  if (!harnessLine) {
    raiseInvalid('glossary', sourcePath, 'Rule 2: no "**Harness:**" line.');
  }
  const harnessValue = harnessLine.trim().slice('**Harness:**'.length).trim();
  if (!KEBAB_RE.test(harnessValue)) {
    raiseInvalid(
      'glossary',
      sourcePath,
      `Rule 2: the "**Harness:**" value "${harnessValue}" is not kebab-case.`
    );
  }
  if (harnessValue !== glossaryHarnessId) {
    raiseInvalid(
      'glossary',
      sourcePath,
      `Rule 2: the "**Harness:**" value "${harnessValue}" does not equal the adapter id "${glossaryHarnessId}".`
    );
  }

  // Rule 3: a "## Term map" section holds a table with the right header.
  const termMapIndex = lines.findIndex((l) => l.trim() === '## Term map');
  if (termMapIndex === -1) {
    raiseInvalid('glossary', sourcePath, 'Rule 3: no "## Term map" section.');
  }

  let headerIndex = -1;
  for (let i = termMapIndex + 1; i < lines.length; i++) {
    if (lines[i].trim().startsWith('##')) break;
    if (lines[i].trim().startsWith('|')) {
      headerIndex = i;
      break;
    }
  }
  if (headerIndex === -1) {
    raiseInvalid('glossary', sourcePath, 'Rule 3: the "## Term map" section holds no table.');
  }

  const headerCells = splitTableRow(lines[headerIndex]);
  if (headerCells[0] !== 'Neutral term' || headerCells[1] !== 'This harness') {
    raiseInvalid(
      'glossary',
      sourcePath,
      'Rule 3: the table header must read "Neutral term" and "This harness".'
    );
  }

  // Rule 4: the left column holds every canonical term in order, no
  // extra row. Row headerIndex + 1 is the "| --- | --- |" separator.
  const rows = [];
  for (let i = headerIndex + 2; i < lines.length; i++) {
    if (!lines[i].trim().startsWith('|')) break;
    rows.push(splitTableRow(lines[i])[0]);
  }

  const missingTerm = CANONICAL_TERMS.find((t) => !rows.includes(t));
  if (missingTerm) {
    raiseInvalid(
      'glossary',
      sourcePath,
      `Rule 4: the term map is missing the term "${missingTerm}".`
    );
  }
  const extraRow = rows.find((r) => !CANONICAL_TERMS.includes(r));
  if (extraRow) {
    raiseInvalid('glossary', sourcePath, `Rule 4: the term map holds an extra row "${extraRow}".`);
  }
  if (rows.length !== CANONICAL_TERMS.length) {
    raiseInvalid(
      'glossary',
      sourcePath,
      `Rule 4: the term map holds ${rows.length} row(s), expected ${CANONICAL_TERMS.length}.`
    );
  }
  for (let i = 0; i < CANONICAL_TERMS.length; i++) {
    if (rows[i] !== CANONICAL_TERMS[i]) {
      raiseInvalid(
        'glossary',
        sourcePath,
        `Rule 4: row ${i + 1} reads "${rows[i]}", expected the term "${CANONICAL_TERMS[i]}" in canonical order.`
      );
    }
  }

  // Rule 5: a "## Notes" heading exists.
  if (!lines.some((l) => l.trim() === '## Notes')) {
    raiseInvalid('glossary', sourcePath, 'Rule 5: no "## Notes" heading.');
  }
}

/**
 * Validate a command skill's SKILL.md against contract section 4.
 *
 * @param {string} text
 * @param {string} sourcePath
 * @param {string} folderName
 * @returns {void}
 */
export function validateSkill(text, sourcePath, folderName) {
  const parsed = splitFrontmatter(text);
  if (!parsed) {
    raiseInvalid('skill', sourcePath, 'Rule 1: the file has no frontmatter block.');
  }
  const { data } = parsed;

  if (!('name' in data)) {
    raiseInvalid('skill', sourcePath, 'Rule 2: no "name" key in the frontmatter.');
  }
  if (data.name !== folderName) {
    raiseInvalid(
      'skill',
      sourcePath,
      `Rule 2: "name: ${data.name}" does not equal the folder name "${folderName}".`
    );
  }
  if (!KEBAB_RE.test(data.name)) {
    raiseInvalid('skill', sourcePath, `Rule 3: "name: ${data.name}" is not kebab-case.`);
  }
  if (data['user-invocable'] !== 'true') {
    raiseInvalid('skill', sourcePath, 'Rule 4: "user-invocable" does not read "true".');
  }
}

/**
 * Validate a shipped agent file. Only the "name" rule applies.
 *
 * @param {string} text
 * @param {string} sourcePath
 * @param {string} stem The file basename with no ".md" extension.
 * @returns {void}
 */
export function validateAgent(text, sourcePath, stem) {
  const parsed = splitFrontmatter(text);
  if (!parsed) {
    raiseInvalid('agent', sourcePath, 'Rule 1: the file has no frontmatter block.');
  }
  const { data } = parsed;

  if (!('name' in data)) {
    raiseInvalid('agent', sourcePath, 'Rule 2: no "name" key in the frontmatter.');
  }
  if (data.name !== stem) {
    raiseInvalid(
      'agent',
      sourcePath,
      `Rule 2: "name: ${data.name}" does not equal the file stem "${stem}".`
    );
  }
}

/**
 * @param {Entry[]} entries
 * @param {string} pluginRoot
 * @param {string} glossaryHarnessId
 * @returns {void}
 */
function validateEntries(entries, pluginRoot, glossaryHarnessId) {
  for (const entry of entries) {
    if (entry.kind === 'skill' && entry.relPath === 'SKILL.md') {
      const absPath = path.join(pluginRoot, ...entry.sourcePath.split('/'));
      validateSkill(fs.readFileSync(absPath, 'utf8'), entry.sourcePath, entry.name);
    } else if (entry.kind === 'agent') {
      const absPath = path.join(pluginRoot, ...entry.sourcePath.split('/'));
      validateAgent(fs.readFileSync(absPath, 'utf8'), entry.sourcePath, entry.name);
    } else if (entry.kind === 'glossary') {
      const absPath = path.join(pluginRoot, ...entry.sourcePath.split('/'));
      validateGlossary(fs.readFileSync(absPath, 'utf8'), entry.sourcePath, glossaryHarnessId);
    }
  }
}

/**
 * Read and validate the plugin source.
 *
 * @param {{ pluginRoot: string, harnessId: string, glossaryHarnessId: string }} args
 * @returns {{ pluginRoot: string, version: string, entries: Entry[] }}
 */
export function readSource({ pluginRoot, harnessId, glossaryHarnessId }) {
  const templatesDir = path.join(pluginRoot, 'templates');
  requireDir(templatesDir, pluginRoot);

  const entries = [
    ...readSkills(pluginRoot),
    ...readAgents(pluginRoot),
    ...readFlat(pluginRoot, 'dev-docs', 'dev-doc'),
    ...readFlat(pluginRoot, 'formats', 'format'),
    readGlossary(pluginRoot, harnessId),
  ];

  validateEntries(entries, pluginRoot, glossaryHarnessId);

  const version = readVersion(pluginRoot);

  return { pluginRoot, version, entries };
}
