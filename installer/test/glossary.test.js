// installer/test/glossary.test.js
//
// Covers lib/glossary.js: the one-harness base case (the source bytes and
// nothing else), the composed shape of implementation.md section 3.2 (the
// preamble, the marker line, the blank lines, and the adapter id sort
// order), the round trip parse(compose(x)), the absence of a timestamp,
// and readSections() with a good source, a bad source, a missing source,
// and a harness this plugin ships no adapter for.
//
// Every fixture lives under os.tmpdir(). No test writes into this repo.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { compose, parse, readSections } from '../lib/glossary.js';
import { validateGlossary } from '../lib/source.js';
import { createFixturePluginRoot, goodGlossaryText, removeFixture } from './helpers.js';

/**
 * @param {string} id
 * @param {string} harnessRoot
 * @param {string} [glossaryHarnessId]
 * @returns {{ id: string, harnessRoot: string, text: string }}
 */
function section(id, harnessRoot, glossaryHarnessId = id) {
  return { id, harnessRoot, text: goodGlossaryText(glossaryHarnessId) };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// compose(): the base case and the composed shape
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test('compose() returns the source text unchanged for exactly one section', () => {
  const one = section('claude', '.claude', 'claude-code');
  const composed = compose([one]);

  assert.equal(composed, one.text);
  assert.ok(!composed.includes('beast-mode:harness'));
  assert.ok(!composed.includes('**Harnesses:**'));
});

test('compose() returns an empty string for an empty section list', () => {
  assert.equal(compose([]), '');
});

test('compose() builds the preamble and one marked section per harness for two sections', () => {
  const claude = section('claude', '.claude', 'claude-code');
  const other = section('other', '.other');
  const composed = compose([claude, other]);
  const lines = composed.split('\n');

  // Format rule 2: the preamble first, then one section per harness.
  assert.equal(lines[0], '# Harness Glossary - 2 harnesses');
  assert.equal(lines[1], '');
  // Format rule 5: the preamble names "<adapter-id> (<harnessRoot>/)".
  assert.equal(lines[2], '**Harnesses:** claude (.claude/), other (.other/)');
  assert.match(composed, /This project holds a Beast Mode install for more than one harness\./);

  // Format rule 3: a marker line, one blank line, then the source text.
  const markerIndex = lines.indexOf('<!-- beast-mode:harness claude -->');
  assert.ok(markerIndex > 0);
  assert.equal(lines[markerIndex - 1], '');
  assert.equal(lines[markerIndex + 1], '');
  assert.equal(lines[markerIndex + 2], '# Harness Glossary - Fixture');

  // Format rule 6: each section keeps its own source lines.
  assert.equal((composed.match(/^\*\*Harness:\*\*/gm) ?? []).length, 2);
  assert.equal((composed.match(/^## Term map$/gm) ?? []).length, 2);
  assert.equal((composed.match(/^## Notes$/gm) ?? []).length, 2);

  // Format rule 4: exactly one newline at the end of the file.
  assert.ok(composed.endsWith('\n'));
  assert.ok(!composed.endsWith('\n\n'));
});

test('compose() sorts the sections by adapter id, whatever order the caller passes', () => {
  const zed = section('zed', '.zed');
  const claude = section('claude', '.claude', 'claude-code');
  const middle = section('middle', '.middle');

  const composed = compose([zed, claude, middle]);
  const order = [...composed.matchAll(/^<!-- beast-mode:harness (\S+) -->$/gm)].map((m) => m[1]);

  assert.deepEqual(order, ['claude', 'middle', 'zed']);
  assert.match(composed, /^\*\*Harnesses:\*\* claude \(\.claude\/\), middle \(\.middle\/\), zed \(\.zed\/\)$/m);
  assert.match(composed, /^# Harness Glossary - 3 harnesses$/m);
});

test('compose() changes no byte between two runs, so an upgrade takes the quiet row S2', () => {
  const sections = [section('claude', '.claude', 'claude-code'), section('other', '.other')];
  assert.equal(compose(sections), compose(sections));
  // A timestamp in the composed text would make row S3 fire on every
  // upgrade of a multi-harness project, and would back the file up each
  // time. The run timestamp lives in .beast-mode/version.json instead.
  assert.doesNotMatch(compose(sections), /\*\*Composed:\*\*/);
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// parse(): the exact inverse of compose()
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test('parse() returns one null-id section for a file with no marker line', () => {
  const one = section('claude', '.claude', 'claude-code');
  const parsed = parse(compose([one]));

  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].id, null);
  assert.equal(parsed[0].text, one.text);
});

test('parse(compose(x)) returns the same section texts for one, two, and three harnesses', () => {
  const all = [
    section('claude', '.claude', 'claude-code'),
    section('middle', '.middle'),
    section('zed', '.zed'),
  ];

  for (const count of [1, 2, 3]) {
    const sections = all.slice(0, count);
    const parsed = parse(compose(sections));

    assert.equal(parsed.length, count, `${count} section(s) must parse back to ${count}`);
    for (let i = 0; i < count; i++) {
      assert.equal(parsed[i].text, sections[i].text, `section ${i} of ${count} must round-trip`);
      if (count > 1) assert.equal(parsed[i].id, sections[i].id);
    }
  }
});

test('every parsed section still passes the glossary validator', () => {
  const sections = [section('claude', '.claude', 'claude-code'), section('other', '.other')];
  const parsed = parse(compose(sections));

  assert.doesNotThrow(() => validateGlossary(parsed[0].text, 'parsed/claude.md', 'claude-code'));
  assert.doesNotThrow(() => validateGlossary(parsed[1].text, 'parsed/other.md', 'other'));
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// readSections(): validation, and one note per skip
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test('readSections() reads and validates one source glossary per harness, in id order', () => {
  const pluginRoot = createFixturePluginRoot();
  try {
    fs.writeFileSync(
      path.join(pluginRoot, 'templates', 'harness', 'other.md'),
      goodGlossaryText('other')
    );

    const { sections, notes } = readSections({
      pluginRoot,
      harnesses: [
        { id: 'other', harnessRoot: '.other', glossaryHarnessId: 'other' },
        { id: 'claude', harnessRoot: '.claude', glossaryHarnessId: 'claude-code' },
      ],
    });

    assert.deepEqual(notes, []);
    assert.deepEqual(
      sections.map((s) => s.id),
      ['claude', 'other']
    );
    assert.equal(sections[0].harnessRoot, '.claude');
    assert.equal(
      sections[0].text,
      fs.readFileSync(path.join(pluginRoot, 'templates', 'harness', 'claude.md'), 'utf8')
    );
  } finally {
    removeFixture(pluginRoot);
  }
});

test('readSections() skips a source that fails validation and returns one note', () => {
  const pluginRoot = createFixturePluginRoot();
  try {
    fs.writeFileSync(
      path.join(pluginRoot, 'templates', 'harness', 'broken.md'),
      '# Harness Glossary - Broken\n\nNo Harness line, no term map, no notes.\n'
    );

    const { sections, notes } = readSections({
      pluginRoot,
      harnesses: [
        { id: 'broken', harnessRoot: '.broken', glossaryHarnessId: 'broken' },
        { id: 'claude', harnessRoot: '.claude', glossaryHarnessId: 'claude-code' },
      ],
    });

    assert.deepEqual(
      sections.map((s) => s.id),
      ['claude']
    );
    assert.equal(notes.length, 1);
    assert.match(notes[0], /templates\/harness\/broken\.md/);
    assert.match(notes[0], /fails validation/);
  } finally {
    removeFixture(pluginRoot);
  }
});

test('readSections() skips a missing source and a harness with no adapter, one note each', () => {
  const pluginRoot = createFixturePluginRoot();
  try {
    const { sections, notes } = readSections({
      pluginRoot,
      harnesses: [
        { id: 'claude', harnessRoot: '.claude', glossaryHarnessId: 'claude-code' },
        { id: 'gone', harnessRoot: '.gone', glossaryHarnessId: 'gone' },
        { id: 'future', harnessRoot: '.future', glossaryHarnessId: null },
      ],
    });

    assert.deepEqual(
      sections.map((s) => s.id),
      ['claude']
    );
    assert.equal(notes.length, 2);
    assert.ok(notes.some((note) => /no adapter for the harness "future"/.test(note)));
    assert.ok(notes.some((note) => /no glossary at "templates\/harness\/gone\.md"/.test(note)));
  } finally {
    removeFixture(pluginRoot);
  }
});
