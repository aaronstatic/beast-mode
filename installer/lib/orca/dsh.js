// installer/lib/orca/dsh.js
//
// The child-activity fact of an idle dsh stage tab (fix 2). In dsh 0.2.1 to
// 0.2.2-rc.5 the `subagent` tool starts its agent and returns at once. The
// dsh worker then ends its turn and waits until dsh brings the result in as
// a new turn, and Orca reports that turn end to the coordinator as an
// escalation. Before rule A4 sends the resume text to an idle dsh tab,
// `next` reads this fact: a session of a subagent of the tab that wrote in
// the last ten minutes means that the tab waits on its own subagent.
//
// The fact reads the dsh home with `fs` only. It starts no child process,
// and it decodes no session log (Node 20 has no zstd), so it reads
// modification times only. The facts of the dsh source (`deepseek-harness`):
//
// - The home is `$DSH_HOME` when it is not blank, with a leading `~`
//   expanded, else `~/.dsh` (`packages/util/home-paths/src/index.ts`,
//   resolveDshHome). The sessions root is `<home>/sessions`
//   (`packages/bundle/base/cordis.patch.yml`).
// - Each workspace has one folder, `projectKey(cwd)` of
//   `packages/session/session-persistence-jsonl/src/format.ts`, and each
//   session has one folder in it, `encodeSegment(id)`, that holds
//   `session.v4.jsonl.zstd` and `session.lock`. A subagent session takes
//   the cwd of its parent (`packages/subagent/subagent/src/child-agent.ts`),
//   so it is in the same workspace folder.
// - `session.lock` is a kernel flock(2) with no pid in it
//   (`session-persistence-jsonl/src/lease.ts`). Node 20 cannot test a
//   flock, so the fact reads the time of the lock only. The lease opens the
//   file with truncation at each acquire, so that time is the time when the
//   session opened.
// - A dsh shell call carries `DSH_SESSION_ID`, the session of the agent
//   that calls (`packages/shell/shell-env/src/index.ts`). A coordinator on
//   dsh therefore skips its own session.
//
// The tab writes its own session log at the end of each turn, about 1.5 s
// before Orca sends the escalation. So the fact never counts the session of
// the tab: that session is the first one that opened at or after the start
// of the tab, and each later session is a child. Every fault of the read
// gives "not active", so the run keeps the resume send of rule A4.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { findOnPath } from './setup.js';

/** A child session that wrote in this window counts as active: 10 minutes (fix 2). */
export const DSH_CHILD_ACTIVE_MS = 10 * 60 * 1000;

/** The largest wrapper script that the home search reads: 64 KiB. */
export const DSH_WRAPPER_MAX_BYTES = 64 * 1024;

/** The folder of the default dsh home, under the home folder of the user. */
export const DSH_HOME_DIR = '.dsh';

/** The lock file of one session folder. */
const LOCK_NAME = 'session.lock';

/** The most session folders that one read takes, so a huge folder cannot stall `next`. */
const MAX_SESSIONS = 5000;

/** The slack between the start time of the record and the open time of the session of the tab. */
const START_SLACK_MS = 2000;

/** A code unit that a dsh path key keeps as it is (`~` is not one). */
const SAFE_UNIT = /^[A-Za-z0-9._-]$/;

/** The first `DSH_HOME=` assignment of one line: double-quoted, single-quoted, or bare. */
const ASSIGNMENT = /(?:^|[\s;&|(])(?:export\s+)?DSH_HOME=(?:"([^"]*)"|'([^']*)'|([^\s;&|)'"`]*))/;

/**
 * @typedef {Object} DshChildFact The child-activity fact of one idle dsh tab.
 * @property {boolean} active A child session of the tab wrote in the last DSH_CHILD_ACTIVE_MS.
 * @property {string | null} home The dsh home, null when the read failed before it.
 * @property {'wrapper' | 'environment' | 'default' | null} source Where the home came from.
 * @property {string[]} folders The workspace folders under `<home>/sessions/` that the read looked at.
 * @property {number} sessions The session folders that the read took.
 * @property {number} children The sessions that opened after the session of the tab.
 * @property {number} recent The children that wrote in the window.
 * @property {string | null} newestAt The newest write of a child, as an ISO time.
 * @property {string[]} detail
 */

/**
 * @param {unknown} value
 * @returns {value is Record<string, any>}
 */
function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {Record<string, string | undefined>} env
 * @returns {string} The home folder of the user: `HOME` when it is set, else the one of the system.
 */
export function userHome(env) {
  const home = env.HOME;
  return typeof home === 'string' && home.trim().length > 0 ? home : os.homedir();
}

/**
 * Expand a leading `~` as dsh does (expandHomePath).
 *
 * @param {string} value
 * @param {string} home
 * @returns {string}
 */
function expandTilde(value, home) {
  if (value === '~') return home;
  if (value.startsWith('~/') || value.startsWith('~\\')) return path.join(home, value.slice(2));
  return value;
}

/**
 * @param {string} ch One UTF-16 code unit.
 * @param {number} code Its code.
 * @returns {string} The unit as it is when it is safe, else `~XXXX`.
 */
function safeUnit(ch, code) {
  return ch !== '~' && SAFE_UNIT.test(ch) ? ch : `~${code.toString(16).toUpperCase().padStart(4, '0')}`;
}

/**
 * The folder of one workspace under `<home>/sessions/`: projectKey() of the
 * dsh source. A run of `/`, `\`, or `:` gives one `-`, a safe code unit
 * stays, and any other code unit gives `~XXXX`. The leading `-` go, the
 * slug keeps 251 units, and the key is `--<slug>--`.
 * `/home/u/dev/brutal-ui` gives `--home-u-dev-brutal-ui--`.
 *
 * @param {unknown} cwd An absolute workspace path.
 * @returns {string | null} Null for no path.
 */
export function dshProjectKey(cwd) {
  if (typeof cwd !== 'string' || cwd.length === 0) return null;
  let readable = '';
  let separatorRun = false;
  for (let i = 0; i < cwd.length; i += 1) {
    const ch = cwd[i];
    if (ch === '/' || ch === '\\' || ch === ':') {
      if (!separatorRun) readable += '-';
      separatorRun = true;
    } else {
      readable += safeUnit(ch, cwd.charCodeAt(i));
      separatorRun = false;
    }
  }
  const slug = readable.replace(/^-+/, '') || 'root';
  return `--${slug.slice(0, 251)}--`;
}

/**
 * The folder of one session: encodeSegment() of the dsh source.
 *
 * @param {unknown} id A session id.
 * @returns {string | null} Null for no id.
 */
export function dshSegment(id) {
  if (typeof id !== 'string' || id.length === 0) return null;
  if (id === '.') return '~002E';
  if (id === '..') return '~002E~002E';
  let out = '';
  for (let i = 0; i < id.length; i += 1) out += safeUnit(id[i], id.charCodeAt(i));
  return out;
}

/**
 * The value of one `DSH_HOME=` match. `$HOME` and `${HOME}` expand outside
 * single quotes, and a leading `~` expands as dsh does. Null for a value
 * that holds another variable, is blank, or is not absolute.
 *
 * @param {RegExpExecArray} match
 * @param {string} home
 * @returns {string | null}
 */
function assignedHome(match, home) {
  const [, doubled, single, bare] = match;
  const value =
    single !== undefined ? single : (doubled ?? bare ?? '').replace(/\$\{HOME\}|\$HOME(?![A-Za-z0-9_])/g, () => home);
  if (value.includes('$') || value.includes('`') || value.trim().length === 0) return null;
  const expanded = expandTilde(value, home);
  return path.isAbsolute(expanded) ? path.resolve(expanded) : null;
}

/**
 * The dsh home that a wrapper script sets: the first `DSH_HOME=` assignment
 * on a line that is not a comment. The live case is
 * `export DSH_HOME="$HOME/.dsh-personal"`, then `exec dsh-tui "$@"`.
 *
 * @param {string} text
 * @param {string} home The home folder of the user.
 * @returns {string | null}
 */
export function wrapperHome(text, home) {
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*#/.test(line)) continue;
    const match = ASSIGNMENT.exec(line);
    if (match) return assignedHome(match, home);
  }
  return null;
}

/**
 * @param {string} file
 * @returns {string | null} The text of a wrapper: a file of 64 KiB or less with no NUL byte.
 */
function readWrapper(file) {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > DSH_WRAPPER_MAX_BYTES) return null;
    const bytes = fs.readFileSync(file);
    if (bytes.length > DSH_WRAPPER_MAX_BYTES || bytes.includes(0)) return null;
    return bytes.toString('utf8');
  } catch {
    return null;
  }
}

/**
 * The file that `agents.dsh.command` runs: its first word, found on PATH.
 * A word with a path separator or a leading `~` is a path, and a relative
 * one resolves against the workspace, where Orca runs the command.
 *
 * @param {import('./read.js').OrcaConfigRead | null | undefined} config
 * @param {Record<string, string | undefined>} env
 * @param {string} platform
 * @param {string} cwd The workspace of the tab.
 * @param {string} home The home folder of the user.
 * @returns {string | null}
 */
function wrapperOf(config, env, platform, cwd, home) {
  if (!config || config.state !== 'valid' || !isPlainObject(config.config.agents)) return null;
  const entry = config.config.agents.dsh;
  const word = isPlainObject(entry) && typeof entry.command === 'string' ? entry.command.trim().split(' ')[0] : '';
  if (!word) return null;
  const expanded = expandTilde(word, home);
  const isPath = expanded !== word || word.includes('/') || (platform === 'win32' && word.includes('\\'));
  return findOnPath(isPath && !path.isAbsolute(expanded) ? path.resolve(cwd, expanded) : expanded, env, platform);
}

/**
 * The dsh home of a stage tab, in this order: the first `DSH_HOME=` line of
 * the wrapper that `agents.dsh.command` names on PATH, the `DSH_HOME` of the
 * environment, then `~/.dsh`. The `agents.dsh` entry of orca.json holds no
 * `env` key, because the shared launch rules refuse it (`agent-env`).
 *
 * @param {{ config: import('./read.js').OrcaConfigRead | null | undefined, env: Record<string, string | undefined>,
 *   platform: string, cwd: string }} opts `cwd`: the workspace of the tab.
 * @returns {{ home: string, source: 'wrapper' | 'environment' | 'default', wrapper: string | null }}
 */
export function resolveDshHome({ config, env, platform, cwd }) {
  const user = userHome(env);
  const wrapper = wrapperOf(config, env, platform, cwd, user);
  const text = wrapper ? readWrapper(wrapper) : null;
  const fromWrapper = text === null ? null : wrapperHome(text, user);
  if (fromWrapper) return { home: fromWrapper, source: 'wrapper', wrapper };
  const fromEnv = typeof env.DSH_HOME === 'string' ? expandTilde(env.DSH_HOME.trim(), user) : '';
  if (fromEnv && path.isAbsolute(fromEnv)) return { home: path.resolve(fromEnv), source: 'environment', wrapper };
  return { home: path.join(user, DSH_HOME_DIR), source: 'default', wrapper };
}

/**
 * The workspace of a tab in a `worker-show` answer: the path after the
 * first `::` of the worktree id (`<repo-id>::<path>`). The field view names
 * it as `workspace`, and the full shape as `projection.workspace.id` or
 * `worker.worktreeId`. Null when the answer names no absolute path.
 *
 * @param {{ kind: string, result?: unknown } | null | undefined} answer
 * @returns {string | null}
 */
export function showWorkspace(answer) {
  if (!answer || answer.kind !== 'ok' || !isPlainObject(answer.result)) return null;
  const result = answer.result;
  const projection = isPlainObject(result.projection) && isPlainObject(result.projection.workspace) ? result.projection.workspace : {};
  const worker = isPlainObject(result.worker) ? result.worker : {};
  for (const id of [result.workspace, projection.id, worker.worktreeId]) {
    const at = typeof id === 'string' ? id.indexOf('::') : -1;
    const value = at === -1 ? '' : id.slice(at + 2);
    if (value && path.isAbsolute(value)) return value;
  }
  return null;
}

/**
 * @param {string} folder
 * @returns {string[]} The names of the session folders, with no link followed. Empty when the folder cannot be read.
 */
function sessionNames(folder) {
  try {
    return fs
      .readdirSync(folder, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

/**
 * The two times of one session folder. `opened`: the time of `session.lock`,
 * else (Windows keeps no lock file) the time of the folder. `touched`: the
 * newest time of a file in the folder. A link is never followed.
 *
 * @param {string} dir
 * @returns {{ opened: number, touched: number } | null}
 */
function readSession(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  let touched = Number.NEGATIVE_INFINITY;
  /** @type {number | null} */
  let opened = null;
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    let stat;
    try {
      stat = fs.lstatSync(path.join(dir, entry.name));
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    touched = Math.max(touched, stat.mtimeMs);
    if (entry.name === LOCK_NAME) opened = stat.mtimeMs;
  }
  if (opened === null) {
    try {
      opened = fs.lstatSync(dir).mtimeMs;
    } catch {
      return null;
    }
  }
  return { opened, touched: Number.isFinite(touched) ? touched : opened };
}

/**
 * @param {number} count
 * @param {string} noun
 * @returns {string}
 */
function countText(count, noun) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/**
 * Read the child-activity fact from the session folders of the workspaces
 * of one tab. The session of the tab is the first one that opened at or
 * after `startedAt` (less 2 s of slack). Each later session is a child, and
 * a child that wrote in the last DSH_CHILD_ACTIVE_MS makes the fact active.
 * The session of `exclude` (the coordinator on dsh) never counts. No start
 * time gives "not active".
 *
 * @param {{ home: string, workspaces: string[], startedAt: unknown, now: Date, exclude?: unknown }} opts
 * @returns {DshChildFact}
 */
export function readDshChild({ home, workspaces, startedAt, now, exclude = null }) {
  const nowMs = now.getTime();
  const start = typeof startedAt === 'string' ? Date.parse(startedAt) : Number.NaN;
  const skip = dshSegment(exclude);
  const keys = [...new Set(workspaces.map(dshProjectKey).filter((key) => key !== null))];
  const folders = keys.map((key) => path.join(home, 'sessions', /** @type {string} */ (key)));
  /** @type {{ opened: number, touched: number }[]} */
  const sessions = [];
  for (const folder of folders) {
    for (const name of sessionNames(folder)) {
      if (sessions.length >= MAX_SESSIONS) break;
      if (name === skip) continue;
      const session = readSession(path.join(folder, name));
      if (session) sessions.push(session);
    }
  }
  const mine = Number.isFinite(start)
    ? sessions.filter((session) => session.opened >= start - START_SLACK_MS).sort((a, b) => a.opened - b.opened)
    : [];
  const children = mine.slice(1);
  const recent = children.filter((session) => nowMs - session.touched <= DSH_CHILD_ACTIVE_MS);
  const newest = children.reduce((max, session) => Math.max(max, session.touched), Number.NEGATIVE_INFINITY);
  const newestAt = Number.isFinite(newest) ? new Date(newest).toISOString() : null;
  const where = folders.length > 0 ? folders.join(', ') : `${path.join(home, 'sessions')} (no workspace path)`;
  /** @type {string[]} */
  const detail = [];
  if (!Number.isFinite(start)) {
    detail.push('dsh: the run record holds no start time of the tab, so no subagent session can be told apart.');
  } else if (recent.length > 0) {
    const seconds = Math.max(0, Math.round((nowMs - newest) / 1000));
    detail.push(`dsh: ${countText(recent.length, 'subagent session')} of the tab wrote in the last 10 minutes, the newest ${seconds} s ago.`);
  } else {
    detail.push(`dsh: no subagent session of the tab wrote in the last 10 minutes (${countText(children.length, 'subagent session')} in all).`);
  }
  detail.push(`dsh sessions: ${where}.`);
  return {
    active: recent.length > 0,
    home,
    source: null,
    folders,
    sessions: sessions.length,
    children: children.length,
    recent: recent.length,
    newestAt,
    detail,
  };
}

/**
 * @param {string} dir
 * @returns {string | null} The real path of a folder, null when it cannot be resolved.
 */
function realOf(dir) {
  try {
    return fs.realpathSync(dir);
  } catch {
    return null;
  }
}

/**
 * The child-activity fact of one idle dsh tab: the dsh home of the stage,
 * then the session folders of the workspace of the tab (the path as Orca
 * names it, and its real path). Never throws: a fault gives "not active",
 * so the run keeps the resume send of rule A4.
 *
 * @param {{ config: import('./read.js').OrcaConfigRead | null | undefined, env: Record<string, string | undefined>,
 *   platform: string, now: Date, active: Record<string, any>, workspace: string }} opts
 * @returns {DshChildFact}
 */
export function dshChildFact({ config, env, platform, now, active, workspace }) {
  try {
    const found = resolveDshHome({ config, env, platform, cwd: workspace });
    const real = realOf(workspace);
    const fact = readDshChild({
      home: found.home,
      workspaces: real && real !== workspace ? [workspace, real] : [workspace],
      startedAt: active.startedAt,
      now,
      exclude: env.DSH_SESSION_ID ?? null,
    });
    return { ...fact, source: found.source, detail: [...fact.detail, `dsh home: ${found.home} (${found.source}).`] };
  } catch (err) {
    return {
      active: false,
      home: null,
      source: null,
      folders: [],
      sessions: 0,
      children: 0,
      recent: 0,
      newestAt: null,
      detail: [`dsh: the session read failed: ${err instanceof Error ? err.message : String(err)}`],
    };
  }
}
