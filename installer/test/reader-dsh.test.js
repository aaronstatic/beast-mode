// installer/test/reader-dsh.test.js
//
// The tests of the dsh token reader of installer/readers/dsh.js: the three
// sessions and their exact numbers, the two parentSession shapes, the log of
// the highest generation, the log of another project, the log with no step,
// the note of the skipped lines, the two decode paths, the torn log, the
// availability check, the trailing slash of the project root, and the window.
// The file also tests the two pure exports projectKey() and frameEnd(), the
// header fallbacks, the nested subagent, and the two guards of read().
//
// Every test sets DSH_HOME to a fixture log tree, and every test that reads
// the committed tree of test/fixtures/dsh-sessions names the project root
// "/tmp/bm-dsh/project". No test reads the real home directory, and no test
// writes into this repository. A test that needs another tree writes one
// directory under os.tmpdir(), and it removes that directory again.
//
// A host with no zstd decoder reads no compressed log of the committed tree.
// Every test that needs a decoded log therefore carries the option
// { skip: DECODE_SKIP }, and every other test runs on such a host. The plain
// tree of createPlainHome() holds no compressed log at all.

import assert from 'node:assert/strict';
import cp from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import zlib from 'node:zlib';

import dsh, { available, frameEnd, projectKey, read } from '../readers/dsh.js';
import { removeFixture } from './helpers.js';

/** The fixture log tree. It stands in for the home directory of dsh. */
const DSH_HOME = path.join(import.meta.dirname, 'fixtures', 'dsh-sessions');

/** The sessions directory of the fixture tree. */
const SESSIONS = path.join(DSH_HOME, 'sessions');

/** The environment of every read. DSH_HOME wins over HOME. */
const ENV = { DSH_HOME };

/** The project of the fixture logs. The directory name encodes this path. */
const PROJECT_ROOT = '/tmp/bm-dsh/project';

/** The directory name that the reader builds from PROJECT_ROOT. */
const PROJECT_KEY = '--tmp-bm-dsh-project--';

/** The compressed log of the parent. The torn log test copies this file. */
const PARENT_LOG = path.join(SESSIONS, PROJECT_KEY, 'session-parent-one', 'session.v3.jsonl.zstd');

/** The note of section 3.6. The body of the parent holds one bad line. */
const SKIPPED_NOTE = 'The reader skipped 1 lines of the log that are not JSON.';

/** The note of a call that names no project root. */
const NO_ROOT_NOTE = 'The caller named no project root, so the reader read no session log of dsh.';

/** The whole parent session of session-parent-one/session.v3.jsonl.zstd. */
const PARENT = {
  id: 'parent-one',
  kind: 'parent',
  parent: null,
  model: 'glm-5.3',
  steps: 3,
  finalPromptTokens: 3300,
  promptTokens: 6600,
  cacheReadTokens: 6000,
  outputTokens: 120,
  created: '2025-09-18T00:00:00.000Z',
  costUsd: null,
};

/** The whole subagent session of sub-one/session.jsonl. */
const SUB_ONE = {
  id: 'sub-one',
  kind: 'subagent',
  parent: 'parent-one',
  model: 'qwen3.8-flash',
  steps: 2,
  finalPromptTokens: 660,
  promptTokens: 1210,
  cacheReadTokens: 1100,
  outputTokens: 30,
  created: '2025-09-18T00:01:00.000Z',
  costUsd: null,
};

/** The whole subagent session of sub-two/session.v3.jsonl.zstd. */
const SUB_TWO = {
  id: 'sub-two',
  kind: 'subagent',
  parent: 'parent-one',
  model: 'glm-5.3',
  steps: 1,
  finalPromptTokens: 770,
  promptTokens: 770,
  cacheReadTokens: 700,
  outputTokens: 15,
  created: '2025-09-18T00:02:00.000Z',
  costUsd: null,
};

/** Whether this host holds zlib.zstdDecompressSync. Node.js 22.15 holds it. */
const HAS_ZLIB = typeof zlib.zstdDecompressSync === 'function';

/** Whether this host holds the zstd command. */
const HAS_COMMAND = hasZstdCommand();

/** The skip message of a decode test, or false for a host that runs it. */
const ZLIB_SKIP = HAS_ZLIB
  ? false
  : 'This host holds no zlib.zstdDecompressSync. Node.js 22.15 and later hold it.';
const COMMAND_SKIP = HAS_COMMAND ? false : 'This host holds no "zstd" command.';
const DECODE_SKIP = HAS_ZLIB || HAS_COMMAND ? false : 'This host holds no zstd decoder at all.';

/** The decode modes of this host, in test order. */
const MODES = [...(HAS_ZLIB ? ['zlib'] : []), ...(HAS_COMMAND ? ['command'] : [])];

/** The count of bytes that the torn log test cuts from the end of the file. */
const CUT_BYTES = 12;

/** The skip message of the symlink test, or false for a host that runs it. */
const SYMLINK_SKIP = canSymlink() ? false : 'This host refuses a symbolic link to this process.';

/** The skip message of the mode 000 test, or false for a host that runs it. */
const ROOT_SKIP =
  typeof process.getuid === 'function' && process.getuid() !== 0
    ? false
    : 'This process runs as root, or this host holds no user id, so mode 000 stops no read.';

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
 * Whether this host lets this process make a symbolic link. Windows refuses a
 * link to a user with no such right. The probe writes one directory under
 * os.tmpdir(), and it removes that directory again.
 *
 * @returns {boolean}
 */
function canSymlink() {
  const probe = fs.mkdtempSync(path.join(os.tmpdir(), 'bm-dsh-probe-'));
  try {
    fs.mkdirSync(path.join(probe, 'target'));
    fs.symlinkSync(path.join(probe, 'target'), path.join(probe, 'link'), 'dir');
    return true;
  } catch {
    return false;
  } finally {
    removeFixture(probe);
  }
}

/**
 * Read the fixture project.
 *
 * @param {{ projectRoot?: string, days?: number | null, zstd?: string }} [opts]
 * @returns {{ sessions: Record<string, any>[], notes: string[] }}
 */
function readFixture(opts = {}) {
  return read({
    projectRoot: opts.projectRoot ?? PROJECT_ROOT,
    days: opts.days ?? null,
    env: opts.zstd === undefined ? ENV : { ...ENV, BEAST_MODE_ZSTD: opts.zstd },
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

/**
 * Build a home directory of dsh that holds one torn log.
 *
 * The copy keeps every byte of the fixture log but the last CUT_BYTES, so the
 * second frame of the file stops in the middle of a block. A live session of
 * dsh ends the same way after a crash.
 *
 * @returns {string} The absolute path of the temporary home directory.
 */
function createTornHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'bm-dsh-torn-'));
  const directory = path.join(home, 'sessions', PROJECT_KEY, 'session-torn');
  fs.mkdirSync(directory, { recursive: true });

  const whole = fs.readFileSync(PARENT_LOG);
  fs.writeFileSync(
    path.join(directory, 'session.v3.jsonl.zstd'),
    whole.subarray(0, whole.length - CUT_BYTES)
  );
  return home;
}

/**
 * The real path of one target. A target that does not exist gives the
 * resolved path, because fs.realpathSync() raises for such a target.
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
 * One "assistant/message" line of a plain log. A step with no "model" field
 * writes an empty "source" object, so the log holds a step that names no
 * model.
 *
 * @param {{ model?: string, input?: number, cacheRead?: number, output?: number }} step
 * @returns {string}
 */
function stepLine(step) {
  return JSON.stringify({
    type: 'assistant/message',
    data: {
      message: {
        source: step.model === undefined ? {} : { model: step.model },
        content: [{ type: 'text', text: 'one step' }],
      },
      usage: {
        inputTokens: step.input ?? 0,
        cacheReadTokens: step.cacheRead ?? 0,
        outputTokens: step.output ?? 0,
      },
    },
  });
}

/**
 * Build a home directory of dsh that holds one plain log for each session.
 *
 * The tree carries no compressed log, so every test of this helper runs on a
 * host with no zstd decoder. The project directory name comes from the real
 * path of the project root, because dsh writes the key of the path that the
 * session itself holds.
 *
 * The caller removes "home" in a finally block with removeFixture().
 *
 * @param {{
 *   directory: string,
 *   header: Record<string, any>,
 *   steps: { model?: string, input?: number, cacheRead?: number, output?: number }[],
 * }[]} sessions The sessions of the tree, one directory for each.
 * @param {{ projectRoot?: string, home?: string }} [opts]
 * @returns {{ home: string, project: string }} The home directory, and the project directory in it.
 */
function createPlainHome(sessions, opts = {}) {
  const home = opts.home ?? fs.mkdtempSync(path.join(os.tmpdir(), 'bm-dsh-plain-'));
  const key = projectKey(realPath(opts.projectRoot ?? PROJECT_ROOT));
  const project = path.join(home, 'sessions', key);

  for (const session of sessions) {
    const directory = path.join(project, session.directory);
    fs.mkdirSync(directory, { recursive: true });

    const lines = [
      JSON.stringify({ type: 'session', version: 3, ...session.header }),
      ...session.steps.map(stepLine),
    ];
    fs.writeFileSync(path.join(directory, 'session.jsonl'), `${lines.join('\n')}\n`);
  }

  return { home, project };
}

/**
 * One hand-made skippable zstd frame: the magic number, the payload size, and
 * then the payload.
 *
 * @param {number} size The count of payload bytes.
 * @param {number} [magic] One magic number of the skippable range.
 * @returns {Buffer}
 */
function skippableFrame(size, magic = 0x184d2a50) {
  const buf = Buffer.alloc(8 + size, 0x5a);
  buf.writeUInt32LE(magic, 0);
  buf.writeUInt32LE(size, 4);
  return buf;
}

/**
 * One hand-made zstd frame that holds one RLE block.
 *
 * The frame header descriptor sets the single segment flag, so the frame
 * carries no window descriptor, and it carries a content size of one byte.
 * The block header holds the last block bit, the block type 1, and the
 * regenerated size. An RLE block carries one byte of content, whatever the
 * regenerated size states. No test decodes such a frame, so the content size
 * byte holds the low byte of the size, and the walk reads that byte never.
 *
 * @param {{ size?: number, checksum?: boolean }} [opts]
 * @returns {Buffer}
 */
function rleFrame(opts = {}) {
  const size = opts.size ?? 5;
  const checksum = opts.checksum === true;
  const descriptor = 0x20 | (checksum ? 0x04 : 0x00);
  const header = (size << 3) | (1 << 1) | 1;

  const magic = Buffer.alloc(4);
  magic.writeUInt32LE(0xfd2fb528, 0);

  /** @type {Buffer[]} */
  const parts = [
    magic,
    Buffer.from([descriptor, size & 0xff]),
    Buffer.from([header & 0xff, (header >> 8) & 0xff, (header >> 16) & 0xff]),
    Buffer.from([0x41]),
  ];
  if (checksum) parts.push(Buffer.alloc(4));

  return Buffer.concat(parts);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// The sessions and the numbers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test('the reader returns the parent and its two subagents with the exact numbers of the plan', {
  skip: DECODE_SKIP,
}, () => {
  const answer = readFixture();

  // The parent comes first, and the subagents of that parent follow it.
  assert.deepEqual(ids(answer), ['parent-one', 'sub-one', 'sub-two']);
  assert.deepEqual(answer.sessions[0], PARENT);
  assert.deepEqual(answer.sessions[1], SUB_ONE);
  assert.deepEqual(answer.sessions[2], SUB_TWO);
});

test('the log of the highest generation wins, and the lock file reaches no answer', {
  skip: DECODE_SKIP,
}, () => {
  const answer = readFixture();
  const text = JSON.stringify(answer);

  // session-parent-one holds session.v2.jsonl and session.v3.jsonl.zstd. The
  // older log names the model "wrong-pick" and it carries the numbers 999,
  // 9990, and 99, so a wrong pick changes every number of the parent.
  assert.equal(answer.sessions[0].model, 'glm-5.3');
  assert.equal(answer.sessions[0].steps, 3);
  assert.ok(!text.includes('wrong-pick'), 'the answer names no model of the older log');
  assert.ok(!text.includes('9990'), 'the answer carries no number of the older log');

  // The three steps of the winner hold the input tokens 100, 200, and 300,
  // and the cache read tokens 1000, 2000, and 3000.
  assert.equal(answer.sessions[0].promptTokens, 1100 + 2200 + 3300);
  assert.equal(answer.sessions[0].finalPromptTokens, 3300);

  // session.lock sits in the same directory, and it matches no log name.
  assert.equal(answer.sessions.length, 3);
});

test('the reader reads parentSession as an object and as a string', { skip: DECODE_SKIP }, () => {
  const answer = readFixture();

  // sub-one carries the object {"id":"session-parent-one"}, and sub-two
  // carries the string "session-parent-one". The reader drops the prefix
  // "session-" of both shapes, so both names match the id of the parent.
  assert.equal(answer.sessions[1].parent, 'parent-one');
  assert.equal(answer.sessions[2].parent, 'parent-one');
  assert.equal(answer.sessions[1].kind, 'subagent');
  assert.equal(answer.sessions[2].kind, 'subagent');
});

test('the reader names no log of the other project, and no log with no step', {
  skip: DECODE_SKIP,
}, () => {
  const answer = readFixture();
  const text = JSON.stringify(answer);

  // --tmp-bm-dsh-other--/session-other sits beside the matched directory, and
  // it carries 9000 tokens of each kind.
  assert.ok(!text.includes('session-other'), 'the answer names no session of the other project');
  assert.ok(!text.includes('other-model'), 'the answer names no model of the other project');
  assert.ok(!text.includes('9000'), 'the answer carries no number of the other project');

  // session-empty holds a header and no assistant/message event.
  assert.ok(!ids(answer).includes('empty'), 'a log with no step gives no session');
});

test('one note names the count of the lines that are not JSON', { skip: DECODE_SKIP }, () => {
  const answer = readFixture();

  assert.deepEqual(answer.notes, [SKIPPED_NOTE]);
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// The project match and the window
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test('a trailing slash of the project root changes no answer', { skip: DECODE_SKIP }, () => {
  const plain = readFixture();
  const slash = readFixture({ projectRoot: `${PROJECT_ROOT}/` });

  assert.deepEqual(slash, plain);
});

test('a project with no session directory gives no session and one note', () => {
  const answer = readFixture({ projectRoot: '/tmp/bm-dsh/absent' });

  assert.deepEqual(answer.sessions, []);
  assert.equal(answer.notes.length, 1);
  assert.match(answer.notes[0], /No session directory of dsh matches this project\./);
  assert.match(answer.notes[0], /--tmp-bm-dsh-absent--/);
});

test('the reader drops a session whose header names another path', () => {
  // The two paths give one directory key, so session-foreign sits inside the
  // matched directory of the fixture. The header names the other path, and
  // the working directory guard of the match rule drops that session.
  assert.equal(projectKey('/tmp/bm-dsh-project'), PROJECT_KEY);
  assert.equal(projectKey(PROJECT_ROOT), PROJECT_KEY);

  // The value "none" leaves every compressed log of the fixture unread, so
  // this block runs on a host with no decoder too. The log of session-foreign
  // is plain, and that session is a parent, so the answer names it as soon as
  // the guard falls.
  assert.deepEqual(readFixture({ zstd: 'none' }).sessions, []);

  const answer = readFixture();
  const text = JSON.stringify(answer);
  assert.ok(!ids(answer).includes('foreign'), 'the answer names no session of the other path');
  assert.ok(!text.includes('foreign-model'), 'the answer names no model of the other path');
  assert.ok(!text.includes('8000'), 'the answer carries no number of the other path');
});

test('the reader reads a project root that is a symbolic link', { skip: SYMLINK_SKIP }, () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'bm-dsh-link-'));
  try {
    const target = path.join(base, 'real-project');
    const link = path.join(base, 'link-project');
    fs.mkdirSync(target);
    fs.symlinkSync(target, link, 'dir');

    // dsh names the session directory after the real path, and it writes the
    // real path into the header. The reader matches both roots, so the link
    // and the target give one answer.
    const { home } = createPlainHome(
      [
        {
          directory: 'linked-one',
          header: { id: 'linked-one', createdAt: 1758153600000, cwd: realPath(target) },
          steps: [{ model: 'link-model', input: 40, cacheRead: 400, output: 9 }],
        },
      ],
      { projectRoot: link, home: path.join(base, 'home') }
    );

    const answer = read({ projectRoot: link, days: null, env: { DSH_HOME: home } });
    assert.deepEqual(ids(answer), ['linked-one']);
    assert.deepEqual(answer.notes, []);
    assert.equal(answer.sessions[0].promptTokens, 440);

    const direct = read({ projectRoot: target, days: null, env: { DSH_HOME: home } });
    assert.deepEqual(direct, answer);
  } finally {
    removeFixture(base);
  }
});

test('the window drops the sessions outside it, and it keeps the note of the skipped lines', {
  skip: DECODE_SKIP,
}, () => {
  // The fixture logs carry the timestamps of September 2025, so a window of
  // one day holds no session of the tree.
  const near = readFixture({ days: 1 });
  assert.deepEqual(near.sessions, []);

  // The parser reads the whole log before read() applies the window, so the
  // note still names the skipped line.
  assert.deepEqual(near.notes, [SKIPPED_NOTE]);

  // A window of 100000 days reaches back over two centuries.
  const wide = readFixture({ days: 100000 });
  assert.deepEqual(ids(wide), ['parent-one', 'sub-one', 'sub-two']);
  assert.deepEqual(wide.sessions[0], PARENT);
  assert.deepEqual(wide.sessions[1], SUB_ONE);
  assert.deepEqual(wide.sessions[2], SUB_TWO);
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// The two decode paths
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test('the zlib decode path returns the three sessions', { skip: ZLIB_SKIP }, () => {
  // Each compressed log of the fixture holds two frames, and
  // zlib.zstdDecompressSync stops at the end of the first frame. The reader
  // walks the frame headers, so the body frame of each log reaches the parse
  // step too. A walk that stops after the first frame drops every step.
  const answer = readFixture({ zstd: 'zlib' });

  assert.deepEqual(ids(answer), ['parent-one', 'sub-one', 'sub-two']);
  assert.deepEqual(answer.sessions[0], PARENT);
  assert.deepEqual(answer.sessions[2], SUB_TWO);
  assert.deepEqual(answer.notes, [SKIPPED_NOTE]);
});

test('the zstd command decode path returns the three sessions', { skip: COMMAND_SKIP }, () => {
  // The command reads every frame of its input, so this path needs no walk.
  const answer = readFixture({ zstd: 'command' });

  assert.deepEqual(ids(answer), ['parent-one', 'sub-one', 'sub-two']);
  assert.deepEqual(answer.sessions[0], PARENT);
  assert.deepEqual(answer.sessions[2], SUB_TWO);
  assert.deepEqual(answer.notes, [SKIPPED_NOTE]);
});

test('the two decode paths return the same answer', { skip: DECODE_SKIP }, () => {
  const answers = MODES.map((mode) => readFixture({ zstd: mode }));

  for (const answer of answers) {
    assert.deepEqual(answer, answers[0]);
  }
});

test('BEAST_MODE_ZSTD "none" leaves every compressed log unread', () => {
  const answer = readFixture({ zstd: 'none' });

  // The three compressed logs of the fixture stay unread, and one note counts
  // them. The plain log of sub-one still parses, but its parent stays out of
  // the answer, so that subagent falls out of the run too.
  assert.deepEqual(answer.sessions, []);
  assert.deepEqual(answer.notes, ['The reader could not read 3 log files.']);
});

test('a torn log gives no session, it raises nothing, and one note counts it', {
  skip: DECODE_SKIP,
}, () => {
  const home = createTornHome();
  try {
    for (const mode of MODES) {
      const answer = read({
        projectRoot: PROJECT_ROOT,
        days: null,
        env: { DSH_HOME: home, BEAST_MODE_ZSTD: mode },
      });

      // The frame walk finds no end of the last frame, and the command exits
      // with a non-zero status. Both paths count the whole file as unread.
      assert.deepEqual(answer.sessions, [], `the mode "${mode}" returns no session`);
      assert.deepEqual(answer.notes, ['The reader could not read 1 log files.']);
    }
  } finally {
    removeFixture(home);
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// projectKey(), the port of the encoder of the harness
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test('projectKey() encodes a separator, an unsafe character, the empty answer, and a long path', () => {
  // A run of separators collapses to one dash, and the rule strips every
  // leading dash. A backslash and a colon are separators too.
  assert.equal(projectKey('/a//b::c\\d'), '--a-b-c-d--');

  // A tilde, a space, a letter over U+007F, and an emoji each become a tilde
  // and four uppercase hexadecimal digits. The emoji holds two code units.
  assert.equal(projectKey('/a/~x y/é/😀'), '--a-~007Ex~0020y-~00E9-~D83D~DE00--');

  // A path of separators gives an empty slug, and the rule uses "root".
  assert.equal(projectKey('///'), '--root--');

  // The rule cuts the slug at 251 characters, so the whole key holds 255.
  const long = `/${'a'.repeat(299)}`;
  assert.equal(long.length, 300);
  assert.equal(projectKey(long).length, 255);
  assert.equal(projectKey(long), `--${'a'.repeat(251)}--`);

  // A plain project path of a host gives the key that dsh writes.
  assert.equal(
    projectKey('/home/aaronstatic/dev/stratos/frontend'),
    '--home-aaronstatic-dev-stratos-frontend--'
  );
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// frameEnd(), the walk of the zstd frame headers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test('frameEnd() walks a skippable frame, an RLE block, and the frames of a real log', () => {
  // A skippable frame carries its own payload size in the four bytes after
  // the magic number. Each magic number of the range gives the same walk.
  assert.equal(frameEnd(skippableFrame(6), 0), 14);
  assert.equal(frameEnd(skippableFrame(0), 0), 8);
  assert.equal(frameEnd(skippableFrame(6, 0x184d2a5f), 0), 14);

  // An RLE block holds one byte of content, and the regenerated size of the
  // block header states 5. A walk that reads 5 bytes runs off the frame.
  assert.equal(frameEnd(rleFrame(), 0), 10);
  assert.equal(frameEnd(rleFrame({ size: 4096 }), 0), 10);

  // The content checksum adds four bytes after the last block.
  assert.equal(frameEnd(rleFrame({ checksum: true }), 0), 14);

  // The real log of the fixture holds two frames, and the second frame ends
  // at the last byte of the file.
  const whole = fs.readFileSync(PARENT_LOG);
  const first = frameEnd(whole, 0);
  assert.ok(first > 0 && first < whole.length, 'the first frame ends inside the file');
  assert.equal(frameEnd(whole, first), whole.length);
});

test('frameEnd() returns -1 for a cut frame, and for bytes that start no frame', () => {
  // A frame that stops before its last block gives the "no end" value.
  const rle = rleFrame();
  assert.equal(frameEnd(rle.subarray(0, rle.length - 3), 0), -1);

  // A cut skippable frame states more payload than the buffer holds.
  const skippable = skippableFrame(6);
  assert.equal(frameEnd(skippable.subarray(0, skippable.length - 2), 0), -1);

  // A buffer of three bytes holds no magic number at all.
  assert.equal(frameEnd(Buffer.alloc(3), 0), -1);

  // A magic number of another format names no frame of zstd.
  const other = Buffer.alloc(16);
  other.writeUInt32LE(0x12345678, 0);
  assert.equal(frameEnd(other, 0), -1);

  // A start beyond the last byte gives the same value.
  assert.equal(frameEnd(rle, rle.length), -1);
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// The header fallbacks and the nested subagent
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test('a header with no id, no time, and no model gives the three fallback values', () => {
  const { home } = createPlainHome([
    {
      directory: 'nameless-one',
      header: { createdAt: 0, cwd: PROJECT_ROOT },
      steps: [{ input: 11, cacheRead: 22, output: 3 }],
    },
  ]);

  try {
    const answer = read({ projectRoot: PROJECT_ROOT, days: null, env: { DSH_HOME: home } });

    assert.deepEqual(answer.notes, []);
    assert.equal(answer.sessions.length, 1);

    // A createdAt of 0 names the first millisecond of 1970. The reader gives
    // null for it, and the report then prints no date.
    assert.equal(answer.sessions[0].created, null);

    // The name of the session directory is the fallback id.
    assert.equal(answer.sessions[0].id, 'nameless-one');

    // No step names a model, so the reader reports the unknown model.
    assert.equal(answer.sessions[0].model, '?');
    assert.equal(answer.sessions[0].promptTokens, 33);

    // A session with no created value stays inside every window.
    const near = read({ projectRoot: PROJECT_ROOT, days: 1, env: { DSH_HOME: home } });
    assert.deepEqual(ids(near), ['nameless-one']);
  } finally {
    removeFixture(home);
  }
});

test('a named model of one step wins over every step that names no model', () => {
  const { home } = createPlainHome([
    {
      directory: 'mixed-one',
      header: { id: 'mixed-one', createdAt: 1758153600000, cwd: PROJECT_ROOT },
      steps: [{ input: 10 }, { input: 10 }, { model: 'real', input: 10 }],
    },
  ]);

  try {
    const answer = read({ projectRoot: PROJECT_ROOT, days: null, env: { DSH_HOME: home } });

    // The map of the models counts a named model only, so the two steps with
    // no name add no count, and the one named step names the session.
    assert.equal(answer.sessions.length, 1);
    assert.equal(answer.sessions[0].model, 'real');
    assert.equal(answer.sessions[0].steps, 3);
  } finally {
    removeFixture(home);
  }
});

test('a subagent of a subagent stays, and the window of the parent holds every subagent', () => {
  // The reader walks the session directories in sort order, so the grandchild
  // comes first. The walk of the run therefore needs two passes. The first
  // pass adds the child, and the second pass adds the grandchild.
  const old = Date.parse('2020-01-01T00:00:00.000Z');
  const { home } = createPlainHome([
    {
      directory: 'a-grandchild',
      header: {
        id: 'a-grandchild',
        createdAt: old,
        cwd: PROJECT_ROOT,
        parentSession: 'session-b-child',
      },
      steps: [{ model: 'small', input: 1, cacheRead: 2, output: 3 }],
    },
    {
      directory: 'b-child',
      header: {
        id: 'b-child',
        createdAt: old,
        cwd: PROJECT_ROOT,
        parentSession: { id: 'c-parent' },
      },
      steps: [{ model: 'small', input: 4, cacheRead: 5, output: 6 }],
    },
    {
      directory: 'c-parent',
      header: { id: 'c-parent', createdAt: Date.now(), cwd: PROJECT_ROOT },
      steps: [{ model: 'big', input: 7, cacheRead: 8, output: 9 }],
    },
  ]);

  try {
    const answer = read({ projectRoot: PROJECT_ROOT, days: null, env: { DSH_HOME: home } });
    assert.deepEqual(ids(answer), ['c-parent', 'b-child', 'a-grandchild']);
    assert.equal(answer.sessions[2].kind, 'subagent');
    assert.equal(answer.sessions[2].parent, 'b-child');

    // The two subagents carry a timestamp of 2020, and the parent carries the
    // time of this run. A subagent belongs to the run of its parent, so a
    // window of one day holds all three sessions.
    const near = read({ projectRoot: PROJECT_ROOT, days: 1, env: { DSH_HOME: home } });
    assert.deepEqual(ids(near), ['c-parent', 'b-child', 'a-grandchild']);
  } finally {
    removeFixture(home);
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// The two guards of read()
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test('read() with no project root raises nothing, and one note names the state', () => {
  // An empty name reaches the working directory of the process through
  // path.resolve(), so it gives the same answer as a missing name.
  for (const projectRoot of [undefined, '', '   ']) {
    const answer = read({ projectRoot, days: null, env: ENV });

    assert.deepEqual(answer.sessions, []);
    assert.deepEqual(answer.notes, [NO_ROOT_NOTE]);
  }

  // A call with no argument at all reads no directory of the host.
  assert.deepEqual(read(), { sessions: [], notes: [NO_ROOT_NOTE] });
});

test('a session directory that refuses a read raises nothing, and one note counts it', {
  skip: ROOT_SKIP,
}, () => {
  const { home, project } = createPlainHome([
    {
      directory: 'closed-one',
      header: { id: 'closed-one', createdAt: 1758153600000, cwd: PROJECT_ROOT },
      steps: [{ model: 'big', input: 10, cacheRead: 20, output: 30 }],
    },
    {
      directory: 'open-one',
      header: { id: 'open-one', createdAt: 1758153600000, cwd: PROJECT_ROOT },
      steps: [{ model: 'big', input: 1, cacheRead: 2, output: 3 }],
    },
  ]);
  const closed = path.join(project, 'closed-one');

  try {
    fs.chmodSync(closed, 0o000);
    const answer = read({ projectRoot: PROJECT_ROOT, days: null, env: { DSH_HOME: home } });

    // The directory holds the one log of one session, so the note counts one
    // log file. The other session still reaches the answer.
    assert.deepEqual(ids(answer), ['open-one']);
    assert.deepEqual(answer.notes, ['The reader could not read 1 log files.']);
  } finally {
    fs.chmodSync(closed, 0o700);
    removeFixture(home);
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// The availability check and the module shape
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test('available() reports ok for the fixture tree, and not ok for a root with no sessions directory', {
  skip: DECODE_SKIP,
}, () => {
  assert.deepEqual(available({ env: ENV }), { ok: true });

  // DSH_HOME names a directory that holds no sessions directory.
  const home = path.join(DSH_HOME, 'no-such-home');
  const answer = available({ env: { DSH_HOME: home } });
  assert.equal(answer.ok, false);
  assert.match(answer.reason, /dsh wrote no session directory at/);
  assert.match(answer.reason, /no-such-home/);
  assert.match(answer.fix, /DSH_HOME/);

  // HOME names the fallback root, and the reader then looks under ".dsh".
  const fallback = available({ env: { HOME: home } });
  assert.equal(fallback.ok, false);
  assert.match(fallback.reason, /no-such-home/);
  assert.match(fallback.reason, /\.dsh/);
});

test('available() reports the decoder before the sessions directory', { skip: DECODE_SKIP }, () => {
  // The value "none" stops the reader, whatever the tree holds.
  const answer = available({ env: { ...ENV, BEAST_MODE_ZSTD: 'none' } });
  assert.equal(answer.ok, false);
  assert.match(answer.reason, /BEAST_MODE_ZSTD holds "none"/);
  assert.match(answer.fix, /zstd/);

  // A root with no sessions directory reports the decoder first, so the
  // reason names the decoder and not the root.
  const both = available({
    env: { DSH_HOME: path.join(DSH_HOME, 'no-such-home'), BEAST_MODE_ZSTD: 'none' },
  });
  assert.equal(both.ok, false);
  assert.match(both.reason, /BEAST_MODE_ZSTD holds "none"/);

  // An unknown value names no method, so the reader selects one itself.
  assert.deepEqual(available({ env: { ...ENV, BEAST_MODE_ZSTD: 'gzip' } }), { ok: true });
});

test('the reader imports five Node.js builtin modules only', () => {
  const file = path.join(import.meta.dirname, '..', 'readers', 'dsh.js');
  const source = fs.readFileSync(file, 'utf8');
  const imported = [...source.matchAll(/^import .+ from '(.+)';$/gm)].map((match) => match[1]);

  assert.deepEqual(imported, ['node:child_process', 'node:fs', 'node:os', 'node:path', 'node:zlib']);

  // The default export carries the three fields of the reader contract.
  assert.equal(dsh.id, 'dsh');
  assert.equal(dsh.available, available);
  assert.equal(dsh.read, read);
});
