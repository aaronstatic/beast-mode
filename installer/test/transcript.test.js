// installer/test/transcript.test.js
//
// The tests of the transcript core of installer/lib/transcript.js and of the
// "beast-mode transcript" command of installer/bin/beast-mode.js.
//
// The core tests drive collectTranscript() with fixture readers: the newest
// answer across two readers, a current answer over a newer answer, the
// newest of two current answers, the first answer of an id, a reader that
// throws, a reader that cannot run, a reader with no transcript member, the
// step check, the check of the "current" field, the merge order, the cut,
// the relative file path, and the two renderers.
//
// The CLI tests call main() in this process with a Claude Code log tree
// under os.tmpdir(). Each CLI test sets CLAUDE_CONFIG_DIR and DSH_HOME on
// process.env to temp trees, deletes CLAUDE_CODE_SESSION_ID or sets it to a
// session of the tree, and restores all three in a finally block, because
// the command asks every reader of the registry with process.env, and Claude
// Code exports CLAUDE_CODE_SESSION_ID to each tool shell. The core tests pass
// an env object of their own, so no variable of the shell reaches a reader.
// No test reads the real home directory, and no test writes into this repo.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { main } from '../bin/beast-mode.js';
import { SourceInvalidError } from '../lib/errors.js';
import { findPluginRoot } from '../lib/source.js';
import * as core from '../lib/transcript.js';
import { removeFixture } from './helpers.js';

const PLUGIN_ROOT = findPluginRoot(import.meta.dirname);

/**
 * One time at one minute of 10:00 UTC on 2026-03-01.
 *
 * @param {number} minute
 * @returns {string}
 */
function at(minute) {
  return `2026-03-01T10:${String(minute).padStart(2, '0')}:00.000Z`;
}

/**
 * One raw step, with the fields a test overrides.
 *
 * @param {Record<string, unknown>} [overrides]
 * @returns {Record<string, unknown>}
 */
function rawStep(overrides = {}) {
  return { at: at(0), kind: 'shell', tool: 'Bash', file: null, text: 'ls', error: null, ...overrides };
}

/**
 * One raw transcript, with the fields a test overrides.
 *
 * @param {Record<string, unknown>} [overrides]
 * @returns {Record<string, any>}
 */
function rawTranscript(overrides = {}) {
  return {
    id: 'sess-1',
    kind: 'parent',
    parent: null,
    created: at(0),
    writtenAt: '2026-03-01T11:00:00.000Z',
    agents: [{ id: 'sess-1', steps: [rawStep()] }],
    ...overrides,
  };
}

/**
 * One fixture reader. It records the context of every transcript() call.
 *
 * @param {string} id
 * @param {unknown} answer The answer of transcript(), or a function that returns it.
 * @param {{ ok?: boolean }} [opts]
 */
function fixtureReader(id, answer, opts = {}) {
  /** @type {Record<string, unknown>[]} */
  const calls = [];
  return {
    id,
    calls,
    available: () =>
      opts.ok === false
        ? { ok: false, reason: `The ${id} log directory is gone.`, fix: `Run ${id} one time.` }
        : { ok: true },
    read: () => ({ sessions: [], notes: [] }),
    transcript: (/** @type {Record<string, unknown>} */ ctx) => {
      calls.push(ctx);
      return typeof answer === 'function' ? answer(ctx) : answer;
    },
  };
}

/**
 * Collect with a set of fixture readers.
 *
 * @param {Record<string, unknown>} readers
 * @param {string | null} [sessionId]
 * @param {string} [projectRoot]
 */
function collect(readers, sessionId = null, projectRoot = '/fixture/project') {
  return core.collectTranscript({
    readers: /** @type {any} */ (readers),
    projectRoot,
    sessionId,
    env: { FIXTURE: '1' },
  });
}

/**
 * The texts of a note list.
 *
 * @param {{ notes: { text: string }[] }} collected
 * @returns {string[]}
 */
function noteTexts(collected) {
  return collected.notes.map((note) => note.text);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// The collect pass
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test('with no id, the latest writtenAt across two readers wins', () => {
  const early = fixtureReader('alpha', {
    transcript: rawTranscript({ id: 'alpha-1', writtenAt: '2026-03-01T11:00:00.000Z' }),
    notes: [],
  });
  const late = fixtureReader('beta', {
    transcript: rawTranscript({ id: 'beta-1', writtenAt: '2026-03-01T12:00:00.000Z' }),
    notes: ['A beta note.'],
  });

  const collected = collect({ alpha: early, beta: late });
  assert.equal(collected.transcript?.id, 'beta-1');
  assert.equal(collected.transcript?.harness, 'beta');
  assert.deepEqual(collected.notes, [{ level: 'info', text: 'A beta note.' }]);

  // Each reader saw the project root, the null id, and the env of the caller.
  assert.deepEqual(early.calls, [
    { projectRoot: '/fixture/project', sessionId: null, env: { FIXTURE: '1' } },
  ]);

  // The order of the registry does not decide it.
  assert.equal(collect({ beta: late, alpha: early }).transcript?.id, 'beta-1');

  // The core reads no CLAUDE_CODE_SESSION_ID. It hands the env of the caller
  // to each reader, and the latest writtenAt still wins.
  const env = { FIXTURE: '1', CLAUDE_CODE_SESSION_ID: 'alpha-1' };
  const named = core.collectTranscript({
    readers: /** @type {any} */ ({ alpha: early, beta: late }),
    projectRoot: '/fixture/project',
    sessionId: null,
    env,
  });
  assert.equal(named.transcript?.id, 'beta-1');
  assert.deepEqual(early.calls.at(-1), { projectRoot: '/fixture/project', sessionId: null, env });
});

test('with no id, an answer with current: true wins over a newer answer without it', () => {
  const running = fixtureReader('alpha', {
    transcript: rawTranscript({ id: 'alpha-1', writtenAt: '2026-03-01T09:00:00.000Z', current: true }),
    notes: [],
  });
  const plain = fixtureReader('beta', {
    transcript: rawTranscript({ id: 'beta-1', writtenAt: '2026-03-01T12:00:00.000Z' }),
    notes: [],
  });
  const marked = fixtureReader('gamma', {
    transcript: rawTranscript({ id: 'gamma-1', writtenAt: '2026-03-01T13:00:00.000Z', current: false }),
    notes: [],
  });

  // The older current answer wins in either registry order, and the core adds no note.
  const collected = collect({ beta: plain, alpha: running });
  assert.equal(collected.transcript?.id, 'alpha-1');
  assert.equal(collected.transcript?.harness, 'alpha');
  assert.deepEqual(collected.notes, []);
  assert.equal(collect({ alpha: running, beta: plain }).transcript?.id, 'alpha-1');

  // The field stays inside the data: the transcript holds no "current" key.
  assert.equal(Object.hasOwn(collected.transcript ?? {}, 'current'), false);

  // "current: false" counts as an absent field.
  assert.equal(collect({ gamma: marked, beta: plain, alpha: running }).transcript?.id, 'alpha-1');
  assert.equal(collect({ beta: plain, gamma: marked }).transcript?.id, 'gamma-1');

  // A current answer with no time still wins.
  const untimed = fixtureReader('delta', {
    transcript: rawTranscript({ id: 'delta-1', writtenAt: null, current: true }),
    notes: [],
  });
  assert.equal(collect({ beta: plain, delta: untimed }).transcript?.id, 'delta-1');

  // With an id, the field changes nothing: the first answer in registry order wins.
  const named = collect({ beta: plain, alpha: running }, 'abc');
  assert.equal(named.transcript?.id, 'beta-1');
  assert.equal(named.notes.length, 1);
});

test('with no id, two answers with current: true pick the latest writtenAt, and the first wins a tie', () => {
  const older = fixtureReader('alpha', {
    transcript: rawTranscript({ id: 'alpha-1', writtenAt: '2026-03-01T10:00:00.000Z', current: true }),
    notes: [],
  });
  const newer = fixtureReader('beta', {
    transcript: rawTranscript({ id: 'beta-1', writtenAt: '2026-03-01T11:00:00.000Z', current: true }),
    notes: [],
  });
  const plain = fixtureReader('gamma', {
    transcript: rawTranscript({ id: 'gamma-1', writtenAt: '2026-03-01T12:00:00.000Z' }),
    notes: [],
  });

  // The newer of the two current answers wins, and the newest plain answer loses.
  assert.equal(collect({ alpha: older, beta: newer, gamma: plain }).transcript?.id, 'beta-1');
  assert.equal(collect({ gamma: plain, beta: newer, alpha: older }).transcript?.id, 'beta-1');

  // On a tie of writtenAt, the first current answer in registry order wins.
  const twin = fixtureReader('delta', {
    transcript: rawTranscript({ id: 'delta-1', writtenAt: '2026-03-01T11:00:00.000Z', current: true }),
    notes: [],
  });
  assert.equal(collect({ delta: twin, beta: newer, gamma: plain }).transcript?.id, 'delta-1');
  assert.equal(collect({ beta: newer, delta: twin, gamma: plain }).transcript?.id, 'beta-1');
});

test('with an id, the first answer wins, and a note names the second answer', () => {
  const first = fixtureReader('alpha', {
    transcript: rawTranscript({ id: 'abc-alpha', writtenAt: '2026-03-01T09:00:00.000Z' }),
    notes: [],
  });
  const second = fixtureReader('beta', {
    transcript: rawTranscript({ id: 'abc-beta', writtenAt: '2026-03-01T12:00:00.000Z' }),
    notes: [],
  });

  const collected = collect({ alpha: first, beta: second }, '  abc ');
  assert.equal(collected.transcript?.id, 'abc-alpha');
  assert.equal(first.calls[0].sessionId, 'abc', 'the core trims the id');
  assert.equal(collected.notes.length, 1);
  assert.match(collected.notes[0].text, /The harness "beta" also holds a session that matches "abc": abc-beta\./);
});

test('a reader that throws becomes one warning note, and the other reader still answers', () => {
  const broken = fixtureReader('alpha', () => {
    throw new Error('The log tree is broken.');
  });
  const good = fixtureReader('beta', { transcript: rawTranscript({ id: 'beta-1' }), notes: [] });

  const collected = collect({ alpha: broken, beta: good });
  assert.equal(collected.transcript?.id, 'beta-1');
  assert.deepEqual(collected.notes, [
    {
      level: 'warn',
      text: 'The transcript reader of the harness "alpha" cannot run. The log tree is broken. Report the defect to the author of the reader.',
    },
  ]);
});

test('a reader with no transcript member is skipped, and a reader that cannot run adds a note only with no transcript', () => {
  let asked = 0;
  const tokensOnly = {
    id: 'gamma',
    available: () => {
      asked += 1;
      return { ok: true };
    },
    read: () => ({ sessions: [], notes: [] }),
  };
  const idle = fixtureReader('alpha', { transcript: null, notes: [] }, { ok: false });
  const good = fixtureReader('beta', { transcript: rawTranscript(), notes: [] });

  const found = collect({ gamma: tokensOnly, alpha: idle, beta: good });
  assert.equal(found.transcript?.harness, 'beta');
  assert.deepEqual(found.notes, []);
  assert.equal(asked, 0, 'the core asks no reader with no transcript member');
  assert.equal(idle.calls.length, 0, 'the core asks no reader that cannot run');

  const missing = collect({ gamma: tokensOnly, alpha: idle });
  assert.equal(missing.transcript, null);
  assert.deepEqual(noteTexts(missing), [
    'The reader of the harness "alpha" cannot run. The alpha log directory is gone. Run alpha one time.',
    core.NO_SESSION_NOTE,
  ]);
});

test('a run with no transcript gives the no-session line, the no-match line, or the ambiguity note alone', () => {
  const empty = fixtureReader('alpha', { transcript: null, notes: [] });

  assert.deepEqual(noteTexts(collect({ alpha: empty })), ['No session log of this project was found.']);
  assert.deepEqual(noteTexts(collect({ alpha: empty }, 'nosuchid')), [
    'No session log of this project matches "nosuchid". Run "beast-mode tokens" to list the session ids.',
  ]);

  const ambiguous = fixtureReader('alpha', {
    transcript: null,
    notes: ['The id "ab" matches more than one session: ab-2, ab-1.'],
  });
  assert.deepEqual(noteTexts(collect({ alpha: ambiguous }, 'ab')), [
    'The id "ab" matches more than one session: ab-2, ab-1.',
  ]);

  // A registry with no transcript reader at all still gives one line.
  assert.deepEqual(noteTexts(collect({})), ['No session log of this project was found.']);
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// The step check
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test('the step check refuses a bad field, and it names the field', () => {
  const cases = [
    [{ kind: 'bogus' }, 'kind'],
    [{ kind: undefined }, 'kind'],
    [{ text: 5 }, 'text'],
    [{ text: null }, 'text'],
    [{ at: 'yesterday' }, 'at'],
    [{ at: undefined }, 'at'],
    [{ tool: 3 }, 'tool'],
    [{ file: {} }, 'file'],
    [{ file: undefined }, 'file'],
    [{ error: 7 }, 'error'],
  ];

  for (const [overrides, field] of cases) {
    const reader = fixtureReader('alpha', {
      transcript: rawTranscript({ agents: [{ id: 'sess-1', steps: [rawStep(), rawStep(overrides)] }] }),
      notes: [],
    });
    assert.throws(
      () => collect({ alpha: reader }),
      (err) => {
        assert.ok(err instanceof SourceInvalidError);
        assert.equal(err.message, `A transcript reader returned a step with a bad "${field}" field.`);
        assert.match(err.causeText, /harness "alpha" returned step 2 of the agent "sess-1"/);
        return true;
      },
      `the check refuses ${JSON.stringify(overrides)}`
    );
  }

  const notAnObject = fixtureReader('alpha', {
    transcript: rawTranscript({ agents: [{ id: 'sess-1', steps: [null] }] }),
    notes: [],
  });
  assert.throws(() => collect({ alpha: notAnObject }), /a step with a bad "step" field/);
});

test('the answer check refuses a bad transcript field, and a missing transcript key', () => {
  const cases = [
    [{ id: '' }, 'id'],
    [{ kind: 'main' }, 'kind'],
    [{ parent: 4 }, 'parent'],
    [{ created: 1 }, 'created'],
    [{ writtenAt: undefined }, 'writtenAt'],
    [{ agents: [] }, 'agents'],
    [{ agents: [{ id: 'sess-1' }] }, 'agents'],
  ];
  for (const [overrides, field] of cases) {
    const reader = fixtureReader('alpha', { transcript: rawTranscript(overrides), notes: [] });
    assert.throws(
      () => collect({ alpha: reader }),
      (err) =>
        err instanceof SourceInvalidError &&
        err.message === `A transcript reader returned an answer with a bad "${field}" field.`
    );
  }

  const noKey = fixtureReader('alpha', { notes: [] });
  assert.throws(() => collect({ alpha: noKey }), /an answer with a bad "transcript" field/);
});

test('the answer check accepts "current" when it is absent or a boolean, and it refuses any other value by name', () => {
  const accepted = [
    rawTranscript(),
    rawTranscript({ current: true }),
    rawTranscript({ current: false }),
    rawTranscript({ current: undefined }),
  ];
  for (const raw of accepted) {
    const reader = fixtureReader('alpha', { transcript: raw, notes: [] });
    assert.equal(collect({ alpha: reader }).transcript?.id, 'sess-1', `the check accepts ${String(raw.current)}`);
  }

  for (const current of [null, 'true', 1, 0, {}, []]) {
    const reader = fixtureReader('alpha', { transcript: rawTranscript({ current }), notes: [] });
    assert.throws(
      () => collect({ alpha: reader }),
      (err) => {
        assert.ok(err instanceof SourceInvalidError);
        assert.equal(err.message, 'A transcript reader returned an answer with a bad "current" field.');
        assert.equal(
          err.causeText,
          'The reader of the harness "alpha" returned an answer, and the "current" field holds no boolean.'
        );
        return true;
      },
      `the check refuses ${JSON.stringify(current)}`
    );
  }

  // The check also runs with an id, where the field changes no pick.
  const named = fixtureReader('alpha', { transcript: rawTranscript({ current: 'yes' }), notes: [] });
  assert.throws(() => collect({ alpha: named }, 'sess'), /an answer with a bad "current" field/);
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// The merge, the cut, and the file path
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test('the merge orders the steps by time, keeps the named session first on a tie, and keeps an untimed step after the step before it', () => {
  const named = (text, minute) => rawStep({ text, at: minute === null ? null : at(minute) });
  const reader = fixtureReader('alpha', {
    transcript: rawTranscript({
      agents: [
        { id: 'sess-1', steps: [named('m1', 0), named('m2', 5), named('m3', null), named('m4', 10)] },
        // a3 carries a time before a2, and it stays after a2.
        { id: 'sub-aaaa-1111', steps: [named('a1', 2), named('a2', 5), named('a3', 3)] },
        // b1 holds no time, and it takes the time of b2.
        { id: 'sub-bbbb-2222', steps: [named('b1', null), named('b2', 6)] },
        // A list with no time at all comes after every timed step.
        { id: 'sub-cccc-3333', steps: [named('c1', null), named('c2', null)] },
      ],
    }),
    notes: [],
  });

  const found = collect({ alpha: reader }).transcript;
  assert.ok(found);
  assert.deepEqual(
    found.steps.map((step) => `${step.n}:${step.text}:${step.label}`),
    [
      '1:m1:main',
      '2:a1:sub-aaaa',
      '3:m2:main',
      '4:m3:main',
      '5:a2:sub-aaaa',
      '6:a3:sub-aaaa',
      '7:b1:sub-bbbb',
      '8:b2:sub-bbbb',
      '9:m4:main',
      '10:c1:sub-cccc',
      '11:c2:sub-cccc',
    ]
  );
  assert.deepEqual(found.agents, [
    { id: 'sess-1', label: 'main', steps: 4, firstStep: 1 },
    { id: 'sub-aaaa-1111', label: 'sub-aaaa', steps: 3, firstStep: 2 },
    { id: 'sub-bbbb-2222', label: 'sub-bbbb', steps: 2, firstStep: 7 },
    { id: 'sub-cccc-3333', label: 'sub-cccc', steps: 2, firstStep: 10 },
  ]);
  assert.deepEqual(found.counts, { steps: 11, users: 0, errors: 0, subagents: 3 });
});

test('a NUL or another control character of a step becomes a space, and a tab stays', () => {
  const bad = 'Exit code 1\nPK\u0003\u0004\u0000\u0000 bad\u007f end\tok';
  assert.equal(core.cutText(bad), 'Exit code 1 PK     bad  end\tok');
  const line = core.renderStep({
    n: 3, at: null, label: 'main', kind: 'tool', tool: 'Bash\u0000', file: null, text: 'run', error: bad,
  });
  assert.ok(!/[\u0000-\u0008\u000A-\u001F\u007F]/u.test(line.replace(/\t/g, '')));
  assert.ok(line.startsWith('3 '));
  assert.ok(line.includes('| error: Exit code 1 PK'));
});

test('the cut makes one line of 300 characters at most, and it ends a cut with "..."', () => {
  assert.equal(core.cutText('  one\r\ntwo\nthree\rfour  '), 'one two three four');
  assert.equal(core.cutText('a\u{2028}b\u{2029}c\u{85}d\ve\ff'), 'a b c d e f');

  const long = 'x'.repeat(400);
  const cut = core.cutText(long);
  assert.equal(cut.length, 300);
  assert.ok(cut.endsWith('...'));
  assert.equal(cut, `${'x'.repeat(297)}...`);

  // A text of exactly 300 characters stays whole.
  assert.equal(core.cutText('y'.repeat(300)), 'y'.repeat(300));

  // A cut keeps a surrogate pair whole.
  const emoji = `${'z'.repeat(296)}\u{1F600}tail${'z'.repeat(20)}`;
  const kept = core.cutText(emoji);
  assert.equal(kept, `${'z'.repeat(296)}...`);

  // The core cuts each text and each error of a step.
  const reader = fixtureReader('alpha', {
    transcript: rawTranscript({
      agents: [{ id: 'sess-1', steps: [rawStep({ text: `a\n${long}`, error: `b\r\n${long}` })] }],
    }),
    notes: [],
  });
  const step = collect({ alpha: reader }).transcript?.steps[0];
  assert.equal(step?.text.length, 300);
  assert.ok(step?.text.startsWith('a x'));
  assert.equal(step?.error?.length, 300);
  assert.ok(step?.error?.startsWith('b x'));
});

test('a file inside the project root becomes a relative path, and every other file stays', () => {
  const roots = ['/proj'];
  assert.equal(core.relativeFile('/proj/src/a.js', roots), path.join('src', 'a.js'));
  assert.equal(core.relativeFile('/proj', roots), '.');
  assert.equal(core.relativeFile('/projector/a.js', roots), '/projector/a.js');
  assert.equal(core.relativeFile('/other/a.js', roots), '/other/a.js');
  assert.equal(core.relativeFile('src/b.js', roots), 'src/b.js');

  const reader = fixtureReader('alpha', {
    transcript: rawTranscript({
      agents: [
        {
          id: 'sess-1',
          steps: [
            rawStep({ kind: 'read', tool: 'Read', file: '/proj/docs/a.md', text: '' }),
            rawStep({ kind: 'write', tool: 'Write', file: '/tmp/out.md', text: '' }),
          ],
        },
      ],
    }),
    notes: [],
  });
  const found = core.collectTranscript({
    readers: /** @type {any} */ ({ alpha: reader }),
    projectRoot: '/proj',
    env: {},
  }).transcript;
  assert.deepEqual(
    found?.steps.map((step) => step.file),
    [path.join('docs', 'a.md'), '/tmp/out.md']
  );
});

test('the file name keeps a safe id, and it replaces every other character with "-"', () => {
  assert.equal(core.transcriptFileName('55898103-45a0-4b99'), '55898103-45a0-4b99.txt');
  assert.equal(core.transcriptFileName('a.b_c-d'), 'a.b_c-d.txt');
  assert.equal(core.transcriptFileName('a/b c:d\\e'), 'a-b-c-d-e.txt');
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// The renderers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * A small transcript with a user message, a failed step, a step with no
 * time, and one subagent.
 */
function smallTranscript() {
  const reader = fixtureReader('alpha', {
    transcript: rawTranscript({
      id: 'sess-render',
      created: '2026-03-01T10:00:30.000Z',
      writtenAt: '2026-03-01T11:45:00.000Z',
      agents: [
        {
          id: 'sess-render',
          steps: [
            rawStep({ kind: 'user', tool: null, text: '/review-session', at: at(0) }),
            rawStep({ kind: 'edit', tool: 'Edit', file: '/proj/a.js', text: '', at: at(2), error: 'Not found' }),
            rawStep({ kind: 'shell', tool: 'Bash', text: 'npm test', at: null }),
          ],
        },
        {
          id: 'abcdef0123456789',
          steps: [rawStep({ kind: 'read', tool: 'Read', file: '/proj/b.md', text: 'lines 1-20', at: at(1) })],
        },
      ],
    }),
    notes: [],
  });
  const found = core.collectTranscript({
    readers: /** @type {any} */ ({ alpha: reader }),
    projectRoot: '/proj',
    env: {},
  }).transcript;
  assert.ok(found);
  return found;
}

test('renderFile() prints the header, one Agent line per subagent, the legend, and one line per step', () => {
  assert.deepEqual(core.renderFile(smallTranscript()), [
    '# Transcript of session sess-render',
    'Harness: alpha. Kind: parent. Started: 2026-03-01 10:00 UTC. Last write: 2026-03-01 11:45 UTC.',
    'Steps: 4. User messages: 1. Errors: 1. Subagents: 1.',
    'Agent abcdef01: abcdef0123456789, 1 steps, first step 2.',
    'Times are UTC. One line for each step: the number, the time, the agent, the kind, the tool, the file, the text, and the error.',
    '',
    '1 10:00 main user - - | /review-session',
    '2 10:01 abcdef01 read Read b.md | lines 1-20',
    '3 10:02 main edit Edit a.js | - | error: Not found',
    '4 --:-- main shell Bash - | npm test',
  ]);
});

test('renderSummary() prints the session lines, and the Transcript line only with a file', () => {
  const found = smallTranscript();
  assert.deepEqual(
    core.renderSummary({ version: '9.9.9', projectRoot: '/proj', transcript: found, file: '/out/sess-render.txt' }),
    [
      'Plugin version:  9.9.9',
      'Project:         /proj',
      'Session:         sess-render (alpha, parent, started 2026-03-01 10:00 UTC)',
      'Steps:           4 (1 user messages, 1 errors, 1 subagents)',
      'Transcript:      /out/sess-render.txt',
    ]
  );
  assert.deepEqual(core.renderSummary({ version: '9.9.9', projectRoot: '/proj', transcript: found }).length, 4);
  assert.deepEqual(core.renderSummary({ version: '9.9.9', projectRoot: '/proj', transcript: null }), [
    'Plugin version:  9.9.9',
    'Project:         /proj',
  ]);

  // A time that is absent prints "unknown".
  assert.equal(core.formatStamp(null), 'unknown');
  assert.equal(core.formatTime(null), '--:--');
});

/**
 * One found transcript of the main session, with one step per file entry.
 * An entry is [kind, file], and the file is a path inside "/proj" or null.
 *
 * @param {Array<[string, string | null]>} entries
 */
function featureTranscript(entries) {
  const reader = fixtureReader('alpha', {
    transcript: rawTranscript({
      agents: [
        {
          id: 'sess-1',
          steps: entries.map(([kind, file], index) =>
            rawStep({ kind, tool: file === null ? null : 'Tool', file, text: 'x', at: at(index) })
          ),
        },
      ],
    }),
    notes: [],
  });
  const found = core.collectTranscript({
    readers: /** @type {any} */ ({ alpha: reader }),
    projectRoot: '/proj',
    env: {},
  }).transcript;
  assert.ok(found);
  return found;
}

test('the Features line names a plain feature, with one line in the file and one in the summary', () => {
  const found = featureTranscript([
    ['read', '/proj/docs/features/user-auth/implementation.md'],
    ['edit', '/proj/docs/features/user-auth/tasks.md'],
    ['write', '/proj/docs/features/user-auth/context.md'],
  ]);
  assert.deepEqual(core.featurePaths(found.steps), ['user-auth']);

  const file = core.renderFile(found);
  assert.equal(file[3], 'Features: user-auth.');
  assert.equal(file[4].startsWith('Times are UTC.'), true);

  const summary = core.renderSummary({ version: '9.9.9', projectRoot: '/proj', transcript: found, file: '/out/x.txt' });
  assert.deepEqual(summary.slice(-3), [
    'Steps:           3 (0 user messages, 0 errors, 0 subagents)',
    'Features:        user-auth',
    'Transcript:      /out/x.txt',
  ]);
});

test('buildTranscript() keeps the feature paths in the features field, and both renderers read that field', () => {
  const found = featureTranscript([
    ['read', '/proj/docs/features/user-auth/implementation.md'],
    ['read', '/proj\\docs\\features\\editor\\base\\tasks.md'],
  ]);
  assert.deepEqual(found.features, core.featurePaths(found.steps));
  assert.ok(found.features.includes('user-auth'));

  // The renderers compute nothing: a changed field changes both outputs.
  const changed = { ...found, features: ['from-the-field'] };
  assert.equal(core.renderFile(changed)[3], 'Features: from-the-field.');
  const summary = core.renderSummary({ version: '9.9.9', projectRoot: '/proj', transcript: changed });
  assert.equal(summary.at(-1), 'Features:        from-the-field');
  assert.equal(core.renderFile({ ...found, features: [] }).some((line) => line.startsWith('Features:')), false);
});

test('the Features line names an epic path, and only for the five doc names', () => {
  const found = featureTranscript([
    ['read', '/proj/docs/features/editor/base/implementation.md'],
    ['read', '/proj/docs/features/editor/base/inbox.md'],
    ['read', '/proj/docs/features/editor/base/requirements.md'],
    // Not one of the five names, so each of these names no path.
    ['read', '/proj/docs/features/editor/epic-overview.md'],
    ['read', '/proj/docs/features/editor/epic-requirements.md'],
    ['read', '/proj/docs/features/editor/base/human-testing.md'],
    ['read', '/proj/docs/features/editor/base/notes.txt'],
  ]);
  assert.deepEqual(core.featurePaths(found.steps), ['editor/base']);
  assert.equal(core.renderFile(found)[3], 'Features: editor/base.');
});

test('the Features line names the path of a brief, and it skips the review-session folder', () => {
  const found = featureTranscript([
    ['read', '/proj/.beast-mode/briefs/deterministic-loop/review-session/phase-6.md'],
    ['read', '/proj/.beast-mode/briefs/review-session/phase-1.md'],
    ['read', '/proj/.beast-mode/briefs/review-session/deeper/phase-1.md'],
    ['write', '/proj/.beast-mode/briefs/review-session.md'],
  ]);
  assert.deepEqual(core.featurePaths(found.steps), ['deterministic-loop/review-session']);

  // The doc folder of the review-session feature is a feature like any other.
  assert.deepEqual(
    core.featurePaths(featureTranscript([['edit', '/proj/docs/features/review-session/tasks.md']]).steps),
    ['review-session']
  );
});

test('the Features line counts only read, write, and edit steps of a file inside the project', () => {
  const found = featureTranscript([
    ['shell', '/proj/docs/features/shell-feat/tasks.md'],
    ['search', '/proj/docs/features/search-feat/tasks.md'],
    ['read', '/elsewhere/docs/features/outside/tasks.md'],
    ['read', null],
    ['read', '/proj/docs/features/inside/tasks.md'],
  ]);
  assert.deepEqual(core.featurePaths(found.steps), ['inside']);
});

test('the Features line lists three paths at most, by step count, then by the first step', () => {
  const doc = (/** @type {string} */ name) => /** @type {[string, string]} */ (['read', `/proj/docs/features/${name}/tasks.md`]);
  const found = featureTranscript([
    doc('first'),
    doc('second'),
    doc('third'),
    doc('fourth'),
    doc('fourth'),
    doc('third'),
    doc('fourth'),
    doc('fifth'),
  ]);
  // fourth: 3 steps. third: 2 steps. first and second tie at 1 step, and first came first.
  assert.deepEqual(core.featurePaths(found.steps), ['fourth', 'third', 'first']);
  assert.equal(core.renderFile(found)[3], 'Features: fourth, third, first.');
  assert.equal(
    core.renderSummary({ version: '9.9.9', projectRoot: '/proj', transcript: found }).at(-1),
    'Features:        fourth, third, first'
  );
});

test('a log with no feature has no Features line in the file or in the summary', () => {
  const found = featureTranscript([
    ['read', '/proj/src/a.js'],
    ['edit', '/proj/docs/overview.md'],
    ['shell', null],
  ]);
  assert.deepEqual(core.featurePaths(found.steps), []);
  assert.equal(core.renderFile(found).some((line) => line.startsWith('Features:')), false);
  assert.equal(
    core.renderSummary({ version: '9.9.9', projectRoot: '/proj', transcript: found, file: '/out/x.txt' }).some((line) =>
      line.startsWith('Features:')
    ),
    false
  );
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// The CLI
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

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
    stdout: /** @type {any} */ (outSink),
    stderr: /** @type {any} */ (errSink),
    cwd,
  });
  return { status, out, err };
}

/**
 * Build one temp tree: a project root, a Claude Code log tree with one
 * parent log and one subagent log, and an empty dsh home.
 *
 * @returns {{ root: string, projectRoot: string, claudeRoot: string, dshRoot: string, projectDir: string }}
 */
function createCliTree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bm-transcript-cli-'));
  const projectRoot = path.join(root, 'project');
  const claudeRoot = path.join(root, 'claude');
  const dshRoot = path.join(root, 'dsh');
  fs.mkdirSync(projectRoot);
  fs.mkdirSync(dshRoot);

  const key = path.resolve(projectRoot).replace(/[^A-Za-z0-9]/g, '-');
  const projectDir = path.join(claudeRoot, 'projects', key);
  const subagents = path.join(projectDir, 'sess-cli', 'subagents');
  fs.mkdirSync(subagents, { recursive: true });

  const parent = [
    { type: 'user', timestamp: at(0), message: { role: 'user', content: 'Fix the bug' } },
    {
      type: 'assistant',
      timestamp: at(1),
      message: {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 't1',
            name: 'Read',
            input: { file_path: path.join(projectRoot, 'src', 'a.js') },
          },
        ],
      },
    },
    {
      type: 'assistant',
      timestamp: at(3),
      message: {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'npm test' } }],
      },
    },
    {
      type: 'user',
      timestamp: at(4),
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 't2', content: 'Exit code 1', is_error: true }],
      },
    },
  ];
  const sub = [{ type: 'user', timestamp: at(2), message: { role: 'user', content: 'Phase 1 brief' } }];

  const time = new Date('2026-03-01T12:00:00.000Z');
  const parentFile = path.join(projectDir, 'sess-cli.jsonl');
  const subFile = path.join(subagents, 'agent-sub-cli-0001.jsonl');
  fs.writeFileSync(parentFile, `${parent.map((record) => JSON.stringify(record)).join('\n')}\n`);
  fs.writeFileSync(subFile, `${sub.map((record) => JSON.stringify(record)).join('\n')}\n`);
  fs.utimesSync(parentFile, time, time);
  fs.utimesSync(subFile, time, time);

  return { root, projectRoot, claudeRoot, dshRoot, projectDir };
}

/**
 * Run one function with CLAUDE_CONFIG_DIR and DSH_HOME set on process.env,
 * and with CLAUDE_CODE_SESSION_ID set to "tree.session", or deleted when the
 * tree holds no session. Restore all three values in every case. Claude Code
 * exports CLAUDE_CODE_SESSION_ID to each tool shell, and the Claude reader
 * picks that session with no id, so the variable of the shell never reaches
 * a test.
 *
 * @template T
 * @param {{ claudeRoot: string, dshRoot: string, session?: string }} tree
 * @param {() => T} fn
 * @returns {T}
 */
function withEnv(tree, fn) {
  const saved = {
    CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
    DSH_HOME: process.env.DSH_HOME,
    CLAUDE_CODE_SESSION_ID: process.env.CLAUDE_CODE_SESSION_ID,
    DSH_SESSION_ID: process.env.DSH_SESSION_ID,
    BEAST_MODE_ZSTD: process.env.BEAST_MODE_ZSTD,
  };
  process.env.CLAUDE_CONFIG_DIR = tree.claudeRoot;
  process.env.DSH_HOME = tree.dshRoot;
  delete process.env.DSH_SESSION_ID;
  delete process.env.BEAST_MODE_ZSTD;
  if (typeof tree.session === 'string') process.env.CLAUDE_CODE_SESSION_ID = tree.session;
  else delete process.env.CLAUDE_CODE_SESSION_ID;
  try {
    return fn();
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

test('--help names the transcript usage line and its --out row', () => {
  const result = cli(['--help'], PLUGIN_ROOT);
  assert.equal(result.status, 0);
  const lines = result.out.split('\n').filter((line) => line.includes('beast-mode transcript'));
  assert.deepEqual(lines, [
    'beast-mode transcript [<session-id>] [--out <dir>] [--project <dir>] [--plugin-root <dir>]',
  ]);
  assert.match(result.out, / {24}transcript {16}Write <session-id>\.txt here\./);
});

test('transcript refuses a second positional, --json, --days, and --force with exit 2', () => {
  const tree = createCliTree();
  try {
    withEnv(tree, () => {
      const second = cli(['transcript', 'one', 'two', '--project', tree.projectRoot], tree.projectRoot);
      assert.equal(second.status, 2);
      assert.match(second.err, /The "transcript" command takes one session id at most\./);

      const json = cli(['transcript', '--json', '--project', tree.projectRoot], tree.projectRoot);
      assert.equal(json.status, 2);
      assert.match(json.err, /The "transcript" command takes no "--json" flag\./);

      const days = cli(['transcript', '--days', '3', '--project', tree.projectRoot], tree.projectRoot);
      assert.equal(days.status, 2);
      assert.match(days.err, /The "transcript" command takes no "--days" flag\./);

      const force = cli(['transcript', '--force', '--project', tree.projectRoot], tree.projectRoot);
      assert.equal(force.status, 2);
      assert.match(force.err, /The "transcript" command takes no "--force" flag\./);
    });
  } finally {
    removeFixture(tree.root);
  }
});

test('transcript --out writes <id>.txt and prints the summary lines with the Transcript line', () => {
  const tree = createCliTree();
  try {
    withEnv(tree, () => {
      const outDir = path.join(tree.root, 'out', 'review-session');
      const result = cli(['transcript', '--project', tree.projectRoot, '--out', outDir], tree.projectRoot);
      assert.equal(result.status, 0);
      assert.equal(result.err, '');

      const file = path.join(outDir, 'sess-cli.txt');
      assert.match(result.out, /📜 BEAST MODE SESSION TRANSCRIPT/);
      assert.match(result.out, /Plugin version: {2}\d+\.\d+\.\d+/);
      assert.ok(result.out.includes(`Project:         ${tree.projectRoot}\n`));
      assert.ok(
        result.out.includes('Session:         sess-cli (claude, parent, started 2026-03-01 10:00 UTC)\n')
      );
      assert.ok(result.out.includes('Steps:           4 (1 user messages, 1 errors, 1 subagents)\n'));
      assert.ok(result.out.includes(`Transcript:      ${file}\n`));
      assert.ok(!result.out.includes('# Transcript of session'), 'the output holds the summary alone');

      const text = fs.readFileSync(file, 'utf8');
      assert.deepEqual(text.split('\n'), [
        '# Transcript of session sess-cli',
        'Harness: claude. Kind: parent. Started: 2026-03-01 10:00 UTC. Last write: 2026-03-01 12:00 UTC.',
        'Steps: 4. User messages: 1. Errors: 1. Subagents: 1.',
        'Agent sub-cli-: sub-cli-0001, 1 steps, first step 3.',
        'Times are UTC. One line for each step: the number, the time, the agent, the kind, the tool, the file, the text, and the error.',
        '',
        '1 10:00 main user - - | Fix the bug',
        `2 10:01 main read Read ${path.join('src', 'a.js')} | -`,
        '3 10:02 sub-cli- user - - | Phase 1 brief',
        '4 10:03 main shell Bash - | npm test | error: Exit code 1',
        '',
      ]);

      // A later run of the same session replaces the file.
      const again = cli(['transcript', 'sub-cli', '--project', tree.projectRoot, '--out', outDir], tree.projectRoot);
      assert.equal(again.status, 0);
      assert.match(again.out, /Session: {9}sub-cli-0001 \(claude, subagent, started 2026-03-01 10:02 UTC\)/);
      assert.ok(fs.existsSync(path.join(outDir, 'sub-cli-0001.txt')));
    });
  } finally {
    removeFixture(tree.root);
  }
});

test('transcript with no --out prints the summary lines, one blank line, and the file text', () => {
  const tree = createCliTree();
  try {
    withEnv(tree, () => {
      const result = cli(['transcript', 'sess-cli', '--project', tree.projectRoot], tree.projectRoot);
      assert.equal(result.status, 0);
      assert.ok(!result.out.includes('Transcript:'), 'no Transcript line without --out');
      assert.ok(
        result.out.includes(
          'Steps:           4 (1 user messages, 1 errors, 1 subagents)\n\n# Transcript of session sess-cli\n'
        )
      );
      assert.ok(result.out.endsWith('4 10:03 main shell Bash - | npm test | error: Exit code 1\n'));
    });
  } finally {
    removeFixture(tree.root);
  }
});

test('transcript with no match prints the no-match line, exits 0, and creates no directory', () => {
  const tree = createCliTree();
  try {
    withEnv(tree, () => {
      const outDir = path.join(tree.root, 't');
      const result = cli(
        ['transcript', 'nosuchid', '--project', tree.projectRoot, '--out', outDir],
        tree.projectRoot
      );
      assert.equal(result.status, 0);
      assert.match(
        result.out,
        /ℹ No session log of this project matches "nosuchid"\. Run "beast-mode tokens" to list the session ids\./
      );
      assert.ok(!result.out.includes('Session:'));
      assert.equal(fs.existsSync(outDir), false);

      // A project with no log at all gives the no-session line.
      const other = path.join(tree.root, 'other-project');
      fs.mkdirSync(other);
      const none = cli(['transcript', '--project', other, '--out', outDir], other);
      assert.equal(none.status, 0);
      assert.match(none.out, /ℹ No session log of this project was found\./);
      assert.equal(fs.existsSync(outDir), false);
    });
  } finally {
    removeFixture(tree.root);
  }
});

test('transcript exits 6 when it cannot write the file', () => {
  const tree = createCliTree();
  try {
    withEnv(tree, () => {
      // "--out" names a file, so the directory cannot be created.
      const blocker = path.join(tree.root, 'a-file');
      fs.writeFileSync(blocker, 'x');
      const result = cli(['transcript', '--project', tree.projectRoot, '--out', blocker], tree.projectRoot);
      assert.equal(result.status, 6);
      assert.match(result.err, /The installer CLI could not write the transcript file\./);
    });
  } finally {
    removeFixture(tree.root);
  }
});

test('transcript with no id reads the session of CLAUDE_CODE_SESSION_ID, and an id still wins', () => {
  const tree = createCliTree();
  try {
    // An older parent log of this project. The newer log "sess-cli" belongs
    // to a second live window of Claude Code.
    const older = path.join(tree.projectDir, 'sess-older.jsonl');
    const record = { type: 'user', timestamp: at(5), message: { role: 'user', content: 'Older work' } };
    fs.writeFileSync(older, `${JSON.stringify(record)}\n`);
    const time = new Date('2026-02-01T12:00:00.000Z');
    fs.utimesSync(older, time, time);

    withEnv({ ...tree, session: 'sess-older' }, () => {
      const named = cli(['transcript', '--project', tree.projectRoot], tree.projectRoot);
      assert.equal(named.status, 0);
      assert.ok(
        named.out.includes('Session:         sess-older (claude, parent, started 2026-03-01 10:05 UTC)\n')
      );

      const id = cli(['transcript', 'sess-cli', '--project', tree.projectRoot], tree.projectRoot);
      assert.equal(id.status, 0);
      assert.ok(
        id.out.includes('Session:         sess-cli (claude, parent, started 2026-03-01 10:00 UTC)\n')
      );
    });

    // A variable that names no log falls back to the newest log.
    withEnv({ ...tree, session: 'sess-gone' }, () => {
      const fallback = cli(['transcript', '--project', tree.projectRoot], tree.projectRoot);
      assert.equal(fallback.status, 0);
      assert.ok(
        fallback.out.includes('Session:         sess-cli (claude, parent, started 2026-03-01 10:00 UTC)\n')
      );
    });
  } finally {
    removeFixture(tree.root);
  }
});

test('withEnv() deletes or sets CLAUDE_CODE_SESSION_ID, and restores it with CLAUDE_CONFIG_DIR and DSH_HOME', () => {
  const names = ['CLAUDE_CONFIG_DIR', 'DSH_HOME', 'CLAUDE_CODE_SESSION_ID', 'DSH_SESSION_ID', 'BEAST_MODE_ZSTD'];
  const before = names.map((name) => process.env[name]);
  const tree = createCliTree();
  process.env.DSH_SESSION_ID = 'live-dsh';
  process.env.BEAST_MODE_ZSTD = '/live/zstd';
  const live = ['live-dsh', '/live/zstd'];
  try {
    withEnv(tree, () => {
      assert.equal(process.env.DSH_SESSION_ID, undefined);
      assert.equal(process.env.BEAST_MODE_ZSTD, undefined);
      assert.equal(process.env.CLAUDE_CONFIG_DIR, tree.claudeRoot);
      assert.equal(process.env.DSH_HOME, tree.dshRoot);
      assert.equal(process.env.CLAUDE_CODE_SESSION_ID, undefined);
    });
    assert.deepEqual([process.env.DSH_SESSION_ID, process.env.BEAST_MODE_ZSTD], live);

    withEnv({ ...tree, session: 'sess-cli' }, () => {
      assert.equal(process.env.CLAUDE_CODE_SESSION_ID, 'sess-cli');
    });
  } finally {
    removeFixture(tree.root);
    for (const [index, name] of names.entries()) {
      if (before[index] === undefined) delete process.env[name];
      else process.env[name] = before[index];
    }
  }
  assert.deepEqual(names.map((name) => process.env[name]), before);
});
