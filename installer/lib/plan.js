// installer/lib/plan.js
//
// The render and install pipeline of implementation.md section 3.4:
//   source -> adapter -> plan -> apply -> manifest
//
// This module holds no harness name and no harness path. The harness root
// comes from the adapter, through adapter.harnessRoot and through the
// destinations adapter.destination() returns. The core maps a "dev-doc"
// entry to ".beast-mode/templates/<file>" and a "format" entry to
// ".beast-mode/<file>", because ".beast-mode" is the one shared root every
// harness reads.
//
// The shared glossary at ".beast-mode/harness.md" is not a source-backed
// file any more. render() synthesizes it with the kind "shared", from the
// text lib/glossary.js composed for the whole harness set. It carries no
// manifest entry, and planUpgrade() decides it with the three shared rows.
//
// This file owns both planners. planInstall() holds the install skip rules
// and planUpgrade() holds the upgrade decision table of section 3.5. One
// module owns both, so the two rule sets cannot drift.

import fs from 'node:fs';
import path from 'node:path';

import { InstallRefusedError, WriteFailureError } from './errors.js';
import { join as joinFrontmatter, split as splitFrontmatter } from './frontmatter.js';
import { sha256 } from './manifest.js';

/** @typedef {import('../adapters/index.js').Adapter} Adapter */
/** @typedef {import('./source.js').Entry} Entry */

/**
 * @typedef {Object} RenderedFile
 * @property {string} destination Project-relative, forward slashes.
 * @property {string | null} source Plugin-relative, forward slashes. Null for a synthesized file.
 * @property {string | Buffer} content
 * @property {'skill'|'agent'|'dev-doc'|'format'|'shared'|'extra'} kind
 * @property {string} name
 */

/** The destination of the shared, core-composed harness glossary. */
export const GLOSSARY_DESTINATION = '.beast-mode/harness.md';

/**
 * Map one source Entry to its core-owned destination. Returns null for a
 * kind the core drops. A "glossary" entry drops here: the core composes the
 * shared glossary from the whole harness set, and render() pushes it as one
 * synthesized "shared" action instead. Runs adapter.destination() for
 * "skill" and "agent" entries only, per rule 3 of section 3.2.
 *
 * @param {Entry} entry
 * @param {Adapter} adapter
 * @returns {string | null}
 */
function coreDestination(entry, adapter) {
  switch (entry.kind) {
    case 'dev-doc':
      return `.beast-mode/templates/${entry.relPath}`;
    case 'format':
      return `.beast-mode/${entry.relPath}`;
    case 'glossary':
      return null;
    case 'skill':
    case 'agent':
      return adapter.destination(entry);
    default:
      return null;
  }
}

/**
 * Render one entry's content. Takes the byte-identical fast path when the
 * adapter's frontmatter map and body transform both leave the source
 * unchanged, so a copy-shaped adapter (Claude) never risks a YAML round
 * trip. Otherwise splits the source with lib/frontmatter.js and applies the
 * adapter's body transform.
 *
 * A null return from mapFrontmatter() keeps the source header bytes and
 * joins no YAML: the joined text is the exact source frontmatter block plus
 * the new body. A scalar re-serialization could otherwise drop a quote pair
 * that the source needed, so an adapter that changes the body but not the
 * frontmatter takes this byte-preserving path instead of a real join.
 *
 * @param {Entry} entry
 * @param {string} sourceText
 * @param {Buffer} sourceBuffer
 * @param {Adapter} adapter
 * @returns {string | Buffer}
 */
function renderContent(entry, sourceText, sourceBuffer, adapter) {
  const frontmatterProbe = adapter.mapFrontmatter(entry, undefined);
  const bodyProbe = adapter.renderBody(entry, sourceText);

  if (frontmatterProbe === null && bodyProbe === sourceText) {
    return sourceBuffer;
  }

  const parsed = splitFrontmatter(sourceText);
  if (!parsed) {
    // The adapter asked to change the frontmatter or the body, but the
    // source carries no frontmatter block. Run the body transform on the
    // raw text only; the adapter never sees a frontmatter object here.
    return adapter.renderBody(entry, sourceText);
  }

  const mappedData = adapter.mapFrontmatter(entry, parsed.data);
  const body = adapter.renderBody(entry, parsed.body);

  if (mappedData === null) {
    return `---\n${parsed.raw}\n---\n${body}`;
  }

  return joinFrontmatter(mappedData, body);
}

/**
 * Read the source glossary bytes of the running harness. Returns null when
 * the source holds no glossary entry.
 *
 * @param {{ pluginRoot: string, entries: Entry[] }} source
 * @returns {Buffer | null}
 */
function readSourceGlossary(source) {
  const entry = source.entries.find((item) => item.kind === 'glossary');
  if (!entry) return null;
  return fs.readFileSync(path.join(source.pluginRoot, ...entry.sourcePath.split('/')));
}

/**
 * Render every source entry through the adapter, then the shared harness
 * glossary, then the adapter's extra files.
 *
 * The shared glossary is one core-synthesized action with the kind
 * "shared", at ".beast-mode/harness.md", with no source path and no
 * manifest entry. The caller passes the composed text of the whole harness
 * set as glossaryText. With no glossaryText, render() falls back to the
 * source glossary bytes of the running harness, which is the one-harness
 * base case of section 3.2, byte for byte.
 *
 * @param {{
 *   source: { pluginRoot: string, version: string, entries: Entry[] },
 *   adapter: Adapter,
 *   glossaryText?: string | null,
 * }} args
 * @returns {{ rendered: RenderedFile[], skillNames: string[] }}
 */
export function render({ source, adapter, glossaryText = null }) {
  const skillNameSet = new Set();
  for (const entry of source.entries) {
    if (entry.kind === 'skill') skillNameSet.add(entry.name);
  }
  const skillNames = [...skillNameSet].sort();

  /** @type {RenderedFile[]} */
  const rendered = [];

  for (const entry of source.entries) {
    const destination = coreDestination(entry, adapter);
    if (destination == null) continue;

    const absSource = path.join(source.pluginRoot, ...entry.sourcePath.split('/'));
    const sourceBuffer = fs.readFileSync(absSource);
    const sourceText = sourceBuffer.toString('utf8');
    const content = renderContent(entry, sourceText, sourceBuffer, adapter);

    rendered.push({
      destination,
      source: entry.sourcePath,
      content,
      kind: entry.kind,
      name: entry.name,
    });
  }

  const glossaryContent =
    typeof glossaryText === 'string' && glossaryText.length > 0
      ? glossaryText
      : readSourceGlossary(source);

  if (glossaryContent !== null) {
    rendered.push({
      destination: GLOSSARY_DESTINATION,
      source: null,
      content: glossaryContent,
      kind: 'shared',
      name: path.posix.basename(GLOSSARY_DESTINATION),
    });
  }

  for (const extra of adapter.extraFiles({ version: source.version })) {
    rendered.push({
      destination: extra.destination,
      source: null,
      content: extra.content,
      kind: 'extra',
      name: path.posix.basename(extra.destination),
    });
  }

  return { rendered, skillNames };
}

/**
 * @typedef {Object} PlanAction
 * @property {string} destination
 * @property {string | null} source
 * @property {string | Buffer} content
 * @property {'skill'|'agent'|'dev-doc'|'format'|'shared'|'extra'} kind
 * @property {string} name
 * @property {'write'|'overwrite'|'skip'} action
 * @property {string} [reason]
 */

/**
 * The always-overwrite kinds: the shared harness glossary and every
 * synthesized extra file (for example the version marker). Beast Mode owns
 * both, and the plugin's copy always wins.
 *
 * @param {RenderedFile} item
 * @returns {boolean}
 */
function alwaysOverwrites(item) {
  return item.kind === 'shared' || item.kind === 'extra';
}

/**
 * Find, for each skill name, the destination of its SKILL.md marker file.
 * The marker is the one rendered file of that skill whose destination ends
 * in "/SKILL.md". This avoids hard-coding a "skills" subfolder here: the
 * marker path comes entirely from what adapter.destination() already
 * produced during render().
 *
 * @param {RenderedFile[]} rendered
 * @returns {Map<string, string>} skill name -> marker destination
 */
function skillMarkers(rendered) {
  const markers = new Map();
  for (const item of rendered) {
    if (item.kind === 'skill' && item.destination.endsWith('/SKILL.md')) {
      markers.set(item.name, item.destination);
    }
  }
  return markers;
}

/**
 * @param {string} projectRoot
 * @param {string} relDestination Project-relative, forward slashes.
 * @returns {boolean}
 */
function existsOnDisk(projectRoot, relDestination) {
  return fs.existsSync(path.join(projectRoot, ...relDestination.split('/')));
}

/**
 * The .gitignore step of a plan. "create" is true for a project that holds
 * no .gitignore yet. "lines" holds every owned line that the file misses
 * today, in block order, and "append" is true exactly when that list holds
 * a line. "needsHeader" is true only when the file holds no block header
 * line, so a project of an earlier version gains one header, never two.
 *
 * @typedef {Object} GitignoreState
 * @property {boolean} create
 * @property {'append'|'already'} appendAction
 * @property {boolean} needsHeader
 * @property {string[]} lines
 */

/** The header line of the Beast Mode block inside a project .gitignore. */
export const GITIGNORE_HEADER = '# Beast Mode - Backups';

/** The project directory that holds the phase briefs. */
const BRIEFS_LINE = '.beast-mode/briefs/';

/**
 * Normalize one .gitignore line for the presence test: drop the surrounding
 * space, drop a leading slash, and drop a trailing slash. The three forms
 * ".beast-mode/briefs", ".beast-mode/briefs/", and "/.beast-mode/briefs/"
 * then read as the same rule, and a CRLF file reads like an LF file.
 *
 * @param {string} line
 * @returns {string}
 */
function normalizeIgnoreLine(line) {
  return line.trim().replace(/^\/+/, '').replace(/\/+$/, '');
}

/**
 * The .gitignore lines that Beast Mode owns for one harness, in write order.
 * Each rule holds the line to write, and the test that reads one normalized
 * line of the project file.
 *
 * The first rule ignores the backup directory of this harness. Its test
 * reads a prefix, because an earlier version or a user may write another
 * glob after the timestamp part. The second rule ignores the phase briefs,
 * which a delegator command writes. Its test reads the whole line. Both
 * paths hold derived data. Every other path under ".beast-mode/" stays in
 * version control, so the block names these two paths only.
 *
 * @param {string} harnessRoot Project-relative harness root, one adapter's own root path.
 * @returns {{ line: string, holds: (candidate: string) => boolean }[]}
 */
function ownedIgnoreRules(harnessRoot) {
  const backupPrefix = `${harnessRoot}/.beast-mode-backup-`;
  const briefs = normalizeIgnoreLine(BRIEFS_LINE);
  return [
    { line: `${backupPrefix}*/`, holds: (candidate) => candidate.startsWith(backupPrefix) },
    { line: BRIEFS_LINE, holds: (candidate) => candidate === briefs },
  ];
}

/**
 * The owned lines that a .gitignore text does not hold yet, in block order.
 * The test reads one line at a time, not the whole text, for three reasons.
 * A project that holds the backup line of an earlier version gains the
 * briefs line on the next upgrade. A second harness gains its own backup
 * line. A second pass of either harness appends no duplicate line.
 *
 * @param {string} text The current .gitignore text, or "" for a missing file.
 * @param {string} harnessRoot Project-relative harness root, one adapter's own root path.
 * @returns {string[]}
 */
function missingGitignoreLines(text, harnessRoot) {
  const present = text.split('\n').map(normalizeIgnoreLine);
  return ownedIgnoreRules(harnessRoot)
    .filter((rule) => !present.some(rule.holds))
    .map((rule) => rule.line);
}

/**
 * The index of the last Beast Mode block header inside the lines of one
 * .gitignore, or -1 for a file that holds no header. The test drops the
 * surrounding space, so an indented header and a CRLF file read like a
 * plain header line. The reader takes the last header, because the writer
 * then adds a line to the newest block of a file that already holds two.
 *
 * @param {string[]} rows The lines of the project file.
 * @returns {number}
 */
function gitignoreHeaderIndex(rows) {
  return rows.findLastIndex((row) => row.trim() === GITIGNORE_HEADER);
}

/**
 * True when one .gitignore line reads as a line of the Beast Mode block:
 * the backup directory of any harness, or the phase briefs directory. The
 * writer walks the lines under the header with this test, so it finds the
 * end of the block of a project with one harness and of a project with two.
 *
 * @param {string} row One line of the project file.
 * @returns {boolean}
 */
function isOwnedIgnoreLine(row) {
  const candidate = normalizeIgnoreLine(row);
  if (candidate === '') return false;
  return (
    candidate.includes('.beast-mode-backup-') || candidate === normalizeIgnoreLine(BRIEFS_LINE)
  );
}

/**
 * The next .gitignore text, after the writer adds the owned lines that the
 * file misses. The function is pure, so a test reads the result of one
 * state and needs no file.
 *
 * The writer takes one of three paths:
 *   - The file holds no header. The writer appends a blank line, the
 *     header, and the missing lines. The block opens with a newline, so a
 *     file that ends with no newline keeps its last line intact.
 *   - The file holds the header, and at least one owned line sits under it.
 *     The writer puts the missing lines directly under the last owned line
 *     of that block. It writes no second header.
 *   - The file holds the header, and no owned line sits under it. The shape
 *     of the block is unknown, so the writer appends the missing lines at
 *     the end of the file. It writes no second header.
 *
 * @param {string} text The current .gitignore text, or "" for a new file.
 * @param {GitignoreState} state The .gitignore step of a plan.
 * @returns {string}
 */
export function addGitignoreLines(text, state) {
  if (state.lines.length === 0) return text;

  const rows = text.split('\n');
  const headerAt = gitignoreHeaderIndex(rows);
  if (headerAt === -1) {
    return `${text}\n${GITIGNORE_HEADER}\n${state.lines.join('\n')}\n`;
  }

  let lastOwned = -1;
  for (let i = headerAt + 1; i < rows.length && isOwnedIgnoreLine(rows[i]); i += 1) {
    lastOwned = i;
  }
  if (lastOwned === -1) {
    return `${text}\n${state.lines.join('\n')}\n`;
  }

  // A CRLF file keeps its line ending, because the new rows copy the ending
  // of the last owned row of the block.
  const ending = rows[lastOwned].endsWith('\r') ? '\r' : '';
  rows.splice(lastOwned + 1, 0, ...state.lines.map((line) => `${line}${ending}`));
  return rows.join('\n');
}

/**
 * Build the install plan: one action per destination, plus the .gitignore
 * action, the directories to create, and the summary counts.
 *
 * Skip rules mirror the Beast Mode 5.0.0 bash installer, which this CLI
 * replaced:
 *   - A skill is skipped, whole folder, when its SKILL.md marker already
 *     exists on disk.
 *   - An existing agent, dev-doc template, or format reference is skipped.
 *   - The shared harness glossary and every extra file (the version marker)
 *     are always written, "write" when missing and "overwrite" when present.
 *
 * @param {{
 *   rendered: RenderedFile[],
 *   projectRoot: string,
 *   harnessRoot: string,
 *   manifest: import('./manifest.js').Manifest | null,
 *   includeGitignoreAndDocs?: boolean,
 * }} args
 * @returns {{
 *   actions: PlanAction[],
 *   gitignore: GitignoreState | null,
 *   dirs: string[],
 *   manifestPath: string,
 *   summary: Record<string, number>,
 * }}
 */
export function planInstall({ rendered, projectRoot, harnessRoot, manifest, includeGitignoreAndDocs = true }) {
  if (manifest) {
    throw new InstallRefusedError(
      'This project already holds a Beast Mode installation for this harness.',
      `A manifest already exists at "${manifest.harnessRoot}/.beast-mode-manifest.json".`,
      'Run "beast-mode upgrade" instead of "beast-mode install".'
    );
  }

  const markers = skillMarkers(rendered);
  const skippedSkills = new Set();
  for (const [name, marker] of markers) {
    if (existsOnDisk(projectRoot, marker)) {
      skippedSkills.add(name);
    }
  }

  /** @type {PlanAction[]} */
  const actions = [];

  for (const item of rendered) {
    if (item.kind === 'skill') {
      if (skippedSkills.has(item.name)) {
        actions.push({ ...item, action: 'skip', reason: 'the skill folder already exists' });
        continue;
      }
      const action = existsOnDisk(projectRoot, item.destination) ? 'overwrite' : 'write';
      actions.push({ ...item, action });
      continue;
    }

    if (alwaysOverwrites(item)) {
      const action = existsOnDisk(projectRoot, item.destination) ? 'overwrite' : 'write';
      actions.push({ ...item, action });
      continue;
    }

    // agent, dev-doc, format: skip when the file already exists.
    if (existsOnDisk(projectRoot, item.destination)) {
      actions.push({ ...item, action: 'skip', reason: 'the file already existed at install time' });
    } else {
      actions.push({ ...item, action: 'write' });
    }
  }

  const dirs = new Set();
  if (includeGitignoreAndDocs) {
    dirs.add('docs');
    dirs.add('docs/features');
  }
  for (const item of actions) {
    if (item.action === 'skip') continue;
    const parent = path.posix.dirname(item.destination);
    if (parent && parent !== '.') dirs.add(parent);
  }

  const gitignore = includeGitignoreAndDocs ? readGitignoreState(projectRoot, harnessRoot) : null;

  const summary = summarize(actions);

  return {
    mode: 'install',
    actions,
    gitignore,
    dirs: [...dirs].sort(),
    manifestPath: path.posix.join(harnessRoot, '.beast-mode-manifest.json'),
    summary,
  };
}

/**
 * @param {PlanAction[]} actions
 * @returns {Record<string, number>}
 */
function summarize(actions) {
  const skillNames = new Set();
  const skippedSkillNames = new Set();
  let agents = 0;
  let agentsSkipped = 0;
  let devDocs = 0;
  let devDocsSkipped = 0;
  let formats = 0;
  let formatsSkipped = 0;

  for (const item of actions) {
    if (item.kind === 'skill') {
      if (item.action === 'skip') skippedSkillNames.add(item.name);
      else skillNames.add(item.name);
    } else if (item.kind === 'agent') {
      if (item.action === 'skip') agentsSkipped += 1;
      else agents += 1;
    } else if (item.kind === 'dev-doc') {
      if (item.action === 'skip') devDocsSkipped += 1;
      else devDocs += 1;
    } else if (item.kind === 'format') {
      if (item.action === 'skip') formatsSkipped += 1;
      else formats += 1;
    }
  }

  return {
    skillsWritten: skillNames.size,
    skillsSkipped: skippedSkillNames.size,
    agentsWritten: agents,
    agentsSkipped,
    devDocsWritten: devDocs,
    devDocsSkipped,
    formatsWritten: formats,
    formatsSkipped,
  };
}

/**
 * @param {PlanAction[]} actions
 * @param {string} kind
 * @returns {PlanAction[]}
 */
function byKind(actions, kind) {
  return actions.filter((a) => a.kind === kind);
}

/**
 * Print a dry-run plan. Dispatches on the plan mode, so one call site in
 * lib/apply.js covers install, render, and upgrade.
 *
 * @param {ReturnType<typeof planInstall> | ReturnType<typeof planUpgrade>} plan
 * @param {ReturnType<typeof import('./report.js').createReporter>} reporter
 * @param {{ backupDir?: string | null }} [opts] The backup directory the run
 *   would use. lib/apply.js owns the name, so it passes the value in.
 * @returns {void}
 */
export function printPlan(plan, reporter, opts = {}) {
  if (plan.mode === 'upgrade') {
    printUpgradePlan(/** @type {ReturnType<typeof planUpgrade>} */ (plan), reporter, opts);
    return;
  }
  printInstallPlan(/** @type {ReturnType<typeof planInstall>} */ (plan), reporter);
}

/**
 * Print the install dry-run plan, grouped under the section headings of
 * the Beast Mode 5.0.0 bash installer, which this CLI replaced. A skill
 * prints one line per skill folder, not one per file, to match the bash
 * summary.
 *
 * @param {ReturnType<typeof planInstall>} plan
 * @param {ReturnType<typeof import('./report.js').createReporter>} reporter
 * @returns {void}
 */
function printInstallPlan(plan, reporter) {
  if (plan.dirs.length > 0) {
    reporter.section('📁 Creating directory structure...');
    for (const dir of plan.dirs) {
      reporter.info(`Would create: ${dir}/`);
    }
  }

  reporter.section('📋 Installing command skills...');
  const skillActions = byKind(plan.actions, 'skill');
  const printedSkills = new Set();
  for (const item of skillActions) {
    if (printedSkills.has(item.name)) continue;
    printedSkills.add(item.name);
    if (item.action === 'skip') {
      reporter.warn(`Skipped (already exists): ${item.destination}`);
    } else {
      const folder = path.posix.dirname(item.destination);
      reporter.ok(`Would copy: ${folder}/`);
    }
  }
  reporter.ok(`Would install ${plan.summary.skillsWritten} command skills`);

  reporter.section('🤖 Installing agent templates...');
  printFileActions(byKind(plan.actions, 'agent'), reporter);
  const { agentsWritten } = plan.summary;
  reporter.ok(`Would install ${agentsWritten} agent templates`);

  reporter.section('📝 Installing feature doc templates...');
  printFileActions(byKind(plan.actions, 'dev-doc'), reporter);
  reporter.ok(`Would install ${plan.summary.devDocsWritten} feature doc templates`);

  reporter.section('📚 Installing format references...');
  printFileActions(byKind(plan.actions, 'format'), reporter);
  reporter.ok(`Would install ${plan.summary.formatsWritten} format references`);

  reporter.section('🧭 Composing the harness glossary...');
  printFileActions(byKind(plan.actions, 'shared'), reporter);

  if (plan.gitignore) {
    reporter.section('📄 Updating .gitignore...');
    if (plan.gitignore.create) reporter.ok('Would create .gitignore');
    if (plan.gitignore.appendAction === 'append') {
      reporter.ok('Would add Beast Mode entries to .gitignore');
    } else {
      reporter.info('Beast Mode entries already in .gitignore');
    }
  }

  reporter.section('📝 Writing version file...');
  printFileActions(byKind(plan.actions, 'extra'), reporter);

  reporter.line();
  reporter.info(`Manifest would be written to: ${plan.manifestPath}`);
}

/**
 * @param {PlanAction[]} items
 * @param {ReturnType<typeof import('./report.js').createReporter>} reporter
 * @returns {void}
 */
function printFileActions(items, reporter) {
  for (const item of items) {
    if (item.action === 'skip') {
      reporter.warn(`Skipped (already exists): ${item.destination}`);
    } else if (item.action === 'overwrite') {
      reporter.ok(`Would overwrite: ${item.destination}`);
    } else {
      reporter.ok(`Would copy: ${item.destination}`);
    }
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// The upgrade decision table (implementation.md section 3.5)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//
// Three hashes drive every decision:
//   M  the sha256 the old manifest holds for the destination, when the
//      manifest marks the destination owned. Null otherwise.
//   D  the sha256 of the file on disk. Null when the file is missing.
//      Every destination reads the disk once, through a cached reader.
//   S  the sha256 of the content the CLI would write now.
//
// Every row of the table below is one named branch, in table order. A row
// that no branch implements is a missing branch, not a covered case.
//
//   | Row | Manifest entry       | On disk | Test              | Action           |
//   |  1  | owned                | missing | -                 | write (restored) |
//   |  2  | owned                | present | D = M and D = S   | none             |
//   |  3  | owned                | present | D = M and D != S  | overwrite        |
//   |  4  | owned                | present | D != M            | conflict         |
//   |  5  | owned                | present | D != M, --force   | force            |
//   |  6  | not owned            | missing | -                 | write (added)    |
//   |  7  | not owned            | present | D = S             | adopt            |
//   |  8  | not owned            | present | D != S            | skip (yours)     |
//   |  9  | not owned            | present | D != S, --force   | force            |
//   | 10  | in manifest, no src  | present | D = M             | prune            |
//   | 11  | in manifest, no src  | present | D != M            | keep             |
//   | 12  | in manifest, no src  | missing | -                 | drop             |
//   | 13  | no entry, src exists | missing | -                 | write (added)    |
//   | 14  | no entry, src exists | present | D = S             | adopt            |
//   | 15  | no entry, src exists | present | D != S            | skip (yours)     |
//   | 16  | no entry, src exists | present | D != S, --force   | force            |
//
// The shared harness glossary leaves this table (section 3.3). The core
// composes it from the whole harness set, it carries no manifest entry, and
// three rows decide it. A shared row reads no manifest, so it can never
// report "Skipped (you edited it)", which is the CR-4 defect it closes.
//
//   | Row | On disk | Test    | Action                 | Label      | Bucket   |
//   | S1  | missing | -       | write                  | 🆕 Added   | added    |
//   | S2  | present | D = S   | none                   | quiet      | upToDate |
//   | S3  | present | D != S  | overwrite, back up 1st | ✅ Updated | updated  |
//
// Four rules hold across the three shared rows:
//   1. A shared row never reads the manifest, so it holds no conflict.
//   2. A shared row never reaches the stale pass, because render() produced
//      the destination and the rendered loop marked it handled. A 5.3.0
//      manifest entry for the glossary therefore produces no prune, no
//      keep, and no drop count. It simply does not reach the new manifest.
//   3. "--force" reaches no shared row. Beast Mode always owns the file.
//   4. Row S3 uses the action "overwrite", so needsBackup() copies the old
//      file into the backup directory before the run replaces it.
//
// Data safety rules that hold across every branch:
//   1. The CLI never deletes or overwrites a file whose hash it did not
//      read first. Every destructive branch compares D against M or S.
//   2. Every doubt resolves to a skip or a keep, with a report.
//   3. "--force" reaches a skip only: the conflict of row 4, and the
//      "skip (yours)" of rows 8 and 15. Every forced write backs the old
//      copy up first, so the user can always get the old file back.
//   4. "--force" never reaches a keep, because a keep names a file the
//      plugin stopped shipping, and the user is the only owner left. It
//      never reaches a prune or a drop either, because those two rows
//      decide on a hash, not on a flag.

/** The report label of each table row. */
export const LABELS = {
  restored: '🆕 Restored',
  updated: '✅ Updated',
  conflict: '⏭️ Skipped (you edited it)',
  forced: '✅ Forced',
  added: '🆕 Added',
  adopted: '✓ Adopted',
  skipped: '⏭️ Skipped (yours)',
  pruned: '🗑️ Pruned',
  kept: '⚠ Kept (you edited it)',
};

/** The manifest reason of a destination the upgrade left alone. */
export const REASON_EDITED = 'you edited it';
export const REASON_EXISTED = 'the file already existed';

/**
 * @typedef {Object} UpgradeAction
 * @property {string} destination Project-relative, forward slashes.
 * @property {string | null} source Plugin-relative, forward slashes.
 * @property {string | Buffer} [content] Absent for a prune, a keep, and a drop.
 * @property {'skill'|'agent'|'dev-doc'|'format'|'shared'|'extra'|'stale'} kind
 * @property {string} name
 * @property {'write'|'overwrite'|'none'|'conflict'|'force'|'adopt'|'skip'|'prune'|'keep'|'drop'} action
 * @property {string | null} label The report label, null when the row is quiet.
 * @property {string | null} bucket The summary count this action adds to.
 * @property {number | string} row The table row this action came from: 1 to 16,
 *   "S1" to "S3" for the shared glossary, or 0 for an extra file.
 * @property {string} [reason] The manifest reason for a skipped destination.
 * @property {string | null} [manifestHash] M.
 * @property {string | null} [diskHash] D.
 * @property {string} [contentHash] S.
 * @property {import('./manifest.js').ManifestFileEntry} [manifestEntry] The old entry.
 */

/**
 * The hash the manifest holds for a destination it owns. Returns null when
 * the entry is missing, when it reads "owned": false, or when it carries no
 * sha256. A malformed entry therefore reads as unknown ownership, which
 * takes the last four rows of the table. Those rows never delete, and they
 * overwrite only when the user passes "--force", so a broken manifest can
 * never destroy a file on its own.
 *
 * @param {import('./manifest.js').ManifestFileEntry | undefined} entry
 * @returns {string | null}
 */
function ownedHash(entry) {
  if (!entry) return null;
  if (entry.owned !== true) return null;
  if (typeof entry.sha256 !== 'string' || entry.sha256.length === 0) return null;
  return entry.sha256;
}

/**
 * Build a disk-hash reader that reads each destination once and caches the
 * result. Returns null for a missing file. Raises the write-failure error
 * when a directory sits where the CLI expects a file, so the run stops
 * before it writes anything.
 *
 * @param {string} projectRoot
 * @returns {(relDestination: string) => string | null}
 */
function createDiskReader(projectRoot) {
  /** @type {Map<string, string | null>} */
  const cache = new Map();

  return function diskHash(relDestination) {
    if (cache.has(relDestination)) return cache.get(relDestination);

    const full = path.join(projectRoot, ...relDestination.split('/'));
    let stat = null;
    try {
      stat = fs.statSync(full);
    } catch {
      cache.set(relDestination, null);
      return null;
    }

    if (stat.isDirectory()) {
      throw new WriteFailureError(
        `A directory sits where the CLI expects a file: "${relDestination}".`,
        'The upgrade cannot read, replace, or delete a directory as if it were a file.',
        'Move or remove that directory, then run the command again.'
      );
    }

    const hash = sha256(fs.readFileSync(full));
    cache.set(relDestination, hash);
    return hash;
  };
}

/**
 * Build one upgrade action.
 *
 * @param {Object} args
 * @returns {UpgradeAction}
 */
function makeAction(args) {
  return /** @type {UpgradeAction} */ (args);
}

/**
 * Build the upgrade plan: one action per rendered destination, one action
 * per manifest entry the source no longer produces, plus the directories,
 * the .gitignore step, the counts, and the skip list.
 *
 * A null manifest is the v5.0.0 fallback. Ownership is unknown for every
 * destination there, so every destination takes the last four rows of the
 * table. A no-manifest run holds no prune candidate at all, because nothing
 * proves that the CLI ever wrote a file in that project. "--force" still
 * works there, through row 16.
 *
 * @param {{
 *   rendered: RenderedFile[],
 *   projectRoot: string,
 *   harnessRoot: string,
 *   manifest: import('./manifest.js').Manifest | null,
 *   force?: boolean,
 *   includeGitignoreAndDocs?: boolean,
 * }} args
 * @returns {{
 *   mode: 'upgrade',
 *   actions: UpgradeAction[],
 *   gitignore: GitignoreState | null,
 *   dirs: string[],
 *   manifestPath: string,
 *   backupNeeded: boolean,
 *   noManifest: boolean,
 *   force: boolean,
 *   counts: Record<string, number>,
 *   skips: { destination: string, label: string }[],
 * }}
 */
export function planUpgrade({
  rendered,
  projectRoot,
  harnessRoot,
  manifest,
  force = false,
  includeGitignoreAndDocs = true,
}) {
  const noManifest = manifest === null || manifest === undefined;

  /** @type {Map<string, import('./manifest.js').ManifestFileEntry>} */
  const entries = new Map();
  if (!noManifest) {
    for (const entry of manifest.files ?? []) {
      entries.set(entry.destination, entry);
    }
  }

  const diskHash = createDiskReader(projectRoot);

  /** @type {UpgradeAction[]} */
  const actions = [];
  const handled = new Set();

  for (const item of rendered) {
    handled.add(item.destination);

    // An adapter's extra file (today only the version marker) is not a
    // manifest entry, so it has no M to compare against. The rule for an
    // extra file is: always write, never back up, never conflict.
    if (item.kind === 'extra') {
      actions.push(
        makeAction({
          ...item,
          action: 'write',
          label: null,
          bucket: null,
          row: 0,
          contentHash: sha256(item.content),
        })
      );
      continue;
    }

    // The shared harness glossary, rows S1 to S3. The core composes it from
    // the whole harness set, so it holds no manifest entry and this branch
    // reads no manifest. Two harnesses therefore never fight over the file,
    // and a 5.3.0 manifest entry for it cannot produce a conflict here. The
    // loop marked the destination handled above, so the stale pass leaves
    // that old entry alone as well, and it never reaches the new manifest.
    if (item.kind === 'shared') {
      const disk = diskHash(item.destination);
      const contentHash = sha256(item.content);
      const base = { ...item, manifestHash: null, diskHash: disk, contentHash };

      // Row S1. missing. Beast Mode owns the file, so put it there.
      if (disk === null) {
        actions.push(makeAction({ ...base, action: 'write', label: LABELS.added, bucket: 'added', row: 'S1' }));
        continue;
      }
      // Row S2. present, D = S. The composition produced the same bytes
      // that already sit on disk. Nothing to do, quiet.
      if (disk === contentHash) {
        actions.push(makeAction({ ...base, action: 'none', label: null, bucket: 'upToDate', row: 'S2' }));
        continue;
      }
      // Row S3. present, D != S. The harness set or the source glossary
      // changed. The action "overwrite" sends the old file through
      // needsBackup(), so the apply step copies it into the backup
      // directory before it writes the new bytes.
      actions.push(
        makeAction({ ...base, action: 'overwrite', label: LABELS.updated, bucket: 'updated', row: 'S3' })
      );
      continue;
    }

    const entry = entries.get(item.destination);
    const manifestHash = ownedHash(entry);
    const disk = diskHash(item.destination);
    const contentHash = sha256(item.content);
    const base = { ...item, manifestHash, diskHash: disk, contentHash };

    if (manifestHash !== null) {
      // Row 1. owned, missing. The user or another tool removed a file the
      // CLI wrote. Put it back.
      if (disk === null) {
        actions.push(makeAction({ ...base, action: 'write', label: LABELS.restored, bucket: 'restored', row: 1 }));
        continue;
      }

      if (disk === manifestHash) {
        // Row 2. owned, present, D = M and D = S. Nothing to do, quiet.
        if (disk === contentHash) {
          actions.push(makeAction({ ...base, action: 'none', label: null, bucket: 'upToDate', row: 2 }));
          continue;
        }
        // Row 3. owned, present, D = M and D != S. The hash proves Beast
        // Mode wrote this exact content and nobody changed it, so the
        // plugin's new copy wins. The apply step backs the old copy up.
        actions.push(makeAction({ ...base, action: 'overwrite', label: LABELS.updated, bucket: 'updated', row: 3 }));
        continue;
      }

      // Row 5. owned, present, D != M, --force. The user asked for the
      // plugin version. The apply step backs the old copy up first.
      if (force) {
        actions.push(makeAction({ ...base, action: 'force', label: LABELS.forced, bucket: 'forced', row: 5 }));
        continue;
      }

      // Row 4. owned, present, D != M. The user edited a file the CLI
      // wrote. Change nothing and report it.
      actions.push(
        makeAction({
          ...base,
          action: 'conflict',
          label: LABELS.conflict,
          bucket: 'skipped',
          row: 4,
          reason: REASON_EDITED,
          manifestEntry: entry,
        })
      );
      continue;
    }

    if (entry) {
      // Row 6. not owned, missing. The file the user had is gone, so the
      // plugin copy lands and Beast Mode owns it from now on.
      if (disk === null) {
        actions.push(makeAction({ ...base, action: 'write', label: LABELS.added, bucket: 'added', row: 6 }));
        continue;
      }
      // Row 7. not owned, present, D = S. The file already equals the
      // plugin copy, so mark it owned and write nothing.
      if (disk === contentHash) {
        actions.push(makeAction({ ...base, action: 'adopt', label: LABELS.adopted, bucket: 'adopted', row: 7 }));
        continue;
      }
      // Row 9. not owned, present, D != S, --force. The user asked for the
      // plugin version of a file Beast Mode does not own. The apply step
      // backs the old copy up first, so the old file stays reachable.
      if (force) {
        actions.push(makeAction({ ...base, action: 'force', label: LABELS.forced, bucket: 'forced', row: 9 }));
        continue;
      }
      // Row 8. not owned, present, D != S. The file is the user's.
      actions.push(
        makeAction({
          ...base,
          action: 'skip',
          label: LABELS.skipped,
          bucket: 'skipped',
          row: 8,
          reason: REASON_EXISTED,
        })
      );
      continue;
    }

    // Row 13. no entry, source exists, missing. This row also covers every
    // destination of a run with no manifest at all.
    if (disk === null) {
      actions.push(makeAction({ ...base, action: 'write', label: LABELS.added, bucket: 'added', row: 13 }));
      continue;
    }
    // Row 14. no entry, present, D = S. Equal content means Beast Mode
    // owns the file, so adopt it and write nothing.
    if (disk === contentHash) {
      actions.push(makeAction({ ...base, action: 'adopt', label: LABELS.adopted, bucket: 'adopted', row: 14 }));
      continue;
    }
    // Row 16. no entry, present, D != S, --force. This is the escape hatch
    // of a project that holds no manifest: every skip of such a run lands
    // on row 15, and "--force" takes the plugin version of each one, with a
    // backup first.
    if (force) {
      actions.push(makeAction({ ...base, action: 'force', label: LABELS.forced, bucket: 'forced', row: 16 }));
      continue;
    }
    // Row 15. no entry, present, D != S. The CLI cannot tell a user edit
    // from a plugin change since the last version, so it skips and reports.
    actions.push(
      makeAction({
        ...base,
        action: 'skip',
        label: LABELS.skipped,
        bucket: 'skipped',
        row: 15,
        reason: REASON_EXISTED,
      })
    );
  }

  // The stale pass: every manifest entry whose destination no rendered
  // entry produces any more. Rows 10, 11, and 12.
  for (const [destination, entry] of entries) {
    if (handled.has(destination)) continue;

    const manifestHash = ownedHash(entry);
    const name = path.posix.basename(destination);

    // An entry with no owned hash records a file the CLI never wrote. A
    // prune needs a hash to prove ownership, so the entry disappears and
    // the file on disk stays exactly as it is.
    if (manifestHash === null) {
      actions.push(
        makeAction({
          destination,
          source: entry.source ?? null,
          kind: 'stale',
          name,
          action: 'drop',
          label: null,
          bucket: 'dropped',
          row: 12,
          manifestHash: null,
          diskHash: null,
          manifestEntry: entry,
        })
      );
      continue;
    }

    const disk = diskHash(destination);
    const base = {
      destination,
      source: entry.source ?? null,
      kind: 'stale',
      name,
      manifestHash,
      diskHash: disk,
      manifestEntry: entry,
    };

    // Row 12. in manifest, source gone, missing. The entry disappears,
    // quiet.
    if (disk === null) {
      actions.push(makeAction({ ...base, action: 'drop', label: null, bucket: 'dropped', row: 12 }));
      continue;
    }
    // Row 10. in manifest, source gone, D = M. The hash proves Beast Mode
    // wrote the file and nobody changed it. The apply step backs it up,
    // then deletes it.
    if (disk === manifestHash) {
      actions.push(makeAction({ ...base, action: 'prune', label: LABELS.pruned, bucket: 'pruned', row: 10 }));
      continue;
    }
    // Row 11. in manifest, source gone, D != M. The user invested work in
    // this file, so it stays. "--force" never reaches this branch.
    actions.push(makeAction({ ...base, action: 'keep', label: LABELS.kept, bucket: 'kept', row: 11 }));
  }

  // An upgrade runs against a project that already holds most of the
  // layout, so the plan lists only the directories that are missing today.
  const dirs = new Set();
  const addMissingDir = (dir) => {
    if (!dir || dir === '.') return;
    if (fs.existsSync(path.join(projectRoot, ...dir.split('/')))) return;
    dirs.add(dir);
  };
  if (includeGitignoreAndDocs) {
    addMissingDir('docs');
    addMissingDir('docs/features');
  }
  for (const item of actions) {
    if (!writesContent(item)) continue;
    addMissingDir(path.posix.dirname(item.destination));
  }

  return {
    mode: 'upgrade',
    actions,
    gitignore: includeGitignoreAndDocs ? readGitignoreState(projectRoot, harnessRoot) : null,
    dirs: [...dirs].sort(),
    manifestPath: path.posix.join(harnessRoot, '.beast-mode-manifest.json'),
    backupNeeded: actions.some(needsBackup),
    noManifest,
    force,
    counts: countUpgradeActions(actions),
    skips: actions
      .filter((a) => a.action === 'conflict' || a.action === 'skip')
      .map((a) => ({ destination: a.destination, label: a.label ?? LABELS.skipped })),
  };
}

/**
 * True when the action puts bytes on disk.
 *
 * @param {UpgradeAction} item
 * @returns {boolean}
 */
export function writesContent(item) {
  return item.action === 'write' || item.action === 'overwrite' || item.action === 'force';
}

/**
 * True when the action destroys the file that sits on disk today, so the
 * apply step must copy that file into the backup directory first. An extra
 * file never reaches this test, because its action is always "write". The
 * shared glossary does reach it, through row S3, so a user edit to
 * ".beast-mode/harness.md" always leaves a backup copy behind.
 *
 * @param {UpgradeAction} item
 * @returns {boolean}
 */
export function needsBackup(item) {
  return item.action === 'overwrite' || item.action === 'force' || item.action === 'prune';
}

/**
 * Count one action list into the summary buckets.
 *
 * @param {UpgradeAction[]} actions
 * @returns {Record<string, number>}
 */
export function countUpgradeActions(actions) {
  const counts = {
    added: 0,
    restored: 0,
    updated: 0,
    forced: 0,
    adopted: 0,
    upToDate: 0,
    skipped: 0,
    pruned: 0,
    kept: 0,
    dropped: 0,
  };
  for (const item of actions) {
    if (!item.bucket) continue;
    counts[item.bucket] += 1;
  }
  return counts;
}

/**
 * Read the .gitignore state of a project. Both planners call this function,
 * so an install and an upgrade produce the same state for the same project.
 * A missing file reads as an empty text, so a new file gains every owned
 * line, and the reader opens the file one time.
 *
 * @param {string} projectRoot
 * @param {string} harnessRoot Project-relative harness root, one adapter's own root path.
 * @returns {GitignoreState}
 */
function readGitignoreState(projectRoot, harnessRoot) {
  const gitignoreFile = path.join(projectRoot, '.gitignore');
  const create = !fs.existsSync(gitignoreFile);
  const text = create ? '' : fs.readFileSync(gitignoreFile, 'utf8');
  const lines = missingGitignoreLines(text, harnessRoot);
  return {
    create,
    appendAction: lines.length > 0 ? 'append' : 'already',
    needsHeader: gitignoreHeaderIndex(text.split('\n')) === -1,
    lines,
  };
}

/**
 * One printable line for one upgrade action: the report label of its table
 * row, then the destination. A quiet row returns null.
 *
 * @param {UpgradeAction} item
 * @returns {string | null}
 */
export function actionLine(item) {
  if (!item.label) return null;
  return `  ${item.label}: ${item.destination}`;
}

/** The section heading of each upgrade group, in print order. */
const UPGRADE_GROUPS = [
  ['skill', '📋 Installing command skills...'],
  ['agent', '🤖 Installing agent templates...'],
  ['dev-doc', '📝 Installing feature doc templates...'],
  ['format', '📚 Installing format references...'],
  ['shared', '🧭 Composing the harness glossary...'],
  ['stale', '🗑️ Files the plugin no longer ships...'],
];

/**
 * Print every printable action of one group, under its heading. Prints
 * nothing at all, not even the heading, when every action of the group is
 * quiet. A steady-state upgrade therefore prints the summary only.
 *
 * @param {UpgradeAction[]} actions
 * @param {ReturnType<typeof import('./report.js').createReporter>} reporter
 * @returns {void}
 */
export function printUpgradeGroups(actions, reporter) {
  for (const [kind, heading] of UPGRADE_GROUPS) {
    const lines = actions.filter((a) => a.kind === kind).map(actionLine).filter(Boolean);
    if (lines.length === 0) continue;
    reporter.section(heading);
    for (const line of lines) reporter.line(line);
  }
}

/**
 * Print the skip list: one line per destination the upgrade left alone,
 * with the report label that says why.
 *
 * @param {{ destination: string, label: string }[]} skips
 * @param {ReturnType<typeof import('./report.js').createReporter>} reporter
 * @returns {void}
 */
export function printSkipList(skips, reporter) {
  if (skips.length === 0) return;
  reporter.section('⏭️ Skipped files');
  reporter.line('Beast Mode changed none of these files:');
  for (const skip of skips) {
    reporter.line(`  ${skip.label}: ${skip.destination}`);
  }
}

/**
 * Print the next action for a run that skipped a file. Every skip is a
 * conflict (row 4) or a "skip (yours)" (rows 8 and 15), and "--force"
 * takes the plugin version of both, with a backup first. A run with no
 * manifest also states why it could not decide on its own.
 *
 * @param {{ actions: UpgradeAction[], counts: Record<string, number>, noManifest: boolean, harnessId?: string }} plan
 * @param {ReturnType<typeof import('./report.js').createReporter>} reporter
 * @returns {void}
 */
export function printUpgradeHints({ counts, noManifest, harnessId }, reporter) {
  if (counts.skipped === 0) return;

  const harness = harnessId ?? '<harness>';

  if (noManifest) {
    reporter.info('This project held no Beast Mode manifest before this run.');
    reporter.line('  Beast Mode cannot tell a file you edited from a file the plugin changed,');
    reporter.line('  so it skipped every file that differs and it changed nothing.');
  }

  reporter.info(
    `Run \`beast-mode upgrade ${harness} --force\` to take the plugin version of the skipped files. A backup runs first.`
  );
  reporter.line();
}

/**
 * Print the upgrade dry run. Prints one line per action with the report
 * label of its table row, the skip list, the counts, the backup directory
 * the run would use, and the manifest path. Changes nothing.
 *
 * @param {ReturnType<typeof planUpgrade>} plan
 * @param {ReturnType<typeof import('./report.js').createReporter>} reporter
 * @param {{ backupDir?: string | null, harnessId?: string, projectRoot?: string }} [opts]
 * @returns {void}
 */
function printUpgradePlan(plan, reporter, opts = {}) {
  reporter.section('🔍 UPGRADE PLAN (dry run)');
  reporter.info('This is a preview. The dry run changes no file and writes no manifest.');

  if (plan.dirs.length > 0) {
    reporter.section('📁 Creating directory structure...');
    for (const dir of plan.dirs) {
      reporter.info(`Would create: ${dir}/`);
    }
  }

  printUpgradeGroups(plan.actions, reporter);

  if (plan.gitignore) {
    reporter.section('📄 Updating .gitignore...');
    if (plan.gitignore.create) reporter.ok('Would create .gitignore');
    if (plan.gitignore.appendAction === 'append') {
      reporter.ok('Would add Beast Mode entries to .gitignore');
    } else {
      reporter.info('Beast Mode entries already in .gitignore');
    }
  }

  printSkipList(plan.skips, reporter);

  reporter.section('📋 UPGRADE PLAN SUMMARY');
  printUpgradeCounts(plan.counts, reporter);
  reporter.line();
  if (plan.backupNeeded && opts.backupDir && opts.projectRoot) {
    reporter.line(
      `  📦 Backup would be written to: ${path.relative(opts.projectRoot, opts.backupDir)}/`
    );
  } else if (plan.backupNeeded && opts.backupDir) {
    reporter.line(`  📦 Backup would be written to: ${opts.backupDir}`);
  } else if (plan.backupNeeded) {
    reporter.line('  📦 A backup directory would be created inside the harness root.');
  } else {
    reporter.line('  📦 Backup: none needed');
  }
  reporter.line(`  📄 Manifest would be written to: ${plan.manifestPath}`);
  reporter.line();
  printUpgradeHints({ ...plan, harnessId: opts.harnessId }, reporter);
}

/**
 * Print the nine summary count lines, in the order of section 3.5.
 *
 * @param {Record<string, number>} counts
 * @param {ReturnType<typeof import('./report.js').createReporter>} reporter
 * @returns {void}
 */
export function printUpgradeCounts(counts, reporter) {
  reporter.line(`  ${LABELS.added}: ${counts.added}`);
  reporter.line(`  ${LABELS.restored}: ${counts.restored}`);
  reporter.line(`  ${LABELS.updated}: ${counts.updated}`);
  reporter.line(`  ${LABELS.forced}: ${counts.forced}`);
  reporter.line(`  ${LABELS.adopted}: ${counts.adopted}`);
  reporter.line(`  ✓ Up to date: ${counts.upToDate}`);
  reporter.line(`  ⏭️ Skipped: ${counts.skipped}`);
  reporter.line(`  ${LABELS.pruned}: ${counts.pruned}`);
  reporter.line(`  ⚠ Kept: ${counts.kept}`);
}
