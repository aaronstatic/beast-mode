// installer/test/transcript-claude.test.js
//
// The tests of the transcript mode of the Claude Code reader of
// installer/readers/claude.js: each step kind, the error and the answer of a
// tool result, a meta record, a slash command, a repeated block, the
// subagent merge, the newest pick, the pick of CLAUDE_CODE_SESSION_ID and its
// fallback, an id, a prefix, an ambiguous prefix, a log of another project,
// and a line that is not JSON.
//
// Every test builds its own log tree under os.tmpdir(), sets the times of
// the logs with fs.utimesSync(), and removes the tree. Every read passes an
// env object that sets CLAUDE_CONFIG_DIR, DSH_HOME, and HOME to the temp
// tree, so no test reads the real home directory, and no test changes
// process.env. No test reads a committed fixture log.
//
// The env object of a read holds CLAUDE_CODE_SESSION_ID only when the test
// sets it, and readTree() deletes it from every other read. Claude Code
// exports the variable to each tool shell, so a run inside a Claude Code
// shell gives the same result as a run in any other shell.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import claude, { transcript } from '../readers/claude.js';
import { removeFixture } from './helpers.js';

/** The modification time of a log that a test does not set on purpose. */
const BASE_TIME = new Date('2026-03-01T12:00:00.000Z');

/**
 * The match key of Claude Code: every character of a path that is not a
 * letter and not a digit becomes "-".
 *
 * @param {string} text
 * @returns {string}
 */
function encodeKey(text) {
  return text.replace(/[^A-Za-z0-9]/g, '-');
}

/**
 * Build one empty log tree: a project root, and the configuration root of
 * Claude Code with the matched project directory.
 *
 * @returns {{ root: string, projectRoot: string, configRoot: string, projectDir: string, env: Record<string, string> }}
 */
function createTree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bm-transcript-claude-'));
  const projectRoot = path.join(root, 'project');
  fs.mkdirSync(projectRoot);
  const configRoot = path.join(root, 'claude');
  const projectDir = path.join(configRoot, 'projects', encodeKey(path.resolve(projectRoot)));
  fs.mkdirSync(projectDir, { recursive: true });
  return {
    root,
    projectRoot,
    configRoot,
    projectDir,
    env: { CLAUDE_CONFIG_DIR: configRoot, DSH_HOME: path.join(root, 'dsh'), HOME: root },
  };
}

/**
 * Write one JSONL log and set its modification time. A string record is
 * written as it is, so a test writes a line that is not JSON.
 *
 * @param {string} file
 * @param {(Record<string, unknown> | string)[]} records
 * @param {Date} [time]
 * @returns {void}
 */
function writeLog(file, records, time = BASE_TIME) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lines = records.map((record) => (typeof record === 'string' ? record : JSON.stringify(record)));
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
  fs.utimesSync(file, time, time);
}

/**
 * @param {{ projectDir: string }} tree
 * @param {string} id
 * @returns {string}
 */
function parentFile(tree, id) {
  return path.join(tree.projectDir, `${id}.jsonl`);
}

/**
 * @param {{ projectDir: string }} tree
 * @param {string} parentId
 * @param {string} id
 * @returns {string}
 */
function subagentFile(tree, parentId, id) {
  return path.join(tree.projectDir, parentId, 'subagents', `agent-${id}.jsonl`);
}

/**
 * The timestamp of one record, at one minute of 10:00 UTC on 2026-03-01.
 *
 * @param {number} minute
 * @returns {string}
 */
function at(minute) {
  return `2026-03-01T10:${String(minute).padStart(2, '0')}:00.000Z`;
}

/**
 * One user record with a typed message.
 *
 * @param {unknown} content A string, or a list of blocks.
 * @param {number} minute
 * @param {Record<string, unknown>} [extra]
 */
function said(content, minute, extra = {}) {
  return { type: 'user', timestamp: at(minute), message: { role: 'user', content }, ...extra };
}

/**
 * One assistant record with one tool_use block, after any extra blocks.
 *
 * @param {string} id
 * @param {string} name
 * @param {unknown} input
 * @param {number} minute
 * @param {Record<string, unknown>[]} [before]
 */
function call(id, name, input, minute, before = []) {
  return {
    type: 'assistant',
    timestamp: at(minute),
    message: { role: 'assistant', content: [...before, { type: 'tool_use', id, name, input }] },
  };
}

/**
 * One user record with one tool_result block.
 *
 * @param {string} id The tool_use id.
 * @param {unknown} content
 * @param {number} minute
 * @param {{ isError?: boolean, toolUseResult?: unknown }} [opts]
 */
function result(id, content, minute, opts = {}) {
  /** @type {Record<string, unknown>} */
  const block = { type: 'tool_result', tool_use_id: id, content };
  if (opts.isError) block.is_error = true;
  /** @type {Record<string, unknown>} */
  const record = { type: 'user', timestamp: at(minute), message: { role: 'user', content: [block] } };
  if (opts.toolUseResult !== undefined) record.toolUseResult = opts.toolUseResult;
  return record;
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
 * Read one transcript of the tree. The env of the read sets
 * CLAUDE_CODE_SESSION_ID to "current", or it deletes the variable when
 * "current" is null.
 *
 * @param {{ projectRoot: string, env: Record<string, string> }} tree
 * @param {string | null} [sessionId]
 * @param {string | null} [current] The value of CLAUDE_CODE_SESSION_ID, or null to delete it.
 */
function readTree(tree, sessionId = null, current = null) {
  /** @type {Record<string, string>} */
  const env = { ...tree.env };
  if (current === null) delete env.CLAUDE_CODE_SESSION_ID;
  else env.CLAUDE_CODE_SESSION_ID = current;
  return transcript({ projectRoot: tree.projectRoot, sessionId, env });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// The steps of one log
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test('each kind of the kinds table gives one step with its tool, file, and text', () => {
  const tree = createTree();
  try {
    writeLog(parentFile(tree, 'sess-kinds'), [
      said('Fix the login bug', 0),
      call('t1', 'Read', { file_path: '/p/src/a.js', offset: 10, limit: 5 }, 1, [
        { type: 'text', text: 'I read the file first.' },
        { type: 'thinking', thinking: 'The bug sits in a.js.' },
      ]),
      call('t2', 'Read', { file_path: '/p/src/b.js' }, 2),
      call('t3', 'Write', { file_path: '/p/src/c.js', content: 'export {};' }, 3),
      call('t4', 'Edit', { file_path: '/p/src/a.js', old_string: 'a', new_string: 'b' }, 4),
      call('t5', 'MultiEdit', { file_path: '/p/src/b.js', edits: [] }, 5),
      call('t6', 'NotebookEdit', { notebook_path: '/p/nb.ipynb', new_source: '' }, 6),
      call('t7', 'Bash', { command: 'npm test', description: 'Run the tests' }, 7),
      call('t8', 'Grep', { pattern: 'TODO', path: 'src' }, 8),
      call('t9', 'Glob', { pattern: '**/*.md' }, 9),
      call('t10', 'Agent', { subagent_type: 'Explore', description: 'Find the files', prompt: 'Go.' }, 10),
      call('t11', 'Task', { description: 'Plan the fix', prompt: 'Plan.' }, 11),
      call('t12', 'AskUserQuestion', { questions: [{ question: 'Which fix?' }, { question: 'Why?' }] }, 12),
      call('t13', 'WebSearch', { query: 'x'.repeat(200) }, 13),
      call('t14', 'Read', { file_path: '/p/src/d.js', offset: 40 }, 14),
    ]);

    const answer = readTree(tree);
    assert.deepEqual(answer.notes, []);
    assert.equal(answer.transcript?.agents.length, 1);

    const other = JSON.stringify({ query: 'x'.repeat(200) }).slice(0, 117) + '...';
    assert.equal(other.length, 120);

    assert.deepEqual(answer.transcript.agents[0], {
      id: 'sess-kinds',
      steps: [
        step('user', null, null, 'Fix the login bug', 0),
        step('read', 'Read', '/p/src/a.js', 'lines 10-14', 1),
        step('read', 'Read', '/p/src/b.js', '', 2),
        step('write', 'Write', '/p/src/c.js', '', 3),
        step('edit', 'Edit', '/p/src/a.js', '', 4),
        step('edit', 'MultiEdit', '/p/src/b.js', '', 5),
        step('edit', 'NotebookEdit', '/p/nb.ipynb', '', 6),
        step('shell', 'Bash', null, 'npm test', 7),
        step('search', 'Grep', null, 'TODO in src', 8),
        step('search', 'Glob', null, '**/*.md', 9),
        step('delegate', 'Agent', null, 'Explore: Find the files', 10),
        step('delegate', 'Task', null, 'Plan the fix', 11),
        step('ask', 'AskUserQuestion', null, 'Which fix?', 12),
        step('other', 'WebSearch', null, other, 13),
        step('read', 'Read', '/p/src/d.js', 'from line 40', 14),
      ],
    });
  } finally {
    removeFixture(tree.root);
  }
});

test('a failed result gives the error, and the result of an ask gives the answer of the user', () => {
  const tree = createTree();
  try {
    writeLog(parentFile(tree, 'sess-results'), [
      said('Go', 0),
      call('t1', 'AskUserQuestion', { questions: [{ question: 'Ship it?' }] }, 1),
      result('t1', [{ type: 'text', text: 'The user answered: "Ship it?"="Something broke"' }], 2),
      call('t2', 'AskUserQuestion', { questions: [{ question: 'Again?' }] }, 3),
      result('t2', 'The user answered: "Again?"="No"', 4),
      call('t3', 'Bash', { command: 'npm test' }, 5),
      result('t3', 'Exit code 1\nFAIL one', 6, { isError: true }),
      call('t4', 'Edit', { file_path: '/p/a.js' }, 7),
      result(
        't4',
        [{ type: 'text', text: '<tool_use_error>String to replace not found</tool_use_error>' }],
        8,
        { isError: true }
      ),
      call('t5', 'Bash', { command: 'ls' }, 9),
      result('t5', 'a.js', 10),
      // A second result of the same call adds nothing: the first result wins.
      result('t5', 'late', 11, { isError: true }),
      call('t6', 'Agent', { subagent_type: 'general-purpose', description: 'Build phase 1' }, 12),
      result('t6', [{ type: 'text', text: 'Done' }], 13, {
        toolUseResult: { agentId: 'a1b2c3', status: 'completed' },
      }),
      call('t7', 'Write', { file_path: '/p/b.js' }, 14),
      result('t7', [], 15, { isError: true }),
      // A result for a call that the log does not hold adds nothing.
      result('t-missing', 'orphan', 16, { isError: true }),
      call('t8', 'AskUserQuestion', { questions: [{ question: 'Rerun?' }] }, 17),
      result('t8', 'The user rejected the question.', 18, { isError: true }),
    ]);

    const answer = readTree(tree);
    assert.deepEqual(answer.transcript?.agents[0].steps, [
      step('user', null, null, 'Go', 0),
      step('ask', 'AskUserQuestion', null, 'The user answered: "Ship it?"="Something broke"', 1),
      step('ask', 'AskUserQuestion', null, 'The user answered: "Again?"="No"', 3),
      step('shell', 'Bash', null, 'npm test', 5, 'Exit code 1\nFAIL one'),
      step('edit', 'Edit', '/p/a.js', '', 7, '<tool_use_error>String to replace not found</tool_use_error>'),
      step('shell', 'Bash', null, 'ls', 9),
      step('delegate', 'Agent', null, 'general-purpose: Build phase 1 -> a1b2c3', 12),
      step('write', 'Write', '/p/b.js', '', 14, '(no text)'),
      step('ask', 'AskUserQuestion', null, 'Rerun?', 17, 'The user rejected the question.'),
    ]);
  } finally {
    removeFixture(tree.root);
  }
});

test('a meta record, a compact summary, a local command, a reminder, and every other record type give no step', () => {
  const tree = createTree();
  try {
    writeLog(parentFile(tree, 'sess-meta'), [
      said('Base directory for this skill: /p/.claude/skills/x', 0, { isMeta: true }),
      said('This session is being continued from a previous conversation.', 1, {
        isCompactSummary: true,
      }),
      said('<local-command-stdout>ok</local-command-stdout>', 2),
      said('<system-reminder>Be brief.</system-reminder>', 3),
      said([{ type: 'text', text: '  <system-reminder>Be brief.</system-reminder>' }], 4),
      said('   ', 5),
      { type: 'system', subtype: 'informational', content: 'Hook ran.', timestamp: at(6) },
      { type: 'summary', summary: 'The session so far.', leafUuid: 'x' },
      { type: 'attachment', attachment: { type: 'file' }, timestamp: at(7) },
      { type: 'file-history-snapshot', snapshot: {}, timestamp: at(8) },
      { type: 'cost-state', totalCostUSD: 1.5, timestamp: at(9) },
      {
        type: 'assistant',
        timestamp: at(10),
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Hello.' },
            { type: 'thinking', thinking: 'Think.' },
          ],
        },
      },
      said([{ type: 'text', text: 'The real message' }, { type: 'image', source: {} }], 11),
    ]);

    const answer = readTree(tree);
    assert.deepEqual(answer.transcript?.agents[0].steps, [
      step('user', null, null, 'The real message', 11),
    ]);
    // "created" is the first time of the log, even of a record that gives no step.
    assert.equal(answer.transcript?.created, at(0));
  } finally {
    removeFixture(tree.root);
  }
});

test('a slash command gives "/<name>", plus the text of its args', () => {
  const tree = createTree();
  try {
    writeLog(parentFile(tree, 'sess-command'), [
      said(
        '<command-message>autorun-epic</command-message>\n<command-name>/autorun-epic</command-name>\n<command-args>deterministic-loop</command-args>',
        0
      ),
      said(
        '<command-name>/clear</command-name>\n            <command-message>clear</command-message>\n            <command-args></command-args>',
        1
      ),
      said([{ type: 'text', text: '<command-name>/review-session</command-name>' }], 2),
    ]);

    const answer = readTree(tree);
    assert.deepEqual(answer.transcript?.agents[0].steps, [
      step('user', null, null, '/autorun-epic deterministic-loop', 0),
      step('user', null, null, '/clear', 1),
      step('user', null, null, '/review-session', 2),
    ]);
  } finally {
    removeFixture(tree.root);
  }
});

test('a repeated tool_use block gives no second step', () => {
  const tree = createTree();
  try {
    const first = call('t1', 'Bash', { command: 'npm test' }, 1);
    writeLog(parentFile(tree, 'sess-repeat'), [
      said('Run the tests', 0),
      first,
      first,
      call('t1', 'Bash', { command: 'a changed copy' }, 2),
      call('t2', 'Bash', { command: 'git status' }, 3),
    ]);

    const answer = readTree(tree);
    assert.deepEqual(answer.transcript?.agents[0].steps, [
      step('user', null, null, 'Run the tests', 0),
      step('shell', 'Bash', null, 'npm test', 1),
      step('shell', 'Bash', null, 'git status', 3),
    ]);
  } finally {
    removeFixture(tree.root);
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// The subagents
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test('a parent brings each subagent log, and a subagent id brings that subagent alone', () => {
  const tree = createTree();
  try {
    writeLog(parentFile(tree, 'sess-parent'), [said('Build it', 0)]);
    writeLog(subagentFile(tree, 'sess-parent', 'sub-b'), [said('Phase 2 brief', 5)]);
    writeLog(subagentFile(tree, 'sess-parent', 'sub-a'), [
      said('Phase 1 brief', 1),
      call('s1', 'Read', { file_path: '/p/a.js' }, 2),
    ]);
    // The meta file beside a subagent log is no log.
    fs.writeFileSync(
      path.join(tree.projectDir, 'sess-parent', 'subagents', 'agent-sub-a.meta.json'),
      '{"agentType":"x"}'
    );

    const parent = readTree(tree);
    assert.deepEqual(parent.notes, []);
    assert.equal(parent.transcript?.id, 'sess-parent');
    assert.equal(parent.transcript?.kind, 'parent');
    assert.equal(parent.transcript?.parent, null);
    assert.equal(parent.transcript?.created, at(0));
    assert.deepEqual(
      parent.transcript?.agents.map((agent) => agent.id),
      ['sess-parent', 'sub-a', 'sub-b']
    );
    assert.deepEqual(parent.transcript?.agents[1].steps, [
      step('user', null, null, 'Phase 1 brief', 1),
      step('read', 'Read', '/p/a.js', '', 2),
    ]);

    const sub = readTree(tree, 'sub-b');
    assert.deepEqual(sub.notes, []);
    assert.equal(sub.transcript?.id, 'sub-b');
    assert.equal(sub.transcript?.kind, 'subagent');
    assert.equal(sub.transcript?.parent, 'sess-parent');
    assert.equal(sub.transcript?.created, at(5));
    assert.equal(sub.transcript?.writtenAt, BASE_TIME.toISOString());
    assert.deepEqual(sub.transcript?.agents, [
      { id: 'sub-b', steps: [step('user', null, null, 'Phase 2 brief', 5)] },
    ]);
  } finally {
    removeFixture(tree.root);
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// The session pick
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test('with no id, the reader picks the parent log with the latest modification time', () => {
  const tree = createTree();
  try {
    const january = new Date('2026-01-15T08:00:00.000Z');
    const february = new Date('2026-02-15T08:00:00.000Z');
    const march = new Date('2026-03-15T08:00:00.000Z');

    writeLog(parentFile(tree, 'alpha'), [said('alpha work', 0)], february);
    writeLog(parentFile(tree, 'beta'), [said('beta work', 1)], january);
    // The newest file of the tree is a subagent log, and a subagent log is no parent.
    writeLog(subagentFile(tree, 'beta', 'beta-sub'), [said('beta sub work', 2)], march);

    // readTree() deletes CLAUDE_CODE_SESSION_ID, so the time alone decides.
    const first = readTree(tree);
    assert.equal(first.transcript?.id, 'alpha');
    assert.equal(first.transcript?.writtenAt, february.toISOString());
    assert.deepEqual(
      first.transcript?.agents.map((agent) => agent.id),
      ['alpha']
    );

    // The pick follows the time, not the name.
    fs.utimesSync(parentFile(tree, 'alpha'), january, january);
    fs.utimesSync(parentFile(tree, 'beta'), february, february);
    const second = readTree(tree);
    assert.equal(second.transcript?.id, 'beta');
    assert.equal(second.transcript?.writtenAt, february.toISOString());
    assert.deepEqual(
      second.transcript?.agents.map((agent) => agent.id),
      ['beta', 'beta-sub']
    );
  } finally {
    removeFixture(tree.root);
  }
});

test('with no id, CLAUDE_CODE_SESSION_ID picks its parent log over a newer log, and an id still wins', () => {
  const tree = createTree();
  try {
    const january = new Date('2026-01-15T08:00:00.000Z');
    const march = new Date('2026-03-15T08:00:00.000Z');

    writeLog(parentFile(tree, 'sess-running'), [said('running work', 0)], january);
    writeLog(subagentFile(tree, 'sess-running', 'running-sub'), [said('running sub work', 1)], january);
    // A second live window of Claude Code writes a newer log of this project.
    writeLog(parentFile(tree, 'sess-other'), [said('other work', 2)], march);

    // With the variable deleted, the newest log wins, and it holds no "current" mark.
    const newest = readTree(tree);
    assert.equal(newest.transcript?.id, 'sess-other');
    assert.notEqual(newest.transcript?.current, true);

    const running = readTree(tree, null, 'sess-running');
    assert.deepEqual(running.notes, []);
    // Only the pick through CLAUDE_CODE_SESSION_ID marks the answer "current: true".
    assert.equal(running.transcript?.current, true);
    assert.notEqual(readTree(tree, 'sess-running', 'sess-running').transcript?.current, true);
    assert.notEqual(readTree(tree, 'sess-other', 'sess-running').transcript?.current, true);
    assert.equal(running.transcript?.id, 'sess-running');
    assert.equal(running.transcript?.kind, 'parent');
    assert.equal(running.transcript?.writtenAt, january.toISOString());
    assert.deepEqual(
      running.transcript?.agents.map((agent) => agent.id),
      ['sess-running', 'running-sub']
    );

    // The reader trims the value, as it trims an id.
    assert.equal(readTree(tree, null, ' sess-running ').transcript?.id, 'sess-running');

    // An exact id and a unique prefix win over the variable.
    assert.equal(readTree(tree, 'sess-other', 'sess-running').transcript?.id, 'sess-other');
    assert.equal(readTree(tree, 'sess-o', 'sess-running').transcript?.id, 'sess-other');
    assert.equal(readTree(tree, 'running-sub', 'sess-other').transcript?.kind, 'subagent');
  } finally {
    removeFixture(tree.root);
  }
});

test('with no id, a CLAUDE_CODE_SESSION_ID that names no parent log falls back to the newest log', () => {
  const tree = createTree();
  try {
    const january = new Date('2026-01-15T08:00:00.000Z');
    const february = new Date('2026-02-15T08:00:00.000Z');
    const march = new Date('2026-03-15T08:00:00.000Z');

    writeLog(parentFile(tree, 'alpha'), [said('alpha work', 0)], february);
    writeLog(parentFile(tree, 'beta'), [said('beta work', 1)], january);
    writeLog(subagentFile(tree, 'beta', 'beta-sub'), [said('beta sub work', 2)], march);
    const other = path.join(tree.configRoot, 'projects', encodeKey('/tmp/bm-other/project'));
    writeLog(path.join(other, 'theirs.jsonl'), [said('their work', 3)], january);

    // No log of that id, a subagent id, a prefix of a parent id, the id of a
    // log of another project, an empty value, and a blank value.
    for (const current of ['no-such-session', 'beta-sub', 'bet', 'theirs', '', '   ']) {
      const answer = readTree(tree, null, current);
      assert.equal(answer.transcript?.id, 'alpha', `the value "${current}" falls back to the newest log`);
      assert.equal(answer.transcript?.writtenAt, february.toISOString());
      assert.deepEqual(answer.notes, []);
    }
  } finally {
    removeFixture(tree.root);
  }
});

test('an exact id and a unique prefix each pick one session', () => {
  const tree = createTree();
  try {
    writeLog(parentFile(tree, 'abc-111'), [said('abc work', 0)]);
    writeLog(parentFile(tree, 'abd-222'), [said('abd work', 1)]);
    writeLog(subagentFile(tree, 'abd-222', 'zz-sub'), [said('zz work', 2)]);
    writeLog(parentFile(tree, 'xyz'), [said('xyz work', 3)]);
    writeLog(parentFile(tree, 'xyz-long'), [said('xyz long work', 4)]);

    assert.equal(readTree(tree, 'abd-222').transcript?.id, 'abd-222');
    assert.deepEqual(
      readTree(tree, 'abd-222').transcript?.agents.map((agent) => agent.id),
      ['abd-222', 'zz-sub']
    );

    // A text that equals no id matches as a prefix when one id starts with it.
    assert.equal(readTree(tree, 'abc').transcript?.id, 'abc-111');
    assert.equal(readTree(tree, ' abc-1 ').transcript?.id, 'abc-111');

    const sub = readTree(tree, 'zz');
    assert.equal(sub.transcript?.id, 'zz-sub');
    assert.equal(sub.transcript?.kind, 'subagent');
    assert.equal(sub.transcript?.parent, 'abd-222');

    // An exact id wins over the ids that start with it.
    assert.equal(readTree(tree, 'xyz').transcript?.id, 'xyz');

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
      writeLog(parentFile(tree, `run-${index}`), [said(`run ${index}`, index)], time);
    }

    assert.deepEqual(readTree(tree, 'run-'), {
      transcript: null,
      notes: ['The id "run-" matches more than one session: run-6, run-5, run-4, run-3, run-2.'],
    });

    // A parent and a subagent can share a prefix, and the note lists both.
    writeLog(parentFile(tree, 'q-parent'), [said('q', 1)], new Date('2026-02-01T00:00:00.000Z'));
    writeLog(
      subagentFile(tree, 'q-parent', 'q-sub'),
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

test('a log of another project gives no step, and its id matches nothing', () => {
  const tree = createTree();
  try {
    writeLog(parentFile(tree, 'mine'), [said('my work', 0)], new Date('2026-01-01T00:00:00.000Z'));

    // A newer log of another project, and a newer log of a directory whose
    // name holds the key of this project as a prefix.
    const later = new Date('2026-06-01T00:00:00.000Z');
    const projects = path.join(tree.configRoot, 'projects');
    writeLog(path.join(projects, encodeKey('/tmp/bm-other/project'), 'theirs.jsonl'), [said('x', 1)], later);
    writeLog(path.join(projects, `${path.basename(tree.projectDir)}-extra`, 'near.jsonl'), [said('y', 2)], later);

    const answer = readTree(tree);
    assert.equal(answer.transcript?.id, 'mine');
    assert.ok(!JSON.stringify(answer).includes('theirs'), 'the answer names no log of the other project');

    assert.deepEqual(readTree(tree, 'theirs'), { transcript: null, notes: [] });
    assert.deepEqual(readTree(tree, 'near'), { transcript: null, notes: [] });
  } finally {
    removeFixture(tree.root);
  }
});

test('each line that is not JSON adds to the count of one note', () => {
  const tree = createTree();
  try {
    writeLog(parentFile(tree, 'sess-bad'), [
      said('Start', 0),
      '{"type":"user", "broken',
      'not json at all',
      call('t1', 'Bash', { command: 'ls' }, 1),
    ]);
    writeLog(subagentFile(tree, 'sess-bad', 'sub-bad'), ['{', said('Sub start', 2)]);

    const answer = readTree(tree);
    assert.deepEqual(answer.notes, ['The reader skipped 3 lines of the log that are not JSON.']);
    assert.deepEqual(answer.transcript?.agents[0].steps, [
      step('user', null, null, 'Start', 0),
      step('shell', 'Bash', null, 'ls', 1),
    ]);
    assert.deepEqual(answer.transcript?.agents[1].steps, [step('user', null, null, 'Sub start', 2)]);
  } finally {
    removeFixture(tree.root);
  }
});

test('a project with no log, and a root with no projects directory, give no transcript and no note', () => {
  const tree = createTree();
  try {
    assert.deepEqual(readTree(tree), { transcript: null, notes: [] });

    const bare = { ...tree, env: { ...tree.env, CLAUDE_CONFIG_DIR: path.join(tree.root, 'absent') } };
    assert.deepEqual(readTree(bare), { transcript: null, notes: [] });
    assert.deepEqual(readTree(bare, 'any-id'), { transcript: null, notes: [] });
  } finally {
    removeFixture(tree.root);
  }
});

test('the default export carries transcript() beside the token members', () => {
  assert.equal(claude.transcript, transcript);
  assert.equal(typeof claude.read, 'function');
  assert.equal(typeof claude.available, 'function');
});
