// installer/test/multi-harness.test.js
//
// The CR-4 regression and the 5.3.0 manifest migration edge of
// implementation.md sections 3.3 and 3.4.
//
// CR-4: two harnesses in one project fought over ".beast-mode/harness.md".
// The second install took the file, and the first harness then reported
// "Skipped (you edited it)" for ever. The shared file kind closes it: the
// core composes the glossary from the whole harness set, the file carries
// no manifest entry, and the three shared rows read no manifest.
//
// Every test drives the real CLI entry point against the real plugin
// source, into a project root under os.tmpdir(). No test writes into this
// repo.

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { main } from '../bin/beast-mode.js';
import { findPluginRoot } from '../lib/source.js';
import { parse } from '../lib/glossary.js';
import { createTempProjectRoot, FOOTPRINT, removeFixture, snapshotTree } from './helpers.js';

const PLUGIN_ROOT = findPluginRoot(import.meta.dirname);

const GLOSSARY = '.beast-mode/harness.md';
const MARKER = '.beast-mode/version.json';

/**
 * Run one CLI command in this process, with the output collected.
 *
 * @param {string[]} args
 * @param {string} projectRoot
 * @returns {{ status: number, out: string }}
 */
function cli(args, projectRoot) {
  let out = '';
  const sink = {
    write(text) {
      out += text;
      return true;
    },
    isTTY: false,
  };
  const status = main([...args, '--project', projectRoot, '--plugin-root', PLUGIN_ROOT], {
    stdout: sink,
    stderr: sink,
    cwd: projectRoot,
  });
  return { status, out };
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
 * @param {string} projectRoot
 * @param {string} harnessRoot
 * @returns {any} The parsed manifest of one harness.
 */
function readManifestFile(projectRoot, harnessRoot) {
  return JSON.parse(fs.readFileSync(abs(projectRoot, `${harnessRoot}/.beast-mode-manifest.json`), 'utf8'));
}

/**
 * @param {string} relSourcePath Plugin-relative, forward slashes.
 * @returns {string}
 */
function sourceText(relSourcePath) {
  return fs.readFileSync(path.join(PLUGIN_ROOT, ...relSourcePath.split('/')), 'utf8');
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// The one-harness base case
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test('a one-harness install writes the source glossary bytes and a manifest of FOOTPRINT.manifestEntries entries', () => {
  const projectRoot = createTempProjectRoot();
  try {
    assert.equal(cli(['install', 'claude'], projectRoot).status, 0);

    assert.ok(
      fs
        .readFileSync(abs(projectRoot, GLOSSARY))
        .equals(fs.readFileSync(path.join(PLUGIN_ROOT, 'templates', 'harness', 'claude.md'))),
      'the one-harness glossary must be byte-identical to its source'
    );

    const manifest = readManifestFile(projectRoot, '.claude');
    assert.equal(manifest.files.length, FOOTPRINT.manifestEntries);
    assert.equal(manifest.files.filter((f) => f.destination === GLOSSARY).length, 0);

    const marker = JSON.parse(fs.readFileSync(abs(projectRoot, MARKER), 'utf8'));
    assert.equal(marker.schema, 1);
    assert.deepEqual(Object.keys(marker.harnesses), ['claude']);
    assert.equal(marker.harnesses.claude.harnessRoot, '.claude');
  } finally {
    removeFixture(projectRoot);
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CR-4: install A, install B, upgrade A
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test('CR-4: install dsh, install claude, then upgrade dsh reports zero skips', () => {
  const projectRoot = createTempProjectRoot();
  try {
    assert.equal(cli(['install', 'dsh'], projectRoot).status, 0);
    assert.equal(cli(['install', 'claude'], projectRoot).status, 0);

    const upgrade = cli(['upgrade', 'dsh'], projectRoot);
    assert.equal(upgrade.status, 0);
    assert.match(upgrade.out, /⏭️ Skipped: 0/);
    assert.doesNotMatch(upgrade.out, /Skipped files/);
    assert.doesNotMatch(upgrade.out, /you edited it/);
    // FOOTPRINT.manifestEntries source-backed files at row 2, plus the shared glossary at row S2.
    assert.match(upgrade.out, new RegExp(`✓ Up to date: ${FOOTPRINT.manifestEntries + 1}\\b`));
    assert.match(upgrade.out, /📦 Backup: none needed/);

    // The same run in the other direction stays quiet too.
    const back = cli(['upgrade', 'claude'], projectRoot);
    assert.equal(back.status, 0);
    assert.match(back.out, /⏭️ Skipped: 0/);
    assert.doesNotMatch(back.out, /you edited it/);
  } finally {
    removeFixture(projectRoot);
  }
});

test('CR-4: the composed glossary holds one section per harness after the second install', () => {
  const projectRoot = createTempProjectRoot();
  try {
    assert.equal(cli(['install', 'dsh'], projectRoot).status, 0);

    // One harness: the source bytes, with no marker line at all.
    const afterFirst = fs.readFileSync(abs(projectRoot, GLOSSARY), 'utf8');
    assert.equal(afterFirst, sourceText('templates/harness/dsh.md'));

    assert.equal(cli(['install', 'claude'], projectRoot).status, 0);

    const composed = fs.readFileSync(abs(projectRoot, GLOSSARY), 'utf8');
    assert.equal((composed.match(/beast-mode:harness/g) ?? []).length, 2);
    assert.match(composed, /^\*\*Harnesses:\*\* claude \(\.claude\/\), dsh \(\.agents\/\)$/m);

    // Each section parses back to its own source glossary, byte for byte.
    const sections = parse(composed);
    assert.deepEqual(
      sections.map((s) => s.id),
      ['claude', 'dsh']
    );
    assert.equal(sections[0].text, sourceText('templates/harness/claude.md'));
    assert.equal(sections[1].text, sourceText('templates/harness/dsh.md'));

    // Neither manifest owns the shared file.
    for (const harnessRoot of ['.claude', '.agents']) {
      const manifest = readManifestFile(projectRoot, harnessRoot);
      assert.equal(manifest.files.filter((f) => f.destination === GLOSSARY).length, 0, harnessRoot);
    }
  } finally {
    removeFixture(projectRoot);
  }
});

test('the marker records both harnesses, sorted, and preserves the first installed value', () => {
  const projectRoot = createTempProjectRoot();
  try {
    assert.equal(cli(['install', 'dsh'], projectRoot).status, 0);
    const afterFirst = JSON.parse(fs.readFileSync(abs(projectRoot, MARKER), 'utf8'));

    assert.equal(cli(['install', 'claude'], projectRoot).status, 0);
    const afterSecond = JSON.parse(fs.readFileSync(abs(projectRoot, MARKER), 'utf8'));

    assert.deepEqual(Object.keys(afterSecond.harnesses), ['claude', 'dsh']);
    assert.equal(afterSecond.harnesses.claude.harnessRoot, '.claude');
    assert.equal(afterSecond.harnesses.dsh.harnessRoot, '.agents');
    // Field rule 9: the claude run touched no dsh value.
    assert.deepEqual(afterSecond.harnesses.dsh, afterFirst.harnesses.dsh);

    // A later upgrade of dsh preserves its "installed" and moves "updated".
    assert.equal(cli(['upgrade', 'dsh'], projectRoot).status, 0);
    const afterUpgrade = JSON.parse(fs.readFileSync(abs(projectRoot, MARKER), 'utf8'));
    assert.equal(afterUpgrade.harnesses.dsh.installed, afterFirst.harnesses.dsh.installed);
    assert.notEqual(afterUpgrade.harnesses.dsh.updated, afterFirst.harnesses.dsh.updated);
  } finally {
    removeFixture(projectRoot);
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// The 5.3.0 manifest migration edge (section 3.4)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Install claude, then push the 5.3.0 shape back into the manifest: one
 * owned entry for the shared glossary.
 *
 * @param {string} projectRoot
 * @param {'matching' | 'stale'} hashKind
 * @returns {void}
 */
function seedLegacyGlossaryEntry(projectRoot, hashKind) {
  const file = abs(projectRoot, '.claude/.beast-mode-manifest.json');
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  const sha256 =
    hashKind === 'matching'
      ? crypto.createHash('sha256').update(fs.readFileSync(abs(projectRoot, GLOSSARY))).digest('hex')
      : '0'.repeat(64);

  manifest.files.push({
    destination: GLOSSARY,
    source: 'templates/harness/claude.md',
    sha256,
    owned: true,
  });
  fs.writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
}

for (const hashKind of ['matching', 'stale']) {
  test(`an upgrade drops a 5.3.0 glossary entry with a ${hashKind} hash, and keeps the file`, () => {
    const projectRoot = createTempProjectRoot();
    try {
      assert.equal(cli(['install', 'claude'], projectRoot).status, 0);
      seedLegacyGlossaryEntry(projectRoot, hashKind);

      const upgrade = cli(['upgrade', 'claude'], projectRoot);
      assert.equal(upgrade.status, 0);
      assert.match(upgrade.out, /⏭️ Skipped: 0/);
      assert.match(upgrade.out, /🗑️ Pruned: 0/);
      assert.match(upgrade.out, /⚠ Kept: 0/);
      assert.match(upgrade.out, new RegExp(`✓ Up to date: ${FOOTPRINT.manifestEntries + 1}\\b`));
      assert.doesNotMatch(upgrade.out, /you edited it/);

      // The old entry leaves the manifest with no prune, no keep, and no
      // drop count, because the rendered loop marked the destination
      // handled and the manifest builder skips the shared kind.
      const manifest = readManifestFile(projectRoot, '.claude');
      assert.equal(manifest.files.length, FOOTPRINT.manifestEntries);
      assert.equal(manifest.files.filter((f) => f.destination === GLOSSARY).length, 0);

      // The file itself never moves.
      assert.ok(fs.existsSync(abs(projectRoot, GLOSSARY)));
      assert.equal(
        fs.readFileSync(abs(projectRoot, GLOSSARY), 'utf8'),
        sourceText('templates/harness/claude.md')
      );
    } finally {
      removeFixture(projectRoot);
    }
  });
}

test('an upgrade with no marker detects both harnesses from their manifests', () => {
  const projectRoot = createTempProjectRoot();
  try {
    assert.equal(cli(['install', 'dsh'], projectRoot).status, 0);
    assert.equal(cli(['install', 'claude'], projectRoot).status, 0);

    // The shape of a project that two runs of 5.3.0 installed: both
    // manifests, and no marker at all.
    fs.rmSync(abs(projectRoot, MARKER));

    const upgrade = cli(['upgrade', 'claude'], projectRoot);
    assert.equal(upgrade.status, 0);
    assert.match(upgrade.out, /⏭️ Skipped: 0/);
    assert.match(upgrade.out, /composed from 2 harnesses \(claude, dsh\)/);

    const marker = JSON.parse(fs.readFileSync(abs(projectRoot, MARKER), 'utf8'));
    assert.deepEqual(Object.keys(marker.harnesses), ['claude', 'dsh']);
    // The version file of the other harness is the authority for its
    // version, so the rebuilt entry holds the version it really has.
    assert.equal(
      marker.harnesses.dsh.version,
      fs.readFileSync(abs(projectRoot, '.agents/.beast-mode-version'), 'utf8').trim()
    );
  } finally {
    removeFixture(projectRoot);
  }
});

test('an unreadable marker warns, never stops the run, and the run rebuilds the file', () => {
  const projectRoot = createTempProjectRoot();
  try {
    assert.equal(cli(['install', 'claude'], projectRoot).status, 0);
    fs.writeFileSync(abs(projectRoot, MARKER), 'not json at all\n');

    const upgrade = cli(['upgrade', 'claude'], projectRoot);
    assert.equal(upgrade.status, 0);
    assert.match(upgrade.out, /⚠ The marker at "\.beast-mode\/version\.json" is not valid JSON/);
    assert.match(upgrade.out, /⏭️ Skipped: 0/);

    const marker = JSON.parse(fs.readFileSync(abs(projectRoot, MARKER), 'utf8'));
    assert.equal(marker.schema, 1);
    assert.deepEqual(Object.keys(marker.harnesses), ['claude']);
  } finally {
    removeFixture(projectRoot);
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Row S3: an edited shared glossary is backed up before it is replaced
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test('an edited shared glossary takes row S3: a backup copy first, then the composed bytes', () => {
  const projectRoot = createTempProjectRoot();
  try {
    assert.equal(cli(['install', 'claude'], projectRoot).status, 0);
    fs.appendFileSync(abs(projectRoot, GLOSSARY), 'my own glossary note\n');

    const upgrade = cli(['upgrade', 'claude'], projectRoot);
    assert.equal(upgrade.status, 0);
    assert.match(upgrade.out, /✅ Updated: 1/);
    assert.match(upgrade.out, /⏭️ Skipped: 0/);
    assert.match(upgrade.out, /📦 Backup: \.claude\/\.beast-mode-backup-/);

    // The plugin copy wins, and the old file survives in the backup.
    assert.equal(
      fs.readFileSync(abs(projectRoot, GLOSSARY), 'utf8'),
      sourceText('templates/harness/claude.md')
    );
    const backupDir = fs
      .readdirSync(abs(projectRoot, '.claude'))
      .find((name) => name.startsWith('.beast-mode-backup-'));
    assert.ok(backupDir, 'the run must create one backup directory');
    const backupFile = abs(projectRoot, `.claude/${backupDir}/${GLOSSARY}`);
    assert.ok(fs.readFileSync(backupFile, 'utf8').endsWith('my own glossary note\n'));
  } finally {
    removeFixture(projectRoot);
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Dry-run purity: no file, no manifest, no marker, no glossary
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test('install --dry-run writes no marker and no glossary', () => {
  const projectRoot = createTempProjectRoot();
  try {
    const before = snapshotTree(projectRoot);
    const result = cli(['install', 'claude', '--dry-run'], projectRoot);
    const after = snapshotTree(projectRoot);

    assert.equal(result.status, 0);
    assert.deepEqual(after, before);
    assert.ok(!fs.existsSync(abs(projectRoot, MARKER)));
    assert.ok(!fs.existsSync(abs(projectRoot, GLOSSARY)));
    assert.deepEqual(fs.readdirSync(projectRoot), []);
  } finally {
    removeFixture(projectRoot);
  }
});

test('upgrade --dry-run changes no byte of the marker or the composed glossary', () => {
  const projectRoot = createTempProjectRoot();
  try {
    assert.equal(cli(['install', 'dsh'], projectRoot).status, 0);
    assert.equal(cli(['install', 'claude'], projectRoot).status, 0);

    const before = snapshotTree(projectRoot);
    const result = cli(['upgrade', 'claude', '--dry-run'], projectRoot);
    const after = snapshotTree(projectRoot);

    assert.equal(result.status, 0);
    assert.match(result.out, /UPGRADE PLAN \(dry run\)/);
    assert.deepEqual(after, before);
  } finally {
    removeFixture(projectRoot);
  }
});

test('render writes the one-harness glossary and no marker at all', () => {
  const outDir = path.join(createTempProjectRoot(), 'out');
  try {
    let out = '';
    const sink = {
      write(text) {
        out += text;
        return true;
      },
      isTTY: false,
    };
    const status = main(['render', 'claude', '--out', outDir, '--plugin-root', PLUGIN_ROOT], {
      stdout: sink,
      stderr: sink,
      cwd: path.dirname(outDir),
    });

    assert.equal(status, 0);
    assert.ok(!fs.existsSync(path.join(outDir, ...MARKER.split('/'))));
    assert.ok(
      fs
        .readFileSync(path.join(outDir, ...GLOSSARY.split('/')))
        .equals(fs.readFileSync(path.join(PLUGIN_ROOT, 'templates', 'harness', 'claude.md')))
    );
  } finally {
    removeFixture(path.dirname(outDir));
  }
});
