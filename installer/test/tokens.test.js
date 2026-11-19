// installer/test/tokens.test.js
//
// The contract tests of the token report of implementation.md section 3.6:
// the flag rules, the derived values, the totals, the number format, the
// sort, the table, the JSON shape, the session shape refusal, and the four
// lines of the message set.
//
// Every test of the core drives lib/tokens.js with the fixture reader of
// test/fixtures/reader-fixture.js, through the getReader parameter of
// collect(). The CLI tests drive the real entry point against the real
// plugin source, into a project root under os.tmpdir(). No test writes into
// this repo, and no test registers a reader in installer/readers/.
//
// The two CLI tests of the missing reader install the dsh harness. The
// registry holds a reader for every shipped harness now, so each of the two
// tests saves readers.dsh, it deletes that entry, and it restores the entry
// in a finally block. getReader() reads the live registry object, and cli()
// calls main() in this process, so the delete reaches the branch of a harness
// with no reader, with no environment dependency. The delete and the restore
// sit in one test, so no other test sees the change. The tests of
// installer/test/reader-claude.test.js and installer/test/reader-dsh.test.js
// cover the two readers against a fixture log tree.

import assert from 'node:assert/strict';
import test from 'node:test';

import { main } from '../bin/beast-mode.js';
import { findPluginRoot } from '../lib/source.js';
import { SourceInvalidError } from '../lib/errors.js';
import * as tokens from '../lib/tokens.js';
import { getReader, readers } from '../readers/index.js';
import * as fixture from './fixtures/reader-fixture.js';
import { createTempProjectRoot, removeFixture } from './helpers.js';

const PLUGIN_ROOT = findPluginRoot(import.meta.dirname);

const HARNESSES = [{ id: fixture.id }];

/** A reader lookup that always returns the fixture reader. */
const fixtureLookup = () => fixture;

/** A reader lookup that returns no reader at all. */
const missingLookup = () => null;

/**
 * Collect with the fixture reader.
 *
 * @param {{ getReader?: (id: string) => any, days?: number | null, env?: Record<string, string | undefined> }} [opts]
 */
function collectFixture(opts = {}) {
  fixture.reset();
  return tokens.collect({
    harnesses: HARNESSES,
    getReader: opts.getReader ?? fixtureLookup,
    projectRoot: '/fixture/project',
    days: opts.days ?? null,
    env: opts.env ?? {},
  });
}

/**
 * One collected session, by id.
 *
 * @param {{ sessions: any[] }} collected
 * @param {string} id
 */
function sessionOf(collected, id) {
  const found = collected.sessions.find((session) => session.id === id);
  assert.ok(found, `the fixture holds the session "${id}"`);
  return found;
}

/**
 * Run one CLI command in this process, with the two streams collected apart.
 *
 * @param {string[]} args
 * @param {string} cwd
 * @returns {{ status: number, out: string, err: string }}
 */
function cli(args, cwd) {
  let out = '';
  let err = '';
  const outSink = {
    write(text) {
      out += text;
      return true;
    },
    isTTY: false,
  };
  const errSink = {
    write(text) {
      err += text;
      return true;
    },
    isTTY: false,
  };
  const status = main([...args, '--plugin-root', PLUGIN_ROOT], {
    stdout: outSink,
    stderr: errSink,
    cwd,
  });
  return { status, out, err };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// The registry
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test('the reader registry ships the two readers, and getReader returns null for every other id', () => {
  assert.deepEqual(Object.keys(readers), ['claude', 'dsh']);

  for (const id of ['claude', 'dsh']) {
    const reader = getReader(id);
    assert.ok(reader, `the registry holds a reader for the harness "${id}"`);
    assert.equal(typeof reader, 'object');
    assert.equal(reader.id, id);
  }

  // "not-a-real-harness" names no harness at all. A missing reader stays a
  // normal state of the report, and the lookup returns null for it.
  assert.equal(getReader('not-a-real-harness'), null);
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// The number format and the share
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test('fmt() follows the rule of the reference analyzers', () => {
  assert.equal(tokens.fmt(0), '0');
  assert.equal(tokens.fmt(999), '999');
  assert.equal(tokens.fmt(1000), '1.0k');
  assert.equal(tokens.fmt(12345), '12.3k');
  assert.equal(tokens.fmt(999999), '1000.0k');
  assert.equal(tokens.fmt(1000000), '1.00M');
  assert.equal(tokens.fmt(2400000), '2.40M');
  assert.equal(tokens.fmt(210000000), '210.00M');
});

test('share() returns null for a zero denominator, and formatShare() prints "-"', () => {
  assert.equal(tokens.share(350000, 700000), 0.5);
  assert.equal(tokens.share(2, 3), 0.6667);
  assert.equal(tokens.share(0, 0), null);
  assert.equal(tokens.share(5, 0), null);
  assert.equal(tokens.formatShare(null), '-');
  assert.equal(tokens.formatShare(undefined), '-');
  assert.equal(tokens.formatShare(0.75), '75%');
  assert.equal(tokens.formatShare(0.7216), '72%');
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// The session shape check
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * @param {Record<string, unknown>} [overrides]
 * @returns {Record<string, unknown>}
 */
function goodSession(overrides = {}) {
  return {
    id: 'one',
    kind: 'parent',
    parent: null,
    model: 'model-one',
    steps: 4,
    finalPromptTokens: 1000,
    promptTokens: 4000,
    cacheReadTokens: 2000,
    outputTokens: 500,
    ...overrides,
  };
}

test('validateSession() returns the eleven fields, and it defaults the two optional ones', () => {
  const checked = tokens.validateSession(goodSession(), { harness: 'zeta', position: 1 });
  assert.deepEqual(Object.keys(checked), [
    'id',
    'kind',
    'parent',
    'model',
    'steps',
    'finalPromptTokens',
    'promptTokens',
    'cacheReadTokens',
    'outputTokens',
    'created',
    'costUsd',
  ]);
  assert.equal(checked.created, null);
  assert.equal(checked.costUsd, null);
});

test('validateSession() names the missing field, and it raises SourceInvalidError', () => {
  for (const field of [
    'id',
    'kind',
    'parent',
    'model',
    'steps',
    'finalPromptTokens',
    'promptTokens',
    'cacheReadTokens',
    'outputTokens',
  ]) {
    const session = goodSession();
    delete session[field];
    assert.throws(
      () => tokens.validateSession(session, { harness: 'zeta', position: 3 }),
      (err) => {
        assert.ok(err instanceof SourceInvalidError, `${field} raises SourceInvalidError`);
        assert.equal(err.name, 'SourceInvalidError');
        assert.ok(
          err.message.includes(`"${field}"`),
          `the message of "${field}" names the field: ${err.message}`
        );
        assert.match(err.causeText, /the harness "zeta" returned session 3/);
        assert.ok(err.fix.length > 0);
        return true;
      },
      `a session with no "${field}" is refused`
    );
  }
});

test('validateSession() refuses a bad type and a negative count', () => {
  const cases = [
    ['kind', 'agent'],
    ['parent', 12],
    ['steps', '4'],
    ['steps', -1],
    ['promptTokens', Number.NaN],
    ['created', 7],
    ['costUsd', 'free'],
  ];
  for (const [field, value] of cases) {
    assert.throws(
      () => tokens.validateSession(goodSession({ [field]: value }), { harness: 'zeta', position: 1 }),
      new RegExp(`"${field}"`),
      `the field "${field}" refuses ${String(value)}`
    );
  }
  assert.throws(
    () => tokens.validateSession(null, { harness: 'zeta', position: 1 }),
    /"session"/
  );
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// The flag rules
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test('addFlags() flags a subagent over 100 steps, and it holds at 100', () => {
  const over = tokens.addFlags(goodSession({ kind: 'subagent', parent: 'p', steps: 101 }));
  const at = tokens.addFlags(goodSession({ kind: 'subagent', parent: 'p', steps: 100 }));
  const parent = tokens.addFlags(goodSession({ kind: 'parent', steps: 101 }));

  assert.deepEqual(over.flags, ['steps-over-100']);
  assert.deepEqual(at.flags, []);
  assert.deepEqual(parent.flags, [], 'the step rule holds for a subagent only');
});

test('addFlags() flags a final prompt over 300000, for a parent and for a subagent', () => {
  const parentOver = tokens.addFlags(goodSession({ finalPromptTokens: 300001 }));
  const parentAt = tokens.addFlags(goodSession({ finalPromptTokens: 300000 }));
  const subOver = tokens.addFlags(
    goodSession({ kind: 'subagent', parent: 'p', finalPromptTokens: 320000 })
  );

  assert.deepEqual(parentOver.flags, ['final-prompt-over-300k']);
  assert.deepEqual(parentAt.flags, []);
  assert.deepEqual(subOver.flags, ['final-prompt-over-300k']);
});

test('addFlags() adds cacheShare, and it returns null for a zero prompt total', () => {
  const normal = tokens.addFlags(goodSession({ promptTokens: 4000, cacheReadTokens: 3000 }));
  const empty = tokens.addFlags(goodSession({ promptTokens: 0, cacheReadTokens: 0 }));

  assert.equal(normal.cacheShare, 0.75);
  assert.equal(empty.cacheShare, null);
});

test('addFlags() can carry both flags at one time', () => {
  const both = tokens.addFlags(
    goodSession({ kind: 'subagent', parent: 'p', steps: 101, finalPromptTokens: 300001 })
  );
  assert.deepEqual(both.flags, ['steps-over-100', 'final-prompt-over-300k']);
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// collect(): the injection seam and the message set
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test('collect() passes the project root, the window, and the env to the reader', () => {
  collectFixture({ days: 7, env: { SOME_VALUE: '1' } });
  assert.equal(fixture.calls.length, 1);
  assert.equal(fixture.calls[0].projectRoot, '/fixture/project');
  assert.equal(fixture.calls[0].days, 7);
  assert.deepEqual(fixture.calls[0].env, { SOME_VALUE: '1' });
});

test('collect() reports the reader as present, and it keeps every fixture session', () => {
  const collected = collectFixture();
  assert.deepEqual(collected.harnesses, [{ id: 'zeta', reader: 'present' }]);
  assert.equal(collected.sessions.length, fixture.loadSessions().length);
  assert.ok(collected.notes.some((note) => note.text.includes('The fixture reader read 7 sessions.')));
  assert.ok(
    collected.notes.every((note) => note.level === 'info' || note.level === 'warn'),
    'every note carries a level'
  );
});

test('collect() stamps the harness id and the flags on every session', () => {
  const collected = collectFixture();

  assert.ok(collected.sessions.every((session) => session.harness === 'zeta'));
  assert.deepEqual(sessionOf(collected, 'sub-101-steps').flags, ['steps-over-100']);
  assert.deepEqual(sessionOf(collected, 'sub-100-steps').flags, []);
  assert.deepEqual(sessionOf(collected, 'sub-320k-final').flags, ['final-prompt-over-300k']);
  assert.deepEqual(sessionOf(collected, 'parent-300001-final').flags, ['final-prompt-over-300k']);
  assert.deepEqual(sessionOf(collected, 'parent-300k-final').flags, []);
  assert.deepEqual(sessionOf(collected, 'parent-plain').flags, []);
  assert.equal(sessionOf(collected, 'parent-zero-prompt').cacheShare, null);
  assert.equal(sessionOf(collected, 'parent-plain').cacheShare, 0.75);
});

test('collect() sorts the sessions by created, oldest first', () => {
  const collected = collectFixture();
  assert.deepEqual(
    collected.sessions.map((session) => session.id),
    [
      'parent-300k-final',
      'parent-zero-prompt',
      'parent-300001-final',
      'parent-plain',
      'sub-101-steps',
      'sub-100-steps',
      'sub-320k-final',
    ]
  );
});

test('collect() prints the missing reader line for a harness with no reader', () => {
  const collected = tokens.collect({
    harnesses: HARNESSES,
    getReader: missingLookup,
    projectRoot: '/fixture/project',
    days: null,
    env: {},
  });

  assert.deepEqual(collected.harnesses, [{ id: 'zeta', reader: 'missing' }]);
  assert.deepEqual(collected.sessions, []);
  assert.deepEqual(collected.notes, [
    { level: 'info', text: 'The plugin ships no token reader for the harness "zeta" yet.' },
  ]);
});

test('collect() prints one warning line with the reason and the fix of an unavailable reader', () => {
  const collected = collectFixture({ env: { [fixture.UNAVAILABLE_ENV]: '1' } });

  assert.deepEqual(collected.harnesses, [
    { id: 'zeta', reader: 'unavailable', reason: fixture.UNAVAILABLE_REASON },
  ]);
  assert.equal(collected.notes.length, 1);
  assert.equal(collected.notes[0].level, 'warn');
  assert.ok(collected.notes[0].text.includes(fixture.UNAVAILABLE_REASON));
  assert.ok(collected.notes[0].text.includes(fixture.UNAVAILABLE_FIX));
  assert.equal(fixture.calls.length, 0, 'an unavailable reader never reads');
});

test('collect() prints the empty project line when a reader ran and matched no session', () => {
  const emptyReader = {
    id: 'zeta',
    available: () => ({ ok: true }),
    read: () => ({ sessions: [], notes: [] }),
  };
  const collected = tokens.collect({
    harnesses: HARNESSES,
    getReader: () => emptyReader,
    projectRoot: '/fixture/project',
  });

  assert.deepEqual(collected.harnesses, [{ id: 'zeta', reader: 'present' }]);
  assert.deepEqual(collected.notes, [
    { level: 'info', text: 'No session log matched this project.' },
  ]);
});

test('collect() turns a reader that throws into one unavailable harness', () => {
  const brokenReader = {
    id: 'zeta',
    available: () => ({ ok: true }),
    read: () => {
      throw new Error('The log file is broken.');
    },
  };
  const collected = tokens.collect({
    harnesses: HARNESSES,
    getReader: () => brokenReader,
    projectRoot: '/fixture/project',
  });

  assert.equal(collected.harnesses[0].reader, 'unavailable');
  assert.equal(collected.harnesses[0].reason, 'The log file is broken.');
  assert.equal(collected.notes[0].level, 'warn');
});

test('collect() raises the named error of a reader that breaks the session shape', () => {
  const badReader = {
    id: 'zeta',
    available: () => ({ ok: true }),
    read: () => ({ sessions: [goodSession({ outputTokens: undefined })], notes: [] }),
  };

  assert.throws(
    () =>
      tokens.collect({
        harnesses: HARNESSES,
        getReader: () => badReader,
        projectRoot: '/fixture/project',
      }),
    (err) => {
      assert.ok(err instanceof SourceInvalidError);
      assert.match(err.message, /"outputTokens"/);
      return true;
    }
  );

  const noArrayReader = {
    id: 'zeta',
    available: () => ({ ok: true }),
    read: () => ({ notes: [] }),
  };
  assert.throws(
    () =>
      tokens.collect({
        harnesses: HARNESSES,
        getReader: () => noArrayReader,
        projectRoot: '/fixture/project',
      }),
    /"sessions"/
  );
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// The totals
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test('totals() holds the five values of the plan', () => {
  const collected = collectFixture();
  const result = tokens.totals(collected.sessions);

  assert.deepEqual(Object.keys(result), [
    'sessions',
    'steps',
    'promptTokens',
    'outputTokens',
    'subagentShare',
  ]);
  assert.deepEqual(result, {
    sessions: 7,
    steps: 232,
    promptTokens: 9700000,
    outputTokens: 107000,
    subagentShare: 0.7216,
  });
});

test('totals() of an empty report holds zero and a null share', () => {
  assert.deepEqual(tokens.totals([]), {
    sessions: 0,
    steps: 0,
    promptTokens: 0,
    outputTokens: 0,
    subagentShare: null,
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// The table
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test('renderTable() returns the eleven columns in the order of the plan', () => {
  const lines = tokens.renderTable(collectFixture().sessions);
  assert.deepEqual(lines[0].trim().split(/\s+/), [
    'created',
    'id',
    'harness',
    'kind',
    'model',
    'steps',
    'prompt',
    'cached',
    'final',
    'output',
    'flag',
  ]);
});

test('renderTable() renders one row per session, oldest first, with the number format', () => {
  const collected = collectFixture();
  const lines = tokens.renderTable(collected.sessions);

  assert.equal(lines.length, 8, 'one header line and seven session lines');
  assert.deepEqual(
    lines.slice(1).map((line) => line.slice(0, 16)),
    [
      '2026-09-11 05:00',
      '2026-09-12 06:00',
      '2026-09-13 07:45',
      '2026-09-14 09:00',
      '2026-09-15 10:30',
      '2026-09-16 11:15',
      '2026-09-17 08:05',
    ]
  );

  const plain = lines.find((line) => line.includes('parent-plain'));
  assert.deepEqual(plain.trim().split(/\s+/), [
    '2026-09-14',
    '09:00',
    'parent-plain',
    'zeta',
    'parent',
    'model-one',
    '12',
    '1.20M',
    '75%',
    '120.0k',
    '45.0k',
  ]);

  const zero = lines.find((line) => line.includes('parent-zero-pr'));
  assert.deepEqual(zero.trim().split(/\s+/), [
    '2026-09-12',
    '06:00',
    'parent-zero-pr',
    'zeta',
    'parent',
    'model-one',
    '1',
    '0',
    '-',
    '0',
    '0',
  ]);

  const flagged = lines.find((line) => line.includes('sub-101-steps'));
  assert.ok(flagged.endsWith('steps-over-100'));
});

test('renderTable() appends the total line when the caller passes the totals', () => {
  const collected = collectFixture();
  const lines = tokens.renderTable(collected.sessions, tokens.totals(collected.sessions));

  assert.equal(lines.length, 10);
  assert.equal(lines[8], '');
  assert.equal(
    lines[9],
    'total sessions=7 steps=232 prompt=9.70M output=107.0k subagents=72% of the prompt tokens'
  );
});

test('renderTable() changes no input array, and it sorts a missing created value last', () => {
  const input = [
    tokens.addFlags({ ...tokens.validateSession(goodSession({ id: 'late' }), { harness: 'zeta', position: 1 }), harness: 'zeta' }),
    tokens.addFlags({
      ...tokens.validateSession(goodSession({ id: 'early', created: '2020-01-01T00:00:00.000Z' }), {
        harness: 'zeta',
        position: 2,
      }),
      harness: 'zeta',
    }),
  ];
  const before = input.map((session) => session.id);
  const lines = tokens.renderTable(input);

  assert.deepEqual(input.map((session) => session.id), before);
  assert.ok(lines[1].includes('early'));
  assert.ok(lines[2].includes('late'));
  assert.ok(lines[2].startsWith('-'), 'a missing created value prints as "-"');
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// The JSON document
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test('buildJson() returns the shape of the plan', () => {
  const collected = collectFixture();
  const document = tokens.buildJson({
    version: '5.6.0',
    projectRoot: '/home/me/code/app',
    harnesses: collected.harnesses,
    sessions: collected.sessions,
    generated: '2026-09-18T12:00:00.000Z',
  });

  assert.deepEqual(Object.keys(document), [
    'schema',
    'beastModeVersion',
    'generated',
    'project',
    'harnesses',
    'sessions',
    'totals',
  ]);
  assert.equal(document.schema, 1);
  assert.equal(document.beastModeVersion, '5.6.0');
  assert.equal(document.generated, '2026-09-18T12:00:00.000Z');
  assert.equal(document.project, '/home/me/code/app');
  assert.deepEqual(document.harnesses, [{ id: 'zeta', reader: 'present' }]);
  assert.equal(document.sessions.length, 7);
  assert.deepEqual(document.totals, {
    sessions: 7,
    steps: 232,
    promptTokens: 9700000,
    outputTokens: 107000,
    subagentShare: 0.7216,
  });

  assert.deepEqual(Object.keys(document.sessions[0]), [
    'harness',
    'id',
    'kind',
    'parent',
    'model',
    'created',
    'steps',
    'promptTokens',
    'cacheReadTokens',
    'cacheShare',
    'finalPromptTokens',
    'outputTokens',
    'costUsd',
    'flags',
  ]);
  assert.deepEqual(document.sessions[4], {
    harness: 'zeta',
    id: 'sub-101-steps',
    kind: 'subagent',
    parent: 'parent-plain',
    model: 'model-two',
    created: '2026-09-15T10:30:00.000Z',
    steps: 101,
    promptTokens: 4000000,
    cacheReadTokens: 3600000,
    cacheShare: 0.9,
    finalPromptTokens: 90000,
    outputTokens: 30000,
    costUsd: null,
    flags: ['steps-over-100'],
  });
});

test('buildJson() carries the reader state of every harness, and the reason of an unavailable one', () => {
  const document = tokens.buildJson({
    version: '5.6.0',
    projectRoot: '/p',
    harnesses: [
      { id: 'alpha', reader: 'missing' },
      { id: 'zeta', reader: 'unavailable', reason: fixture.UNAVAILABLE_REASON },
    ],
    sessions: [],
    generated: '2026-09-18T12:00:00.000Z',
  });

  assert.deepEqual(document.harnesses, [
    { id: 'alpha', reader: 'missing' },
    { id: 'zeta', reader: 'unavailable', reason: fixture.UNAVAILABLE_REASON },
  ]);
  assert.deepEqual(document.sessions, []);
  assert.equal(document.totals.sessions, 0);
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// The CLI surface
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test('--help names the tokens command and the two report flags', () => {
  const result = cli(['--help'], PLUGIN_ROOT);
  assert.equal(result.status, 0);
  assert.match(result.out, /beast-mode tokens/);
  assert.match(result.out, /--json/);
  assert.match(result.out, /--days <n>/);
});

test('tokens refuses a harness argument, a bad window, and the report flags on another command', () => {
  assert.equal(cli(['tokens', 'claude'], PLUGIN_ROOT).status, 2);
  assert.equal(cli(['tokens', '--days', 'soon'], PLUGIN_ROOT).status, 2);
  assert.equal(cli(['tokens', '--days', '0'], PLUGIN_ROOT).status, 2);
  assert.equal(cli(['tokens', '--days', '-3'], PLUGIN_ROOT).status, 2);
  // A fraction names no window of days, and the web route refuses the same
  // value, so the CLI and the tab agree.
  assert.equal(cli(['tokens', '--days', '7.5'], PLUGIN_ROOT).status, 2);
  assert.equal(cli(['status', '--json'], PLUGIN_ROOT).status, 2);
  assert.equal(cli(['install', 'claude', '--days', '3'], PLUGIN_ROOT).status, 2);
});

test('tokens in a project with no harness prints the status sentence and the install hint', () => {
  const projectRoot = createTempProjectRoot();
  try {
    const result = cli(['tokens', '--project', projectRoot], projectRoot);
    assert.equal(result.status, 0);
    assert.match(result.out, /No installed harness found in this project\./);
    assert.match(result.out, /Run "beast-mode install <harness>" to install one\./);
  } finally {
    removeFixture(projectRoot);
  }
});

test('tokens in a project with no reader prints the no-reader line and exits 0', () => {
  const projectRoot = createTempProjectRoot();

  // The registry ships a reader for the dsh harness now. getReader() reads the
  // live registry object, and cli() calls main() in this process, so the
  // delete reaches runTokens(). The restore runs in every case.
  const saved = readers.dsh;
  delete readers.dsh;
  try {
    assert.equal(cli(['install', 'dsh', '--project', projectRoot], projectRoot).status, 0);

    const result = cli(['tokens', '--project', projectRoot], projectRoot);
    assert.equal(result.status, 0);
    assert.match(result.out, /The plugin ships no token reader for the harness "dsh" yet\./);
    assert.match(result.out, /Window: {10}every session/);
  } finally {
    readers.dsh = saved;
    removeFixture(projectRoot);
  }
});

test('tokens --json prints one object on the output stream and nothing else', () => {
  const projectRoot = createTempProjectRoot();

  // The same delete of the dsh reader, and the same restore. The pair sits
  // inside this test, so no delete reaches another test.
  const saved = readers.dsh;
  delete readers.dsh;
  try {
    assert.equal(cli(['install', 'dsh', '--project', projectRoot], projectRoot).status, 0);

    const result = cli(['tokens', '--json', '--days', '7', '--project', projectRoot], projectRoot);
    assert.equal(result.status, 0);

    const document = JSON.parse(result.out);
    assert.equal(document.schema, 1);
    assert.equal(document.project, projectRoot);
    assert.deepEqual(document.harnesses, [{ id: 'dsh', reader: 'missing' }]);
    assert.deepEqual(document.sessions, []);
    assert.equal(document.totals.sessions, 0);
    assert.match(document.generated, /^\d{4}-\d{2}-\d{2}T/);

    assert.ok(!result.out.includes('ℹ'), 'the output stream carries the object alone');
    assert.match(result.err, /The plugin ships no token reader for the harness "dsh" yet\./);
  } finally {
    readers.dsh = saved;
    removeFixture(projectRoot);
  }
});

test('tokens and tokens --json run inside this repository and exit 0', () => {
  const plain = cli(['tokens'], PLUGIN_ROOT);
  assert.equal(plain.status, 0);
  assert.match(plain.out, /BEAST MODE TOKEN REPORT/);

  const json = cli(['tokens', '--json'], PLUGIN_ROOT);
  assert.equal(json.status, 0);
  const document = JSON.parse(json.out);
  assert.equal(document.schema, 1);
  assert.ok(Array.isArray(document.harnesses));
  assert.ok(Array.isArray(document.sessions));
});
