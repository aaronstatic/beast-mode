// installer/test/conformance.test.js
//
// The six static assertions of implementation.md section 3.9. This suite
// renders both harnesses with the exported main() and the command
// "render <harness> --out <dir>", which skips every guard (installer-cli
// Decision 10), so it runs safely against the real plugin source, from
// inside the Beast Mode repo. No test here installs, and no test writes
// into this repo: every render lands in a fresh directory under
// os.tmpdir(), and after() removes every one of them.
//
// This file proves the shape that lets one command body, and one composed
// glossary, serve more than one harness with the same document structure.
// The live half of the procedure, which drives a real harness session, is
// scripts/conformance-live.sh and scripts/conformance-diff.sh.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

import { main } from '../bin/beast-mode.js';
import { findPluginRoot, validateGlossary } from '../lib/source.js';
import { compose, parse } from '../lib/glossary.js';
import { split } from '../lib/frontmatter.js';
import { adapters } from '../adapters/index.js';
import { FOOTPRINT, snapshotTree } from './helpers.js';

const PLUGIN_ROOT = findPluginRoot(import.meta.dirname);
const HARNESS_IDS = Object.keys(adapters).sort();

/** @type {string[]} */
const tempDirs = [];

/**
 * Render one harness into a fresh temporary directory with the exported
 * main(). Fails the suite at load time when a render itself fails, because
 * every assertion below depends on both renders having succeeded.
 *
 * @param {string} id
 * @returns {string} The absolute path to the render output directory.
 */
function renderHarness(id) {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), `bm-conformance-${id}-`));
  tempDirs.push(outDir);

  let out = '';
  const sink = {
    write(text) {
      out += text;
      return true;
    },
    isTTY: false,
  };
  const status = main(['render', id, '--out', outDir, '--plugin-root', PLUGIN_ROOT], {
    stdout: sink,
    stderr: sink,
  });
  assert.equal(status, 0, `"render ${id}" must exit 0:\n${out}`);
  return outDir;
}

/** @type {Record<string, string>} */
const renders = Object.fromEntries(HARNESS_IDS.map((id) => [id, renderHarness(id)]));

after(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * @param {string} sourceGlossaryPath Plugin-relative, forward slashes.
 * @returns {string}
 */
function sourceText(sourceGlossaryPath) {
  return fs.readFileSync(path.join(PLUGIN_ROOT, ...sourceGlossaryPath.split('/')), 'utf8');
}

/**
 * The rendered skill folder names of one harness. Every adapter renders a
 * command skill to "<harnessRoot>/skills/<name>/SKILL.md".
 *
 * @param {string} id
 * @returns {string[]} Sorted.
 */
function renderedSkillNames(id) {
  const dir = path.join(renders[id], ...adapters[id].harnessRoot.split('/'), 'skills');
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/**
 * The rendered agent name set of one harness. The Claude adapter renders an
 * agent to "<harnessRoot>/agents/<name>.md". The dsh adapter renders it as
 * a flat file next to the skill folders, at "<harnessRoot>/skills/<name>.md".
 *
 * @param {string} id
 * @returns {string[]} Sorted.
 */
function renderedAgentNames(id) {
  const dir =
    id === 'dsh'
      ? path.join(renders[id], ...adapters[id].harnessRoot.split('/'), 'skills')
      : path.join(renders[id], ...adapters[id].harnessRoot.split('/'), 'agents');

  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => entry.name.slice(0, -3))
    .sort();
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 1. The skill name set
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test('the skill name set of both renders equals the FOOTPRINT.skills folders under templates/skills/', () => {
  const templateNames = fs
    .readdirSync(path.join(PLUGIN_ROOT, 'templates', 'skills'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  assert.equal(templateNames.length, FOOTPRINT.skills);
  for (const id of HARNESS_IDS) {
    assert.deepEqual(renderedSkillNames(id), templateNames, `the ${id} render must match the skill source set`);
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 2. The agent name set
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test('the agent name set of both renders equals the 2 files under templates/agents/', () => {
  const templateNames = fs
    .readdirSync(path.join(PLUGIN_ROOT, 'templates', 'agents'), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => entry.name.slice(0, -3))
    .sort();

  assert.equal(templateNames.length, 2);
  for (const id of HARNESS_IDS) {
    assert.deepEqual(renderedAgentNames(id), templateNames, `the ${id} render must match the agent source set`);
  }
});

test('both renders keep feature-orchestrator fixed at model opus and effort xhigh', () => {
  for (const id of HARNESS_IDS) {
    const dir = id === 'dsh' ? 'skills' : 'agents';
    const file = path.join(renders[id], ...adapters[id].harnessRoot.split('/'), dir, 'feature-orchestrator.md');
    const parsed = split(fs.readFileSync(file, 'utf8'));
    assert.ok(parsed, `the ${id} render of feature-orchestrator must carry frontmatter`);
    assert.equal(parsed.data.model, 'opus', `the ${id} render must keep model opus`);
    assert.equal(parsed.data.effort, 'xhigh', `the ${id} render must keep effort xhigh`);
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 3. Byte identity of the shared root, apart from harness.md
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test('every file under .beast-mode/ is byte-identical between the two renders, apart from harness.md', () => {
  const snapshots = HARNESS_IDS.map((id) => snapshotTree(path.join(renders[id], '.beast-mode')));

  for (const snapshot of snapshots) delete snapshot['harness.md'];

  assert.ok(Object.keys(snapshots[0]).length > 0, 'the .beast-mode/ tree must hold at least one shared file');
  for (let i = 1; i < snapshots.length; i++) {
    assert.deepEqual(
      snapshots[i],
      snapshots[0],
      `${HARNESS_IDS[i]} must hold the same .beast-mode/ file set and hashes as ${HARNESS_IDS[0]}, apart from harness.md`
    );
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 4. The one-harness base case, and shape validation
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test('each rendered harness.md equals its templates/harness/<id>.md source, and passes validateGlossary()', () => {
  for (const id of HARNESS_IDS) {
    const rendered = fs.readFileSync(path.join(renders[id], '.beast-mode', 'harness.md'), 'utf8');
    const source = sourceText(`templates/harness/${id}.md`);

    assert.equal(rendered, source, `the rendered ${id} glossary must equal its source byte for byte`);
    assert.doesNotThrow(() =>
      validateGlossary(rendered, `templates/harness/${id}.md`, adapters[id].glossaryHarnessId)
    );
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 5. The composed round trip
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test('parse(compose([claude, dsh])) returns the two source glossaries, each still valid', () => {
  const sections = HARNESS_IDS.map((id) => ({
    id,
    harnessRoot: adapters[id].harnessRoot,
    text: sourceText(`templates/harness/${id}.md`),
  }));

  const composed = compose(sections);
  const parsed = parse(composed);

  assert.equal(parsed.length, sections.length);
  for (let i = 0; i < sections.length; i++) {
    assert.equal(parsed[i].text, sections[i].text, `section ${sections[i].id} must round-trip unchanged`);
    assert.doesNotThrow(() =>
      validateGlossary(parsed[i].text, `parsed/${sections[i].id}.md`, adapters[sections[i].id].glossaryHarnessId)
    );
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 6. No shared file names a harness path
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test('no file under .beast-mode/ in either render names a harness path, apart from harness.md', () => {
  const HARNESS_PATH_RE = /\.claude\/|\.agents\/|\.dsh\//;

  for (const id of HARNESS_IDS) {
    const dir = path.join(renders[id], '.beast-mode');
    for (const relPath of Object.keys(snapshotTree(dir))) {
      if (relPath === 'harness.md') continue;
      const text = fs.readFileSync(path.join(dir, ...relPath.split('/')), 'utf8');
      assert.doesNotMatch(text, HARNESS_PATH_RE, `${id}/.beast-mode/${relPath} must not name a harness path`);
    }
  }
});
