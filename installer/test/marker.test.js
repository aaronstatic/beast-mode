// installer/test/marker.test.js
//
// Covers lib/marker.js: the nine field rules of implementation.md section
// 3.1, the sorted harness keys and the file shape of write(), the
// preserved "installed" value of upsert(), the detection pass, the resolve
// order, and Decision 4 (read() throws nothing for missing, unreadable,
// and unknown-schema input).
//
// Every fixture project lives under os.tmpdir(). No test writes into this
// repo, and no test writes into the real adapter registry.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import * as marker from '../lib/marker.js';
import { adapters } from '../adapters/index.js';
import { createTempProjectRoot, removeFixture } from './helpers.js';

/** A two-harness fixture registry. lib/marker.js imports no adapter itself. */
const FIXTURE_ADAPTERS = {
  zed: { id: 'zed', harnessRoot: '.zed', glossaryHarnessId: 'zed' },
  alpha: { id: 'alpha', harnessRoot: '.alpha', glossaryHarnessId: 'alpha-harness' },
};

/**
 * Write a manifest file for one harness root, so detect() finds it.
 *
 * @param {string} projectRoot
 * @param {string} harnessRoot
 * @returns {void}
 */
function seedManifest(projectRoot, harnessRoot) {
  const dir = path.join(projectRoot, ...harnessRoot.split('/'));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '.beast-mode-manifest.json'), '{"schema":1,"files":[]}\n');
}

/**
 * @param {string} projectRoot
 * @param {string} text
 * @returns {void}
 */
function seedMarkerText(projectRoot, text) {
  fs.mkdirSync(path.join(projectRoot, '.beast-mode'), { recursive: true });
  fs.writeFileSync(marker.markerPath(projectRoot), text);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// write() and read(): the schema and the file shape
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test('write() sorts the harness keys, writes schema 1, and ends the file with one newline', () => {
  const projectRoot = createTempProjectRoot();
  try {
    const file = marker.write(projectRoot, {
      schema: 1,
      beastModeVersion: '5.4.0',
      generated: '2026-09-15T11:04:12.318Z',
      harnesses: {
        zed: { harnessRoot: '.zed', version: '5.3.0', installed: 'a', updated: 'b' },
        alpha: { harnessRoot: '.alpha', version: '5.4.0', installed: 'c', updated: 'd' },
      },
    });

    assert.equal(file, path.join(projectRoot, '.beast-mode', 'version.json'));
    const text = fs.readFileSync(file, 'utf8');

    assert.ok(text.endsWith('}\n'));
    assert.ok(!text.endsWith('}\n\n'));
    assert.match(text, /^\{\n {2}"schema": 1,/);

    const data = JSON.parse(text);
    assert.deepEqual(Object.keys(data), ['schema', 'beastModeVersion', 'generated', 'harnesses']);
    assert.deepEqual(Object.keys(data.harnesses), ['alpha', 'zed']);
    assert.deepEqual(Object.keys(data.harnesses.alpha), [
      'harnessRoot',
      'version',
      'installed',
      'updated',
    ]);

    const { marker: parsed, notes } = marker.read(projectRoot);
    assert.deepEqual(notes, []);
    assert.equal(parsed.schema, 1);
    assert.equal(parsed.beastModeVersion, '5.4.0');
    assert.equal(parsed.harnesses.zed.harnessRoot, '.zed');
    assert.equal(parsed.harnesses.zed.version, '5.3.0');
  } finally {
    removeFixture(projectRoot);
  }
});

test('read() returns a null marker and no note when the file is missing', () => {
  const projectRoot = createTempProjectRoot();
  try {
    const { marker: parsed, notes } = marker.read(projectRoot);
    assert.equal(parsed, null);
    assert.deepEqual(notes, []);
  } finally {
    removeFixture(projectRoot);
  }
});

test('read() throws nothing on unreadable JSON and returns one note', () => {
  const projectRoot = createTempProjectRoot();
  try {
    seedMarkerText(projectRoot, '{ this is not json\n');

    let result;
    assert.doesNotThrow(() => {
      result = marker.read(projectRoot);
    });
    assert.equal(result.marker, null);
    assert.equal(result.notes.length, 1);
    assert.match(result.notes[0], /not valid JSON/);
    assert.match(result.notes[0], /\.beast-mode\/version\.json/);
  } finally {
    removeFixture(projectRoot);
  }
});

test('read() throws nothing on an unknown schema and returns one note', () => {
  const projectRoot = createTempProjectRoot();
  try {
    seedMarkerText(projectRoot, JSON.stringify({ schema: 99, harnesses: {} }));

    const { marker: parsed, notes } = marker.read(projectRoot);
    assert.equal(parsed, null);
    assert.equal(notes.length, 1);
    assert.match(notes[0], /unknown schema 99/);
  } finally {
    removeFixture(projectRoot);
  }
});

test('read() drops a harness entry that names no harness root, with one note', () => {
  const projectRoot = createTempProjectRoot();
  try {
    seedMarkerText(
      projectRoot,
      JSON.stringify({
        schema: 1,
        beastModeVersion: '5.4.0',
        generated: 'now',
        harnesses: {
          good: { harnessRoot: '.good', version: '5.4.0', installed: 'a', updated: 'b' },
          bad: { version: '5.4.0' },
        },
      })
    );

    const { marker: parsed, notes } = marker.read(projectRoot);
    assert.deepEqual(Object.keys(parsed.harnesses), ['good']);
    assert.equal(notes.length, 1);
    assert.match(notes[0], /"bad"/);
  } finally {
    removeFixture(projectRoot);
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// upsert(): the preserved "installed" value
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test('upsert() sets installed and updated on the first run, and preserves installed later', () => {
  const first = marker.upsert(null, {
    id: 'alpha',
    harnessRoot: '.alpha',
    version: '5.3.0',
    beastModeVersion: '5.3.0',
    now: '2026-01-01T00:00:00.000Z',
  });

  assert.equal(first.schema, 1);
  assert.equal(first.generated, '2026-01-01T00:00:00.000Z');
  assert.equal(first.harnesses.alpha.installed, '2026-01-01T00:00:00.000Z');
  assert.equal(first.harnesses.alpha.updated, '2026-01-01T00:00:00.000Z');

  const second = marker.upsert(first, {
    id: 'alpha',
    harnessRoot: '.alpha',
    version: '5.4.0',
    beastModeVersion: '5.4.0',
    now: '2026-02-02T00:00:00.000Z',
  });

  assert.equal(second.harnesses.alpha.installed, '2026-01-01T00:00:00.000Z');
  assert.equal(second.harnesses.alpha.updated, '2026-02-02T00:00:00.000Z');
  assert.equal(second.harnesses.alpha.version, '5.4.0');
  assert.equal(second.beastModeVersion, '5.4.0');

  // The call returns a new object, so the caller's marker never moves.
  assert.equal(first.harnesses.alpha.updated, '2026-01-01T00:00:00.000Z');
  assert.equal(first.beastModeVersion, '5.3.0');
});

test('upsert() leaves an untouched entry alone and still creates a missing one', () => {
  const start = marker.upsert(null, {
    id: 'alpha',
    harnessRoot: '.alpha',
    version: '5.3.0',
    beastModeVersion: '5.3.0',
    now: '2026-01-01T00:00:00.000Z',
  });

  const next = marker.upsert(start, {
    id: 'alpha',
    harnessRoot: '.alpha',
    version: '9.9.9',
    beastModeVersion: '5.4.0',
    now: '2026-03-03T00:00:00.000Z',
    touched: false,
  });

  // Field rule 9: an entry the run did not touch keeps all four values.
  assert.deepEqual(next.harnesses.alpha, start.harnesses.alpha);
  assert.equal(next.beastModeVersion, '5.4.0');
  assert.equal(next.generated, '2026-03-03T00:00:00.000Z');

  const added = marker.upsert(next, {
    id: 'zed',
    harnessRoot: '.zed',
    version: '5.3.0',
    beastModeVersion: '5.4.0',
    now: '2026-03-03T00:00:00.000Z',
    touched: false,
  });
  assert.equal(added.harnesses.zed.harnessRoot, '.zed');
  assert.equal(added.harnesses.zed.installed, '2026-03-03T00:00:00.000Z');
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// detect(), resolve(), and readHarnessVersion()
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test('detect() finds every harness root that holds a manifest, in adapter id order', () => {
  const projectRoot = createTempProjectRoot();
  try {
    assert.deepEqual(marker.detect({ projectRoot, adapters: FIXTURE_ADAPTERS }), []);

    seedManifest(projectRoot, '.zed');
    assert.deepEqual(marker.detect({ projectRoot, adapters: FIXTURE_ADAPTERS }), ['zed']);

    seedManifest(projectRoot, '.alpha');
    assert.deepEqual(marker.detect({ projectRoot, adapters: FIXTURE_ADAPTERS }), ['alpha', 'zed']);
  } finally {
    removeFixture(projectRoot);
  }
});

test('detect() finds a real claude install from its manifest alone', () => {
  const projectRoot = createTempProjectRoot();
  try {
    seedManifest(projectRoot, adapters.claude.harnessRoot);
    assert.deepEqual(marker.detect({ projectRoot, adapters }), ['claude']);
  } finally {
    removeFixture(projectRoot);
  }
});

test('resolve() merges the marker entries, the detected ids, and the include id, sorted', () => {
  const projectRoot = createTempProjectRoot();
  try {
    seedManifest(projectRoot, '.zed');

    const set = marker.resolve({
      projectRoot,
      marker: {
        schema: 1,
        beastModeVersion: '5.4.0',
        generated: 'now',
        harnesses: {
          alpha: { harnessRoot: '.alpha', version: '5.4.0', installed: 'a', updated: 'b' },
        },
      },
      adapters: FIXTURE_ADAPTERS,
      include: 'alpha',
    });

    assert.deepEqual(
      set.map((h) => h.id),
      ['alpha', 'zed']
    );
    assert.deepEqual(set[0], {
      id: 'alpha',
      harnessRoot: '.alpha',
      glossaryHarnessId: 'alpha-harness',
    });
    assert.equal(set[1].harnessRoot, '.zed');
  } finally {
    removeFixture(projectRoot);
  }
});

test('resolve() keeps a marker entry this plugin ships no adapter for, with a null glossary id', () => {
  const projectRoot = createTempProjectRoot();
  try {
    const set = marker.resolve({
      projectRoot,
      marker: {
        schema: 1,
        beastModeVersion: '5.4.0',
        generated: 'now',
        harnesses: {
          future: { harnessRoot: '.future', version: '9.0.0', installed: 'a', updated: 'b' },
        },
      },
      adapters: FIXTURE_ADAPTERS,
      include: 'alpha',
    });

    assert.deepEqual(
      set.map((h) => h.id),
      ['alpha', 'future']
    );
    // The harness root comes from the marker entry, per field rule 5.
    assert.equal(set[1].harnessRoot, '.future');
    assert.equal(set[1].glossaryHarnessId, null);
  } finally {
    removeFixture(projectRoot);
  }
});

test('resolve() with no marker and no install returns the one included harness', () => {
  const projectRoot = createTempProjectRoot();
  try {
    const set = marker.resolve({
      projectRoot,
      marker: null,
      adapters: FIXTURE_ADAPTERS,
      include: 'zed',
    });
    assert.deepEqual(set, [{ id: 'zed', harnessRoot: '.zed', glossaryHarnessId: 'zed' }]);
  } finally {
    removeFixture(projectRoot);
  }
});

test('readHarnessVersion() trims the version file and returns null when it is missing', () => {
  const projectRoot = createTempProjectRoot();
  try {
    assert.equal(marker.readHarnessVersion(projectRoot, '.alpha'), null);

    fs.mkdirSync(path.join(projectRoot, '.alpha'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, '.alpha', '.beast-mode-version'), '5.4.0\n');
    assert.equal(marker.readHarnessVersion(projectRoot, '.alpha'), '5.4.0');

    fs.writeFileSync(path.join(projectRoot, '.alpha', '.beast-mode-version'), '   \n');
    assert.equal(marker.readHarnessVersion(projectRoot, '.alpha'), null);
  } finally {
    removeFixture(projectRoot);
  }
});
