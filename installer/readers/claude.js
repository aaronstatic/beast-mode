// installer/readers/claude.js
//
// The token reader of Claude Code. It reads the session logs of Claude Code,
// and it returns the eleven fields of the session shape of
// installer/readers/index.js.
//
// Claude Code writes one JSONL log for each session at
// <root>/projects/<project>/<session>.jsonl, and one log for each subagent at
// <root>/projects/<project>/<session>/subagents/agent-<id>.jsonl. The
// directory name <project> holds the absolute path of the project, and every
// character of that path that is not a letter and not a digit becomes "-".
//
// The token mode holds four private steps and two exported functions. The
// transcript mode adds three steps: the session pick, the step parser of one
// log, and the exported transcript(), which returns the raw steps of one
// session and of its subagents. The module writes no file, it prints
// nothing, and it adds no flag, because installer/lib/tokens.js owns
// "flags", "cacheShare", and the totals, and installer/lib/transcript.js owns
// the merge, the step numbers, and the cut.
//
// The session pick with no id: Claude Code exports CLAUDE_CODE_SESSION_ID to
// each tool shell. The value is the id of the parent session, also in the
// shell of a subagent. When the "env" argument holds that variable, and a
// parent log "<id>.jsonl" of that id sits in a matched project directory, the
// reader picks that session: the session that runs the command. The latest
// modification time alone can name the wrong session, because a second live
// window of Claude Code writes its own log too. When the variable is absent,
// or it names no parent log, the reader picks the parent log with the latest
// modification time. With an id, the id or its unique prefix wins, and the
// variable changes nothing. Only the pick through the variable sets
// "current: true" on the answer, so the core prefers that session to a newer
// log of another harness.
//
// The reference of the parse rules is the analyzer claude-usage.py. The
// per-session numbers of this reader equal the numbers of that script, apart
// from the project match: that script matches a substring, and this reader
// compares two encoded keys for equality.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** The read size of one chunk, in bytes. */
const CHUNK_SIZE = 1024 * 1024;

/** The line separator of a JSONL log. */
const NEWLINE = 0x0a;

/** The empty remainder of the chunked read. */
const EMPTY = Buffer.alloc(0);

/** One day, in milliseconds. The "days" window counts in this unit. */
const DAY_MS = 86400000;

/** The fix line of an unavailable answer. */
const FIX =
  'Run Claude Code one time, or set CLAUDE_CONFIG_DIR to the configuration directory of Claude Code.';

/**
 * One API request of one session. Several assistant records share one
 * request, one for each content block, so the parser holds one Step for each
 * request key and it counts that key one time.
 *
 * @typedef {{ input: number, cacheWrite: number, cacheRead: number, output: number }} Step
 */

/**
 * @typedef {import('./index.js').Session} Session
 */

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// The four private steps
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * The configuration directory of Claude Code.
 *
 * CLAUDE_CONFIG_DIR wins, because a user moves the directory with it. The
 * variable is the test seam too: a test points it at a fixture log tree, so
 * no test reads the real home directory. The value arrives through the "env"
 * argument of the contract, and never through process.env.
 *
 * @param {Record<string, string | undefined>} [env] The environment of the caller.
 * @returns {string} The configuration root. It may be a relative path.
 */
function configRoot(env = {}) {
  const configured = env.CLAUDE_CONFIG_DIR;
  if (typeof configured === 'string' && configured.trim() !== '') return configured;
  const home = typeof env.HOME === 'string' && env.HOME !== '' ? env.HOME : os.homedir();
  return path.join(home, '.claude');
}

/**
 * The match key of one absolute path, or of one log directory name.
 *
 * Claude Code encodes the absolute project path in the directory name, and
 * every character that is not a letter and not a digit becomes "-". The
 * reader applies this rule to the project root and to each directory name,
 * then it compares the two keys for equality. The second call makes the rule
 * tolerant of an encoder that keeps "_", and it never widens the match to a
 * substring.
 *
 * @param {string} text An absolute path, or a log directory name.
 * @returns {string} The match key.
 */
function encode(text) {
  return String(text).replace(/[^A-Za-z0-9]/g, '-');
}

/**
 * Each line of one log file, in file order.
 *
 * A parent log reaches tens of megabytes, so the read runs in chunks of one
 * mebibyte. The remainder of a chunk stays a Buffer, so a multi-byte
 * character that crosses a chunk boundary still decodes correctly. Only a
 * complete line calls toString(), so the peak stays at one chunk plus one
 * line. The function yields, because an array of lines holds the whole file.
 *
 * @param {string} file The absolute path of the log.
 * @yields {string} One line, with no line separator.
 */
function* readLines(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const chunk = Buffer.allocUnsafe(CHUNK_SIZE);
    let rest = EMPTY;

    for (;;) {
      const count = fs.readSync(fd, chunk, 0, CHUNK_SIZE, null);
      if (count === 0) break;

      // The view bounds every search at the bytes of this read. The rest of
      // the buffer still holds the bytes of the read before.
      const view = chunk.subarray(0, count);
      let start = 0;
      let stop = view.indexOf(NEWLINE, start);

      while (stop !== -1) {
        const part = view.subarray(start, stop);
        if (rest.length > 0) {
          yield Buffer.concat([rest, part]).toString('utf8');
          rest = EMPTY;
        } else {
          yield part.toString('utf8');
        }
        start = stop + 1;
        stop = view.indexOf(NEWLINE, start);
      }

      // The tail points into the reusable chunk, so it needs a copy.
      const tail = view.subarray(start);
      rest = rest.length > 0 ? Buffer.concat([rest, tail]) : Buffer.from(tail);
    }

    if (rest.length > 0) yield rest.toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
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
 * One session of one log file, or null.
 *
 * One step is one API request. The key of a request is "requestId", then
 * "message.id", then "uuid". The first record of a request gives
 * "input_tokens" and "cache_read_input_tokens". A later record of the same
 * request carries the running usage, so the parser keeps the largest
 * "output_tokens" and the largest "cache_creation_input_tokens".
 *
 * A line that is not JSON raises nothing. The parser counts it and it returns
 * the count, because the note of the report names the total of the whole run.
 * A log with no step gives no session.
 *
 * Section 3.1 of the plan names the session alone. The answer carries the
 * skipped count beside it, because note 2 of section 3.6 needs that number
 * and this parser is the one step that sees a bad line.
 *
 * @param {string} file The absolute path of the log.
 * @param {string} id The session id, or the subagent id.
 * @param {'parent' | 'subagent'} kind The session kind.
 * @param {string | null} parent The parent session id of a subagent, or null.
 * @returns {{ session: Session | null, skipped: number }}
 */
function parseLog(file, id, kind, parent) {
  /** @type {Map<string, Step>} The steps, in the order the requests appear. */
  const steps = new Map();
  /** @type {Map<string, number>} The step count of each model, in first-step order. */
  const models = new Map();
  /** @type {string | null} */
  let created = null;
  /** @type {number | null} */
  let costUsd = null;
  let skipped = 0;

  for (const line of readLines(file)) {
    const text = line.trim();
    if (text === '') continue;

    let record;
    try {
      record = JSON.parse(text);
    } catch {
      skipped += 1;
      continue;
    }
    if (!record || typeof record !== 'object') continue;

    if (created === null && typeof record.timestamp === 'string' && record.timestamp !== '') {
      created = record.timestamp;
    }

    if (record.type === 'assistant') {
      const message =
        record.message && typeof record.message === 'object' ? record.message : {};
      const usage = message.usage && typeof message.usage === 'object' ? message.usage : {};
      const key = String(record.requestId ?? message.id ?? record.uuid ?? '');
      const step = steps.get(key);

      if (step === undefined) {
        const model =
          typeof message.model === 'string' && message.model !== '' ? message.model : '?';
        steps.set(key, {
          input: count(usage.input_tokens),
          cacheWrite: count(usage.cache_creation_input_tokens),
          cacheRead: count(usage.cache_read_input_tokens),
          output: count(usage.output_tokens),
        });
        models.set(model, (models.get(model) ?? 0) + 1);
      } else {
        step.output = Math.max(step.output, count(usage.output_tokens));
        step.cacheWrite = Math.max(step.cacheWrite, count(usage.cache_creation_input_tokens));
      }
    } else if (record.type === 'cost-state') {
      const cost = record.totalCostUSD;
      if (typeof cost === 'number' && Number.isFinite(cost)) costUsd = cost;
    }
  }

  const order = [...steps.values()];
  if (order.length === 0) return { session: null, skipped };

  let promptTokens = 0;
  let cacheReadTokens = 0;
  let outputTokens = 0;
  for (const step of order) {
    promptTokens += step.input + step.cacheWrite + step.cacheRead;
    cacheReadTokens += step.cacheRead;
    outputTokens += step.output;
  }

  const last = order[order.length - 1];

  // The model of most steps. The map holds the models in first-step order,
  // and the comparison is strict, so the earliest step wins a tie.
  let model = '?';
  let best = 0;
  for (const [name, seen] of models) {
    if (seen > best) {
      best = seen;
      model = name;
    }
  }

  return {
    session: {
      id,
      kind,
      parent,
      model,
      steps: order.length,
      finalPromptTokens: last.input + last.cacheWrite + last.cacheRead,
      promptTokens,
      cacheReadTokens,
      outputTokens,
      created,
      costUsd,
    },
    skipped,
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// The small helpers of read()
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

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
 * The names of the "*.jsonl" files of one directory, in name order.
 *
 * @param {string} directory
 * @returns {string[]}
 */
function logFiles(directory) {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
    .map((entry) => entry.name)
    .sort();
}

/**
 * The session id of one log file name: the basename with no ".jsonl", and
 * with no leading "agent-".
 *
 * @param {string} file The file name.
 * @returns {string}
 */
function sessionId(file) {
  const base = file.endsWith('.jsonl') ? file.slice(0, -'.jsonl'.length) : file;
  return base.startsWith('agent-') ? base.slice('agent-'.length) : base;
}

/**
 * The match keys of one project root: the key of the resolved path, and the
 * key of the real path.
 *
 * path.resolve() removes a trailing slash, and it also resolves a relative
 * path and a ".." segment. fs.realpathSync() resolves a symlink, and it
 * raises for a path that does not exist. The resolved key then stays alone.
 *
 * @param {string} projectRoot
 * @returns {string[]} One key, or two. The key of the resolved path comes first.
 */
function projectKeys(projectRoot) {
  const keys = [encode(path.resolve(projectRoot))];
  try {
    const real = encode(fs.realpathSync(path.resolve(projectRoot)));
    if (!keys.includes(real)) keys.push(real);
  } catch {
    // The project root does not exist here. The resolved key stays alone.
  }
  return keys;
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
 * Whether this reader can run here. It reads one path, and it writes nothing.
 *
 * @param {{ env?: Record<string, string | undefined> }} [ctx]
 * @returns {{ ok: true } | { ok: false, reason: string, fix: string }}
 */
export function available({ env = {} } = {}) {
  const projects = path.join(configRoot(env), 'projects');
  if (!isDirectory(projects)) {
    return {
      ok: false,
      reason: `Claude Code wrote no log directory at "${projects}".`,
      fix: FIX,
    };
  }
  return { ok: true };
}

/**
 * The sessions of the project at projectRoot, and the notes of the run.
 *
 * The reader finds the matched project directory, it parses each parent log,
 * it applies the window, then it parses the subagent logs of each kept
 * parent. The subagents of a kept parent stay, whatever their own timestamp
 * holds, because a subagent belongs to the run of its parent.
 *
 * A log of another project appears in no answer, because the match compares
 * two whole keys.
 *
 * @param {{
 *   projectRoot: string,
 *   days?: number | null,
 *   env?: Record<string, string | undefined>,
 * }} ctx
 * @returns {{ sessions: Session[], notes: string[] }}
 */
export function read({ projectRoot, days = null, env = {} }) {
  const projects = path.join(configRoot(env), 'projects');
  const keys = projectKeys(projectRoot);
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
      .readdirSync(projects, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    // available() reports this state as the reason and the fix. read() then
    // returns the same answer as an empty log tree.
    names = [];
  }

  const matched = names.filter((name) => keys.includes(encode(name))).sort();

  if (matched.length === 0) {
    notes.push(
      'No log directory of Claude Code matches this project. ' +
        `The reader looked for "${keys[0]}" under "${projects}".`
    );
    return { sessions, notes };
  }

  const cutoff =
    typeof days === 'number' && Number.isFinite(days) && days > 0
      ? Date.now() - days * DAY_MS
      : null;

  for (const name of matched) {
    const directory = path.join(projects, name);

    /** @type {string[]} */
    let files = [];
    try {
      files = logFiles(directory);
    } catch {
      unreadable += 1;
      continue;
    }

    for (const file of files) {
      const base = file.slice(0, -'.jsonl'.length);
      let parsed;
      try {
        parsed = parseLog(path.join(directory, file), sessionId(file), 'parent', null);
      } catch {
        unreadable += 1;
        continue;
      }

      skipped += parsed.skipped;
      const session = parsed.session;
      if (session === null) continue;
      if (!inWindow(session.created, cutoff)) continue;
      sessions.push(session);

      // The subagent logs of this parent. The directory name equals the
      // basename of the parent log, and a parent log carries no "agent-"
      // prefix, so it also equals the id of the parent session.
      const subagents = path.join(directory, base, 'subagents');
      if (!isDirectory(subagents)) continue;

      /** @type {string[]} */
      let subFiles = [];
      try {
        subFiles = logFiles(subagents);
      } catch {
        unreadable += 1;
        continue;
      }

      for (const subFile of subFiles) {
        let sub;
        try {
          sub = parseLog(
            path.join(subagents, subFile),
            sessionId(subFile),
            'subagent',
            session.id
          );
        } catch {
          unreadable += 1;
          continue;
        }
        skipped += sub.skipped;
        if (sub.session !== null) sessions.push(sub.session);
      }
    }
  }

  // No note names one file, because a project holds up to 120 logs.
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
 * One log of the session pick: a parent log, or a subagent log.
 *
 * @typedef {Object} LogEntry
 * @property {string} id The session id, or the subagent id, in the form of the token report.
 * @property {'parent' | 'subagent'} kind
 * @property {string | null} parent The parent session id of a subagent, or null.
 * @property {string} file The absolute path of the log.
 * @property {string | null} subagents The subagent directory of a parent log, or null.
 * @property {number} mtimeMs The modification time of the log, in milliseconds.
 */

/** The step kind of each Claude Code tool. Every other tool gives "other". */
const TOOL_KINDS = new Map([
  ['AskUserQuestion', 'ask'],
  ['Read', 'read'],
  ['Write', 'write'],
  ['Edit', 'edit'],
  ['MultiEdit', 'edit'],
  ['NotebookEdit', 'edit'],
  ['Bash', 'shell'],
  ['Grep', 'search'],
  ['Glob', 'search'],
  ['Task', 'delegate'],
  ['Agent', 'delegate'],
]);

/** A user text that starts with one of these marks gives no step. */
const SKIP_STARTS = ['<local-command-', '<system-reminder>'];
const COMMAND_NAME = /<command-name>([\s\S]*?)<\/command-name>/;
const COMMAND_ARGS = /<command-args>([\s\S]*?)<\/command-args>/;

/** The longest text of an "other" step, in characters. */
const OTHER_LIMIT = 120;

/** The mark at the end of a cut text. */
const CUT_MARK = '...';

/** The error of a failed tool result that holds no text. */
const EMPTY_ERROR = '(no text)';

/** The most ids that the note of an ambiguous id lists. */
const MAX_LISTED = 5;

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
 * One text value of a record, or null for a missing value and an empty one.
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
 * The time of one record as ISO 8601, or null for a missing value and a
 * value that does not parse. The core refuses a bad "at", so the reader
 * never passes a time that it cannot read.
 *
 * @param {unknown} value
 * @returns {string | null}
 */
function stamp(value) {
  if (typeof value !== 'string' || value === '') return null;
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : new Date(at).toISOString();
}

/**
 * The line range of a Read input: "lines 270-521", or "from line 270" with
 * no "limit". An input with no "offset" and no "limit" gives an empty text.
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
 * The text of a tool result: a string, or the "text" blocks of a list,
 * joined with a line break. Every other block gives no text.
 *
 * @param {unknown} content
 * @returns {string}
 */
function resultText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n');
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// The transcript mode: the step parser of one log
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * One step of one "tool_use" block, per the kinds table. The text of an
 * "ask" step holds the first question until the result arrives. A
 * "delegate" step holds "<agent type>: <description>".
 *
 * @param {Record<string, any>} block
 * @param {string | null} at
 * @returns {RawStep}
 */
function toolStep(block, at) {
  const tool = textOf(block.name);
  const kind = (tool !== null && TOOL_KINDS.get(tool)) || 'other';
  /** @type {Record<string, any>} */
  const input =
    block.input && typeof block.input === 'object' && !Array.isArray(block.input) ? block.input : {};
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
      file = textOf(input.file_path);
      break;
    case 'edit':
      file = textOf(input.file_path) ?? textOf(input.notebook_path);
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
      text = [textOf(input.subagent_type), textOf(input.description)]
        .filter((part) => part !== null)
        .join(': ');
      break;
    default:
      text = block.input === undefined ? '' : clip(JSON.stringify(block.input), OTHER_LIMIT);
  }

  return { at, kind: /** @type {RawStep['kind']} */ (kind), tool, file, text, error: null };
}

/**
 * The text of the user step of one user record, or null for no step.
 *
 * The record content is a string or a list of blocks, and the "text" blocks
 * count. A text that starts with "<local-command-" or "<system-reminder>"
 * gives no step. A text that holds "<command-name>/<name></command-name>"
 * gives "/<name>", plus the text of "<command-args>".
 *
 * @param {unknown} content The "message.content" value of the record.
 * @returns {string | null}
 */
function userText(content) {
  /** @type {string[]} */
  let texts = [];
  if (typeof content === 'string') {
    texts = [content];
  } else if (Array.isArray(content)) {
    texts = content
      .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text);
  }

  const kept = texts.filter((text) => {
    const start = text.trimStart();
    return start !== '' && !SKIP_STARTS.some((mark) => start.startsWith(mark));
  });
  if (kept.length === 0) return null;

  const joined = kept.join('\n');
  const command = COMMAND_NAME.exec(joined);
  if (command === null) return joined;

  const name = command[1].trim();
  const slash = name.startsWith('/') ? name : `/${name}`;
  const args = COMMAND_ARGS.exec(joined);
  const rest = args === null ? '' : args[1].trim();
  return rest === '' ? slash : `${slash} ${rest}`;
}

/**
 * Add one "tool_result" block to the step of its call. A failed result gives
 * the error. The result of an "ask" step holds the answer of the user, so it
 * becomes the text. A delegation result that names the subagent adds
 * " -> <agentId>", and that id names the log "agent-<id>.jsonl".
 *
 * @param {RawStep} step
 * @param {Record<string, any>} block
 * @param {Record<string, any>} record
 * @returns {void}
 */
function addResult(step, block, record) {
  const text = resultText(block.content);
  if (block.is_error === true) {
    step.error = text.trim() === '' ? EMPTY_ERROR : text;
  } else if (step.kind === 'ask' && text.trim() !== '') {
    step.text = text;
  }

  if (step.kind === 'delegate') {
    const result = record.toolUseResult;
    const agentId = result && typeof result === 'object' ? textOf(result.agentId) : null;
    if (agentId !== null) {
      step.text = step.text === '' ? `-> ${agentId}` : `${step.text} -> ${agentId}`;
    }
  }
}

/**
 * The raw steps of one log in log order, the first time of the log, and the
 * count of the lines that are not JSON.
 *
 * A user record gives one "user" step, unless "isMeta" or
 * "isCompactSummary" is true. An assistant record gives one step for each
 * "tool_use" block, keyed by the block id, so a repeated block gives no
 * second step. A "text" block and a "thinking" block give no step. The first
 * "tool_result" block of a call adds to its step. Every other record type
 * gives no step. "at" is the "timestamp" of the record.
 *
 * @param {string} file The absolute path of the log.
 * @returns {{ steps: RawStep[], created: string | null, skipped: number }}
 */
function parseSteps(file) {
  /** @type {RawStep[]} */
  const steps = [];
  /** @type {Map<string, RawStep>} The step of each tool_use id. */
  const calls = new Map();
  /** @type {Set<string>} The tool_use ids that hold a result already. */
  const answered = new Set();
  /** @type {string | null} */
  let created = null;
  let skipped = 0;

  for (const line of readLines(file)) {
    const text = line.trim();
    if (text === '') continue;

    let record;
    try {
      record = JSON.parse(text);
    } catch {
      skipped += 1;
      continue;
    }
    if (!record || typeof record !== 'object') continue;

    const at = stamp(record.timestamp);
    if (created === null && at !== null) created = at;

    const message = record.message && typeof record.message === 'object' ? record.message : {};
    const content = message.content;

    if (record.type === 'assistant') {
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        if (!block || typeof block !== 'object' || block.type !== 'tool_use') continue;
        const key = textOf(block.id);
        if (key !== null && calls.has(key)) continue;
        const step = toolStep(block, at);
        steps.push(step);
        if (key !== null) calls.set(key, step);
      }
    } else if (record.type === 'user') {
      if (record.isMeta !== true && record.isCompactSummary !== true) {
        const said = userText(content);
        if (said !== null) {
          steps.push({ at, kind: 'user', tool: null, file: null, text: said, error: null });
        }
      }
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        if (!block || typeof block !== 'object' || block.type !== 'tool_result') continue;
        const key = textOf(block.tool_use_id);
        if (key === null || answered.has(key)) continue;
        const step = calls.get(key);
        if (step === undefined) continue;
        answered.add(key);
        addResult(step, block, record);
      }
    }
  }

  return { steps, created, skipped };
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
 * The matched project directories of one project root, in name order. The
 * match is the match of read(): two whole keys, never a substring.
 *
 * @param {string} projectRoot
 * @param {Record<string, string | undefined>} env
 * @returns {string[]} The absolute paths of the directories.
 */
function matchedDirectories(projectRoot, env) {
  const projects = path.join(configRoot(env), 'projects');
  const keys = projectKeys(projectRoot);

  /** @type {string[]} */
  let names = [];
  try {
    names = fs
      .readdirSync(projects, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    names = [];
  }

  return names
    .filter((name) => keys.includes(encode(name)))
    .sort()
    .map((name) => path.join(projects, name));
}

/**
 * The parent logs of the matched project directories, in name order.
 *
 * @param {string[]} directories
 * @returns {{ logs: LogEntry[], unreadable: number }}
 */
function parentLogs(directories) {
  /** @type {LogEntry[]} */
  const logs = [];
  let unreadable = 0;

  for (const directory of directories) {
    /** @type {string[]} */
    let files = [];
    try {
      files = logFiles(directory);
    } catch {
      unreadable += 1;
      continue;
    }

    for (const file of files) {
      const full = path.join(directory, file);
      const mtimeMs = modified(full);
      if (mtimeMs === null) {
        unreadable += 1;
        continue;
      }
      logs.push({
        id: sessionId(file),
        kind: 'parent',
        parent: null,
        file: full,
        subagents: path.join(directory, file.slice(0, -'.jsonl'.length), 'subagents'),
        mtimeMs,
      });
    }
  }

  return { logs, unreadable };
}

/**
 * The subagent logs of one parent log, in name order: each
 * "agent-<id>.jsonl" under "<parent>/subagents/".
 *
 * @param {LogEntry} parentLog
 * @returns {{ logs: LogEntry[], unreadable: number }}
 */
function subagentLogs(parentLog) {
  /** @type {LogEntry[]} */
  const logs = [];
  if (parentLog.subagents === null || !isDirectory(parentLog.subagents)) {
    return { logs, unreadable: 0 };
  }

  /** @type {string[]} */
  let files = [];
  try {
    files = logFiles(parentLog.subagents);
  } catch {
    return { logs, unreadable: 1 };
  }

  let unreadable = 0;
  for (const file of files) {
    const full = path.join(parentLog.subagents, file);
    const mtimeMs = modified(full);
    if (mtimeMs === null) {
      unreadable += 1;
      continue;
    }
    logs.push({
      id: sessionId(file),
      kind: 'subagent',
      parent: parentLog.id,
      file: full,
      subagents: null,
      mtimeMs,
    });
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
 * The id of the Claude Code session that runs this command, or null.
 *
 * Claude Code exports CLAUDE_CODE_SESSION_ID to each tool shell, with the id
 * of the parent session, also in the shell of a subagent. The value arrives
 * through the "env" argument of the contract, as CLAUDE_CONFIG_DIR does, and
 * never through process.env.
 *
 * @param {Record<string, string | undefined>} [env] The environment of the caller.
 * @returns {string | null}
 */
function runningSession(env = {}) {
  const value = env.CLAUDE_CODE_SESSION_ID;
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/**
 * The parent log of the session that runs this command: the log "<id>.jsonl"
 * of CLAUDE_CODE_SESSION_ID in a matched project directory. The match is
 * exact, never a prefix, and a subagent log never matches. When two matched
 * directories each hold that log, the newer log wins. An absent variable, and
 * a variable that names no parent log, give null.
 *
 * @param {LogEntry[]} logs The parent logs.
 * @param {Record<string, string | undefined>} env
 * @returns {LogEntry | null}
 */
function runningLog(logs, env) {
  const id = runningSession(env);
  if (id === null) return null;
  const name = `${id}.jsonl`;
  return newest(logs.filter((log) => log.kind === 'parent' && path.basename(log.file) === name));
}

/**
 * The log that one id names. An exact id wins. A text that equals no id
 * matches as a prefix when exactly one id starts with it. Two or more ids
 * give no log, and the note lists up to five of them, newest first.
 *
 * @param {LogEntry[]} logs The parent logs and the subagent logs.
 * @param {string} wanted
 * @returns {{ log: LogEntry | null, note: string | null }}
 */
function findLog(logs, wanted) {
  const exact = logs.filter((log) => log.id === wanted);
  if (exact.length > 0) return { log: newest(exact), note: null };

  /** @type {Map<string, LogEntry>} The newest log of each id that starts with the text. */
  const matches = new Map();
  for (const log of logs) {
    if (!log.id.startsWith(wanted)) continue;
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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// The transcript mode: the exported function
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * The raw steps of one session of the project at projectRoot, with the
 * steps of its subagents, and the notes of the run.
 *
 * With no id, the reader picks the session that runs the command: the parent
 * log "<id>.jsonl" of the CLAUDE_CODE_SESSION_ID of "env" in a matched project
 * directory. When "env" holds no such variable, or the variable names no
 * parent log, it picks the parent log of the matched project directories with
 * the latest modification time. With an id, the variable changes nothing, and
 * the reader picks the parent log "<id>.jsonl", or the subagent log
 * "agent-<id>.jsonl" under "<parent>/subagents/", or the one log whose id
 * starts with the text. A parent brings each log under "<parent>/subagents/".
 * A subagent brings its own steps alone.
 *
 * Only the pick through CLAUDE_CODE_SESSION_ID sets "current: true" on the
 * answer, so the core prefers that session to a newer log of another
 * harness. A newest-log pick and an id pick hold no "current" field.
 *
 * The function reads logs and writes nothing. It never throws for a missing
 * or a broken log: an unreadable log adds to one note, and a line that is
 * not JSON adds to another. A run with no match adds no note, because the
 * core prints the line of that state.
 *
 * @param {{
 *   projectRoot: string,
 *   sessionId?: string | null,
 *   env?: Record<string, string | undefined>,
 * }} ctx
 * @returns {{ transcript: RawTranscript | null, notes: string[] }}
 */
export function transcript({ projectRoot, sessionId: wanted = null, env = {} }) {
  const id = typeof wanted === 'string' && wanted.trim() !== '' ? wanted.trim() : null;
  /** @type {string[]} */
  const notes = [];
  const parents = parentLogs(matchedDirectories(projectRoot, env));
  let unreadable = parents.unreadable;
  let skipped = 0;

  // The subagent logs of each parent, listed one time, so a parent that the
  // id search and the transcript both read counts an unreadable log once.
  /** @type {Map<LogEntry, LogEntry[]>} */
  const listed = new Map();
  /** @param {LogEntry} parentLog */
  const subagentsOf = (parentLog) => {
    let logs = listed.get(parentLog);
    if (logs === undefined) {
      const found = subagentLogs(parentLog);
      unreadable += found.unreadable;
      logs = found.logs;
      listed.set(parentLog, logs);
    }
    return logs;
  };

  /** @type {LogEntry | null} */
  let chosen = null;
  // True only when the pick with no id used CLAUDE_CODE_SESSION_ID.
  let current = false;
  if (id === null) {
    const running = runningLog(parents.logs, env);
    current = running !== null;
    chosen = running ?? newest(parents.logs);
  } else {
    /** @type {LogEntry[]} */
    const every = [];
    for (const parentLog of parents.logs) every.push(parentLog, ...subagentsOf(parentLog));
    const found = findLog(every, id);
    if (found.note !== null) notes.push(found.note);
    chosen = found.log;
  }

  /** @type {RawTranscript | null} */
  let result = null;
  if (chosen !== null) {
    /** @type {{ steps: RawStep[], created: string | null, skipped: number } | null} */
    let named = null;
    try {
      named = parseSteps(chosen.file);
    } catch {
      unreadable += 1;
    }

    if (named !== null) {
      skipped += named.skipped;
      const agents = [{ id: chosen.id, steps: named.steps }];

      if (chosen.kind === 'parent') {
        for (const sub of subagentsOf(chosen)) {
          try {
            const parsed = parseSteps(sub.file);
            skipped += parsed.skipped;
            agents.push({ id: sub.id, steps: parsed.steps });
          } catch {
            unreadable += 1;
          }
        }
      }

      result = {
        id: chosen.id,
        kind: chosen.kind,
        parent: chosen.parent,
        created: named.created,
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
export const claude = {
  id: 'claude',
  available,
  read,
  transcript,
};

export default claude;
