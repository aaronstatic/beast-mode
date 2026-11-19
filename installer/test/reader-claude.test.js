// installer/test/reader-claude.test.js
//
// The tests of the Claude Code token reader of installer/readers/claude.js:
// the two sessions and their exact numbers, the request that holds three
// records, the log of another project, the log with no request, the cost
// value, the note of the skipped lines, the availability check, the trailing
// slash of the project root, and the window.
//
// Every test sets CLAUDE_CONFIG_DIR to the fixture log tree of
// test/fixtures/claude-logs, and every test names the project root
// "/tmp/bm-fixture/project". No test reads the real home directory, no test
// writes a file, and no test needs a real run of Claude Code.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import claude, { available, read } from '../readers/claude.js';

/** The fixture log tree. It stands in for the configuration root of Claude Code. */
const CONFIG_ROOT = path.join(import.meta.dirname, 'fixtures', 'claude-logs');

/** The environment of every read. CLAUDE_CONFIG_DIR wins over HOME. */
const ENV = { CLAUDE_CONFIG_DIR: CONFIG_ROOT };

/** The project of the fixture logs. The log directory name encodes this path. */
const PROJECT_ROOT = '/tmp/bm-fixture/project';

/** The note of section 3.6. The fixture holds one line that is not JSON. */
const SKIPPED_NOTE = 'The reader skipped 1 lines of the log that are not JSON.';

/** The whole parent session of session-one.jsonl. */
const PARENT = {
  id: 'session-one',
  kind: 'parent',
  parent: null,
  model: 'claude-opus-5',
  steps: 3,
  finalPromptTokens: 3330,
  promptTokens: 6710,
  cacheReadTokens: 6000,
  outputTokens: 100,
  created: '2026-01-05T09:00:00.000Z',
  costUsd: 1.25,
};

/** The whole subagent session of session-one/subagents/agent-sub-one.jsonl. */
const SUBAGENT = {
  id: 'sub-one',
  kind: 'subagent',
  parent: 'session-one',
  model: 'claude-sonnet-5',
  steps: 2,
  finalPromptTokens: 777,
  promptTokens: 1332,
  cacheReadTokens: 1200,
  outputTokens: 20,
  created: '2026-01-05T09:10:00.000Z',
  costUsd: null,
};

/**
 * Read the fixture project.
 *
 * @param {{ projectRoot?: string, days?: number | null }} [opts]
 * @returns {{ sessions: Record<string, any>[], notes: string[] }}
 */
function readFixture(opts = {}) {
  return read({
    projectRoot: opts.projectRoot ?? PROJECT_ROOT,
    days: opts.days ?? null,
    env: ENV,
  });
}

/**
 * The ids of an answer, in answer order.
 *
 * @param {{ sessions: Record<string, any>[] }} answer
 * @returns {string[]}
 */
function ids(answer) {
  return answer.sessions.map((session) => session.id);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// The sessions and the numbers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test('the reader returns the parent and its subagent with the exact numbers of the plan', () => {
  const answer = readFixture();

  // The parent comes first, and the subagents of that parent follow it.
  assert.deepEqual(ids(answer), ['session-one', 'sub-one']);
  assert.deepEqual(answer.sessions[0], PARENT);
  assert.deepEqual(answer.sessions[1], SUBAGENT);
});

test('the three records of one request count as one step', () => {
  const parent = readFixture().sessions[0];

  // session-one.jsonl holds five assistant records over three requests. The
  // records a-1, a-2, and a-3 all carry the key "req-1".
  assert.equal(parent.steps, 3);

  // The first record of req-1 owns input_tokens and cache_read_input_tokens,
  // so req-1 contributes 10 + 150 + 1000 prompt tokens. A sum of the three
  // records, and a max over them, both break this total.
  assert.equal(parent.promptTokens, 1160 + 2220 + 3330);

  // A later record of req-1 raises output_tokens from 5 to 40 to 60, and the
  // step keeps the largest value.
  assert.equal(parent.outputTokens, 60 + 15 + 25);
});

test('the reader names no log of another project, and no log with no request', () => {
  const answer = readFixture();
  const text = JSON.stringify(answer);

  // -tmp-bm-fixture-other/session-other.jsonl sits beside the matched
  // directory, and it carries 9000 tokens of each kind.
  assert.ok(!text.includes('session-other'), 'the answer names no session of the other project');
  assert.ok(!text.includes('9000'), 'the answer carries no number of the other project');
  assert.ok(!text.includes('99.99'), 'the answer carries no cost of the other project');

  // session-empty.jsonl holds a user record and a summary record only.
  assert.ok(!ids(answer).includes('session-empty'), 'a log with no request gives no session');
});

test('the reader reports the cost of the parent, and null for the subagent', () => {
  const answer = readFixture();

  // The cost-state record of session-one.jsonl names 1.25 US dollars.
  assert.equal(answer.sessions[0].costUsd, 1.25);

  // The subagent log holds no cost-state record.
  assert.equal(answer.sessions[1].costUsd, null);
});

test('one note names the count of the lines that are not JSON', () => {
  const answer = readFixture();

  assert.deepEqual(answer.notes, [SKIPPED_NOTE]);
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// The project match and the window
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test('a trailing slash of the project root changes no answer', () => {
  const plain = readFixture();
  const slash = readFixture({ projectRoot: `${PROJECT_ROOT}/` });

  assert.deepEqual(slash, plain);
});

test('a project with no log directory gives no session and one note', () => {
  const answer = readFixture({ projectRoot: '/tmp/bm-fixture/absent' });

  assert.deepEqual(answer.sessions, []);
  assert.equal(answer.notes.length, 1);
  assert.match(answer.notes[0], /No log directory of Claude Code matches this project\./);
  assert.match(answer.notes[0], /-tmp-bm-fixture-absent/);
});

test('the window drops the sessions outside it, and it keeps the note of the skipped lines', () => {
  // The fixture logs carry the timestamps of January 2026, so a window of one
  // day holds no session of the tree.
  const near = readFixture({ days: 1 });
  assert.deepEqual(near.sessions, []);

  // The parser reads the whole log before read() applies the window, so the
  // note still names the skipped line.
  assert.deepEqual(near.notes, [SKIPPED_NOTE]);

  // A window of 100000 days reaches back over two centuries.
  const wide = readFixture({ days: 100000 });
  assert.deepEqual(ids(wide), ['session-one', 'sub-one']);
  assert.deepEqual(wide.sessions[0], PARENT);
  assert.deepEqual(wide.sessions[1], SUBAGENT);
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// The availability check and the module shape
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test('available() reports ok for the fixture tree, and not ok for a root with no projects directory', () => {
  assert.deepEqual(available({ env: ENV }), { ok: true });

  // HOME names the fallback root, and that root holds no projects directory.
  const home = path.join(CONFIG_ROOT, 'no-such-home');
  const answer = available({ env: { HOME: home } });
  assert.equal(answer.ok, false);
  assert.match(answer.reason, /Claude Code wrote no log directory at/);
  assert.match(answer.reason, /no-such-home/);
  assert.match(answer.fix, /CLAUDE_CONFIG_DIR/);

  // CLAUDE_CONFIG_DIR wins over HOME, so the same HOME still reports ok.
  assert.deepEqual(available({ env: { CLAUDE_CONFIG_DIR: CONFIG_ROOT, HOME: home } }), {
    ok: true,
  });
});

test('the reader imports node:fs, node:os, and node:path only', () => {
  const file = path.join(import.meta.dirname, '..', 'readers', 'claude.js');
  const source = fs.readFileSync(file, 'utf8');
  const imported = [...source.matchAll(/^import .+ from '(.+)';$/gm)].map((match) => match[1]);

  assert.deepEqual(imported, ['node:fs', 'node:os', 'node:path']);

  // The default export carries the three fields of the reader contract.
  assert.equal(claude.id, 'claude');
  assert.equal(claude.available, available);
  assert.equal(claude.read, read);
});
