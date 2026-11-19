// installer/test/transcript-dsh.test.js
//
// The tests of the transcript mode of the dsh reader of
// installer/readers/dsh.js: each step kind, a fork call, the first result of
// a call, a "plugin" message, a nested subagent, a seeded child, the newest
// pick, the pick of DSH_SESSION_ID and its fallback, an id, a prefix, an
// ambiguous prefix, a header of another path, a line that is not JSON, an
// unread log, a cut last frame, the header read, one read of the committed
// compressed tree, and one run of "beast-mode transcript" on a dsh tree.
//
// Every test but the committed tree test builds its own log tree under
// os.tmpdir() in the real event shape of dsh, sets the times of the logs with
// fs.utimesSync(), and removes the tree. The committed fixture writes a
// "user/message" in another shape, so its read proves the decode path, the
// tool step, and the subagent walk only.
//
// Every read passes an env object that sets DSH_HOME, CLAUDE_CONFIG_DIR, and
// HOME to the temp tree, and the object holds DSH_SESSION_ID only when the
// test sets it. dsh exports DSH_SESSION_ID to each tool shell, so a run
// inside a dsh shell gives the same result as a run in any other shell. No
// test reads the real home directory. The CLI test sets DSH_HOME and
// CLAUDE_CONFIG_DIR on process.env, deletes DSH_SESSION_ID,
// CLAUDE_CODE_SESSION_ID, and BEAST_MODE_ZSTD, and restores all five in a
// finally block.

import assert from 'node:assert/strict';
import cp from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import zlib from 'node:zlib';

import { main } from '../bin/beast-mode.js';
import { findPluginRoot } from '../lib/source.js';
import dsh, { projectKey, transcript } from '../readers/dsh.js';
import { removeFixture } from './helpers.js';

/** The plugin root of this repository, for the CLI test. */
const PLUGIN_ROOT = findPluginRoot(import.meta.dirname);

/** The modification time of a log that a test does not set on purpose. */
const BASE_TIME = new Date('2026-03-01T12:00:00.000Z');

/** The committed fixture tree of the dsh token reader, and its project root. */
const COMMITTED_HOME = path.join(import.meta.dirname, 'fixtures', 'dsh-sessions');
const COMMITTED_ROOT = '/tmp/bm-dsh/project';
const COMMITTED_PARENT_LOG = path.join(
  COMMITTED_HOME,
  'sessions',
  '--tmp-bm-dsh-project--',
  'session-parent-one',
  'session.v3.jsonl.zstd'
);

/** Whether this host holds zlib.zstdDecompressSync, and the zstd command. */
const HAS_ZLIB = typeof zlib.zstdDecompressSync === 'function';
const HAS_COMMAND = hasZstdCommand();

/** The skip message of a test that decodes a compressed log, or false. */
const DECODE_SKIP = HAS_ZLIB || HAS_COMMAND ? false : 'This host holds no zstd decoder at all.';

/** The skip message of a test that writes a compressed log, or false. */
const ENCODE_SKIP =
  typeof zlib.zstdCompressSync === 'function'
    ? false
    : 'This host holds no zlib.zstdCompressSync. Node.js 22.15 and later hold it.';

/** The decode modes of this host, in test order. */
const MODES = [...(HAS_ZLIB ? ['zlib'] : []), ...(HAS_COMMAND ? ['command'] : [])];

/**
 * Whether this host holds the zstd command.
 *
 * @returns {boolean}
 */
function hasZstdCommand() {
  try {
    const run = cp.spawnSync('zstd', ['--version'], { stdio: 'ignore' });
    return !run.error && run.status === 0;
  } catch {
    return false;
  }
}

/**
 * The real path of one target, or the resolved path when it does not exist.
 *
 * @param {string} target
 * @returns {string}
 */
function realPath(target) {
  try {
    return fs.realpathSync(target);
  } catch {
    return path.resolve(target);
  }
}

/**
 * Build one empty home of dsh: a project root, and the matched project
 * directory. dsh writes the key of the path that the session holds, so the
 * key and the "cwd" of each header come from the real path of the root.
 *
 * @returns {{ root: string, projectRoot: string, cwd: string, dshHome: string, projectDir: string, env: Record<string, string> }}
 */
function createTree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bm-transcript-dsh-'));
  const projectRoot = path.join(root, 'project');
  fs.mkdirSync(projectRoot);
  const cwd = realPath(projectRoot);
  const dshHome = path.join(root, 'dsh');
  const projectDir = path.join(dshHome, 'sessions', projectKey(cwd));
  fs.mkdirSync(projectDir, { recursive: true });
  return {
    root,
    projectRoot,
    cwd,
    dshHome,
    projectDir,
    env: { DSH_HOME: dshHome, CLAUDE_CONFIG_DIR: path.join(root, 'claude'), HOME: root },
  };
}

/**
 * The epoch milliseconds of one minute of 10:00 UTC on 2026-03-01.
 *
 * @param {number} minute
 * @returns {number}
 */
function ms(minute) {
  return Date.UTC(2026, 2, 1, 10, minute);
}

/**
 * The same minute as ISO 8601.
 *
 * @param {number} minute
 * @returns {string}
 */
function at(minute) {
  return new Date(ms(minute)).toISOString();
}

/**
 * The header line of one session, with the real fields of dsh. "fields"
 * adds a field or replaces one, and an undefined value removes it.
 *
 * @param {{ cwd: string }} tree
 * @param {string} id
 * @param {Record<string, unknown>} [fields]
 * @returns {Record<string, unknown>}
 */
function header(tree, id, fields = {}) {
  return {
    type: 'session',
    version: 3,
    id,
    createdAt: ms(0),
    cwd: tree.cwd,
    isSeeded: false,
    delegationDepth: 0,
    agentPreset: 'standard',
    ...fields,
  };
}

/**
 * Write one plain session log "session.jsonl" into its own directory, and
 * set its modification time. "fields" holds the header fields, or null for
 * a log with no header. A string event is written as it is, so a test
 * writes a line that is not JSON.
 *
 * @param {{ cwd: string, projectDir: string }} tree
 * @param {string} directory The name of the session directory. It is the header id too.
 * @param {Record<string, unknown> | null} fields
 * @param {(Record<string, unknown> | string)[]} events
 * @param {Date} [time]
 * @param {string} [projectDir] The project directory. Defaults to the matched one.
 * @returns {string} The absolute path of the log.
 */
function writeSession(tree, directory, fields, events, time = BASE_TIME, projectDir = tree.projectDir) {
  const file = path.join(projectDir, directory, 'session.jsonl');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const records = fields === null ? events : [header(tree, directory, fields), ...events];
  const lines = records.map((record) => (typeof record === 'string' ? record : JSON.stringify(record)));
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
  fs.utimesSync(file, time, time);
  return file;
}

/**
 * Write one compressed session log "session.v3.jsonl.zstd" from a list of
 * frames, each frame from a list of lines.
 *
 * @param {{ projectDir: string }} tree
 * @param {string} directory
 * @param {(Record<string, unknown> | string)[][]} frames
 * @returns {void}
 */
function writeFrames(tree, directory, frames) {
  const file = path.join(tree.projectDir, directory, 'session.v3.jsonl.zstd');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const parts = frames.map((lines) =>
    zlib.zstdCompressSync(
      Buffer.from(
        lines.map((line) => `${typeof line === 'string' ? line : JSON.stringify(line)}\n`).join('')
      )
    )
  );
  fs.writeFileSync(file, Buffer.concat(parts));
  fs.utimesSync(file, BASE_TIME, BASE_TIME);
}

/**
 * One "user/message" event. A string content becomes one text block.
 *
 * @param {string | Record<string, unknown>[]} content
 * @param {number} minute
 * @param {string} [kind] The source kind. A typed message holds "user".
 * @returns {Record<string, unknown>}
 */
function said(content, minute, kind = 'user') {
  return {
    type: 'user/message',
    seq: minute,
    time: ms(minute),
    data: {
      id: `message-${minute}`,
      role: 'user',
      content: typeof content === 'string' ? [{ type: 'text', text: content }] : content,
      source: { kind },
    },
  };
}

/**
 * One "assistant/message" event with one "tool-call" block after any extra
 * blocks. An object input becomes its JSON text, a string input stays as the
 * raw text, and an undefined input writes no "arguments" field.
 *
 * @param {string} id The call id.
 * @param {string} name The tool name.
 * @param {unknown} input
 * @param {number} minute
 * @param {Record<string, unknown>[]} [before]
 * @returns {Record<string, unknown>}
 */
function call(id, name, input, minute, before = []) {
  /** @type {Record<string, unknown>} */
  const block = { type: 'tool-call', id, name };
  if (input !== undefined) block.arguments = typeof input === 'string' ? input : JSON.stringify(input);
  return {
    type: 'assistant/message',
    seq: minute,
    time: ms(minute),
    data: {
      turn: 1,
      step: minute,
      message: {
        id: `assistant-${minute}`,
        role: 'assistant',
        source: { model: 'deepseek-v4' },
        content: [...before, block],
      },
      usage: { inputTokens: 10, cacheReadTokens: 90, outputTokens: 5 },
    },
  };
}

/**
 * One "tool/result" event with one "tool-result" block. A string content
 * becomes one text block.
 *
 * @param {string} callId
 * @param {string | Record<string, unknown>[]} content
 * @param {number} minute
 * @param {{ isError?: boolean, noSource?: boolean }} [opts]
 * @returns {Record<string, unknown>}
 */
function result(callId, content, minute, opts = {}) {
  /** @type {Record<string, unknown>} */
  const block = {
    type: 'tool-result',
    toolCallId: callId,
    content: typeof content === 'string' ? [{ type: 'text', text: content }] : content,
  };
  if (opts.isError) block.isError = true;
  return {
    type: 'tool/result',
    seq: minute,
    time: ms(minute),
    data: {
      turn: 1,
      step: minute,
      message: {
        id: `result-${minute}`,
        role: 'user',
        source: opts.noSource ? {} : { kind: 'tool', callId },
        content: [block],
      },
    },
  };
}

/**
 * One "session/end-seed" event. A seeded child writes the tag "inherited" at
 * the end of the events that it copies from its parent. A resume writes a
 * marker with no tag.
 *
 * @param {number} minute
 * @param {boolean} inherited
 * @returns {Record<string, unknown>}
 */
function endSeed(minute, inherited) {
  return { type: 'session/end-seed', seq: minute, time: ms(minute), data: inherited ? { inherited: true } : {} };
}

/**
 * One expected raw step.
 *
 * @param {string} kind
 * @param {string | null} tool
 * @param {string | null} file
 * @param {string} text
 * @param {number} minute
 * @param {string | null} [error]
 */
function step(kind, tool, file, text, minute, error = null) {
  return { at: at(minute), kind, tool, file, text, error };
}

/**
 * Read one transcript of the tree. The env of the read holds DSH_SESSION_ID
 * only when "current" is a string.
 *
 * @param {{ projectRoot: string, env: Record<string, string> }} tree
 * @param {string | null} [sessionId]
 * @param {string | null} [current] The value of DSH_SESSION_ID, or null for no variable.
 */
function readTree(tree, sessionId = null, current = null) {
  /** @type {Record<string, string>} */
  const env = { ...tree.env };
  if (current !== null) env.DSH_SESSION_ID = current;
  return transcript({ projectRoot: tree.projectRoot, sessionId, env });
}

/**
 * The agent ids of one answer, in answer order.
 *
 * @param {{ transcript: Record<string, any> | null }} answer
 * @returns {string[] | undefined}
 */
function agentIds(answer) {
  return answer.transcript?.agents.map((/** @type {{ id: string }} */ agent) => agent.id);
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
    write(/** @type {string} */ text) {
      out += text;
      return true;
    },
    isTTY: false,
  };
  const errSink = {
    write(/** @type {string} */ text) {
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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// The steps of one log
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test('each kind of the kinds table gives one step with its tool, file, and text', () => {
  const tree = createTree();
  try {
    const query = { query: 'x'.repeat(200) };
    const broken = `{"command": "${'y'.repeat(200)}`;
    writeSession(tree, 'session-kinds', {}, [
      said('Fix the login bug', 0),
      call('c1', 'read', { file_path: '/p/src/a.js', offset: 10, limit: 5 }, 1, [
        { type: 'text', text: 'I read the file first.' },
        { type: 'reasoning', text: 'The bug sits in a.js.' },
      ]),
      call('c2', 'read', { file_path: '/p/src/b.js' }, 2),
      call('c3', 'write', { file_path: '/p/src/c.js', content: 'export {};' }, 3),
      call('c4', 'edit', { file_path: '/p/src/a.js', old_string: 'a', new_string: 'b' }, 4),
      call('c5', 'bash', { command: 'npm test', description: 'Run the tests' }, 5),
      call('c6', 'grep', { pattern: 'TODO', path: 'src', include: '*.js' }, 6),
      call('c7', 'glob', { pattern: '**/*.md' }, 7),
      call('c8', 'subagent', { description: 'Build phase 1', prompt: 'Go.', run_in_background: false }, 8),
      call(
        'c9',
        'ask_user_question',
        { questions: [{ id: 'q1', header: 'Fix', question: 'Which fix?', options: [{ label: 'A' }] }, { question: 'Why?' }] },
        9
      ),
      call('c10', 'web_search', query, 10),
      call('c11', 'read', { file_path: '/p/src/d.js', offset: 40 }, 11),
      // Two tool-call blocks of one message give two steps of one time, in block order.
      call('c13', 'grep', { pattern: 'login' }, 12, [
        { type: 'tool-call', id: 'c12', name: 'read', arguments: JSON.stringify({ file_path: '/p/src/e.js', limit: 20 }) },
      ]),
      call('c14', 'bash', '{"command": "npm te', 13),
      call('c15', 'edit', broken, 14),
      call('c16', 'list_agents', undefined, 15),
      call('c17', 'todo_write', { todos: [] }, 16),
    ]);

    const answer = readTree(tree);
    assert.deepEqual(answer.notes, []);

    const other = `${JSON.stringify(query).slice(0, 117)}...`;
    assert.equal(other.length, 120);

    assert.deepEqual(answer.transcript?.agents, [
      {
        id: 'kinds',
        steps: [
          step('user', null, null, 'Fix the login bug', 0),
          step('read', 'read', '/p/src/a.js', 'lines 10-14', 1),
          step('read', 'read', '/p/src/b.js', '', 2),
          step('write', 'write', '/p/src/c.js', '', 3),
          step('edit', 'edit', '/p/src/a.js', '', 4),
          step('shell', 'bash', null, 'npm test', 5),
          step('search', 'grep', null, 'TODO in src', 6),
          step('search', 'glob', null, '**/*.md', 7),
          step('delegate', 'subagent', null, 'Build phase 1', 8),
          step('ask', 'ask_user_question', null, 'Which fix?', 9),
          step('other', 'web_search', null, other, 10),
          step('read', 'read', '/p/src/d.js', 'from line 40', 11),
          step('read', 'read', '/p/src/e.js', 'lines 1-20', 12),
          step('search', 'grep', null, 'login', 12),
          // An "arguments" text that does not parse keeps the raw text, cut to 120 characters.
          step('shell', 'bash', null, '{"command": "npm te', 13),
          step('edit', 'edit', null, `${broken.slice(0, 117)}...`, 14),
          // A call with no "arguments" gives an empty text.
          step('other', 'list_agents', null, '', 15),
          step('other', 'todo_write', null, '{"todos":[]}', 16),
        ],
      },
    ]);
    assert.equal(answer.transcript?.id, 'kinds');
    assert.equal(answer.transcript?.kind, 'parent');
    assert.equal(answer.transcript?.parent, null);
    assert.equal(answer.transcript?.created, at(0));
    assert.equal(answer.transcript?.writtenAt, BASE_TIME.toISOString());
  } finally {
    removeFixture(tree.root);
  }
});

test('a subagent_fork call gives a delegate step, as a subagent call does', () => {
  const tree = createTree();
  try {
    writeSession(tree, 'session-forks', {}, [
      said('Review the fix', 0),
      // The base bundle runs the fork tool one-shot, so the result holds the answer of the child.
      call('f1', 'subagent_fork', { description: 'review the fix', prompt: 'Review it' }, 1),
      result('f1', 'The fix holds.', 2),
      // A preset can run the fork tool continuable, and the result then names the child.
      call('f2', 'subagent_fork', { description: 'check the gate', prompt: 'Check it' }, 3),
      result('f2', 'started subagent session-fork-kid', 4),
    ]);

    const answer = readTree(tree);
    assert.deepEqual(answer.notes, []);
    assert.deepEqual(answer.transcript?.agents, [
      {
        id: 'forks',
        steps: [
          step('user', null, null, 'Review the fix', 0),
          step('delegate', 'subagent_fork', null, 'review the fix', 1),
          step('delegate', 'subagent_fork', null, 'check the gate -> fork-kid', 3),
        ],
      },
    ]);
  } finally {
    removeFixture(tree.root);
  }
});

test('a failed result gives the error, an ask result gives the answer, and only the first result of a call counts', () => {
  const tree = createTree();
  try {
    writeSession(tree, 'session-results', {}, [
      said('Go', 0),
      call('a1', 'ask_user_question', { questions: [{ question: 'Ship it?' }] }, 1),
      result(
        'a1',
        [
          { type: 'text', text: 'The user answered:' },
          { type: 'image', attachment: {} },
          { type: 'text', text: 'Ship it' },
        ],
        2
      ),
      call('b1', 'bash', { command: 'npm test' }, 3),
      result('b1', 'Exit code 1\nFAIL one', 4, { isError: true }),
      call('e1', 'edit', { file_path: '/p/a.js', old_string: 'x', new_string: 'y' }, 5),
      result('e1', [], 6, { isError: true }),
      call('b2', 'bash', { command: 'ls' }, 7),
      result('b2', 'a.js', 8),
      // A compaction appends a second result for one call. It adds nothing.
      result('b2', '[pruned]', 9, { isError: true }),
      call('s1', 'subagent', { description: 'Build phase 1', prompt: 'Go.' }, 10),
      result('s1', 'started subagent session-7f3a9c', 11),
      call('s2', 'subagent', { description: 'Review the code', prompt: 'Go.', run_in_background: false }, 12),
      result('s2', 'Done. All tests pass.', 13),
      call('s3', 'subagent', { description: 'Run it in the background', prompt: 'Go.', run_in_background: true }, 14),
      result('s3', 'started background subagent job job-1', 15),
      // A result for a call that the log does not hold adds nothing.
      result('missing', 'orphan', 16, { isError: true }),
      call('a2', 'ask_user_question', { questions: [{ question: 'Rerun?' }] }, 17),
      result('a2', 'The user dismissed the question.', 18, { isError: true }),
      // A result with no "source.callId" names its call with the "toolCallId" of its block.
      call('w1', 'write', { file_path: '/p/b.js', content: '' }, 19),
      result('w1', 'Permission denied', 20, { isError: true, noSource: true }),
      call('s4', 'subagent', { prompt: 'Go.' }, 21),
      result('s4', 'started subagent 0b1c2d', 22),
      call('s5', 'subagent', { description: 'Go one level deeper', prompt: 'Go.' }, 23),
      result('s5', 'Error: subagent depth limit', 24, { isError: true }),
    ]);

    const answer = readTree(tree);
    assert.deepEqual(answer.notes, []);
    assert.deepEqual(answer.transcript?.agents[0].steps, [
      step('user', null, null, 'Go', 0),
      step('ask', 'ask_user_question', null, 'The user answered:\nShip it', 1),
      step('shell', 'bash', null, 'npm test', 3, 'Exit code 1\nFAIL one'),
      step('edit', 'edit', '/p/a.js', '', 5, '(no text)'),
      step('shell', 'bash', null, 'ls', 7),
      // "started subagent <id>" names the child, with no "session-" prefix.
      step('delegate', 'subagent', null, 'Build phase 1 -> 7f3a9c', 10),
      step('delegate', 'subagent', null, 'Review the code', 12),
      step('delegate', 'subagent', null, 'Run it in the background', 14),
      step('ask', 'ask_user_question', null, 'Rerun?', 17, 'The user dismissed the question.'),
      step('write', 'write', '/p/b.js', '', 19, 'Permission denied'),
      step('delegate', 'subagent', null, '-> 0b1c2d', 21),
      step('delegate', 'subagent', null, 'Go one level deeper', 23, 'Error: subagent depth limit'),
    ]);
  } finally {
    removeFixture(tree.root);
  }
});

test('only a user message from the user gives a step, and every other event gives none', () => {
  const tree = createTree();
  try {
    writeSession(tree, 'session-users', { createdAt: ms(1) }, [
      {
        type: 'system/message',
        seq: 0,
        time: ms(0),
        data: { message: { role: 'system', content: [{ type: 'text', text: 'You are dsh.' }] } },
      },
      said('The plugin context', 0, 'plugin'),
      said('<skills></skills>', 0, 'skill-catalog'),
      said('Fix the login bug', 1),
      said('<skill name="review">body</skill>', 2, 'skill-invocation'),
      said('The child is done.', 3, 'subagent-settled'),
      said('A note from an agent', 4, 'agent-message'),
      // The shape of the committed token fixture names no source, so it gives no step.
      { type: 'user/message', time: ms(5), data: { message: { content: [{ type: 'text', text: 'old shape' }] } } },
      said(
        [
          { type: 'text', text: 'line one' },
          { type: 'image', attachment: {} },
          { type: 'text', text: 'line two' },
        ],
        6
      ),
      said([{ type: 'image', attachment: {} }], 7),
      { type: 'turn/start', seq: 8, time: ms(8), data: { turn: 2 } },
      { type: 'tool/call', seq: 9, time: ms(9), data: { callId: 'x', name: 'bash', arguments: '{}' } },
      {
        type: 'assistant/message',
        seq: 10,
        time: ms(10),
        data: {
          message: {
            role: 'assistant',
            content: [
              { type: 'text', text: 'Hello.' },
              { type: 'reasoning', text: 'Think.' },
            ],
          },
        },
      },
    ]);

    const answer = readTree(tree);
    assert.deepEqual(answer.notes, []);
    assert.deepEqual(answer.transcript?.agents[0].steps, [
      step('user', null, null, 'Fix the login bug', 1),
      step('user', null, null, 'line one\nline two', 6),
      // An image alone gives a user step with an empty text.
      step('user', null, null, '', 7),
    ]);
    // "created" is the "createdAt" field of the header.
    assert.equal(answer.transcript?.created, at(1));
  } finally {
    removeFixture(tree.root);
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// The subagents
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test('a parent brings its subagents at every depth, and a subagent id brings its own subagents', () => {
  const tree = createTree();
  try {
    const child = { origin: 'subagent', delegationDepth: 1 };
    writeSession(tree, 'session-run', {}, [said('Build it', 0)]);
    writeSession(tree, 'kid-a', { ...child, parentSession: 'session-run', createdAt: ms(1) }, [
      said('Phase 1 brief', 1),
      call('k1', 'read', { file_path: '/p/a.js' }, 2),
    ]);
    // One version of dsh writes "parentSession" as an object.
    writeSession(tree, 'grand', { ...child, parentSession: { id: 'kid-a' }, delegationDepth: 2, createdAt: ms(3) }, [
      said('Check the gate', 3),
    ]);
    writeSession(tree, 'kid-b', { ...child, parentSession: 'session-run', createdAt: ms(4) }, [said('Phase 2 brief', 4)]);
    // A subagent of another run, and a subagent whose parent this project does not hold.
    writeSession(tree, 'session-other', {}, [said('Other work', 5)]);
    writeSession(tree, 'other-kid', { ...child, parentSession: 'session-other' }, [said('Other brief', 6)]);
    writeSession(tree, 'orphan', { ...child, parentSession: 'session-gone' }, [said('Lost brief', 7)]);

    const run = readTree(tree, 'run');
    assert.deepEqual(run.notes, []);
    assert.equal(run.transcript?.id, 'run');
    assert.equal(run.transcript?.kind, 'parent');
    assert.equal(run.transcript?.parent, null);
    // Each pass of the walk keeps the directory order, so "grand" comes in the pass after its parent.
    assert.deepEqual(agentIds(run), ['run', 'kid-a', 'kid-b', 'grand']);
    assert.deepEqual(run.transcript?.agents[1].steps, [
      step('user', null, null, 'Phase 1 brief', 1),
      step('read', 'read', '/p/a.js', '', 2),
    ]);

    const kid = readTree(tree, 'kid-a');
    assert.deepEqual(kid.notes, []);
    assert.equal(kid.transcript?.kind, 'subagent');
    assert.equal(kid.transcript?.parent, 'run');
    assert.equal(kid.transcript?.created, at(1));
    assert.deepEqual(agentIds(kid), ['kid-a', 'grand']);

    const grand = readTree(tree, 'grand');
    assert.equal(grand.transcript?.kind, 'subagent');
    assert.equal(grand.transcript?.parent, 'kid-a');
    assert.deepEqual(grand.transcript?.agents, [
      { id: 'grand', steps: [step('user', null, null, 'Check the gate', 3)] },
    ]);
  } finally {
    removeFixture(tree.root);
  }
});

test('a seeded child drops the events that it copies from its parent, up to the last tagged end-seed marker', () => {
  const tree = createTree();
  try {
    const seeded = { origin: 'subagent', isSeeded: true };
    // The completed first turn of the parent. A fork child copies it.
    const turn = [
      said('Fix the bug', 0),
      call('p1', 'read', { file_path: '/p/src/a.js' }, 1),
      result('p1', 'export {};', 1),
      { type: 'turn/end', seq: 1, time: ms(1), data: { turn: 1 } },
    ];
    // The own turn of the fork child. A fork of the fork copies it too.
    const own = [
      said('Review it', 2),
      call('k1', 'read', { file_path: '/p/src/b.js', limit: 5 }, 3),
      result('k1', 'export {};', 3),
      { type: 'turn/end', seq: 3, time: ms(3), data: { turn: 2 } },
    ];
    writeSession(tree, 'session-main', {}, [
      ...turn,
      call('p2', 'subagent_fork', { description: 'review the fix', prompt: 'Review it' }, 2),
      result('p2', 'The fix holds.', 9),
    ]);
    writeSession(tree, 'fork-kid', { ...seeded, parentSession: 'session-main', delegationDepth: 1, createdAt: ms(2) }, [
      ...turn,
      endSeed(2, true),
      ...own,
    ]);
    // The copy of a fork of the fork holds the tagged marker of its parent, so
    // the last tagged marker wins. A resume writes a marker with no tag, and
    // the steps before it stay. The header holds no "createdAt".
    const grandFields = { ...seeded, parentSession: 'fork-kid', delegationDepth: 2, createdAt: undefined };
    writeSession(tree, 'fork-grand', grandFields, [
      ...turn,
      endSeed(2, true),
      ...own,
      endSeed(4, true),
      said('Check the gate', 5),
      call('g1', 'grep', { pattern: 'TODO' }, 6),
      endSeed(7, false),
      call('g2', 'bash', { command: 'npm test' }, 8),
      result('g2', 'Exit code 1', 8, { isError: true }),
    ]);

    const run = readTree(tree, 'main');
    assert.deepEqual(run.notes, []);
    assert.deepEqual(run.transcript?.agents, [
      {
        id: 'main',
        steps: [
          step('user', null, null, 'Fix the bug', 0),
          step('read', 'read', '/p/src/a.js', '', 1),
          step('delegate', 'subagent_fork', null, 'review the fix', 2),
        ],
      },
      {
        id: 'fork-kid',
        steps: [step('user', null, null, 'Review it', 2), step('read', 'read', '/p/src/b.js', 'lines 1-5', 3)],
      },
      {
        id: 'fork-grand',
        steps: [
          step('user', null, null, 'Check the gate', 5),
          step('search', 'grep', null, 'TODO', 6),
          step('shell', 'bash', null, 'npm test', 8, 'Exit code 1'),
        ],
      },
    ]);

    // The marker is the first event of the child, so the time of the first
    // event starts again at the last tagged marker.
    const grand = readTree(tree, 'fork-grand');
    assert.deepEqual(grand.notes, []);
    assert.equal(grand.transcript?.kind, 'subagent');
    assert.equal(grand.transcript?.parent, 'fork-kid');
    assert.equal(grand.transcript?.created, at(4));
    assert.deepEqual(agentIds(grand), ['fork-grand']);
  } finally {
    removeFixture(tree.root);
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// The session pick
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test('with no id, the reader picks the newest log whose header names no parent session', () => {
  const tree = createTree();
  try {
    const january = new Date('2026-01-15T08:00:00.000Z');
    const february = new Date('2026-02-15T08:00:00.000Z');
    const march = new Date('2026-03-15T08:00:00.000Z');

    const alpha = writeSession(tree, 'session-alpha', {}, [said('alpha work', 0)], february);
    const beta = writeSession(tree, 'session-beta', {}, [said('beta work', 1)], january);
    // The newest log of the tree is a subagent log, and a subagent names a parent.
    writeSession(tree, 'beta-sub', { origin: 'subagent', parentSession: 'session-beta' }, [said('beta sub', 2)], march);
    // A newer log with no header names no session, and a lock file is no log.
    writeSession(tree, 'session-headless', null, [said('no header', 3)], march);
    fs.mkdirSync(path.join(tree.projectDir, 'session-locked'));
    fs.writeFileSync(path.join(tree.projectDir, 'session-locked', 'session.lock'), '');

    const first = readTree(tree);
    assert.deepEqual(first.notes, []);
    assert.equal(first.transcript?.id, 'alpha');
    assert.equal(first.transcript?.writtenAt, february.toISOString());
    assert.deepEqual(agentIds(first), ['alpha']);

    // The pick follows the time, not the name.
    fs.utimesSync(alpha, january, january);
    fs.utimesSync(beta, february, february);
    const second = readTree(tree);
    assert.equal(second.transcript?.id, 'beta');
    assert.equal(second.transcript?.writtenAt, february.toISOString());
    assert.deepEqual(agentIds(second), ['beta', 'beta-sub']);
  } finally {
    removeFixture(tree.root);
  }
});

test('with no id, DSH_SESSION_ID picks the run of its session over a newer log, and an id still wins', () => {
  const tree = createTree();
  try {
    const january = new Date('2026-01-15T08:00:00.000Z');
    const march = new Date('2026-03-15T08:00:00.000Z');
    const child = { origin: 'subagent', delegationDepth: 1 };

    writeSession(tree, 'session-running', {}, [said('running work', 0)], january);
    writeSession(tree, 'running-kid', { ...child, parentSession: 'session-running' }, [said('kid work', 1)], january);
    writeSession(tree, 'running-grand', { ...child, parentSession: 'running-kid' }, [said('grand work', 2)], january);
    // A second window of dsh writes a newer log of this project.
    writeSession(tree, 'session-other', {}, [said('other work', 3)], march);

    // With no variable, the newest log wins, and it holds no "current" mark.
    const newest = readTree(tree);
    assert.equal(newest.transcript?.id, 'other');
    assert.notEqual(newest.transcript?.current, true);

    const running = readTree(tree, null, 'session-running');
    assert.deepEqual(running.notes, []);
    // Only the pick through DSH_SESSION_ID marks the answer "current: true".
    assert.equal(running.transcript?.current, true);
    assert.notEqual(readTree(tree, 'running', 'session-running').transcript?.current, true);
    assert.notEqual(readTree(tree, 'other', 'session-running').transcript?.current, true);
    assert.equal(running.transcript?.id, 'running');
    assert.equal(running.transcript?.kind, 'parent');
    assert.equal(running.transcript?.writtenAt, january.toISOString());
    assert.deepEqual(agentIds(running), ['running', 'running-kid', 'running-grand']);

    // The short id names the same session, and the reader trims the value, as it trims an id.
    assert.equal(readTree(tree, null, 'running').transcript?.id, 'running');
    assert.equal(readTree(tree, null, ' session-running ').transcript?.id, 'running');

    // The shell of a subagent holds the id of that subagent. The walk reaches the parent of the run.
    for (const current of ['running-kid', 'running-grand']) {
      const answer = readTree(tree, null, current);
      assert.equal(answer.transcript?.id, 'running', `the value "${current}" names the run of its parent`);
      assert.deepEqual(agentIds(answer), ['running', 'running-kid', 'running-grand']);
    }

    // An exact id and a unique prefix win over the variable.
    assert.equal(readTree(tree, 'other', 'session-running').transcript?.id, 'other');
    assert.equal(readTree(tree, 'oth', 'session-running').transcript?.id, 'other');
    assert.equal(readTree(tree, 'running-kid', 'session-other').transcript?.kind, 'subagent');
  } finally {
    removeFixture(tree.root);
  }
});

test('with no id, a DSH_SESSION_ID that names no run of this project falls back to the newest log', () => {
  const tree = createTree();
  try {
    const january = new Date('2026-01-15T08:00:00.000Z');
    const february = new Date('2026-02-15T08:00:00.000Z');
    const march = new Date('2026-03-15T08:00:00.000Z');
    const child = { origin: 'subagent', delegationDepth: 1 };

    writeSession(tree, 'session-alpha', {}, [said('alpha work', 0)], february);
    writeSession(tree, 'session-beta', {}, [said('beta work', 1)], january);
    writeSession(tree, 'lost', { ...child, parentSession: 'session-gone' }, [said('lost work', 2)], march);
    writeSession(tree, 'loop-a', { ...child, parentSession: 'loop-b' }, [said('loop a', 3)], march);
    writeSession(tree, 'loop-b', { ...child, parentSession: 'loop-a' }, [said('loop b', 4)], march);
    writeSession(tree, 'session-foreign', { cwd: `${tree.cwd}-elsewhere` }, [said('foreign work', 5)], march);
    const theirs = path.join(tree.dshHome, 'sessions', projectKey('/tmp/bm-other/project'));
    writeSession(tree, 'session-theirs', { cwd: '/tmp/bm-other/project' }, [said('their work', 6)], march, theirs);

    // No log of that id, a prefix of a parent id, a subagent whose parent is
    // gone, a loop of parent names, a header of another path, a log of
    // another project, an empty value, and a blank value.
    for (const current of ['no-such-session', 'bet', 'session-bet', 'lost', 'loop-a', 'foreign', 'theirs', '', '   ']) {
      const answer = readTree(tree, null, current);
      assert.equal(answer.transcript?.id, 'alpha', `the value "${current}" falls back to the newest log`);
      assert.equal(answer.transcript?.writtenAt, february.toISOString());
      assert.deepEqual(answer.notes, []);
    }
  } finally {
    removeFixture(tree.root);
  }
});

test('an exact id, with or without the session- prefix, and a unique prefix each pick one session', () => {
  const tree = createTree();
  try {
    writeSession(tree, 'session-abc-111', {}, [said('abc work', 0)]);
    writeSession(tree, 'session-abd-222', {}, [said('abd work', 1)]);
    writeSession(tree, 'zz-sub', { origin: 'subagent', parentSession: 'session-abd-222' }, [said('zz work', 2)]);
    writeSession(tree, 'xyz', {}, [said('xyz work', 3)]);
    writeSession(tree, 'xyz-long', {}, [said('xyz long work', 4)]);
    // dsh escapes an unsafe character of an id in the directory name. The token report prints the header id.
    writeSession(tree, 'session-odd~0020id', { id: 'session-odd id' }, [said('odd work', 5)]);

    for (const wanted of ['abd-222', 'session-abd-222']) {
      const answer = readTree(tree, wanted);
      assert.equal(answer.transcript?.id, 'abd-222', `the id "${wanted}"`);
      assert.deepEqual(agentIds(answer), ['abd-222', 'zz-sub']);
    }

    // A text that equals no id matches as a prefix when one id starts with it.
    assert.equal(readTree(tree, 'abc').transcript?.id, 'abc-111');
    assert.equal(readTree(tree, 'session-abc').transcript?.id, 'abc-111');
    assert.equal(readTree(tree, ' abc-1 ').transcript?.id, 'abc-111');

    const sub = readTree(tree, 'zz');
    assert.equal(sub.transcript?.id, 'zz-sub');
    assert.equal(sub.transcript?.kind, 'subagent');
    assert.equal(sub.transcript?.parent, 'abd-222');

    // An exact id wins over the ids that start with it.
    assert.equal(readTree(tree, 'xyz').transcript?.id, 'xyz');

    // The printed id and the directory name each name the escaped session.
    assert.equal(readTree(tree, 'odd id').transcript?.id, 'odd id');
    assert.equal(readTree(tree, 'odd~0020id').transcript?.id, 'odd id');

    // A text that names no id gives no transcript and no note. The core
    // prints the line of that state.
    assert.deepEqual(readTree(tree, 'nope'), { transcript: null, notes: [] });
  } finally {
    removeFixture(tree.root);
  }
});

test('an ambiguous prefix gives no transcript and one note with up to five ids, newest first', () => {
  const tree = createTree();
  try {
    for (let index = 1; index <= 6; index += 1) {
      const time = new Date(Date.UTC(2026, 0, index, 8));
      writeSession(tree, `session-run-${index}`, {}, [said(`run ${index}`, index)], time);
    }

    assert.deepEqual(readTree(tree, 'run-'), {
      transcript: null,
      notes: ['The id "run-" matches more than one session: run-6, run-5, run-4, run-3, run-2.'],
    });

    // A parent and a subagent can share a prefix, and the note lists both.
    writeSession(tree, 'session-q-parent', {}, [said('q', 1)], new Date('2026-02-01T00:00:00.000Z'));
    writeSession(
      tree,
      'q-sub',
      { origin: 'subagent', parentSession: 'session-q-parent' },
      [said('q sub', 2)],
      new Date('2026-02-02T00:00:00.000Z')
    );
    assert.deepEqual(readTree(tree, 'q-').notes, [
      'The id "q-" matches more than one session: q-sub, q-parent.',
    ]);
  } finally {
    removeFixture(tree.root);
  }
});

test('a header of another path gives no session, and its id matches nothing', () => {
  const tree = createTree();
  try {
    writeSession(tree, 'session-mine', {}, [said('my work', 0)], new Date('2026-01-01T00:00:00.000Z'));

    // Two paths can share one directory key: a separator and a "-" both
    // give "-". The newer log of the matched directory names the other path.
    const later = new Date('2026-06-01T00:00:00.000Z');
    const near = tree.cwd.replace(/[/\\]project$/, '-project');
    assert.equal(projectKey(near), projectKey(tree.cwd));
    writeSession(tree, 'session-foreign', { cwd: near }, [said('foreign work', 1)], later);

    // A newer log of another project directory.
    const theirs = path.join(tree.dshHome, 'sessions', projectKey('/tmp/bm-other/project'));
    writeSession(tree, 'session-theirs', { cwd: '/tmp/bm-other/project' }, [said('their work', 2)], later, theirs);

    const answer = readTree(tree);
    assert.equal(answer.transcript?.id, 'mine');
    assert.deepEqual(answer.notes, []);
    assert.ok(!JSON.stringify(answer).includes('foreign'), 'the answer names no log of the other path');

    assert.deepEqual(readTree(tree, 'foreign'), { transcript: null, notes: [] });
    assert.deepEqual(readTree(tree, 'theirs'), { transcript: null, notes: [] });
  } finally {
    removeFixture(tree.root);
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// The notes and the header read
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test('each line that is not JSON adds to one note, and each log that the reader cannot read adds to another', () => {
  const tree = createTree();
  try {
    writeSession(tree, 'session-bad', {}, [
      said('Start', 0),
      '{"type":"user/message", "broken',
      'not json at all',
      call('t1', 'bash', { command: 'ls' }, 1),
    ]);
    writeSession(tree, 'bad-kid', { origin: 'subagent', parentSession: 'session-bad' }, ['{', said('Sub start', 2)]);
    // A compressed log of bytes that start no zstd frame. No decode method reads it.
    const broken = path.join(tree.projectDir, 'session-broken');
    fs.mkdirSync(broken);
    fs.writeFileSync(path.join(broken, 'session.v3.jsonl.zstd'), Buffer.from('not a zstd frame'));

    const answer = readTree(tree, 'bad');
    assert.deepEqual(answer.notes, [
      'The reader skipped 3 lines of the log that are not JSON.',
      'The reader could not read 1 log files.',
    ]);
    assert.deepEqual(answer.transcript?.agents, [
      { id: 'bad', steps: [step('user', null, null, 'Start', 0), step('shell', 'bash', null, 'ls', 1)] },
      { id: 'bad-kid', steps: [step('user', null, null, 'Sub start', 2)] },
    ]);
  } finally {
    removeFixture(tree.root);
  }
});

test('a cut last frame keeps the steps of the complete frames, and the cut frame adds to the skipped-lines note', {
  skip: ENCODE_SKIP,
}, () => {
  const tree = createTree();
  try {
    // A session that crashes ends inside its last frame. The cut keeps the
    // header frame and the body frame whole.
    writeFrames(tree, 'session-torn', [
      [header(tree, 'session-torn')],
      [said('Before the crash', 1), call('t1', 'bash', { command: 'npm test' }, 2)],
      [result('t1', 'Exit code 1', 3, { isError: true }), said('Lost work', 4)],
    ]);
    const file = path.join(tree.projectDir, 'session-torn', 'session.v3.jsonl.zstd');
    fs.truncateSync(file, fs.statSync(file).size - 4);
    fs.utimesSync(file, BASE_TIME, BASE_TIME);

    for (const mode of MODES) {
      const env = { ...tree.env, BEAST_MODE_ZSTD: mode };
      assert.deepEqual(transcript({ projectRoot: tree.projectRoot, sessionId: null, env }), {
        transcript: {
          id: 'torn',
          kind: 'parent',
          parent: null,
          created: at(0),
          writtenAt: BASE_TIME.toISOString(),
          agents: [
            {
              id: 'torn',
              steps: [step('user', null, null, 'Before the crash', 1), step('shell', 'bash', null, 'npm test', 2)],
            },
          ],
        },
        notes: ['The reader skipped 1 lines of the log that are not JSON.'],
      }, `the mode "${mode}"`);

      // The token mode keeps its rule: a torn log is an unread log.
      const tokens = dsh.read({ projectRoot: tree.projectRoot, days: null, env });
      assert.deepEqual(tokens.sessions, [], `the mode "${mode}"`);
      assert.deepEqual(tokens.notes, ['The reader could not read 1 log files.'], `the mode "${mode}"`);
    }
  } finally {
    removeFixture(tree.root);
  }
});

test('the header read takes the start of a plain log, and the whole log when the start holds no header', () => {
  const tree = createTree();
  try {
    // A header line longer than the start that the read takes.
    writeSession(tree, 'session-wide', { padding: 'w'.repeat(70 * 1024) }, [said('wide work', 0)]);
    // A first line that is not JSON, then the header.
    writeSession(tree, 'session-late', null, [
      'not json',
      header(tree, 'session-late', { createdAt: ms(1) }),
      said('late work', 1),
    ]);
    // A short log and a long log with no header at all.
    writeSession(tree, 'session-bare', null, [said('bare work', 2)]);
    writeSession(tree, 'session-bare-long', null, [said('b'.repeat(70 * 1024), 3)]);
    // A header with no "createdAt" takes the time of the first event.
    writeSession(tree, 'session-undated', { createdAt: undefined }, [said('undated work', 4)]);

    const wide = readTree(tree, 'wide');
    assert.deepEqual(wide.notes, []);
    assert.deepEqual(wide.transcript?.agents, [
      { id: 'wide', steps: [step('user', null, null, 'wide work', 0)] },
    ]);

    const late = readTree(tree, 'late');
    assert.deepEqual(late.notes, ['The reader skipped 1 lines of the log that are not JSON.']);
    assert.equal(late.transcript?.created, at(1));
    assert.deepEqual(late.transcript?.agents, [
      { id: 'late', steps: [step('user', null, null, 'late work', 1)] },
    ]);

    assert.deepEqual(readTree(tree, 'bare'), { transcript: null, notes: [] });
    assert.deepEqual(readTree(tree, 'bare-long'), { transcript: null, notes: [] });
    assert.equal(readTree(tree, 'undated').transcript?.created, at(4));
  } finally {
    removeFixture(tree.root);
  }
});

test('the header read decodes the first frame of a compressed log, and the whole log when that frame holds no header', {
  skip: ENCODE_SKIP,
}, () => {
  const tree = createTree();
  try {
    // dsh writes the header alone into the first frame.
    writeFrames(tree, 'session-framed', [
      [header(tree, 'session-framed')],
      [said('framed work', 1), call('f1', 'bash', { command: 'git status' }, 2)],
    ]);
    // A first frame that holds a line that is not JSON and no header.
    writeFrames(tree, 'session-odd', [['not json'], [header(tree, 'session-odd'), said('odd work', 3)]]);

    for (const mode of MODES) {
      const env = { ...tree.env, BEAST_MODE_ZSTD: mode };
      const framed = transcript({ projectRoot: tree.projectRoot, sessionId: 'framed', env });
      assert.deepEqual(framed, {
        transcript: {
          id: 'framed',
          kind: 'parent',
          parent: null,
          created: at(0),
          writtenAt: BASE_TIME.toISOString(),
          agents: [
            {
              id: 'framed',
              steps: [step('user', null, null, 'framed work', 1), step('shell', 'bash', null, 'git status', 2)],
            },
          ],
        },
        notes: [],
      }, `the mode "${mode}"`);

      const odd = transcript({ projectRoot: tree.projectRoot, sessionId: 'odd', env });
      assert.deepEqual(odd.notes, ['The reader skipped 1 lines of the log that are not JSON.'], `the mode "${mode}"`);
      assert.deepEqual(odd.transcript?.agents, [{ id: 'odd', steps: [step('user', null, null, 'odd work', 3)] }]);
    }

    // With the decode method "none", the reader reads no compressed log.
    const none = transcript({
      projectRoot: tree.projectRoot,
      sessionId: 'framed',
      env: { ...tree.env, BEAST_MODE_ZSTD: 'none' },
    });
    assert.deepEqual(none, { transcript: null, notes: ['The reader could not read 2 log files.'] });
  } finally {
    removeFixture(tree.root);
  }
});

test('a project with no session, a home with no sessions directory, and a call with no project root give no transcript', () => {
  const tree = createTree();
  try {
    assert.deepEqual(readTree(tree), { transcript: null, notes: [] });
    assert.deepEqual(readTree(tree, 'any-id', 'session-any'), { transcript: null, notes: [] });

    const bare = { ...tree, env: { ...tree.env, DSH_HOME: path.join(tree.root, 'absent') } };
    assert.deepEqual(readTree(bare), { transcript: null, notes: [] });

    const note = 'The caller named no project root, so the reader read no session log of dsh.';
    assert.deepEqual(transcript({ projectRoot: '  ', sessionId: null, env: tree.env }), {
      transcript: null,
      notes: [note],
    });
    assert.deepEqual(transcript(), { transcript: null, notes: [note] });
  } finally {
    removeFixture(tree.root);
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// The committed tree, the export, and the CLI
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test('the committed compressed tree gives the tool step of parent-one and its two subagents', {
  skip: DECODE_SKIP,
}, () => {
  const writtenAt = new Date(fs.statSync(COMMITTED_PARENT_LOG).mtimeMs).toISOString();

  for (const mode of MODES) {
    const env = { DSH_HOME: COMMITTED_HOME, BEAST_MODE_ZSTD: mode };
    const parent = transcript({ projectRoot: COMMITTED_ROOT, sessionId: 'parent-one', env });
    assert.deepEqual(parent, {
      transcript: {
        id: 'parent-one',
        kind: 'parent',
        parent: null,
        created: '2025-09-18T00:00:00.000Z',
        writtenAt,
        agents: [
          // The call names "read_file" with no "arguments", its events carry
          // no time, and its result holds a text block and no "tool-result"
          // block. The fixture holds no tool call in a subagent.
          {
            id: 'parent-one',
            steps: [{ at: null, kind: 'other', tool: 'read_file', file: null, text: '', error: null }],
          },
          { id: 'sub-one', steps: [] },
          { id: 'sub-two', steps: [] },
        ],
      },
      notes: ['The reader skipped 1 lines of the log that are not JSON.'],
    }, `the mode "${mode}"`);

    const sub = transcript({ projectRoot: COMMITTED_ROOT, sessionId: 'sub-two', env });
    assert.equal(sub.transcript?.kind, 'subagent');
    assert.equal(sub.transcript?.parent, 'parent-one');
    assert.deepEqual(sub.transcript?.agents, [{ id: 'sub-two', steps: [] }]);

    // The empty session writes a user message with no source, so it holds no step.
    const empty = transcript({ projectRoot: COMMITTED_ROOT, sessionId: 'empty', env });
    assert.equal(empty.transcript?.created, '2025-09-18T00:03:00.000Z');
    assert.deepEqual(empty.transcript?.agents, [{ id: 'empty', steps: [] }]);

    // The header of session-foreign names another path, so its id matches nothing.
    assert.deepEqual(transcript({ projectRoot: COMMITTED_ROOT, sessionId: 'foreign', env }), {
      transcript: null,
      notes: [],
    });
  }
});

test('the default export carries transcript() beside the token members', () => {
  assert.equal(dsh.transcript, transcript);
  assert.equal(typeof dsh.read, 'function');
  assert.equal(typeof dsh.available, 'function');
});

test('beast-mode transcript reads a dsh session the same way as a Claude Code session', {
  skip: DECODE_SKIP,
}, () => {
  const tree = createTree();
  const names = ['DSH_HOME', 'CLAUDE_CONFIG_DIR', 'DSH_SESSION_ID', 'CLAUDE_CODE_SESSION_ID', 'BEAST_MODE_ZSTD'];
  /** @type {Record<string, string | undefined>} */
  const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    writeSession(tree, 'session-cli-run', {}, [
      said('Fix the bug', 0),
      call('t1', 'read', { file_path: path.join(tree.projectRoot, 'src', 'a.js') }, 1),
      call('t2', 'subagent', { description: 'Run the gate', prompt: 'Go.' }, 2),
      result('t2', 'started subagent 4c5d6e7f-0001', 3),
      call('t3', 'bash', { command: 'npm test' }, 5),
      result('t3', 'Exit code 1', 6, { isError: true }),
    ]);
    writeSession(
      tree,
      '4c5d6e7f-0001',
      { origin: 'subagent', delegationDepth: 1, parentSession: 'session-cli-run', createdAt: ms(3) },
      [said('Run the gate', 3), call('g1', 'grep', { pattern: 'TODO' }, 4)]
    );

    process.env.DSH_HOME = tree.dshHome;
    process.env.CLAUDE_CONFIG_DIR = path.join(tree.root, 'claude');
    for (const name of ['DSH_SESSION_ID', 'CLAUDE_CODE_SESSION_ID', 'BEAST_MODE_ZSTD']) {
      delete process.env[name];
    }

    const outDir = path.join(tree.root, 'out');
    const run = cli(['transcript', '--project', tree.projectRoot, '--out', outDir], tree.projectRoot);
    assert.equal(run.status, 0);
    assert.equal(run.err, '');

    const file = path.join(outDir, 'cli-run.txt');
    assert.ok(run.out.includes('Session:         cli-run (dsh, parent, started 2026-03-01 10:00 UTC)\n'));
    assert.ok(run.out.includes('Steps:           6 (1 user messages, 1 errors, 1 subagents)\n'));
    assert.ok(run.out.includes(`Transcript:      ${file}\n`));

    assert.deepEqual(fs.readFileSync(file, 'utf8').split('\n'), [
      '# Transcript of session cli-run',
      'Harness: dsh. Kind: parent. Started: 2026-03-01 10:00 UTC. Last write: 2026-03-01 12:00 UTC.',
      'Steps: 6. User messages: 1. Errors: 1. Subagents: 1.',
      'Agent 4c5d6e7f: 4c5d6e7f-0001, 2 steps, first step 4.',
      'Times are UTC. One line for each step: the number, the time, the agent, the kind, the tool, the file, the text, and the error.',
      '',
      '1 10:00 main user - - | Fix the bug',
      '2 10:01 main read read src/a.js | -',
      '3 10:02 main delegate subagent - | Run the gate -> 4c5d6e7f-0001',
      '4 10:03 4c5d6e7f user - - | Run the gate',
      '5 10:04 4c5d6e7f search grep - | TODO',
      '6 10:05 main shell bash - | npm test | error: Exit code 1',
      '',
    ]);

    // The shell of the subagent holds its id. The command reads the run of its parent.
    process.env.DSH_SESSION_ID = '4c5d6e7f-0001';
    const current = cli(['transcript', '--project', tree.projectRoot], tree.projectRoot);
    assert.equal(current.status, 0);
    assert.ok(current.out.includes('Session:         cli-run (dsh, parent, started 2026-03-01 10:00 UTC)\n'));

    // An id of the subagent reads the subagent alone.
    const sub = cli(['transcript', '4c5d', '--project', tree.projectRoot], tree.projectRoot);
    assert.equal(sub.status, 0);
    assert.ok(sub.out.includes('Session:         4c5d6e7f-0001 (dsh, subagent, started 2026-03-01 10:03 UTC)\n'));
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    removeFixture(tree.root);
  }
});
