// installer/test/apply.test.js
//
// Covers lib/apply.js against the real plugin root (read-only): the full
// install tree, the manifest of FOOTPRINT.manifestEntries entries, byte identity against templates/,
// gitignore idempotence, --dry-run purity, and the stale-command check.
// The second half covers the upgrade path end to end: the skip, the forced
// write with its backup, the prune with its backup, the keep, the
// no-manifest fallback, idempotence, the gitignore line that a project of
// an earlier version gains, and the install/upgrade tree match.

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { findPluginRoot, readSource } from '../lib/source.js';
import { LABELS, render, planInstall, planUpgrade } from '../lib/plan.js';
import { apply } from '../lib/apply.js';
import { createReporter } from '../lib/report.js';
import { manifestPath, read as readManifest } from '../lib/manifest.js';
import claude from '../adapters/claude.js';
import {
  FOOTPRINT,
  copyPluginRoot,
  createTempProjectRoot,
  removeFixture,
  snapshotTree,
} from './helpers.js';

const PLUGIN_ROOT = findPluginRoot(import.meta.dirname);

/** A writable sink that swallows every write, so a test prints nothing. */
function nullStream() {
  return { write: () => true, isTTY: false };
}

/**
 * How many times one whole line appears in a text. The .gitignore tests
 * count a line, because a duplicate line is the failure they guard.
 *
 * @param {string} text
 * @param {string} line
 * @returns {number}
 */
function countLines(text, line) {
  return text.split('\n').filter((candidate) => candidate.trim() === line).length;
}

/**
 * @param {string} projectRoot
 * @returns {{ source: ReturnType<typeof readSource>, rendered: import('../lib/plan.js').RenderedFile[] }}
 */
function readAndRender(projectRoot) {
  const source = readSource({
    pluginRoot: PLUGIN_ROOT,
    harnessId: claude.id,
    glossaryHarnessId: claude.glossaryHarnessId,
  });
  const { rendered } = render({ source, adapter: claude });
  return { source, rendered };
}

test('apply() installs the full tree from the real plugin root and writes a manifest of FOOTPRINT.manifestEntries entries', () => {
  const projectRoot = createTempProjectRoot();
  try {
    const { source, rendered } = readAndRender(projectRoot);
    const plan = planInstall({ rendered, projectRoot, harnessRoot: claude.harnessRoot, manifest: null });
    const report = createReporter(nullStream());

    const result = apply(plan, {
      projectRoot,
      pluginRoot: PLUGIN_ROOT,
      adapter: claude,
      source,
      reporter: report,
      dryRun: false,
      mode: 'install',
    });

    assert.equal(fs.readdirSync(path.join(projectRoot, '.claude', 'skills')).length, FOOTPRINT.skills);
    assert.equal(fs.readdirSync(path.join(projectRoot, '.claude', 'agents')).length, 2);
    assert.equal(fs.readdirSync(path.join(projectRoot, '.beast-mode', 'templates')).length, 7);

    const formatFiles = fs
      .readdirSync(path.join(projectRoot, '.beast-mode'))
      .filter((f) => f.endsWith('.md') && f !== 'harness.md');
    assert.equal(formatFiles.length, 8);

    assert.ok(fs.existsSync(path.join(projectRoot, '.beast-mode', 'harness.md')));
    assert.equal(
      fs.readFileSync(path.join(projectRoot, '.claude', '.beast-mode-version'), 'utf8'),
      `${source.version}\n`
    );
    assert.ok(fs.existsSync(path.join(projectRoot, 'docs', 'features')));

    // One block header, then the two owned lines: the backup directory of
    // this harness, and the phase briefs. Both hold derived data.
    const gitignoreText = fs.readFileSync(path.join(projectRoot, '.gitignore'), 'utf8');
    assert.match(
      gitignoreText,
      /# Beast Mode - Backups\n\.claude\/\.beast-mode-backup-\*\/\n\.beast-mode\/briefs\/\n/
    );
    assert.equal(countLines(gitignoreText, '# Beast Mode - Backups'), 1);

    assert.ok(result.manifestPath);
    const manifest = JSON.parse(fs.readFileSync(result.manifestPath, 'utf8'));
    // FOOTPRINT.manifestEntries source-backed files. The shared harness glossary carries no entry:
    // the core composes it from the whole harness set, so no single harness
    // manifest may own it.
    assert.equal(manifest.files.length, FOOTPRINT.manifestEntries);
    assert.ok(manifest.files.every((f) => !f.destination.includes('\\')));
    assert.ok(manifest.files.every((f) => !f.source || !f.source.includes('\\')));
    assert.ok(manifest.files.every((f) => f.owned === true));

    // Byte identity: every owned file equals its source under templates/.
    for (const entry of manifest.files) {
      const destPath = path.join(projectRoot, ...entry.destination.split('/'));
      const srcPath = path.join(PLUGIN_ROOT, ...entry.source.split('/'));
      assert.ok(
        fs.readFileSync(destPath).equals(fs.readFileSync(srcPath)),
        `${entry.destination} is not byte-identical to ${entry.source}`
      );
    }
  } finally {
    removeFixture(projectRoot);
  }
});

test('a second .gitignore pass appends no new block', () => {
  const projectRoot = createTempProjectRoot();
  try {
    const report = createReporter(nullStream());

    const first = readAndRender(projectRoot);
    const plan1 = planInstall({
      rendered: first.rendered,
      projectRoot,
      harnessRoot: claude.harnessRoot,
      manifest: null,
    });
    // The project holds no .gitignore yet, so the first pass owes both lines
    // and the block header.
    assert.deepEqual(plan1.gitignore, {
      create: true,
      appendAction: 'append',
      needsHeader: true,
      lines: ['.claude/.beast-mode-backup-*/', '.beast-mode/briefs/'],
    });
    apply(plan1, { projectRoot, pluginRoot: PLUGIN_ROOT, adapter: claude, source: first.source, reporter: report, dryRun: false });

    const gitignoreAfterFirst = fs.readFileSync(path.join(projectRoot, '.gitignore'), 'utf8');

    const second = readAndRender(projectRoot);
    const plan2 = planInstall({
      rendered: second.rendered,
      projectRoot,
      harnessRoot: claude.harnessRoot,
      manifest: null,
    });
    assert.equal(plan2.gitignore.create, false);
    assert.equal(plan2.gitignore.appendAction, 'already');
    assert.deepEqual(plan2.gitignore.lines, []);

    apply(plan2, { projectRoot, pluginRoot: PLUGIN_ROOT, adapter: claude, source: second.source, reporter: report, dryRun: false });

    const gitignoreAfterSecond = fs.readFileSync(path.join(projectRoot, '.gitignore'), 'utf8');
    assert.equal(gitignoreAfterSecond, gitignoreAfterFirst);
    assert.equal(countLines(gitignoreAfterSecond, '.claude/.beast-mode-backup-*/'), 1);
    assert.equal(countLines(gitignoreAfterSecond, '.beast-mode/briefs/'), 1);
  } finally {
    removeFixture(projectRoot);
  }
});

test('apply() --dry-run changes no file and writes no manifest', () => {
  const projectRoot = createTempProjectRoot();
  try {
    const before = snapshotTree(projectRoot);

    const { source, rendered } = readAndRender(projectRoot);
    const plan = planInstall({ rendered, projectRoot, harnessRoot: claude.harnessRoot, manifest: null });
    const report = createReporter(nullStream());

    const result = apply(plan, {
      projectRoot,
      pluginRoot: PLUGIN_ROOT,
      adapter: claude,
      source,
      reporter: report,
      dryRun: true,
    });

    const after = snapshotTree(projectRoot);
    assert.deepEqual(after, before);
    assert.equal(result.manifestPath, null);
    assert.ok(!fs.existsSync(path.join(projectRoot, '.claude', '.beast-mode-manifest.json')));
  } finally {
    removeFixture(projectRoot);
  }
});

test('the stale-command check reports a plan-feature.md fixture and deletes nothing', () => {
  const projectRoot = createTempProjectRoot();
  try {
    fs.mkdirSync(path.join(projectRoot, '.claude', 'commands'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, '.claude', 'commands', 'plan-feature.md'), 'old command\n');

    const { source, rendered } = readAndRender(projectRoot);
    const plan = planInstall({ rendered, projectRoot, harnessRoot: claude.harnessRoot, manifest: null });
    const report = createReporter(nullStream());

    const result = apply(plan, {
      projectRoot,
      pluginRoot: PLUGIN_ROOT,
      adapter: claude,
      source,
      reporter: report,
      dryRun: false,
      mode: 'install',
    });

    assert.ok(result.checkResult);
    assert.equal(result.checkResult.ok, false);
    assert.ok(result.checkResult.notes.some((n) => n.includes('1 Beast Mode command file')));
    assert.ok(result.checkResult.notes.some((n) => n.includes('migrate-v4-to-v5.sh')));

    const stalePath = path.join(projectRoot, '.claude', 'commands', 'plan-feature.md');
    assert.ok(fs.existsSync(stalePath));
    assert.equal(fs.readFileSync(stalePath, 'utf8'), 'old command\n');
  } finally {
    removeFixture(projectRoot);
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// The upgrade path: skip, force, backup, prune, keep, and the no-manifest
// fallback of implementation.md section 3.5.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Install the real plugin source into a fresh temp project.
 *
 * @param {{ pluginRoot?: string }} [opts]
 * @returns {{ projectRoot: string, pluginRoot: string, source: any, manifestFile: string }}
 */
function install(opts = {}) {
  const pluginRoot = opts.pluginRoot ?? PLUGIN_ROOT;
  const projectRoot = createTempProjectRoot();
  const source = readSource({
    pluginRoot,
    harnessId: claude.id,
    glossaryHarnessId: claude.glossaryHarnessId,
  });
  const { rendered } = render({ source, adapter: claude });
  const plan = planInstall({ rendered, projectRoot, harnessRoot: claude.harnessRoot, manifest: null });
  apply(plan, {
    projectRoot,
    pluginRoot,
    adapter: claude,
    source,
    reporter: createReporter(nullStream()),
    dryRun: false,
    mode: 'install',
  });
  return {
    projectRoot,
    pluginRoot,
    source,
    manifestFile: manifestPath(projectRoot, claude.harnessRoot),
  };
}

/**
 * Plan and apply one upgrade against a project.
 *
 * @param {{ projectRoot: string, pluginRoot?: string, force?: boolean, dryRun?: boolean }} args
 */
function upgrade({ projectRoot, pluginRoot = PLUGIN_ROOT, force = false, dryRun = false }) {
  const source = readSource({
    pluginRoot,
    harnessId: claude.id,
    glossaryHarnessId: claude.glossaryHarnessId,
  });
  const { rendered } = render({ source, adapter: claude });
  const manifest = readManifest({
    path: manifestPath(projectRoot, claude.harnessRoot),
    harnessId: claude.id,
  });
  const plan = planUpgrade({
    rendered,
    projectRoot,
    harnessRoot: claude.harnessRoot,
    manifest,
    force,
  });
  const result = apply(plan, {
    projectRoot,
    pluginRoot,
    adapter: claude,
    source,
    reporter: createReporter(nullStream()),
    dryRun,
    mode: 'upgrade',
  });
  return { plan, result, source };
}

/**
 * @param {string} projectRoot
 * @param {string} relPath Project-relative, forward slashes.
 * @returns {string}
 */
function abs(projectRoot, relPath) {
  return path.join(projectRoot, ...relPath.split('/'));
}

/**
 * The one backup directory of a project, or null when the run made none.
 *
 * @param {string} projectRoot
 * @returns {string | null}
 */
function backupDirs(projectRoot) {
  const harnessDir = path.join(projectRoot, '.claude');
  if (!fs.existsSync(harnessDir)) return [];
  return fs.readdirSync(harnessDir).filter((name) => name.startsWith('.beast-mode-backup-'));
}

const EDITED_SKILL = '.claude/skills/plan-feature/SKILL.md';

test('an edited skill survives an upgrade untouched and appears in the skip list', () => {
  const { projectRoot } = install();
  try {
    const before = fs.readFileSync(abs(projectRoot, EDITED_SKILL), 'utf8');
    fs.appendFileSync(abs(projectRoot, EDITED_SKILL), 'my own note\n');
    const edited = fs.readFileSync(abs(projectRoot, EDITED_SKILL), 'utf8');

    const { plan, result } = upgrade({ projectRoot });

    assert.equal(fs.readFileSync(abs(projectRoot, EDITED_SKILL), 'utf8'), edited);
    assert.notEqual(edited, before);
    assert.deepEqual(plan.skips, [{ destination: EDITED_SKILL, label: LABELS.conflict }]);
    assert.equal(result.counts.skipped, 1);
    assert.equal(backupDirs(projectRoot).length, 0);

    // The manifest keeps the owned entry, so a later --force can still take
    // the plugin version.
    const manifest = JSON.parse(fs.readFileSync(result.manifestPath, 'utf8'));
    const entry = manifest.files.find((f) => f.destination === EDITED_SKILL);
    assert.equal(entry.owned, true);
    assert.equal(entry.sha256, crypto.createHash('sha256').update(before).digest('hex'));
  } finally {
    removeFixture(projectRoot);
  }
});

test('upgrade --force writes the plugin version and the backup holds the exact old bytes', () => {
  const { projectRoot } = install();
  try {
    fs.appendFileSync(abs(projectRoot, EDITED_SKILL), 'my own note\n');
    const edited = fs.readFileSync(abs(projectRoot, EDITED_SKILL));

    // One plain upgrade first, the way a user meets the conflict.
    upgrade({ projectRoot });
    const { result } = upgrade({ projectRoot, force: true });

    const sourceBytes = fs.readFileSync(
      path.join(PLUGIN_ROOT, 'templates', 'skills', 'plan-feature', 'SKILL.md')
    );
    assert.ok(fs.readFileSync(abs(projectRoot, EDITED_SKILL)).equals(sourceBytes));

    assert.ok(result.backupDir);
    const backupCopy = path.join(result.backupDir, ...EDITED_SKILL.split('/'));
    assert.ok(fs.readFileSync(backupCopy).equals(edited));
    assert.equal(result.counts.forced, 1);
    assert.equal(result.counts.skipped, 0);
  } finally {
    removeFixture(projectRoot);
  }
});

test('a changed source updates an untouched file and backs the old copy up', () => {
  const pluginRoot = copyPluginRoot(PLUGIN_ROOT);
  const { projectRoot } = install({ pluginRoot });
  try {
    const target = path.join(pluginRoot, 'templates', 'formats', 'epic-resolution.md');
    const oldBytes = fs.readFileSync(target);
    fs.writeFileSync(target, `${oldBytes.toString('utf8')}\nA new plugin line.\n`);

    const { result } = upgrade({ projectRoot, pluginRoot });

    const live = fs.readFileSync(abs(projectRoot, '.beast-mode/epic-resolution.md'));
    assert.ok(live.equals(fs.readFileSync(target)));
    assert.equal(result.counts.updated, 1);

    assert.ok(result.backupDir);
    const backupCopy = path.join(result.backupDir, '.beast-mode', 'epic-resolution.md');
    assert.ok(fs.readFileSync(backupCopy).equals(oldBytes));
  } finally {
    removeFixture(pluginRoot);
    removeFixture(projectRoot);
  }
});

test('upgrade prunes README.md and plan.md when their hashes match the manifest', () => {
  const { projectRoot, manifestFile } = install();
  try {
    // Reproduce the CR-8 state: two files the plugin used to ship, written
    // by the CLI (the manifest holds their hashes), with no source left.
    const stale = {
      '.beast-mode/templates/README.md': '# The old README\n',
      '.beast-mode/templates/plan.md': '# The old plan template\n',
    };
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    for (const [dest, text] of Object.entries(stale)) {
      fs.writeFileSync(abs(projectRoot, dest), text);
      manifest.files.push({
        destination: dest,
        source: `templates/dev-docs/${path.posix.basename(dest)}`,
        sha256: crypto.createHash('sha256').update(text).digest('hex'),
        owned: true,
      });
    }
    fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);

    const { result } = upgrade({ projectRoot });

    for (const dest of Object.keys(stale)) {
      assert.ok(!fs.existsSync(abs(projectRoot, dest)), `${dest} still exists`);
    }
    assert.equal(result.counts.pruned, 2);

    // Every pruned file has a backup copy with its exact old content.
    assert.ok(result.backupDir);
    for (const [dest, text] of Object.entries(stale)) {
      assert.equal(fs.readFileSync(path.join(result.backupDir, ...dest.split('/')), 'utf8'), text);
    }

    // The directory that still holds shipped files stays.
    assert.equal(fs.readdirSync(abs(projectRoot, '.beast-mode/templates')).length, 7);

    // The manifest drops both entries.
    const after = JSON.parse(fs.readFileSync(result.manifestPath, 'utf8'));
    assert.equal(after.files.length, FOOTPRINT.manifestEntries);
    assert.ok(!after.files.some((f) => Object.keys(stale).includes(f.destination)));
  } finally {
    removeFixture(projectRoot);
  }
});

test('an edited stale file survives the prune and appears in the keep list', () => {
  const { projectRoot, manifestFile } = install();
  try {
    const dest = '.beast-mode/templates/README.md';
    const mine = '# My own notes about this project\n';
    fs.writeFileSync(abs(projectRoot, dest), mine);

    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    manifest.files.push({
      destination: dest,
      source: 'templates/dev-docs/README.md',
      sha256: crypto.createHash('sha256').update('# The old README\n').digest('hex'),
      owned: true,
    });
    fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);

    const { plan, result } = upgrade({ projectRoot });

    assert.equal(fs.readFileSync(abs(projectRoot, dest), 'utf8'), mine);
    assert.equal(result.counts.kept, 1);
    assert.equal(result.counts.pruned, 0);
    assert.equal(backupDirs(projectRoot).length, 0);
    assert.ok(plan.actions.some((a) => a.destination === dest && a.label === LABELS.kept));

    // The entry stays owned with its old hash, so a later run can still
    // prune the file once the user reverts the edit.
    const after = JSON.parse(fs.readFileSync(result.manifestPath, 'utf8'));
    const entry = after.files.find((f) => f.destination === dest);
    assert.equal(entry.owned, true);
    assert.equal(entry.sha256, crypto.createHash('sha256').update('# The old README\n').digest('hex'));
  } finally {
    removeFixture(projectRoot);
  }
});

test('a v5.0.0 project with no manifest adopts, writes, skips, and gains a manifest', () => {
  const { projectRoot, manifestFile } = install();
  try {
    // The v5.0.0 shape: the bash script wrote every file and no manifest.
    fs.rmSync(manifestFile);
    const editedAgent = '.claude/agents/solution-architect.md';
    const missingFormat = '.beast-mode/epic-resolution.md';
    fs.appendFileSync(abs(projectRoot, editedAgent), '\nMy own agent note.\n');
    fs.rmSync(abs(projectRoot, missingFormat));

    const { plan, result } = upgrade({ projectRoot });

    assert.equal(plan.noManifest, true);
    assert.equal(result.counts.pruned, 0);
    assert.equal(backupDirs(projectRoot).length, 0);

    // The edited file is the user's, so it stays and it is reported.
    assert.ok(fs.readFileSync(abs(projectRoot, editedAgent), 'utf8').endsWith('My own agent note.\n'));
    assert.deepEqual(plan.skips, [{ destination: editedAgent, label: LABELS.skipped }]);
    assert.equal(result.counts.skipped, 1);

    // The missing file comes back.
    assert.ok(fs.existsSync(abs(projectRoot, missingFormat)));
    assert.equal(result.counts.added, 1);

    // Every equal file is adopted: FOOTPRINT.manifestEntries source-backed files, minus the edited
    // one and the missing one. The shared glossary is not one of them: it
    // takes the quiet row S2 and it counts as up to date.
    assert.equal(result.counts.adopted, FOOTPRINT.manifestEntries - 2);
    assert.equal(result.counts.upToDate, 1);

    const manifest = JSON.parse(fs.readFileSync(result.manifestPath, 'utf8'));
    assert.equal(manifest.files.length, FOOTPRINT.manifestEntries);
    const entry = manifest.files.find((f) => f.destination === editedAgent);
    assert.equal(entry.owned, false);
    assert.equal(entry.reason, 'the file already existed');
    assert.ok(!('sha256' in entry));
    assert.ok(manifest.files.filter((f) => f.owned === true).length === FOOTPRINT.manifestEntries - 1);
  } finally {
    removeFixture(projectRoot);
  }
});

test('upgrade --force on a project with no manifest takes the plugin copy and backs the old one up', () => {
  const { projectRoot, manifestFile } = install();
  try {
    // The v5.0.0 shape again: every file in place, no manifest, one edit.
    fs.rmSync(manifestFile);
    const edited = '.claude/skills/plan-feature/SKILL.md';
    fs.appendFileSync(abs(projectRoot, edited), 'my own note\n');
    const myBytes = fs.readFileSync(abs(projectRoot, edited));

    const plain = upgrade({ projectRoot });
    assert.equal(plain.result.counts.skipped, 1);
    assert.equal(backupDirs(projectRoot).length, 0);

    const forced = upgrade({ projectRoot, force: true });

    assert.equal(forced.result.counts.forced, 1);
    assert.equal(forced.result.counts.skipped, 0);

    // The live file now holds the plugin bytes.
    const pluginBytes = fs.readFileSync(
      path.join(PLUGIN_ROOT, 'templates', 'skills', 'plan-feature', 'SKILL.md')
    );
    assert.ok(fs.readFileSync(abs(projectRoot, edited)).equals(pluginBytes));

    // The backup holds the exact bytes the user had.
    assert.ok(forced.result.backupDir);
    assert.ok(
      fs.readFileSync(path.join(forced.result.backupDir, ...edited.split('/'))).equals(myBytes)
    );

    // The manifest now owns the file, with the hash of the plugin copy.
    const manifest = JSON.parse(fs.readFileSync(forced.result.manifestPath, 'utf8'));
    const entry = manifest.files.find((f) => f.destination === edited);
    assert.equal(entry.owned, true);
    assert.equal(entry.sha256, crypto.createHash('sha256').update(pluginBytes).digest('hex'));
  } finally {
    removeFixture(projectRoot);
  }
});

test('a second upgrade changes no file, makes no backup, and writes an equal manifest', () => {
  const { projectRoot } = install();
  try {
    const first = upgrade({ projectRoot });
    const treeAfterFirst = snapshotTree(projectRoot);
    const manifestAfterFirst = JSON.parse(fs.readFileSync(first.result.manifestPath, 'utf8'));

    const second = upgrade({ projectRoot });
    const treeAfterSecond = snapshotTree(projectRoot);
    const manifestAfterSecond = JSON.parse(fs.readFileSync(second.result.manifestPath, 'utf8'));

    // The manifest is the only file whose bytes may differ, through
    // "generated" alone.
    const manifestKey = '.claude/.beast-mode-manifest.json';
    delete treeAfterFirst[manifestKey];
    delete treeAfterSecond[manifestKey];
    assert.deepEqual(treeAfterSecond, treeAfterFirst);

    assert.notEqual(manifestAfterSecond.generated, undefined);
    delete manifestAfterFirst.generated;
    delete manifestAfterSecond.generated;
    assert.deepEqual(manifestAfterSecond, manifestAfterFirst);

    // FOOTPRINT.manifestEntries source-backed files at row 2, plus the shared glossary at row S2.
    assert.equal(second.result.counts.upToDate, FOOTPRINT.manifestEntries + 1);
    assert.equal(backupDirs(projectRoot).length, 0);
  } finally {
    removeFixture(projectRoot);
  }
});

test('a project that holds only the backup line gains the briefs line on the next upgrade', () => {
  const { projectRoot } = install();
  try {
    // The state an earlier version left behind: the header and the backup
    // line, and no briefs line. A whole-text test would read "already" here
    // and the project would never gain the second line.
    const gitignoreFile = path.join(projectRoot, '.gitignore');
    fs.writeFileSync(gitignoreFile, 'node_modules/\n\n# Beast Mode - Backups\n.claude/.beast-mode-backup-*/\n');

    const { plan } = upgrade({ projectRoot });

    assert.deepEqual(plan.gitignore, {
      create: false,
      appendAction: 'append',
      needsHeader: false,
      lines: ['.beast-mode/briefs/'],
    });

    const afterUpgrade = fs.readFileSync(gitignoreFile, 'utf8');
    assert.equal(countLines(afterUpgrade, '.beast-mode/briefs/'), 1);
    assert.equal(countLines(afterUpgrade, '.claude/.beast-mode-backup-*/'), 1);
    assert.equal(countLines(afterUpgrade, 'node_modules/'), 1);

    // The next upgrade finds both lines, so it appends nothing.
    upgrade({ projectRoot });
    assert.equal(fs.readFileSync(gitignoreFile, 'utf8'), afterUpgrade);
  } finally {
    removeFixture(projectRoot);
  }
});

test('a project that holds the header and the backup line keeps one header, and the briefs line lands inside the block', () => {
  const { projectRoot } = install();
  try {
    // The state an earlier version left behind, plus a rule under the block.
    // The writer must add the briefs line inside the block, and it must add
    // no second header.
    const gitignoreFile = path.join(projectRoot, '.gitignore');
    fs.writeFileSync(
      gitignoreFile,
      [
        'node_modules/',
        '',
        '# Beast Mode - Backups',
        '.claude/.beast-mode-backup-*/',
        '',
        '# My own rules',
        'dist/',
        '',
      ].join('\n')
    );

    upgrade({ projectRoot });

    const afterUpgrade = fs.readFileSync(gitignoreFile, 'utf8');
    assert.equal(countLines(afterUpgrade, '# Beast Mode - Backups'), 1);
    assert.equal(
      afterUpgrade,
      [
        'node_modules/',
        '',
        '# Beast Mode - Backups',
        '.claude/.beast-mode-backup-*/',
        '.beast-mode/briefs/',
        '',
        '# My own rules',
        'dist/',
        '',
      ].join('\n')
    );

    // The next upgrade finds both lines, so it changes nothing.
    upgrade({ projectRoot });
    assert.equal(fs.readFileSync(gitignoreFile, 'utf8'), afterUpgrade);
  } finally {
    removeFixture(projectRoot);
  }
});

test('upgrade --dry-run changes no file and writes no manifest', () => {
  const { projectRoot, manifestFile } = install();
  try {
    fs.appendFileSync(abs(projectRoot, EDITED_SKILL), 'my own note\n');
    fs.rmSync(abs(projectRoot, '.beast-mode/epic-resolution.md'));
    fs.rmSync(manifestFile);

    const before = snapshotTree(projectRoot);
    const { result } = upgrade({ projectRoot, dryRun: true });
    const after = snapshotTree(projectRoot);

    assert.deepEqual(after, before);
    assert.equal(result.manifestPath, null);
    assert.ok(!fs.existsSync(manifestFile));
    assert.equal(backupDirs(projectRoot).length, 0);
  } finally {
    removeFixture(projectRoot);
  }
});

test('a fresh install and a fresh upgrade produce the same tree', () => {
  const installed = install();
  const upgraded = createTempProjectRoot();
  try {
    upgrade({ projectRoot: upgraded });

    const installedTree = snapshotTree(installed.projectRoot);
    const upgradedTree = snapshotTree(upgraded);

    const manifestKey = '.claude/.beast-mode-manifest.json';
    const installedManifest = JSON.parse(fs.readFileSync(installed.manifestFile, 'utf8'));
    const upgradedManifest = JSON.parse(
      fs.readFileSync(manifestPath(upgraded, claude.harnessRoot), 'utf8')
    );
    delete installedTree[manifestKey];
    delete upgradedTree[manifestKey];

    assert.deepEqual(upgradedTree, installedTree);

    delete installedManifest.generated;
    delete upgradedManifest.generated;
    assert.deepEqual(upgradedManifest, installedManifest);
  } finally {
    removeFixture(installed.projectRoot);
    removeFixture(upgraded);
  }
});
