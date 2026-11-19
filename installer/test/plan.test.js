// installer/test/plan.test.js
//
// Covers lib/plan.js: render() (the destination map, the byte-identical
// fast path, and which entry kinds reach adapter.destination()),
// planInstall() (the install skip rules and the manifest-present refusal),
// and planUpgrade() (one named test per row of the 16-row decision table of
// implementation.md section 3.5, plus the --force limit, the no-manifest
// rule, and the extra-file rule).

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { readSource } from '../lib/source.js';
import { GLOSSARY_DESTINATION, LABELS, render, planInstall, planUpgrade } from '../lib/plan.js';
import { InstallRefusedError } from '../lib/errors.js';
import { sha256 } from '../lib/manifest.js';
import claude from '../adapters/claude.js';
import { createFixturePluginRoot, createTempProjectRoot, removeFixture } from './helpers.js';

/**
 * Read a fixture plugin root and render it through a given adapter.
 *
 * @param {string} pluginRoot
 * @param {import('../adapters/index.js').Adapter} adapter
 */
function readAndRender(pluginRoot, adapter) {
  const source = readSource({
    pluginRoot,
    harnessId: adapter.id,
    glossaryHarnessId: adapter.glossaryHarnessId,
  });
  return { source, ...render({ source, adapter }) };
}

test('render() maps every entry kind to the right destination', () => {
  const pluginRoot = createFixturePluginRoot({ skillName: 'one-skill', agentName: 'one' });
  try {
    const { rendered } = readAndRender(pluginRoot, claude);

    const byKind = Object.fromEntries(['skill', 'agent', 'dev-doc', 'format', 'shared', 'extra'].map((k) => [
      k,
      rendered.filter((r) => r.kind === k),
    ]));

    assert.equal(byKind.skill.length, 1);
    assert.equal(byKind.skill[0].destination, '.claude/skills/one-skill/SKILL.md');

    assert.equal(byKind.agent.length, 1);
    assert.equal(byKind.agent[0].destination, '.claude/agents/one.md');

    assert.equal(byKind['dev-doc'].length, 1);
    assert.equal(byKind['dev-doc'][0].destination, '.beast-mode/templates/context.md');

    assert.equal(byKind.format.length, 1);
    assert.equal(byKind.format[0].destination, '.beast-mode/example.md');

    // The glossary entry maps to no destination now. render() pushes the
    // shared glossary itself, with no source path and no manifest entry.
    assert.equal(byKind.shared.length, 1);
    assert.equal(byKind.shared[0].destination, '.beast-mode/harness.md');
    assert.equal(byKind.shared[0].source, null);

    assert.equal(byKind.extra.length, 1);
    assert.equal(byKind.extra[0].destination, '.claude/.beast-mode-version');
  } finally {
    removeFixture(pluginRoot);
  }
});

test('render() calls adapter.destination() for skill and agent entries only', () => {
  const pluginRoot = createFixturePluginRoot();
  try {
    const seenKinds = [];
    const spyAdapter = {
      ...claude,
      destination(entry) {
        seenKinds.push(entry.kind);
        return claude.destination(entry);
      },
    };

    readAndRender(pluginRoot, spyAdapter);

    assert.ok(seenKinds.length > 0);
    assert.ok(seenKinds.every((k) => k === 'skill' || k === 'agent'));
  } finally {
    removeFixture(pluginRoot);
  }
});

test('render() takes the byte-identical fast path for the Claude adapter', () => {
  const pluginRoot = createFixturePluginRoot({ skillName: 'one-skill' });
  try {
    const { rendered } = readAndRender(pluginRoot, claude);
    const skillFile = rendered.find((r) => r.kind === 'skill');
    const sourceBytes = fs.readFileSync(path.join(pluginRoot, ...skillFile.source.split('/')));

    assert.ok(Buffer.isBuffer(skillFile.content));
    assert.ok(sourceBytes.equals(skillFile.content));
  } finally {
    removeFixture(pluginRoot);
  }
});

test('planInstall() on an empty project writes every destination, plus a .gitignore create', () => {
  const pluginRoot = createFixturePluginRoot();
  const projectRoot = createTempProjectRoot();
  try {
    const { rendered } = readAndRender(pluginRoot, claude);
    const plan = planInstall({ rendered, projectRoot, harnessRoot: claude.harnessRoot, manifest: null });

    assert.ok(plan.actions.length > 0);
    assert.ok(plan.actions.every((a) => a.action === 'write'));
    assert.deepEqual(plan.gitignore, {
      create: true,
      appendAction: 'append',
      needsHeader: true,
      lines: ['.claude/.beast-mode-backup-*/', '.beast-mode/briefs/'],
    });
    assert.ok(plan.dirs.includes('docs'));
    assert.ok(plan.dirs.includes('docs/features'));
  } finally {
    removeFixture(pluginRoot);
    removeFixture(projectRoot);
  }
});

test('planInstall() skips a whole skill folder when its SKILL.md already exists', () => {
  const pluginRoot = createFixturePluginRoot({ skillName: 'one-skill' });
  const projectRoot = createTempProjectRoot();
  try {
    fs.mkdirSync(path.join(projectRoot, '.claude', 'skills', 'one-skill'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, '.claude', 'skills', 'one-skill', 'SKILL.md'), 'user edit\n');

    const { rendered } = readAndRender(pluginRoot, claude);
    const plan = planInstall({ rendered, projectRoot, harnessRoot: claude.harnessRoot, manifest: null });

    const skillAction = plan.actions.find((a) => a.kind === 'skill' && a.name === 'one-skill');
    assert.equal(skillAction.action, 'skip');
    assert.equal(skillAction.reason, 'the skill folder already exists');

    // The file on disk is untouched.
    assert.equal(
      fs.readFileSync(path.join(projectRoot, '.claude', 'skills', 'one-skill', 'SKILL.md'), 'utf8'),
      'user edit\n'
    );
  } finally {
    removeFixture(pluginRoot);
    removeFixture(projectRoot);
  }
});

test('planInstall() skips an existing agent, dev-doc template, and format reference', () => {
  const pluginRoot = createFixturePluginRoot({ agentName: 'one' });
  const projectRoot = createTempProjectRoot();
  try {
    fs.mkdirSync(path.join(projectRoot, '.claude', 'agents'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, '.claude', 'agents', 'one.md'), 'user edit\n');

    fs.mkdirSync(path.join(projectRoot, '.beast-mode', 'templates'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, '.beast-mode', 'templates', 'context.md'), 'user edit\n');

    fs.mkdirSync(path.join(projectRoot, '.beast-mode'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, '.beast-mode', 'example.md'), 'user edit\n');

    const { rendered } = readAndRender(pluginRoot, claude);
    const plan = planInstall({ rendered, projectRoot, harnessRoot: claude.harnessRoot, manifest: null });

    const agentAction = plan.actions.find((a) => a.kind === 'agent');
    const devDocAction = plan.actions.find((a) => a.kind === 'dev-doc');
    const formatAction = plan.actions.find((a) => a.kind === 'format');

    assert.equal(agentAction.action, 'skip');
    assert.equal(devDocAction.action, 'skip');
    assert.equal(formatAction.action, 'skip');
  } finally {
    removeFixture(pluginRoot);
    removeFixture(projectRoot);
  }
});

test('planInstall() always overwrites an existing shared glossary and an existing version file', () => {
  const pluginRoot = createFixturePluginRoot();
  const projectRoot = createTempProjectRoot();
  try {
    fs.mkdirSync(path.join(projectRoot, '.beast-mode'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, '.beast-mode', 'harness.md'), 'stale\n');

    fs.mkdirSync(path.join(projectRoot, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, '.claude', '.beast-mode-version'), '0.0.0\n');

    const { rendered } = readAndRender(pluginRoot, claude);
    const plan = planInstall({ rendered, projectRoot, harnessRoot: claude.harnessRoot, manifest: null });

    const glossaryAction = plan.actions.find((a) => a.kind === 'shared');
    const versionAction = plan.actions.find((a) => a.kind === 'extra');

    assert.equal(glossaryAction.action, 'overwrite');
    assert.equal(versionAction.action, 'overwrite');
  } finally {
    removeFixture(pluginRoot);
    removeFixture(projectRoot);
  }
});

test('planInstall() raises InstallRefusedError (exit 7) naming upgrade when a manifest exists', () => {
  const pluginRoot = createFixturePluginRoot();
  const projectRoot = createTempProjectRoot();
  try {
    const { rendered } = readAndRender(pluginRoot, claude);
    const fakeManifest = {
      schema: 1,
      beastModeVersion: '5.1.0-fixture',
      harness: 'claude',
      harnessRoot: '.claude',
      generated: new Date().toISOString(),
      files: [],
    };

    assert.throws(
      () => planInstall({ rendered, projectRoot, harnessRoot: claude.harnessRoot, manifest: fakeManifest }),
      (err) => {
        assert.ok(err instanceof InstallRefusedError);
        assert.equal(err.exitCode, 7);
        assert.match(err.fix, /upgrade/);
        return true;
      }
    );
  } finally {
    removeFixture(pluginRoot);
    removeFixture(projectRoot);
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// planUpgrade(): the 16-row decision table of implementation.md section 3.5
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//
// Every row of the table gets one named test. A row with no test is a
// missing test, not a covered case. Each case builds the three inputs by
// hand: the manifest entry (M), the file on disk (D), and the content the
// CLI would write now (S).

const SOURCE_PATH = 'templates/formats/example.md';
const DEST = '.beast-mode/example.md';

/**
 * One rendered file, the input the adapter would produce.
 *
 * @param {string} content
 * @param {{ destination?: string, kind?: string, name?: string, source?: string | null }} [opts]
 */
function renderedFile(content, opts = {}) {
  return {
    destination: opts.destination ?? DEST,
    source: opts.source === undefined ? SOURCE_PATH : opts.source,
    content,
    kind: opts.kind ?? 'format',
    name: opts.name ?? 'example',
  };
}

/**
 * One manifest, or null for the no-manifest fallback.
 *
 * @param {import('../lib/manifest.js').ManifestFileEntry[] | null} files
 */
function manifestWith(files) {
  if (files === null) return null;
  return {
    schema: 1,
    beastModeVersion: '5.1.0-fixture',
    harness: claude.id,
    harnessRoot: claude.harnessRoot,
    generated: new Date().toISOString(),
    files,
  };
}

/**
 * Build a project on disk, then plan an upgrade against it.
 *
 * @param {{
 *   disk?: Record<string, string>,
 *   manifestFiles?: import('../lib/manifest.js').ManifestFileEntry[] | null,
 *   rendered?: any[],
 *   force?: boolean,
 * }} args
 */
function planCase({ disk = {}, manifestFiles = null, rendered = [], force = false }) {
  const projectRoot = createTempProjectRoot();
  for (const [rel, text] of Object.entries(disk)) {
    const full = path.join(projectRoot, ...rel.split('/'));
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, text);
  }
  const plan = planUpgrade({
    rendered,
    projectRoot,
    harnessRoot: claude.harnessRoot,
    manifest: manifestWith(manifestFiles),
    force,
  });
  return { projectRoot, plan };
}

/**
 * @param {ReturnType<typeof planUpgrade>} plan
 * @param {string} destination
 */
function actionFor(plan, destination) {
  return plan.actions.find((a) => a.destination === destination);
}

test('row 1: owned/missing/- -> write, reported as Restored', () => {
  const { projectRoot, plan } = planCase({
    rendered: [renderedFile('plugin\n')],
    manifestFiles: [{ destination: DEST, source: SOURCE_PATH, sha256: sha256('plugin\n'), owned: true }],
  });
  try {
    const item = actionFor(plan, DEST);
    assert.equal(item.action, 'write');
    assert.equal(item.label, LABELS.restored);
    assert.equal(item.row, 1);
    assert.equal(plan.counts.restored, 1);
    assert.equal(plan.backupNeeded, false);
  } finally {
    removeFixture(projectRoot);
  }
});

test('row 2: owned/present/D = M and D = S -> none, quiet and up to date', () => {
  const { projectRoot, plan } = planCase({
    disk: { [DEST]: 'plugin\n' },
    rendered: [renderedFile('plugin\n')],
    manifestFiles: [{ destination: DEST, source: SOURCE_PATH, sha256: sha256('plugin\n'), owned: true }],
  });
  try {
    const item = actionFor(plan, DEST);
    assert.equal(item.action, 'none');
    assert.equal(item.label, null);
    assert.equal(item.row, 2);
    assert.equal(plan.counts.upToDate, 1);
    assert.equal(plan.backupNeeded, false);
    assert.deepEqual(plan.skips, []);
  } finally {
    removeFixture(projectRoot);
  }
});

test('row 3: owned/present/D = M and D != S -> overwrite, reported as Updated', () => {
  const { projectRoot, plan } = planCase({
    disk: { [DEST]: 'old plugin\n' },
    rendered: [renderedFile('new plugin\n')],
    manifestFiles: [{ destination: DEST, source: SOURCE_PATH, sha256: sha256('old plugin\n'), owned: true }],
  });
  try {
    const item = actionFor(plan, DEST);
    assert.equal(item.action, 'overwrite');
    assert.equal(item.label, LABELS.updated);
    assert.equal(item.row, 3);
    assert.equal(plan.counts.updated, 1);
    assert.equal(plan.backupNeeded, true);
  } finally {
    removeFixture(projectRoot);
  }
});

test('row 4: owned/present/D != M -> conflict, skipped because you edited it', () => {
  const { projectRoot, plan } = planCase({
    disk: { [DEST]: 'my own edit\n' },
    rendered: [renderedFile('new plugin\n')],
    manifestFiles: [{ destination: DEST, source: SOURCE_PATH, sha256: sha256('old plugin\n'), owned: true }],
  });
  try {
    const item = actionFor(plan, DEST);
    assert.equal(item.action, 'conflict');
    assert.equal(item.label, LABELS.conflict);
    assert.equal(item.row, 4);
    assert.equal(plan.counts.skipped, 1);
    assert.equal(plan.backupNeeded, false);
    assert.deepEqual(plan.skips, [{ destination: DEST, label: LABELS.conflict }]);
  } finally {
    removeFixture(projectRoot);
  }
});

test('row 5: owned/present/D != M with --force -> force, reported as Forced', () => {
  const { projectRoot, plan } = planCase({
    disk: { [DEST]: 'my own edit\n' },
    rendered: [renderedFile('new plugin\n')],
    manifestFiles: [{ destination: DEST, source: SOURCE_PATH, sha256: sha256('old plugin\n'), owned: true }],
    force: true,
  });
  try {
    const item = actionFor(plan, DEST);
    assert.equal(item.action, 'force');
    assert.equal(item.label, LABELS.forced);
    assert.equal(item.row, 5);
    assert.equal(plan.counts.forced, 1);
    assert.equal(plan.counts.skipped, 0);
    assert.equal(plan.backupNeeded, true);
  } finally {
    removeFixture(projectRoot);
  }
});

test('row 6: not owned/missing/- -> write, reported as Added', () => {
  const { projectRoot, plan } = planCase({
    rendered: [renderedFile('plugin\n')],
    manifestFiles: [{ destination: DEST, source: SOURCE_PATH, owned: false, reason: 'the file already existed' }],
  });
  try {
    const item = actionFor(plan, DEST);
    assert.equal(item.action, 'write');
    assert.equal(item.label, LABELS.added);
    assert.equal(item.row, 6);
    assert.equal(plan.counts.added, 1);
  } finally {
    removeFixture(projectRoot);
  }
});

test('row 7: not owned/present/D = S -> adopt, no write', () => {
  const { projectRoot, plan } = planCase({
    disk: { [DEST]: 'plugin\n' },
    rendered: [renderedFile('plugin\n')],
    manifestFiles: [{ destination: DEST, source: SOURCE_PATH, owned: false, reason: 'the file already existed' }],
  });
  try {
    const item = actionFor(plan, DEST);
    assert.equal(item.action, 'adopt');
    assert.equal(item.label, LABELS.adopted);
    assert.equal(item.row, 7);
    assert.equal(plan.counts.adopted, 1);
    assert.equal(plan.backupNeeded, false);
  } finally {
    removeFixture(projectRoot);
  }
});

test('row 8: not owned/present/D != S -> skip, the file is yours', () => {
  const { projectRoot, plan } = planCase({
    disk: { [DEST]: 'my own file\n' },
    rendered: [renderedFile('plugin\n')],
    manifestFiles: [{ destination: DEST, source: SOURCE_PATH, owned: false, reason: 'the file already existed' }],
  });
  try {
    const item = actionFor(plan, DEST);
    assert.equal(item.action, 'skip');
    assert.equal(item.label, LABELS.skipped);
    assert.equal(item.row, 8);
    assert.equal(plan.counts.skipped, 1);
    assert.deepEqual(plan.skips, [{ destination: DEST, label: LABELS.skipped }]);
  } finally {
    removeFixture(projectRoot);
  }
});

test('row 9: not owned/present/D != S with --force -> force, reported as Forced', () => {
  const { projectRoot, plan } = planCase({
    disk: { [DEST]: 'my own file\n' },
    rendered: [renderedFile('plugin\n')],
    manifestFiles: [{ destination: DEST, source: SOURCE_PATH, owned: false, reason: 'the file already existed' }],
    force: true,
  });
  try {
    const item = actionFor(plan, DEST);
    assert.equal(item.action, 'force');
    assert.equal(item.label, LABELS.forced);
    assert.equal(item.row, 9);
    assert.equal(plan.counts.forced, 1);
    assert.equal(plan.counts.skipped, 0);
    // The apply step backs the old copy up before it writes.
    assert.equal(plan.backupNeeded, true);
  } finally {
    removeFixture(projectRoot);
  }
});

test('row 10: in manifest, source gone/present/D = M -> prune', () => {
  const stale = '.beast-mode/templates/README.md';
  const { projectRoot, plan } = planCase({
    disk: { [stale]: 'stale plugin file\n' },
    rendered: [],
    manifestFiles: [
      {
        destination: stale,
        source: 'templates/dev-docs/README.md',
        sha256: sha256('stale plugin file\n'),
        owned: true,
      },
    ],
  });
  try {
    const item = actionFor(plan, stale);
    assert.equal(item.action, 'prune');
    assert.equal(item.label, LABELS.pruned);
    assert.equal(item.row, 10);
    assert.equal(item.kind, 'stale');
    assert.equal(plan.counts.pruned, 1);
    assert.equal(plan.backupNeeded, true);
  } finally {
    removeFixture(projectRoot);
  }
});

test('row 11: in manifest, source gone/present/D != M -> keep', () => {
  const stale = '.beast-mode/templates/README.md';
  const { projectRoot, plan } = planCase({
    disk: { [stale]: 'my own notes\n' },
    rendered: [],
    manifestFiles: [
      {
        destination: stale,
        source: 'templates/dev-docs/README.md',
        sha256: sha256('stale plugin file\n'),
        owned: true,
      },
    ],
  });
  try {
    const item = actionFor(plan, stale);
    assert.equal(item.action, 'keep');
    assert.equal(item.label, LABELS.kept);
    assert.equal(item.row, 11);
    assert.equal(plan.counts.kept, 1);
    assert.equal(plan.counts.pruned, 0);
    assert.equal(plan.backupNeeded, false);
  } finally {
    removeFixture(projectRoot);
  }
});

test('row 12: in manifest, source gone/missing/- -> drop, quiet', () => {
  const stale = '.beast-mode/templates/plan.md';
  const { projectRoot, plan } = planCase({
    rendered: [],
    manifestFiles: [
      { destination: stale, source: 'templates/dev-docs/plan.md', sha256: sha256('gone\n'), owned: true },
    ],
  });
  try {
    const item = actionFor(plan, stale);
    assert.equal(item.action, 'drop');
    assert.equal(item.label, null);
    assert.equal(item.row, 12);
    assert.equal(plan.counts.dropped, 1);
    assert.equal(plan.backupNeeded, false);
  } finally {
    removeFixture(projectRoot);
  }
});

test('row 13: no entry, source exists/missing/- -> write, reported as Added', () => {
  const { projectRoot, plan } = planCase({
    rendered: [renderedFile('plugin\n')],
    manifestFiles: null,
  });
  try {
    const item = actionFor(plan, DEST);
    assert.equal(item.action, 'write');
    assert.equal(item.label, LABELS.added);
    assert.equal(item.row, 13);
    assert.equal(plan.noManifest, true);
    assert.equal(plan.counts.added, 1);
  } finally {
    removeFixture(projectRoot);
  }
});

test('row 14: no entry, source exists/present/D = S -> adopt', () => {
  const { projectRoot, plan } = planCase({
    disk: { [DEST]: 'plugin\n' },
    rendered: [renderedFile('plugin\n')],
    manifestFiles: null,
  });
  try {
    const item = actionFor(plan, DEST);
    assert.equal(item.action, 'adopt');
    assert.equal(item.label, LABELS.adopted);
    assert.equal(item.row, 14);
    assert.equal(plan.counts.adopted, 1);
  } finally {
    removeFixture(projectRoot);
  }
});

test('row 15: no entry, source exists/present/D != S -> skip, the file is yours', () => {
  const { projectRoot, plan } = planCase({
    disk: { [DEST]: 'my own file\n' },
    rendered: [renderedFile('plugin\n')],
    manifestFiles: null,
  });
  try {
    const item = actionFor(plan, DEST);
    assert.equal(item.action, 'skip');
    assert.equal(item.label, LABELS.skipped);
    assert.equal(item.row, 15);
    assert.equal(plan.counts.skipped, 1);
    assert.deepEqual(plan.skips, [{ destination: DEST, label: LABELS.skipped }]);
  } finally {
    removeFixture(projectRoot);
  }
});

test('row 16: no entry, source exists/present/D != S with --force -> force, reported as Forced', () => {
  const { projectRoot, plan } = planCase({
    disk: { [DEST]: 'my own file\n' },
    rendered: [renderedFile('plugin\n')],
    manifestFiles: null,
    force: true,
  });
  try {
    const item = actionFor(plan, DEST);
    assert.equal(item.action, 'force');
    assert.equal(item.label, LABELS.forced);
    assert.equal(item.row, 16);
    assert.equal(plan.noManifest, true);
    assert.equal(plan.counts.forced, 1);
    assert.equal(plan.counts.skipped, 0);
    assert.equal(plan.backupNeeded, true);
    assert.deepEqual(plan.skips, []);
  } finally {
    removeFixture(projectRoot);
  }
});

test('--force never turns a keep into a prune and never writes over it', () => {
  const stale = '.beast-mode/templates/README.md';
  const { projectRoot, plan } = planCase({
    disk: { [stale]: 'my own notes\n' },
    rendered: [],
    manifestFiles: [
      {
        destination: stale,
        source: 'templates/dev-docs/README.md',
        sha256: sha256('stale plugin file\n'),
        owned: true,
      },
    ],
    force: true,
  });
  try {
    const item = actionFor(plan, stale);
    assert.equal(item.action, 'keep');
    assert.equal(plan.counts.pruned, 0);
    assert.equal(plan.backupNeeded, false);
    assert.ok(!plan.actions.some((a) => a.action === 'prune' || a.action === 'force'));
  } finally {
    removeFixture(projectRoot);
  }
});

test('a run with no manifest never prunes, whatever sits on disk', () => {
  const { projectRoot, plan } = planCase({
    disk: {
      [DEST]: 'plugin\n',
      '.beast-mode/templates/README.md': 'a file no source produces\n',
    },
    rendered: [renderedFile('plugin\n')],
    manifestFiles: null,
  });
  try {
    assert.equal(plan.noManifest, true);
    assert.equal(plan.counts.pruned, 0);
    assert.ok(!plan.actions.some((a) => a.action === 'prune'));
    assert.equal(plan.backupNeeded, false);
    // The file the CLI cannot prove it wrote stays on disk, untouched.
    assert.ok(fs.existsSync(path.join(projectRoot, '.beast-mode', 'templates', 'README.md')));
  } finally {
    removeFixture(projectRoot);
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// planUpgrade(): the three shared rows of implementation.md section 3.3
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//
// The shared harness glossary reads no manifest, so one table test covers
// all three rows: S1 (missing), S2 (present, D = S), and S3 (present, D != S).

test('planUpgrade() decides the three shared rows: S1 Added, S2 up to date, S3 Updated with a backup', () => {
  const cases = [
    {
      name: 'S1: missing -> write, Added',
      disk: null,
      content: 'glossary v2\n',
      row: 'S1',
      action: 'write',
      label: LABELS.added,
      bucket: 'added',
      backupNeeded: false,
    },
    {
      name: 'S2: present, D = S -> none, quiet and up to date',
      disk: 'glossary v2\n',
      content: 'glossary v2\n',
      row: 'S2',
      action: 'none',
      label: null,
      bucket: 'upToDate',
      backupNeeded: false,
    },
    {
      name: 'S3: present, D != S -> overwrite, Updated',
      disk: 'glossary v1\n',
      content: 'glossary v2\n',
      row: 'S3',
      action: 'overwrite',
      label: LABELS.updated,
      bucket: 'updated',
      backupNeeded: true,
    },
  ];

  for (const c of cases) {
    const { projectRoot, plan } = planCase({
      disk: c.disk === null ? {} : { [GLOSSARY_DESTINATION]: c.disk },
      rendered: [
        renderedFile(c.content, {
          destination: GLOSSARY_DESTINATION,
          kind: 'shared',
          name: 'harness.md',
          source: null,
        }),
      ],
      manifestFiles: null,
    });
    try {
      const item = actionFor(plan, GLOSSARY_DESTINATION);
      assert.equal(item.action, c.action, c.name);
      assert.equal(item.label, c.label, c.name);
      assert.equal(item.row, c.row, c.name);
      assert.equal(item.bucket, c.bucket, c.name);
      assert.equal(plan.counts[c.bucket], 1, c.name);
      assert.equal(plan.backupNeeded, c.backupNeeded, c.name);
    } finally {
      removeFixture(projectRoot);
    }
  }
});

test('an adapter extra file always writes, never conflicts, and carries no label', () => {
  const versionFile = '.claude/.beast-mode-version';
  const { projectRoot, plan } = planCase({
    disk: { [versionFile]: '0.0.0\n' },
    rendered: [
      renderedFile('5.1.0\n', {
        destination: versionFile,
        kind: 'extra',
        name: '.beast-mode-version',
        source: null,
      }),
    ],
    manifestFiles: [],
  });
  try {
    const item = actionFor(plan, versionFile);
    assert.equal(item.action, 'write');
    assert.equal(item.label, null);
    assert.equal(item.bucket, null);
    assert.equal(plan.backupNeeded, false);
    assert.equal(plan.counts.skipped, 0);
  } finally {
    removeFixture(projectRoot);
  }
});
