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
 * The Orca calls of §The steps, one builder each. Two reads (`status` and
 * `worker-show`) and the state changes. A retry of a failed start names the
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
  /** @param {{ specFile: string, agent: string, placement?: Placement }} opts @returns {Call} */
  workerStart: ({ specFile, agent, placement }) =>
    orcaChange(
      [
        'orchestration',
        'worker-start',
        '--spec-file',
        specFile,
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
   * (launch-config Decision 4).
   *
   * @param {{ selector: string, command: string }} opts @returns {Call}
   */
  terminalCreate: ({ selector, command }) => orcaChange(['terminal', 'create', '--worktree', selector, '--command', command, '--json']),
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
  /** @param {{ specFile: string, terminal: string, selector: string }} opts @returns {Call} */
  workerAttach: ({ specFile, terminal, selector }) =>
    orcaChange(
      ['orchestration', 'worker-start', '--spec-file', specFile, '--terminal', terminal, '--worktree', selector, '--json'],
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
