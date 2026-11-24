// installer/lib/orca/steps.js
//
// The `beast-mode orca` sub-CLI. bin/beast-mode.js hands it the argument
// list after `orca`, before the main parse, so the six other commands keep
// their strict flag checks. Each step parses its own flags, prints one JSON
// object with `"schema": 1` on stdout, and prints nothing else. Every
// decided outcome exits 0, a refusal included. Two outcomes exit 1 with
// their object: an internal error, and the refusal `record-unwritable`,
// whose record lost the outcome of a start (CR-2). A usage error throws a
// UsageError, which bin/beast-mode.js prints as three lines with exit 2.
//
// The steps: `next` (reads only), the act steps `branch`, `start`, `close`,
// `commit`, and `send`, `reply`, which passes an answer of the user to the
// worker that asked, and `note`, which passes a user message to the
// running tab or to the inbox of the feature. `start` runs the stages plan,
// phase, review, review-fix, inbox, step, and docs, and `start --retry` retries a
// failed start on the same Orca Task. `detect` and `config` serve
// `/orca-setup` (setup.js): the facts of the machine and the project, and
// the write of the orchestration settings. Every child process runs through
// exec.js: the builders name the arguments, and call() runs them. For an
// idle dsh tab that rule A4 judges, `next` also reads the session folders of
// the dsh home with `fs` only (dsh.js, fix 2).
//
// Phase 6: a lane of a side-by-side group builds in a child worktree that
// Orca makes (`worker-start --worktree new-child`). Each step of the lane
// reads, records, and runs git there (`git -C <worktree>`), and `merge`
// removes the worktree after the merge. No lane writes to the main work
// tree before its merge.

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { UsageError } from '../errors.js';
import * as marker from '../marker.js';
import { adapters } from '../../adapters/index.js';
import {
  HANDOFF_REL,
  NO_KEYS,
  appendHumanTests,
  checkEpicName,
  checkFeaturePath,
  fillStepTokens,
  hasHandoff,
  humanTestingFromTemplate,
  inboxFromTemplate,
  inboxLine,
  inboxTime,
  insertInboxLine,
  isPhaseComplete,
  isPhaseNumber,
  laneBranchOf,
  laneWorktree,
  newEpicRecord,
  newRecord,
  parseRunKeys,
  parseWorktreeList,
  readEpicDocs,
  readEpicRecord,
  readFeatureDocs,
  readOrcaConfig,
  readRecord,
  recordPath,
  phaseVerdictKeptName,
  phaseVerdictName,
  fixSpecName,
  stepKey,
  stepPoint,
  stepSpecName,
  stepVerdictName,
  verifyBriefName,
  verifySpecName,
  writeEpicRecord,
  writeFileAtomic,
  writeRecord,
} from './read.js';
import {
  FINAL_MARK,
  LANE_REFUSED,
  RECORD_UNREADABLE,
  START_FAILURE_CAP,
  decideEpic,
  decideFeature,
  doneCheck,
  epicBranchOf,
  epicPlan,
  epicSetupStop,
  featureSubject,
  humanTestsSubject,
  laneMode,
  largeChangesSince,
  mergeSubject,
  phaseSubject,
  projectCommandOf,
  reviewPlacement,
  reviewSubject,
  runBranchOf,
  sendCounts,
  setupStop,
  COORDINATOR_MAIL_MS,
  TIMER_WAKE,
  UNDELIVERED_MAIL_MS,
  wantsDshChild,
  wantsOpenQuestions,
  wantsPendingMail,
} from './decide.js';
import { dshChildFact, showWorkspace } from './dsh.js';
import {
  SEND_REASONS,
  docsSpec,
  epicDocsSpec,
  fixSpec,
  inboxSpec,
  noteText,
  phaseSpec,
  planSpec,
  reviewFixSpec,
  reviewSpec,
  sendText,
  stepSpec,
  taskTitleOf,
  verifySpec,
} from './spec.js';
import { detect, readConfigFacts, writeOrchestration } from './setup.js';
import {
  CURRENT_WORKTREE,
  MAX_LINE_LENGTH,
  MAX_OUTPUT_LINES,
  call,
  createdWorktree,
  defaultRunner,
  gitCalls,
  laneSelector,
  normalizeWorker,
  openQuestions,
  turnQuietMs,
  undeliveredMail,
  undeliveredWakes,
  orcaArgsForHost,
  orcaCalls,
  parsePorcelain,
  receiptTerminal,
  receiptWorktree,
  resolveOrcaExecutable,
  resolveOrcaHost,
  wrongHostSentence,
  sleepSync,
  terminalHandleOf,
  turnStartOf,
  waitSatisfied,
} from './exec.js';

/** The schema of every JSON object that a step prints. */
export const SCHEMA = 1;

/** The steps of this version. */
export const STEPS = ['next', 'branch', 'start', 'close', 'commit', 'merge', 'send', 'reply', 'note', 'detect', 'config'];

/** The stages that `start` runs for a feature, also in a lane of `/orca-epic`. */
export const START_STAGES = ['plan', 'phase', 'verify', 'fix', 'review', 'review-fix', 'inbox', 'step', 'docs'];

/** The stages that `start --epic <epic>` runs with no `--feature`. */
export const EPIC_START_STAGES = ['epic-docs', 'step'];

/** The stages of new work. Their start clears the end-stage marks of the record. */
export const CLEARING_STAGES = ['phase', 'review', 'review-fix', 'inbox'];

/** The largest answer that `reply` passes: 64 KiB, well under the argument cap of the system. */
export const MAX_REPLY_BYTES = 65536;

/** The largest text that `note` passes, the same cap as `reply`. */
export const MAX_NOTE_BYTES = MAX_REPLY_BYTES;

/** The longest run of the submit loop of a dsh start: 45 seconds in all (fix 1). */
export const SUBMIT_WINDOW_MS = 45000;

/** The wait after each Enter of the submit loop. */
export const SUBMIT_DELAY_MS = 2000;

/** The most Enter presses of one submit loop: one for each wait of the window, also when the clock stands still. */
export const SUBMIT_MAX_ENTERS = Math.floor(SUBMIT_WINDOW_MS / SUBMIT_DELAY_MS);

/** The say line of a submit loop that saw no turn start. */
export const SUBMIT_UNCONFIRMED_SAY = 'dsh did not confirm the prompt. Press Enter in the tab if the prompt is still a draft.';

/** The `--kind` values of `note`, and the inbox kind of each (section 12 rule 2). */
export const NOTE_KINDS = {
  bug: 'bug',
  note: 'note',
  'change-small': 'change small',
  'change-medium': 'change medium',
  'change-large': 'change large',
};

/** An Orca message id, for example `msg_1` or `msg_followup_<hash>`. */
const MESSAGE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

/** The characters of an argument that the `run` line leaves unquoted. */
const SAFE_ARG = /^[A-Za-z0-9._/:=@+-]+$/;

/** @typedef {import('./exec.js').RunResult} RunResult The answer of one child process. */
/** @typedef {import('./exec.js').Runner} Runner The injectable runner of every child process. */
/** @typedef {import('./exec.js').OrcaAnswer} OrcaAnswer */
/** @typedef {import('./exec.js').GitAnswer} GitAnswer */
/** @typedef {import('./exec.js').Call} Call */

/**
 * @param {unknown} value
 * @returns {value is Record<string, any>}
 */
function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @returns {string | null} A string with one character or more, else null.
 */
function textOf(value) {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * @param {string} value
 * @returns {string} The value, single-quoted for a POSIX shell.
 */
function singleQuote(value) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Quote one argument of a `run` line: an argument with a character outside
 * `[A-Za-z0-9._/:=@+-]` is single-quoted.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function quoteArg(value) {
  const text = String(value);
  return SAFE_ARG.test(text) ? text : singleQuote(text);
}

/**
 * The exact command line of one step: the absolute node, the absolute bin
 * path, `orca`, the step and its flags, and `--project <abs>`. The three
 * paths are always quoted, as in the plan example.
 *
 * @param {{ node: string, bin: string, project: string }} cli
 * @param {string[]} args The step and its flags.
 * @returns {string}
 */
export function runLine(cli, args) {
  return [
    singleQuote(cli.node),
    singleQuote(cli.bin),
    'orca',
    ...args.map(quoteArg),
    '--project',
    singleQuote(cli.project),
  ].join(' ');
}

/**
 * Turn every `run` argument list of an action into its command line: the
 * action, each ask option, and the `{run}` token of a stop fix.
 *
 * @param {Record<string, any>} action
 * @param {{ node: string, bin: string, project: string }} cli
 * @returns {Record<string, any>}
 */
export function renderAction(action, cli) {
  const out = { ...action };
  if (Array.isArray(out.run)) out.run = runLine(cli, out.run);
  if (out.timer && Array.isArray(out.timer.run)) out.timer = { ...out.timer, run: runLine(cli, out.timer.run) };
  if (Array.isArray(out.options)) {
    out.options = out.options.map((option) => ({
      ...option,
      run: Array.isArray(option.run) ? runLine(cli, option.run) : null,
    }));
  }
  if (Array.isArray(out.fixRun)) {
    out.fix = String(out.fix).replace('{run}', runLine(cli, out.fixRun));
    delete out.fixRun;
  }
  return out;
}

/**
 * Run one built Orca call through exec.js.
 *
 * @param {StepRun} run
 * @param {Call} spec
 * @returns {OrcaAnswer}
 */
function orcaCall(run, spec) {
  const args = orcaArgsForHost(spec.args, run.env, run.platform, run.orcaHost ?? 'unknown');
  return /** @type {OrcaAnswer} */ (call(run, args === spec.args ? spec : { ...spec, args }));
}

/**
 * The say sentence of a start that failed on the form of the spec path
 * (fix 7): empty, or a space and one sentence. It never retries the start.
 *
 * @param {StepRun} run
 * @param {string[]} detail
 * @returns {string}
 */
function hostHint(run, detail) {
  const sentence = wrongHostSentence(detail, run.orcaHost ?? 'unknown');
  return sentence ? ` ${sentence}` : '';
}

/**
 * Run one built git call through exec.js. The run of a lane in a worktree
 * runs every git call there with `git -C <worktree>`.
 *
 * @param {StepRun} run
 * @param {Call} spec
 * @returns {GitAnswer}
 */
function gitCall(run, spec) {
  return /** @type {GitAnswer} */ (call(run, run.tree ? gitCalls.inTree(run.tree, spec) : spec));
}

/**
 * The run of a lane that builds in a child worktree (rule E14): every file
 * read, record, spec, and git call of the lane uses the worktree. Each
 * child process still starts in the main workspace, and the settings come
 * from there.
 *
 * @param {StepRun} run
 * @param {string} tree The absolute path of the lane worktree.
 * @returns {StepRun}
 */
function laneRun(run, tree) {
  return { ...run, projectRoot: tree, tree, workDir: mainRootOf(run) };
}

/**
 * @param {StepRun} run
 * @returns {string} The main workspace: the project of the call.
 */
function mainRootOf(run) {
  return run.workDir ?? run.projectRoot;
}

/**
 * Where a lane of `/orca-epic` builds: the branch that its keys name, and
 * the child worktree that holds that branch. A feature path of one segment
 * is never a lane. With no keyed branch, the branch is `feat/<path>`.
 * Reads only.
 *
 * @param {StepRun} run
 * @param {string} featurePath A checked feature path.
 * @returns {{ branch: string, worktree: import('./read.js').WorktreeEntry | null }}
 */
function laneSite(run, featurePath) {
  const fallback = { branch: runBranchOf(featurePath), worktree: null };
  const segments = featurePath.split('/');
  if (segments.length !== 2) return fallback;
  const keys = gitCall(run, gitCalls.runKeys());
  if (!keys.ok) return fallback;
  const list = gitCall(run, gitCalls.worktreeList());
  const entries = list.ok ? parseWorktreeList(list.stdout) : [];
  const branch = laneBranchOf(parseRunKeys(keys.stdout), segments[0], featurePath, entries, run.projectRoot);
  if (!branch) return fallback;
  return { branch, worktree: laneWorktree(entries, branch, run.projectRoot) };
}

/**
 * The run, the branch, and the worktree of a step of one feature. A step
 * of a lane (`--epic` with `--feature`) runs in the worktree of the lane
 * when it holds one. Every other step runs as it did.
 *
 * @param {StepRun} run
 * @param {{ path: string, lane: string | null }} checked
 * @returns {{ run: StepRun, branch: string, tree: string | null }}
 */
function laneOf(run, checked) {
  if (checked.lane === null) return { run, branch: runBranchOf(checked.path), tree: null };
  const site = laneSite(run, checked.path);
  if (!site.worktree) return { run, branch: site.branch, tree: null };
  return { run: laneRun(run, site.worktree.path), branch: site.branch, tree: site.worktree.path };
}

/**
 * @typedef {Object} StepRun The context of one step call. It is the ExecContext of exec.js too.
 * @property {string} step
 * @property {Record<string, any>} values The parsed flags.
 * @property {string} projectRoot The root of every file read and record: the lane worktree in a lane run.
 * @property {string} [tree] The lane worktree of a lane run. Every git call names it with `-C`.
 * @property {string} [workDir] The main workspace of a lane run: the working directory of every call.
 * @property {string} pluginRoot
 * @property {string} cwd The working directory of the call. A file flag resolves against it.
 * @property {Record<string, string | undefined>} env
 * @property {Runner} runner
 * @property {(ms: number) => void} sleep The wait before the one retry of an Orca read.
 * @property {string} platform The platform of the PATH search of `detect`.
 * @property {string} orca The Orca executable, chosen once.
 * @property {import('./exec.js').OrcaHost} [orcaHost] Where the Orca CLI runs (fix 7), probed once. Absent reads as `unknown`.
 * @property {{ node: string, bin: string, project: string }} cli
 * @property {() => Date} now
 */

/** The flags of every step. */
const COMMON_OPTIONS = {
  project: { type: 'string' },
  'plugin-root': { type: 'string' },
};

/** The flags of each step. Every other flag is a usage error. */
const STEP_OPTIONS = {
  next: {
    feature: { type: 'string' },
    epic: { type: 'string' },
    fresh: { type: 'boolean' },
    'accept-dirty': { type: 'boolean' },
    wake: { type: 'string' },
    dispatch: { type: 'string' },
    'stop-reason': { type: 'string' },
    stop: { type: 'boolean' },
  },
  branch: { feature: { type: 'string' }, epic: { type: 'string' } },
  start: {
    feature: { type: 'string' },
    epic: { type: 'string' },
    stage: { type: 'string' },
    phase: { type: 'string' },
    step: { type: 'string' },
    round: { type: 'string' },
    retry: { type: 'boolean' },
  },
  close: {
    feature: { type: 'string' },
    epic: { type: 'string' },
    discard: { type: 'boolean' },
    override: { type: 'boolean' },
    final: { type: 'boolean' },
  },
  commit: { feature: { type: 'string' }, epic: { type: 'string' }, point: { type: 'string' }, phase: { type: 'string' } },
  merge: { feature: { type: 'string' }, epic: { type: 'string' } },
  send: { feature: { type: 'string' }, epic: { type: 'string' }, reason: { type: 'string' }, mail: { type: 'boolean' } },
  reply: { id: { type: 'string' }, 'body-file': { type: 'string' } },
  note: { feature: { type: 'string' }, kind: { type: 'string' }, 'text-file': { type: 'string' } },
  detect: {},
  config: { write: { type: 'string' } },
};

/**
 * Parse the flags of one step. Throws a UsageError for an unknown flag, a
 * missing value, a positional argument, a missing `--feature`, and a
 * `--phase` that is not a whole number from 0 up. Phase 0 is a real phase:
 * a `## Phase 0` heading of tasks.md gives it.
 *
 * @param {string} step
 * @param {string[]} args
 * @returns {Record<string, any>}
 */
function parseStepArgs(step, args) {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      allowPositionals: true,
      strict: true,
      options: { ...STEP_OPTIONS[step], ...COMMON_OPTIONS },
    });
  } catch (err) {
    throw new UsageError(
      `The orca step "${step}" got an unknown flag or a missing option value.`,
      err instanceof Error ? err.message : String(err),
      'Run "beast-mode --help" to see the orca command, then run the step again.'
    );
  }
  const { values, positionals } = parsed;
  if (positionals.length > 0) {
    throw new UsageError(
      `The orca step "${step}" takes no positional argument.`,
      `"${positionals[0]}" followed "${step}" on the command line.`,
      `Run "beast-mode orca ${step}" with flags only.`
    );
  }
  if (step === 'detect' || step === 'config') return values;
  if (step === 'reply') {
    if (values.id === undefined) {
      throw new UsageError(
        'The orca step "reply" needs "--id <message-id>".',
        'No "--id" flag followed the step name.',
        'Run "beast-mode orca reply --id <message-id> --body-file <file>".'
      );
    }
    if (!MESSAGE_ID.test(values.id)) {
      throw new UsageError(
        `"--id ${values.id.slice(0, 80)}" names no message.`,
        'A message id holds 1 to 200 letters, digits, ".", "_", ":", and "-", and starts with a letter or a digit.',
        'Run "beast-mode orca reply" with the message id of the question wake.'
      );
    }
    if (!values['body-file']) {
      throw new UsageError(
        'The orca step "reply" needs "--body-file <file>".',
        'No "--body-file" flag with a file name followed the step name.',
        'Write the answer to a file, then run "beast-mode orca reply --id <message-id> --body-file <file>".'
      );
    }
    return values;
  }
  if (step === 'next' && values.feature !== undefined && values.epic !== undefined) {
    throw new UsageError(
      'The orca step "next" takes "--feature <path>" or "--epic <epic>", not both.',
      'Both flags followed the step name.',
      'Run "beast-mode orca next --feature <feature-name>", or "beast-mode orca next --epic <epic>".'
    );
  }
  if (step === 'merge' && (values.feature === undefined || values.epic === undefined)) {
    throw new UsageError(
      'The orca step "merge" needs "--epic <epic>" and "--feature <path>".',
      `No "${values.epic === undefined ? '--epic' : '--feature'}" flag followed the step name.`,
      'Run "beast-mode orca merge --epic <epic> --feature <epic>/<feature>".'
    );
  }
  // `--epic` alone names the epic run: its branch, and its epic docs tab.
  const epicOnly = values.epic !== undefined && ['next', 'branch', 'start', 'close', 'send'].includes(step);
  if (values.feature === undefined && !epicOnly) {
    throw new UsageError(
      `The orca step "${step}" needs "--feature <path>".`,
      'No "--feature" flag followed the step name.',
      `Run "beast-mode orca ${step} --feature <feature-name>".`
    );
  }
  if (step === 'send' && !values.reason) {
    throw new UsageError(
      'The orca step "send" needs "--reason <reason>".',
      'No "--reason" flag with a value followed the step name.',
      `Run "beast-mode orca send --feature <feature-name> --reason <${SEND_REASONS.join(' | ')}>".`
    );
  }
  if (step === 'note' && (!values.kind || !values['text-file'])) {
    const missing = !values.kind ? '--kind <kind>' : '--text-file <file>';
    throw new UsageError(
      `The orca step "note" needs "${missing}".`,
      `No "${missing.split(' ')[0]}" flag with a value followed the step name.`,
      `Write the message to a file, then run "beast-mode orca note --feature <feature-name> --kind <${Object.keys(NOTE_KINDS).join(' | ')}> --text-file <file>".`
    );
  }
  if (step === 'start' && values.stage === 'step' && !/^\d{1,2}$/.test(String(values.step ?? ''))) {
    throw new UsageError(
      'The orca step "start" with "--stage step" needs "--step <k>".',
      'The "--step" flag takes the index of a line of orchestration.steps, from 0 to 15.',
      'Run "beast-mode orca start --feature <feature-name> --stage step --step 0", for example.'
    );
  }
  if (values.round !== undefined && !/^[1-9]\d{0,2}$/.test(values.round)) {
    throw new UsageError(
      `"--round ${String(values.round).slice(0, 20)}" names no fix round.`,
      'The "--round" flag takes a whole number from 1 to 999.',
      'Run "beast-mode orca start --feature <feature-name> --stage fix --phase <n> --round 1", for example.'
    );
  }
  const needsPhase =
    (step === 'start' && ['phase', 'verify', 'fix'].includes(values.stage ?? 'phase')) ||
    (step === 'commit' && (values.point ?? 'phase') === 'phase');
  if (needsPhase && values.phase === undefined) {
    throw new UsageError(
      `The orca step "${step}" needs "--phase <n>".`,
      'No "--phase" flag followed the step name.',
      `Run "beast-mode orca ${step} --feature <feature-name> --phase <n>".`
    );
  }
  if (values.phase !== undefined && !/^(?:0|[1-9]\d{0,5})$/.test(values.phase)) {
    throw new UsageError(
      `"--phase ${values.phase}" names no phase.`,
      'The "--phase" flag takes a whole number from 0 up.',
      `Run "beast-mode orca ${step}" with "--phase 1", for example.`
    );
  }
  return values;
}

/**
 * Run one `beast-mode orca` step. Prints one JSON object and returns the
 * exit code: 0 for every decided outcome, 1 for an internal error (with a
 * JSON object too). Throws a UsageError for a usage error.
 *
 * @param {string[]} argv The arguments after `orca`.
 * @param {{
 *   stdout: NodeJS.WritableStream,
 *   cwd: string,
 *   pluginRoot: string,
 *   env?: Record<string, string | undefined>,
 *   runner?: Runner,
 *   sleep?: (ms: number) => void,
 *   platform?: string,
 *   execPath?: string,
 *   orcaHost?: import("./exec.js").OrcaHost,
 *   now?: () => Date,
 * }} ctx
 * @returns {number}
 */
export function runOrca(argv, ctx) {
  const [step, ...rest] = argv;
  if (!step || !STEPS.includes(step)) {
    throw new UsageError(
      step ? `"${step}" is not an orca step.` : 'No orca step given.',
      `The orca command runs one of: ${STEPS.join(', ')}.`,
      'Run "beast-mode --help" to see the orca command.'
    );
  }
  const values = parseStepArgs(step, rest);

  const projectRoot = values.project ? path.resolve(ctx.cwd, values.project) : ctx.cwd;
  let isDirectory = false;
  try {
    isDirectory = fs.statSync(projectRoot).isDirectory();
  } catch {
    isDirectory = false;
  }
  if (!isDirectory) {
    throw new UsageError(
      `The project folder "${projectRoot}" does not exist.`,
      'The "--project" flag names a folder that is not there.',
      'Run the step from the project root, or pass "--project <dir>" with an existing folder.'
    );
  }

  const pluginRoot = values['plugin-root'] ? path.resolve(ctx.cwd, values['plugin-root']) : ctx.pluginRoot;
  const env = ctx.env ?? process.env;
  const platform = ctx.platform ?? process.platform;
  const orca = resolveOrcaExecutable(env, platform);
  /** @type {StepRun} */
  const run = {
    step,
    values,
    projectRoot,
    pluginRoot,
    cwd: ctx.cwd,
    env,
    runner: ctx.runner ?? defaultRunner,
    sleep: ctx.sleep ?? sleepSync,
    platform,
    orca,
    orcaHost: ctx.orcaHost ?? resolveOrcaHost(orca, env, platform),
    cli: {
      node: ctx.execPath ?? process.execPath,
      bin: path.join(pluginRoot, 'installer', 'bin', 'beast-mode.js'),
      project: projectRoot,
    },
    now: ctx.now ?? (() => new Date()),
  };

  let output;
  let code = 0;
  try {
    output = STEP_HANDLERS[step](run);
    // The record does not hold the outcome of a start, so the run ends here: the coordinator never calls next
    // after an exit that is not 0, and the printed object keeps the dispatch for the user (CR-2).
    if (output?.ok === false && output.code === RECORD_UNWRITABLE) code = 1;
  } catch (err) {
    if (err instanceof UsageError) throw err;
    output = internalError(step, err);
    code = 1;
  }
  ctx.stdout.write(`${JSON.stringify(output)}\n`);
  return code;
}

/**
 * @param {string} step
 * @param {unknown} err
 * @returns {Record<string, any>}
 */
function internalError(step, err) {
  const message = err instanceof Error ? err.message : String(err);
  if (step === 'next') {
    return {
      schema: SCHEMA,
      action: 'stop',
      say: 'The next step failed with an internal error.',
      reason: 'internal-error',
      detail: [message],
      fix: 'Fix the error above, then run the command again.',
    };
  }
  return refusal(step, 'internal-error', `The ${step} step failed with an internal error.`, [message]);
}

/**
 * @param {string} step
 * @param {string} say
 * @param {Record<string, unknown>} [extra]
 * @returns {Record<string, any>}
 */
function success(step, say, extra = {}) {
  return { schema: SCHEMA, step, ok: true, say, ...extra };
}

/**
 * @param {string} step
 * @param {string} code
 * @param {string} say
 * @param {string[]} [detail]
 * @param {Record<string, unknown>} [extra]
 * @returns {Record<string, any>}
 */
function refusal(step, code, say, detail = [], extra = {}) {
  return { schema: SCHEMA, step, ok: false, code, say, detail, ...extra };
}

/** The refusal code of a record write that failed after an Orca start call (CR-2). */
export const RECORD_UNWRITABLE = 'record-unwritable';

/**
 * The refusal of a run record that exists and cannot be read or does not
 * parse (CR-1). The record names the active dispatch, so a step never reads
 * it as absent.
 *
 * @param {string} step
 * @param {string} run The feature path, or the epic.
 * @param {string} note The note of the record read.
 * @param {Record<string, unknown>} [extra]
 * @returns {Record<string, any>}
 */
function recordUnreadable(step, run, note, extra = {}) {
  return refusal(step, RECORD_UNREADABLE, `The run record of ${run} cannot be read, so the step cannot tell which tab is open.`, [
    note,
    'Check Orca for an open tab of this run, then move the file away and run the command again. For a file that cannot be read, fix its permission instead.',
  ], extra);
}

/**
 * The refusal of a record write that failed after an Orca start call
 * (CR-2). The start changed the state of Orca, so the step never throws
 * there: the result names the dispatch, the Task, and the agent. The record
 * keeps the start entry that the step wrote before the call, so `next` asks
 * `start-unknown` and opens no second tab on its own.
 *
 * @param {string} step
 * @param {unknown} err The error of the write.
 * @param {{ started: boolean, dispatchId: string | null, taskId: string | null, agent: string, detail?: string[],
 *   extra?: Record<string, unknown> }} what `started`: Orca answered a dispatch.
 * @returns {Record<string, any>}
 */
function recordUnwritable(step, err, { started, dispatchId, taskId, agent, detail = [], extra = {} }) {
  const cause = `The write failed: ${err instanceof Error ? err.message : String(err)}`;
  // The launch fields of the command path can hold detail lines too. They join the lines, never replace them.
  const { detail: launchDetail, ...fields } = extra;
  const lines = started
    ? ['The tab started, but the run record cannot be written. Fix the cause, then close the tab in Orca before you run again.', cause]
    : ['The start did not answer a dispatch, and the run record cannot be written. Fix the cause, then check Orca for a tab of this start before you run again.', cause, ...detail];
  if (Array.isArray(launchDetail)) lines.push(...launchDetail.filter((line) => typeof line === 'string' && !lines.includes(line)));
  return refusal(
    step,
    RECORD_UNWRITABLE,
    started ? `The tab started on ${agent}, but the run record cannot be written.` : 'The start failed, and the run record cannot be written.',
    lines.slice(0, MAX_OUTPUT_LINES),
    { ...fields, agent, dispatchId, taskId }
  );
}

// ---------------------------------------------------------------------------
// The facts that `next` reads
// ---------------------------------------------------------------------------

/**
 * @param {string} projectRoot
 * @returns {string[]} The installed harness ids: the marker entries plus every harness with a manifest.
 */
function installedHarnesses(projectRoot) {
  const { marker: current } = marker.read(projectRoot);
  return marker.resolve({ projectRoot, marker: current, adapters }).map((harness) => harness.id);
}

/**
 * @param {StepRun} run
 * @returns {string | null}
 */
function readDefaultBranch(run) {
  const origin = gitCall(run, gitCalls.originHead());
  if (origin.ok) {
    const name = origin.stdout.trim();
    if (name.startsWith('origin/') && name.length > 'origin/'.length) return name.slice('origin/'.length);
  }
  for (const name of ['main', 'master']) {
    if (gitCall(run, gitCalls.verifyBranch(name)).ok) return name;
  }
  return null;
}

/**
 * Read the git facts of a feature run. Reads only.
 *
 * @param {StepRun} run
 * @param {string | null} runBranch
 * @returns {import('./decide.js').GitFacts}
 */
function readGitFacts(run, runBranch) {
  /** @type {import('./decide.js').GitFacts} */
  const facts = {
    workTree: false,
    detail: [],
    error: null,
    head: null,
    defaultBranch: null,
    runBranch,
    runBranchExists: false,
    base: null,
    dirty: [],
    subjects: [],
  };

  const inside = gitCall(run, gitCalls.insideWorkTree());
  if (!inside.ok || inside.stdout.trim() !== 'true') {
    facts.detail = [
      `${run.projectRoot} is not inside a git work tree.`,
      ...(inside.ok ? [`git rev-parse --is-inside-work-tree printed "${inside.stdout.trim()}".`] : inside.detail),
    ];
    return facts;
  }
  facts.workTree = true;

  const head = gitCall(run, gitCalls.head());
  facts.head = head.ok ? head.stdout.trim() || null : null;
  facts.defaultBranch = readDefaultBranch(run);

  if (runBranch) {
    facts.runBranchExists = gitCall(run, gitCalls.verifyBranch(runBranch)).ok;
    const base = gitCall(run, gitCalls.baseKey(runBranch));
    facts.base = base.ok ? base.stdout.trim() || null : null;
  }

  const status = gitCall(run, gitCalls.status());
  if (!status.ok) {
    facts.error = status.detail;
    return facts;
  }
  facts.dirty = parsePorcelain(status.stdout);

  if (runBranch && facts.head === runBranch) {
    const base = facts.base ?? facts.defaultBranch;
    let log = base ? gitCall(run, gitCalls.logSince(base)) : null;
    if (!log || !log.ok) {
      // The base is gone. The whole history of HEAD stands in for it.
      log = gitCall(run, gitCalls.logAll());
      if (!log.ok) {
        facts.error = log.detail;
        return facts;
      }
    }
    facts.subjects = log.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }
  return facts;
}

/**
 * Rule F9 reads `status --json`: the app runs and its runtime answers.
 *
 * @param {StepRun} run
 * @returns {{ running: boolean, detail: string[] }}
 */
function readOrcaStatus(run) {
  const answer = orcaCall(run, orcaCalls.status());
  if (answer.kind !== 'ok') return { running: false, detail: answer.detail };
  const result = isPlainObject(answer.result) ? answer.result : {};
  const app = isPlainObject(result.app) ? result.app : {};
  const runtime = isPlainObject(result.runtime) ? result.runtime : {};
  if (app.running === true && runtime.reachable === true) return { running: true, detail: [] };
  return {
    running: false,
    detail: [
      `${run.orca} status: app.running is ${String(app.running)}, runtime.reachable is ` +
        `${String(runtime.reachable)}, runtime.state is ${String(runtime.state)}.`,
    ],
  };
}

/**
 * @param {StepRun} run
 * @returns {import('./decide.js').FeatureFacts}
 */
function gatherFeatureFacts(run) {
  const { values, projectRoot, env } = run;
  const checked = checkFeaturePath(values.feature);
  const handle = env.ORCA_TERMINAL_HANDLE;
  return {
    feature: checked.ok ? checked.path : String(values.feature),
    flags: {
      fresh: values.fresh === true,
      wake: typeof values.wake === 'string' && values.wake ? values.wake : null,
      dispatch: typeof values.dispatch === 'string' && values.dispatch ? values.dispatch : null,
      stopReason: typeof values['stop-reason'] === 'string' && values['stop-reason'] ? values['stop-reason'] : null,
      stop: values.stop === true,
      acceptDirty: values['accept-dirty'] === true,
    },
    terminalHandle: typeof handle === 'string' && handle.length > 0 ? handle : null,
    config: readOrcaConfig(projectRoot),
    harnesses: installedHarnesses(projectRoot),
    git: readGitFacts(run, checked.ok ? runBranchOf(checked.path) : null),
    docs: readFeatureDocs(projectRoot, checked),
    record: checked.ok ? readRecord(projectRoot, checked.path) : { record: null, note: null },
    orcaStatus: null,
    worker: null,
  };
}

// ---------------------------------------------------------------------------
// The steps
// ---------------------------------------------------------------------------

/**
 * `next`: read the facts, decide, and print one action. Writes nothing.
 * The Orca reads run only after the checks that need no Orca call pass.
 *
 * @param {StepRun} run
 * @returns {Record<string, any>}
 */
function stepNext(run) {
  const facts = gatherFeatureFacts(run);
  if (setupStop(facts) === null) {
    if (facts.flags.fresh) facts.orcaStatus = readOrcaStatus(run);
    const active = facts.record.record?.active;
    if (active) {
      facts.flags.mailWakes = readLostWakes(run, facts.flags, [active]);
      facts.worker = readWorker(run, facts.flags, facts.config, active, run.projectRoot);
    }
  }
  return renderAction(decideFeature(facts), run.cli);
}

/**
 * Read the worker of an active tab with `worker-show`. An idle dsh tab that
 * rule A4 judges (an escalation wake for it, or a fresh call) also gets the
 * child-activity fact of dsh.js (fix 2): the session folders of its
 * workspace in the dsh home. No other tab reads a file.
 *
 * @param {StepRun} run
 * @param {import('./decide.js').FeatureFacts['flags']} flags
 * @param {import('./read.js').OrcaConfigRead} config
 * @param {Record<string, any>} active
 * @param {string} root The workspace of the run: the project, or the worktree of a lane.
 * @returns {import('./decide.js').WorkerFact}
 */
function readWorker(run, flags, config, active, root) {
  const answer = orcaCall(run, orcaCalls.workerShow(active.dispatchId));
  /** @type {import('./decide.js').WorkerFact} */
  let worker = normalizeWorker(answer);
  // Fix 8: a busy tab names how long it has been quiet, so a turn that ended with no Stop hook is found.
  const quietMs = worker.state === 'busy' ? turnQuietMs(answer, run.now()) : null;
  if (quietMs !== null) worker = { ...worker, quietMs };
  if (wantsDshChild(flags, active, worker)) {
    const workspace = showWorkspace(answer) ?? (typeof active.worktree === 'string' && active.worktree ? active.worktree : root);
    worker = { ...worker, child: dshChildFact({ config, env: run.env, platform: run.platform, now: run.now(), active, workspace }) };
  }
  if (wantsPendingMail(flags, active, worker)) worker = { ...worker, mail: readPendingMail(run, active) };
  if (wantsOpenQuestions(flags, active, worker)) {
    const questions = readOpenQuestions(run, active);
    if (questions.questions.length > 0) worker = { ...worker, questions };
  }
  return worker;
}

/**
 * The wakes that Orca never delivered to the coordinator (fix 7), read on a
 * timer wake or a fresh call only: the mailbox of each Run of the active
 * tabs, with the no-mark `inbox --full`, for messages about those tabs older
 * than COORDINATOR_MAIL_MS. A failed read is no wake.
 *
 * @param {StepRun} run
 * @param {import('./decide.js').FeatureFacts['flags']} flags
 * @param {Record<string, any>[]} actives
 * @returns {import('./exec.js').MailWake[]}
 */
function readLostWakes(run, flags, actives) {
  if (flags.stop === true || (flags.fresh !== true && flags.wake !== TIMER_WAKE)) return [];
  const dispatchIds = actives.map((active) => active.dispatchId).filter((id) => typeof id === 'string' && id);
  const runIds = [...new Set(actives.map((active) => active.runId).filter((id) => typeof id === 'string' && id))];
  /** @type {import('./exec.js').MailWake[]} */
  const wakes = [];
  for (const runId of runIds) {
    try {
      const answer = orcaCall(run, orcaCalls.runInbox(runId));
      wakes.push(...undeliveredWakes(answer, { runId, dispatchIds, now: run.now(), minAgeMs: COORDINATOR_MAIL_MS }));
    } catch {
      // No wake.
    }
  }
  return wakes;
}

/**
 * The open questions of one tab (fix 9): the `question` messages of
 * `dispatch:<id>` in the mail of the run (`runMail`, not the `runInbox`
 * read of fix 7, which lists no answer) that no `reply` answers yet.
 * `inbox` marks nothing read, so the coordinator still gets its wake. A
 * failed read is no question.
 *
 * @param {StepRun} run
 * @param {Record<string, any>} active
 * @returns {import('./exec.js').OpenQuestions}
 */
function readOpenQuestions(run, active) {
  try {
    return openQuestions(orcaCall(run, orcaCalls.runMail(active.runId)), { dispatchId: active.dispatchId });
  } catch {
    return { questions: [], detail: [] };
  }
}

/**
 * The undelivered mail of one tab (fix 7): messages to `dispatch:<id>` that
 * Orca has not delivered after UNDELIVERED_MAIL_MS, less the messages that
 * an earlier send already named (`mailNamed` of the record), so one stuck
 * message gets one send. `inbox` marks nothing read. A failed read is no
 * mail.
 *
 * @param {StepRun} run
 * @param {Record<string, any>} active
 * @returns {import('./exec.js').UndeliveredMail}
 */
function readPendingMail(run, active) {
  try {
    const answer = orcaCall(run, orcaCalls.inbox(active.dispatchId));
    const exclude = Array.isArray(active.mailNamed) ? active.mailNamed.filter((id) => typeof id === 'string') : [];
    return undeliveredMail(answer, { dispatchId: active.dispatchId, now: run.now(), minAgeMs: UNDELIVERED_MAIL_MS, exclude });
  } catch {
    return { messages: [], detail: [] };
  }
}

/**
 * @param {StepRun} run
 * @param {string} step
 * @returns {{ ok: true, path: string, segments: string[], lane: string | null } | { ok: false, refusal: Record<string, any> }}
 *   `lane` is the epic of a lane of `/orca-epic`: the step got `--epic <epic>` with `--feature <epic>/<feature>`.
 */
function featureOf(run, step) {
  const checked = checkFeaturePath(run.values.feature);
  if (!checked.ok) {
    return { ok: false, refusal: refusal(step, 'feature-missing', 'The feature reference is not valid.', [checked.reason]) };
  }
  if (run.values.epic === undefined) return { ...checked, lane: null };
  const epic = checkEpicName(run.values.epic);
  if (!epic.ok || checked.segments.length !== 2 || checked.segments[0] !== epic.name) {
    return {
      ok: false,
      refusal: refusal(step, 'not-in-epic', `The feature ${checked.path} is not a feature of the epic named by "--epic".`, [
        epic.ok ? `A lane of the epic ${epic.name} is ${epic.name}/<feature>.` : epic.reason,
      ]),
    };
  }
  return { ...checked, lane: epic.name };
}

/**
 * @param {string} step
 * @param {import('./read.js').OrcaConfigRead} config
 * @returns {Record<string, any> | null}
 */
function configRefusal(step, config) {
  if (config.state === 'missing') {
    return refusal(step, 'config-missing', 'The project has no Orca settings.', ['.beast-mode/orca.json does not exist.']);
  }
  if (config.state === 'invalid') {
    return refusal(
      step,
      'config-invalid',
      '.beast-mode/orca.json fails the schema.',
      config.problems.map((problem) => `${problem.code} at ${problem.at}`)
    );
  }
  if (!config.orchestration) {
    return refusal(step, 'orchestration-missing', 'The Orca settings hold no orchestration object.', [
      '.beast-mode/orca.json holds no "orchestration" key.',
    ]);
  }
  return null;
}

/**
 * Record a git write that failed, so the next call of this run stops
 * instead of repeating it. A record write that fails adds one detail line.
 *
 * @param {StepRun} run
 * @param {string} feature
 * @param {{ step: string, phase: number | null, point?: string | null, code: string, say: string, detail: string[] }} failure
 * @returns {Record<string, any>}
 */
function gitWriteFailed(run, feature, { step, phase, point = null, code, say, detail }) {
  const lines = [...detail];
  try {
    const { record, note } = readRecord(run.projectRoot, feature);
    // A record that cannot be read keeps its bytes: a new record in its place would lose the active dispatch (CR-1).
    if (note) {
      lines.push(note);
      return refusal(step, code, say, lines);
    }
    writeRecord(run.projectRoot, feature, {
      ...(record ?? newRecord(feature)),
      failedGit: { step, phase, point, code, at: run.now().toISOString(), detail },
    });
  } catch (err) {
    lines.push(`The run record cannot be written: ${err instanceof Error ? err.message : String(err)}`);
  }
  return refusal(step, code, say, lines);
}

/**
 * Clear a recorded git failure of one step after that step works.
 *
 * @param {StepRun} run
 * @param {string} feature
 * @param {string} step
 * @returns {void}
 */
function clearGitFailure(run, feature, step) {
  const { record } = readRecord(run.projectRoot, feature);
  if (record?.failedGit?.step !== step) return;
  writeRecord(run.projectRoot, feature, { ...record, failedGit: null });
}

/**
 * `branch`: switch to the run branch, or create it from the default
 * branch, and set its base key. A dirty tree refuses.
 *
 * @param {StepRun} run
 * @returns {Record<string, any>}
 */
function stepBranch(run) {
  const step = 'branch';
  const checked = featureOf(run, step);
  if (!checked.ok) return checked.refusal;
  const feature = checked.path;
  const branch = runBranchOf(feature);

  const facts = readGitFacts(run, branch);
  if (!facts.workTree) return refusal(step, 'not-git', 'The project is not a git work tree.', facts.detail);
  if (facts.error) return refusal(step, 'git-failed', 'A git read failed.', facts.error);
  if (!facts.defaultBranch) {
    return refusal(step, 'no-default-branch', 'The project has no default branch.', [
      'origin/HEAD names no branch, and no main or master branch exists.',
    ]);
  }
  if (facts.head === branch) {
    clearGitFailure(run, feature, step);
    return success(step, `The work tree is already on ${branch}.`, {
      feature,
      branch,
      base: facts.base ?? facts.defaultBranch,
      created: false,
    });
  }
  if (facts.dirty.length > 0) {
    return refusal(step, 'dirty-tree', `The work tree has changes, so the run cannot switch to ${branch}.`, facts.dirty.slice(0, 20));
  }

  const created = !facts.runBranchExists;
  const base = created ? facts.defaultBranch : (facts.base ?? facts.defaultBranch);
  const switched = gitCall(run, created ? gitCalls.switchCreate(branch, /** @type {string} */ (base)) : gitCalls.switchTo(branch));
  if (!switched.ok) {
    return gitWriteFailed(run, feature, {
      step,
      phase: null,
      code: 'git-failed',
      say: `The switch to ${branch} failed.`,
      detail: switched.detail,
    });
  }

  /** @type {string[]} */
  const notes = [];
  if (!facts.base) {
    const configured = gitCall(run, gitCalls.setBase(branch, /** @type {string} */ (base)));
    if (!configured.ok) notes.push(...configured.detail);
  }
  clearGitFailure(run, feature, step);
  const say = created ? `Created the branch ${branch} from ${base}.` : `Switched to the branch ${branch}.`;
  return success(step, notes.length > 0 ? `${say} The base key was not set.` : say, {
    feature,
    branch,
    base,
    created,
    ...(notes.length > 0 ? { detail: notes } : {}),
  });
}

/** The longest list of residual resources that a failed start keeps. */
const MAX_RESIDUAL = 20;

/**
 * @param {unknown} resource
 * @returns {string} One residual resource of a receipt as one line: a string as it is, an object as JSON.
 */
function resourceText(resource) {
  const line = typeof resource === 'string' ? resource : JSON.stringify(resource);
  return line.length > MAX_LINE_LENGTH ? `${line.slice(0, MAX_LINE_LENGTH)}...` : line;
}

/**
 * The detail lines and the record entry of a start that did not answer a
 * dispatch: an exit-1 receipt (fact O1), a failed spawn, or a bad answer.
 * The receipt gives `failedStage`, `lastError`, the Task, the dispatch,
 * `residualResources`, and the recovery commands. `count` counts the failed
 * starts of one `--retry-of` chain, so a retry adds one to the entry before
 * it. A retry that Orca refused before it made a dispatch keeps the Task
 * and the dispatch of the entry before it. A refusal of Orca with a failure
 * count of three or more marks the broken circuit.
 *
 * @param {OrcaAnswer} answer
 * @param {Record<string, any> | null} [previous] The failed start that this start retried.
 * @returns {Record<string, any>}
 */
function failedStartOf(answer, previous = null) {
  const result = isPlainObject(answer.result) ? answer.result : {};
  const list = (value) => (Array.isArray(value) ? value.filter((item) => typeof item === 'string') : []);
  const residual = Array.isArray(result.residualResources)
    ? result.residualResources.filter((item) => typeof item === 'string' || isPlainObject(item)).slice(0, MAX_RESIDUAL)
    : [];
  const data = answer.kind === 'failed' && isPlainObject(answer.data) ? answer.data : {};
  const failures = Number.isInteger(data.failureCount) ? data.failureCount : null;
  const count = (Number.isInteger(previous?.count) ? previous.count : previous ? 1 : 0) + 1;
  const entry = {
    code: answer.kind === 'ok' ? 'orca-bad-answer' : answer.code,
    failedStage: textOf(result.failedStage),
    lastError: textOf(result.lastError),
    taskId: textOf(result.taskId) ?? textOf(previous?.taskId),
    dispatchId: textOf(result.dispatchId) ?? textOf(previous?.dispatchId),
    residualResources: residual,
    nextCommands: list(result.nextCommands),
    recovery: textOf(result.recovery) ?? textOf(result.next),
    count,
    circuit: answer.kind === 'failed' && answer.code === 'task_not_startable' && failures !== null && failures >= START_FAILURE_CAP,
    // A process timeout is no failure: Orca can have made the Task and the tab, so the outcome is unknown (CR-3).
    ...(answer.kind === 'spawn-error' && answer.code === 'timeout' ? { unknown: true } : {}),
  };
  const detail = answer.kind === 'ok' ? ['worker-start answered no dispatch id.'] : [...answer.detail];
  if (entry.unknown) detail.push('The start ran past its time limit, so Orca can have opened the tab.');
  if (entry.failedStage) detail.push(`Failed stage: ${entry.failedStage}.`);
  if (entry.lastError) detail.push(`Last error: ${entry.lastError}`);
  for (const resource of residual) detail.push(`Left open: ${resourceText(resource)}`);
  if (entry.recovery) detail.push(`Orca: ${entry.recovery}`);
  for (const command of entry.nextCommands) detail.push(`Orca names: ${command}`);
  if (count > 1) detail.push(`Failed starts of this Task: ${count} of ${START_FAILURE_CAP}.`);
  return { ...entry, detail: detail.slice(0, MAX_OUTPUT_LINES) };
}

/**
 * The start entry that a start writes to the record before its first Orca
 * call (CR-2). The record write after the answer of Orca replaces it. When
 * that write fails, or the step ends before it, the record keeps a start
 * whose outcome is unknown: `next` asks `start-unknown`, and a plain start
 * refuses `start-failed`, so no run opens a second tab on its own. A write
 * of the entry that fails throws before any Orca call, so the step exits 1
 * and the run ends with no state change.
 *
 * @param {Record<string, any>} where The stage fields: `stage`, `phase`, `agent`, `at`, and `step` or `round`.
 * @param {Record<string, any> | null} previous The failed start that a retry names, else null.
 * @returns {Record<string, any>}
 */
function pendingStart(where, previous) {
  /** @type {OrcaAnswer} */
  const answer = {
    kind: 'spawn-error',
    code: 'start-unrecorded',
    result: null,
    detail: ['The start step ended before it recorded the answer of Orca, so a tab can be open.'],
  };
  return { ...where, ...failedStartOf(answer, previous), unknown: true };
}

/**
 * @param {import('./read.js').FeatureDocs} docs
 * @returns {'missing' | 'error' | 'open' | 'closed'} The state of code-review.md.
 */
function reviewFileState(docs) {
  if (!docs.has.codeReview) return 'missing';
  if (!docs.review) return 'error';
  return docs.review.open.length > 0 ? 'open' : 'closed';
}

/**
 * @param {import('./read.js').FeatureDocs} docs
 * @returns {boolean} tasks.md holds a phase, and every phase is complete.
 */
function allPhasesComplete(docs) {
  const phases = docs.tasks?.phases ?? [];
  return phases.length > 0 && phases.every((entry) => isPhaseComplete(entry));
}

/**
 * The refusal of a review point (the review and review-fix tabs, and the
 * review commit) when the review is not split, or a phase is open.
 *
 * @param {string} step
 * @param {string} feature
 * @param {import('./read.js').FeatureDocs} docs
 * @param {{ implement: string, review: string | false }} stages
 * @returns {Record<string, any> | null}
 */
function splitReviewRefusal(step, feature, docs, stages) {
  const placement = reviewPlacement(stages);
  if (placement === 'off') {
    return refusal(step, 'review-off', `The review of ${feature} is off.`, ['orchestration.stages.review is false.']);
  }
  if (placement === 'tab') {
    return refusal(step, 'review-in-phase', `The review of ${feature} runs in the last phase tab.`, [
      `stages.review equals stages.implement ("${stages.implement}").`,
    ]);
  }
  if (!allPhasesComplete(docs)) {
    return refusal(step, 'phase-incomplete', `A phase of ${feature} is not complete.`, [
      `docs/features/${feature}/tasks.md holds an open phase, or no phase.`,
    ]);
  }
  return null;
}

/**
 * The guard, the agent, and the spec of one stage start. Each stage checks
 * its own guard here, so a stale run line never starts the wrong tab.
 *
 * @param {string} step
 * @param {string} stage
 * @param {{ feature: string, docs: import('./read.js').FeatureDocs, orchestration: import('./read.js').Orchestration, record: Record<string, any> | null, phaseNumber: number, stepIndex?: number, lane?: boolean, round?: number, retry?: boolean }} ctx
 *   `lane`: a lane of `/orca-epic`. Its phase spec writes no human-testing.md, and its docs spec runs `/update-feature` only.
 *   `round`: the `--round` of a fix start. `retry`: the start retries a failed start, so a fix keeps its round and needs no verdict.
 * @returns {{ refusal: Record<string, any> } | { refusal: null, agent: string, phase: number | null, review: boolean, specName: string, spec: string, label: string, stepInfo?: { index: number, point: string, command: string, verdictRel: string }, verifyInfo?: { verdictRel: string, verifies: boolean, round: number } }}
 */
function stagePlan(step, stage, { feature, docs, orchestration, record, phaseNumber, stepIndex = NaN, lane = false, round = NaN, retry = false }) {
  const { stages } = orchestration;
  const dir = `docs/features/${feature}`;
  const epic = docs.epic;
  const phases = docs.tasks?.phases ?? [];
  const refuse = (code, say, detail) => ({ refusal: refusal(step, code, say, detail) });

  if (stage === 'plan') {
    if (!docs.has.requirements && !docs.has.implementation) {
      return refuse('no-plan-input', `The feature ${feature} has no requirements.md and no implementation.md.`, [
        `${dir}/ holds neither requirements.md nor implementation.md.`,
      ]);
    }
    if (docs.has.implementation && docs.has.tasks && phases.length > 0) {
      return refuse('plan-complete', `The plan of ${feature} is already written.`, [
        `${dir}/implementation.md and ${dir}/tasks.md exist, and tasks.md holds a phase.`,
      ]);
    }
    const form = docs.has.implementation ? 'start' : 'full';
    return {
      refusal: null,
      agent: stages.plan,
      phase: null,
      review: false,
      specName: 'orca-plan.md',
      spec: planSpec({ feature, epic, form }),
      label: 'the plan tab',
    };
  }

  if (stage === 'phase') {
    const index = phases.findIndex((entry) => entry.number === phaseNumber);
    const phase = phases[index];
    if (!phase) {
      return refuse('phase-missing', `The task list of ${feature} holds no Phase ${phaseNumber}.`, [
        `${dir}/tasks.md holds no "## Phase ${phaseNumber}" section.`,
      ]);
    }
    // With the review in the tab, the last phase runs again until the review closes.
    const reviewHere = reviewPlacement(stages) === 'tab' && index === phases.length - 1;
    if (isPhaseComplete(phase) && !(reviewHere && reviewFileState(docs) !== 'closed')) {
      return refuse('phase-complete', `Phase ${phaseNumber} of ${feature} is already complete.`, [
        `Every task line of Phase ${phaseNumber} in tasks.md reads [x].`,
      ]);
    }
    return {
      refusal: null,
      agent: stages.implement,
      phase: phaseNumber,
      review: reviewHere,
      specName: `orca-phase-${phaseNumber}.md`,
      // Verify equal to implement: the tab writes the verdict. Else the tab writes the brief and a verify tab runs it.
      spec: phaseSpec({
        feature,
        epic,
        phase,
        review: reviewHere,
        lane,
        ...(stages.verify === stages.implement
          ? { verdictFile: `.beast-mode/briefs/${feature}/${phaseVerdictName(phaseNumber)}` }
          : { briefFile: `.beast-mode/briefs/${feature}/${verifyBriefName(phaseNumber)}` }),
      }),
      label: `the Phase ${phaseNumber} tab`,
    };
  }

  if (stage === 'verify' || stage === 'fix') {
    // Rule F16: a complete phase with no PASS. A split verify runs in its own tab, and a fix goes to the implement agent.
    const phase = phases.find((entry) => entry.number === phaseNumber);
    if (!phase) {
      return refuse('phase-missing', `The task list of ${feature} holds no Phase ${phaseNumber}.`, [
        `${dir}/tasks.md holds no "## Phase ${phaseNumber}" section.`,
      ]);
    }
    if (!isPhaseComplete(phase)) {
      return refuse('phase-incomplete', `Phase ${phaseNumber} of ${feature} is not complete.`, [
        `Phase ${phaseNumber} in tasks.md holds an open task.`,
      ]);
    }
    const split = stages.verify !== stages.implement;
    const verdictRel = `.beast-mode/briefs/${feature}/${phaseVerdictName(phaseNumber)}`;
    const fact = docs.phaseVerdicts?.[String(phaseNumber)] ?? null;
    const prior = Number.isInteger(record?.verify?.[String(phaseNumber)]?.round) ? record.verify[String(phaseNumber)].round : 0;
    if (stage === 'verify') {
      if (!split) {
        return refuse('verify-same-agent', `The verify stage of ${feature} runs in the phase tab.`, [
          `stages.verify equals stages.implement ("${stages.implement}"), so no verify tab opens.`,
        ]);
      }
      return {
        refusal: null,
        agent: stages.verify,
        phase: phaseNumber,
        review: false,
        specName: verifySpecName(phaseNumber),
        spec: verifySpec({ feature, epic, phase, verdictFile: verdictRel, briefFile: `.beast-mode/briefs/${feature}/${verifyBriefName(phaseNumber)}` }),
        label: `the verify tab of Phase ${phaseNumber}`,
        verifyInfo: { verdictRel, verifies: false, round: prior },
      };
    }
    if (fact?.verdict === 'PASS') {
      return refuse('verify-passed', `Phase ${phaseNumber} of ${feature} already has a PASS verdict.`, [`${verdictRel} reads PASS.`]);
    }
    // A fix needs a verdict to fix. A phase that its own tab verifies also fixes after a fix that left no verdict.
    if (!retry && (split || prior === 0) && !fact?.verdict) {
      return refuse('verdict-missing', `Phase ${phaseNumber} of ${feature} has no verdict to fix.`, [
        `${verdictRel} does not exist, or its line 1 is not PASS, FAIL, or BLOCKED.`,
      ]);
    }
    const fixRound = Number.isInteger(round) && round > 0 ? round : prior + 1;
    return {
      refusal: null,
      agent: stages.implement,
      phase: phaseNumber,
      review: false,
      specName: fixSpecName(phaseNumber, fixRound),
      spec: fixSpec({ feature, epic, phase, round: fixRound, evidence: fact?.evidence ?? '', verdictFile: verdictRel, verifies: !split }),
      label: `the fix tab of Phase ${phaseNumber}`,
      verifyInfo: { verdictRel, verifies: !split, round: fixRound },
    };
  }

  if (stage === 'review' || stage === 'review-fix') {
    const refused = splitReviewRefusal(step, feature, docs, stages);
    if (refused) return { refusal: refused };
    const state = reviewFileState(docs);
    if (stage === 'review') {
      if (state !== 'missing') {
        return refuse('review-written', `The review of ${feature} is already written.`, [`${dir}/code-review.md exists.`]);
      }
      return {
        refusal: null,
        agent: /** @type {string} */ (stages.review),
        phase: null,
        review: false,
        specName: 'orca-review.md',
        spec: reviewSpec({ feature, epic }),
        label: 'the review tab',
      };
    }
    if (state === 'missing') {
      return refuse('review-missing', `The review of ${feature} is not written.`, [`${dir}/code-review.md does not exist.`]);
    }
    if (state === 'error') {
      return refuse('review-unreadable', `The code review of ${feature} cannot be read.`, [
        `${dir}/code-review.md cannot be read: ${docs.reviewError ?? 'unknown error'}`,
      ]);
    }
    if (state === 'closed') {
      return refuse('review-closed', `The review of ${feature} holds no open finding.`, [
        `${dir}/code-review.md holds no open CR line.`,
      ]);
    }
    return {
      refusal: null,
      agent: stages.implement,
      phase: null,
      review: false,
      specName: 'orca-review-fix.md',
      spec: reviewFixSpec({ feature, epic }),
      label: 'the review-fix tab',
    };
  }

  if (stage === 'inbox') {
    // Rule F20: after every phase and the review, before the docs.
    if (!allPhasesComplete(docs)) {
      return refuse('phase-incomplete', `A phase of ${feature} is not complete.`, [
        `${dir}/tasks.md holds an open phase, or no phase.`,
      ]);
    }
    if (reviewPlacement(stages) !== 'off' && reviewFileState(docs) !== 'closed') {
      return refuse('review-open', `The review of ${feature} is not closed.`, [
        `${dir}/code-review.md does not exist, cannot be read, or holds an open finding.`,
      ]);
    }
    if (record?.largeChange) {
      return refuse('large-change', `A large change of ${feature} waits for /plan-feature.`, [
        'The run record holds a large change that closed with a new requirements.md.',
      ]);
    }
    if ((docs.inboxActionable ?? []).length === 0) {
      return refuse('inbox-empty', `The inbox of ${feature} holds no open bug or change line.`, [
        `${dir}/inbox.md holds no open "bug" or "change" line.`,
      ]);
    }
    return {
      refusal: null,
      agent: stages.implement,
      phase: null,
      review: false,
      specName: 'orca-inbox.md',
      spec: inboxSpec({ feature, epic }),
      label: 'the inbox tab',
    };
  }

  if (stage === 'step') {
    // Decision 17: a custom step. Phase steps follow their phase, feature steps follow the review.
    const line = Array.isArray(orchestration.steps) ? orchestration.steps[stepIndex] : undefined;
    if (!isPlainObject(line)) {
      return refuse('step-missing', `orchestration.steps holds no line ${stepIndex}.`, [
        `.beast-mode/orca.json holds ${Array.isArray(orchestration.steps) ? orchestration.steps.length : 0} step lines.`,
      ]);
    }
    if (line.after === 'epic') {
      return refuse('step-after-epic', `The step ${stepIndex} runs after the epic, so it runs in /orca-epic only.`, [
        'A step with "after": "epic" never runs for one feature.',
      ]);
    }
    let point = 'feature';
    let phaseOut = null;
    if (line.after === 'phase') {
      const phase = phases.find((entry) => entry.number === phaseNumber);
      if (!phase) {
        return refuse('phase-missing', `The task list of ${feature} holds no Phase ${phaseNumber}.`, [
          `${dir}/tasks.md holds no "## Phase ${phaseNumber}" section.`,
        ]);
      }
      if (!isPhaseComplete(phase)) {
        return refuse('phase-incomplete', `Phase ${phaseNumber} of ${feature} is not complete.`, [
          `Phase ${phaseNumber} in tasks.md holds an open task.`,
        ]);
      }
      point = stepPoint('phase', phaseNumber);
      phaseOut = phaseNumber;
    } else {
      if (!allPhasesComplete(docs)) {
        return refuse('phase-incomplete', `A phase of ${feature} is not complete.`, [
          `${dir}/tasks.md holds an open phase, or no phase.`,
        ]);
      }
      if (reviewPlacement(stages) !== 'off' && reviewFileState(docs) !== 'closed') {
        return refuse('review-open', `The review of ${feature} is not closed.`, [
          `${dir}/code-review.md does not exist, cannot be read, or holds an open finding.`,
        ]);
      }
      if (record?.done?.docs === true) {
        return refuse('docs-done', `The docs of ${feature} are already done.`, ['The run record marks the docs tab done.']);
      }
    }
    if (record?.done?.steps?.[stepKey(point, stepIndex)]) {
      return refuse('step-done', `The step ${stepIndex} of ${feature} already ran at this point.`, [
        `The run record marks ${stepKey(point, stepIndex)} done.`,
      ]);
    }
    const command = fillStepTokens(line.command, { feature, phase: phaseOut, epic: null });
    const verdictRel = `.beast-mode/briefs/${feature}/${stepVerdictName(point, stepIndex)}`;
    return {
      refusal: null,
      agent: line.agent,
      phase: phaseOut,
      review: false,
      specName: stepSpecName(point, stepIndex),
      spec: stepSpec({ target: feature, epic, point, command, verdictFile: verdictRel }),
      label: 'the step tab',
      stepInfo: { index: stepIndex, point, command, verdictRel },
    };
  }

  // The docs stage: the last stage of the run.
  if (!allPhasesComplete(docs)) {
    return refuse('phase-incomplete', `A phase of ${feature} is not complete.`, [
      `${dir}/tasks.md holds an open phase, or no phase.`,
    ]);
  }
  if (reviewPlacement(stages) !== 'off' && reviewFileState(docs) !== 'closed') {
    return refuse('review-open', `The review of ${feature} is not closed.`, [
      `${dir}/code-review.md does not exist, cannot be read, or holds an open finding.`,
    ]);
  }
  if (record?.done?.docs === true) {
    return refuse('docs-done', `The docs of ${feature} are already done.`, ['The run record marks the docs tab done.']);
  }
  return {
    refusal: null,
    agent: stages.docs,
    phase: null,
    review: false,
    specName: 'orca-docs.md',
    spec: docsSpec({ feature, epic, lane }),
    label: 'the docs tab',
  };
}

/**
 * @param {StepRun} run
 * @param {string} stage
 * @returns {number | null} The `--phase` of a phase start, or of a step start that names one.
 */
function phaseOfStart(run, stage) {
  if (stage !== 'phase' && stage !== 'step' && stage !== 'verify' && stage !== 'fix') return null;
  return run.values.phase === undefined ? null : Number(run.values.phase);
}

/**
 * @param {StepRun} run
 * @param {string} stage
 * @returns {number | null} The `--step` of a step start.
 */
function stepOfStart(run, stage) {
  return stage === 'step' ? Number(run.values.step) : null;
}

/**
 * The step marks that a start of new work keeps. A start of the phase,
 * review, review-fix, or inbox stage clears the feature marks, so the
 * feature steps run again after new work. A start of Phase n clears the
 * marks of Phase n too. The marks of the other phases stay, so a phase
 * step never runs twice for one phase. Fix 11: a mark `overridden-final`
 * always stays. The user accepted the step at its round cap
 * (`step-fail-cap`), so it never runs again in this run.
 *
 * @param {unknown} marks The `done.steps` object of the record.
 * @param {string} stage
 * @param {number | null} phase
 * @returns {Record<string, unknown>}
 */
function keptStepMarks(marks, stage, phase) {
  /** @type {Record<string, unknown>} */
  const kept = {};
  for (const [key, mark] of Object.entries(isPlainObject(marks) ? marks : {})) {
    const point = key.split(':')[0];
    if (mark === FINAL_MARK) {
      kept[key] = mark;
      continue;
    }
    if (point === 'feature' || point === 'epic') continue;
    if (stage === 'phase' && phase !== null && point === `phase-${phase}`) continue;
    kept[key] = mark;
  }
  return kept;
}

/**
 * The refusal of `start --retry` that cannot retry: no failed start, a
 * failed start of another stage or phase, no Task or no dispatch to retry,
 * or a broken circuit.
 *
 * @param {string} step
 * @param {string} feature
 * @param {Record<string, any> | null} failed
 * @param {string} stage
 * @param {number | null} phase
 * @param {number | null} [stepIndex] The line of orchestration.steps, for the stage `step`.
 * @returns {Record<string, any> | null}
 */
function retryRefusal(step, feature, failed, stage, phase, stepIndex = null) {
  if (!failed) {
    return refusal(step, 'no-failed-start', `No failed start of ${feature} waits for a retry.`, [
      'The run record holds no failed start.',
    ]);
  }
  if (failed.stage !== stage || (failed.phase ?? null) !== phase || (stage === 'step' && (failed.step ?? null) !== stepIndex)) {
    const named = failed.stage === 'phase' && isPhaseNumber(failed.phase) ? `Phase ${failed.phase}` : `the ${failed.stage} stage`;
    return refusal(step, 'retry-mismatch', `The failed start of ${feature} is not this stage.`, [
      `The run record holds a failed start of ${named}.`,
    ]);
  }
  // A start whose outcome is unknown can have opened a tab, so a retry can open a second one (CR-3).
  if (failed.unknown === true || failed.code === 'timeout') {
    return refusal(step, 'retry-unavailable', `The outcome of the last start of ${feature} is unknown, so it cannot retry.`, [
      'Orca can have opened the tab of that start. Check Orca for it, then run the close step to clear the start.',
    ]);
  }
  if (!failed.taskId || !failed.dispatchId) {
    return refusal(step, 'retry-unavailable', `Orca named no Task for the failed start of ${feature}, so it cannot retry.`, [
      'The failed start holds no Task id or no dispatch id. Run the close step to clear it.',
    ]);
  }
  if (failed.circuit === true || (failed.count ?? 1) >= START_FAILURE_CAP) {
    return refusal(step, 'circuit-broken', `The start of ${feature} failed ${failed.count ?? 1} times, so Orca broke the circuit.`, [
      'Orca makes no more retries of this Task.',
    ]);
  }
  return null;
}

/**
 * `start`: check the guard of the stage, render its spec, write it, run
 * `worker-start`, and record the dispatch. A record with an active dispatch
 * refuses, so one feature never runs two tabs. A failed start refuses a
 * plain start, so a failed start never runs again from its spec.
 * `--retry` runs `worker-start --task <taskId> --retry-of <dispatchId>`
 * from the failed start of the same stage: no spec file, and the same Orca
 * Task. A start that answers no dispatch records a failed start, so `next`
 * asks instead of starting again. A start of new work (the phase, review,
 * review-fix, and inbox stages) clears the end-stage marks of the record,
 * so the docs run again. Every start clears a large-change mark.
 *
 * A lane of `/orca-epic` starts where it builds (rule E14). A lane of a
 * side-by-side group with no branch opens a new child worktree from
 * `epic/<epic>`. A lane that holds a worktree opens its tab there, with its
 * record and its spec inside the worktree. A lane of a side-by-side group
 * with a branch and no worktree refuses `worktree-missing`.
 *
 * @param {StepRun} run
 * @returns {Record<string, any>}
 */
function stepStart(run) {
  const step = 'start';
  const checked = featureOf(run, step);
  if (!checked.ok) return checked.refusal;
  const stage = run.values.stage ?? 'phase';
  if (!START_STAGES.includes(stage)) {
    return refusal(step, 'stage-not-supported', `This version does not start the ${stage} stage.`, [
      `"--stage ${stage}" names a stage that this version does not run. It runs: ${START_STAGES.join(', ')}.`,
    ]);
  }
  if (checked.lane === null) return startStage(run, checked, { branch: runBranchOf(checked.path), placement: 'current', tree: null });

  const facts = gatherEpicFacts(run);
  const entry = facts.features.find((item) => item.path === checked.path);
  if (!entry) return startStage(run, checked, { branch: runBranchOf(checked.path), placement: 'current', tree: null });
  const mode = laneMode(epicPlan(facts), entry);
  if (mode === 'worktree') {
    const tree = /** @type {import('./decide.js').LaneTree} */ (entry.worktree).path;
    return startStage(laneRun(run, tree), checked, { branch: entry.branch, placement: 'worktree', tree });
  }
  if (mode === 'new-child') return startNewLane(run, checked, facts);
  if (mode === 'missing') {
    return refusal(step, 'worktree-missing', `The lane branch ${entry.branch} of ${checked.path} exists, and no worktree holds it.`, [
      'A lane of a side-by-side group builds in its own worktree.',
    ]);
  }
  return startStage(run, checked, { branch: entry.branch, placement: 'current', tree: null });
}

/**
 * The start of one stage in a known place: the main workspace on the run
 * branch, or the worktree of a lane. The lane run reads the record and the
 * docs of the worktree, writes the spec there, and opens the tab there with
 * its selector (fact O12). A worktree with no `.beast-mode/phase-handoff.md`
 * refuses `beast-mode-uncommitted`.
 *
 * @param {StepRun} run The run of the place: a lane run for a worktree.
 * @param {{ path: string, segments: string[], lane: string | null }} checked
 * @param {{ branch: string, placement: 'current' | 'worktree', tree: string | null }} site
 * @returns {Record<string, any>}
 */
function startStage(run, checked, site) {
  const step = 'start';
  const feature = checked.path;
  const stage = run.values.stage ?? 'phase';
  const retry = run.values.retry === true;

  const { record, note } = readRecord(run.projectRoot, feature);
  if (note) return recordUnreadable(step, feature, note, { feature, stage });
  if (record?.active) {
    return refusal(step, 'tab-active', `A tab of ${feature} still runs.`, [
      `The run record holds the dispatch ${record.active.dispatchId} of the ${record.active.stage} stage.`,
    ]);
  }
  const failed = record?.failedStart ?? null;
  if (retry) {
    const refused = retryRefusal(step, feature, failed, stage, phaseOfStart(run, stage), stepOfStart(run, stage));
    if (refused) return refused;
  } else if (failed) {
    return refusal(step, 'start-failed', `The last start of ${feature} failed.`, [
      'Retry it with "start --retry", or run the close step to clear the failed start.',
    ]);
  }

  const config = readOrcaConfig(mainRootOf(run));
  const refused = configRefusal(step, config);
  if (refused) return refused;
  const orchestration = /** @type {any} */ (config).orchestration;

  const docs = readFeatureDocs(run.projectRoot, checked);
  if (!docs.exists || docs.isEpic) {
    return refusal(step, 'feature-missing', `The feature ${feature} does not exist.`, [
      `docs/features/${feature}/ is not a feature folder.`,
    ]);
  }
  const plan = stagePlan(step, stage, {
    feature,
    docs,
    orchestration,
    record,
    phaseNumber: Number(run.values.phase),
    stepIndex: Number(run.values.step),
    lane: checked.lane !== null,
    round: Number(run.values.round),
    retry,
  });
  if (plan.refusal) return plan.refusal;
  const { agent, phase: phaseNumber, label } = plan;

  const { branch, tree } = site;
  const head = gitCall(run, gitCalls.head());
  if (!head.ok || head.stdout.trim() !== branch) {
    return refusal(step, 'not-run-branch', `The work tree${tree ? ` ${tree}` : ''} is not on ${branch}.`, [
      head.ok ? `HEAD is ${head.stdout.trim()}.` : 'HEAD names no branch.',
    ]);
  }
  if (tree && !hasHandoff(tree)) return handoffRefusal(step, feature, `The worktree ${tree}`);

  const specRel = `.beast-mode/briefs/${feature}/${plan.specName}`;
  // A step tab starts with no verdict: the file of an earlier tab of the same point never counts.
  if (plan.stepInfo) fs.rmSync(path.join(run.projectRoot, ...plan.stepInfo.verdictRel.split('/')), { force: true });
  // A phase verdict follows the same rule: a tab starts with no verdict of an earlier tab. A phase tab and a verify
  // tab remove it. A fix tab keeps it as `orca-phase-<n>-r<k>.verdict.md`, so a round never counts twice.
  const phaseVerdict = phaseNumber === null ? null : path.join(run.projectRoot, '.beast-mode', 'briefs', ...feature.split('/'), phaseVerdictName(phaseNumber));
  if (phaseVerdict && (stage === 'phase' || stage === 'verify')) fs.rmSync(phaseVerdict, { force: true });
  if (phaseVerdict && stage === 'fix' && plan.verifyInfo) {
    try {
      fs.renameSync(phaseVerdict, path.join(path.dirname(phaseVerdict), phaseVerdictKeptName(Number(phaseNumber), plan.verifyInfo.round)));
    } catch {
      // No verdict file, or it cannot move: the fix tab then starts with the file as it is.
    }
  }
  const placement = tree ? { worktree: laneSelector(tree) } : undefined;
  // A project command of the agent opens the tab in the same place (Decision 16).
  const command = projectCommandOf(config, agent);
  const startedAt = run.now().toISOString();
  let base = record ?? newRecord(feature);
  if (CLEARING_STAGES.includes(stage)) {
    const { inbox: _inbox, ...marks } = base.done ?? {};
    base = { ...base, done: { ...marks, docs: false, steps: keptStepMarks(base.done?.steps, stage, phaseNumber) } };
  }
  // The fix rounds of a phase: a fix start counts its round, and a new phase tab starts the count again.
  if (stage === 'fix' && plan.verifyInfo && phaseNumber !== null) {
    base = { ...base, verify: { ...(isPlainObject(base.verify) ? base.verify : {}), [String(phaseNumber)]: { round: plan.verifyInfo.round } } };
  }
  if (stage === 'phase' && phaseNumber !== null && isPlainObject(base.verify) && base.verify[String(phaseNumber)]) {
    const { [String(phaseNumber)]: _dropped, ...kept } = base.verify;
    base = { ...base, verify: kept };
  }
  // Fix 11: a new Phase n tab starts the FAIL rounds of its phase steps again. No other start resets a count,
  // so the rounds of a feature step survive the inbox, review, and review-fix starts that clear its mark.
  if (stage === 'phase' && phaseNumber !== null && isPlainObject(base.stepRounds)) {
    base = { ...base, stepRounds: Object.fromEntries(Object.entries(base.stepRounds).filter(([key]) => !key.startsWith(`phase-${phaseNumber}:`))) };
  }
  const where = {
    stage,
    phase: phaseNumber,
    ...(plan.stepInfo ? { step: plan.stepInfo.index } : {}),
    ...(stage === 'fix' && plan.verifyInfo ? { round: plan.verifyInfo.round } : {}),
    agent,
    at: startedAt,
  };
  // The Orca Task of a retry keeps its spec, so a retry writes no spec and passes none.
  const specFile = retry ? null : writeSpec(run.projectRoot, specRel, plan.spec);
  // The start entry goes in before the first Orca call, so a lost answer never reads as no tab (CR-2).
  writeRecord(run.projectRoot, feature, { ...base, active: null, failedStart: pendingStart(where, retry ? failed : null), largeChange: null });
  // The Task title is the tab title (fix 5). Only a first start passes it: a retry keeps the title of its Task.
  const title = taskTitleOf({ feature, stage, phase: phaseNumber, round: plan.verifyInfo?.round ?? null, command: plan.stepInfo?.command ?? null });
  /** @type {CommandLaunch | null} */
  let launched = null;
  let answer;
  if (command) {
    launched = commandStart(run, { command, selector: tree ? laneSelector(tree) : CURRENT_WORKTREE, specFile, retry: retry ? failed : null, title });
    answer = launched.answer;
  } else if (retry) {
    const previous = /** @type {Record<string, any>} */ (failed);
    answer = orcaCall(run, orcaCalls.workerRetry({ taskId: previous.taskId, retryOf: previous.dispatchId, agent, placement }));
  } else {
    answer = orcaCall(run, orcaCalls.workerStart({ specFile: /** @type {string} */ (specFile), agent, placement, title }));
  }

  const result = isPlainObject(answer.result) ? answer.result : {};
  const Label = `${label.charAt(0).toUpperCase()}${label.slice(1)}`;
  const launch = launchOf(command, launched);
  if (answer.kind === 'ok' && typeof result.dispatchId === 'string' && result.dispatchId.length > 0) {
    const active = {
      stage,
      phase: phaseNumber,
      step: plan.stepInfo?.index ?? null,
      ...(plan.stepInfo
        ? { point: plan.stepInfo.point, stepCommand: plan.stepInfo.command, verdictFile: plan.stepInfo.verdictRel }
        : {}),
      round: stage === 'fix' && plan.verifyInfo ? plan.verifyInfo.round : 0,
      ...(plan.verifyInfo ? { verdictFile: plan.verifyInfo.verdictRel, verifies: plan.verifyInfo.verifies } : {}),
      agent,
      placement: site.placement,
      ...(tree ? { worktree: tree } : {}),
      ...launch.record,
      // The spec of the tab holds the cross-phase review, so its done check needs a closed review.
      review: plan.review,
      spec: specRel,
      dispatchId: result.dispatchId,
      taskId: textOf(result.taskId) ?? (retry ? textOf(failed?.taskId) : null),
      runId: textOf(result.runId),
      startedAt,
      sendBacks: 0,
      escalations: 0,
      // The inbox tab closes its stage with a new requirements.md only when a line closes after this start.
      ...(stage === 'inbox' ? { closedLarge: docs.inboxNewRequirements.map((line) => line.text) } : {}),
    };
    try {
      writeRecord(run.projectRoot, feature, { ...base, active, failedStart: null, largeChange: null });
    } catch (err) {
      return recordUnwritable(step, err, {
        started: true,
        dispatchId: active.dispatchId,
        taskId: active.taskId,
        agent,
        extra: { feature, stage, phase: phaseNumber, placement: site.placement, ...launch.fields, ...(tree ? { worktree: tree, branch } : {}), retry },
      });
    }
    // The record holds the dispatch, so the submit loop of a dsh tab runs now (fix 1).
    const submitted = submitPrompt(run, { agent, dispatchId: active.dispatchId, terminal: launched?.terminal ?? receiptTerminal(result) });
    // The rename runs after the submit loop (fix 6). A retry opens a new tab with the `worker-` title again, so it renames too.
    const titled = renameTab(run, launched?.terminal ?? receiptTerminal(result) ?? submitted?.terminal, title);
    return withSubmit(
      success(step, `${retry ? 'Retried' : 'Started'} ${label} of ${feature} on ${agent}${launch.how}${tree ? ` in the worktree ${tree}` : ''}.${launch.note}`, {
        feature,
        stage,
        phase: phaseNumber,
        agent,
        placement: site.placement,
        ...launch.fields,
        ...(tree ? { worktree: tree, branch } : {}),
        dispatchId: active.dispatchId,
        taskId: active.taskId,
        runId: active.runId,
        spec: specRel,
        retry,
        ...(retry ? { retryOf: failed?.dispatchId ?? null } : {}),
      }),
      submitted,
      titled
    );
  }

  const entry = commandFailure(failedStartOf(answer, retry ? failed : null), command, launched);
  try {
    writeRecord(run.projectRoot, feature, { ...base, active: null, failedStart: { ...where, ...entry }, largeChange: null });
  } catch (err) {
    return recordUnwritable(step, err, {
      started: false,
      dispatchId: entry.dispatchId,
      taskId: entry.taskId,
      agent,
      detail: entry.detail,
      extra: { feature, stage, phase: phaseNumber, retry, count: entry.count, ...launch.fields },
    });
  }
  return refusal(step, 'start-failed', `${Label} of ${feature} did not ${retry ? 'start on the retry' : 'start'}.${hostHint(run, entry.detail)}`, entry.detail, {
    feature,
    stage,
    phase: phaseNumber,
    agent,
    retry,
    count: entry.count,
    ...launch.fields,
  });
}

/**
 * @param {string} step
 * @param {string} feature
 * @param {string} where The tree that holds no handoff file.
 * @returns {Record<string, any>}
 */
function handoffRefusal(step, feature, where) {
  return refusal(step, 'beast-mode-uncommitted', `The lane ${feature} cannot build in a worktree, because the project does not commit .beast-mode/.`, [
    `${where} holds no ${HANDOFF_REL}, and every worker reads it first.`,
  ]);
}

/**
 * @param {string} root The tree of the spec: the project, or a lane worktree.
 * @param {string} specRel
 * @param {string} body
 * @returns {string} The absolute path of the written spec.
 */
function writeSpec(root, specRel, body) {
  const file = path.join(root, ...specRel.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  return file;
}

/**
 * @typedef {Object} CommandLaunch The three calls of the command path.
 * @property {OrcaAnswer} answer The answer of `worker-start`, or of a `terminal create` that opened no terminal.
 * @property {string | null} terminal The handle of the terminal of the command. Null when none opened.
 * @property {'ready' | 'ready-unconfirmed' | null} readyState `ready` when the `tui-idle` wait held, else
 *   `ready-unconfirmed`. Null when no terminal opened, so no wait ran.
 * @property {string[]} detail The lines of a failed wait.
 */

/**
 * The low-level start of a tab with the project command of its agent
 * (Decision 16, fact O15): `terminal create --command` with no title, then
 * the `tui-idle` wait, then `worker-start --terminal`. A failed wait still
 * runs the start, which then answers `ready-unconfirmed`. A terminal that
 * does not open runs no wait and no start. The step never closes the
 * terminal: a failed start names it, and the user closes it in Orca.
 *
 * @param {StepRun} run The run of the place. Every Orca call starts in its main workspace.
 * @param {{ command: string, selector: string, specFile: string | null, retry: Record<string, any> | null, title?: string }} opts
 *   `specFile` for a start, or `retry`: the failed start, whose Task the retry names. `title`: the Task title of a first start.
 * @returns {CommandLaunch}
 */
function commandStart(run, { command, selector, specFile, retry, title }) {
  const created = orcaCall(run, orcaCalls.terminalCreate({ selector, command }));
  const terminal = created.kind === 'ok' ? terminalHandleOf(created.result) : null;
  if (!terminal) {
    /** @type {OrcaAnswer} */
    const answer =
      created.kind === 'ok'
        ? { kind: 'bad-answer', code: 'orca-bad-answer', result: null, detail: ['terminal create answered no terminal handle.'] }
        : created;
    return { answer, terminal: null, readyState: null, detail: [] };
  }
  const waited = orcaCall(run, orcaCalls.terminalWait(terminal));
  const ready = waitSatisfied(waited);
  const detail = ready
    ? []
    : [`The terminal ${terminal} did not show ready in 60 seconds, so the start ran unconfirmed.`, ...waited.detail].slice(0, MAX_OUTPUT_LINES);
  const answer = orcaCall(
    run,
    retry
      ? orcaCalls.workerAttachRetry({ taskId: retry.taskId, retryOf: retry.dispatchId, terminal, selector })
      : orcaCalls.workerAttach({ specFile: /** @type {string} */ (specFile), terminal, selector, title })
  );
  return { answer, terminal, readyState: ready ? 'ready' : 'ready-unconfirmed', detail };
}

/**
 * The parts of a start result and of its record that name the path of
 * the start (Decision 16). The agent path adds `path: "agent"` to the
 * result only, so its record and its say stay as they were.
 *
 * @param {string | null} command
 * @param {CommandLaunch | null} launched
 * @returns {{ fields: Record<string, any>, record: Record<string, any>, how: string, note: string }}
 */
function launchOf(command, launched) {
  if (!command || !launched) return { fields: { path: 'agent' }, record: {}, how: '', note: '' };
  const record = { path: 'command', command, terminal: launched.terminal, readyState: launched.readyState };
  return {
    fields: { ...record, ...(launched.detail.length > 0 ? { detail: launched.detail } : {}) },
    // The tab opened by our own start: the close step closes it (fix 3). The result fields do not name the mark.
    record: launched.terminal ? { ...record, ownTerminal: true } : record,
    how: ` with the project command "${command}"`,
    note: launched.readyState === 'ready-unconfirmed' ? ' Orca did not confirm that the tab was ready.' : '',
  };
}

/**
 * A failed start of the command path names its terminal, and nothing
 * closes it (Decision 16). The agent path keeps its entry as it was.
 *
 * @param {Record<string, any>} entry From failedStartOf().
 * @param {string | null} command
 * @param {CommandLaunch | null} launched
 * @returns {Record<string, any>}
 */
function commandFailure(entry, command, launched) {
  if (!command || !launched) return entry;
  const detail = [...launched.detail, ...entry.detail];
  if (launched.terminal) detail.push(`The terminal ${launched.terminal} stays open: close it in Orca.`);
  return { ...entry, path: 'command', command, terminal: launched.terminal, detail: detail.slice(0, MAX_OUTPUT_LINES) };
}

/**
 * @typedef {{ submit: 'confirmed' | 'unconfirmed', enters: number, detail: string[], terminal: string | null }} Submitted The outcome of
 *   one submit loop: whether it saw the turn start, its count of Enter presses, and the terminal that it used or read.
 */

/**
 * @param {number} count
 * @returns {string} The count of Enter presses as words.
 */
function entersText(count) {
  return `${count} Enter ${count === 1 ? 'press' : 'presses'}`;
}

/**
 * The submit loop of a dsh tab (fix 1). dsh refuses Enter until its
 * session opens (1 to 24 seconds), and it keeps the prompt as a draft.
 * Orca presses Enter one time after the paste, so the prompt can stay a
 * draft. Orca does not watch the turn start of dsh, so its receipt reads
 * `ready` in both cases. After a good start of a dsh tab, on the agent path
 * and on the command path, the loop reads `worker-show`:
 *
 * 1. A started turn ends the loop with `confirmed`.
 * 2. A tab that waits on a person ends it with no press: an overlay or a
 *    permission prompt can be on the screen.
 * 3. A tab in the pre-turn state gets one bare Enter, then a wait of 2
 *    seconds, then the next read.
 *
 * The loop stops after 45 seconds, or after SUBMIT_MAX_ENTERS presses on a
 * clock that stands still. A stopped worker, a failed call, and the time
 * limit end it with `unconfirmed`, which never fails the start. The loop
 * never closes the tab. The record of the start is already written, so a
 * killed loop loses no dispatch (CR-2). A tab of another agent gets no loop.
 *
 * @param {StepRun} run
 * @param {{ agent: string, dispatchId: string, terminal: string | null }} tab `terminal`: the terminal of the
 *   command path or of the receipt. When it is null, the loop uses the terminal that `worker-show` names.
 * @returns {Submitted | null} Null for an agent that is not dsh.
 */
function submitPrompt(run, { agent, dispatchId, terminal }) {
  if (agent !== 'dsh') return null;
  const startedAt = run.now().getTime();
  let handle = terminal;
  let enters = 0;
  /** @param {string[]} detail @returns {Submitted} */
  const unconfirmed = (detail) => ({ submit: 'unconfirmed', enters, detail: detail.slice(0, MAX_OUTPUT_LINES), terminal: handle });
  for (;;) {
    const seen = turnStartOf(orcaCall(run, orcaCalls.workerShow(dispatchId)));
    if (seen.turn === 'started') return { submit: 'confirmed', enters, detail: [], terminal: handle ?? seen.terminal };
    if (seen.turn === 'unread') return unconfirmed(seen.detail);
    if (seen.turn === 'person') return unconfirmed([...seen.detail, `The tab waits on a person, so the step stopped after ${entersText(enters)}.`]);
    if (seen.turn === 'stopped') return unconfirmed([...seen.detail, `The worker or its tab stopped, so the step stopped after ${entersText(enters)}.`]);
    handle = handle ?? seen.terminal;
    if (!handle) return unconfirmed([...seen.detail, 'Orca named no terminal of the tab, so the step pressed no Enter.']);
    if (enters >= SUBMIT_MAX_ENTERS || run.now().getTime() - startedAt >= SUBMIT_WINDOW_MS) {
      return unconfirmed([`dsh showed no turn start in ${SUBMIT_WINDOW_MS / 1000} seconds, after ${entersText(enters)}.`, ...seen.detail]);
    }
    const pressed = orcaCall(run, orcaCalls.terminalEnter(handle));
    if (pressed.kind !== 'ok') return unconfirmed([...pressed.detail, `The Enter failed after ${entersText(enters)}.`]);
    enters += 1;
    run.sleep(SUBMIT_DELAY_MS);
  }
}

/**
 * Add the outcome of the submit loop to the result of a good start (fix 1):
 * `submit` and `enters`, and for `unconfirmed` the say line and the detail
 * lines. With no loop, the result stays as it is.
 *
 * @param {Record<string, any>} result A success() result.
 * @param {Submitted | null} submitted
 * @param {{ tabTitled: boolean } | null} [titled] From renameTab(): the rename of the tab (fix 6). It adds `tabTitled`.
 * @returns {Record<string, any>}
 */
function withSubmit(result, submitted, titled = null) {
  const base = withTitle(result, titled);
  if (!submitted) return base;
  const detail = [...(Array.isArray(base.detail) ? base.detail : []), ...submitted.detail];
  return {
    ...base,
    say: submitted.submit === 'unconfirmed' ? `${base.say} ${SUBMIT_UNCONFIRMED_SAY}` : base.say,
    submit: submitted.submit,
    enters: submitted.enters,
    ...(detail.length > 0 ? { detail: detail.slice(0, MAX_OUTPUT_LINES) } : {}),
  };
}

/**
 * Give the tab of a good start its Task title (fix 6). Orca opens the worker
 * tab of the agent path as `worker-<taskId>`, and that title protects the
 * tab from the Task title, so the step renames it after the start. The rename
 * runs after the submit loop, so it never delays the prompt of a dsh tab. A
 * failed rename never fails the start. With no terminal handle, the step
 * runs no rename.
 *
 * @param {StepRun} run
 * @param {string | null | undefined} terminal The terminal of the command path, of the receipt, or of the submit loop.
 * @param {string} title The same title as `--task-title`.
 * @returns {{ tabTitled: boolean } | null} Null when no terminal handle exists, so no rename ran.
 */
function renameTab(run, terminal, title) {
  if (!terminal) return null;
  const renamed = orcaCall(run, orcaCalls.terminalRename({ terminal, title }));
  return { tabTitled: renamed.kind === 'ok' };
}

/**
 * Add `tabTitled` to the result of a good start. With no rename, the result stays as it is.
 *
 * @param {Record<string, any>} result
 * @param {{ tabTitled: boolean } | null} titled From renameTab().
 * @returns {Record<string, any>}
 */
function withTitle(result, titled) {
  return titled ? { ...result, tabTitled: titled.tabTitled } : result;
}

/**
 * `start` for a new lane whose agent has a project command (Decision 16,
 * Notes 8). `worker-start` cannot start a custom command, so the step makes
 * the workspace first: `worktree create --parent-worktree active` from
 * `epic/<epic>`. Then it records the lane as startNewLane does: the branch,
 * the three lane keys, and the handoff check. The spec, the record, and
 * every later call use the worktree, and the three calls of the command
 * path open the tab there. When Orca refuses the worktree (fact O15), the
 * step records a failed start with no Task and the mark `sequential`:
 * `next` stops `lane-worktree-refused`, and after the clear the group
 * builds in sequence, with this lane in the main workspace.
 *
 * @param {StepRun} run The main run.
 * @param {{ checked: { path: string, segments: string[], lane: string | null }, record: Record<string, any> | null,
 *   failed: Record<string, any> | null, retry: boolean, stage: string, plan: Record<string, any>,
 *   docs: import('./read.js').FeatureDocs, command: string }} ctx
 * @returns {Record<string, any>}
 */
function startNewLaneByCommand(run, { checked, record, failed, retry, stage, plan, docs, command }) {
  const step = 'start';
  const feature = checked.path;
  const epic = /** @type {string} */ (checked.lane);
  const into = epicBranchOf(epic);
  const { agent, phase: phaseNumber, label } = plan;
  const startedAt = run.now().toISOString();
  const { inbox: _inbox, ...marks } = record?.done ?? {};
  const { stepRounds: _rounds, ...kept } = record ?? newRecord(feature);
  const base = { ...kept, done: { ...marks, docs: false, steps: {} } };
  const Label = `${label.charAt(0).toUpperCase()}${label.slice(1)}`;
  const count = (Number.isInteger(failed?.count) ? failed.count : failed ? 1 : 0) + 1;
  const bare = { failedStage: null, lastError: null, taskId: null, dispatchId: null, residualResources: [], nextCommands: [], recovery: null, count, circuit: false };
  /**
   * Record a failed start where the lane keeps its record now, and refuse.
   *
   * @param {string} root The main workspace, or the adopted worktree.
   * @param {Record<string, any>} entry
   * @param {string} code
   * @param {string} say
   * @param {Record<string, any>} [extra] More record fields.
   */
  const failedStart = (root, entry, code, say, extra = {}) => {
    const fields = {
      feature,
      epic,
      stage,
      phase: phaseNumber,
      agent,
      path: 'command',
      command,
      retry,
      count: entry.count,
      ...(entry.terminal ? { terminal: entry.terminal } : {}),
      ...(root === run.projectRoot ? {} : { worktree: root }),
    };
    try {
      writeRecord(root, feature, {
        ...base,
        ...extra,
        active: null,
        failedStart: { stage, phase: phaseNumber, agent, at: startedAt, path: 'command', command, ...entry },
        largeChange: null,
      });
    } catch (err) {
      // The worktree create changed the state of Orca, so a lost write ends the run with the facts (CR-2).
      return recordUnwritable(step, err, { started: false, dispatchId: entry.dispatchId, taskId: entry.taskId, agent, detail: entry.detail, extra: fields });
    }
    return refusal(step, code, say, entry.detail, fields);
  };
  const didNotStart = `${Label} of ${feature} did not ${retry ? 'start on the retry' : 'start'}.`;

  const made = orcaCall(run, orcaCalls.worktreeCreate({ name: checked.segments[1], baseBranch: into }));
  const tree = made.kind === 'ok' ? createdWorktree(made.result) : null;
  if (!tree) {
    // Fact O15 refuses the new-lane path: a clear stop, and the lane runs in sequence (Notes 8).
    const detail = [
      ...(made.kind === 'ok' ? ['worktree create named no worktree path.'] : made.detail),
      `After the clear, the lanes of this group build in sequence, and ${feature} builds in the main workspace.`,
    ];
    return failedStart(
      run.projectRoot,
      { ...bare, code: LANE_REFUSED, count: 1, detail },
      LANE_REFUSED,
      `Orca refused a new worktree for the lane ${feature} with the project command "${command}", so the lane runs in sequence.`,
      { sequential: { at: startedAt, agent, command, code: made.kind === 'ok' ? 'orca-bad-answer' : made.code } }
    );
  }
  const adopted = adoptWorktree(run, epic, feature, tree.path);
  if (!adopted.ok) {
    return failedStart(run.projectRoot, { ...bare, code: 'worktree-unknown', detail: [...adopted.detail, `Left open: worktree ${tree.path}`] }, 'worktree-unknown', didNotStart);
  }
  if (!hasHandoff(tree.path)) return handoffRefusal(step, feature, `The worktree ${tree.path}`);

  // The worktree exists before the tab, so the spec and the record live there from the start.
  const specRel = `.beast-mode/briefs/${feature}/${plan.specName}`;
  const specFile = retry ? null : writeSpec(tree.path, specRel, plan.spec);
  // The start entry goes in before the tab start, so a lost answer never reads as no tab (CR-2).
  const where = { stage, phase: phaseNumber, agent, at: startedAt, path: 'command', command };
  writeRecord(tree.path, feature, { ...base, active: null, failedStart: pendingStart(where, retry ? failed : null), largeChange: null });
  const title = taskTitleOf({ feature, stage, phase: phaseNumber, round: plan.verifyInfo?.round ?? null, command: plan.stepInfo?.command ?? null });
  const launched = commandStart(laneRun(run, tree.path), { command, selector: laneSelector(tree.path), specFile, retry: retry ? failed : null, title });
  const result = isPlainObject(launched.answer.result) ? launched.answer.result : {};
  if (launched.answer.kind !== 'ok' || typeof result.dispatchId !== 'string' || result.dispatchId.length === 0) {
    const entry = commandFailure(failedStartOf(launched.answer, retry ? failed : null), command, launched);
    return failedStart(tree.path, entry, 'start-failed', didNotStart);
  }
  const launch = launchOf(command, launched);
  const active = {
    stage,
    phase: phaseNumber,
    step: null,
    round: 0,
    agent,
    placement: 'new-child',
    worktree: tree.path,
    worktreeId: tree.id,
    ...launch.record,
    review: plan.review,
    spec: specRel,
    dispatchId: result.dispatchId,
    taskId: textOf(result.taskId) ?? (retry ? textOf(failed?.taskId) : null),
    runId: textOf(result.runId),
    startedAt,
    sendBacks: 0,
    escalations: 0,
    ...(stage === 'inbox' ? { closedLarge: docs.inboxNewRequirements.map((line) => line.text) } : {}),
  };
  try {
    writeRecord(tree.path, feature, { ...base, active, failedStart: null, largeChange: null });
  } catch (err) {
    return recordUnwritable(step, err, {
      started: true,
      dispatchId: active.dispatchId,
      taskId: active.taskId,
      agent,
      extra: { feature, epic, stage, phase: phaseNumber, placement: 'new-child', ...launch.fields, worktree: tree.path, branch: adopted.branch, retry },
    });
  }
  const notes = [...launched.detail, ...adopted.notes];
  const say = `${retry ? 'Retried' : 'Started'} ${label} of ${feature} on ${agent}${launch.how} in the new worktree ${tree.path}, on ${adopted.branch}.${launch.note}`;
  // The record holds the dispatch, so the submit loop of a dsh tab runs now (fix 1).
  const submitted = submitPrompt(run, { agent, dispatchId: active.dispatchId, terminal: launched.terminal });
  const titled = renameTab(run, launched.terminal ?? submitted?.terminal, title);
  return withSubmit(
    success(step, adopted.notes.length > 0 ? `${say} A note follows in detail.` : say, {
      feature,
      epic,
      stage,
      phase: phaseNumber,
      agent,
      placement: 'new-child',
      ...launch.fields,
      worktree: tree.path,
      worktreeId: tree.id,
      branch: adopted.branch,
      dispatchId: active.dispatchId,
      taskId: active.taskId,
      runId: active.runId,
      spec: specRel,
      retry,
      ...(retry ? { retryOf: failed?.dispatchId ?? null } : {}),
      ...(notes.length > 0 ? { detail: notes } : {}),
    }),
    submitted,
    titled
  );
}

/**
 * Make a new child worktree the home of a lane: read the branch that Orca
 * gave it with `git -C <path> rev-parse --abbrev-ref HEAD`, and write the
 * three lane keys on that branch. A lane key that does not land loses the
 * lane, so it fails the adoption. A base key that does not land is a note.
 *
 * @param {StepRun} run The main run.
 * @param {string} epic
 * @param {string} feature
 * @param {string} tree The absolute path of the new worktree.
 * @returns {{ ok: true, branch: string, notes: string[] } | { ok: false, detail: string[] }}
 */
function adoptWorktree(run, epic, feature, tree) {
  const lrun = laneRun(run, tree);
  const named = gitCall(lrun, gitCalls.branchName());
  const branch = named.ok ? named.stdout.trim() : '';
  if (!named.ok) return { ok: false, detail: [`The branch of the worktree ${tree} cannot be read.`, ...named.detail] };
  if (!branch || branch === 'HEAD') return { ok: false, detail: [`The worktree ${tree} holds no branch: its HEAD is detached.`] };
  /** @type {string[]} */
  const notes = [];
  /** @type {['base' | 'epic' | 'feature', string][]} */
  const wanted = [
    ['base', epicBranchOf(epic)],
    ['epic', epic],
    ['feature', feature],
  ];
  for (const [key, value] of wanted) {
    const configured = gitCall(lrun, key === 'base' ? gitCalls.setBase(branch, value) : gitCalls.setKey(branch, key, value));
    if (configured.ok) continue;
    if (key === 'base') {
      notes.push(...configured.detail);
      continue;
    }
    return { ok: false, detail: [`The lane key beast-mode-${key} of ${branch} was not set, so the run cannot find the lane again.`, ...configured.detail] };
  }
  return { ok: true, branch, notes };
}

/**
 * @param {StepRun} run
 * @returns {string[] | null} The paths of every worktree, or null when the list cannot be read.
 */
function worktreePaths(run) {
  const list = gitCall(run, gitCalls.worktreeList());
  return list.ok ? parseWorktreeList(list.stdout).map((entry) => entry.path) : null;
}

/**
 * `start` for a new lane of a side-by-side group (rule E14, Decision 12):
 * `worker-start --worktree new-child --name <feature> --base-branch
 * epic/<epic>`. Orca makes the worktree and names its branch. The receipt
 * names the worktree (fact O11). A receipt with no worktree falls back to
 * the one new entry of `git worktree list`. The step then adopts the
 * worktree: it reads the branch, writes the three lane keys, and checks
 * that the worktree holds `.beast-mode/phase-handoff.md`. The record and a
 * copy of the spec go into the worktree, so no lane file lands in the
 * main work tree. The spec of the first tab waits in the briefs folder of
 * the main workspace, which git never sees, because the worktree does not
 * exist before the start. A failed start, and a tab whose worktree the
 * step cannot adopt, record a failed start there too, so `next` asks.
 *
 * @param {StepRun} run The main run.
 * @param {{ path: string, segments: string[], lane: string | null }} checked
 * @param {import('./decide.js').EpicFacts} facts
 * @returns {Record<string, any>}
 */
function startNewLane(run, checked, facts) {
  const step = 'start';
  const feature = checked.path;
  const epic = /** @type {string} */ (checked.lane);
  const into = epicBranchOf(epic);
  const stage = run.values.stage ?? 'phase';
  const retry = run.values.retry === true;

  const { record, note } = readRecord(run.projectRoot, feature);
  if (note) return recordUnreadable(step, feature, note, { feature, epic, stage });
  if (record?.active) {
    return refusal(step, 'tab-active', `A tab of ${feature} still runs.`, [
      `The run record holds the dispatch ${record.active.dispatchId} of the ${record.active.stage} stage.`,
    ]);
  }
  const failed = record?.failedStart ?? null;
  if (retry) {
    const refused = retryRefusal(step, feature, failed, stage, phaseOfStart(run, stage), stepOfStart(run, stage));
    if (refused) return refused;
  } else if (failed) {
    return refusal(step, 'start-failed', `The last start of ${feature} failed.`, [
      'Retry it with "start --retry", or run the close step to clear the failed start.',
    ]);
  }
  const refused = configRefusal(step, facts.config);
  if (refused) return refused;
  const docs = readFeatureDocs(run.projectRoot, checked);
  if (!docs.exists || docs.isEpic) {
    return refusal(step, 'feature-missing', `The feature ${feature} does not exist.`, [`docs/features/${feature}/ is not a feature folder.`]);
  }
  const plan = stagePlan(step, stage, {
    feature,
    docs,
    orchestration: /** @type {any} */ (facts.config).orchestration,
    record,
    phaseNumber: Number(run.values.phase),
    lane: true,
  });
  if (plan.refusal) return plan.refusal;
  const { agent, phase: phaseNumber, label } = plan;
  if (!facts.git.epicBranchExists) {
    return refusal(step, 'epic-branch-missing', `The branch ${into} does not exist.`, ['A new lane starts from the epic branch.']);
  }
  if (facts.git.epicHandoff === false) return handoffRefusal(step, feature, `The tree of ${into}`);
  const command = projectCommandOf(facts.config, agent);
  if (command) return startNewLaneByCommand(run, { checked, record, failed, retry, stage, plan, docs, command });

  const before = worktreePaths(run);
  const specRel = `.beast-mode/briefs/${feature}/${plan.specName}`;
  const placement = { worktree: 'new-child', name: checked.segments[1], baseBranch: into };
  /** @type {string} */
  let specFile = path.join(run.projectRoot, ...specRel.split('/'));
  const title = taskTitleOf({ feature, stage, phase: phaseNumber, round: plan.verifyInfo?.round ?? null, command: plan.stepInfo?.command ?? null });
  let answer;
  if (retry) {
    const previous = /** @type {Record<string, any>} */ (failed);
    answer = orcaCall(run, orcaCalls.workerRetry({ taskId: previous.taskId, retryOf: previous.dispatchId, agent, placement }));
  } else {
    specFile = writeSpec(run.projectRoot, specRel, plan.spec);
    answer = orcaCall(run, orcaCalls.workerStart({ specFile, agent, placement, title }));
  }

  const startedAt = run.now().toISOString();
  const { inbox: _inbox, ...marks } = record?.done ?? {};
  const { stepRounds: _rounds, ...kept } = record ?? newRecord(feature);
  const base = { ...kept, done: { ...marks, docs: false, steps: {} } };
  const result = isPlainObject(answer.result) ? answer.result : {};
  const Label = `${label.charAt(0).toUpperCase()}${label.slice(1)}`;
  const failedStart = (entry) => {
    const fields = { feature, epic, stage, phase: phaseNumber, agent, retry, count: entry.count };
    try {
      writeRecord(run.projectRoot, feature, { ...base, active: null, failedStart: { stage, phase: phaseNumber, agent, at: startedAt, ...entry }, largeChange: null });
    } catch (err) {
      // The start changed the state of Orca, so a lost write ends the run with the facts (CR-2).
      return recordUnwritable(step, err, { started: false, dispatchId: entry.dispatchId, taskId: entry.taskId, agent, detail: entry.detail, extra: fields });
    }
    return refusal(step, entry.code === 'worktree-unknown' ? 'worktree-unknown' : 'start-failed', `${Label} of ${feature} did not ${retry ? 'start on the retry' : 'start'}.${hostHint(run, entry.detail)}`, entry.detail, fields);
  };
  if (answer.kind !== 'ok' || typeof result.dispatchId !== 'string' || result.dispatchId.length === 0) {
    return failedStart(failedStartOf(answer, retry ? failed : null));
  }

  const dispatchId = result.dispatchId;
  const known = before ? new Set(before) : null;
  const added = known ? (worktreePaths(run) ?? []).filter((entry) => !known.has(entry)) : [];
  const tree = receiptWorktree(result) ?? (added.length === 1 ? { id: null, path: added[0] } : null);
  const adopted = tree
    ? adoptWorktree(run, epic, feature, tree.path)
    : { ok: false, detail: ['Orca named no worktree for the new lane, and git worktree list shows no single new one.'] };
  if (!adopted.ok || !tree) {
    // The tab works in a place that the run cannot find again, so it goes.
    const release = releaseDispatches(run, [dispatchId]);
    const detail = [
      ...adopted.detail,
      `Orca started the dispatch ${dispatchId}, and the run released it${release[0]?.ok ? '' : ', but Orca did not confirm it'}.`,
      ...(tree ? [`Left open: worktree ${tree.path}`] : []),
    ];
    const count = (Number.isInteger(failed?.count) ? failed.count : failed ? 1 : 0) + 1;
    return failedStart({ code: 'worktree-unknown', failedStage: null, lastError: null, taskId: null, dispatchId: null, residualResources: [], nextCommands: [], recovery: null, count, circuit: false, detail });
  }
  if (!hasHandoff(tree.path)) {
    releaseDispatches(run, [dispatchId]);
    return handoffRefusal(step, feature, `The worktree ${tree.path}`);
  }

  /** @type {string[]} */
  const notes = [...adopted.notes];
  try {
    const copy = path.join(tree.path, ...specRel.split('/'));
    fs.mkdirSync(path.dirname(copy), { recursive: true });
    fs.copyFileSync(specFile, copy);
  } catch (err) {
    notes.push(`The spec was not copied into the worktree: ${err instanceof Error ? err.message : String(err)}`);
  }
  const active = {
    stage,
    phase: phaseNumber,
    step: null,
    round: 0,
    agent,
    placement: 'new-child',
    worktree: tree.path,
    worktreeId: tree.id,
    review: plan.review,
    spec: specRel,
    dispatchId,
    taskId: textOf(result.taskId) ?? (retry ? textOf(failed?.taskId) : null),
    runId: textOf(result.runId),
    startedAt,
    sendBacks: 0,
    escalations: 0,
    ...(stage === 'inbox' ? { closedLarge: docs.inboxNewRequirements.map((line) => line.text) } : {}),
  };
  try {
    writeRecord(tree.path, feature, { ...base, active, failedStart: null, largeChange: null });
  } catch (err) {
    return recordUnwritable(step, err, {
      started: true,
      dispatchId,
      taskId: active.taskId,
      agent,
      extra: { feature, epic, stage, phase: phaseNumber, placement: 'new-child', worktree: tree.path, branch: adopted.branch, retry },
    });
  }
  const say = `${retry ? 'Retried' : 'Started'} ${label} of ${feature} on ${agent} in the new worktree ${tree.path}, on ${adopted.branch}.`;
  // The record holds the dispatch, so the submit loop of a dsh tab runs now (fix 1).
  const submitted = submitPrompt(run, { agent, dispatchId, terminal: receiptTerminal(result) });
  const titled = renameTab(run, receiptTerminal(result) ?? submitted?.terminal, title);
  return withSubmit(
    success(step, notes.length > 0 ? `${say} A note follows in detail.` : say, {
      feature,
      epic,
      stage,
      phase: phaseNumber,
      agent,
      placement: 'new-child',
      worktree: tree.path,
      worktreeId: tree.id,
      branch: adopted.branch,
      dispatchId,
      taskId: active.taskId,
      runId: active.runId,
      spec: specRel,
      retry,
      ...(retry ? { retryOf: failed?.dispatchId ?? null } : {}),
      ...(notes.length > 0 ? { detail: notes } : {}),
    }),
    submitted,
    titled
  );
}

/**
 * The step result that the close of a step tab records. `PASS` when the
 * verdict file reads PASS. `overridden` for another verdict, or for no
 * verdict, when the call holds `--override`, and `overridden-final` when it
 * also holds `--final` (fix 11: the answer `accept` of `step-fail-cap`).
 * Else a refusal, so the tab and the record stay as they are. A tab of
 * another stage records nothing.
 *
 * @param {string} step
 * @param {string} run The feature path, or the epic, for the text of the refusal.
 * @param {Record<string, any> | null | undefined} active
 * @param {Record<string, import('./read.js').StepVerdictFact> | undefined} verdicts
 * @param {boolean} override
 * @param {boolean} [final] `--final`: the override holds for the rest of the run.
 * @returns {{ refusal: Record<string, any> | null, key: string, mark: 'PASS' | 'overridden' | 'overridden-final' | null } | null}
 */
function stepMarkOf(step, run, active, verdicts, override, final = false) {
  if (!active || active.stage !== 'step') return null;
  const key = stepKey(String(active.point), Number(active.step));
  const fact = verdicts?.[key];
  const verdict = fact?.verdict ?? null;
  if (verdict === 'PASS') return { refusal: null, key, mark: 'PASS' };
  if (override) return { refusal: null, key, mark: final ? FINAL_MARK : 'overridden' };
  const read = verdict === null ? 'The verdict file is missing, or its line 1 is not PASS, FAIL, or BLOCKED.' : `The verdict file reads ${verdict}.`;
  return {
    key,
    mark: null,
    refusal: refusal(step, 'step-not-passed', `The step tab of ${run} has no PASS verdict.`, [
      read,
      'Close it with "--override" to go on, recorded as overridden.',
    ]),
  };
}

/**
 * Fix 11: the FAIL rounds of each step after the close of a step tab. An
 * override (`overridden` or `overridden-final`) counts one more round of
 * its step. A PASS starts its count again: the step converged.
 *
 * @param {unknown} rounds The `stepRounds` object of the record.
 * @param {{ key: string, mark: string | null }} result
 * @returns {Record<string, number>}
 */
function stepRoundsAfter(rounds, result) {
  const { [result.key]: prior, ...rest } = isPlainObject(rounds) ? rounds : {};
  if (result.mark === 'PASS') return rest;
  return { ...rest, [result.key]: (Number.isInteger(prior) && prior > 0 ? prior : 0) + 1 };
}

/**
 * `close`: release the tab of the active dispatch (and the dispatch of a
 * failed start) first, then clear both from the record. A refused release
 * never blocks the clear. The close of a docs tab marks the docs done (rule
 * F21). The close of an inbox tab records each line that the tab closed
 * `done: new requirements.md`, so `next` stops `large-change` (rule F20).
 * `--discard` drops the tab and marks nothing, so a lost docs tab runs
 * again. A record with no tab and a large-change mark loses the mark, so
 * the run goes on with the plan as it is.
 *
 * @param {StepRun} run
 * @returns {Record<string, any>}
 */
function stepClose(run) {
  const step = 'close';
  const checked = featureOf(run, step);
  if (!checked.ok) return checked.refusal;
  const feature = checked.path;
  const discard = run.values.discard === true;
  // A lane in a worktree keeps its record and its docs there.
  const lane = laneOf(run, checked);
  run = lane.run;

  const { record, note } = readRecord(run.projectRoot, feature);
  // A record that cannot be read can name an open tab, so the close never reports that no tab is open (CR-1).
  if (note) return recordUnreadable(step, feature, note, { feature });
  if (!record || (!record.active && !record.failedStart)) {
    if (record?.largeChange) {
      writeRecord(run.projectRoot, feature, { ...record, largeChange: null });
      return success(step, `No tab of ${feature} is open. The large-change stop is clear, so the run goes on with the plan as it is.`, {
        feature,
        dispatchId: null,
        release: [],
        discard,
        docsDone: false,
        largeChange: false,
      });
    }
    return success(step, `No tab of ${feature} is open.`, { feature, dispatchId: null, release: [] });
  }

  // The close of a step tab records its result (Decision 17): PASS, or `overridden` with "--override".
  const stepResult = discard ? null : stepMarkOf(step, feature, record.active, readFeatureDocs(run.projectRoot, checked).stepVerdicts, run.values.override === true, run.values.final === true);
  if (stepResult?.refusal) return stepResult.refusal;

  // A dropped verify or fix tab leaves no verdict, so the run starts a new tab for the phase (rule F16).
  const droppedStage = record.active?.stage;
  if (discard && (droppedStage === 'verify' || droppedStage === 'fix') && Number.isInteger(record.active.phase)) {
    fs.rmSync(path.join(run.projectRoot, '.beast-mode', 'briefs', ...feature.split('/'), phaseVerdictName(record.active.phase)), { force: true });
  }

  const ids = [];
  for (const id of [record.active?.dispatchId, record.failedStart?.dispatchId]) {
    if (typeof id === 'string' && id.length > 0 && !ids.includes(id)) ids.push(id);
  }
  let release = ids.map((id) => {
    const answer = orcaCall(run, orcaCalls.workerRelease(id));
    if (answer.kind === 'ok') {
      const state = isPlainObject(answer.result) && typeof answer.result.state === 'string' ? answer.result.state : 'unknown';
      return { dispatchId: id, ok: true, state, detail: [] };
    }
    return { dispatchId: id, ok: false, code: answer.code, detail: answer.detail };
  });
  // A follow-up that a user note started still works when Orca refuses its release as not settled. A close
  // line of an ask made before the note would drop it while it works, so the record keeps it (--discard drops it).
  const noteFollowUp = isPlainObject(record.active?.noteFollowUp) ? record.active.noteFollowUp : null;
  const working = !discard && noteFollowUp && noteFollowUp.dispatchId === record.active.dispatchId
    ? release.find((entry) => entry.dispatchId === record.active.dispatchId && !entry.ok && entry.code === 'dispatch_inactive')
    : undefined;
  if (working) {
    return refusal(step, 'follow-up-working', `The follow-up ${working.dispatchId} that a user note started for ${tabLabel(feature, record.active)} still works.`, [
      `Orca started it for the note to ${String(noteFollowUp?.of)}, and it has not reported yet. Orca wakes this tab when it reports; then call next.`,
      'Close it with "--discard" to drop it anyway.',
      ...working.detail,
    ], { feature, dispatchId: working.dispatchId });
  }
  // Fix 10: a tab that --discard drops and Orca did not release still runs. Stop it.
  if (discard) release = stopUnreleased(run, release);
  const ownClose = closeOwnTerminal(run, record.active, release);
  const own = terminalCloseOf(ownClose);

  const docsDone = record.active?.stage === 'docs' && !discard;
  const inboxDone = record.active?.stage === 'inbox' && !discard;
  let largeChange = null;
  if (inboxDone) {
    const lines = largeChangesSince(readFeatureDocs(run.projectRoot, checked), record.active.closedLarge);
    if (lines.length > 0) largeChange = { lines: lines.map((line) => line.text), at: run.now().toISOString() };
  }
  const kept = release.filter((entry) => (!entry.ok && entry.stopped !== true) || entry.state === 'retained').map((entry) => entry.dispatchId);
  writeRecord(run.projectRoot, feature, {
    ...record,
    active: null,
    failedStart: null,
    largeChange,
    // A lane in a worktree keeps each tab that Orca did not release, so its merge releases it again.
    ...(lane.tree && kept.length > 0 ? { retained: [...(Array.isArray(record.retained) ? record.retained : []), ...kept] } : {}),
    // A lane keeps the handle of an own terminal that did not close, so its merge closes it again.
    ...(lane.tree && ownClose && !ownClose.closed
      ? { retainedTerminals: { ...(isPlainObject(record.retainedTerminals) ? record.retainedTerminals : {}), [record.active.dispatchId]: ownClose.terminal } }
      : {}),
    // An inbox tab that ran is an end stage, so its changes never commit under a phase subject.
    ...(docsDone ? { done: { ...record.done, docs: true } } : {}),
    ...(inboxDone ? { done: { ...record.done, inbox: true } } : {}),
    ...(stepResult?.mark ? { done: { ...record.done, steps: { ...record.done.steps, [stepResult.key]: stepResult.mark } } } : {}),
    ...(stepResult?.mark ? { stepRounds: stepRoundsAfter(record.stepRounds, stepResult) } : {}),
  });

  const tab = record.active
    ? record.active.stage === 'phase' && isPhaseNumber(record.active.phase)
      ? `the Phase ${record.active.phase} tab`
      : `the ${record.active.stage} tab`
    : 'the failed start';
  const tail = releaseTail(release, discard);
  const marks = `${docsDone ? ' The docs are marked done.' : ''}${largeChange ? ' A large change wrote a new requirements.md.' : ''}${stepResult?.mark ? ` The step result is ${stepResult.mark}.` : ''}`;
  return success(step, `Closed ${tab} of ${feature}.${marks}${tail}${own.say}`, {
    feature,
    dispatchId: record.active?.dispatchId ?? record.failedStart?.dispatchId ?? null,
    release,
    ...own.fields,
    discard,
    docsDone,
    largeChange: largeChange !== null,
    stepResult: stepResult?.mark ? { key: stepResult.key, mark: stepResult.mark } : null,
  });
}

/**
 * The `tab-active` refusal of a step that takes the work of a lane or a
 * feature: the run record still holds an active dispatch. `start` refuses
 * the same state. A step that a stale line runs late never takes the
 * changes of a tab that works.
 *
 * @param {string} step
 * @param {StepRun} run The run whose project root holds the record (the worktree of a lane).
 * @param {string} feature
 * @param {Record<string, any>} [extra]
 * @returns {Record<string, any> | null} The refusal, or null with no active dispatch.
 */
function activeRefusal(step, run, feature, extra = {}) {
  const { record } = readRecord(run.projectRoot, feature);
  if (!record?.active) return null;
  return refusal(step, 'tab-active', `A tab of ${feature} still runs.`, [
    `The run record holds the dispatch ${record.active.dispatchId} of the ${record.active.stage} stage.`,
  ], extra);
}

/**
 * `commit`: stage every change outside `.beast-mode/briefs/` and commit one
 * cadence point. `--point phase` commits one phase with the subject
 * `feat: <path> phase <n>`. `--point review` commits the split review fixes
 * with the subject `fix: <path> cross-phase review`. It refuses any cadence
 * but `phase`, any branch but the run branch, and a point whose work is not
 * done. A failed add or commit (a commit hook included) records the
 * failure.
 *
 * @param {StepRun} run
 * @returns {Record<string, any>}
 */
function stepCommit(run) {
  const step = 'commit';
  const checked = featureOf(run, step);
  if (!checked.ok) return checked.refusal;
  const feature = checked.path;
  // A lane in a worktree commits there, with `git -C <worktree>`.
  const lane = laneOf(run, checked);
  run = lane.run;

  // A stale line can run while a tab still works: the commit takes the changes of a running tab.
  const working = activeRefusal(step, run, feature);
  if (working) return working;

  const point = run.values.point ?? 'phase';
  if (point !== 'phase' && point !== 'review') {
    return refusal(step, 'point-not-supported', 'This version commits a phase or the review fixes only.', [
      `"--point ${point}" names a commit point that this version does not run.`,
    ]);
  }
  const phaseNumber = point === 'phase' ? Number(run.values.phase) : null;
  const label = point === 'phase' ? `Phase ${phaseNumber} of ${feature}` : `the review fixes of ${feature}`;

  const config = readOrcaConfig(mainRootOf(run));
  const refused = configRefusal(step, config);
  if (refused) return refused;
  const orchestration = /** @type {any} */ (config).orchestration;
  const cadence = orchestration.commit;
  if (cadence !== 'phase') {
    return refusal(step, 'cadence', `The commit cadence is "${cadence}", so the run makes no ${point} commit.`, [
      `orchestration.commit is "${cadence}".`,
    ]);
  }

  const docs = readFeatureDocs(run.projectRoot, checked);
  if (point === 'phase') {
    const phase = docs.tasks?.phases.find((entry) => entry.number === phaseNumber);
    if (!phase) {
      return refusal(step, 'phase-missing', `The task list of ${feature} holds no Phase ${phaseNumber}.`, [
        `docs/features/${feature}/tasks.md holds no "## Phase ${phaseNumber}" section.`,
      ]);
    }
    if (!isPhaseComplete(phase)) {
      return refusal(
        step,
        'phase-incomplete',
        `Phase ${phaseNumber} of ${feature} is not complete.`,
        phase.total === 0 ? [`Phase ${phaseNumber} holds no task line.`] : phase.open
      );
    }
    // The phase commits only after a PASS. With the verify agent equal to the implement agent, a phase tab
    // that wrote no verdict still commits, but a FAIL or a BLOCKED never does.
    const verdict = docs.phaseVerdicts?.[String(phaseNumber)]?.verdict ?? null;
    const splitVerify = orchestration.stages.verify !== orchestration.stages.implement;
    if (verdict !== 'PASS' && (splitVerify || verdict !== null)) {
      return refusal(step, 'verify-open', `Phase ${phaseNumber} of ${feature} has no PASS verdict, so it takes no commit.`, [
        verdict === null
          ? `.beast-mode/briefs/${feature}/${phaseVerdictName(Number(phaseNumber))} does not exist, or its line 1 is not PASS, FAIL, or BLOCKED.`
          : `The verdict of Phase ${phaseNumber} reads ${verdict}.`,
      ]);
    }
  } else {
    const split = splitReviewRefusal(step, feature, docs, orchestration.stages);
    if (split) return split;
    const state = reviewFileState(docs);
    if (state !== 'closed') {
      return refusal(step, state === 'missing' ? 'review-missing' : 'review-open', `The review of ${feature} is not closed.`, [
        `docs/features/${feature}/code-review.md does not exist, cannot be read, or holds an open finding.`,
      ]);
    }
    if (readRecord(run.projectRoot, feature).record?.done?.docs === true) {
      // The work tree then holds the docs, which never commit as the review fixes.
      return refusal(step, 'docs-done', `The docs tab of ${feature} has run, so the review fixes take no commit.`, [
        'The run record marks the docs tab done.',
      ]);
    }
  }

  const branch = lane.branch;
  const facts = readGitFacts(run, branch);
  if (!facts.workTree) return refusal(step, 'not-git', 'The project is not a git work tree.', facts.detail);
  if (facts.error) return refusal(step, 'git-failed', 'A git read failed.', facts.error);
  if (facts.head !== branch) {
    return refusal(step, 'not-run-branch', `The work tree is not on ${branch}.`, [
      facts.head ? `HEAD is ${facts.head}.` : 'HEAD names no branch.',
    ]);
  }
  const subject = point === 'phase' ? phaseSubject(feature, /** @type {number} */ (phaseNumber)) : reviewSubject(feature);
  if (facts.subjects.includes(subject)) {
    return refusal(
      step,
      point === 'phase' ? 'phase-committed' : 'review-committed',
      `${label.charAt(0).toUpperCase()}${label.slice(1)} ${point === 'phase' ? 'is' : 'are'} already committed.`,
      [`${branch} holds the commit "${subject}".`]
    );
  }
  if (facts.dirty.length === 0) {
    return refusal(step, 'nothing-to-commit', `The work tree holds no change for ${label}.`, [
      'git status shows no change outside .beast-mode/briefs/.',
    ]);
  }

  const failure = { step, phase: phaseNumber, point, code: 'commit-failed', say: `The commit of ${label} failed.` };
  const added = gitCall(run, gitCalls.addAll());
  if (!added.ok) return gitWriteFailed(run, feature, { ...failure, detail: added.detail });
  const committed = gitCall(run, gitCalls.commit(subject));
  if (!committed.ok) return gitWriteFailed(run, feature, { ...failure, detail: committed.detail });

  const sha = gitCall(run, gitCalls.revParseHead());
  clearGitFailure(run, feature, step);
  return success(step, `Committed ${label}.`, {
    feature,
    point,
    phase: phaseNumber,
    subject,
    commit: sha.ok ? sha.stdout.trim() : null,
  });
}

/**
 * Read a text file of the user: the answer of `reply`, or the message of
 * `note`. The text loses its trailing white space. A file that is missing,
 * not a regular file, over the cap, empty, or with a NUL byte answers a
 * code and its detail line. Never throws.
 *
 * @param {string} file An absolute path.
 * @param {number} limit The cap in bytes.
 * @returns {{ ok: true, text: string } | { ok: false, code: string, say: string, detail: string[] }}
 */
function readTextFile(file, limit) {
  let text;
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile()) return { ok: false, code: 'unreadable', say: 'is not a file', detail: [`${file} is not a regular file.`] };
    if (stat.size > limit) {
      return { ok: false, code: 'too-large', say: `holds more than ${limit} bytes`, detail: [`${file} holds ${stat.size} bytes.`] };
    }
    text = fs.readFileSync(file, 'utf8').trimEnd();
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err)?.code === 'ENOENT') {
      return { ok: false, code: 'missing', say: 'does not exist', detail: [`${file} does not exist.`] };
    }
    return {
      ok: false,
      code: 'unreadable',
      say: 'cannot be read',
      detail: [`${file}: ${err instanceof Error ? err.message : String(err)}`],
    };
  }
  if (text.trim().length === 0) return { ok: false, code: 'empty', say: 'is empty', detail: [`${file} holds no text.`] };
  if (text.includes('\0')) return { ok: false, code: 'invalid', say: 'holds a NUL byte', detail: [`${file} holds a NUL byte.`] };
  return { ok: true, text };
}

/**
 * `reply`: read the answer file, and pass the answer to the worker that
 * asked with `orchestration reply --id <id> --body <text> --json`. The
 * answer is one argument of the argument array, never a shell string.
 * Trailing white space is dropped. Writes nothing.
 *
 * @param {StepRun} run
 * @returns {Record<string, any>}
 */
function stepReply(run) {
  const step = 'reply';
  const id = /** @type {string} */ (run.values.id);
  const file = path.resolve(run.cwd, /** @type {string} */ (run.values['body-file']));

  const read = readTextFile(file, MAX_REPLY_BYTES);
  if (!read.ok) return refusal(step, `body-${read.code}`, `The answer file ${read.say}.`, read.detail, { id });

  const answer = orcaCall(run, orcaCalls.reply({ id, body: read.text }));
  if (answer.kind === 'ok') return success(step, 'Sent the answer to the worker.', { id, result: answer.result });
  return refusal(step, 'reply-failed', 'Orca did not deliver the answer.', answer.detail, {
    id,
    orcaCode: answer.code,
  });
}

/**
 * @param {string} feature
 * @param {Record<string, any>} active
 * @returns {string} The name of the tab of an active entry, for example "the Phase 2 tab of demo".
 */
function tabLabel(feature, active) {
  const numbered = isPhaseNumber(active.phase);
  if (active.stage === 'phase' && numbered) return `the Phase ${active.phase} tab of ${feature}`;
  if ((active.stage === 'verify' || active.stage === 'fix') && numbered) return `the ${active.stage} tab of Phase ${active.phase} of ${feature}`;
  if (active.stage === 'step' && typeof active.stepCommand === 'string') return `the step tab "${active.stepCommand}" of ${feature}`;
  return `the ${active.stage} tab of ${feature}`;
}

/**
 * @param {string} feature
 * @param {Record<string, any>} active
 * @returns {string} The work of a tab in a send text, for example "Phase 2 of demo".
 */
function workLabel(feature, active) {
  const numbered = isPhaseNumber(active.phase);
  if (active.stage === 'phase' && numbered) return `Phase ${active.phase} of ${feature}`;
  if (active.stage === 'verify' && numbered) return `the verification of Phase ${active.phase} of ${feature}`;
  if (active.stage === 'fix' && numbered) return `the fix of Phase ${active.phase} of ${feature}`;
  if (active.stage === 'step' && typeof active.stepCommand === 'string') return `the step "${active.stepCommand}" of ${feature}`;
  return `the ${active.stage} stage of ${feature}`;
}

/**
 * @param {string} feature
 * @param {Record<string, any>} active
 * @returns {string} The project path of the spec of a tab. A record of Phase 2 names no spec, so the name follows the stage.
 */
function specOf(feature, active) {
  if (typeof active.spec === 'string' && active.spec) return active.spec;
  const name = active.stage === 'phase' && isPhaseNumber(active.phase) ? `orca-phase-${active.phase}.md` : `orca-${active.stage}.md`;
  return `.beast-mode/briefs/${feature}/${name}`;
}

/**
 * The ids of a send receipt that started a follow-up (fact O9): a finished
 * worker gets the message as a follow-up Task, and the receipt names its
 * dispatch. That dispatch replaces the active id. A receipt with no
 * dispatch id, or with the same id, changes nothing.
 *
 * @param {Record<string, any>} active
 * @param {unknown} result
 * @returns {{ dispatchId: string, taskId: string | null, runId: string | null } | null}
 */
function followUpOf(active, result) {
  const id = isPlainObject(result) ? textOf(result.dispatchId) : null;
  if (!id || id === active.dispatchId) return null;
  const receipt = /** @type {Record<string, any>} */ (result);
  return {
    dispatchId: id,
    taskId: textOf(receipt.taskId) ?? textOf(active.taskId),
    runId: textOf(receipt.runId) ?? textOf(active.runId),
  };
}

/** The words of each send reason in `say`. */
const SEND_SAY = {
  'open-tasks': 'the open items',
  escalation: 'the resume text',
  report: 'the report request',
  'missing-verdict': 'the verdict note',
};

/**
 * `send`: pass one text to the running tab of the feature with
 * `orchestration send --to dispatch:<id> --subject <s> --body <text>`. The
 * text follows the reason (P2-11): the open items of the stage word for
 * word, the resume text, the report request, or the verdict note. A send of
 * open items counts as a send-back, and a resume or a report send counts as
 * an escalation send. A follow-up dispatch id in the receipt replaces the
 * active id (fact O9). A send that fails records the failure, so the next
 * call stops `send-failed` instead of sending again. A send never retries
 * by itself.
 *
 * @param {StepRun} run
 * @returns {Record<string, any>}
 */
function stepSend(run) {
  const step = 'send';
  const checked = featureOf(run, step);
  if (!checked.ok) return checked.refusal;
  const feature = checked.path;
  // A lane in a worktree keeps its record and its docs there.
  run = laneOf(run, checked).run;
  const reason = String(run.values.reason);
  if (!SEND_REASONS.includes(reason)) {
    return refusal(step, 'reason-not-supported', `This version does not send the reason "${reason}".`, [
      `"--reason ${reason}" names no send. The reasons: ${SEND_REASONS.join(', ')}.`,
    ], { feature, reason });
  }

  const { record } = readRecord(run.projectRoot, feature);
  const active = record?.active;
  if (!record || !active) {
    return refusal(step, 'no-tab', `No tab of ${feature} runs.`, ['The run record holds no active dispatch.'], { feature, reason });
  }
  const tab = tabLabel(feature, active);
  const check = doneCheck(feature, readFeatureDocs(run.projectRoot, checked), active);
  const open = check?.open ?? [];
  if (reason === 'open-tasks' && open.length === 0) {
    return refusal(step, 'nothing-open', `The files of ${feature} show no open item for ${tab}.`, [
      check ? `${check.what.charAt(0).toUpperCase()}${check.what.slice(1)}.` : `The run record names the stage "${active.stage}".`,
    ], { feature, reason });
  }
  if (reason === 'report' && check?.pass !== true) {
    return refusal(step, 'report-not-ready', `The done proof of ${tab} does not hold yet.`, open.length > 0 ? open : [
      `The run record names the stage "${active.stage}".`,
    ], { feature, reason });
  }

  // Fix 7: with `--mail`, the text names the undelivered mail of the tab, read again here.
  const mail = run.values.mail === true && (reason === 'escalation' || reason === 'report') ? readPendingMail(run, active).messages : [];
  const text = sendText({
    label: workLabel(feature, active),
    reason,
    open: reason === 'report' ? [] : open,
    spec: specOf(feature, active),
    mail: mail.length,
    dispatchId: active.dispatchId,
  });
  const answer = orcaCall(run, orcaCalls.send({ dispatchId: active.dispatchId, subject: text.subject, body: text.body }));
  if (answer.kind !== 'ok') {
    writeRecord(run.projectRoot, feature, {
      ...record,
      active: { ...active, failedSend: { reason, code: answer.code, at: run.now().toISOString(), detail: answer.detail } },
    });
    return refusal(step, 'send-failed', `Orca did not deliver the send to ${tab}.`, answer.detail, {
      feature,
      reason,
      dispatchId: active.dispatchId,
      orcaCode: answer.code,
    });
  }

  const followUp = followUpOf(active, answer.result);
  // A resume or a report send after progress starts its count again (fix 2).
  const counted = sendCounts(active, reason, open.length);
  const { failedSend: _failedSend, ...kept } = active;
  const named = mail.length > 0 ? { mailNamed: [...(Array.isArray(active.mailNamed) ? active.mailNamed : []), ...mail.map((message) => message.id)] } : {};
  // Fix 7: a lost escalation from before this send is answered, so a later timer wake does not take it again.
  if (reason === 'escalation' || reason === 'report') named.escalationAt = run.now().toISOString();
  writeRecord(run.projectRoot, feature, { ...record, active: { ...kept, ...counted, ...named, ...(followUp ?? {}) } });
  const tail = followUp ? ` Orca started the follow-up dispatch ${followUp.dispatchId}.` : '';
  return success(step, `Sent ${SEND_SAY[reason]} to ${tab}.${tail}`, {
    feature,
    reason,
    dispatchId: followUp?.dispatchId ?? active.dispatchId,
    previousDispatchId: followUp ? active.dispatchId : null,
    followUp: followUp !== null,
    subject: text.subject,
    open: reason === 'report' ? [] : open,
    mail: mail.map((message) => message.id),
  });
}

/**
 * @param {StepRun} run
 * @returns {string | null} The inbox template: the one of the project, else the one of the plugin, else null.
 */
function readInboxTemplate(run) {
  for (const file of [
    path.join(run.projectRoot, '.beast-mode', 'templates', 'inbox.md'),
    path.join(run.pluginRoot, 'templates', 'dev-docs', 'inbox.md'),
  ]) {
    try {
      return fs.readFileSync(file, 'utf8');
    } catch {
      // The next place.
    }
  }
  return null;
}

/**
 * Append one line at the end of `## Items` of the inbox of a feature. An
 * absent inbox.md is made from the template with the feature name first
 * (section 12 rule 1). The write is a temporary file renamed over the
 * target, so a reader never sees half a file. Every other line stays.
 *
 * @param {StepRun} run
 * @param {string} feature
 * @param {string} line
 * @returns {{ ok: true, created: boolean } | { ok: false, detail: string[] }}
 */
function appendInbox(run, feature, line) {
  const rel = `docs/features/${feature}/inbox.md`;
  const file = path.join(run.projectRoot, ...rel.split('/'));
  /** @type {string | null} */
  let text = null;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err)?.code !== 'ENOENT') {
      return { ok: false, detail: [`${rel} cannot be read: ${err instanceof Error ? err.message : String(err)}`] };
    }
  }
  const created = text === null;
  const body = insertInboxLine(created ? inboxFromTemplate(readInboxTemplate(run), feature) : /** @type {string} */ (text), line);
  try {
    writeFileAtomic(file, body);
  } catch (err) {
    return { ok: false, detail: [`${rel} cannot be written: ${err instanceof Error ? err.message : String(err)}`] };
  }
  return { ok: true, created };
}

/**
 * The worker states of `worker-show` (normalizeWorker) whose tab has ended
 * its work: it reported (`done`), or it can take no more (`failed`,
 * `circuit`, `gone`). A note for such a tab goes to inbox.md, never to the
 * tab: a send to a settled worker makes Orca start a follow-up dispatch,
 * and the ask or close that waits on the old tab then closes the
 * follow-up while it works, so the line is worked twice or lost.
 */
const NOTE_SETTLED = new Set(['done', 'failed', 'circuit', 'gone']);

/**
 * `note`: pass a user message to the run (Decision 14). When the record
 * names a tab of the feature and that tab still works, the message goes to
 * it with `orchestration send --to dispatch:<id> --subject "User message
 * (<kind>)"`, and the body holds the text and the inbox instruction as one
 * argument. A follow-up dispatch id in the receipt replaces the active id
 * (fact O9), and the record marks it `noteFollowUp`, so a close does not
 * drop it while it works. A tab whose worker `worker-show` reads settled
 * (NOTE_SETTLED) gets no send. When no tab works, or Orca does not deliver
 * the send, the message becomes one line at the end of `## Items` of
 * inbox.md, in the shape of section 12 rule 2, so no message is lost.
 *
 * @param {StepRun} run
 * @returns {Record<string, any>}
 */
function stepNote(run) {
  const step = 'note';
  const checked = featureOf(run, step);
  if (!checked.ok) return checked.refusal;
  const feature = checked.path;
  const flag = String(run.values.kind);
  const kind = Object.prototype.hasOwnProperty.call(NOTE_KINDS, flag) ? NOTE_KINDS[/** @type {keyof typeof NOTE_KINDS} */ (flag)] : null;
  if (!kind) {
    return refusal(step, 'kind-not-supported', `"${flag}" is not a kind of note.`, [
      `"--kind" takes one of: ${Object.keys(NOTE_KINDS).join(', ')}.`,
    ], { feature });
  }
  const read = readTextFile(path.resolve(run.cwd, String(run.values['text-file'])), MAX_NOTE_BYTES);
  if (!read.ok) return refusal(step, `text-${read.code}`, `The text file ${read.say}.`, read.detail, { feature, kind });
  // A lane in a worktree keeps its record and its inbox there, so the main work tree stays untouched.
  const site = laneSite(run, feature);
  if (site.worktree) run = laneRun(run, site.worktree.path);

  const docs = readFeatureDocs(run.projectRoot, checked);
  if (!docs.exists || docs.isEpic) {
    return refusal(step, 'feature-missing', `The feature ${feature} does not exist.`, [
      `docs/features/${feature}/ is not a feature folder.`,
    ], { feature, kind });
  }

  const { record } = readRecord(run.projectRoot, feature);
  /** @type {string[]} */
  const detail = [];
  const active = record?.active;
  const worker = record && active ? normalizeWorker(orcaCall(run, orcaCalls.workerShow(active.dispatchId))) : null;
  const settled = Boolean(record && active && worker && NOTE_SETTLED.has(worker.state));
  if (settled && active && worker) {
    const tab = tabLabel(feature, active);
    detail.push(`${tab.charAt(0).toUpperCase()}${tab.slice(1)} has ended its work, so the message went into the inbox.`, ...worker.detail);
  } else if (record && active) {
    const tab = tabLabel(feature, active);
    const message = noteText({ feature, kind, text: read.text });
    const answer = orcaCall(run, orcaCalls.send({ dispatchId: active.dispatchId, subject: message.subject, body: message.body }));
    if (answer.kind === 'ok') {
      const followUp = followUpOf(active, answer.result);
      if (followUp) writeRecord(run.projectRoot, feature, { ...record, active: { ...active, ...followUp, noteFollowUp: { dispatchId: followUp.dispatchId, of: active.dispatchId } } });
      return success(step, `Sent the ${kind} to ${tab}.${followUp ? ` Orca started the follow-up dispatch ${followUp.dispatchId}.` : ''}`, {
        feature,
        kind,
        delivery: 'send',
        dispatchId: followUp?.dispatchId ?? active.dispatchId,
        followUp: followUp !== null,
        subject: message.subject,
      });
    }
    detail.push(`Orca did not deliver the message to ${tab}, so it went into the inbox.`, ...answer.detail);
  }

  const line = inboxLine(kind, run.now(), read.text);
  const written = appendInbox(run, feature, line);
  if (!written.ok) {
    return refusal(step, 'inbox-unwritable', `The inbox of ${feature} cannot take the line.`, [...detail, ...written.detail], {
      feature,
      kind,
    });
  }
  const inbox = `docs/features/${feature}/inbox.md`;
  const why = settled ? ' The tab has ended its work, so it got no send.' : detail.length > 0 ? ' Orca did not deliver it to the tab.' : '';
  return success(step, `Added the ${kind} line to ${inbox}${written.created ? ', a new file' : ''}.${why}`, {
    feature,
    kind,
    delivery: 'inbox',
    ...(settled ? { settled: true } : {}),
    line,
    created: written.created,
    ...(detail.length > 0 ? { detail } : {}),
  });
}

/**
 * `detect`: the facts that `/orca-setup` reads (setup.js). It writes
 * nothing, and it runs one Orca call: `status --json`.
 *
 * @param {StepRun} run
 * @returns {Record<string, any>}
 */
function stepDetect(run) {
  const facts = detect(run);
  const say =
    facts.offer === 'setup'
      ? 'The project has no valid orchestration settings. Run /orca-setup.'
      : facts.orca.found
        ? 'The orchestration settings are in place.'
        : 'The Orca CLI was not found.';
  return success('detect', say, facts);
}

/**
 * `config`: print the state of `.beast-mode/orca.json`. With `--write
 * <file>`, the file holds the one JSON object that becomes the
 * `orchestration` value, and the writer of setup.js sets it. A refusal
 * leaves the settings file as it was.
 *
 * @param {StepRun} run
 * @returns {Record<string, any>}
 */
function stepConfig(run) {
  const step = 'config';
  const file = run.values.write;
  if (file === undefined) {
    const facts = readConfigFacts(run.projectRoot);
    return success(step, `${facts.file} is ${facts.state}.`, { written: false, ...facts });
  }

  const read = readTextFile(path.resolve(run.cwd, String(file)), MAX_REPLY_BYTES);
  if (!read.ok) return refusal(step, `write-file-${read.code}`, `The settings file ${read.say}.`, read.detail, { written: false });
  /** @type {unknown} */
  let value;
  try {
    value = JSON.parse(read.text);
  } catch (err) {
    return refusal(step, 'write-file-not-json', 'The settings file holds no valid JSON.', [err instanceof Error ? err.message : String(err)], {
      written: false,
    });
  }
  if (!isPlainObject(value)) {
    return refusal(step, 'write-file-not-object', 'The settings file must hold one JSON object.', [], { written: false });
  }

  const answer = writeOrchestration(run.projectRoot, value);
  if (!answer.ok) {
    return refusal(step, answer.code, answer.say, answer.detail, { written: false, problems: answer.problems });
  }
  const facts = readConfigFacts(run.projectRoot);
  return success(step, `${answer.replaced ? 'Replaced' : 'Added'} the orchestration settings in ${answer.file}${answer.created ? ', a new file' : ''}.`, {
    written: true,
    created: answer.created,
    replaced: answer.replaced,
    ...facts,
  });
}

// ---------------------------------------------------------------------------
// The epic run (Phase 5): `next --epic`, `branch --epic`, the epic docs tab,
// the feature-end commit, and `merge`
// ---------------------------------------------------------------------------

/**
 * @typedef {import('./read.js').RunKeys} RunKeys
 * @typedef {{ branch: string, branchExists: boolean, held: boolean, keys: RunKeys, subjects: string[], worktree: import('./decide.js').LaneTree | null }} LaneGit
 */

/**
 * @param {string} featurePath `<epic>/<feature>`.
 * @returns {LaneGit} The git facts of a lane with no branch.
 */
function emptyLane(featurePath) {
  return { branch: runBranchOf(featurePath), branchExists: false, held: false, keys: { ...NO_KEYS }, subjects: [], worktree: null };
}

/**
 * Read the facts of a lane worktree inside it, with `git -C <worktree>`:
 * HEAD, the dirty files, and the subjects since the base of the lane. It
 * also checks that the worktree holds `.beast-mode/phase-handoff.md`. A
 * failed read lands in `error`, and only the lane stops for it.
 *
 * @param {StepRun} run The main run.
 * @param {string} tree The absolute path of the worktree.
 * @param {string} base The base of the lane branch.
 * @returns {{ tree: import('./decide.js').LaneTree, subjects: string[] }}
 */
function readLaneTree(run, tree, base) {
  const lrun = laneRun(run, tree);
  /** @type {import('./decide.js').LaneTree} */
  const facts = { path: tree, head: null, dirty: [], handoff: hasHandoff(tree), error: null };
  const head = gitCall(lrun, gitCalls.head());
  facts.head = head.ok ? head.stdout.trim() || null : null;
  const status = gitCall(lrun, gitCalls.status());
  if (!status.ok) {
    facts.error = status.detail;
    return { tree: facts, subjects: [] };
  }
  facts.dirty = parsePorcelain(status.stdout);
  let log = gitCall(lrun, gitCalls.logSince(base));
  if (!log.ok) {
    // The base is gone. The whole history of HEAD stands in for it.
    log = gitCall(lrun, gitCalls.logAll());
    if (!log.ok) {
      facts.error = log.detail;
      return { tree: facts, subjects: [] };
    }
  }
  const subjects = log.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return { tree: facts, subjects };
}

/**
 * Read the git facts of an epic run: HEAD, the default branch, the epic
 * branch and its base key, each lane branch with its keys and whether the
 * epic branch holds it, the dirty files, and the subjects of the lane
 * branch that HEAD is on. The branch of a lane is the one that its keys
 * name, else `feat/<epic>/<feature>`. A lane branch that a child worktree
 * holds (`git worktree list --porcelain`) reads its HEAD, dirty files, and
 * subjects inside that worktree. Reads only.
 *
 * @param {StepRun} run
 * @param {string} epic A checked epic name.
 * @param {string[]} names The feature folders to read.
 * @returns {{ git: import('./decide.js').EpicGitFacts, lanes: Map<string, LaneGit> }}
 */
function readEpicGitFacts(run, epic, names) {
  /** @type {import('./decide.js').EpicGitFacts} */
  const git = { workTree: false, detail: [], error: null, head: null, defaultBranch: null, epicBranchExists: false, epicBase: null, dirty: [], epicHandoff: false };
  /** @type {Map<string, LaneGit>} */
  const lanes = new Map(names.map((name) => [name, emptyLane(`${epic}/${name}`)]));
  /** @param {GitAnswer} answer */
  const failed = (answer) => {
    git.error = answer.detail;
    return { git, lanes };
  };

  const inside = gitCall(run, gitCalls.insideWorkTree());
  if (!inside.ok || inside.stdout.trim() !== 'true') {
    git.detail = [
      `${run.projectRoot} is not inside a git work tree.`,
      ...(inside.ok ? [`git rev-parse --is-inside-work-tree printed "${inside.stdout.trim()}".`] : inside.detail),
    ];
    return { git, lanes };
  }
  git.workTree = true;
  const head = gitCall(run, gitCalls.head());
  git.head = head.ok ? head.stdout.trim() || null : null;
  git.defaultBranch = readDefaultBranch(run);

  const refs = gitCall(run, gitCalls.epicRefs(epic));
  if (!refs.ok) return failed(refs);
  const branches = new Set(
    refs.stdout
      .split('\n')
      .map((line) => line.trim().replace(/^refs\/heads\//, ''))
      .filter((line) => line.length > 0)
  );
  const into = epicBranchOf(epic);
  git.epicBranchExists = branches.has(into);

  // Exit 1 means that no branch holds a beast-mode key.
  const keys = gitCall(run, gitCalls.runKeys());
  if (!keys.ok && keys.status !== 1) return failed(keys);
  const byBranch = parseRunKeys(keys.ok ? keys.stdout : '');
  git.epicBase = byBranch.get(into)?.base ?? null;
  const list = gitCall(run, gitCalls.worktreeList());
  if (!list.ok) return failed(list);
  const trees = parseWorktreeList(list.stdout);

  for (const [name, lane] of lanes) {
    const featurePath = `${epic}/${name}`;
    const keyed = laneBranchOf(byBranch, epic, featurePath, trees, run.projectRoot);
    const branch = keyed ?? runBranchOf(featurePath);
    lane.branch = branch;
    // A branch that Orca named lies outside feat/<epic>/, so its own read proves it.
    lane.branchExists = branches.has(branch) || (keyed !== null && gitCall(run, gitCalls.verifyBranch(keyed)).ok);
    lane.keys = { ...NO_KEYS, ...byBranch.get(branch) };
    if (lane.branchExists && git.epicBranchExists) {
      const held = gitCall(run, gitCalls.isAncestor(branch, into));
      if (!held.ok && held.status !== 1) return failed(held);
      lane.held = held.ok;
    }
    const tree = lane.branchExists ? laneWorktree(trees, branch, run.projectRoot) : null;
    if (tree) {
      const read = readLaneTree(run, tree.path, lane.keys.base ?? into);
      lane.worktree = read.tree;
      lane.subjects = read.subjects;
    }
  }

  const status = gitCall(run, gitCalls.status());
  if (!status.ok) return failed(status);
  git.dirty = parsePorcelain(status.stdout);
  if (git.epicBranchExists) git.epicHandoff = gitCall(run, gitCalls.treeHas(`refs/heads/${into}`, HANDOFF_REL)).ok;

  for (const lane of lanes.values()) {
    if (lane.worktree || git.head !== lane.branch) continue;
    let log = gitCall(run, gitCalls.logSince(lane.keys.base ?? into));
    if (!log.ok) {
      // The base is gone. The whole history of HEAD stands in for it.
      log = gitCall(run, gitCalls.logAll());
      if (!log.ok) return failed(log);
    }
    lane.subjects = log.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }
  return { git, lanes };
}

/**
 * @param {StepRun} run
 * @param {string} step
 * @returns {{ ok: true, name: string } | { ok: false, refusal: Record<string, any> }}
 */
function epicOf(run, step) {
  const checked = checkEpicName(run.values.epic);
  if (checked.ok) return checked;
  return { ok: false, refusal: refusal(step, 'epic-missing', 'The epic reference is not valid.', [checked.reason]) };
}

/**
 * @param {string} step
 * @param {import('./decide.js').EpicGitFacts} git
 * @returns {Record<string, any> | null}
 */
function gitRefusal(step, git) {
  if (!git.workTree) return refusal(step, 'not-git', 'The project is not a git work tree.', git.detail);
  if (git.error) return refusal(step, 'git-failed', 'A git read failed.', git.error);
  if (!git.defaultBranch) {
    return refusal(step, 'no-default-branch', 'The project has no default branch.', [
      'origin/HEAD names no branch, and no main or master branch exists.',
    ]);
  }
  return null;
}

/**
 * Record a git write of the epic branch that failed in the epic record, so
 * the next call stops instead of repeating it.
 *
 * @param {StepRun} run
 * @param {string} epic
 * @param {{ step: string, code: string, say: string, detail: string[] }} failure
 * @returns {Record<string, any>}
 */
function epicGitFailed(run, epic, { step, code, say, detail }) {
  const lines = [...detail];
  try {
    const { record, note } = readEpicRecord(run.projectRoot, epic);
    // A record that cannot be read keeps its bytes: a new record in its place would lose the active dispatch (CR-1).
    if (note) {
      lines.push(note);
      return refusal(step, code, say, lines, { epic });
    }
    writeEpicRecord(run.projectRoot, epic, {
      ...(record ?? newEpicRecord(epic)),
      failedGit: { step, phase: null, point: null, code, at: run.now().toISOString(), detail },
    });
  } catch (err) {
    lines.push(`The epic record cannot be written: ${err instanceof Error ? err.message : String(err)}`);
  }
  return refusal(step, code, say, lines, { epic });
}

/**
 * @param {StepRun} run
 * @param {string} epic
 * @param {string} step
 * @returns {void}
 */
function clearEpicGitFailure(run, epic, step) {
  const { record } = readEpicRecord(run.projectRoot, epic);
  if (record?.failedGit?.step !== step) return;
  writeEpicRecord(run.projectRoot, epic, { ...record, failedGit: null });
}

/**
 * @param {StepRun} run
 * @returns {import('./decide.js').EpicFacts}
 */
function gatherEpicFacts(run) {
  const { values, projectRoot, env } = run;
  const checked = checkEpicName(values.epic);
  const epic = checked.ok ? checked.name : String(values.epic);
  const handle = env.ORCA_TERMINAL_HANDLE;
  const epicDocs = readEpicDocs(projectRoot, checked);
  const names = epicDocs.isEpic ? epicDocs.folders : [];
  // A reference that fails the check names no git ref, so no git read runs for it (rule E7 stops first).
  const { git, lanes } = checked.ok
    ? readEpicGitFacts(run, epic, names)
    : {
        git: { workTree: false, detail: ['The epic reference is not valid.'], error: null, head: null, defaultBranch: null, epicBranchExists: false, epicBase: null, dirty: [], epicHandoff: false },
        lanes: new Map(),
      };
  const features = names.map((name) => {
    const featurePath = `${epic}/${name}`;
    const lane = lanes.get(name) ?? emptyLane(featurePath);
    // A lane in a worktree keeps its docs and its record there until its merge.
    const root = lane.worktree?.path ?? projectRoot;
    return {
      name,
      path: featurePath,
      docs: readFeatureDocs(root, checkFeaturePath(featurePath)),
      record: readRecord(root, featurePath),
      ...lane,
    };
  });
  return {
    epic,
    flags: {
      fresh: values.fresh === true,
      wake: typeof values.wake === 'string' && values.wake ? values.wake : null,
      dispatch: typeof values.dispatch === 'string' && values.dispatch ? values.dispatch : null,
      stopReason: typeof values['stop-reason'] === 'string' && values['stop-reason'] ? values['stop-reason'] : null,
      stop: values.stop === true,
      acceptDirty: values['accept-dirty'] === true,
    },
    terminalHandle: typeof handle === 'string' && handle.length > 0 ? handle : null,
    config: readOrcaConfig(projectRoot),
    harnesses: installedHarnesses(projectRoot),
    git,
    epicDocs,
    features,
    record: checked.ok ? readEpicRecord(projectRoot, epic) : { record: null, note: null },
    orcaStatus: null,
    workers: {},
  };
}

/**
 * `next --epic <epic>`: read the facts of the epic run, decide, and print
 * one action. Writes nothing. The Orca reads run only after the checks that
 * need no Orca call pass: `status` on a fresh call, and `worker-show` for
 * the tab of the lane and the epic docs tab.
 *
 * @param {StepRun} run
 * @returns {Record<string, any>}
 */
function stepNextEpic(run) {
  const facts = gatherEpicFacts(run);
  if (epicSetupStop(facts) === null) {
    if (facts.flags.fresh) facts.orcaStatus = readOrcaStatus(run);
    // Every lane of the current group, so a side-by-side group sees each of its tabs.
    const { lanes } = epicPlan(facts);
    const actives = [...lanes.map((entry) => entry.record.record?.active), facts.record.record?.active].filter(Boolean);
    facts.flags.mailWakes = readLostWakes(run, facts.flags, actives);
    for (const active of actives) {
      if (active && !facts.workers[active.dispatchId]) {
        facts.workers[active.dispatchId] = readWorker(run, facts.flags, facts.config, active, run.projectRoot);
      }
    }
  }
  return renderAction(decideEpic(facts), run.cli);
}

/**
 * `branch --epic <epic> --feature <epic>/<feature>`: switch to the lane
 * branch, or create it from `epic/<epic>`. It sets the three keys of a lane
 * branch: the base (when it is not set), the epic, and the feature. A lane
 * branch that another run made, and that the epic branch does not hold,
 * refuses.
 *
 * @param {StepRun} run
 * @param {string} epic
 * @returns {Record<string, any>}
 */
function laneBranchStep(run, epic) {
  const step = 'branch';
  const checked = featureOf(run, step);
  if (!checked.ok) return checked.refusal;
  const feature = checked.path;
  const name = checked.segments[1];
  const docs = readFeatureDocs(run.projectRoot, checked);
  if (!docs.exists || docs.isEpic) {
    return refusal(step, 'feature-missing', `The feature ${feature} does not exist.`, [`docs/features/${feature}/ is not a feature folder.`], {
      epic,
      feature,
    });
  }
  const into = epicBranchOf(epic);
  const { git, lanes } = readEpicGitFacts(run, epic, [name]);
  const broken = gitRefusal(step, git);
  if (broken) return broken;
  if (!git.epicBranchExists) {
    return refusal(step, 'epic-branch-missing', `The branch ${into} does not exist.`, [
      'A lane branch starts from the epic branch. Run the next step, and it makes the epic branch first.',
    ], { epic, feature });
  }
  const lane = lanes.get(name) ?? emptyLane(feature);
  const { branch } = lane;
  if (lane.branchExists && lane.keys.epic !== epic && !lane.held) {
    return refusal(step, 'branch-foreign', `The branch ${branch} was not made by this run, and ${into} does not hold it.`, [
      `${branch} holds no beast-mode-epic key of ${epic}.`,
    ], { epic, feature });
  }

  const created = !lane.branchExists;
  const base = created ? into : (lane.keys.base ?? into);
  const already = git.head === branch;
  if (!already) {
    if (git.dirty.length > 0) {
      return refusal(step, 'dirty-tree', `The work tree has changes, so the run cannot switch to ${branch}.`, git.dirty.slice(0, 20), {
        epic,
        feature,
      });
    }
    const switched = gitCall(run, created ? gitCalls.switchCreate(branch, into) : gitCalls.switchTo(branch));
    if (!switched.ok) {
      return gitWriteFailed(run, feature, { step, phase: null, code: 'git-failed', say: `The switch to ${branch} failed.`, detail: switched.detail });
    }
  }

  /** @type {string[]} */
  const notes = [];
  /** @type {['base' | 'epic' | 'feature', string][]} */
  const wanted = [
    ['base', base],
    ['epic', epic],
    ['feature', feature],
  ];
  for (const [key, value] of wanted) {
    if (lane.keys[key] === value) continue;
    const configured = gitCall(run, key === 'base' ? gitCalls.setBase(branch, value) : gitCalls.setKey(branch, key, value));
    if (!configured.ok) notes.push(...configured.detail);
  }
  clearGitFailure(run, feature, step);
  const say = already
    ? `The work tree is already on ${branch}.`
    : created
      ? `Created the lane branch ${branch} from ${into}.`
      : `Switched to the lane branch ${branch}.`;
  return success(step, notes.length > 0 ? `${say} A lane key was not set.` : say, {
    epic,
    feature,
    branch,
    base,
    created: !already && created,
    ...(notes.length > 0 ? { detail: notes } : {}),
  });
}

/**
 * `branch --epic <epic>`: switch to `epic/<epic>`, or create it from the
 * default branch, and set its base key. With `--feature`, the lane branch.
 * A dirty tree refuses. A failed switch records the failure in the epic
 * record.
 *
 * @param {StepRun} run
 * @returns {Record<string, any>}
 */
function stepBranchEpic(run) {
  const step = 'branch';
  const checked = epicOf(run, step);
  if (!checked.ok) return checked.refusal;
  const epic = checked.name;
  if (run.values.feature !== undefined) return laneBranchStep(run, epic);

  const docs = readEpicDocs(run.projectRoot, checked);
  if (!docs.exists || !docs.isEpic) {
    return refusal(step, 'not-an-epic', `${epic} is not an epic.`, [`docs/features/${epic}/ holds no epic-overview.md.`], { epic });
  }
  const branch = epicBranchOf(epic);
  const { git } = readEpicGitFacts(run, epic, []);
  const broken = gitRefusal(step, git);
  if (broken) return broken;
  if (git.head === branch) {
    clearEpicGitFailure(run, epic, step);
    return success(step, `The work tree is already on ${branch}.`, {
      epic,
      feature: null,
      branch,
      base: git.epicBase ?? git.defaultBranch,
      created: false,
    });
  }
  if (git.dirty.length > 0) {
    return refusal(step, 'dirty-tree', `The work tree has changes, so the run cannot switch to ${branch}.`, git.dirty.slice(0, 20), { epic });
  }

  const created = !git.epicBranchExists;
  // A new epic branch always starts from the default branch.
  const base = /** @type {string} */ (created ? git.defaultBranch : (git.epicBase ?? git.defaultBranch));
  const switched = gitCall(run, created ? gitCalls.switchCreate(branch, base) : gitCalls.switchTo(branch));
  if (!switched.ok) return epicGitFailed(run, epic, { step, code: 'git-failed', say: `The switch to ${branch} failed.`, detail: switched.detail });

  /** @type {string[]} */
  const notes = [];
  if (!git.epicBase) {
    const configured = gitCall(run, gitCalls.setBase(branch, base));
    if (!configured.ok) notes.push(...configured.detail);
  }
  clearEpicGitFailure(run, epic, step);
  const say = created ? `Created the branch ${branch} from ${base}.` : `Switched to the branch ${branch}.`;
  return success(step, notes.length > 0 ? `${say} The base key was not set.` : say, {
    epic,
    feature: null,
    branch,
    base,
    created,
    ...(notes.length > 0 ? { detail: notes } : {}),
  });
}

/**
 * The agent, the spec, and the label of one stage of the epic tab: the epic
 * docs tab on `stages.docs`, or one step tab with `after: "epic"` on the
 * agent of its line. The guards of the stage run here.
 *
 * @param {string} step
 * @param {string} stage
 * @param {{ epic: string, orchestration: any, record: Record<string, any> | null, stepIndex: number }} ctx
 * @returns {{ refusal: Record<string, any> } | { refusal: null, agent: string, specRel: string, spec: string, label: string, stepInfo: { index: number, point: string, command: string, verdictRel: string } | null }}
 */
function epicStagePlan(step, stage, { epic, orchestration, record, stepIndex }) {
  if (stage !== 'step') {
    return {
      refusal: null,
      agent: orchestration.stages.docs,
      specRel: `.beast-mode/briefs/${epic}/orca-epic-docs.md`,
      spec: epicDocsSpec({ epic }),
      label: 'the epic docs tab',
      stepInfo: null,
    };
  }
  const line = Array.isArray(orchestration.steps) ? orchestration.steps[stepIndex] : undefined;
  if (!isPlainObject(line)) {
    return {
      refusal: refusal(step, 'step-missing', `orchestration.steps holds no line ${stepIndex}.`, [
        `.beast-mode/orca.json holds ${Array.isArray(orchestration.steps) ? orchestration.steps.length : 0} step lines.`,
      ]),
    };
  }
  if (line.after !== 'epic') {
    return {
      refusal: refusal(step, 'step-not-epic', `The step ${stepIndex} does not run after the epic.`, [
        `Its "after" is "${String(line.after)}". An epic step tab runs the lines with "after": "epic".`,
      ]),
    };
  }
  if (record?.done?.steps?.[stepKey('epic', stepIndex)]) {
    return {
      refusal: refusal(step, 'step-done', `The step ${stepIndex} of ${epic} already ran.`, [
        `The epic record marks ${stepKey('epic', stepIndex)} done.`,
      ]),
    };
  }
  const command = fillStepTokens(line.command, { epic, feature: null, phase: null });
  const verdictRel = `.beast-mode/briefs/${epic}/${stepVerdictName('epic', stepIndex)}`;
  return {
    refusal: null,
    agent: line.agent,
    specRel: `.beast-mode/briefs/${epic}/${stepSpecName('epic', stepIndex)}`,
    spec: stepSpec({ target: epic, epic: null, point: 'epic', command, verdictFile: verdictRel }),
    label: 'the step tab',
    stepInfo: { index: stepIndex, point: 'epic', command, verdictRel },
  };
}

/**
 * `start --epic <epic> --stage epic-docs`: the epic docs tab, in the main
 * workspace on `epic/<epic>`, on `stages.docs`. `--stage step --step <k>`
 * starts one step tab of a line with `after: "epic"`, in the same place, on
 * the agent of the line. Its record is the epic record. `--retry` retries a failed start on the same Orca Task, by the
 * rules of `start`.
 *
 * @param {StepRun} run
 * @returns {Record<string, any>}
 */
function stepStartEpic(run) {
  const step = 'start';
  const checked = epicOf(run, step);
  if (!checked.ok) return checked.refusal;
  const epic = checked.name;
  const stage = run.values.stage ?? 'phase';
  if (!EPIC_START_STAGES.includes(stage)) {
    return refusal(step, 'stage-not-supported', `This version does not start the ${stage} stage of an epic.`, [
      `"--stage ${stage}" with "--epic" and no "--feature" names no epic stage. It runs: ${EPIC_START_STAGES.join(', ')}.`,
      'A lane stage takes "--feature <epic>/<feature>" too.',
    ]);
  }
  const retry = run.values.retry === true;

  const { record, note } = readEpicRecord(run.projectRoot, epic);
  if (note) return recordUnreadable(step, epic, note, { epic, feature: null, stage });
  if (record?.active) {
    return refusal(step, 'tab-active', `A tab of ${epic} still runs.`, [
      `The epic record holds the dispatch ${record.active.dispatchId} of the ${record.active.stage} stage.`,
    ]);
  }
  const failed = record?.failedStart ?? null;
  if (retry) {
    const refused = retryRefusal(step, epic, failed, stage, null, stepOfStart(run, stage));
    if (refused) return refused;
  } else if (failed) {
    return refusal(step, 'start-failed', `The last start of ${epic} failed.`, [
      'Retry it with "start --retry", or run the close step to clear the failed start.',
    ]);
  }
  if (record?.done?.docs === true) {
    return refusal(step, 'docs-done', `The epic docs of ${epic} are already done.`, ['The epic record marks the epic docs tab done.']);
  }

  const config = readOrcaConfig(run.projectRoot);
  const refused = configRefusal(step, config);
  if (refused) return refused;
  const orchestration = /** @type {any} */ (config).orchestration;
  const docs = readEpicDocs(run.projectRoot, checked);
  if (!docs.exists || !docs.isEpic) {
    return refusal(step, 'not-an-epic', `${epic} is not an epic.`, [`docs/features/${epic}/ holds no epic-overview.md.`]);
  }
  const work = epicStagePlan(step, stage, { epic, orchestration, record, stepIndex: Number(run.values.step) });
  if (work.refusal) return work.refusal;
  const { agent, specRel, spec, label, stepInfo } = work;
  const branch = epicBranchOf(epic);
  const head = gitCall(run, gitCalls.head());
  if (!head.ok || head.stdout.trim() !== branch) {
    return refusal(step, 'not-run-branch', `The work tree is not on ${branch}.`, [head.ok ? `HEAD is ${head.stdout.trim()}.` : 'HEAD names no branch.']);
  }

  // A step tab starts with no verdict: the file of an earlier tab of the same point never counts.
  if (stepInfo) fs.rmSync(path.join(run.projectRoot, ...stepInfo.verdictRel.split('/')), { force: true });
  const command = projectCommandOf(config, agent);
  const startedAt = run.now().toISOString();
  const base = record ?? newEpicRecord(epic);
  const where = { stage, phase: null, ...(stepInfo ? { step: stepInfo.index } : {}), agent, at: startedAt };
  const specFile = retry ? null : writeSpec(run.projectRoot, specRel, spec);
  const title = taskTitleOf({ feature: epic, stage: stepInfo ? 'step' : 'epic-docs', command: stepInfo?.command ?? null });
  // The start entry goes in before the first Orca call, so a lost answer never reads as no tab (CR-2).
  writeEpicRecord(run.projectRoot, epic, { ...base, active: null, failedStart: pendingStart(where, retry ? failed : null) });
  /** @type {CommandLaunch | null} */
  let launched = null;
  let answer;
  if (command) {
    launched = commandStart(run, { command, selector: CURRENT_WORKTREE, specFile, retry: retry ? failed : null, title });
    answer = launched.answer;
  } else if (retry) {
    const previous = /** @type {Record<string, any>} */ (failed);
    answer = orcaCall(run, orcaCalls.workerRetry({ taskId: previous.taskId, retryOf: previous.dispatchId, agent }));
  } else {
    answer = orcaCall(run, orcaCalls.workerStart({ specFile: /** @type {string} */ (specFile), agent, title }));
  }

  const result = isPlainObject(answer.result) ? answer.result : {};
  const launch = launchOf(command, launched);
  if (answer.kind === 'ok' && typeof result.dispatchId === 'string' && result.dispatchId.length > 0) {
    const active = {
      stage,
      phase: null,
      step: stepInfo?.index ?? null,
      ...(stepInfo ? { point: stepInfo.point, stepCommand: stepInfo.command, verdictFile: stepInfo.verdictRel } : {}),
      round: 0,
      agent,
      placement: 'current',
      ...launch.record,
      review: false,
      spec: specRel,
      dispatchId: result.dispatchId,
      taskId: textOf(result.taskId) ?? (retry ? textOf(failed?.taskId) : null),
      runId: textOf(result.runId),
      startedAt,
      sendBacks: 0,
      escalations: 0,
    };
    try {
      writeEpicRecord(run.projectRoot, epic, { ...base, active, failedStart: null });
    } catch (err) {
      return recordUnwritable(step, err, {
        started: true,
        dispatchId: active.dispatchId,
        taskId: active.taskId,
        agent,
        extra: { epic, feature: null, stage, phase: null, placement: 'current', ...launch.fields, retry },
      });
    }
    // The record holds the dispatch, so the submit loop of a dsh tab runs now (fix 1).
    const submitted = submitPrompt(run, { agent, dispatchId: active.dispatchId, terminal: launched?.terminal ?? receiptTerminal(result) });
    const titled = renameTab(run, launched?.terminal ?? receiptTerminal(result) ?? submitted?.terminal, title);
    return withSubmit(
      success(step, `${retry ? 'Retried' : 'Started'} ${label} of ${epic} on ${agent}${launch.how}.${launch.note}`, {
        epic,
        feature: null,
        stage,
        phase: null,
        agent,
        placement: 'current',
        ...launch.fields,
        dispatchId: active.dispatchId,
        taskId: active.taskId,
        runId: active.runId,
        spec: specRel,
        retry,
        ...(retry ? { retryOf: failed?.dispatchId ?? null } : {}),
      }),
      submitted,
      titled
    );
  }

  const entry = commandFailure(failedStartOf(answer, retry ? failed : null), command, launched);
  try {
    writeEpicRecord(run.projectRoot, epic, { ...base, active: null, failedStart: { ...where, ...entry } });
  } catch (err) {
    return recordUnwritable(step, err, {
      started: false,
      dispatchId: entry.dispatchId,
      taskId: entry.taskId,
      agent,
      detail: entry.detail,
      extra: { epic, feature: null, stage, phase: null, retry, count: entry.count, ...launch.fields },
    });
  }
  return refusal(step, 'start-failed', `${label.charAt(0).toUpperCase()}${label.slice(1)} of ${epic} did not ${retry ? 'start on the retry' : 'start'}.${hostHint(run, entry.detail)}`, entry.detail, {
    epic,
    feature: null,
    stage,
    phase: null,
    agent,
    retry,
    count: entry.count,
    ...launch.fields,
  });
}

/**
 * Release each dispatch once. A refused release never blocks the caller.
 *
 * @param {StepRun} run
 * @param {unknown[]} ids
 * @returns {Record<string, any>[]}
 */
function releaseDispatches(run, ids) {
  /** @type {string[]} */
  const unique = [];
  for (const id of ids) {
    if (typeof id === 'string' && id.length > 0 && !unique.includes(id)) unique.push(id);
  }
  return unique.map((id) => {
    const answer = orcaCall(run, orcaCalls.workerRelease(id));
    if (answer.kind === 'ok') {
      const state = isPlainObject(answer.result) && typeof answer.result.state === 'string' ? answer.result.state : 'unknown';
      return { dispatchId: id, ok: true, state, detail: [] };
    }
    return { dispatchId: id, ok: false, code: answer.code, detail: answer.detail };
  });
}

/**
 * Fix 10: stop each tab that `close --discard` drops and Orca did not
 * release. Orca releases only a settled worker, so it refuses the release
 * of a tab that has not reported (`dispatch_inactive`): a stalled tab, or a
 * tab whose turn ended on an error. That tab stays a live `dispatched`
 * worker with an open terminal and a mailbox, so a "continue" typed into
 * it, or its undelivered resume mail, starts it again beside the new tab of
 * the same work, on the same tree. `worker-stop` fences the dispatch and stops its agent terminal
 * and its helpers. A failed stop never fails the close: the say line names
 * the tab that still runs.
 *
 * @param {StepRun} run
 * @param {Record<string, any>[]} release The answers of the release.
 * @returns {Record<string, any>[]} The same entries; a refused one carries `stopped`, and `processAction` or
 *   `stopCode`.
 */
function stopUnreleased(run, release) {
  return release.map((entry) => {
    // Only a refusal as not settled names a live worker. A gone dispatch or an Orca that is down has none to stop.
    if (entry.ok || entry.code !== 'dispatch_inactive') return entry;
    const answer = orcaCall(run, orcaCalls.workerStop(entry.dispatchId));
    if (answer.kind === 'ok') {
      const action = isPlainObject(answer.result) && typeof answer.result.processAction === 'string' ? answer.result.processAction : 'unknown';
      return { ...entry, stopped: true, processAction: action };
    }
    return { ...entry, stopped: false, stopCode: answer.code, detail: [...(entry.detail ?? []), ...(answer.detail ?? [])] };
  });
}

/**
 * The say tail of a close for the release answers: empty, or a space and
 * the sentences. A tab that a discard did not stop still runs, so the tail
 * tells the coordinator to stop it in Orca (fix 10).
 *
 * @param {Record<string, any>[]} release
 * @param {boolean} discard
 * @returns {string}
 */
function releaseTail(release, discard) {
  const ids = (entries) => entries.map((entry) => entry.dispatchId).join(', ');
  const stopped = release.filter((entry) => !entry.ok && entry.stopped === true);
  const running = release.filter((entry) => (!entry.ok && entry.stopped !== true) || entry.state === 'retained');
  let tail = '';
  if (stopped.length > 0) tail += ` Orca did not release ${ids(stopped)}, so the close stopped it, and the record is clear.`;
  if (running.length > 0) {
    tail += ` Orca did not release ${ids(running)}, and the record is clear.`;
    if (discard && running.some((entry) => entry.stopped === false)) {
      tail += ' Its tab can still work: stop it in Orca before a new tab of the same work starts.';
    }
  }
  return tail;
}

/**
 * Close the terminal that our own command-path start opened (fix 3). Orca
 * does not own that terminal, so a release answers `retained` or
 * `already_released` and leaves the tab. The close and the merge are the
 * only callers: a start and a retry never close a terminal. A failed close
 * never fails the step.
 *
 * @param {StepRun} run
 * @param {Record<string, any> | null | undefined} active The record entry of the tab: it must hold `ownTerminal`.
 * @param {Record<string, any>[]} release The answers of releaseDispatches().
 * @returns {{ terminal: string, closed: boolean, detail: string[] } | null} Null when the record owns no terminal
 *   or Orca closed the tab with the release. A failed release gives `closed: false` and closes nothing.
 */
function closeOwnTerminal(run, active, release) {
  if (!isPlainObject(active) || active.ownTerminal !== true) return null;
  const terminal = textOf(active.terminal);
  if (!terminal) return null;
  const released = release.find((entry) => entry.dispatchId === active.dispatchId);
  if (!released) return null;
  // A failed release leaves the worker live, so the step closes no terminal and says the tab stays open (fix 5).
  // Fix 10: a stop of that worker fences it. Orca does not own this terminal, so the step closes it.
  if (!released.ok && released.stopped !== true) return { terminal, closed: false, detail: released.detail };
  if (released.stopped === true) {
    if (released.processAction === 'closed_agent_terminal') return null;
  } else if (released.state !== 'retained' && released.state !== 'already_released') return null;
  const answer = orcaCall(run, orcaCalls.terminalClose(terminal));
  return answer.kind === 'ok' ? { terminal, closed: true, detail: [] } : { terminal, closed: false, detail: answer.detail };
}

/**
 * The say sentence and the result fields of closeOwnTerminal(). Nothing for
 * a record that owns no terminal.
 *
 * @param {{ terminal: string, closed: boolean, detail: string[] } | null} own
 * @returns {{ say: string, fields: Record<string, any> }}
 */
function terminalCloseOf(own) {
  if (!own) return { say: '', fields: {} };
  return {
    say: own.closed ? '' : ` The tab ${own.terminal} stays open: close it in Orca.`,
    fields: { terminalClosed: own.closed },
  };
}

/**
 * `close --epic <epic>`: release the epic docs tab (and the dispatch of a
 * failed start), then clear both from the epic record. The close of the
 * epic docs tab marks the epic docs done. `--discard` marks nothing.
 *
 * @param {StepRun} run
 * @returns {Record<string, any>}
 */
function stepCloseEpic(run) {
  const step = 'close';
  const checked = epicOf(run, step);
  if (!checked.ok) return checked.refusal;
  const epic = checked.name;
  const discard = run.values.discard === true;

  const { record, note } = readEpicRecord(run.projectRoot, epic);
  // A record that cannot be read can name an open tab, so the close never reports that no tab is open (CR-1).
  if (note) return recordUnreadable(step, epic, note, { epic, feature: null });
  if (!record || (!record.active && !record.failedStart)) {
    return success(step, `No tab of ${epic} is open.`, { epic, feature: null, dispatchId: null, release: [] });
  }
  // The close of an epic step tab records its result, as the close of a feature step tab does.
  const stepResult = discard ? null : stepMarkOf(step, epic, record.active, readEpicDocs(run.projectRoot, checked).stepVerdicts, run.values.override === true, run.values.final === true);
  if (stepResult?.refusal) return stepResult.refusal;
  const released = releaseDispatches(run, [record.active?.dispatchId, record.failedStart?.dispatchId]);
  // Fix 10: a tab that --discard drops and Orca did not release still runs. Stop it.
  const release = discard ? stopUnreleased(run, released) : released;
  const own = terminalCloseOf(closeOwnTerminal(run, record.active, release));
  const docsDone = record.active?.stage === 'epic-docs' && !discard;
  writeEpicRecord(run.projectRoot, epic, {
    ...record,
    active: null,
    failedStart: null,
    ...(docsDone ? { done: { ...record.done, docs: true } } : {}),
    ...(stepResult?.mark ? { done: { ...record.done, steps: { ...record.done.steps, [stepResult.key]: stepResult.mark } } } : {}),
    ...(stepResult?.mark ? { stepRounds: stepRoundsAfter(record.stepRounds, stepResult) } : {}),
  });
  const tab = record.active ? `the ${record.active.stage} tab` : 'the failed start';
  const tail = releaseTail(release, discard);
  const marks = `${docsDone ? ' The epic docs are marked done.' : ''}${stepResult?.mark ? ` The step result is ${stepResult.mark}.` : ''}`;
  return success(step, `Closed ${tab} of ${epic}.${marks}${tail}${own.say}`, {
    epic,
    feature: null,
    dispatchId: record.active?.dispatchId ?? record.failedStart?.dispatchId ?? null,
    release,
    ...own.fields,
    discard,
    docsDone,
    stepResult: stepResult?.mark ? { key: stepResult.key, mark: stepResult.mark } : null,
  });
}

/**
 * `send --epic <epic> --reason <reason>`: one text to the epic docs tab, by
 * the rules of `send`. The epic docs tab has no open item, so `open-tasks`
 * refuses.
 *
 * @param {StepRun} run
 * @returns {Record<string, any>}
 */
function stepSendEpic(run) {
  const step = 'send';
  const checked = epicOf(run, step);
  if (!checked.ok) return checked.refusal;
  const epic = checked.name;
  const reason = String(run.values.reason);
  if (!SEND_REASONS.includes(reason)) {
    return refusal(step, 'reason-not-supported', `This version does not send the reason "${reason}".`, [
      `"--reason ${reason}" names no send. The reasons: ${SEND_REASONS.join(', ')}.`,
    ], { epic, reason });
  }
  const { record } = readEpicRecord(run.projectRoot, epic);
  const active = record?.active;
  if (!record || !active) {
    return refusal(step, 'no-tab', `No tab of ${epic} runs.`, ['The epic record holds no active dispatch.'], { epic, reason });
  }
  const tab = `the ${active.stage} tab of ${epic}`;
  const check = active.stage === 'epic-docs' ? doneCheck(epic, /** @type {any} */ (null), active) : null;
  if (reason === 'open-tasks') {
    return refusal(step, 'nothing-open', `The files of ${epic} show no open item for ${tab}.`, [
      check ? `${check.what.charAt(0).toUpperCase()}${check.what.slice(1)}.` : `The epic record names the stage "${active.stage}".`,
    ], { epic, reason });
  }
  if (reason === 'report' && check?.pass !== true) {
    return refusal(step, 'report-not-ready', `The done proof of ${tab} does not hold yet.`, [
      `The epic record names the stage "${active.stage}".`,
    ], { epic, reason });
  }

  const text = sendText({ label: `the ${active.stage} stage of ${epic}`, reason, open: [], spec: specOf(epic, active) });
  const answer = orcaCall(run, orcaCalls.send({ dispatchId: active.dispatchId, subject: text.subject, body: text.body }));
  if (answer.kind !== 'ok') {
    writeEpicRecord(run.projectRoot, epic, {
      ...record,
      active: { ...active, failedSend: { reason, code: answer.code, at: run.now().toISOString(), detail: answer.detail } },
    });
    return refusal(step, 'send-failed', `Orca did not deliver the send to ${tab}.`, answer.detail, {
      epic,
      reason,
      dispatchId: active.dispatchId,
      orcaCode: answer.code,
    });
  }
  const followUp = followUpOf(active, answer.result);
  const counted = sendCounts(active, reason, (check?.open ?? []).length);
  const { failedSend: _failedSend, ...kept } = active;
  writeEpicRecord(run.projectRoot, epic, { ...record, active: { ...kept, ...counted, ...(followUp ?? {}) } });
  const tail = followUp ? ` Orca started the follow-up dispatch ${followUp.dispatchId}.` : '';
  return success(step, `Sent ${SEND_SAY[/** @type {keyof typeof SEND_SAY} */ (reason)]} to ${tab}.${tail}`, {
    epic,
    feature: null,
    reason,
    dispatchId: followUp?.dispatchId ?? active.dispatchId,
    previousDispatchId: followUp ? active.dispatchId : null,
    followUp: followUp !== null,
    subject: text.subject,
    open: [],
  });
}

/**
 * `commit --feature <epic>/<feature> --epic <epic> --point feature`: the
 * feature-end commit of a lane, at any cadence (Decision 10), with the
 * subject `feat: <epic>/<feature>`. It needs every phase complete and the
 * docs tab done, and it runs only on the lane branch.
 *
 * @param {StepRun} run
 * @returns {Record<string, any>}
 */
function stepCommitFeature(run) {
  const step = 'commit';
  const checked = featureOf(run, step);
  if (!checked.ok) return checked.refusal;
  const feature = checked.path;
  if (checked.lane === null) {
    return refusal(step, 'point-not-supported', 'The feature-end commit runs in a lane of /orca-epic only.', [
      '"--point feature" needs "--epic <epic>".',
    ]);
  }
  const config = readOrcaConfig(run.projectRoot);
  const refused = configRefusal(step, config);
  if (refused) return refused;
  // A lane in a worktree commits there, with `git -C <worktree>`.
  const lane = laneOf(run, checked);
  run = lane.run;

  const working = activeRefusal(step, run, feature);
  if (working) return working;

  const docs = readFeatureDocs(run.projectRoot, checked);
  if (!allPhasesComplete(docs)) {
    return refusal(step, 'phase-incomplete', `A phase of ${feature} is not complete.`, [
      `docs/features/${feature}/tasks.md holds an open phase, or no phase.`,
    ]);
  }
  if (readRecord(run.projectRoot, feature).record?.done?.docs !== true) {
    return refusal(step, 'docs-open', `The docs tab of ${feature} has not run.`, ['The run record does not mark the docs tab done.']);
  }

  const branch = lane.branch;
  const facts = readGitFacts(run, branch);
  if (!facts.workTree) return refusal(step, 'not-git', 'The project is not a git work tree.', facts.detail);
  if (facts.error) return refusal(step, 'git-failed', 'A git read failed.', facts.error);
  if (facts.head !== branch || facts.head === facts.defaultBranch) {
    return refusal(step, 'not-run-branch', `The work tree is not on ${branch}.`, [facts.head ? `HEAD is ${facts.head}.` : 'HEAD names no branch.']);
  }
  if (facts.dirty.length === 0) {
    return refusal(step, 'nothing-to-commit', `The work tree holds no change for the end of ${feature}.`, [
      'git status shows no change outside .beast-mode/briefs/.',
    ]);
  }

  const subject = featureSubject(feature);
  const failure = { step, phase: null, point: 'feature', code: 'commit-failed', say: `The feature-end commit of ${feature} failed.` };
  const added = gitCall(run, gitCalls.addAll());
  if (!added.ok) return gitWriteFailed(run, feature, { ...failure, detail: added.detail });
  const committed = gitCall(run, gitCalls.commit(subject));
  if (!committed.ok) return gitWriteFailed(run, feature, { ...failure, detail: committed.detail });

  const sha = gitCall(run, gitCalls.revParseHead());
  clearGitFailure(run, feature, step);
  return success(step, `Committed the end of ${feature}${lane.tree ? ` in the worktree ${lane.tree}` : ''}.`, {
    feature,
    epic: checked.lane,
    point: 'feature',
    phase: null,
    subject,
    commit: sha.ok ? sha.stdout.trim() : null,
    ...(lane.tree ? { worktree: lane.tree, branch } : {}),
  });
}

/**
 * @param {StepRun} run
 * @param {string} name The file name under `.beast-mode/templates/`.
 * @returns {string | null} The template of the project, else the one of the plugin, else null.
 */
function readDevDocTemplate(run, name) {
  for (const file of [path.join(run.projectRoot, '.beast-mode', 'templates', name), path.join(run.pluginRoot, 'templates', 'dev-docs', name)]) {
    try {
      return fs.readFileSync(file, 'utf8');
    } catch {
      // The next place.
    }
  }
  return null;
}

/**
 * Append the open human tests of one feature under its `## <feature>`
 * section of the human-testing.md of the epic: append only, and no
 * repeated line. An absent file is made from the template. The write is a
 * temporary file renamed over the target.
 *
 * @param {StepRun} run
 * @param {string} epic
 * @param {string} name The feature folder name.
 * @param {string[]} tests The open lines of `## Needs Human Verification` in the context.md of the feature.
 * @returns {{ ok: true, added: string[], created: boolean } | { ok: false, detail: string[] }}
 */
function writeHumanTests(run, epic, name, tests) {
  const rel = `docs/features/${epic}/human-testing.md`;
  if (tests.length === 0) return { ok: true, added: [], created: false };
  const file = path.join(run.projectRoot, ...rel.split('/'));
  /** @type {string | null} */
  let text = null;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err)?.code !== 'ENOENT') {
      return { ok: false, detail: [`${rel} cannot be read: ${err instanceof Error ? err.message : String(err)}`] };
    }
  }
  const created = text === null;
  const start = created ? humanTestingFromTemplate(readDevDocTemplate(run, 'human-testing.md'), epic, inboxTime(run.now())) : /** @type {string} */ (text);
  const { text: body, added } = appendHumanTests(start, name, tests);
  if (added.length === 0) return { ok: true, added, created: false };
  try {
    writeFileAtomic(file, body);
  } catch (err) {
    return { ok: false, detail: [`${rel} cannot be written: ${err instanceof Error ? err.message : String(err)}`] };
  }
  return { ok: true, added, created };
}

/**
 * `merge --epic <epic> --feature <epic>/<feature>`: merge a lane into the
 * epic branch (Decision 10). It runs only on `epic/<epic>`: from the lane
 * branch it switches there first, any other branch refuses, and the
 * default branch always refuses. The merge is `--no-ff --no-edit` with the
 * subject `Merge <epic>/<feature> into epic/<epic>`, and the hooks of the
 * user run. A conflict runs `git merge --abort` and answers
 * `merge-conflict` with the conflict files. A success records
 * `beast-mode-merged`, appends the open human tests of the feature to
 * `human-testing.md`, and commits them as `docs: <epic>/<feature> human
 * testing`. A lane that is already merged writes and commits only the human
 * tests, so a fresh call repeats a failed human test commit safely.
 *
 * @param {StepRun} run
 * @returns {Record<string, any>}
 */
function stepMerge(run) {
  const step = 'merge';
  const checked = featureOf(run, step);
  if (!checked.ok) return checked.refusal;
  const feature = checked.path;
  const epic = /** @type {string} */ (checked.lane);
  const name = checked.segments[1];
  const into = epicBranchOf(epic);
  const humanRel = `docs/features/${epic}/human-testing.md`;

  const docs = readFeatureDocs(run.projectRoot, checked);
  const { git, lanes } = readEpicGitFacts(run, epic, [name]);
  const lane = lanes.get(name) ?? emptyLane(feature);
  const { branch } = lane;
  const names = { epic, feature, from: branch, into };
  // A lane in a worktree merges from the epic branch of the main workspace, and its records stay in its worktree.
  const tree = lane.worktree;
  const recordRun = tree ? laneRun(run, tree.path) : run;
  if (!docs.exists || docs.isEpic) {
    return refusal(step, 'feature-missing', `The feature ${feature} does not exist.`, [`docs/features/${feature}/ is not a feature folder.`], names);
  }
  const broken = gitRefusal(step, git);
  if (broken) return { ...broken, ...names };
  if (git.head === git.defaultBranch || into === git.defaultBranch) {
    return refusal(step, 'default-branch', `The run never merges into the default branch ${git.defaultBranch}.`, [
      git.head === git.defaultBranch ? `HEAD is ${git.head}, the default branch.` : `${into} is the default branch.`,
    ], names);
  }
  if (git.head !== into && (tree || git.head !== branch)) {
    return refusal(step, 'not-run-branch', tree ? `The work tree is not on ${into}.` : `The work tree is on neither ${into} nor ${branch}.`, [
      git.head ? `HEAD is ${git.head}.` : 'HEAD names no branch.',
    ], names);
  }
  if (!git.epicBranchExists) {
    return refusal(step, 'epic-branch-missing', `The branch ${into} does not exist.`, ['The epic run makes the epic branch first.'], names);
  }
  if (!lane.branchExists) {
    return refusal(step, 'branch-missing', `The lane branch ${branch} does not exist.`, ['The lane has no branch to merge.'], names);
  }
  const merged = Boolean(lane.keys.merged) && lane.held;
  // A lane that is not merged yet merges only while no tab works in it. A stale line must never take the work of a running tab.
  const working = merged ? null : activeRefusal(step, recordRun, feature, names);
  if (working) return working;
  // After the merge, only a human-testing.md that the last call did not commit may stay dirty.
  const dirty = merged ? git.dirty.filter((file) => file !== humanRel) : git.dirty;
  if (dirty.length > 0) {
    return refusal(step, 'dirty-tree', `The work tree has changes, so the run cannot merge ${feature}.`, dirty.slice(0, 20), names);
  }
  if (tree && !merged && (tree.error || tree.dirty.length > 0)) {
    return refusal(step, 'dirty-tree', `The worktree ${tree.path} of ${feature} has changes, so the run cannot merge it.`, tree.error ?? tree.dirty.slice(0, 20), {
      ...names,
      worktree: tree.path,
    });
  }

  if (!tree && git.head === branch) {
    const switched = gitCall(run, gitCalls.switchTo(into));
    if (!switched.ok) {
      const failure = { step, phase: null, point: 'merge', code: 'git-failed', say: `The switch to ${into} failed.`, detail: switched.detail };
      return { ...gitWriteFailed(run, feature, failure), ...names };
    }
  }
  const head = gitCall(run, gitCalls.head());
  const now = head.ok ? head.stdout.trim() : '';
  if (now !== into || now === git.defaultBranch) {
    return refusal(step, 'not-run-branch', `The work tree is not on ${into}.`, [now ? `HEAD is ${now}.` : 'HEAD names no branch.'], names);
  }

  /** @type {string[]} */
  const notes = [];
  let commit = lane.keys.merged;
  if (!merged) {
    const result = gitCall(run, gitCalls.merge(mergeSubject(feature, epic), branch));
    if (!result.ok) {
      const conflicts = gitCall(run, gitCalls.conflicts());
      const files = conflicts.ok ? conflicts.stdout.split('\n').map((line) => line.trim()).filter((line) => line.length > 0) : [];
      const detail = [...files.map((file) => `Conflict: ${file}`), ...result.detail];
      if (gitCall(run, gitCalls.mergeHead()).ok) {
        const aborted = gitCall(run, gitCalls.mergeAbort());
        if (!aborted.ok) detail.push('git merge --abort failed, so the merge still waits in the work tree.', ...aborted.detail);
      }
      const conflict = files.length > 0;
      const failure = {
        step,
        phase: null,
        point: 'merge',
        code: conflict ? 'merge-conflict' : 'merge-failed',
        say: conflict ? `The merge of ${feature} into ${into} hit a conflict, so the run aborted it.` : `The merge of ${feature} into ${into} failed.`,
        detail: detail.slice(0, MAX_OUTPUT_LINES),
      };
      // A worktree stays after a failed merge, with the work of the lane in it.
      return { ...gitWriteFailed(recordRun, feature, failure), ...names, files, ...(tree ? { worktree: tree.path } : {}) };
    }
    const sha = gitCall(run, gitCalls.revParseHead());
    commit = sha.ok ? sha.stdout.trim() : null;
    if (commit) {
      const keyed = gitCall(run, gitCalls.setKey(branch, 'merged', commit));
      if (!keyed.ok) notes.push(...keyed.detail);
    }
  }

  // The open human tests of the feature, read on the epic branch after the merge.
  /**
   * @param {string} code
   * @param {string} say
   * @param {string[]} detail
   */
  const testsFailed = (code, say, detail) => ({
    ...gitWriteFailed(recordRun, feature, { step, phase: null, point: 'human-tests', code, say, detail }),
    ...names,
    merged: !merged,
    commit,
  });
  const written = writeHumanTests(run, epic, name, readFeatureDocs(run.projectRoot, checked).humanTests);
  if (!written.ok) return testsFailed('human-tests-failed', `The human tests of ${feature} were not written to ${humanRel}.`, written.detail);
  const changed = gitCall(run, gitCalls.statusOf(humanRel));
  if (!changed.ok) return testsFailed('git-failed', 'A git read failed.', changed.detail);
  /** @type {string | null} */
  let docsCommit = null;
  if (parsePorcelain(changed.stdout).length > 0) {
    const added = gitCall(run, gitCalls.addPaths([humanRel]));
    if (!added.ok) return testsFailed('commit-failed', `The human test commit of ${feature} failed.`, added.detail);
    const committed = gitCall(run, gitCalls.commit(humanTestsSubject(feature)));
    if (!committed.ok) return testsFailed('commit-failed', `The human test commit of ${feature} failed.`, committed.detail);
    const sha = gitCall(run, gitCalls.revParseHead());
    docsCommit = sha.ok ? sha.stdout.trim() : null;
  }
  clearGitFailure(recordRun, feature, step);
  const keyNote = notes.length > 0 ? ' The merged key was not set.' : '';
  // A lane in a worktree: release each tab that its record still names, then remove the worktree.
  const site = tree ? removeLaneWorktree(run, feature, tree.path) : null;
  let removed = '';
  if (site) {
    removed = site.removal.ok ? ` Removed the worktree ${site.removal.worktree}.` : ` The worktree ${site.removal.worktree} stays: remove it in Orca.`;
    for (const entry of site.terminals.filter((item) => !item.closed)) notes.push(`The tab ${entry.terminal} stays open: close it in Orca.`, ...entry.detail);
    if (!site.removal.ok) notes.push(`Orca did not remove the worktree ${site.removal.worktree}.`, ...site.removal.detail);
  }

  const count = written.added.length;
  const say = merged ? `${feature} is already merged into ${into}.` : `Merged ${feature} into ${into}.`;
  const tests = docsCommit ? ` Committed ${count > 0 ? `${count} human test line${count === 1 ? '' : 's'}` : 'the human tests'} in ${humanRel}.` : '';
  return success(step, `${say}${tests}${keyNote}${removed}`, {
    ...names,
    merged: !merged,
    commit,
    humanTests: written.added,
    created: written.created,
    docsCommit,
    ...(site ? { worktree: site.removal.worktree, release: site.release, removal: site.removal } : {}),
    ...(site && site.terminals.length > 0 ? { terminals: site.terminals.map(({ dispatchId, terminal, closed }) => ({ dispatchId, terminal, closed })) } : {}),
    ...(notes.length > 0 ? { detail: notes } : {}),
  });
}

/**
 * The end of a lane worktree after its merge (Decision 12): release each
 * tab that the lane record names (fact O14), then `worktree rm --worktree
 * <selector> --json` (fact O13). The removal takes no flag that stops a
 * process or deletes the branch, so the branch stays for the user. A
 * refused release or removal is a note, never a stop.
 *
 * @param {StepRun} run The main run: the removal never runs inside the worktree.
 * @param {string} feature
 * @param {string} tree The absolute path of the worktree.
 * @returns {{ release: Record<string, any>[], terminals: { dispatchId: string, terminal: string, closed: boolean, detail: string[] }[], removal: { ok: boolean, selector: string, worktree: string, code: string | null, detail: string[] } }}
 */
function removeLaneWorktree(run, feature, tree) {
  const { record } = readRecord(tree, feature);
  const retained = Array.isArray(record?.retained) ? record.retained : [];
  const release = releaseDispatches(run, [record?.failedStart?.dispatchId, ...retained]);
  // An own terminal that a lane close could not close (fix 3): its handle stays in the record, and the merge
  // retries every entry. A close only recorded the handle after a retained or already_released release, so the
  // retry needs no release answer, and an id outside `retained` (already_released) is reached too.
  const owned = isPlainObject(record?.retainedTerminals) ? record.retainedTerminals : {};
  /** @type {{ dispatchId: string, terminal: string, closed: boolean, detail: string[] }[]} */
  const terminals = [];
  for (const [dispatchId, handle] of Object.entries(owned)) {
    const terminal = textOf(handle);
    if (!terminal) continue;
    const closed = orcaCall(run, orcaCalls.terminalClose(terminal));
    terminals.push({ dispatchId, terminal, closed: closed.kind === 'ok', detail: closed.kind === 'ok' ? [] : closed.detail });
  }
  const selector = laneSelector(tree);
  const answer = orcaCall(run, orcaCalls.worktreeRemove(selector));
  if (answer.kind === 'ok') return { release, terminals, removal: { ok: true, selector, worktree: tree, code: null, detail: [] } };
  return { release, terminals, removal: { ok: false, selector, worktree: tree, code: answer.code, detail: answer.detail } };
}

/** The handler of each step. `--epic` alone names the epic run, and `--point feature` the feature end of a lane. */
const STEP_HANDLERS = {
  next: (/** @type {StepRun} */ run) => (run.values.epic !== undefined ? stepNextEpic(run) : stepNext(run)),
  branch: (/** @type {StepRun} */ run) => (run.values.epic !== undefined ? stepBranchEpic(run) : stepBranch(run)),
  start: (/** @type {StepRun} */ run) => (run.values.feature === undefined ? stepStartEpic(run) : stepStart(run)),
  close: (/** @type {StepRun} */ run) => (run.values.feature === undefined ? stepCloseEpic(run) : stepClose(run)),
  commit: (/** @type {StepRun} */ run) => (run.values.point === 'feature' ? stepCommitFeature(run) : stepCommit(run)),
  merge: stepMerge,
  send: (/** @type {StepRun} */ run) => (run.values.feature === undefined ? stepSendEpic(run) : stepSend(run)),
  reply: stepReply,
  note: stepNote,
  detect: stepDetect,
  config: stepConfig,
};
