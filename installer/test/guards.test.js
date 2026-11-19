// installer/test/guards.test.js
//
// Covers the three guards of lib/guards.js: the symlink guard, the
// plugin-repo guard, and the same-root guard. Every fixture lives under a
// fresh os.tmpdir() directory. A refused run must create no file.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { runGuards, findSymlinks, isPluginRepo, isSameRoot } from '../lib/guards.js';
import { GuardRefusalError } from '../lib/errors.js';
import { createFixturePluginRoot, createTempProjectRoot, removeFixture } from './helpers.js';

test('runGuards throws exit 4 and names the path when .beast-mode is a symlink', (t) => {
  const projectRoot = createTempProjectRoot();
  const pluginRoot = createFixturePluginRoot();
  t.after(() => {
    removeFixture(projectRoot);
    removeFixture(pluginRoot);
  });

  const realTarget = path.join(projectRoot, 'real-beast-mode');
  fs.mkdirSync(realTarget);
  fs.symlinkSync(realTarget, path.join(projectRoot, '.beast-mode'), 'dir');

  assert.throws(
    () => runGuards({ projectRoot, pluginRoot, harnessRoot: '.claude' }),
    (err) => {
      assert.ok(err instanceof GuardRefusalError);
      assert.equal(err.exitCode, 4);
      assert.match(err.causeText, /\.beast-mode/);
      assert.match(err.causeText, /real-beast-mode/);
      return true;
    }
  );

  // Nothing beyond the fixture's own setup exists in the project root.
  const entries = fs.readdirSync(projectRoot).sort();
  assert.deepEqual(entries, ['.beast-mode', 'real-beast-mode']);
});

test('findSymlinks reports every linked layout path with its target', () => {
  const projectRoot = createTempProjectRoot();
  try {
    const target = path.join(projectRoot, 'target');
    fs.mkdirSync(target);
    fs.mkdirSync(path.join(projectRoot, '.claude'), { recursive: true });
    fs.symlinkSync(target, path.join(projectRoot, '.claude', 'skills'), 'dir');

    const found = findSymlinks(projectRoot, '.claude');
    assert.equal(found.length, 1);
    assert.equal(found[0].relPath, '.claude/skills');
    assert.equal(found[0].target, target);
  } finally {
    removeFixture(projectRoot);
  }
});

test('runGuards throws exit 4 when the project root holds the beast-mode plugin manifest', (t) => {
  const projectRoot = createTempProjectRoot();
  const pluginRoot = createFixturePluginRoot();
  t.after(() => {
    removeFixture(projectRoot);
    removeFixture(pluginRoot);
  });

  fs.mkdirSync(path.join(projectRoot, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(
    path.join(projectRoot, '.claude-plugin', 'plugin.json'),
    JSON.stringify({ name: 'beast-mode', version: '1.0.0' })
  );

  assert.throws(
    () => runGuards({ projectRoot, pluginRoot, harnessRoot: '.claude' }),
    (err) => {
      assert.ok(err instanceof GuardRefusalError);
      assert.equal(err.exitCode, 4);
      assert.match(err.causeText, /plugin manifest/);
      assert.match(err.fix, /dev-link\.sh/);
      return true;
    }
  );

  assert.ok(isPluginRepo(projectRoot));
});

test('runGuards throws exit 4 when the project root equals the plugin root', (t) => {
  const root = createFixturePluginRoot();
  t.after(() => removeFixture(root));

  assert.throws(
    () => runGuards({ projectRoot: root, pluginRoot: root, harnessRoot: '.claude' }),
    (err) => {
      assert.ok(err instanceof GuardRefusalError);
      assert.equal(err.exitCode, 4);
      assert.match(err.causeText, /project root is the plugin root/);
      assert.match(err.fix, /dev-link\.sh/);
      return true;
    }
  );

  assert.ok(isSameRoot(root, root));
});

test('runGuards passes on a clean fixture project and writes nothing', (t) => {
  const projectRoot = createTempProjectRoot();
  const pluginRoot = createFixturePluginRoot();
  t.after(() => {
    removeFixture(projectRoot);
    removeFixture(pluginRoot);
  });

  assert.doesNotThrow(() => runGuards({ projectRoot, pluginRoot, harnessRoot: '.claude' }));

  assert.deepEqual(fs.readdirSync(projectRoot), []);
});
