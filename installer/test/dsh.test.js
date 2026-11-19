// installer/test/dsh.test.js
//
// Covers the dsh adapter of implementation.md section 3.6
// (harness-support/dsh-plugin, Phase 1): the destination map for all FOOTPRINT.skills
// skills and the shipped agents, the arguments note, byte identity of
// the header block and of the body under the note, the agent frontmatter
// join, the "no disable-model-invocation" rule, the byte-identical shared
// ".beast-mode/" root across the two harnesses, the manifest, the check()
// shadow report, and the two core assumptions of section 3.10 (A1 and A2).
//
// Every test runs against the real plugin source (read-only) or a fixture
// plugin root under os.tmpdir(). No test writes into this repo.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { findPluginRoot, readSource } from '../lib/source.js';
import { split as splitFrontmatter } from '../lib/frontmatter.js';
import { render, planInstall } from '../lib/plan.js';
import { apply } from '../lib/apply.js';
import { createReporter } from '../lib/report.js';
import claude from '../adapters/claude.js';
import dsh, { ARGUMENTS_NOTE } from '../adapters/dsh.js';
import {
  createFixturePluginRoot,
  createTempProjectRoot,
  FOOTPRINT,
  goodGlossaryText,
  removeFixture,
  snapshotTree,
} from './helpers.js';

const PLUGIN_ROOT = findPluginRoot(import.meta.dirname);

/** A writable sink that swallows every write, so a test prints nothing. */
function nullStream() {
  return { write: () => true, isTTY: false };
}

/**
 * @param {string | Buffer} content
 * @returns {string}
 */
function text(content) {
  return Buffer.isBuffer(content) ? content.toString('utf8') : content;
}

/**
 * @param {string} haystack
 * @param {string} needle
 * @returns {number}
 */
function countOccurrences(haystack, needle) {
  return haystack.split(needle).length - 1;
}

/**
 * Read the plugin source and render it with one adapter.
 *
 * @param {import('../adapters/index.js').Adapter} adapter
 * @param {string} [pluginRoot]
 * @returns {{ source: ReturnType<typeof readSource>, rendered: import('../lib/plan.js').RenderedFile[] }}
 */
function readAndRender(adapter, pluginRoot = PLUGIN_ROOT) {
  const source = readSource({
    pluginRoot,
    harnessId: adapter.id,
    glossaryHarnessId: adapter.glossaryHarnessId,
  });
  const { rendered } = render({ source, adapter });
  return { source, rendered };
}

/**
 * Render and apply one adapter's install plan into a project root, with no
 * .gitignore and no docs/features scaffolding, the same call shape
 * "render --out" uses.
 *
 * @param {import('../adapters/index.js').Adapter} adapter
 * @param {string} projectRoot
 * @param {string} [pluginRoot]
 * @returns {{ source: ReturnType<typeof readSource> }}
 */
function renderInto(adapter, projectRoot, pluginRoot = PLUGIN_ROOT) {
  const { source, rendered } = readAndRender(adapter, pluginRoot);
  const plan = planInstall({
    rendered,
    projectRoot,
    harnessRoot: adapter.harnessRoot,
    manifest: null,
    includeGitignoreAndDocs: false,
  });
  apply(plan, {
    projectRoot,
    pluginRoot,
    adapter,
    source,
    reporter: createReporter(nullStream()),
    dryRun: false,
    mode: 'render',
  });
  return { source };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// A1 and A2 (implementation.md section 3.10)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test('A1: a null mapFrontmatter return keeps the source header bytes when renderBody changes the body', () => {
  const pluginRoot = createFixturePluginRoot({ skillName: 'one-skill' });
  try {
    // The fixture plugin root ships a claude.md glossary only. Add a dsh
    // glossary too, so readSource() accepts the dsh harness id here.
    fs.writeFileSync(
      path.join(pluginRoot, 'templates', 'harness', 'dsh.md'),
      goodGlossaryText('dsh')
    );

    // Keep the fixture's quoted "argument-hint" value, which holds no colon.
    // A naive re-join would drop its quotes (needsQuotes() reads false for
    // an unquoted value with no colon), so this is the exact case A1 guards.
    const skillPath = path.join(pluginRoot, 'templates', 'skills', 'one-skill', 'SKILL.md');
    const sourceText = `---
name: one-skill
description: "A fixture skill. Usage: /one-skill [arg]"
argument-hint: "[arg]"
user-invocable: true
---

Body with $ARGUMENTS inside.
`;
    fs.writeFileSync(skillPath, sourceText);

    const { rendered } = readAndRender(dsh, pluginRoot);
    const skillItem = rendered.find((r) => r.kind === 'skill' && r.destination.endsWith('/SKILL.md'));
    assert.ok(skillItem);

    const renderedText = text(skillItem.content);
    const sourceParsed = splitFrontmatter(sourceText);
    const expectedHeader = `---\n${sourceParsed.raw}\n---\n`;

    assert.ok(
      renderedText.startsWith(expectedHeader),
      'the rendered header must equal the source header bytes exactly, quotes included'
    );
    assert.ok(renderedText.includes('argument-hint: "[arg]"'));
  } finally {
    removeFixture(pluginRoot);
  }
});

test('A2: the .gitignore backup line derives from adapter.harnessRoot, and the "already present" test names that line', () => {
  const projectRoot = createTempProjectRoot();
  try {
    const { rendered: claudeRendered } = readAndRender(claude);
    const claudePlan = planInstall({
      rendered: claudeRendered,
      projectRoot,
      harnessRoot: claude.harnessRoot,
      manifest: null,
    });
    assert.equal(claudePlan.gitignore.appendAction, 'append');

    const source = readSource({
      pluginRoot: PLUGIN_ROOT,
      harnessId: claude.id,
      glossaryHarnessId: claude.glossaryHarnessId,
    });
    apply(claudePlan, {
      projectRoot,
      pluginRoot: PLUGIN_ROOT,
      adapter: claude,
      source,
      reporter: createReporter(nullStream()),
      dryRun: false,
      mode: 'install',
    });

    const gitignoreAfterClaude = fs.readFileSync(path.join(projectRoot, '.gitignore'), 'utf8');
    assert.match(gitignoreAfterClaude, /\.claude\/\.beast-mode-backup-\*\//);
    assert.doesNotMatch(gitignoreAfterClaude, /\.agents\/\.beast-mode-backup-\*\//);
    assert.deepEqual(claudePlan.gitignore.lines, [
      '.claude/.beast-mode-backup-*/',
      '.beast-mode/briefs/',
    ]);

    // A second harness on the same project must still gain its own line.
    // A project that already carries a Claude backup line, and the old
    // predicate (any "# Beast Mode" text) would wrongly call it "already".
    const { rendered: dshRendered } = readAndRender(dsh);
    const dshPlan = planInstall({
      rendered: dshRendered,
      projectRoot,
      harnessRoot: dsh.harnessRoot,
      manifest: null,
    });
    assert.equal(dshPlan.gitignore.appendAction, 'append');
    // The briefs line belongs to the project, not to one harness, so the
    // second harness owes its own backup line only.
    assert.deepEqual(dshPlan.gitignore.lines, ['.agents/.beast-mode-backup-*/']);

    const dshSource = readSource({
      pluginRoot: PLUGIN_ROOT,
      harnessId: dsh.id,
      glossaryHarnessId: dsh.glossaryHarnessId,
    });
    apply(dshPlan, {
      projectRoot,
      pluginRoot: PLUGIN_ROOT,
      adapter: dsh,
      source: dshSource,
      reporter: createReporter(nullStream()),
      dryRun: false,
      mode: 'install',
    });

    const gitignoreAfterDsh = fs.readFileSync(path.join(projectRoot, '.gitignore'), 'utf8');
    assert.match(gitignoreAfterDsh, /\.claude\/\.beast-mode-backup-\*\//);
    assert.match(gitignoreAfterDsh, /\.agents\/\.beast-mode-backup-\*\//);
    // A second harness adds no duplicate line.
    const briefsLines = gitignoreAfterDsh
      .split('\n')
      .filter((line) => line.trim() === '.beast-mode/briefs/');
    assert.equal(briefsLines.length, 1);

    // A third pass of either harness reports "already".
    const { rendered: dshAgain } = readAndRender(dsh);
    const dshPlanAgain = planInstall({
      rendered: dshAgain,
      projectRoot,
      harnessRoot: dsh.harnessRoot,
      manifest: null,
    });
    assert.equal(dshPlanAgain.gitignore.appendAction, 'already');
  } finally {
    removeFixture(projectRoot);
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// destination() for all FOOTPRINT.skills skills and the shipped agents
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test('destination() maps every real skill to .agents/skills/<name>/SKILL.md, and each agent to .agents/skills/<name>.md', () => {
  const skillFolders = fs
    .readdirSync(path.join(PLUGIN_ROOT, 'templates', 'skills'), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  assert.equal(skillFolders.length, FOOTPRINT.skills);

  const { rendered } = readAndRender(dsh);

  for (const name of skillFolders) {
    const item = rendered.find((r) => r.kind === 'skill' && r.name === name);
    assert.ok(item, `no rendered entry for the skill "${name}"`);
    assert.equal(item.destination, `.agents/skills/${name}/SKILL.md`);
  }

  const agentItems = rendered.filter((r) => r.kind === 'agent');
  assert.equal(agentItems.length, 2);

  const bySolutionArchitect = agentItems.find((a) => a.name === 'solution-architect');
  assert.ok(bySolutionArchitect);
  assert.equal(bySolutionArchitect.destination, '.agents/skills/solution-architect.md');

  const byFeatureOrchestrator = agentItems.find((a) => a.name === 'feature-orchestrator');
  assert.ok(byFeatureOrchestrator);
  assert.equal(byFeatureOrchestrator.destination, '.agents/skills/feature-orchestrator.md');
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// The arguments note: count, placement, and byte identity below the note
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test('each of the FOOTPRINT.argumentNotes skills that hold $ARGUMENTS gains one note, names its own command, and keeps the body byte-identical below it', () => {
  const { rendered } = readAndRender(dsh);
  const skillItems = rendered.filter((r) => r.kind === 'skill' && r.destination.endsWith('/SKILL.md'));

  let withNote = 0;

  for (const item of skillItems) {
    const srcPath = path.join(PLUGIN_ROOT, ...item.source.split('/'));
    const srcText = fs.readFileSync(srcPath, 'utf8');
    const srcParsed = splitFrontmatter(srcText);
    const srcCount = countOccurrences(srcParsed.body, '$ARGUMENTS');

    const renderedText = text(item.content);
    const renderedParsed = splitFrontmatter(renderedText);
    const renderedCount = countOccurrences(renderedParsed.body, '$ARGUMENTS');

    if (srcCount === 0) {
      assert.equal(renderedCount, 0, `${item.name} holds no source token but the rendered body does`);
      assert.doesNotMatch(renderedParsed.body, /Arguments on this harness/);
      assert.equal(renderedParsed.body, srcParsed.body);
      continue;
    }

    withNote += 1;
    assert.equal(renderedCount, srcCount + 3, `${item.name}: rendered count must equal source count + 3`);

    const expectedNote = ARGUMENTS_NOTE.replace('<name>', item.name);
    assert.ok(
      renderedParsed.body.startsWith(`${expectedNote}\n\n`),
      `${item.name}: the rendered body must start with its own arguments note`
    );
    assert.ok(renderedParsed.body.includes(`/${item.name}`));

    const bodyUnderNote = renderedParsed.body.slice(`${expectedNote}\n\n`.length);
    assert.equal(bodyUnderNote, srcParsed.body, `${item.name}: the body under the note must be byte-identical to the source body`);
  }

  assert.equal(withNote, FOOTPRINT.argumentNotes);
});

test('suggest-feature gets no note, and its rendered file is byte-identical to its source', () => {
  const { rendered } = readAndRender(dsh);
  const item = rendered.find((r) => r.kind === 'skill' && r.name === 'suggest-feature');
  assert.ok(item);
  assert.ok(Buffer.isBuffer(item.content), 'the fast path must return the raw source buffer');

  const srcPath = path.join(PLUGIN_ROOT, ...item.source.split('/'));
  assert.ok(item.content.equals(fs.readFileSync(srcPath)));
});

test('every shipped agent body holds no $ARGUMENTS token and gains no note', () => {
  const { rendered } = readAndRender(dsh);
  const agentItems = rendered.filter((r) => r.kind === 'agent');
  assert.equal(agentItems.length, 2);

  for (const agentItem of agentItems) {
    const renderedText = text(agentItem.content);
    const renderedParsed = splitFrontmatter(renderedText);
    assert.doesNotMatch(renderedParsed.body, /\$ARGUMENTS/, `${agentItem.name}: must hold no $ARGUMENTS token`);
    assert.doesNotMatch(renderedParsed.body, /Arguments on this harness/, `${agentItem.name}: must gain no note`);
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Header block byte identity, for every one of the FOOTPRINT.skills skills
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test('the header block of every rendered skill is byte-identical to its source header block', () => {
  const { rendered } = readAndRender(dsh);
  const skillItems = rendered.filter((r) => r.kind === 'skill' && r.destination.endsWith('/SKILL.md'));
  assert.equal(skillItems.length, FOOTPRINT.skills);

  for (const item of skillItems) {
    const srcPath = path.join(PLUGIN_ROOT, ...item.source.split('/'));
    const srcParsed = splitFrontmatter(fs.readFileSync(srcPath, 'utf8'));
    const renderedParsed = splitFrontmatter(text(item.content));
    assert.equal(renderedParsed.raw, srcParsed.raw, `${item.name}: the rendered header must equal the source header`);
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// The agent frontmatter join
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test('the rendered frontmatter of every agent holds user-invocable: false, and every source key survives', () => {
  const { rendered } = readAndRender(dsh);
  const agentItems = rendered.filter((r) => r.kind === 'agent');
  assert.equal(agentItems.length, 2);

  for (const agentItem of agentItems) {
    const srcPath = path.join(PLUGIN_ROOT, ...agentItem.source.split('/'));
    const srcParsed = splitFrontmatter(fs.readFileSync(srcPath, 'utf8'));
    const renderedParsed = splitFrontmatter(text(agentItem.content));

    assert.equal(renderedParsed.data['user-invocable'], 'false');
    for (const [key, value] of Object.entries(srcParsed.data)) {
      assert.equal(
        renderedParsed.data[key],
        value,
        `${agentItem.name}: the source key "${key}" must survive the join`
      );
    }
    assert.match(text(agentItem.content), /^user-invocable: false$/m);
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// No disable-model-invocation, anywhere
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test('no rendered file holds a disable-model-invocation key', () => {
  const { rendered } = readAndRender(dsh);
  for (const item of rendered) {
    assert.doesNotMatch(text(item.content), /disable-model-invocation/, `${item.destination} must not hold the key`);
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// The shared .beast-mode/ root: byte-identical across the two harnesses
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test('every .beast-mode/ output is byte-identical between the claude render and the dsh render, apart from harness.md', () => {
  const claudeOut = createTempProjectRoot();
  const dshOut = createTempProjectRoot();
  try {
    renderInto(claude, claudeOut);
    renderInto(dsh, dshOut);

    const claudeShared = snapshotTree(path.join(claudeOut, '.beast-mode'));
    const dshShared = snapshotTree(path.join(dshOut, '.beast-mode'));

    delete claudeShared['harness.md'];
    delete dshShared['harness.md'];

    assert.deepEqual(dshShared, claudeShared);
    assert.ok(fs.existsSync(path.join(claudeOut, '.beast-mode', 'harness.md')));
    assert.ok(fs.existsSync(path.join(dshOut, '.beast-mode', 'harness.md')));
  } finally {
    removeFixture(claudeOut);
    removeFixture(dshOut);
  }
});

test('render dsh writes FOOTPRINT.skills skill folders and two flat agent skills', () => {
  const outDir = createTempProjectRoot();
  try {
    renderInto(dsh, outDir);
    const skillDirs = fs
      .readdirSync(path.join(outDir, '.agents', 'skills'), { withFileTypes: true })
      .filter((d) => d.isDirectory());
    assert.equal(skillDirs.length, FOOTPRINT.skills);
    assert.ok(fs.existsSync(path.join(outDir, '.agents', 'skills', 'solution-architect.md')));
    assert.ok(
      fs.statSync(path.join(outDir, '.agents', 'skills', 'solution-architect.md')).isFile()
    );
    assert.ok(fs.existsSync(path.join(outDir, '.agents', 'skills', 'feature-orchestrator.md')));
    assert.ok(
      fs.statSync(path.join(outDir, '.agents', 'skills', 'feature-orchestrator.md')).isFile()
    );
  } finally {
    removeFixture(outDir);
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// The manifest
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test('the dsh manifest lands at .agents/.beast-mode-manifest.json and holds the same entry count as the claude manifest', () => {
  const claudeOut = createTempProjectRoot();
  const dshOut = createTempProjectRoot();
  try {
    renderInto(claude, claudeOut);
    renderInto(dsh, dshOut);

    const claudeManifest = JSON.parse(
      fs.readFileSync(path.join(claudeOut, '.claude', '.beast-mode-manifest.json'), 'utf8')
    );
    const dshManifestPath = path.join(dshOut, '.agents', '.beast-mode-manifest.json');
    assert.ok(fs.existsSync(dshManifestPath));
    const dshManifest = JSON.parse(fs.readFileSync(dshManifestPath, 'utf8'));

    assert.equal(dshManifest.files.length, claudeManifest.files.length);
    // FOOTPRINT.manifestEntries source-backed files. Neither harness manifest owns the shared
    // glossary: the core composes it from the whole harness set, so one
    // harness install can never take it from another (CR-4).
    assert.equal(dshManifest.files.length, FOOTPRINT.manifestEntries);
    for (const manifest of [claudeManifest, dshManifest]) {
      assert.equal(
        manifest.files.filter((f) => f.destination === '.beast-mode/harness.md').length,
        0
      );
    }
    assert.equal(dshManifest.harness, 'dsh');
    assert.equal(dshManifest.harnessRoot, '.agents');
  } finally {
    removeFixture(claudeOut);
    removeFixture(dshOut);
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// check(): the shadow and collision report
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test('check() reports a .dsh/skills/plan-feature shadow and deletes nothing', () => {
  const projectRoot = createTempProjectRoot();
  try {
    const shadowDir = path.join(projectRoot, '.dsh', 'skills', 'plan-feature');
    fs.mkdirSync(shadowDir, { recursive: true });
    fs.writeFileSync(path.join(shadowDir, 'SKILL.md'), 'a user override\n');

    const { rendered } = readAndRender(dsh);
    const skillNames = [...new Set(rendered.filter((r) => r.kind === 'skill').map((r) => r.name))].sort();

    const result = dsh.check({ projectRoot, skillNames, pluginRoot: PLUGIN_ROOT });

    assert.equal(result.ok, false);
    assert.ok(result.notes.some((n) => n.includes('.dsh/skills/plan-feature')));

    assert.equal(
      fs.readFileSync(path.join(shadowDir, 'SKILL.md'), 'utf8'),
      'a user override\n',
      'check() must delete and change nothing'
    );
  } finally {
    removeFixture(projectRoot);
  }
});

test('check() reports a flat .agents/skills/plan-feature.md collision and deletes nothing', () => {
  const projectRoot = createTempProjectRoot();
  try {
    fs.mkdirSync(path.join(projectRoot, '.agents', 'skills'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, '.agents', 'skills', 'plan-feature.md'), 'a flat file\n');

    const { rendered } = readAndRender(dsh);
    const skillNames = [...new Set(rendered.filter((r) => r.kind === 'skill').map((r) => r.name))].sort();

    const result = dsh.check({ projectRoot, skillNames, pluginRoot: PLUGIN_ROOT });

    assert.equal(result.ok, false);
    assert.ok(result.notes.some((n) => n.includes('.agents/skills/plan-feature.md')));

    assert.equal(
      fs.readFileSync(path.join(projectRoot, '.agents', 'skills', 'plan-feature.md'), 'utf8'),
      'a flat file\n'
    );
  } finally {
    removeFixture(projectRoot);
  }
});

test('check() reports a folder where the shipped agent writes a flat file, and passes clean when nothing collides', () => {
  const projectRoot = createTempProjectRoot();
  try {
    fs.mkdirSync(path.join(projectRoot, '.agents', 'skills', 'solution-architect'), { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, '.agents', 'skills', 'solution-architect', 'SKILL.md'),
      'a folder where a flat file belongs\n'
    );

    const { rendered } = readAndRender(dsh);
    const skillNames = [...new Set(rendered.filter((r) => r.kind === 'skill').map((r) => r.name))].sort();

    const result = dsh.check({ projectRoot, skillNames, pluginRoot: PLUGIN_ROOT });
    assert.equal(result.ok, false);
    assert.ok(result.notes.some((n) => n.includes('.agents/skills/solution-architect/')));
  } finally {
    removeFixture(projectRoot);
  }
});

test('check() passes clean on a project with no collision', () => {
  const projectRoot = createTempProjectRoot();
  try {
    const { rendered } = readAndRender(dsh);
    const skillNames = [...new Set(rendered.filter((r) => r.kind === 'skill').map((r) => r.name))].sort();
    const result = dsh.check({ projectRoot, skillNames, pluginRoot: PLUGIN_ROOT });
    assert.deepEqual(result, { ok: true, notes: [] });
  } finally {
    removeFixture(projectRoot);
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// The root package.json version (Phase 2 adds the file)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test('the root package.json version equals the plugin manifest version', (t) => {
  const packageJsonPath = path.join(PLUGIN_ROOT, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    t.skip('The root package.json does not exist yet. Phase 2 of harness-support/dsh-plugin adds it.');
    return;
  }
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const pluginJson = JSON.parse(
    fs.readFileSync(path.join(PLUGIN_ROOT, '.claude-plugin', 'plugin.json'), 'utf8')
  );
  assert.equal(packageJson.version, pluginJson.version);
});
