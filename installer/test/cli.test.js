// installer/test/cli.test.js
//
// Spawns installer/bin/beast-mode.js as a real process and asserts exit
// codes, stdout/stderr content, and the on-disk effect of --dry-run,
// install twice, render --out, and upgrade with a conflict.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { findPluginRoot } from '../lib/source.js';
import { checkNodeVersion } from '../bin/beast-mode.js';
import { createTempProjectRoot, FOOTPRINT, removeFixture, snapshotTree } from './helpers.js';

const PLUGIN_ROOT = findPluginRoot(import.meta.dirname);
const CLI = path.join(PLUGIN_ROOT, 'installer', 'bin', 'beast-mode.js');

/**
 * @param {string[]} args
 * @param {{ cwd?: string }} [opts]
 */
function run(args, opts = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: opts.cwd ?? PLUGIN_ROOT,
    encoding: 'utf8',
  });
}

test('--help exits 0 and names install, upgrade, and render', () => {
  const result = run(['--help']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /\binstall\b/);
  assert.match(result.stdout, /\bupgrade\b/);
  assert.match(result.stdout, /\brender\b/);
});

test('--version prints the plugin version', () => {
  const pluginJson = JSON.parse(
    fs.readFileSync(path.join(PLUGIN_ROOT, '.claude-plugin', 'plugin.json'), 'utf8')
  );
  const result = run(['--version']);
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), pluginJson.version);
});

test('checkNodeVersion throws below 20 and passes at 20 or later', () => {
  assert.throws(() => checkNodeVersion('18.19.0'), /Node\.js 18\.19\.0 is too old\./);
  assert.doesNotThrow(() => checkNodeVersion('20.0.0'));
});

test('an unknown flag exits 2', () => {
  const result = run(['install', 'claude', '--not-a-real-flag']);
  assert.equal(result.status, 2);
});

test('an unknown harness exits 3', () => {
  const projectRoot = createTempProjectRoot();
  try {
    const result = run(['install', 'not-a-real-harness', '--project', projectRoot]);
    assert.equal(result.status, 3);
  } finally {
    removeFixture(projectRoot);
  }
});

test('install claude --dry-run creates nothing in the project', () => {
  const projectRoot = createTempProjectRoot();
  try {
    const before = fs.readdirSync(projectRoot).sort();
    const result = run(['install', 'claude', '--dry-run', '--project', projectRoot]);
    assert.equal(result.status, 0);
    const after = fs.readdirSync(projectRoot).sort();
    assert.deepEqual(after, before);
  } finally {
    removeFixture(projectRoot);
  }
});

test('install claude writes the shared version marker and names the composed glossary', () => {
  const projectRoot = createTempProjectRoot();
  try {
    const result = run(['install', 'claude', '--project', projectRoot]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /Harness glossary: \.beast-mode\/harness\.md, composed from 1 harness \(claude\)\./);

    const marker = JSON.parse(
      fs.readFileSync(path.join(projectRoot, '.beast-mode', 'version.json'), 'utf8')
    );
    assert.equal(marker.schema, 1);
    assert.deepEqual(Object.keys(marker.harnesses), ['claude']);
    assert.equal(marker.harnesses.claude.harnessRoot, '.claude');

    // The shared glossary carries no manifest entry any more.
    const manifest = JSON.parse(
      fs.readFileSync(path.join(projectRoot, '.claude', '.beast-mode-manifest.json'), 'utf8')
    );
    assert.equal(manifest.files.length, FOOTPRINT.manifestEntries);
    assert.equal(manifest.files.filter((f) => f.destination.endsWith('harness.md')).length, 0);
  } finally {
    removeFixture(projectRoot);
  }
});

test('install claude twice exits 7 the second time and names upgrade', () => {
  const projectRoot = createTempProjectRoot();
  try {
    const first = run(['install', 'claude', '--project', projectRoot]);
    assert.equal(first.status, 0);

    const second = run(['install', 'claude', '--project', projectRoot]);
    assert.equal(second.status, 7);
    assert.match(second.stdout + second.stderr, /upgrade/);
  } finally {
    removeFixture(projectRoot);
  }
});

test('render claude --out <dir> writes the tree and touches nothing in cwd', () => {
  const outDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bm-render-')), 'out');
  const cwdDir = createTempProjectRoot();
  try {
    const cwdBefore = fs.readdirSync(cwdDir).sort();
    const result = run(['render', 'claude', '--out', outDir], { cwd: cwdDir });
    assert.equal(result.status, 0);

    assert.equal(fs.readdirSync(path.join(outDir, '.claude', 'skills')).length, FOOTPRINT.skills);
    assert.ok(fs.existsSync(path.join(outDir, '.beast-mode', 'harness.md')));

    const cwdAfter = fs.readdirSync(cwdDir).sort();
    assert.deepEqual(cwdAfter, cwdBefore);
  } finally {
    removeFixture(path.dirname(outDir));
    removeFixture(cwdDir);
  }
});

test('render onto a non-empty --out exits 2', () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bm-render-'));
  try {
    fs.writeFileSync(path.join(outDir, 'already-here.txt'), 'x');
    const result = run(['render', 'claude', '--out', outDir]);
    assert.equal(result.status, 2);
  } finally {
    removeFixture(outDir);
  }
});

test('render with no --out exits 2', () => {
  const result = run(['render', 'claude']);
  assert.equal(result.status, 2);
});

test('upgrade with no harness argument exits 2', () => {
  const result = run(['upgrade']);
  assert.equal(result.status, 2);
  assert.match(result.stdout + result.stderr, /harness/);
});

test('install claude --force exits 2 and names upgrade as the only user of the flag', () => {
  const projectRoot = createTempProjectRoot();
  try {
    const result = run(['install', 'claude', '--force', '--project', projectRoot]);
    assert.equal(result.status, 2);
    assert.match(result.stdout + result.stderr, /upgrade/);
    assert.deepEqual(fs.readdirSync(projectRoot), []);
  } finally {
    removeFixture(projectRoot);
  }
});

test('upgrade claude after an edit exits 0 and prints the skip list', () => {
  const projectRoot = createTempProjectRoot();
  try {
    assert.equal(run(['install', 'claude', '--project', projectRoot]).status, 0);

    const skillFile = path.join(projectRoot, '.claude', 'skills', 'plan-feature', 'SKILL.md');
    fs.appendFileSync(skillFile, 'my own note\n');

    const result = run(['upgrade', 'claude', '--project', projectRoot]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /Skipped files/);
    assert.match(result.stdout, /Skipped \(you edited it\): \.claude\/skills\/plan-feature\/SKILL\.md/);
    assert.match(result.stdout, /UPGRADE COMPLETE/);
    // The manifest owns the file, so --force can take the plugin version.
    assert.match(result.stdout, /upgrade claude --force/);
    assert.ok(fs.readFileSync(skillFile, 'utf8').endsWith('my own note\n'));
  } finally {
    removeFixture(projectRoot);
  }
});

test('upgrade claude --dry-run changes no file and writes no manifest', () => {
  const projectRoot = createTempProjectRoot();
  try {
    assert.equal(run(['install', 'claude', '--project', projectRoot]).status, 0);

    fs.appendFileSync(path.join(projectRoot, '.claude', 'skills', 'plan-feature', 'SKILL.md'), 'note\n');
    fs.rmSync(path.join(projectRoot, '.claude', '.beast-mode-manifest.json'));

    const before = snapshotTree(projectRoot);
    const result = run(['upgrade', 'claude', '--dry-run', '--project', projectRoot]);
    const after = snapshotTree(projectRoot);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /UPGRADE PLAN \(dry run\)/);
    // A project with no manifest can still take the plugin copy, through
    // row 16, so the plan offers --force.
    assert.match(result.stdout, /upgrade claude --force/);
    assert.deepEqual(after, before);
    assert.ok(!fs.existsSync(path.join(projectRoot, '.claude', '.beast-mode-manifest.json')));

    // CR-11: a dry run with a forced write still needs a backup. The
    // preview must read like every other path the CLI prints: project
    // relative, never absolute.
    const forcedPreview = run(['upgrade', 'claude', '--force', '--dry-run', '--project', projectRoot]);
    assert.equal(forcedPreview.status, 0);
    assert.match(forcedPreview.stdout, /Backup would be written to: \.claude\/\.beast-mode-backup-/);
    assert.doesNotMatch(forcedPreview.stdout, /Backup would be written to: \//);
  } finally {
    removeFixture(projectRoot);
  }
});

test('upgrade claude with no changes prints Backup: none needed', () => {
  const projectRoot = createTempProjectRoot();
  try {
    assert.equal(run(['install', 'claude', '--project', projectRoot]).status, 0);

    const result = run(['upgrade', 'claude', '--project', projectRoot]);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /UPGRADE COMPLETE/);
    assert.match(result.stdout, /Backup: none needed/);
  } finally {
    removeFixture(projectRoot);
  }
});

test('upgrade claude --force on a project with no manifest exits 0 and forces one file', () => {
  const projectRoot = createTempProjectRoot();
  try {
    assert.equal(run(['install', 'claude', '--project', projectRoot]).status, 0);

    // The v5.0.0 shape: the files, no manifest, one edited skill.
    fs.rmSync(path.join(projectRoot, '.claude', '.beast-mode-manifest.json'));
    const skillFile = path.join(projectRoot, '.claude', 'skills', 'plan-feature', 'SKILL.md');
    fs.appendFileSync(skillFile, 'my own note\n');

    const plain = run(['upgrade', 'claude', '--project', projectRoot]);
    assert.equal(plain.status, 0);
    assert.match(plain.stdout, /Skipped \(yours\): \.claude\/skills\/plan-feature\/SKILL\.md/);
    assert.match(plain.stdout, /upgrade claude --force/);

    const forced = run(['upgrade', 'claude', '--force', '--project', projectRoot]);
    assert.equal(forced.status, 0);
    assert.match(forced.stdout, /Forced: 1/);
    assert.match(forced.stdout, /Backup: \.claude\/\.beast-mode-backup-/);

    const pluginBytes = fs.readFileSync(
      path.join(PLUGIN_ROOT, 'templates', 'skills', 'plan-feature', 'SKILL.md')
    );
    assert.ok(fs.readFileSync(skillFile).equals(pluginBytes));
  } finally {
    removeFixture(projectRoot);
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// status (Phase 2, plan section 3.6)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test('status on a fresh project prints the empty state and exits 0', () => {
  const projectRoot = createTempProjectRoot();
  try {
    const result = run(['status', '--project', projectRoot]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /No installed harness found in this project\./);
    assert.match(result.stdout, /beast-mode install <harness>/);
    assert.match(result.stdout, /claude, dsh/);
  } finally {
    removeFixture(projectRoot);
  }
});

test('status on a one-harness project prints Plugin version, the row, and up to date', () => {
  const projectRoot = createTempProjectRoot();
  try {
    assert.equal(run(['install', 'claude', '--project', projectRoot]).status, 0);

    const result = run(['status', '--project', projectRoot]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /Plugin version:\s+\S+/);
    assert.match(result.stdout, /claude\s+\.claude\s+v\S+\s+up to date/);
    assert.doesNotMatch(result.stdout, /stale/);
  } finally {
    removeFixture(projectRoot);
  }
});

test('status flags a harness whose own version file falls behind the plugin version', () => {
  const projectRoot = createTempProjectRoot();
  try {
    assert.equal(run(['install', 'claude', '--project', projectRoot]).status, 0);
    fs.writeFileSync(path.join(projectRoot, '.claude', '.beast-mode-version'), '0.0.0\n');

    const result = run(['status', '--project', projectRoot]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /claude\s+\.claude\s+v0\.0\.0\s+stale/);
    assert.match(result.stdout, /1 harness is behind the plugin version\./);
  } finally {
    removeFixture(projectRoot);
  }
});

test('status writes nothing: a tree snapshot before and after is identical', () => {
  const projectRoot = createTempProjectRoot();
  try {
    assert.equal(run(['install', 'claude', '--project', projectRoot]).status, 0);

    const before = snapshotTree(projectRoot);
    const result = run(['status', '--project', projectRoot]);
    const after = snapshotTree(projectRoot);

    assert.equal(result.status, 0);
    assert.deepEqual(after, before);
  } finally {
    removeFixture(projectRoot);
  }
});

test('status rejects a harness argument with exit 2', () => {
  const result = run(['status', 'claude']);
  assert.equal(result.status, 2);
  assert.match(result.stdout + result.stderr, /takes no harness argument/);
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// upgrade with no harness (Phase 2, plan section 3.5)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test('upgrade with no harness on an empty project exits 2 and names install and upgrade', () => {
  const projectRoot = createTempProjectRoot();
  try {
    const result = run(['upgrade', '--project', projectRoot]);
    assert.equal(result.status, 2);
    const out = result.stdout + result.stderr;
    assert.match(out, /beast-mode install <harness>/);
    assert.match(out, /beast-mode upgrade <harness>/);
  } finally {
    removeFixture(projectRoot);
  }
});

test('upgrade with no harness on a one-harness project upgrades it and prints one roll-up', () => {
  const projectRoot = createTempProjectRoot();
  try {
    assert.equal(run(['install', 'claude', '--project', projectRoot]).status, 0);

    const result = run(['upgrade', '--project', projectRoot]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /UPGRADING claude \(\.claude\)/);
    assert.match(result.stdout, /UPGRADE SUMMARY \(ALL HARNESSES\)/);
    assert.match(result.stdout, /claude \(\.claude\): exit 0/);
  } finally {
    removeFixture(projectRoot);
  }
});

test('upgrade with no harness matches upgrade <harness> in effect on a one-harness project', () => {
  const a = createTempProjectRoot();
  const b = createTempProjectRoot();
  try {
    assert.equal(run(['install', 'claude', '--project', a]).status, 0);
    assert.equal(run(['install', 'claude', '--project', b]).status, 0);

    assert.equal(run(['upgrade', 'claude', '--project', a]).status, 0);
    assert.equal(run(['upgrade', '--project', b]).status, 0);

    // Compare with every timestamp stripped, since "generated", "installed",
    // and "updated" always differ between two separate runs.
    const manifestShape = (root) => {
      const data = JSON.parse(
        fs.readFileSync(path.join(root, '.claude', '.beast-mode-manifest.json'), 'utf8')
      );
      delete data.generated;
      return data;
    };
    assert.deepEqual(manifestShape(a), manifestShape(b));

    const markerShape = (root) => {
      const data = JSON.parse(fs.readFileSync(path.join(root, '.beast-mode', 'version.json'), 'utf8'));
      delete data.generated;
      for (const entry of Object.values(data.harnesses)) {
        delete entry.installed;
        delete entry.updated;
      }
      return data;
    };
    assert.deepEqual(markerShape(a), markerShape(b));

    assert.ok(
      fs
        .readFileSync(path.join(a, '.beast-mode', 'harness.md'))
        .equals(fs.readFileSync(path.join(b, '.beast-mode', 'harness.md')))
    );
  } finally {
    removeFixture(a);
    removeFixture(b);
  }
});

test('upgrade with no harness on a two-harness project upgrades both and prints one roll-up', () => {
  const projectRoot = createTempProjectRoot();
  try {
    assert.equal(run(['install', 'dsh', '--project', projectRoot]).status, 0);
    assert.equal(run(['install', 'claude', '--project', projectRoot]).status, 0);

    const result = run(['upgrade', '--project', projectRoot]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /UPGRADING claude \(\.claude\)/);
    assert.match(result.stdout, /UPGRADING dsh \(\.agents\)/);
    assert.match(result.stdout, /UPGRADE SUMMARY \(ALL HARNESSES\)/);
    assert.match(result.stdout, /claude \(\.claude\): exit 0/);
    assert.match(result.stdout, /dsh \(\.agents\): exit 0/);
  } finally {
    removeFixture(projectRoot);
  }
});

test('upgrade with no harness returns the highest exit code, and the other harness still upgrades', () => {
  const projectRoot = createTempProjectRoot();
  try {
    assert.equal(run(['install', 'dsh', '--project', projectRoot]).status, 0);
    assert.equal(run(['install', 'claude', '--project', projectRoot]).status, 0);

    // Break the dsh manifest: unreadable JSON, per manifest.read().
    fs.writeFileSync(path.join(projectRoot, '.agents', '.beast-mode-manifest.json'), 'not json\n');

    const result = run(['upgrade', '--project', projectRoot]);
    assert.equal(result.status, 5);
    assert.match(result.stdout, /dsh \(\.agents\): exit 5/);
    assert.match(result.stdout, /claude \(\.claude\): exit 0/);

    const claudeManifest = JSON.parse(
      fs.readFileSync(path.join(projectRoot, '.claude', '.beast-mode-manifest.json'), 'utf8')
    );
    assert.equal(claudeManifest.files.length, FOOTPRINT.manifestEntries);
  } finally {
    removeFixture(projectRoot);
  }
});

test('upgrade with no harness exits 2 when the marker names only an unknown harness id', () => {
  const projectRoot = createTempProjectRoot();
  try {
    // No install ran here, so the marker starts as the only harness record.
    // "phantom" names no adapter this plugin version ships, so the batch
    // loop skips it and must refuse rather than print an empty roll-up.
    const now = new Date().toISOString();
    const markerFile = path.join(projectRoot, '.beast-mode', 'version.json');
    fs.mkdirSync(path.dirname(markerFile), { recursive: true });
    fs.writeFileSync(
      markerFile,
      `${JSON.stringify(
        {
          schema: 1,
          beastModeVersion: '5.4.0-fixture',
          generated: now,
          harnesses: {
            phantom: { harnessRoot: '.phantom', version: 'unknown', installed: now, updated: now },
          },
        },
        null,
        2
      )}\n`
    );

    const result = run(['upgrade', '--project', projectRoot]);
    assert.equal(result.status, 2);
    const out = result.stdout + result.stderr;
    assert.match(out, /holds no installed harness to upgrade/);
    assert.match(out, /beast-mode install <harness>/);
  } finally {
    removeFixture(projectRoot);
  }
});

test('--dry-run on the all-harness upgrade writes nothing at all', () => {
  const projectRoot = createTempProjectRoot();
  try {
    assert.equal(run(['install', 'dsh', '--project', projectRoot]).status, 0);
    assert.equal(run(['install', 'claude', '--project', projectRoot]).status, 0);

    const before = snapshotTree(projectRoot);
    const result = run(['upgrade', '--dry-run', '--project', projectRoot]);
    const after = snapshotTree(projectRoot);

    assert.equal(result.status, 0);
    assert.deepEqual(after, before);
  } finally {
    removeFixture(projectRoot);
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// The stale-install warning (Phase 2, plan section 3.7)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test('a real upgrade prints the exact singular stale-warning text', () => {
  const projectRoot = createTempProjectRoot();
  try {
    assert.equal(run(['install', 'claude', '--project', projectRoot]).status, 0);

    // Seed one other harness in the marker, with no real install behind it,
    // so readHarnessVersion() finds no file and falls back to "unknown",
    // which always differs from the plugin version.
    const markerFile = path.join(projectRoot, '.beast-mode', 'version.json');
    const seeded = JSON.parse(fs.readFileSync(markerFile, 'utf8'));
    seeded.harnesses.dsh = {
      harnessRoot: '.agents',
      version: 'unknown',
      installed: seeded.generated,
      updated: seeded.generated,
    };
    fs.writeFileSync(markerFile, `${JSON.stringify(seeded, null, 2)}\n`);

    const result = run(['upgrade', 'claude', '--project', projectRoot]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /⚠ 1 other harness in this project is behind the plugin version:/);
    assert.match(result.stdout, /dsh \(\.agents\/\) holds unknown\. The plugin ships v\S+\./);
    assert.match(
      result.stdout,
      /Run `beast-mode upgrade` to upgrade every installed harness in this project\./
    );
  } finally {
    removeFixture(projectRoot);
  }
});

test('a real upgrade prints the exact plural stale-warning text', () => {
  const projectRoot = createTempProjectRoot();
  try {
    assert.equal(run(['install', 'claude', '--project', projectRoot]).status, 0);

    const markerFile = path.join(projectRoot, '.beast-mode', 'version.json');
    const seeded = JSON.parse(fs.readFileSync(markerFile, 'utf8'));
    for (const id of ['dsh', 'third-harness']) {
      seeded.harnesses[id] = {
        harnessRoot: `.${id}`,
        version: 'unknown',
        installed: seeded.generated,
        updated: seeded.generated,
      };
    }
    fs.writeFileSync(markerFile, `${JSON.stringify(seeded, null, 2)}\n`);

    const result = run(['upgrade', 'claude', '--project', projectRoot]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /⚠ 2 other harnesses in this project are behind the plugin version:/);
  } finally {
    removeFixture(projectRoot);
  }
});

test('a manifest whose destination climbs out of the project exits 5 and deletes nothing', () => {
  const projectRoot = createTempProjectRoot();
  const outsideDir = createTempProjectRoot();
  try {
    assert.equal(run(['install', 'claude', '--project', projectRoot]).status, 0);

    const outsideFile = path.join(outsideDir, 'keep-me.txt');
    fs.writeFileSync(outsideFile, 'not yours to delete\n');

    const manifestFile = path.join(projectRoot, '.claude', '.beast-mode-manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    manifest.files.push({
      destination: '../../etc/passwd',
      source: 'templates/dev-docs/gone.md',
      sha256: 'a'.repeat(64),
      owned: true,
    });
    fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);

    const result = run(['upgrade', 'claude', '--project', projectRoot]);
    assert.equal(result.status, 5);
    assert.ok(fs.existsSync(outsideFile));
  } finally {
    removeFixture(projectRoot);
    removeFixture(outsideDir);
  }
});
