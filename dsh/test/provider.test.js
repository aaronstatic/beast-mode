// dsh/test/provider.test.js
//
// Covers the dsh skill provider of implementation.md section 3.4
// (harness-support/dsh-plugin, Phase 2): the candidate list, the get()
// body substitution, the bundle patch, and the root package.json.
//
// Every test runs with plain Node. No test starts dsh and no test needs
// the dsh package installed.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { provider } from '../lib/index.js';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** Read one frontmatter field with a small regex. No YAML dependency. */
function readFrontmatterField(text, field) {
  const re = new RegExp(`^${field}:\\s*"?([^"\\n]*)"?\\s*$`, 'm');
  const match = text.match(re);
  return match ? match[1].trim() : null;
}

/**
 * Parse dsh/cordis.patch.yml as a small hand-rolled reader.
 *
 * The file holds one top-level "- insert:" block with one row. This
 * function reads the row's "id" and "name" fields by line match. It is not
 * a general YAML parser, and the patch file must never grow more than the
 * one documented row.
 */
function readPatchRow(text) {
  const lines = text.split('\n');
  const insertIndex = lines.findIndex((line) => line.trim() === '- insert:');
  assert.ok(insertIndex >= 0, 'the patch file must hold a top-level "- insert:" row');
  const rowLines = lines.slice(insertIndex + 1).filter((line) => line.trim().length > 0);
  const idLine = rowLines.find((line) => line.trim().startsWith('- id:'));
  const nameLine = rowLines.find((line) => line.trim().startsWith('name:'));
  assert.ok(idLine, 'the insert row must declare an id');
  assert.ok(nameLine, 'the insert row must declare a name');
  return {
    id: idLine.split(':').slice(1).join(':').trim(),
    name: nameLine.split(':').slice(1).join(':').trim(),
  };
}

test('list() returns two candidates with rank 600 and source bundled', async () => {
  const candidates = await provider.list();
  assert.equal(candidates.length, 2);
  for (const candidate of candidates) {
    assert.equal(candidate.rank, 600);
    assert.equal(candidate.source, 'bundled');
    assert.deepEqual(candidate.invocation, { modelInvocable: true, userInvocable: true });
    assert.equal(candidate.provider, 'beast-mode');
  }
});

test('each candidate name equals its folder name and the frontmatter name', async () => {
  const candidates = await provider.list();
  for (const candidate of candidates) {
    const skillPath = path.join(REPO_ROOT, 'dsh', 'skills', candidate.name, 'SKILL.md');
    const text = fs.readFileSync(skillPath, 'utf8');
    const frontmatterName = readFrontmatterField(text, 'name');
    assert.equal(candidate.name, path.basename(path.dirname(skillPath)));
    assert.equal(candidate.name, frontmatterName);
  }
});

test('get() strips the frontmatter fence and substitutes the token', async () => {
  const candidates = await provider.list();
  for (const candidate of candidates) {
    const definition = await provider.get(candidate);
    assert.ok(!/^---\r?\n/.test(definition.content), 'the body must hold no leading frontmatter fence');
    assert.ok(!definition.content.includes('{{'), 'the body must hold no unsubstituted token');
  }
});

test('the substituted installer path exists on disk', async () => {
  const candidates = await provider.list();
  const installCandidate = candidates.find((c) => c.name === 'install-beast-mode');
  const definition = await provider.get(installCandidate);
  const match = definition.content.match(/(\S+\/installer\/bin\/beast-mode\.js)/);
  assert.ok(match, 'the body must name the installer path');
  assert.ok(fs.existsSync(match[1]), `the installer must exist at ${match[1]}`);
});

test('resourceBase.path is absolute and ends with the skill name', async () => {
  const candidates = await provider.list();
  for (const candidate of candidates) {
    assert.equal(candidate.resourceBase.kind, 'directory');
    assert.ok(path.isAbsolute(candidate.resourceBase.path));
    const trimmed = candidate.resourceBase.path.replace(/[/\\]+$/, '');
    assert.equal(path.basename(trimmed), candidate.name);
  }
});

test('the patch file holds one insert row that names ./lib/index.js and id beast-mode', () => {
  const patchPath = path.join(REPO_ROOT, 'dsh', 'cordis.patch.yml');
  const text = fs.readFileSync(patchPath, 'utf8');
  const row = readPatchRow(text);
  assert.equal(row.id, 'beast-mode');
  assert.equal(row.name, './lib/index.js');
});

test('package.json declares dsh.bundle.patch and the named file exists', () => {
  const packageJsonPath = path.join(REPO_ROOT, 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const patchRelative = packageJson.dsh?.bundle?.patch;
  assert.ok(patchRelative, 'package.json must declare dsh.bundle.patch');
  const patchPath = path.join(REPO_ROOT, patchRelative);
  assert.ok(fs.existsSync(patchPath), `the declared patch file must exist at ${patchPath}`);
});

test('package.json version equals the plugin manifest version', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  const pluginJson = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, '.claude-plugin', 'plugin.json'), 'utf8')
  );
  assert.equal(packageJson.version, pluginJson.version);
});

// The root package ships plain source. It declares no runtime dependency,
// so an install runs no build step and adds no compiled binary. The one
// `bin` entry it does declare names the installer CLI script directly,
// with no build step of its own.
//
// Two fields are deliberate exceptions since the dsh web panel feature.
// `devDependencies` holds esbuild, the maintainer tool that builds the
// artifacts under `dsh/panel/`. No runtime path imports it. `exports`
// holds the three entries of the panel packaging contract.
// `dsh/test/packaging.test.js` owns the assertions for both fields.
test('package.json declares no dependencies and names the installer CLI as its one bin entry', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  assert.deepEqual(Object.keys(packageJson.dependencies ?? {}), []);
  assert.deepEqual(packageJson.bin, { 'beast-mode': './installer/bin/beast-mode.js' });
  assert.deepEqual(Object.keys(packageJson.devDependencies ?? {}), ['esbuild']);
});
