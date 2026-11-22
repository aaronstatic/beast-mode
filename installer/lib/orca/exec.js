// installer/lib/orca/exec.js
//
// Every child process of `beast-mode orca`. The argument builders below are
// pure: each one returns one call, with its tool, its argument list, its
// timeout, and whether it changes state. One function, call(), runs a built
// call through the runner and reads its answer: the JSON envelope of an Orca
// call, or the exit status of a git call. An Orca read retries one time after
// 2 seconds on `runtime_unavailable`. A state change never retries by itself
// (Decision 13, Research Finding 6). This file holds the synchronous runner,
// the Orca executable, and the envelope parse too. It is the one file under
// installer/lib/orca that imports node:child_process, and the runner stays
// one injectable function, so no test starts a real Orca CLI.

import { spawnSync } from 'node:child_process';

/** The output cap of one child process: 1 MiB. */
export const MAX_BUFFER = 1024 * 1024;

/** A git read or an Orca read waits 30 seconds at most (Decision 3). */
export const READ_TIMEOUT_MS = 30000;

/** A git switch, add, or config waits two minutes at most. */
export const WRITE_TIMEOUT_MS = 120000;

/** A git commit runs the commit hooks of the project, so it waits five minutes at most. */
export const COMMIT_TIMEOUT_MS = 300000;

/** `worker-start` waits 150 seconds, with `--timeout-ms 120000` (Decision 3). */
export const WORKER_START_TIMEOUT_MS = 150000;

/** The `--timeout-ms` value of `worker-start`. */
export const WORKER_START_WAIT_MS = '120000';

/** The `--timeout-ms` value of the `tui-idle` wait of a project command tab (Decision 16). */
export const TUI_IDLE_WAIT_MS = '60000';

/** The process limit of that wait: its 60 seconds, the 5 seconds that the Orca CLI adds, and a margin. */
export const TERMINAL_WAIT_TIMEOUT_MS = 75000;

/** The selector of the workspace of the working directory: the main workspace of the run. */
export const CURRENT_WORKTREE = 'current';

/**
 * The literal exclude of the briefs folder. Only `git status` takes it:
 * `git status` exits 0 for an ignored folder. `git add` does not, so a
 * staging call uses BRIEFS_GLOB_EXCLUDE.
 */
export const BRIEFS_EXCLUDE = ':(exclude).beast-mode/briefs';

/**
 * The pathspec that keeps every helper file out of a commit, the one
 * staging form of `git add`. `git add` exits 1 when a literal pathspec
 * names an ignored path, an exclude included, and the installer writes
 * `.beast-mode/briefs/` into `.gitignore`. A wildcard pathspec never takes
 * that check, with or without the `.gitignore` line.
 */
export const BRIEFS_GLOB_EXCLUDE = ':(exclude,glob).beast-mode/brief[s]/**';

/** The Orca code of a runtime that does not answer. An Orca read retries one time on it. */
export const RETRY_CODE = 'runtime_unavailable';

/** The wait before the one retry of an Orca read: 2 seconds (Research Finding 6). */
export const RETRY_DELAY_MS = 2000;

/** The longest output excerpt that a detail list carries. */
export const MAX_OUTPUT_LINES = 40;

/** The longest line of a detail list. */
export const MAX_LINE_LENGTH = 300;

/**
 * @typedef {Object} RunResult The answer of one child process.
 * @property {number | null} status
 * @property {string | null} signal
 * @property {string} stdout
 * @property {string} stderr
 * @property {{ code: string, message: string } | null} error A spawn error, a timeout, or an output cap.
 */

/**
 * @typedef {(command: string, args: string[], options: { cwd: string, timeoutMs: number, env: Record<string, string | undefined> }) => RunResult} Runner
 */

/**
 * @typedef {Object} Call One child process, as a builder returns it. Pure data.
 * @property {'orca' | 'git'} tool
 * @property {string[]} args
 * @property {number} timeoutMs
 * @property {boolean} change The call changes state, so it never retries by itself.
 */

/**
 * @typedef {Object} ExecContext What call() needs. A StepRun of steps.js is one.
 * @property {Runner} runner
 * @property {string} orca The Orca executable, chosen once.
 * @property {string} projectRoot The working directory of every call, unless `workDir` is set.
 * @property {string} [workDir] The working directory of every call for a lane of `/orca-epic`: the
 *   main workspace. Its `projectRoot` is then the lane worktree, and each git call names it with `-C`.
 * @property {Record<string, string | undefined>} env
 * @property {(ms: number) => void} [sleep] The wait before a retry. Default: sleepSync.
 */

/**
 * @typedef {{ kind: 'ok', result: any, detail: string[] }
 *   | { kind: 'failed', code: string, message: string, data: Record<string, any> | null, result: any, detail: string[] }
 *   | { kind: 'spawn-error', code: string, result: null, detail: string[] }
 *   | { kind: 'bad-answer', code: string, result: null, detail: string[] }} OrcaAnswer
 */

/**
 * @typedef {RunResult & { ok: boolean, detail: string[] }} GitAnswer A git result. `detail`
 *   holds the command, its exit, and its output when `ok` is false.
 */

/**
 * The synchronous runner: `spawnSync` with an argument array, no shell, a
 * timeout, a 1 MiB output cap, and UTF-8. stdin is closed, so no child
 * waits for input. Never throws.
 *
 * @type {Runner}
 */
export function defaultRunner(command, args, { cwd, timeoutMs, env }) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: MAX_BUFFER,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const error = result.error
    ? {
        code: String(/** @type {NodeJS.ErrnoException} */ (result.error).code ?? 'spawn-failed'),
        message: result.error.message,
      }
    : null;
  return {
    status: result.status,
    signal: result.signal,
    stdout: typeof result.stdout === 'string' ? result.stdout : '',
    stderr: typeof result.stderr === 'string' ? result.stderr : '',
    error,
  };
}

/**
 * Block the thread for `ms` milliseconds with `Atomics.wait`, so a step
 * stays synchronous. A value that is not a positive number waits nothing.
 *
 * @param {number} ms
 * @returns {void}
 */
export function sleepSync(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * The Orca executable (Decision 13, as `resolveOrchestrationCliExecutable`
 * of the Orca CLI chooses it): `ORCA_CLI_COMMAND`, else `orca-dev` with
 * `ORCA_DEV_REPO_ROOT`, else `orca-ide` on Linux outside an Orca terminal,
 * else `orca`. A step chooses it once, and a failure never falls through
 * to another name.
 *
 * @param {Record<string, string | undefined>} env
 * @param {string} platform
 * @returns {string}
 */
export function resolveOrcaExecutable(env, platform) {
  const configured = typeof env.ORCA_CLI_COMMAND === 'string' ? env.ORCA_CLI_COMMAND.trim() : '';
  if (configured) return configured;
  if (env.ORCA_DEV_REPO_ROOT) return 'orca-dev';
  if (platform === 'linux' && !env.ORCA_TERMINAL_HANDLE) return 'orca-ide';
  return 'orca';
}

/**
 * The Windows form of a WSL path, for a file path that the Windows Orca app
 * opens (issue #10). On WSL2 the Orca desktop app runs on Windows, and its
 * managed launcher translates only the working directory, so an absolute
 * Linux path such as /home/u/p/spec.md reached the app as C:/home/u/...
 * and the spec was never found. /mnt/<drive>/... maps to the drive letter;
 * every other absolute path maps to the //wsl.localhost/<distro>/... UNC form
 * (with backslashes) that `wslpath -w` prints. A relative path, or a run with
 * no distro name, stays as it is.
 *
 * @param {string} p
 * @param {string | undefined} distro The value of `WSL_DISTRO_NAME`.
 * @returns {string}
 */
export function windowsPathForWsl(p, distro) {
  if (!distro || typeof p !== 'string' || !p.startsWith('/')) return p;
  const drive = /^\/mnt\/([a-zA-Z])(?:\/(.*))?$/.exec(p);
  if (drive) return `${drive[1].toUpperCase()}:\\${(drive[2] ?? '').split('/').join('\\')}`;
  return `\\\\wsl.localhost\\${distro}${p.split('/').join('\\')}`;
}

/**
 * The arguments of one Orca call with each file-path value in Windows form,
 * when the run is on WSL (`WSL_DISTRO_NAME` set) and the call goes to the
 * Windows app (not `orca-dev`). Only `--spec-file` carries a file path today.
 *
 * @param {string[]} args
 * @param {Record<string, string | undefined>} env
 * @param {string} platform
 * @returns {string[]}
 */
export function orcaArgsForHost(args, env, platform) {
  const distro = env.WSL_DISTRO_NAME;
  if (platform !== 'linux' || !distro || env.ORCA_DEV_REPO_ROOT) return args;
  return args.map((arg, i) => (i > 0 && args[i - 1] === '--spec-file' ? windowsPathForWsl(arg, distro) : arg));
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, any>}
 */
function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {string} body
 * @returns {unknown} The parsed JSON of the whole text, else of its last line, else undefined.
 */
function parseJsonText(body) {
  const trimmed = body.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    // An Orca answer is one JSON document. A shell profile can print a line
    // before it, so the last line gets one more try.
  }
  const lines = trimmed.split(/\r?\n/).filter((line) => line.trim().length > 0);
  try {
    return JSON.parse(lines[lines.length - 1]);
  } catch {
    return undefined;
  }
}

/**
 * Parse the JSON envelope of the Orca CLI (launch-config Notes 20):
 * `{ ok: true, result }` or `{ ok: false, error: { code, message, data } }`.
 * The `data` object of an error stays when it is there, for example the
 * `failureCount` of a retry that Orca refuses. A failed agent view prints
 * `{ ok: false, result }` with no `error` object and its code on stderr as
 * `error: <code>: <message>`, so the code comes from that line. Null when
 * stdout holds no envelope. Never throws.
 *
 * @param {unknown} stdout
 * @param {unknown} [stderr]
 * @returns {{ ok: true, result: any } | { ok: false, error: { code: string, message: string, data?: Record<string, any> }, result: any } | null}
 */
export function parseEnvelope(stdout, stderr = '') {
  if (typeof stdout !== 'string') return null;
  const value = parseJsonText(stdout);
  if (!isPlainObject(value) || typeof value.ok !== 'boolean') return null;
  if (value.ok) return { ok: true, result: value.result ?? null };
  if (isPlainObject(value.error) && typeof value.error.code === 'string') {
    return {
      ok: false,
      error: {
        code: value.error.code,
        message: typeof value.error.message === 'string' ? value.error.message : '',
        ...(isPlainObject(value.error.data) ? { data: value.error.data } : {}),
      },
      result: value.result ?? null,
    };
  }
  const line = /^(?:error|warning): ([A-Za-z0-9_.-]+): (.*)$/m.exec(typeof stderr === 'string' ? stderr : '');
  return {
    ok: false,
    error: { code: line ? line[1] : 'failed', message: line ? line[2] : '' },
    result: value.result ?? null,
  };
}

/**
 * @param {unknown} body
 * @returns {string[]} The non-empty lines of a text, capped in count and length.
 */
export function outputLines(body) {
  return String(body ?? '')
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
    .slice(0, MAX_OUTPUT_LINES)
    .map((line) => (line.length > MAX_LINE_LENGTH ? `${line.slice(0, MAX_LINE_LENGTH)}...` : line));
}

/**
 * @param {string} executable
 * @param {string[]} args
 * @param {RunResult} result
 * @returns {OrcaAnswer}
 */
function readAnswer(executable, args, result) {
  const label = `${executable} ${args.filter((arg) => !arg.startsWith('-')).slice(0, 2).join(' ')}`;
  if (result.error) {
    const code =
      result.error.code === 'ETIMEDOUT' ? 'timeout' : result.error.code === 'ENOENT' ? 'not-found' : 'spawn-failed';
    return { kind: 'spawn-error', code, result: null, detail: [`${label}: ${result.error.message}`] };
  }
  const envelope = parseEnvelope(result.stdout, result.stderr);
  if (envelope === null) {
    return {
      kind: 'bad-answer',
      code: 'orca-bad-answer',
      result: null,
      detail: [`${label} exited ${result.status ?? result.signal} with no JSON envelope.`, ...outputLines(result.stderr)],
    };
  }
  if (envelope.ok) return { kind: 'ok', result: envelope.result, detail: [] };
  return {
    kind: 'failed',
    code: envelope.error.code,
    message: envelope.error.message,
    data: envelope.error.data ?? null,
    result: envelope.result,
    detail: [`${label}: ${envelope.error.code}: ${envelope.error.message}`],
  };
}

/**
 * Whether the worker view says the tab waits on a person: `waitingOnHuman`
 * holds a reason that is not `unknown`. Such a tab is busy for every stage,
 * for example a plan tab that asks the user in its own tab.
 *
 * @param {Record<string, any>} result
 * @returns {boolean}
 */
function waitsOnPerson(result) {
  return typeof result.waitingOnHuman === 'string' && result.waitingOnHuman !== '' && result.waitingOnHuman !== 'unknown';
}

/** The rows of one `inbox` read: the newest 50 messages of the mailbox (fix 7). */
export const INBOX_LIMIT = 50;

/**
 * @typedef {Object} UndeliveredMail The undelivered mail of one tab (fix 7).
 * @property {{ id: string, type: string, subject: string, createdAt: string }[]} messages
 *   The messages to `dispatch:<id>` that Orca never delivered (`delivered_at` is null), older than
 *   `minAgeMs`, and not in `exclude`. Oldest first.
 * @property {string[]} detail One line per message, for the action detail.
 */

/**
 * Read the undelivered mail of one tab from an `inbox --full` answer. Orca
 * queues a message to a tab while the tab runs a turn, and it delivers the
 * message after the turn. A tab that ended its turn to wait for that
 * message gets no next turn, so the message stays undelivered for ever.
 * `read` does not tell: such a message reads 1. Every fault reads as no
 * mail, so a failed read never changes a decision.
 *
 * @param {OrcaAnswer} answer The answer of orcaCalls.inbox().
 * @param {{ dispatchId: string, now: Date, minAgeMs: number, exclude?: string[] }} opts
 * @returns {UndeliveredMail}
 */
export function undeliveredMail(answer, { dispatchId, now, minAgeMs, exclude = [] }) {
  /** @type {UndeliveredMail} */
  const none = { messages: [], detail: [] };
  if (!answer || answer.kind !== 'ok' || !isPlainObject(answer.result) || !Array.isArray(answer.result.messages)) return none;
  const handle = `dispatch:${dispatchId}`;
  const messages = [];
  for (const row of answer.result.messages) {
    if (!isPlainObject(row) || row.to_handle !== handle) continue;
    if (row.delivered_at !== null && row.delivered_at !== undefined) continue;
    if (typeof row.id !== 'string' || row.id === '' || exclude.includes(row.id)) continue;
    const created = orcaTime(row.created_at);
    if (created === null || now.getTime() - created.getTime() < minAgeMs) continue;
    messages.push({
      id: row.id,
      type: typeof row.type === 'string' ? row.type : 'message',
      subject: typeof row.subject === 'string' ? row.subject : '',
      createdAt: created.toISOString(),
    });
  }
  messages.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const detail = messages.map((message) => {
    const minutes = Math.floor((now.getTime() - Date.parse(message.createdAt)) / 60000);
    return `Orca: the ${message.type} message ${message.id} to ${handle} is undelivered, ${minutes} min after it was sent.`;
  });
  return { messages, detail };
}

/**
 * @typedef {Object} MailWake One wake that Orca did not deliver to the coordinator (fix 7).
 * @property {string} id The message id.
 * @property {string} kind The message type, for example `worker_done` or `escalation`.
 * @property {string} dispatch The dispatch id that the payload names.
 * @property {string | null} stopReason The `stopReason` of the payload.
 * @property {string} createdAt
 */

/**
 * Read the wakes that Orca never delivered to the coordinator from a
 * `runInbox` answer: messages to `run:<runId>` with `delivered_at` null,
 * older than `minAgeMs`, whose payload names one of `dispatchIds`, and that
 * are not a `question` (a question needs the user, never a step). Oldest
 * first. Every fault reads as no wake.
 *
 * @param {OrcaAnswer} answer
 * @param {{ runId: string, dispatchIds: string[], now: Date, minAgeMs: number }} opts
 * @returns {MailWake[]}
 */
export function undeliveredWakes(answer, { runId, dispatchIds, now, minAgeMs }) {
  if (!answer || answer.kind !== 'ok' || !isPlainObject(answer.result) || !Array.isArray(answer.result.messages)) return [];
  /** @type {MailWake[]} */
  const wakes = [];
  for (const row of answer.result.messages) {
    if (!isPlainObject(row) || row.to_handle !== `run:${runId}`) continue;
    if (row.delivered_at !== null && row.delivered_at !== undefined) continue;
    if (typeof row.id !== 'string' || row.id === '' || typeof row.type !== 'string' || row.type === 'question') continue;
    const created = orcaTime(row.created_at);
    if (created === null || now.getTime() - created.getTime() < minAgeMs) continue;
    let payload = row.payload;
    if (typeof payload === 'string') {
      try {
        payload = JSON.parse(payload);
      } catch {
        payload = null;
      }
    }
    if (!isPlainObject(payload) || typeof payload.dispatchId !== 'string' || !dispatchIds.includes(payload.dispatchId)) continue;
    wakes.push({
      id: row.id,
      kind: row.type,
      dispatch: payload.dispatchId,
      stopReason: typeof payload.stopReason === 'string' && payload.stopReason ? payload.stopReason : null,
      createdAt: created.toISOString(),
    });
  }
  return wakes.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * @typedef {Object} OpenQuestions The questions of one tab that wait on the coordinator (fix 9).
 * @property {{ id: string, question: string, options: string[], createdAt: string }[]} questions
 *   The `question` messages of `dispatch:<id>` to the run mailbox that no message answers yet (no other
 *   row names the question as its `thread_id`). Oldest first.
 * @property {string[]} detail One line per question, for the action detail.
 */

/**
 * Read the open questions of one tab from an `inbox --run --full` answer.
 * A worker asks with the `ask` command of its preamble, and then it ends its
 * turn to wait for the answer. Orca can hold that question from the
 * coordinator (it typed no wake), so the tab is idle, and only the answer
 * moves it on. The answer of `reply` is a message to the tab whose
 * `thread_id` is the id of the question. `read` and `delivered_at` do not
 * tell: a `check` of the coordinator marks the question read, and leaves
 * `delivered_at` null. Every fault reads as no question, so a failed read
 * never changes a decision.
 *
 * @param {OrcaAnswer} answer The answer of orcaCalls.runMail().
 * @param {{ dispatchId: string }} opts
 * @returns {OpenQuestions}
 */
export function openQuestions(answer, { dispatchId }) {
  /** @type {OpenQuestions} */
  const none = { questions: [], detail: [] };
  if (!answer || answer.kind !== 'ok' || !isPlainObject(answer.result) || !Array.isArray(answer.result.messages)) return none;
  const rows = answer.result.messages.filter(isPlainObject);
  const answered = new Set(
    rows.filter((row) => typeof row.thread_id === 'string' && row.thread_id !== row.id).map((row) => row.thread_id)
  );
  const questions = [];
  for (const row of rows) {
    if (row.type !== 'question' || typeof row.id !== 'string' || row.id === '' || answered.has(row.id)) continue;
    if (typeof row.to_handle !== 'string' || !row.to_handle.startsWith('run:')) continue;
    const payload = payloadOf(row.payload);
    if (row.from_handle !== `dispatch:${dispatchId}` && payload.dispatchId !== dispatchId) continue;
    const created = orcaTime(row.created_at);
    const text = typeof payload.question === 'string' && payload.question ? payload.question : typeof row.body === 'string' ? row.body : '';
    if (created === null || text === '') continue;
    questions.push({ id: row.id, question: text, options: optionsOf(payload.options), createdAt: created.toISOString() });
  }
  questions.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const detail = questions.map(
    (question) => `Orca: the question ${question.id} of dispatch:${dispatchId} has no answer yet (sent ${question.createdAt}).`
  );
  return { questions, detail };
}

/**
 * @param {unknown} value The `payload` of an `inbox --full` row: a JSON text, or an object.
 * @returns {Record<string, any>}
 */
function payloadOf(value) {
  if (isPlainObject(value)) return /** @type {Record<string, any>} */ (value);
  if (typeof value !== 'string' || value === '') return {};
  try {
    const parsed = JSON.parse(value);
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * @param {unknown} value The `options` of a question payload: a list, or the CSV text of `ask --options`.
 * @returns {string[]}
 */
function optionsOf(value) {
  const list = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  return list.filter((option) => typeof option === 'string').map((option) => option.trim()).filter((option) => option !== '');
}

/**
 * @param {unknown} value An Orca time: ISO 8601, or the SQLite form "YYYY-MM-DD HH:MM:SS" in UTC.
 * @returns {Date | null}
 */
function orcaTime(value) {
  if (typeof value !== 'string' || value === '') return null;
  const text = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? `${value.replace(' ', 'T')}Z` : value;
  const ms = Date.parse(text);
  return Number.isNaN(ms) ? null : new Date(ms);
}

/**
 * Normalize a `worker-show` answer to one state of fact O3. The default
 * `--json` view names the worker state as `result.state`, with
 * `result.liveness` and `result.activity`. The `--full` shape names
 * `result.dispatch.status`, `result.observation.status`, and
 * `result.projection`. Both shapes read here. A dispatch that Orca does not
 * know is gone. Any other failed read is unknown, so the run waits. The
 * terminal handle of the tab comes along when Orca names one.
 *
 * @param {OrcaAnswer} answer
 * @returns {{ state: 'busy' | 'idle' | 'done' | 'failed' | 'gone' | 'circuit' | 'unknown', detail: string[], terminal: string | null }}
 */
export function normalizeWorker(answer) {
  if (answer.kind === 'failed' && answer.code === 'dispatch_not_found') {
    return { state: 'gone', detail: answer.detail, terminal: null };
  }
  if (answer.kind !== 'ok') return { state: 'unknown', detail: answer.detail, terminal: null };
  const result = isPlainObject(answer.result) ? answer.result : {};

  if (isPlainObject(result.dispatch) && typeof result.dispatch.status === 'string') {
    const status = result.dispatch.status;
    const projection = isPlainObject(result.projection) ? result.projection : {};
    const verdict = isPlainObject(projection.liveness) ? projection.liveness.verdict : undefined;
    const observed = isPlainObject(result.observation) ? result.observation.status : undefined;
    const activity = isPlainObject(projection.stage) ? projection.stage.activity : undefined;
    const handle = isPlainObject(result.worker) ? result.worker.agentTerminalHandle : undefined;
    const terminal = typeof handle === 'string' && handle.length > 0 ? handle : null;
    const detail = [
      `Orca: dispatch ${status}, liveness ${verdict ?? observed ?? 'unknown'}, activity ${activity ?? 'unknown'}.`,
    ];
    if (status === 'completed') return { state: 'done', detail, terminal };
    if (status === 'circuit_broken') return { state: 'circuit', detail, terminal };
    if (status === 'failed') return { state: 'failed', detail, terminal };
    if (verdict === 'exited' || observed === 'exited') return { state: 'gone', detail, terminal };
    if (verdict === 'live' || observed === 'live') {
      if (activity === 'working' || waitsOnPerson(result)) return { state: 'busy', detail, terminal };
      if (activity === 'done' || activity === 'waiting' || activity === 'blocked') return { state: 'idle', detail, terminal };
    }
    return { state: 'unknown', detail, terminal };
  }

  if (typeof result.state === 'string') {
    const state = result.state;
    const liveness = typeof result.liveness === 'string' ? result.liveness : '';
    const activity = typeof result.activity === 'string' ? result.activity : '';
    const terminal = typeof result.terminal === 'string' && result.terminal.length > 0 ? result.terminal : null;
    const parts = [`worker ${state}`];
    if (typeof result.stage === 'string') parts.push(`stage ${result.stage}`);
    if (liveness) parts.push(`liveness ${liveness}`);
    if (activity) parts.push(`activity ${activity}`);
    const detail = [`Orca: ${parts.join(', ')}.`];
    if (typeof result.lastError === 'string' && result.lastError) detail.push(`Orca last error: ${result.lastError}`);
    if (waitsOnPerson(result)) {
      detail.push(`Orca: the tab waits on a person: ${result.waitingOnHuman}`);
    }
    switch (state) {
      case 'succeeded':
        return { state: 'done', detail, terminal };
      case 'failed':
        return { state: 'failed', detail, terminal };
      case 'stopped':
      case 'abandoned':
      case 'stop_unknown':
        return { state: 'gone', detail, terminal };
      case 'starting':
        return { state: 'busy', detail, terminal };
      case 'ready':
        if (liveness.startsWith('exited')) return { state: 'gone', detail, terminal };
        if (liveness.startsWith('live')) {
          // A tab that waits on a person is busy: the run waits, and no send reaches the tab.
          if (activity === 'working' || waitsOnPerson(result)) return { state: 'busy', detail, terminal };
          if (activity === 'idle' || activity === 'waiting' || activity === 'blocked') return { state: 'idle', detail, terminal };
        }
        return { state: 'unknown', detail, terminal };
      default:
        return { state: 'unknown', detail, terminal };
    }
  }

  return { state: 'unknown', detail: ['worker-show named no dispatch status and no worker state.'], terminal: null };
}

/** The units of the `lastActivity` text of `worker-show --json`, such as "2m ago" (fix 8). */
const AGO_UNITS = { s: 1000, m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000 };

/**
 * How long a tab that Orca shows in a running turn has been quiet (fix 8):
 * the time since the last status event of its agent. Orca sets the activity
 * of a tab from the hooks of its agent, and only a Stop (or StopFailure) hook
 * ends a turn. Claude Code runs no Stop hook when the user interrupts a turn
 * (Esc), so Orca shows that tab as `working` for ever, and sends no wake.
 * The default view names the time as `lastActivity` ("2m ago"); the `--full`
 * view names it as `projection.liveness.observedAt` (epoch ms, source
 * `agent_status`). Null when the tab is not live and `working`, when it
 * waits on a person, or when Orca names no time.
 *
 * @param {OrcaAnswer} answer
 * @param {Date} now
 * @returns {number | null}
 */
export function turnQuietMs(answer, now) {
  if (!answer || answer.kind !== 'ok' || !isPlainObject(answer.result)) return null;
  const result = answer.result;
  if (waitsOnPerson(result)) return null;
  if (isPlainObject(result.dispatch)) {
    const projection = isPlainObject(result.projection) ? result.projection : {};
    const liveness = isPlainObject(projection.liveness) ? projection.liveness : {};
    const activity = isPlainObject(projection.stage) ? projection.stage.activity : undefined;
    if (result.dispatch.status !== 'dispatched' || liveness.verdict !== 'live' || activity !== 'working') return null;
    if (liveness.source !== 'agent_status' || typeof liveness.observedAt !== 'number') return null;
    return Math.max(0, now.getTime() - liveness.observedAt);
  }
  if (result.state !== 'ready' || result.activity !== 'working') return null;
  if (typeof result.liveness !== 'string' || !result.liveness.startsWith('live')) return null;
  if (typeof result.lastActivity !== 'string') return null;
  const text = result.lastActivity.trim().toLowerCase();
  if (text === 'just now' || text === 'now') return 0;
  const match = /^(\d+)\s*([smhd])[a-z]*\s+ago$/.exec(text);
  return match ? Number(match[1]) * AGO_UNITS[/** @type {'s' | 'm' | 'h' | 'd'} */ (match[2])] : null;
}

/**
 * The `activity` values of a turn that runs, in the field view of
 * `worker-show` (fix 1). Orca names an activity only for a live tab, from
 * the status hooks of the agent (`worker-agent-views.ts:229-234`). dsh
 * sends `working` on UserPromptSubmit, PreToolUse, and PostToolUse, and
 * `waiting` for its question tool (`dsh-events.ts:34-49`).
 */
export const TURN_ACTIVITIES = ['working', 'waiting', 'blocked'];

/**
 * The worker states of a tab whose prompt can still be a draft (fix 1).
 * Orca writes `ready` (stage `input_accepted`) when it saw the turn start,
 * and also when it cannot see a turn start. For dsh it never can: Orca
 * watches the turn start of antigravity, claude, and codex only
 * (`agent-prompt-submission-verification.ts:51-55`). So a dsh receipt reads
 * `ready` with the prompt still a draft. Orca writes `start_unknown` (stage
 * `turn_start_unobserved`) when it watched for 30 seconds and saw no turn
 * start (`worker-start-readiness-settlement.ts:104-123`).
 */
export const PRE_TURN_STATES = ['starting', 'ready', 'start_unknown'];

/**
 * Whether the turn of a new tab started, from one `worker-show --json`
 * answer: the field view, with `state`, `stage`, `liveness`, `activity`,
 * and `waitingOnHuman` (fact S1). The signal of a started turn is an
 * `activity` of TURN_ACTIVITIES, or a worker that a report settled (`state`
 * `succeeded`, or `stage` `settled`). dsh sends `idle` at SessionStart too,
 * so `idle` proves no turn. The outcomes:
 *
 * - `started`: the turn started.
 * - `person`: the tab waits on a person: an overlay or a permission prompt
 *   can be on the screen.
 * - `pre-turn`: a state of PRE_TURN_STATES on a tab that did not exit, with
 *   no activity or with `idle`. The prompt can still be a draft.
 * - `stopped`: any other state. The worker or its tab stopped.
 * - `unread`: the read failed, or it named no worker state.
 *
 * @param {OrcaAnswer} answer
 * @returns {{ turn: 'started' | 'person' | 'pre-turn' | 'stopped' | 'unread', detail: string[], terminal: string | null }}
 *   `terminal`: the terminal of the tab, when the view names one.
 */
export function turnStartOf(answer) {
  const worker = normalizeWorker(answer);
  const result = answer.kind === 'ok' && isPlainObject(answer.result) ? answer.result : null;
  if (!result || typeof result.state !== 'string') {
    return { turn: 'unread', detail: result ? ['worker-show named no worker state.'] : worker.detail, terminal: null };
  }
  const activity = typeof result.activity === 'string' ? result.activity : '';
  const liveness = typeof result.liveness === 'string' ? result.liveness : '';
  const seen = { detail: worker.detail, terminal: worker.terminal };
  if (TURN_ACTIVITIES.includes(activity) || result.state === 'succeeded' || result.stage === 'settled') return { turn: 'started', ...seen };
  if (waitsOnPerson(result)) return { turn: 'person', ...seen };
  if (PRE_TURN_STATES.includes(result.state) && !liveness.startsWith('exited')) return { turn: 'pre-turn', ...seen };
  return { turn: 'stopped', ...seen };
}

/**
 * Parse `git status --porcelain=v1 -z`: one path per entry. A rename or a
 * copy carries its source path as the next entry, which the list skips.
 *
 * @param {string} body
 * @returns {string[]}
 */
export function parsePorcelain(body) {
  /** @type {string[]} */
  const files = [];
  const entries = String(body ?? '').split('\0');
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    if (entry.length < 4) continue;
    files.push(entry.slice(3));
    if (entry[0] === 'R' || entry[0] === 'C') i += 1;
  }
  return files;
}

/**
 * The flag of a message body. The Orca parser reads a value that starts
 * with `--` as the next flag, and it reads `--body=<text>` as one value
 * (`src/cli/args.ts` of the Orca source). So a body that starts with `--`
 * takes the equals form. The body stays one argument in both forms.
 *
 * @param {string} body
 * @returns {string[]}
 */
export function bodyArgs(body) {
  return body.startsWith('--') ? [`--body=${body}`] : ['--body', body];
}

/**
 * @param {string[]} args
 * @param {number} [timeoutMs]
 * @returns {Call}
 */
function orcaRead(args, timeoutMs = READ_TIMEOUT_MS) {
  return { tool: 'orca', args, timeoutMs, change: false };
}

/**
 * @param {string[]} args
 * @param {number} [timeoutMs]
 * @returns {Call}
 */
function orcaChange(args, timeoutMs = READ_TIMEOUT_MS) {
  return { tool: 'orca', args, timeoutMs, change: true };
}

/**
 * @typedef {{ worktree: 'current' }
 *   | { worktree: 'new-child', name: string, baseBranch: string }
 *   | { worktree: string }} Placement Where a tab opens: the current workspace, a new child
 *   worktree of a lane (fact O11), or the worktree of a lane by its selector (fact O12).
 */

/**
 * The `--worktree` flags of one placement. A new child worktree names the
 * lane with `--name`, and it starts from `--base-branch`. Orca names the
 * branch of the worktree from that name and its branch prefix (Notes 6).
 *
 * @param {Placement | undefined} placement Default: the current workspace.
 * @returns {string[]}
 */
function placementArgs(placement) {
  if (!placement || placement.worktree === 'current') return ['--worktree', 'current'];
  if (placement.worktree === 'new-child') {
    const child = /** @type {{ name: string, baseBranch: string }} */ (placement);
    return ['--worktree', 'new-child', '--name', child.name, '--base-branch', child.baseBranch];
  }
  return ['--worktree', placement.worktree];
}

/**
 * The `--task-title` argument of a first start (fix 5): one argument, exactly
 * as written. No title gives no argument. A custom tab title is never pinned.
 *
 * @param {string | undefined} title
 * @returns {string[]}
 */
function titleArgs(title) {
  return typeof title === 'string' && title.length > 0 ? ['--task-title', title] : [];
}

/**
 * The worktree selector of a lane for a later tab and for its removal
 * (fact O12). The path comes from `git worktree list --porcelain`, so a
 * run that lost the receipt still finds it.
 *
 * @param {string} worktreePath An absolute path.
 * @returns {string}
 */
export function laneSelector(worktreePath) {
  return `path:${worktreePath}`;
}

/**
 * The worktree of a `worker-start` receipt (fact O11). The default view
 * names it as `result.workspace`, the id of its worktree effect
 * (`worker-start-agent-view.ts:73`). A worktree id is `<repo-id>::<path>`
 * (`worktree-selector-recovery.ts:34`), so the path follows the first
 * `::`. The `--full` shape names the effect in `result.effects`. Null when
 * the receipt names no worktree, or an id with no absolute path.
 *
 * @param {unknown} result The `result` object of the receipt.
 * @returns {{ id: string, path: string } | null}
 */
export function receiptWorktree(result) {
  if (!isPlainObject(result)) return null;
  let id = typeof result.workspace === 'string' ? result.workspace : null;
  if (!id && Array.isArray(result.effects)) {
    const effect = result.effects.find((item) => isPlainObject(item) && item.kind === 'worktree' && typeof item.id === 'string');
    id = effect ? effect.id : null;
  }
  if (!id) return null;
  const at = id.indexOf('::');
  const worktreePath = at === -1 ? '' : id.slice(at + 2);
  if (!worktreePath || !(worktreePath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(worktreePath))) return null;
  return { id, path: worktreePath };
}

/**
 * The terminal of the agent in a `worker-start` receipt (fix 1). The
 * default view names it as `result.terminal`, the id of the terminal effect
 * with the role `agent` (`worker-start-agent-view.ts:72`). The `--full`
 * shape names that effect in `result.effects`. Null when the receipt names
 * no terminal: `worker-show` names it too (fact S1).
 *
 * @param {unknown} result The `result` object of the receipt.
 * @returns {string | null}
 */
export function receiptTerminal(result) {
  if (!isPlainObject(result)) return null;
  if (typeof result.terminal === 'string' && result.terminal.length > 0) return result.terminal;
  if (!Array.isArray(result.effects)) return null;
  const effect = result.effects.find(
    (item) => isPlainObject(item) && item.kind === 'terminal' && item.role === 'agent' && typeof item.id === 'string' && item.id.length > 0
  );
  return effect ? effect.id : null;
}

/**
 * The Orca calls of §The steps, one builder each. Five reads (`status`,
 * `worker-show`, `inbox`, `runInbox`, and `runMail`) and the state changes. A retry of a failed start names the
 * Task and the failed dispatch, never a spec, and it repeats the placement
 * and the agent, because Orca does not inherit them. `worktreeRemove`
 * takes no flag that stops a process or deletes the branch (fact O13), so a
 * worktree with work in it stays, and so does its branch.
 */
export const orcaCalls = {
  /** @returns {Call} */
  status: () => orcaRead(['status', '--json']),
  /** @param {string} dispatchId @returns {Call} */
  workerShow: (dispatchId) => orcaRead(['orchestration', 'worker-show', '--dispatch', dispatchId, '--json']),
  /**
   * The mail of one tab (fix 7): `inbox` lists the mailbox and marks nothing
   * read, so the tab still gets its mail. `--full` names `delivered_at`,
   * which the concise view leaves out.
   *
   * @param {string} dispatchId @returns {Call}
   */
  inbox: (dispatchId) =>
    orcaRead(['orchestration', 'inbox', '--terminal', `dispatch:${dispatchId}`, '--limit', String(INBOX_LIMIT), '--full', '--json']),
  /**
   * The mail of the coordinator (fix 7): the mailbox of the Run, read with
   * the same no-mark `inbox --full`. A wake that Orca failed to deliver to
   * the coordinator stays here with `delivered_at` null.
   *
   * @param {string} runId @returns {Call}
   */
  runInbox: (runId) =>
    orcaRead(['orchestration', 'inbox', '--terminal', `run:${runId}`, '--limit', String(INBOX_LIMIT), '--full', '--json']),
  /**
   * All the mail of one run (fix 9): the questions of its tabs and their
   * answers. It is wider than `runInbox`: `--run` also lists the answers
   * that `reply` sends to `dispatch:<id>`, and only an answer tells an open
   * question from an answered one. `inbox` marks nothing read, so the
   * coordinator still gets its wake.
   *
   * @param {string} runId @returns {Call}
   */
  runMail: (runId) => orcaRead(['orchestration', 'inbox', '--run', runId, '--limit', String(INBOX_LIMIT), '--full', '--json']),
  /**
   * `title` is the Task title, and Orca shows it as the tab title (fix 5).
   * A retry names no title: the Task keeps it.
   *
   * @param {{ specFile: string, agent: string, placement?: Placement, title?: string }} opts @returns {Call}
   */
  workerStart: ({ specFile, agent, placement, title }) =>
    orcaChange(
      [
        'orchestration',
        'worker-start',
        '--spec-file',
        specFile,
        ...titleArgs(title),
        ...placementArgs(placement),
        '--agent',
        agent,
        '--timeout-ms',
        WORKER_START_WAIT_MS,
        '--json',
      ],
      WORKER_START_TIMEOUT_MS
    ),
  /** @param {{ taskId: string, retryOf: string, agent: string, placement?: Placement }} opts @returns {Call} */
  workerRetry: ({ taskId, retryOf, agent, placement }) =>
    orcaChange(
      [
        'orchestration',
        'worker-start',
        '--task',
        taskId,
        '--retry-of',
        retryOf,
        ...placementArgs(placement),
        '--agent',
        agent,
        '--timeout-ms',
        WORKER_START_WAIT_MS,
        '--json',
      ],
      WORKER_START_TIMEOUT_MS
    ),
  /** @param {string} dispatchId @returns {Call} */
  workerRelease: (dispatchId) => orcaChange(['orchestration', 'worker-release', '--dispatch', dispatchId, '--json']),
  /** @param {string} selector A worktree selector, from laneSelector(). @returns {Call} */
  worktreeRemove: (selector) => orcaChange(['worktree', 'rm', '--worktree', selector, '--json'], WRITE_TIMEOUT_MS),
  /** @param {{ dispatchId: string, subject: string, body: string }} opts @returns {Call} */
  send: ({ dispatchId, subject, body }) =>
    orcaChange(['orchestration', 'send', '--to', `dispatch:${dispatchId}`, '--subject', subject, ...bodyArgs(body), '--json']),
  /** @param {{ id: string, body: string }} opts @returns {Call} */
  reply: ({ id, body }) => orcaChange(['orchestration', 'reply', '--id', id, ...bodyArgs(body), '--json']),
  /**
   * One bare Enter in a tab (fix 1): `terminal send --enter` with no
   * `--text` writes one `\r` (`src/cli/handlers/terminal-send.ts:14-25`).
   * A dsh tab refuses the Enter of the start until its session opens, and
   * it keeps the prompt as a draft. After dsh submits, its box is empty, so
   * one more Enter sends nothing. A state change: it never runs again by
   * itself.
   *
   * @param {string} terminal A terminal handle. @returns {Call}
   */
  terminalEnter: (terminal) => orcaChange(['terminal', 'send', '--terminal', terminal, '--enter', '--json']),

  // The low-level path of a project command (Decision 16, fact O15):
  // `worker-start` has no flag for a custom command, so the command opens
  // its own terminal, and `worker-start --terminal` gives the Task to it.

  /**
   * The command stays one argument, exactly as written. No `--title`: a
   * pinned title hides the title evidence that Orca reads for agent status
   * (launch-config Decision 4). The rule stays for `terminal create`. The
   * tab title of the command path comes from `terminalRename` after the
   * start (fix 6).
   *
   * @param {{ selector: string, command: string }} opts @returns {Call}
   */
  terminalCreate: ({ selector, command }) => orcaChange(['terminal', 'create', '--worktree', selector, '--command', command, '--json']),
  /**
   * Give a started tab its title (fix 6). Orca opens the worker tab of the
   * agent path with the fixed title `worker-<taskId>`, and that title
   * protects the tab, so Orca never applies the Task title to it. The
   * command path opens its tab with no title. A rename after the start sets
   * the title, and the agent status of the worker does not change. The
   * title stays one argument. A state change: it never retries by itself.
   *
   * @param {{ terminal: string, title: string }} opts A handle of a started tab, and the Task title. @returns {Call}
   */
  terminalRename: ({ terminal, title }) => orcaChange(['terminal', 'rename', '--terminal', terminal, '--title', title, '--json']),
  /**
   * Close the terminal that our own command-path start opened (fix 3). Orca
   * does not own that terminal, so `worker-release` answers `retained` and
   * leaves the tab. One pane with no `--tab`: the tab of `terminal create`
   * holds that one pane (`src/cli/specs/terminal-close.ts`). A state change:
   * it never runs again by itself. Only the close and merge paths call it.
   *
   * @param {string} terminal A handle from terminalCreate. @returns {Call}
   */
  terminalClose: (terminal) => orcaChange(['terminal', 'close', '--terminal', terminal, '--json']),
  /** @param {string} terminal A handle from terminalCreate. @returns {Call} Exit 1 when the tab did not show ready. */
  terminalWait: (terminal) =>
    orcaRead(['terminal', 'wait', '--terminal', terminal, '--for', 'tui-idle', '--timeout-ms', TUI_IDLE_WAIT_MS, '--json'], TERMINAL_WAIT_TIMEOUT_MS),
  /** @param {{ specFile: string, terminal: string, selector: string, title?: string }} opts @returns {Call} */
  workerAttach: ({ specFile, terminal, selector, title }) =>
    orcaChange(
      ['orchestration', 'worker-start', '--spec-file', specFile, ...titleArgs(title), '--terminal', terminal, '--worktree', selector, '--json'],
      WORKER_START_TIMEOUT_MS
    ),
  /**
   * The retry of a failed start of the command path: the same Task, in a
   * new terminal of the command. No spec, because the Task keeps it.
   *
   * @param {{ taskId: string, retryOf: string, terminal: string, selector: string }} opts @returns {Call}
   */
  workerAttachRetry: ({ taskId, retryOf, terminal, selector }) =>
    orcaChange(
      ['orchestration', 'worker-start', '--task', taskId, '--retry-of', retryOf, '--terminal', terminal, '--worktree', selector, '--json'],
      WORKER_START_TIMEOUT_MS
    ),
  /**
   * The workspace of a new lane with a project command, made before its
   * terminal (Notes 8): a child of the main workspace, from the epic branch.
   *
   * @param {{ name: string, baseBranch: string }} opts @returns {Call}
   */
  worktreeCreate: ({ name, baseBranch }) =>
    orcaChange(['worktree', 'create', '--name', name, '--parent-worktree', 'active', '--base-branch', baseBranch, '--json'], WRITE_TIMEOUT_MS),
};

/**
 * @param {string} value
 * @returns {boolean} An absolute POSIX or Windows path.
 */
function isAbsolutePath(value) {
  return value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value);
}

/**
 * The handle of a `terminal create --json` answer: `result.terminal.handle`
 * (`runtime-terminal-create-contract.ts`, as the launch route reads it).
 * Null when the answer names none.
 *
 * @param {unknown} result The `result` object of the answer.
 * @returns {string | null}
 */
export function terminalHandleOf(result) {
  if (!isPlainObject(result) || !isPlainObject(result.terminal)) return null;
  const handle = result.terminal.handle;
  return typeof handle === 'string' && handle.length > 0 ? handle : null;
}

/**
 * The tab showed ready: the `terminal wait --for tui-idle` answer holds
 * `result.wait.satisfied: true`. The CLI prints `satisfied: false` with
 * exit 1 when the condition did not hold, and a timeout answers an error.
 *
 * @param {OrcaAnswer} answer
 * @returns {boolean}
 */
export function waitSatisfied(answer) {
  return answer.kind === 'ok' && isPlainObject(answer.result) && isPlainObject(answer.result.wait) && answer.result.wait.satisfied === true;
}

/**
 * The worktree of a `worktree create --json` answer: `result.worktree`,
 * with its `id` (`<repo-id>::<path>`) and its `path`
 * (`RuntimeWorktreeCreateResult`). The path falls back to the part of the
 * id after the first `::`. Null when the answer names no absolute path.
 *
 * @param {unknown} result The `result` object of the answer.
 * @returns {{ id: string | null, path: string } | null}
 */
export function createdWorktree(result) {
  if (!isPlainObject(result) || !isPlainObject(result.worktree)) return null;
  const id = typeof result.worktree.id === 'string' && result.worktree.id.length > 0 ? result.worktree.id : null;
  const fromId = id && id.includes('::') ? id.slice(id.indexOf('::') + 2) : '';
  const worktreePath = typeof result.worktree.path === 'string' && result.worktree.path ? result.worktree.path : fromId;
  return worktreePath && isAbsolutePath(worktreePath) ? { id, path: worktreePath } : null;
}

/**
 * @param {string[]} args
 * @returns {Call}
 */
function gitRead(args) {
  return { tool: 'git', args, timeoutMs: READ_TIMEOUT_MS, change: false };
}

/**
 * @param {string[]} args
 * @param {number} [timeoutMs]
 * @returns {Call}
 */
function gitWrite(args, timeoutMs = WRITE_TIMEOUT_MS) {
  return { tool: 'git', args, timeoutMs, change: true };
}

/** The git calls of §The steps, one builder each: the reads, then the writes. */
export const gitCalls = {
  /** @returns {Call} */
  insideWorkTree: () => gitRead(['rev-parse', '--is-inside-work-tree']),
  /** @returns {Call} */
  head: () => gitRead(['symbolic-ref', '--quiet', '--short', 'HEAD']),
  /** @returns {Call} */
  originHead: () => gitRead(['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']),
  /** @param {string} name @returns {Call} */
  verifyBranch: (name) => gitRead(['rev-parse', '--verify', '--quiet', `refs/heads/${name}`]),
  /** @param {string} branch @returns {Call} */
  baseKey: (branch) => gitRead(['config', '--get', `branch.${branch}.beast-mode-base`]),
  /** @returns {Call} */
  status: () => gitRead(['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.', BRIEFS_EXCLUDE]),
  /** @param {string} base @returns {Call} */
  logSince: (base) => gitRead(['log', '--format=%s', `${base}..HEAD`, '--']),
  /** @returns {Call} */
  logAll: () => gitRead(['log', '--format=%s', '--max-count=1000', 'HEAD', '--']),
  /** @returns {Call} */
  revParseHead: () => gitRead(['rev-parse', 'HEAD']),
  /** @param {string} epic @returns {Call} The branches of an epic run: `epic/<epic>`, and each `feat/<epic>/<feature>`. */
  epicRefs: (epic) => gitRead(['for-each-ref', '--format=%(refname)', `refs/heads/epic/${epic}`, `refs/heads/feat/${epic}/`]),
  /** @returns {Call} Every beast-mode key of every branch, one `<key> <value>` line each. Exit 1 for no key. */
  runKeys: () => gitRead(['config', '--get-regexp', '^branch\\..*\\.beast-mode-']),
  /** @param {string} branch @param {string} into @returns {Call} Exit 0 when `into` holds `branch`, exit 1 when not. */
  isAncestor: (branch, into) => gitRead(['merge-base', '--is-ancestor', `refs/heads/${branch}`, `refs/heads/${into}`]),
  /** @returns {Call} The paths with a merge conflict. */
  conflicts: () => gitRead(['diff', '--name-only', '--diff-filter=U']),
  /** @returns {Call} Exit 0 while a merge waits for its commit. */
  mergeHead: () => gitRead(['rev-parse', '--quiet', '--verify', 'MERGE_HEAD']),
  /** @param {string} file A project-relative path. @returns {Call} */
  statusOf: (file) => gitRead(['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', file]),
  /** @returns {Call} Every worktree of the repository, with its path and its branch. */
  worktreeList: () => gitRead(['worktree', 'list', '--porcelain']),
  /** @returns {Call} The branch of HEAD, or "HEAD" when HEAD is detached: the branch that Orca gave a lane. */
  branchName: () => gitRead(['rev-parse', '--abbrev-ref', 'HEAD']),
  /** @param {string} ref @param {string} file @returns {Call} Exit 0 when the tree of `ref` holds `file`. */
  treeHas: (ref, file) => gitRead(['cat-file', '-e', `${ref}:${file}`]),
  /**
   * @param {string} dir The lane worktree, an absolute path.
   * @param {Call} spec Any git call above.
   * @returns {Call} The same call, run in the lane worktree with `git -C <dir>`.
   */
  inTree: (dir, spec) => ({ ...spec, args: ['-C', dir, ...spec.args] }),
  /** @param {string} branch @param {string} base @returns {Call} */
  switchCreate: (branch, base) => gitWrite(['switch', '-c', branch, base]),
  /** @param {string} branch @param {'epic' | 'feature' | 'merged'} key @param {string} value @returns {Call} */
  setKey: (branch, key, value) => gitWrite(['config', `branch.${branch}.beast-mode-${key}`, value]),
  /** @param {string} message @param {string} branch @returns {Call} Always a merge commit, with the hooks of the user. */
  merge: (message, branch) => gitWrite(['merge', '--no-ff', '--no-edit', '-m', message, branch], COMMIT_TIMEOUT_MS),
  /** @returns {Call} */
  mergeAbort: () => gitWrite(['merge', '--abort']),
  /** @param {string[]} files Project-relative paths. @returns {Call} */
  addPaths: (files) => gitWrite(['add', '--', ...files]),
  /** @param {string} branch @returns {Call} */
  switchTo: (branch) => gitWrite(['switch', branch]),
  /** @param {string} branch @param {string} base @returns {Call} */
  setBase: (branch, base) => gitWrite(['config', `branch.${branch}.beast-mode-base`, base]),
  /** @returns {Call} */
  addAll: () => gitWrite(['add', '-A', '--', '.', BRIEFS_GLOB_EXCLUDE]),
  /** @param {string} subject @returns {Call} */
  commit: (subject) => gitWrite(['commit', '-m', subject], COMMIT_TIMEOUT_MS),
};

/**
 * @param {string[]} args
 * @param {RunResult} result
 * @returns {string[]} The command, its exit, and its output, capped.
 */
function gitDetail(args, result) {
  const head = `git ${args.join(' ')}`;
  if (result.error) return [`${head}: ${result.error.message}`];
  return [`${head} exited ${result.status ?? result.signal}.`, ...outputLines(result.stderr), ...outputLines(result.stdout)].slice(
    0,
    MAX_OUTPUT_LINES
  );
}

/**
 * @param {ExecContext} ctx
 * @param {Call} spec
 * @returns {GitAnswer}
 */
function runGit(ctx, spec) {
  // A read takes no optional lock, so it never blocks a tab that runs git
  // in the same work tree.
  const env = spec.change
    ? { ...ctx.env, GIT_TERMINAL_PROMPT: '0' }
    : { ...ctx.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' };
  const result = ctx.runner('git', spec.args, { cwd: ctx.workDir ?? ctx.projectRoot, timeoutMs: spec.timeoutMs, env });
  const ok = !result.error && result.status === 0;
  return { ...result, ok, detail: ok ? [] : gitDetail(spec.args, result) };
}

/**
 * @param {ExecContext} ctx
 * @param {Call} spec
 * @returns {OrcaAnswer}
 */
function runOrcaCall(ctx, spec) {
  const result = ctx.runner(ctx.orca, spec.args, { cwd: ctx.workDir ?? ctx.projectRoot, timeoutMs: spec.timeoutMs, env: ctx.env });
  return readAnswer(ctx.orca, spec.args, result);
}

/**
 * Run one built call. A git call answers a GitAnswer, and an Orca call
 * answers an OrcaAnswer. An Orca read that answers `runtime_unavailable`
 * waits 2 seconds and runs one more time. A state change never runs again
 * by itself, so a start, a release, a send, or a reply happens at most once
 * per step. Never throws for a child process failure.
 *
 * @param {ExecContext} ctx
 * @param {Call} spec
 * @returns {OrcaAnswer | GitAnswer}
 */
export function call(ctx, spec) {
  if (spec.tool === 'git') return runGit(ctx, spec);
  if (spec.tool !== 'orca') throw new Error(`call() got the unknown tool "${String(spec.tool)}".`);
  const answer = runOrcaCall(ctx, spec);
  if (spec.change || answer.kind !== 'failed' || answer.code !== RETRY_CODE) return answer;
  (ctx.sleep ?? sleepSync)(RETRY_DELAY_MS);
  return runOrcaCall(ctx, spec);
}
