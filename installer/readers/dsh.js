// installer/readers/dsh.js
//
// The token reader of dsh, the DeepSeek Harness. It reads the session logs of
// dsh, and it returns the eleven fields of the session shape of
// installer/readers/index.js.
//
// dsh writes one directory for each session at
// <root>/sessions/<project>/<session>/, and one log file in it. The directory
// name <project> holds the encoded absolute path of the project. The reader
// ports that encoder from packages/session/session-persistence-jsonl of the
// harness, and it compares two whole keys for equality.
//
// A session directory holds one log for each format generation, and the
// highest generation wins. A log carries the name "session.jsonl", or
// "session.vN.jsonl", and a zstd compressed log adds the suffix ".zstd". A
// subagent inherits the working directory of its parent, so a subagent
// session sits beside its parent in the same project directory.
//
// The token mode holds six private steps and two exported functions. The
// transcript mode adds three steps: the session pick, the step parser of one
// log, and the exported transcript(), which returns the raw steps of one
// session and of its subagents. The two pure steps projectKey() and
// frameEnd() carry a named export too, because the tests call them directly.
// The default export keeps the three fields of the token contract, and it
// adds transcript. The module writes no file, it prints nothing, and it adds
// no flag, because installer/lib/tokens.js owns "flags", "cacheShare", and
// the totals, and installer/lib/transcript.js owns the merge, the step
// numbers, and the cut.
//
// The session pick with no id: dsh exports DSH_SESSION_ID to each tool shell
// (packages/shell/shell-env of the harness). The value names the session of
// the agent that runs the shell, so in the shell of a subagent it names the
// subagent, and not its parent. When the "env" argument holds that variable,
// and a log of that id sits in a matched project directory, the reader
// follows the parentSession field of each header up to the session that
// names no parent, and it picks that session: the run that runs the command.
// When the variable is absent, or it names no session of this project, or
// the walk reaches a parent that this project does not hold, the reader
// picks the newest log whose header names no parent session. With an id, the
// id or its unique prefix wins, and the variable changes nothing. Only the
// pick through the variable sets "current: true" on the answer, so the core
// prefers that run to a newer log of another harness.
//
// The reference of the parse rules is the analyzer dsh-usage.py. The
// per-session numbers of this reader equal the numbers of that script, apart
// from the project match: that script reads every project, and this reader
// reads one project.
//
// BEAST_MODE_ZSTD selects the decode method. It accepts "zlib", "command",
// and "none". An unset value, and every other value, select the first method
// that this host holds. The variable is the test seam of the two decode
// paths, and it is the escape hatch of a host where one path fails. No
// glossary row and no command skill names it.

import cp from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

/** One day, in milliseconds. The "days" window counts in this unit. */
const DAY_MS = 86400000;

/** The line separator of a JSONL log. */
const NEWLINE = 0x0a;

/** The name of a session log, with the format generation in group 1. */
const LOG_NAME = /^session(?:\.v([1-9][0-9]*))?\.jsonl(?:\.zstd)?$/;

/** The prefix that dsh gives to a session id. The report drops it. */
const ID_PREFIX = 'session-';

/** The largest answer of the zstd command, in bytes. */
const MAX_BUFFER = 256 * 1024 * 1024;

/** The fix line of a host with no zstd decoder. */
const FIX_ZSTD =
  'Install the "zstd" command, or run Node.js 22.15 or later, which holds zlib.zstdDecompressSync.';

/** The fix line of a root with no sessions directory. */
const FIX_ROOT = 'Run dsh one time, or set DSH_HOME to the home directory of dsh.';

/**
 * One assistant request of one session. dsh writes one "assistant/message"
 * event for each request, and it carries the whole usage record of the
 * provider, so the parser needs no key and no merge step.
 *
 * @typedef {{ input: number, cacheRead: number, output: number }} Step
 */

/**
 * @typedef {import('./index.js').Session} Session
 */

/**
 * The answer of parseLog(). "read" reports whether the decode step gave the
 * plain bytes of the log, and "cwd" carries the working directory of the
 * header, because read() owns the project match rule.
 *
 * @typedef {{
 *   session: Session | null,
 *   skipped: number,
 *   read: boolean,
 *   cwd: string | null,
 * }} Parsed
 */

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// The six private steps
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * The sessions directory of dsh.
 *
 * DSH_HOME wins, because a user moves the directory with it. dsh-usage.py
 * uses the same rule. The variable is the test seam too: a test points it at
 * a fixture log tree, so no test reads the real home directory. The value
 * arrives through the "env" argument of the contract, and never through
 * process.env.
 *
 * @param {Record<string, string | undefined>} [env] The environment of the caller.
 * @returns {string} The sessions root. It may be a relative path.
 */
function sessionsRoot(env = {}) {
  const configured = env.DSH_HOME;
  if (typeof configured === 'string' && configured.trim() !== '') {
    return path.join(configured, 'sessions');
  }
  const home = typeof env.HOME === 'string' && env.HOME !== '' ? env.HOME : os.homedir();
  return path.join(home, '.dsh', 'sessions');
}

/**
 * The project directory name of one absolute path.
 *
 * This is a port of projectKey() of
 * packages/session/session-persistence-jsonl/src/format.ts of the harness.
 * A separator becomes one "-", and a run of separators collapses to one "-".
 * A safe character stays literal. Every other code unit becomes "~" and four
 * uppercase hexadecimal digits. The rule then strips every leading "-", it
 * uses "root" for an empty answer, and it cuts the answer at 251 characters
 * between two pairs of dashes.
 *
 * The harness raises for an empty path. This port returns the key of an empty
 * path instead, because the reader never throws. read() calls this step with
 * a resolved absolute path only, so the difference reaches no answer.
 *
 * @param {string} cwd An absolute path.
 * @returns {string} The project directory name.
 */
export function projectKey(cwd) {
  let readable = '';
  let separatorRun = false;

  for (let i = 0; i < cwd.length; i++) {
    const code = cwd.charCodeAt(i);
    const ch = String.fromCharCode(code);
    if (ch === '/' || ch === '\\' || ch === ':') {
      if (!separatorRun) readable += '-';
      separatorRun = true;
    } else if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) {
      readable += ch;
      separatorRun = false;
    } else {
      readable += '~' + code.toString(16).toUpperCase().padStart(4, '0');
      separatorRun = false;
    }
  }

  const slug = readable.replace(/^-+/, '') || 'root';
  return `--${slug.slice(0, 251)}--`;
}

/**
 * The decode method of this run.
 *
 * "zlib" names zlib.zstdDecompressSync, "command" names the zstd command, and
 * "none" names no method at all. "auto" selects zlib when this host holds it,
 * and the command otherwise. An unset value, and every other value, give
 * "auto", so a typed value never stops the report.
 *
 * @param {Record<string, string | undefined>} [env] The environment of the caller.
 * @returns {'zlib' | 'command' | 'none' | 'auto'}
 */
function zstdMode(env = {}) {
  const value = typeof env.BEAST_MODE_ZSTD === 'string' ? env.BEAST_MODE_ZSTD.trim() : '';
  const name = value.toLowerCase();
  if (name === 'zlib' || name === 'command' || name === 'none') return name;
  return 'auto';
}

/**
 * The end of the zstd frame that starts at "start", or -1.
 *
 * zlib.zstdDecompressSync stops at the end of the first frame, and dsh
 * appends one frame for each group of events, so a live log of one hour holds
 * over one thousand frames. The reader therefore walks the frame headers of
 * RFC 8878, and it decodes one frame at a time. The zstd command needs no
 * such walk, because it reads every frame of its input.
 *
 * The walk reads the frame header descriptor, the optional window
 * descriptor, the optional dictionary id, and the optional content size. It
 * then walks the block headers until the last block, and it adds the four
 * bytes of the optional content checksum. A skippable frame carries its own
 * size in the four bytes after the magic number.
 *
 * @param {Buffer} buf The whole compressed file.
 * @param {number} start The first byte of the frame.
 * @returns {number} The first byte after the frame, or -1 for a broken frame.
 */
export function frameEnd(buf, start) {
  if (start + 4 > buf.length) return -1;
  const magic = buf.readUInt32LE(start);

  // A skippable frame: the magic number, the size, then the payload.
  if (magic >= 0x184d2a50 && magic <= 0x184d2a5f) {
    if (start + 8 > buf.length) return -1;
    const end = start + 8 + buf.readUInt32LE(start + 4);
    return end <= buf.length ? end : -1;
  }
  if (magic !== 0xfd2fb528) return -1;

  let at = start + 4;
  if (at >= buf.length) return -1;
  const descriptor = buf[at];
  at += 1;

  const contentSizeFlag = descriptor >> 6;
  const singleSegment = (descriptor >> 5) & 1;
  const checksum = (descriptor >> 2) & 1;
  const dictionaryFlag = descriptor & 3;

  if (singleSegment === 0) at += 1;
  at += [0, 1, 2, 4][dictionaryFlag];
  at += contentSizeFlag === 0 ? singleSegment : [0, 2, 4, 8][contentSizeFlag];
  if (at > buf.length) return -1;

  for (;;) {
    if (at + 3 > buf.length) return -1;
    const header = buf[at] | (buf[at + 1] << 8) | (buf[at + 2] << 16);
    at += 3;

    // Bit 0 marks the last block, bits 1 and 2 hold the type, and the rest
    // holds the size. A run block carries one byte, whatever the size says.
    const type = (header >> 1) & 3;
    if (type === 3) return -1;
    at += type === 1 ? 1 : header >>> 3;
    if (at > buf.length) return -1;
    if ((header & 1) === 1) break;
  }

  if (checksum === 1) at += 4;
  return at <= buf.length ? at : -1;
}

/**
 * The plain bytes of one log, or null.
 *
 * A name with no ".zstd" suffix needs no decode. A compressed log runs
 * through the method that zstdMode() selects. A failure of either method
 * gives null, and read() counts that file in the "could not read" note.
 *
 * A live session can end inside a frame, and a torn file then fails both
 * methods: the frame walk finds no end, and the command exits with a
 * non-zero status. dsh-usage.py skips the same file, and the token mode
 * keeps that rule on purpose. The step parser of the transcript mode keeps
 * the complete frames of such a file, through decodeSteps().
 *
 * @param {string} file The absolute path of the log.
 * @param {Record<string, string | undefined>} [env] The environment of the caller.
 * @returns {Buffer | null} The plain bytes, or null for an unread file.
 */
function decodeLog(file, env = {}) {
  if (!file.endsWith('.zstd')) {
    try {
      return fs.readFileSync(file);
    } catch {
      return null;
    }
  }

  const mode = zstdMode(env);
  if (mode === 'none') return null;
  if (mode === 'zlib' || (mode === 'auto' && hasZlibZstd())) return decodeFrames(file);
  return decodeCommand(file);
}

/**
 * The plain bytes of one compressed log, through zlib.zstdDecompressSync.
 *
 * @param {string} file The absolute path of the log.
 * @returns {Buffer | null}
 */
function decodeFrames(file) {
  if (!hasZlibZstd()) return null;

  /** @type {Buffer} */
  let buf;
  try {
    buf = fs.readFileSync(file);
  } catch {
    return null;
  }

  /** @type {Buffer[]} One plain buffer for each frame, in file order. */
  const parts = [];
  let at = 0;
  try {
    while (at < buf.length) {
      const end = frameEnd(buf, at);
      if (end <= at) return null;
      parts.push(zlib.zstdDecompressSync(buf.subarray(at, end)));
      at = end;
    }
  } catch {
    // A frame of the walk holds broken data. The whole file counts as unread.
    return null;
  }

  if (parts.length === 0) return null;
  return Buffer.concat(parts);
}

/**
 * The plain bytes of one compressed log, through the zstd command.
 *
 * A non-zero status, an "error" field, and an empty answer each count as an
 * unread file.
 *
 * @param {string} file The absolute path of the log.
 * @returns {Buffer | null}
 */
function decodeCommand(file) {
  /** @type {import('node:child_process').SpawnSyncReturns<Buffer>} */
  let run;
  try {
    run = cp.spawnSync('zstd', ['-dc', file], { maxBuffer: MAX_BUFFER });
  } catch {
    return null;
  }
  if (run.error || run.status !== 0) return null;
  if (!run.stdout || run.stdout.length === 0) return null;
  return run.stdout;
}

/**
 * The log file of the highest format generation of one session directory, or
 * null.
 *
 * A name with no "vN" part counts as generation 0. dsh-usage.py uses the same
 * rule with a looser digit class, and the class here matches
 * CANONICAL_LOG_FILENAME of the harness, so the reader and the harness agree.
 * The pick compares a plain file and a compressed file in one directory, and
 * it ignores "session.lock" and every other name.
 *
 * The names run in sort order, and the comparison is strict, so two names of
 * one generation keep the first name in sort order.
 *
 * The answer separates a directory that holds no log name from a directory
 * that refuses a read. A directory with mode 000 gives "read: false", and
 * read() counts it in the "could not read" note, because that directory holds
 * the one log of one session. A directory with "read: true" and no file holds
 * no log at all, and that state is a normal state of dsh.
 *
 * @param {string} directory The absolute path of the session directory.
 * @returns {{ read: boolean, file: string | null }} The read state, and the absolute path of the log.
 */
function pickLog(directory) {
  /** @type {import('node:fs').Dirent[]} */
  let entries;
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return { read: false, file: null };
  }

  /** @type {string | null} */
  let best = null;
  let bestGeneration = -1;

  for (const name of entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort()) {
    const match = LOG_NAME.exec(name);
    if (match === null) continue;
    const generation = match[1] === undefined ? 0 : Number(match[1]);
    if (generation > bestGeneration) {
      bestGeneration = generation;
      best = path.join(directory, name);
    }
  }

  return { read: true, file: best };
}

/**
 * One session of one log file, or null.
 *
 * One "assistant/message" event is one step, and dsh-usage.py holds the same
 * rule. "inputTokens" names the part of the prompt that the provider does not
 * serve from the cache, and "cacheReadTokens" names the cached part, so the
 * prompt of one step is the sum of the two. "usage.totalTokens" reaches no
 * contract field.
 *
 * A line that is not JSON raises nothing. The parser counts it and it returns
 * the count, because the note of the report names the total of the whole run.
 * A log with no header gives no session, and a log with no step gives no
 * session. dsh-usage.py drops a log with no header too, but it keeps a log
 * with no step as a session of 0 steps. The session count of the two tools
 * can therefore differ, and the token sums stay equal.
 *
 * @param {string} file The absolute path of the log.
 * @param {string} dirName The name of the session directory. It is the fallback id.
 * @param {Record<string, string | undefined>} [env] The environment of the caller.
 * @returns {Parsed}
 */
function parseLog(file, dirName, env = {}) {
  const plain = decodeLog(file, env);
  if (plain === null) return { session: null, skipped: 0, read: false, cwd: null };

  /** @type {Record<string, any> | null} The first "session" event of the log. */
  let header = null;
  /** @type {Step[]} The steps, in file order. */
  const steps = [];
  /** @type {Map<string, number>} The step count of each named model, in first-step order. */
  const models = new Map();
  let skipped = 0;

  for (const line of eachLine(plain)) {
    const text = line.trim();
    if (text === '') continue;

    let event;
    try {
      event = JSON.parse(text);
    } catch {
      skipped += 1;
      continue;
    }
    if (!event || typeof event !== 'object') continue;

    if (event.type === 'session') {
      if (header === null) header = event;
      continue;
    }
    if (event.type !== 'assistant/message') continue;

    const data = event.data && typeof event.data === 'object' ? event.data : {};
    const message = data.message && typeof data.message === 'object' ? data.message : {};
    const source = message.source && typeof message.source === 'object' ? message.source : {};
    const usage = data.usage && typeof data.usage === 'object' ? data.usage : {};

    // The map counts a named model only. A step with no name counts in no
    // model, and mainModel() gives "?" for a log where no step names a model.
    // dsh-usage.py counts "?" as a model, so the main model of the two tools
    // can differ for a log where some steps name no model. Every token sum
    // stays equal, because the map reaches no number of the session.
    const model = typeof source.model === 'string' && source.model !== '' ? source.model : null;

    steps.push({
      input: count(usage.inputTokens),
      cacheRead: count(usage.cacheReadTokens),
      output: count(usage.outputTokens),
    });
    if (model !== null) models.set(model, (models.get(model) ?? 0) + 1);
  }

  const cwd = header !== null && typeof header.cwd === 'string' && header.cwd !== ''
    ? header.cwd
    : null;

  if (header === null || steps.length === 0) {
    return { session: null, skipped, read: true, cwd };
  }

  let promptTokens = 0;
  let cacheReadTokens = 0;
  let outputTokens = 0;
  for (const step of steps) {
    promptTokens += step.input + step.cacheRead;
    cacheReadTokens += step.cacheRead;
    outputTokens += step.output;
  }

  const last = steps[steps.length - 1];
  const parent = parentId(header.parentSession);

  return {
    session: {
      id: shortId(typeof header.id === 'string' && header.id !== '' ? header.id : dirName),
      kind: parent === null ? 'parent' : 'subagent',
      parent,
      model: mainModel(models),
      steps: steps.length,
      finalPromptTokens: last.input + last.cacheRead,
      promptTokens,
      cacheReadTokens,
      outputTokens,
      created: createdAt(header.createdAt),
      // A dsh log carries no cost, so the report prints a dash for this row.
      costUsd: null,
    },
    skipped,
    read: true,
    cwd,
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// The small helpers of the private steps
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Whether this host holds the zstd decoder of node:zlib. Node.js 22.15 and
 * later hold it, and the engines field of the installer stays at node >=20.
 *
 * @returns {boolean}
 */
function hasZlibZstd() {
  return typeof zlib.zstdDecompressSync === 'function';
}

/**
 * Whether this host holds the zstd command. The check runs the command one
 * time, and it reads no file and writes no file.
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
 * Each line of one plain buffer, in file order.
 *
 * A decoded log reaches tens of megabytes, and an array of lines then holds a
 * second copy of the whole file. The function yields instead, so the peak
 * stays at the buffer plus one line.
 *
 * @param {Buffer} buf The plain bytes of one log.
 * @yields {string} One line, with no line separator.
 */
function* eachLine(buf) {
  let start = 0;
  let stop = buf.indexOf(NEWLINE, start);

  while (stop !== -1) {
    yield buf.toString('utf8', start, stop);
    start = stop + 1;
    stop = buf.indexOf(NEWLINE, start);
  }

  if (start < buf.length) yield buf.toString('utf8', start);
}

/**
 * One token count of one usage record. A missing value, a value of another
 * type, and a negative value all give zero, because the session shape refuses
 * every number under zero.
 *
 * @param {unknown} value
 * @returns {number}
 */
function count(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * One session id with no "session-" prefix. The report prints a short id, and
 * dsh-usage.py drops the same prefix.
 *
 * @param {string} value The id of the header, or the name of the directory.
 * @returns {string}
 */
function shortId(value) {
  return value.startsWith(ID_PREFIX) ? value.slice(ID_PREFIX.length) : value;
}

/**
 * The parent session id of one header, or null.
 *
 * dsh writes an object for one harness version and a string for another, and
 * dsh-usage.py reads both shapes. An object with no id gives null, and the
 * session then counts as a parent, because the contract refuses a subagent
 * with no parent name.
 *
 * @param {unknown} link The "parentSession" field of the header.
 * @returns {string | null}
 */
function parentId(link) {
  if (typeof link === 'string' && link !== '') return shortId(link);
  if (link && typeof link === 'object') {
    const id = /** @type {Record<string, unknown>} */ (link).id;
    if (typeof id === 'string' && id !== '') return shortId(id);
  }
  return null;
}

/**
 * The model of most steps.
 *
 * The map holds the models in first-step order, and the comparison is strict,
 * so the earliest step wins a tie. The map holds a named model only, so a log
 * where no step names a model gives "?", and a named model of one step wins
 * over every step with no name.
 *
 * @param {Map<string, number>} models
 * @returns {string}
 */
function mainModel(models) {
  let model = '?';
  let best = 0;
  for (const [name, seen] of models) {
    if (seen > best) {
      best = seen;
      model = name;
    }
  }
  return model;
}

/**
 * The creation time of one header, as an ISO 8601 string, or null.
 *
 * "createdAt" holds epoch milliseconds. An absent value, a zero value, and a
 * value of another type all give null, and the window then keeps the session.
 *
 * @param {unknown} value The "createdAt" field of the header.
 * @returns {string | null}
 */
function createdAt(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value === 0) return null;
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}

/**
 * Whether one path is a directory. A path that does not exist, and a path the
 * user cannot read, both give false.
 *
 * @param {string} target
 * @returns {boolean}
 */
function isDirectory(target) {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

/**
 * The match roots of one project: the resolved path, and the real path.
 *
 * path.resolve() removes a trailing slash, and it also resolves a relative
 * path and a ".." segment. fs.realpathSync() resolves a symlink, and it
 * raises for a path that does not exist. The resolved root then stays alone.
 *
 * @param {string} projectRoot
 * @returns {string[]} One root, or two. The resolved path comes first.
 */
function projectRoots(projectRoot) {
  const roots = [path.resolve(projectRoot)];
  try {
    const real = fs.realpathSync(roots[0]);
    if (!roots.includes(real)) roots.push(real);
  } catch {
    // The project root does not exist here. The resolved root stays alone.
  }
  return roots;
}

/**
 * Whether the header of one session names this project.
 *
 * The directory key cuts at 251 characters, so two long paths can share one
 * key. The header carries the working directory of the session, so the reader
 * checks it too. A header with no working directory passes, because an early
 * harness version wrote no such field. The check costs no extra read, because
 * the header is already parsed.
 *
 * @param {string | null} cwd The working directory of the header, or null.
 * @param {string[]} roots The match roots of the project.
 * @returns {boolean}
 */
function sameProject(cwd, roots) {
  if (cwd === null) return true;
  return roots.includes(path.resolve(cwd));
}

/**
 * Whether one parent session sits inside the window.
 *
 * A session with no "created" value, and a session with a value that does not
 * parse, stay in every window. The reader never drops a session over a
 * timestamp it cannot read.
 *
 * @param {string | null | undefined} created
 * @param {number | null} cutoff The oldest millisecond of the window, or null.
 * @returns {boolean}
 */
function inWindow(created, cutoff) {
  if (cutoff === null) return true;
  if (typeof created !== 'string' || created === '') return true;
  const at = Date.parse(created);
  if (Number.isNaN(at)) return true;
  return at >= cutoff;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// The two exported functions
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Whether this reader can run here. It reads one path, it can run the zstd
 * command one time, and it writes nothing.
 *
 * The decode check runs first, because a host with no decoder reads no
 * compressed log, and every current log of dsh is compressed. The check of
 * the sessions directory follows it.
 *
 * @param {{ env?: Record<string, string | undefined> }} [ctx]
 * @returns {{ ok: true } | { ok: false, reason: string, fix: string }}
 */
export function available({ env = {} } = {}) {
  const mode = zstdMode(env);

  if (mode === 'none') {
    return {
      ok: false,
      reason: 'BEAST_MODE_ZSTD holds "none", so the reader decodes no zstd session log of dsh.',
      fix: FIX_ZSTD,
    };
  }
  const decodes =
    mode === 'zlib'
      ? hasZlibZstd()
      : mode === 'command'
        ? hasZstdCommand()
        : hasZlibZstd() || hasZstdCommand();
  if (!decodes) {
    return {
      ok: false,
      reason: 'This host holds no zstd decoder for the compressed session logs of dsh.',
      fix: FIX_ZSTD,
    };
  }

  const root = sessionsRoot(env);
  if (!isDirectory(root)) {
    return {
      ok: false,
      reason: `dsh wrote no session directory at "${root}".`,
      fix: FIX_ROOT,
    };
  }

  return { ok: true };
}

/**
 * The sessions of the project at projectRoot, and the notes of the run.
 *
 * The reader finds the matched project directory, it parses every session
 * directory one time, it applies the window to each parent, then it keeps
 * every subagent of each kept parent. dsh gives a subagent a subagent of its
 * own, so the step repeats until a pass adds no session. A subagent of a kept
 * session stays, whatever its own timestamp holds, because a subagent belongs
 * to the run of its parent. A subagent whose parent name matches no kept
 * session falls out, so every parent name of the answer names a session of
 * the answer.
 *
 * A log of another project appears in no answer, because the match compares
 * two whole keys and it checks the working directory of the header.
 *
 * The reader never throws. A call with a bad project root, and a call with no
 * argument, each give no session and one note.
 *
 * @param {{
 *   projectRoot?: string,
 *   days?: number | null,
 *   env?: Record<string, string | undefined>,
 * }} [ctx]
 * @returns {{ sessions: Session[], notes: string[] }}
 */
export function read({ projectRoot, days = null, env = {} } = {}) {
  // The guard runs before every other step, because the reader never throws.
  // An empty name reaches the working directory of the process through
  // path.resolve(). That answer names the sessions of another project. An
  // empty name therefore gives the same note as a missing name.
  if (typeof projectRoot !== 'string' || projectRoot.trim() === '') {
    return {
      sessions: [],
      notes: ['The caller named no project root, so the reader read no session log of dsh.'],
    };
  }

  const root = sessionsRoot(env);
  const roots = projectRoots(projectRoot);
  const keys = roots.map(projectKey);
  /** @type {Session[]} */
  const sessions = [];
  /** @type {string[]} */
  const notes = [];
  let skipped = 0;
  let unreadable = 0;

  /** @type {string[]} */
  let names = [];
  try {
    names = fs
      .readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    // available() reports this state as the reason and the fix. read() then
    // returns the same answer as an empty log tree.
    names = [];
  }

  const matched = names.filter((name) => keys.includes(name)).sort();

  if (matched.length === 0) {
    notes.push(
      'No session directory of dsh matches this project. ' +
        `The reader looked for "${keys[0]}" under "${root}".`
    );
    return { sessions, notes };
  }

  /** @type {Session[]} The parents of the project, in directory order. */
  const parents = [];
  /** @type {Session[]} The subagents of the project, in directory order. */
  const subagents = [];

  for (const name of matched) {
    const project = path.join(root, name);

    /** @type {string[]} */
    let directories = [];
    try {
      directories = fs
        .readdirSync(project, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
    } catch {
      unreadable += 1;
      continue;
    }

    for (const directory of directories) {
      const picked = pickLog(path.join(project, directory));
      if (!picked.read) {
        // The session directory refuses a read, so the one log of that
        // session stays unread. It counts in the same note as a log file
        // that the decode step cannot read.
        unreadable += 1;
        continue;
      }
      if (picked.file === null) continue;

      /** @type {Parsed} */
      let parsed;
      try {
        parsed = parseLog(picked.file, directory, env);
      } catch {
        unreadable += 1;
        continue;
      }

      skipped += parsed.skipped;
      if (!parsed.read) {
        unreadable += 1;
        continue;
      }
      if (parsed.session === null) continue;
      if (!sameProject(parsed.cwd, roots)) continue;

      if (parsed.session.kind === 'parent') parents.push(parsed.session);
      else subagents.push(parsed.session);
    }
  }

  const cutoff =
    typeof days === 'number' && Number.isFinite(days) && days > 0
      ? Date.now() - days * DAY_MS
      : null;

  for (const parent of parents) {
    if (!inWindow(parent.created, cutoff)) continue;
    sessions.push(parent);

    // dsh holds a delegation depth over 1, so a subagent of a subagent names
    // no parent of the run. Each pass adds every subagent of a kept id, and
    // the walk stops at the first pass that adds no session. The pass keeps
    // the directory order, so a parent comes before its own subagents.
    //
    // "held" keeps the session object, and not the id, because two session
    // directories can carry one id. Both sessions then stay in the answer.
    // The walk always stops, because each pass adds one object or more, or it
    // adds none and the walk ends.

    /** @type {Set<string>} The ids of this run, the parent and its subagents. */
    const ids = new Set([parent.id]);
    /** @type {Set<Session>} The subagents that this run already holds. */
    const held = new Set();

    let added = true;
    while (added) {
      added = false;
      for (const subagent of subagents) {
        const name = subagent.parent;
        if (name === null || held.has(subagent) || !ids.has(name)) continue;
        held.add(subagent);
        ids.add(subagent.id);
        sessions.push(subagent);
        added = true;
      }
    }
  }

  // No note names one file, because a project holds many session directories.
  // The "could not read" note counts one log for each session that the reader
  // did not get. Three states count in it. The decode step cannot read a log,
  // the parse step cannot read a log, and a session directory refuses a read.
  // A session directory holds the one log of one session, so the count of the
  // note stays true. installer/readers/claude.js prints the same line, and it
  // counts a directory that refuses a read in it too.
  if (skipped > 0) {
    notes.push(`The reader skipped ${skipped} lines of the log that are not JSON.`);
  }
  if (unreadable > 0) {
    notes.push(`The reader could not read ${unreadable} log files.`);
  }

  return { sessions, notes };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// The transcript mode: the shapes and the small helpers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * @typedef {import('./index.js').RawStep} RawStep
 * @typedef {import('./index.js').RawTranscript} RawTranscript
 */

/**
 * One session log of the session pick. Each field comes from the directory
 * listing or from the header, so the pick decodes no event of a body.
 *
 * @typedef {Object} LogEntry
 * @property {string} name The name of the session directory.
 * @property {string} id The session id with no "session-" prefix, in the form of the token report.
 * @property {string | null} parent The parent session id of a subagent, or null.
 * @property {string | null} created The "createdAt" field of the header as ISO 8601, or null.
 * @property {string} file The absolute path of the log.
 * @property {number} mtimeMs The modification time of the log, in milliseconds.
 */

/**
 * The answer of parseSteps(): the raw steps of one log in log order, the
 * time of the first event, and the count of the lines that are not JSON.
 * In a seeded child, the steps and the first event start at the last tagged
 * "session/end-seed" marker. A cut last frame of a compressed log counts as
 * one line that is not JSON.
 *
 * @typedef {{ steps: RawStep[], first: string | null, skipped: number }} LogSteps
 */

/**
 * The step kind of each dsh tool. Every other tool gives "other". The base
 * bundle of dsh registers two delegation tools: "subagent" (provider
 * "spawn") and "subagent_fork" (provider "fork").
 */
const TOOL_KINDS = new Map([
  ['ask_user_question', 'ask'],
  ['read', 'read'],
  ['write', 'write'],
  ['edit', 'edit'],
  ['bash', 'shell'],
  ['grep', 'search'],
  ['glob', 'search'],
  ['subagent', 'delegate'],
  ['subagent_fork', 'delegate'],
]);

/** The longest text of an "other" step, and of a raw argument text, in characters. */
const OTHER_LIMIT = 120;

/** The mark at the end of a cut text. */
const CUT_MARK = '...';

/** The error of a failed tool result that holds no text. */
const EMPTY_ERROR = '(no text)';

/** The most ids that the note of an ambiguous id lists. */
const MAX_LISTED = 5;

/** The count of bytes at the start of a log that the header read takes. */
const HEAD_BYTES = 64 * 1024;

/**
 * The whole result text of a "subagent" or a "subagent_fork" call that
 * starts a continuable child: "started subagent <id>", where the id names
 * the session of the child. A call with "run_in_background: false", and a
 * one-shot "subagent_fork" call of the base bundle, return the answer of the
 * child, and a background job returns "started background subagent job
 * <id>". Neither text names an agent session, so neither adds an id.
 */
const STARTED_AGENT = /^started subagent (\S+)$/;

/**
 * Cut one text to a limit. A cut ends with "...", and it keeps a surrogate
 * pair whole.
 *
 * @param {string} text
 * @param {number} limit
 * @returns {string}
 */
function clip(text, limit) {
  if (text.length <= limit) return text;
  let end = limit - CUT_MARK.length;
  const code = text.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end -= 1;
  return `${text.slice(0, end)}${CUT_MARK}`;
}

/**
 * One text value of an event, or null for a missing value and an empty one.
 *
 * @param {unknown} value
 * @returns {string | null}
 */
function textOf(value) {
  return typeof value === 'string' && value !== '' ? value : null;
}

/**
 * One whole number of a tool input, or null. A number in a text counts too.
 *
 * @param {unknown} value
 * @returns {number | null}
 */
function wholeNumber(value) {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) ? Math.trunc(number) : null;
}

/**
 * The line range of a "read" input: "lines 10-14", or "from line 40" with
 * no "limit". The read tool of dsh takes the first line, one-based, as
 * "offset" and the line count as "limit", as the Read tool of Claude Code
 * does. An input with neither gives an empty text.
 *
 * @param {Record<string, unknown>} input
 * @returns {string}
 */
function lineRange(input) {
  const offset = wholeNumber(input.offset);
  const limit = wholeNumber(input.limit);
  if (offset === null && limit === null) return '';
  const start = offset !== null && offset > 0 ? offset : 1;
  if (limit === null || limit <= 0) return `from line ${start}`;
  return `lines ${start}-${start + limit - 1}`;
}

/**
 * The text of one content list: the "text" blocks, joined with a line
 * break. A string counts as one text, and every other block gives no text,
 * for example "image", "file", and "reasoning".
 *
 * @param {unknown} content
 * @returns {string}
 */
function blockText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n');
}

/**
 * The input of one "tool-call" block. dsh writes "arguments" as the raw JSON
 * text of the model. A text that does not parse gives "ok: false" and the
 * raw text. A missing value gives an undefined input, and a value that is
 * no text counts as the input itself.
 *
 * @param {unknown} value The "arguments" field of the block.
 * @returns {{ ok: true, input: unknown } | { ok: false, raw: string }}
 */
function callInput(value) {
  if (typeof value !== 'string') return { ok: true, input: value };
  try {
    return { ok: true, input: JSON.parse(value) };
  } catch {
    return { ok: false, raw: value };
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// The transcript mode: the step parser of one log
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * One step of one "tool-call" block, per the kinds table. The text of an
 * "ask" step holds the first question until the result arrives. The two
 * delegation tools of dsh take no agent type, so a "delegate" step holds the
 * "description" alone. An "arguments" text that does not parse gives a step
 * with no file, and the raw text, cut to 120 characters.
 *
 * @param {Record<string, any>} block
 * @param {string | null} at
 * @returns {RawStep}
 */
function toolStep(block, at) {
  const tool = textOf(block.name);
  const kind = /** @type {RawStep['kind']} */ ((tool !== null && TOOL_KINDS.get(tool)) || 'other');
  const parsed = callInput(block.arguments);
  if (!parsed.ok) {
    return { at, kind, tool, file: null, text: clip(parsed.raw, OTHER_LIMIT), error: null };
  }

  /** @type {Record<string, any>} */
  const input =
    parsed.input && typeof parsed.input === 'object' && !Array.isArray(parsed.input)
      ? parsed.input
      : {};
  /** @type {string | null} */
  let file = null;
  let text = '';

  switch (kind) {
    case 'ask': {
      const first = Array.isArray(input.questions) ? input.questions[0] : null;
      text = first && typeof first.question === 'string' ? first.question : '';
      break;
    }
    case 'read':
      file = textOf(input.file_path);
      text = lineRange(input);
      break;
    case 'write':
    case 'edit':
      file = textOf(input.file_path);
      break;
    case 'shell':
      text = typeof input.command === 'string' ? input.command : '';
      break;
    case 'search': {
      const pattern = typeof input.pattern === 'string' ? input.pattern : '';
      const where = textOf(input.path);
      text = where === null ? pattern : `${pattern} in ${where}`;
      break;
    }
    case 'delegate':
      text = textOf(input.description) ?? '';
      break;
    default:
      text = parsed.input === undefined ? '' : clip(JSON.stringify(parsed.input), OTHER_LIMIT);
  }

  return { at, kind, tool, file, text, error: null };
}

/**
 * Add the "tool-result" block of one "tool/result" event to the step of its
 * call. A failed result gives the error. The result of an "ask" step holds
 * the answer of the user, so it becomes the text. A "delegate" result that
 * reads "started subagent <id>" names the child session, and it adds
 * " -> <id>" with no "session-" prefix, so the id equals the agent id of the
 * transcript.
 *
 * @param {RawStep} step
 * @param {Record<string, any>} block
 * @returns {void}
 */
function addResult(step, block) {
  const text = blockText(block.content);
  if (block.isError === true) {
    step.error = text.trim() === '' ? EMPTY_ERROR : text;
  } else if (step.kind === 'ask' && text.trim() !== '') {
    step.text = text;
  }

  if (step.kind === 'delegate') {
    const started = STARTED_AGENT.exec(text.trim());
    if (started !== null) {
      const agentId = shortId(started[1]);
      step.text = step.text === '' ? `-> ${agentId}` : `${step.text} -> ${agentId}`;
    }
  }
}

/**
 * The plain bytes of one log for the step parser, with the count of its cut
 * frames, or null for a log that the decode step cannot read.
 *
 * A session that crashes ends inside a zstd frame, and such a session is a
 * likely target of a review. decodeLog() reads a torn log as an unread
 * file, and the token mode keeps that rule. dsh keeps the complete frames of
 * such a log, so this decode keeps them too. The walk finds the end of each
 * frame with frameEnd(), and it stops at the first frame with no end. That
 * frame counts as one cut frame. The zlib method decodes each complete
 * frame, and the command method sends the complete frames to "zstd -dc" on
 * its standard input. A complete frame that does not decode, and a log with
 * no complete frame, still give null. A plain log takes the path of
 * decodeLog(), because the parser counts its torn last line.
 *
 * @param {string} file The absolute path of the log.
 * @param {Record<string, string | undefined>} env The environment of the caller.
 * @returns {{ plain: Buffer, cut: number } | null}
 */
function decodeSteps(file, env) {
  if (!file.endsWith('.zstd')) {
    const plain = decodeLog(file, env);
    return plain === null ? null : { plain, cut: 0 };
  }

  const mode = zstdMode(env);
  if (mode === 'none') return null;
  const viaZlib = mode === 'zlib' || (mode === 'auto' && hasZlibZstd());
  if (viaZlib && !hasZlibZstd()) return null;

  /** @type {Buffer} */
  let buf;
  try {
    buf = fs.readFileSync(file);
  } catch {
    return null;
  }

  /** @type {Buffer[]} One plain buffer for each complete frame, in file order. */
  const parts = [];
  let frames = 0;
  let at = 0;
  try {
    while (at < buf.length) {
      const end = frameEnd(buf, at);
      if (end <= at) break;
      if (viaZlib) parts.push(zlib.zstdDecompressSync(buf.subarray(at, end)));
      frames += 1;
      at = end;
    }
  } catch {
    // A complete frame holds broken data. The whole file counts as unread.
    return null;
  }
  if (frames === 0) return null;
  const cut = at < buf.length ? 1 : 0;
  if (viaZlib) return { plain: Buffer.concat(parts), cut };

  /** @type {import('node:child_process').SpawnSyncReturns<Buffer>} */
  let run;
  try {
    run = cp.spawnSync('zstd', ['-dc'], { input: buf.subarray(0, at), maxBuffer: MAX_BUFFER });
  } catch {
    return null;
  }
  if (run.error || run.status !== 0) return null;
  if (!run.stdout || run.stdout.length === 0) return null;
  return { plain: run.stdout, cut };
}

/**
 * The raw steps of one log, or null for a log that the decode step cannot
 * read.
 *
 * A "user/message" event whose "data.source.kind" is "user" gives one "user"
 * step, from the "text" blocks of "data.content". Every other source gives
 * no step, for example "plugin", "skill-invocation", "agent-message", and
 * "subagent-settled". An "assistant/message" event gives one step for each
 * "tool-call" block of "data.message.content", and a "text" block and a
 * "reasoning" block give no step. A "tool/result" event adds to the step of
 * "data.message.source.callId". Only the first event of a call counts,
 * because a compaction appends a second "tool/result" for the same call.
 * Every other event type gives no step, for example "tool/call",
 * "system/message", and "turn/start". "at" is the event "time", in epoch
 * milliseconds, as ISO 8601.
 *
 * A seeded child (a header with "isSeeded" true) starts with a copy of the
 * completed turns of its parent, then a "session/end-seed" event whose
 * "data.inherited" is true, then its own events. The "subagent_fork" tool
 * writes such a child, and a session fork writes one too. Each tagged
 * marker clears the steps, the calls, and the time of the first event, so
 * the last tagged marker wins, as dsh reads it. The marker is the first
 * event of the child, so its own time starts the time of the first event
 * again. A marker with no tag ends a resume, and it changes nothing.
 *
 * A compressed log goes through decodeSteps(), so the steps of its complete
 * frames stay, and a cut last frame adds one to the skipped count.
 *
 * @param {string} file The absolute path of the log.
 * @param {Record<string, string | undefined>} env The environment of the caller.
 * @returns {LogSteps | null}
 */
function parseSteps(file, env) {
  const decoded = decodeSteps(file, env);
  if (decoded === null) return null;

  /** @type {RawStep[]} */
  const steps = [];
  /** @type {Map<string, RawStep>} The step of each call id. */
  const calls = new Map();
  /** @type {Set<RawStep>} The steps that hold a result already. */
  const answered = new Set();
  /** @type {string | null} */
  let first = null;
  let skipped = decoded.cut;

  for (const line of eachLine(decoded.plain)) {
    const text = line.trim();
    if (text === '') continue;

    let event;
    try {
      event = JSON.parse(text);
    } catch {
      skipped += 1;
      continue;
    }
    if (!event || typeof event !== 'object' || event.type === 'session') continue;
    const data = event.data && typeof event.data === 'object' ? event.data : {};

    // The tagged marker ends the copy of a seeded child. The check runs
    // before the time read, because the marker is the first event of the
    // child.
    if (event.type === 'session/end-seed' && data.inherited === true) {
      steps.length = 0;
      calls.clear();
      answered.clear();
      first = null;
    }

    // The event time holds epoch milliseconds, as the "createdAt" field of
    // the header does, so createdAt() reads both.
    const at = createdAt(event.time);
    if (first === null && at !== null) first = at;

    if (event.type === 'user/message') {
      const source = data.source && typeof data.source === 'object' ? data.source : {};
      if (source.kind === 'user') {
        steps.push({ at, kind: 'user', tool: null, file: null, text: blockText(data.content), error: null });
      }
    } else if (event.type === 'assistant/message') {
      const message = data.message && typeof data.message === 'object' ? data.message : {};
      if (!Array.isArray(message.content)) continue;
      for (const block of message.content) {
        if (!block || typeof block !== 'object' || block.type !== 'tool-call') continue;
        const step = toolStep(block, at);
        steps.push(step);
        const key = textOf(block.id);
        if (key !== null) calls.set(key, step);
      }
    } else if (event.type === 'tool/result') {
      const message = data.message && typeof data.message === 'object' ? data.message : {};
      const source = message.source && typeof message.source === 'object' ? message.source : {};
      const content = Array.isArray(message.content) ? message.content : [];
      const block =
        content.find((item) => item && typeof item === 'object' && item.type === 'tool-result') ?? null;
      const key = textOf(source.callId) ?? (block === null ? null : textOf(block.toolCallId));
      if (key === null) continue;
      const step = calls.get(key);
      if (step === undefined || answered.has(step)) continue;
      answered.add(step);
      if (block !== null) addResult(step, block);
    }
  }

  return { steps, first, skipped };
}

/**
 * The raw steps of one log of the pick, or null for a log that the reader
 * cannot read. The guard turns a raise into an unread log, as read() does
 * for parseLog().
 *
 * @param {LogEntry} log
 * @param {Record<string, string | undefined>} env
 * @returns {LogSteps | null}
 */
function stepsOf(log, env) {
  try {
    return parseSteps(log.file, env);
  } catch {
    return null;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// The transcript mode: the session pick
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * The modification time of one log in milliseconds, or null when the log
 * cannot be read.
 *
 * @param {string} file
 * @returns {number | null}
 */
function modified(file) {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return null;
  }
}

/**
 * The first bytes of one log, up to HEAD_BYTES, or null when the log cannot
 * be read.
 *
 * @param {string} file
 * @returns {Buffer | null}
 */
function readStart(file) {
  /** @type {number | null} */
  let fd = null;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(HEAD_BYTES);
    let size = 0;
    while (size < HEAD_BYTES) {
      const got = fs.readSync(fd, buf, size, HEAD_BYTES - size, size);
      if (got === 0) break;
      size += got;
    }
    return buf.subarray(0, size);
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        // The descriptor is closed already, and the read holds its bytes.
      }
    }
  }
}

/**
 * The plain bytes of the first zstd frame of one compressed log, or null.
 *
 * dsh writes the header alone into the first frame of a log, so the header
 * read decodes that one frame. The method follows zstdMode(), as
 * decodeLog() does: zlib decodes the frame in this process, and the zstd
 * command reads it from its standard input.
 *
 * @param {Buffer} start The first bytes of the log.
 * @param {Record<string, string | undefined>} env The environment of the caller.
 * @returns {Buffer | null}
 */
function decodeFirstFrame(start, env) {
  const end = frameEnd(start, 0);
  if (end <= 0) return null;
  const frame = start.subarray(0, end);

  const mode = zstdMode(env);
  if (mode === 'none') return null;
  if (mode === 'zlib' || (mode === 'auto' && hasZlibZstd())) {
    if (!hasZlibZstd()) return null;
    try {
      return zlib.zstdDecompressSync(frame);
    } catch {
      return null;
    }
  }

  try {
    const run = cp.spawnSync('zstd', ['-dc'], { input: frame, maxBuffer: MAX_BUFFER });
    if (run.error || run.status !== 0 || !run.stdout || run.stdout.length === 0) return null;
    return run.stdout;
  } catch {
    return null;
  }
}

/**
 * The first "session" event of one plain buffer, or null.
 *
 * With "whole" false, the buffer holds the start of a log, and its last
 * line can stop in the middle, so the scan reads only the lines that end
 * with a line separator. A line that is not JSON names no header. The scan
 * counts no such line, because the step parser counts it.
 *
 * @param {Buffer} buf
 * @param {boolean} whole Whether the buffer holds the whole log.
 * @returns {Record<string, any> | null}
 */
function headerIn(buf, whole) {
  const lines = whole ? buf : buf.subarray(0, buf.lastIndexOf(NEWLINE) + 1);
  for (const line of eachLine(lines)) {
    const text = line.trim();
    if (text === '') continue;
    try {
      const event = JSON.parse(text);
      if (event && typeof event === 'object' && event.type === 'session') return event;
    } catch {
      // A line that is not JSON names no header.
    }
  }
  return null;
}

/**
 * The header of one log: its first "session" event, as parseLog() reads it,
 * or null for a log with no header. "read" is false when the decode step
 * cannot read the log.
 *
 * The read takes the start of the log first: the first HEAD_BYTES of a
 * plain log, or the first zstd frame of a compressed log. A log of one hour
 * holds tens of megabytes, and the pick reads the header of every session of
 * the project, so the start saves the decode of each body. When the start
 * holds no header, the read decodes the whole log, so the answer always
 * equals the header that parseLog() finds.
 *
 * @param {string} file The absolute path of the log.
 * @param {Record<string, string | undefined>} env The environment of the caller.
 * @returns {{ read: boolean, header: Record<string, any> | null }}
 */
function readHeader(file, env) {
  const start = readStart(file);
  if (start !== null) {
    if (file.endsWith('.zstd')) {
      const frame = decodeFirstFrame(start, env);
      const header = frame === null ? null : headerIn(frame, false);
      if (header !== null) return { read: true, header };
    } else {
      const whole = start.length < HEAD_BYTES;
      const header = headerIn(start, whole);
      if (header !== null || whole) return { read: true, header };
    }
  }

  const plain = decodeLog(file, env);
  if (plain === null) return { read: false, header: null };
  return { read: true, header: headerIn(plain, true) };
}

/**
 * Every session log of the matched project directories, in directory order,
 * with the fields of its header.
 *
 * The match is the match of read(): two whole keys, never a substring, and
 * the guard of sameProject() drops a log whose header names another path. A
 * log with no header names no session, as in read(). A project directory
 * that refuses a read, a session directory that refuses a read, and a log
 * that the decode step cannot read each count as one unread log. A log with
 * no step stays, because a session with no tool call still has a
 * transcript.
 *
 * @param {string} projectRoot
 * @param {Record<string, string | undefined>} env
 * @returns {{ logs: LogEntry[], unreadable: number }}
 */
function sessionLogs(projectRoot, env) {
  const root = sessionsRoot(env);
  const roots = projectRoots(projectRoot);
  const keys = roots.map(projectKey);
  /** @type {LogEntry[]} */
  const logs = [];
  let unreadable = 0;

  /** @type {string[]} */
  let names = [];
  try {
    names = fs
      .readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    // available() reports this state. The pick then sees an empty log tree.
    names = [];
  }

  for (const name of names.filter((item) => keys.includes(item)).sort()) {
    const project = path.join(root, name);

    /** @type {string[]} */
    let directories = [];
    try {
      directories = fs
        .readdirSync(project, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
    } catch {
      unreadable += 1;
      continue;
    }

    for (const directory of directories) {
      const picked = pickLog(path.join(project, directory));
      if (!picked.read) {
        unreadable += 1;
        continue;
      }
      if (picked.file === null) continue;

      const mtimeMs = modified(picked.file);
      /** @type {{ read: boolean, header: Record<string, any> | null }} */
      let head = { read: false, header: null };
      if (mtimeMs !== null) {
        try {
          head = readHeader(picked.file, env);
        } catch {
          head = { read: false, header: null };
        }
      }
      if (mtimeMs === null || !head.read) {
        unreadable += 1;
        continue;
      }

      const header = head.header;
      if (header === null) continue;
      const cwd = typeof header.cwd === 'string' && header.cwd !== '' ? header.cwd : null;
      if (!sameProject(cwd, roots)) continue;

      const raw = typeof header.id === 'string' && header.id !== '' ? header.id : directory;
      logs.push({
        name: directory,
        id: shortId(raw) || raw,
        parent: parentId(header.parentSession),
        created: createdAt(header.createdAt),
        file: picked.file,
        mtimeMs,
      });
    }
  }

  return { logs, unreadable };
}

/**
 * The log with the latest modification time. The first log wins a tie.
 *
 * @param {LogEntry[]} logs
 * @returns {LogEntry | null}
 */
function newest(logs) {
  /** @type {LogEntry | null} */
  let best = null;
  for (const log of logs) {
    if (best === null || log.mtimeMs > best.mtimeMs) best = log;
  }
  return best;
}

/**
 * The id of the dsh session that runs this command, or null.
 *
 * dsh exports DSH_SESSION_ID to each tool shell, with the id of the session
 * of the agent that runs the shell, so the shell of a subagent holds the id
 * of that subagent. The value arrives through the "env" argument of the
 * contract, as DSH_HOME does, and never through process.env.
 *
 * @param {Record<string, string | undefined>} [env] The environment of the caller.
 * @returns {string | null}
 */
function runningSession(env = {}) {
  const value = env.DSH_SESSION_ID;
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/**
 * The log of the run that runs this command, or null.
 *
 * The walk starts at the log whose id equals DSH_SESSION_ID with no
 * "session-" prefix. The match is exact, never a prefix. The walk then
 * follows the parent name of each header to the log that names no parent,
 * so the shell of a subagent names the parent of its run. When two logs
 * carry one id, the newer log wins. An absent variable, a variable that
 * names no log of this project, a parent name that names no log of this
 * project, and a loop of parent names each give null.
 *
 * @param {LogEntry[]} logs
 * @param {Record<string, string | undefined>} env
 * @returns {LogEntry | null}
 */
function runningLog(logs, env) {
  const value = runningSession(env);
  if (value === null) return null;

  /** @param {string} id */
  const logOf = (id) => newest(logs.filter((log) => log.id === id));
  /** @type {Set<LogEntry>} */
  const seen = new Set();
  let log = logOf(shortId(value) || value);

  while (log !== null && log.parent !== null) {
    if (seen.has(log)) return null;
    seen.add(log);
    log = logOf(log.parent);
  }
  return log;
}

/**
 * The log that one id names. An exact id wins: the name of a session
 * directory with or without the "session-" prefix, or the id that the token
 * report prints. A text that equals no id matches as a prefix when exactly
 * one id starts with it. Two or more ids give no log, and the note lists up
 * to five of them, newest first.
 *
 * @param {LogEntry[]} logs
 * @param {string} wanted
 * @returns {{ log: LogEntry | null, note: string | null }}
 */
function findLog(logs, wanted) {
  /** @param {LogEntry} log */
  const namesOf = (log) => [log.name, shortId(log.name), log.id];

  const exact = logs.filter((log) => namesOf(log).includes(wanted));
  if (exact.length > 0) return { log: newest(exact), note: null };

  /** @type {Map<string, LogEntry>} The newest log of each id that starts with the text. */
  const matches = new Map();
  for (const log of logs) {
    if (!namesOf(log).some((name) => name.startsWith(wanted))) continue;
    const seen = matches.get(log.id);
    if (seen === undefined || log.mtimeMs > seen.mtimeMs) matches.set(log.id, log);
  }

  if (matches.size === 0) return { log: null, note: null };
  if (matches.size === 1) return { log: [...matches.values()][0], note: null };

  const listed = [...matches.values()]
    .sort((a, b) => b.mtimeMs - a.mtimeMs || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, MAX_LISTED)
    .map((log) => log.id);
  return {
    log: null,
    note: `The id "${wanted}" matches more than one session: ${listed.join(', ')}.`,
  };
}

/**
 * The subagents of one session, per the walk of read(): each log whose
 * parent name names the session or one of its subagents, at any depth. Each
 * pass keeps the directory order, and the walk stops at the first pass that
 * adds no log. "held" keeps the log object, and not the id, because two
 * session directories can carry one id, and both logs then stay. The chosen
 * log starts in "held", so a loop of parent names never adds it again.
 *
 * @param {LogEntry} chosen
 * @param {LogEntry[]} logs
 * @returns {LogEntry[]}
 */
function subagentsOf(chosen, logs) {
  /** @type {Set<string>} */
  const ids = new Set([chosen.id]);
  /** @type {Set<LogEntry>} */
  const held = new Set([chosen]);
  /** @type {LogEntry[]} */
  const found = [];

  let added = true;
  while (added) {
    added = false;
    for (const log of logs) {
      if (log.parent === null || held.has(log) || !ids.has(log.parent)) continue;
      held.add(log);
      ids.add(log.id);
      found.push(log);
      added = true;
    }
  }

  return found;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// The transcript mode: the exported function
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * The raw steps of one session of the project at projectRoot, with the
 * steps of its subagents, and the notes of the run.
 *
 * With no id, the reader picks the run that runs the command: the log of the
 * DSH_SESSION_ID of "env", or the log that its parent names, up to the
 * session that names no parent. When "env" holds no such variable, or the
 * variable names no session of this project, the reader picks the newest log
 * of the matched project directories whose header names no parent session.
 * With an id, the variable changes nothing, and the reader picks the session
 * directory whose name, with or without the "session-" prefix, equals the
 * id, or the one session whose id starts with the text. A session brings
 * each session whose parent name names it or one of its subagents, so a
 * subagent id brings that subagent and its own subagents.
 *
 * Only the pick through DSH_SESSION_ID sets "current: true" on the answer,
 * so the core prefers that run to a newer log of another harness. A
 * newest-log pick and an id pick hold no "current" field.
 *
 * The function reads logs and writes nothing. It never throws for a missing
 * or a broken log: an unreadable log adds to one note, and a line that is
 * not JSON adds to another. A run with no match adds no note, because the
 * core prints the line of that state.
 *
 * @param {{
 *   projectRoot?: string,
 *   sessionId?: string | null,
 *   env?: Record<string, string | undefined>,
 * }} [ctx]
 * @returns {{ transcript: RawTranscript | null, notes: string[] }}
 */
export function transcript({ projectRoot, sessionId: wanted = null, env = {} } = {}) {
  // The guard of read(): an empty name reaches the working directory of the
  // process through path.resolve(), and that answer names the sessions of
  // another project.
  if (typeof projectRoot !== 'string' || projectRoot.trim() === '') {
    return {
      transcript: null,
      notes: ['The caller named no project root, so the reader read no session log of dsh.'],
    };
  }

  const id = typeof wanted === 'string' && wanted.trim() !== '' ? wanted.trim() : null;
  /** @type {string[]} */
  const notes = [];
  const listed = sessionLogs(projectRoot, env);
  let unreadable = listed.unreadable;
  let skipped = 0;

  /** @type {LogEntry | null} */
  let chosen = null;
  // True only when the pick with no id used DSH_SESSION_ID.
  let current = false;
  if (id === null) {
    const running = runningLog(listed.logs, env);
    current = running !== null;
    chosen = running ?? newest(listed.logs.filter((log) => log.parent === null));
  } else {
    const found = findLog(listed.logs, id);
    if (found.note !== null) notes.push(found.note);
    chosen = found.log;
  }

  /** @type {RawTranscript | null} */
  let result = null;
  if (chosen !== null) {
    const named = stepsOf(chosen, env);
    if (named === null) {
      unreadable += 1;
    } else {
      skipped += named.skipped;
      const agents = [{ id: chosen.id, steps: named.steps }];

      for (const sub of subagentsOf(chosen, listed.logs)) {
        const parsed = stepsOf(sub, env);
        if (parsed === null) {
          unreadable += 1;
          continue;
        }
        skipped += parsed.skipped;
        agents.push({ id: sub.id, steps: parsed.steps });
      }

      result = {
        id: chosen.id,
        kind: chosen.parent === null ? 'parent' : 'subagent',
        parent: chosen.parent,
        created: chosen.created ?? named.first,
        writtenAt: new Date(chosen.mtimeMs).toISOString(),
        agents,
      };
      if (current) result.current = true;
    }
  }

  if (skipped > 0) {
    notes.push(`The reader skipped ${skipped} lines of the log that are not JSON.`);
  }
  if (unreadable > 0) {
    notes.push(`The reader could not read ${unreadable} log files.`);
  }

  return { transcript: result, notes };
}

/** @type {import('./index.js').Reader} */
export const dsh = {
  id: 'dsh',
  available,
  read,
  transcript,
};

export default dsh;
