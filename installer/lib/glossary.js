// installer/lib/glossary.js
//
// Composes ".beast-mode/harness.md" from the glossary of every harness in
// the shared version marker, per implementation.md section 3.2. The core
// owns the composed file. It carries no manifest entry, and the plan gives
// it the kind "shared".
//
// The one-harness base case returns the source bytes and nothing else, so a
// project with one harness holds a file that is byte-identical to
// "templates/harness/<id>.md". That byte identity keeps the upgrade of a
// 5.3.0 project quiet.
//
// The composed text depends on the harness set alone. It holds no
// timestamp, because a timestamp would change the bytes on every run: row
// S3 would then replace the file and create a backup directory on every
// upgrade of a multi-harness project. The run timestamp lives in
// ".beast-mode/version.json" instead.
//
// This module holds no harness name and no harness path. The caller passes
// the harness set in.

import fs from 'node:fs';
import path from 'node:path';

import { validateGlossary } from './source.js';

/** The marker line that opens one section of a composed glossary. */
const MARKER_OPEN = '<!-- beast-mode:harness ';
const MARKER_CLOSE = ' -->';

/** Every marker line of a composed glossary, with its adapter id. */
const MARKER_RE = /^<!-- beast-mode:harness ([a-z0-9]+(?:-[a-z0-9]+)*) -->$/gm;

/** The paragraph that tells a model which section to read. */
const PREAMBLE_BODY = `This project holds a Beast Mode install for more than one harness. One section below
belongs to each harness. Read the section of the harness that you run in. Ignore every
other section. To find your section, look at the directory that holds the skill that you
run now. Use only the tools of your own section.`;

/**
 * @typedef {Object} Section
 * @property {string | null} id The adapter id. Null for a parsed one-harness file.
 * @property {string} [harnessRoot] Project-relative, forward slashes. The preamble names it.
 * @property {string} text The source glossary text.
 */

/**
 * End a text with exactly one newline (format rule 4).
 *
 * @param {string} text
 * @returns {string}
 */
function oneTrailingNewline(text) {
  return `${text.replace(/\n+$/, '')}\n`;
}

/**
 * @param {string} id
 * @returns {string} The marker line of one section.
 */
function markerLine(id) {
  return `${MARKER_OPEN}${id}${MARKER_CLOSE}`;
}

/**
 * Sort a section list by adapter id (format rule 2).
 *
 * @param {Section[]} sections
 * @returns {Section[]} A new array.
 */
function sorted(sections) {
  return [...sections].sort((a, b) => {
    const left = a.id ?? '';
    const right = b.id ?? '';
    return left < right ? -1 : left > right ? 1 : 0;
  });
}

/**
 * Build the preamble of a composed glossary. Names each harness as
 * "<adapter-id> (<harnessRoot>/)" (format rule 5).
 *
 * @param {Section[]} sections Already sorted.
 * @returns {string} Ends with exactly one newline.
 */
function preamble(sections) {
  const names = sections
    .map((section) => (section.harnessRoot ? `${section.id} (${section.harnessRoot}/)` : section.id))
    .join(', ');

  return (
    `# Harness Glossary - ${sections.length} harnesses\n` +
    '\n' +
    `**Harnesses:** ${names}\n` +
    '\n' +
    `${PREAMBLE_BODY}\n`
  );
}

/**
 * Compose the shared glossary text of one harness set, per the seven format
 * rules of implementation.md section 3.2.
 *
 * One section returns its source text unchanged, with no preamble and no
 * marker line. Two or more sections return the preamble, then one section
 * per harness in adapter id sort order. An empty list returns an empty
 * string, and the caller then falls back to the source glossary of the
 * harness it runs for.
 *
 * @param {Section[]} sections
 * @returns {string}
 */
export function compose(sections) {
  if (!Array.isArray(sections) || sections.length === 0) return '';
  if (sections.length === 1) return sections[0].text;

  const ordered = sorted(sections);
  const parts = [preamble(ordered)];
  for (const section of ordered) {
    parts.push(`${markerLine(section.id)}\n\n${oneTrailingNewline(section.text)}`);
  }

  // Every part ends with exactly one newline, so this join puts exactly one
  // blank line between the preamble and the first marker line, and between
  // one section text and the next marker line (format rules 3 and 4).
  return parts.join('\n');
}

/**
 * Split a composed glossary back into its sections. The exact inverse of
 * compose(): parse(compose(x)) returns the section texts of x, in adapter
 * id sort order (format rule 7).
 *
 * A text with no marker line is the one-harness base case. It returns one
 * section whose text is the whole input. The adapter id is not part of the
 * source bytes there, so that section carries a null id.
 *
 * @param {string} text
 * @returns {Section[]}
 */
export function parse(text) {
  MARKER_RE.lastIndex = 0;
  const marks = [];
  let match = MARKER_RE.exec(text);
  while (match !== null) {
    marks.push({ id: match[1], start: match.index, end: match.index + match[0].length });
    match = MARKER_RE.exec(text);
  }

  if (marks.length === 0) return [{ id: null, text }];

  const sections = [];
  for (let i = 0; i < marks.length; i++) {
    // compose() writes the marker line, one blank line, then the text.
    let start = marks[i].end;
    if (text.startsWith('\n\n', start)) start += 2;
    else if (text.startsWith('\n', start)) start += 1;

    // The last section runs to the end. Every other one stops one newline
    // before the next marker line: that newline is the blank line the join
    // put between the two parts.
    const stop = i + 1 < marks.length ? Math.max(start, marks[i + 1].start - 1) : text.length;
    sections.push({ id: marks[i].id, text: oneTrailingNewline(text.slice(start, stop)) });
  }
  return sections;
}

/**
 * Read one source glossary per harness of a set, and validate each one
 * against contract section 7.
 *
 * A harness this plugin version ships no adapter for, a missing source
 * file, and a source that fails validation each produce one note, and that
 * harness contributes no section. A second harness therefore never blocks
 * the harness that the run installs or upgrades: its own source still goes
 * through readSource(), which exits 1 on a bad glossary.
 *
 * @param {{ pluginRoot: string, harnesses: import('./marker.js').Harness[] }} args
 * @returns {{ sections: Section[], notes: string[] }}
 */
export function readSections({ pluginRoot, harnesses }) {
  /** @type {Section[]} */
  const sections = [];
  /** @type {string[]} */
  const notes = [];

  for (const harness of [...harnesses].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    if (!harness.glossaryHarnessId) {
      notes.push(
        `This plugin version ships no adapter for the harness "${harness.id}", ` +
          'so the composed glossary holds no section for it.'
      );
      continue;
    }

    const relPath = `templates/harness/${harness.id}.md`;
    const file = path.join(pluginRoot, ...relPath.split('/'));
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      notes.push(
        `The plugin holds no glossary at "${relPath}", ` +
          `so the composed glossary holds no section for the harness "${harness.id}".`
      );
      continue;
    }

    try {
      validateGlossary(text, relPath, harness.glossaryHarnessId);
    } catch (err) {
      notes.push(
        `The glossary at "${relPath}" fails validation, ` +
          `so the composed glossary holds no section for the harness "${harness.id}": ` +
          `${err instanceof Error ? err.message : String(err)}`
      );
      continue;
    }

    sections.push({ id: harness.id, harnessRoot: harness.harnessRoot, text });
  }

  return { sections, notes };
}
