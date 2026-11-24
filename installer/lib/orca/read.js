// installer/lib/orca/read.js
//
// The reads of an orca run: the `orchestration` object of
// `.beast-mode/orca.json`, the docs of a feature (`tasks.md`,
// `code-review.md`, the human tests of `context.md`, and `inbox.md`), and
// the run record under `.beast-mode/briefs/<path>/`. Every parse function
// is pure and never throws, and so are the inbox line helpers that `note`
// uses. `readOrcaConfig`, `readFeatureDocs`, and `readRecord` touch the
// file system and still never throw. `writeRecord` is the one write of
// this module: a temporary file renamed over the target, so a reader never
// sees half a record. Phase 6 adds the lane facts: a side-by-side group,
// the lane branch by its config keys, and its worktree by
// `git worktree list --porcelain`.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/** The project file, relative to the project root (launch-config, the project file). */
export const ORCA_JSON_REL = '.beast-mode/orca.json';

/** The size cap of the project file: 64 KiB (launch-config Decision 5). */
export const ORCA_JSON_MAX_BYTES = 65536;

/** The reader stops at 20 problems. */
export const MAX_PROBLEMS = 20;

/** The agent ids that a stage takes. */
export const AGENT_IDS = ['claude', 'dsh'];

/** The schema of the run record. */
export const RECORD_SCHEMA = 1;

/** The file name of the run record inside `.beast-mode/briefs/<path>/`. */
export const RECORD_NAME = 'orca-run.json';

/** One path segment of a feature reference: a safe folder name. */
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** The longest feature reference that the reader takes. */
const MAX_FEATURE_PATH = 200;

/**
 * @typedef {Object} Problem One schema problem of the project file.
 * @property {string} code A code of the orchestration object table, or a shared file code.
 * @property {string} at The JSON path of the value, for example "$.orchestration.stages.implement".
 */

/**
 * @typedef {Object} Orchestration The resolved `orchestration` object. Every key holds a value.
 * @property {{ plan: string, implement: string, verify: string, review: string | false, docs: string }} stages
 * @property {'phase' | 'feature'} commit
 * @property {boolean} concurrent
 * @property {unknown[]} steps
 * @property {number} backstopSeconds The backstop timer of every wait, in seconds (fix 7).
 * @property {number} statusEveryMinutes The most often the coordinator posts a "still working" line, in minutes (fix 7).
 * @property {number} stepRoundCap The FAIL rounds of one feature or epic step before the run asks `step-fail-cap` (fix 11).
 */

/**
 * @typedef {{ state: 'missing' }
 *   | { state: 'invalid', problems: Problem[] }
 *   | { state: 'valid', config: Record<string, unknown>, orchestration: Orchestration | null }} OrcaConfigRead
 */

/**
 * @typedef {Object} TasksPhase One `## Phase <n>` section of tasks.md.
 * @property {number} number The number after "Phase", else the position of the phase (1-based).
 * @property {string} title The heading text without "## " and without the count group.
 * @property {string} name The title without its "Phase <n>:" lead. Empty when the heading names nothing else.
 * @property {number} done The task lines that read [x].
 * @property {number} total Every task line of the phase.
 * @property {string[]} open The text of each open task line, word for word.
 * @property {string | null} demo The value of the first `**Demo:**` line, else null.
 */

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {Record<string, unknown>} object
 * @param {string} key
 * @returns {boolean}
 */
function hasKey(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

/**
 * @param {string} code
 * @param {string} at
 * @returns {{ state: 'invalid', problems: Problem[] }}
 */
function invalid(code, at) {
  return { state: 'invalid', problems: [{ code, at }] };
}

/** The keys of `orchestration.stages`. */
export const STAGE_KEYS = ['plan', 'implement', 'verify', 'review', 'docs'];

/** The keys of the `orchestration` object that this version takes. */
export const ORCHESTRATION_KEYS = ['stages', 'commit', 'concurrent', 'steps', 'backstopSeconds', 'statusEveryMinutes', 'stepRoundCap'];

/**
 * Fix 7: the bounds and the default of each whole-number setting of the
 * orchestration object. `backstopSeconds` is the backstop timer of a wait on
 * a dsh tab. `statusEveryMinutes` is the most often the coordinator posts a
 * "still working" line on a timer wake that changed nothing. Fix 11:
 * `stepRoundCap` is the FAIL rounds of one step before the run asks
 * `step-fail-cap` instead of `step-failed`.
 */
export const NUMBER_SETTINGS = {
  backstopSeconds: { min: 60, max: 86400, fallback: 600, code: 'backstop-value' },
  statusEveryMinutes: { min: 1, max: 1440, fallback: 30, code: 'status-every-value' },
  stepRoundCap: { min: 1, max: 20, fallback: 3, code: 'step-round-cap-value' },
};

/**
 * @param {unknown} value
 * @param {{ min: number, max: number }} bounds
 * @returns {value is number} A whole number inside the bounds.
 */
function inBounds(value, bounds) {
  return typeof value === 'number' && Number.isInteger(value) && value >= bounds.min && value <= bounds.max;
}

/** The most lines that `orchestration.steps` holds. */
export const MAX_STEPS = 16;

/** The keys of one step line. Each is required. */
export const STEP_KEYS = ['after', 'command', 'agent'];

/** The points where a step line runs: after each phase, after the feature, and after the epic. */
export const STEP_POINTS = ['phase', 'feature', 'epic'];

/** The tokens that the `command` of a step line takes, by point. */
export const STEP_TOKENS = { phase: ['feature', 'phase'], feature: ['feature'], epic: ['epic'] };

/** The words that line 1 of a verdict file takes. */
export const VERDICT_WORDS = ['PASS', 'FAIL', 'BLOCKED'];

/** The commit cadences. */
export const COMMIT_VALUES = ['phase', 'feature'];

/** One word of a custom agent command: the safe set of launch-config (`rules.ts`, COMMAND_WORD_PATTERN). */
const COMMAND_WORD = /^[A-Za-z0-9._/~:@+-]+$/;

/** A key that a JSON path names after a dot. Any other key takes the bracket form. */
const PATH_KEY = /^[A-Za-z_][A-Za-z0-9_-]*$/;

/** The longest key that a JSON path shows. */
const MAX_PATH_KEY = 64;

/**
 * The custom command rule of launch-config (`isCustomCommand` of
 * `orca/src/launch/rules.ts`): 1 to 200 characters, words split by one
 * space, and each word from the safe set.
 *
 * @param {string} text
 * @returns {boolean}
 */
export function isCustomCommand(text) {
  if (text.length < 1 || text.length > 200) return false;
  return text.split(' ').every((word) => COMMAND_WORD.test(word));
}

/**
 * The JSON path of one key under `base`: `$.a.b` for a plain key, else
 * `$.a["odd key"]`. A key over 64 characters is cut, so a detail line stays
 * short.
 *
 * @param {string} base
 * @param {string} key
 * @returns {string}
 */
function keyPath(base, key) {
  const shown = key.length > MAX_PATH_KEY ? `${key.slice(0, MAX_PATH_KEY)}...` : key;
  return shown === key && PATH_KEY.test(key) ? `${base}.${key}` : `${base}[${JSON.stringify(shown)}]`;
}

/**
 * The agent rules shared with launch-config (`rules.ts:321-347`), in its
 * order: `agents-not-object`, then for `claude` and for `dsh` in turn
 * `agent-not-object`, `agent-env`, `agent-args`, and `agent-command`.
 *
 * @param {Record<string, unknown>} config
 * @param {(code: string, at: string) => void} problem
 * @returns {void}
 */
function checkAgents(config, problem) {
  if (config.agents === undefined) return;
  if (!isPlainObject(config.agents)) {
    problem('agents-not-object', '$.agents');
    return;
  }
  for (const agent of AGENT_IDS) {
    const entry = config.agents[agent];
    if (entry === undefined) continue;
    if (!isPlainObject(entry)) {
      problem('agent-not-object', `$.agents.${agent}`);
      continue;
    }
    if (hasKey(entry, 'env')) problem('agent-env', `$.agents.${agent}.env`);
    if (hasKey(entry, 'args')) problem('agent-args', `$.agents.${agent}.args`);
    if (hasKey(entry, 'command') && !(typeof entry.command === 'string' && isCustomCommand(entry.command))) {
      problem('agent-command', `$.agents.${agent}.command`);
    }
  }
}

/**
 * The rules of `orchestration.stages`, key by key in the order of the file.
 *
 * @param {unknown} stages
 * @param {(code: string, at: string) => void} problem
 * @returns {void}
 */
function checkStages(stages, problem) {
  if (!isPlainObject(stages)) {
    problem('stages-not-object', '$.orchestration.stages');
    return;
  }
  for (const key of Object.keys(stages)) {
    const at = keyPath('$.orchestration.stages', key);
    if (!STAGE_KEYS.includes(key)) {
      problem('stage-unknown', at);
      continue;
    }
    const value = stages[key];
    if (!AGENT_IDS.includes(/** @type {string} */ (value)) && !(key === 'review' && value === false)) {
      problem('stage-agent', at);
    }
  }
}

/**
 * @param {unknown} command
 * @returns {boolean} 1 to 200 characters, one line, and it starts with "/".
 */
function isStepCommand(command) {
  return (
    typeof command === 'string' &&
    command.length >= 1 &&
    command.length <= 200 &&
    command.startsWith('/') &&
    !/[\r\n\u2028\u2029]/.test(command)
  );
}

/**
 * @param {string} command
 * @param {string} after A step point.
 * @returns {boolean} True when the command holds a brace that is not a token of the point.
 */
function hasStepTokenProblem(command, after) {
  const allowed = STEP_TOKENS[/** @type {keyof typeof STEP_TOKENS} */ (after)] ?? [];
  let bad = false;
  const rest = command.replace(/\{([^{}]*)\}/g, (_match, name) => {
    if (!allowed.includes(name)) bad = true;
    return '';
  });
  return bad || /[{}]/.test(rest);
}

/**
 * Fill the tokens of a step command: `{feature}`, `{phase}`, and `{epic}`.
 * A token with no value stays as it is. Pure.
 *
 * @param {string} command
 * @param {{ feature?: string | null, phase?: number | string | null, epic?: string | null }} values
 * @returns {string}
 */
export function fillStepTokens(command, values) {
  return command.replace(/\{(feature|phase|epic)\}/g, (match, name) => {
    const value = values[name];
    return value === null || value === undefined ? match : String(value);
  });
}

/**
 * The rules of one step line: an object with `after`, `command`, and
 * `agent` only. A command that fails its own rule gets no token check.
 *
 * @param {unknown} item
 * @param {string} at
 * @param {(code: string, at: string) => void} problem
 * @returns {void}
 */
function checkStep(item, at, problem) {
  if (!isPlainObject(item)) {
    problem('step-not-object', at);
    return;
  }
  for (const key of Object.keys(item)) {
    if (!STEP_KEYS.includes(key)) problem('step-unknown-key', keyPath(at, key));
  }
  const afterOk = STEP_POINTS.includes(/** @type {string} */ (item.after));
  if (!afterOk) problem('step-after', `${at}.after`);
  if (!isStepCommand(item.command)) {
    problem('step-command', `${at}.command`);
  } else if (afterOk && hasStepTokenProblem(/** @type {string} */ (item.command), /** @type {string} */ (item.after))) {
    problem('step-token', `${at}.command`);
  }
  if (!AGENT_IDS.includes(/** @type {string} */ (item.agent))) problem('step-agent', `${at}.agent`);
}

/**
 * The rules of `orchestration.steps`: an array of at most 16 lines. A list
 * over the cap still checks its first 16 lines.
 *
 * @param {unknown} steps
 * @param {(code: string, at: string) => void} problem
 * @returns {void}
 */
function checkSteps(steps, problem) {
  const base = '$.orchestration.steps';
  if (!Array.isArray(steps)) {
    problem('steps-not-array', base);
    return;
  }
  if (steps.length > MAX_STEPS) problem('steps-too-many', base);
  steps.slice(0, MAX_STEPS).forEach((item, index) => checkStep(item, `${base}[${index}]`, problem));
}

/**
 * The rules of the `orchestration` object, key by key in the order of the
 * file. The object is strict (Decision 7): any key outside
 * ORCHESTRATION_KEYS answers `orchestration-unknown-key`, so a typo such as
 * `"comit"` stops the run.
 *
 * @param {unknown} raw
 * @param {(code: string, at: string) => void} problem
 * @returns {void}
 */
function checkOrchestration(raw, problem) {
  if (!isPlainObject(raw)) {
    problem('orchestration-not-object', '$.orchestration');
    return;
  }
  for (const key of Object.keys(raw)) {
    const at = keyPath('$.orchestration', key);
    const value = raw[key];
    if (!ORCHESTRATION_KEYS.includes(key)) {
      problem('orchestration-unknown-key', at);
    } else if (key === 'stages') {
      checkStages(value, problem);
    } else if (key === 'commit') {
      if (!COMMIT_VALUES.includes(/** @type {string} */ (value))) problem('commit-value', at);
    } else if (key === 'steps') {
      checkSteps(value, problem);
    } else if (hasKey(NUMBER_SETTINGS, key)) {
      const bounds = NUMBER_SETTINGS[/** @type {keyof typeof NUMBER_SETTINGS} */ (key)];
      if (!inBounds(value, bounds)) problem(bounds.code, at);
    } else if (typeof value !== 'boolean') {
      problem('concurrent-value', at);
    }
  }
}

/**
 * Parse the text of `.beast-mode/orca.json`, or null for a missing file.
 *
 * The 64 KiB cap comes first (a character gate, then a byte gate, as
 * `orca/src/launch/rules.ts` does), then `not-json`, `not-object`, and
 * `version`. Then the agent rules shared with launch-config, and the rules
 * of the orchestration object table: `orchestration-not-object`,
 * `stages-not-object`, `stage-unknown`, `stage-agent`, `commit-value`,
 * `concurrent-value`, the step codes (`steps-not-array`, `steps-too-many`,
 * `step-not-object`, `step-unknown-key`, `step-after`, `step-command`,
 * `step-token`, `step-agent`), `backstop-value` (a whole number of seconds,
 * 60 to 86400), `status-every-value` (a whole number of minutes, 1 to
 * 1440), `step-round-cap-value` (a whole number of rounds, 1 to 20), and
 * `orchestration-unknown-key`. The reader stops at
 * 20 problems. An unknown top-level key stays in the parsed file. A file
 * with no `orchestration` key is valid, and its resolved object is null.
 * Never throws.
 *
 * @param {string | null | undefined} text
 * @returns {OrcaConfigRead}
 */
export function parseOrcaConfig(text) {
  if (text === null || text === undefined) return { state: 'missing' };
  if (typeof text !== 'string') return invalid('not-json', '$');

  // A UTF-8 character takes one byte or more, so a text with more
  // characters than the cap holds more bytes than the cap. That gate needs
  // no encode. The byte gate decides the multi-byte case.
  if (text.length > ORCA_JSON_MAX_BYTES) return invalid('config-too-large', '$');
  if (Buffer.byteLength(text, 'utf8') > ORCA_JSON_MAX_BYTES) return invalid('config-too-large', '$');

  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return invalid('not-json', '$');
  }
  if (!isPlainObject(value)) return invalid('not-object', '$');

  /** @type {Problem[]} */
  const problems = [];
  const problem = (code, at) => {
    if (problems.length < MAX_PROBLEMS) problems.push({ code, at });
  };

  if (value.version !== 1) problem('version', '$.version');
  checkAgents(value, problem);
  const present = hasKey(value, 'orchestration');
  if (present) checkOrchestration(value.orchestration, problem);

  if (problems.length > 0) return { state: 'invalid', problems };
  return {
    state: 'valid',
    config: value,
    orchestration: present ? resolveOrchestration(value.orchestration) : null,
  };
}

/**
 * Fill every default of the orchestration object table. `verify` and
 * `docs` follow `implement`, so a changed build agent opens no surprise
 * verify tab (Decision 7). A value that the table refuses takes its
 * default, so the function also serves a raw object that skipped the
 * checks.
 *
 * @param {unknown} raw The `orchestration` value of the file.
 * @returns {Orchestration}
 */
export function resolveOrchestration(raw) {
  const source = isPlainObject(raw) ? raw : {};
  const stages = isPlainObject(source.stages) ? source.stages : {};
  const agentOr = (value, fallback) => (AGENT_IDS.includes(/** @type {string} */ (value)) ? value : fallback);
  const implement = agentOr(stages.implement, 'dsh');
  return {
    stages: {
      plan: agentOr(stages.plan, 'claude'),
      implement,
      verify: agentOr(stages.verify, implement),
      review: stages.review === false ? false : agentOr(stages.review, 'claude'),
      docs: agentOr(stages.docs, implement),
    },
    commit: source.commit === 'feature' ? 'feature' : 'phase',
    concurrent: source.concurrent !== false,
    steps: Array.isArray(source.steps) ? source.steps.slice() : [],
    backstopSeconds: inBounds(source.backstopSeconds, NUMBER_SETTINGS.backstopSeconds)
      ? source.backstopSeconds
      : NUMBER_SETTINGS.backstopSeconds.fallback,
    statusEveryMinutes: inBounds(source.statusEveryMinutes, NUMBER_SETTINGS.statusEveryMinutes)
      ? source.statusEveryMinutes
      : NUMBER_SETTINGS.statusEveryMinutes.fallback,
    stepRoundCap: inBounds(source.stepRoundCap, NUMBER_SETTINGS.stepRoundCap)
      ? source.stepRoundCap
      : NUMBER_SETTINGS.stepRoundCap.fallback,
  };
}

/**
 * Read and parse `.beast-mode/orca.json` of a project. A missing file
 * answers `missing`. A file over the cap answers `config-too-large` before
 * any read. Any other read error answers `config-unreadable`, as the web
 * launch route does. Never throws.
 *
 * @param {string} projectRoot
 * @returns {OrcaConfigRead}
 */
export function readOrcaConfig(projectRoot) {
  const file = path.join(projectRoot, ...ORCA_JSON_REL.split('/'));
  let stat;
  try {
    stat = fs.statSync(file);
  } catch (err) {
    if (err && /** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') return { state: 'missing' };
    return invalid('config-unreadable', '$');
  }
  if (!stat.isFile()) return invalid('config-unreadable', '$');
  if (stat.size > ORCA_JSON_MAX_BYTES) return invalid('config-too-large', '$');

  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return invalid('config-unreadable', '$');
  }
  return parseOrcaConfig(text);
}

/**
 * Check a feature reference: `<feature>` or `<epic>/<feature>`, each
 * segment a safe folder name. A trailing slash is dropped. The check runs
 * before any path is built, so a reference never leaves `docs/features/`.
 *
 * @param {unknown} value
 * @returns {{ ok: true, path: string, segments: string[] } | { ok: false, reason: string }}
 */
export function checkFeaturePath(value) {
  if (typeof value !== 'string' || value.length === 0) {
    return { ok: false, reason: 'The feature reference is empty.' };
  }
  if (value.length > MAX_FEATURE_PATH) {
    return { ok: false, reason: `The feature reference is longer than ${MAX_FEATURE_PATH} characters.` };
  }
  const trimmed = value.replace(/\/+$/, '');
  const segments = trimmed.split('/');
  if (segments.length > 2) {
    return {
      ok: false,
      reason: `"${value}" holds more than two segments. A reference is <feature> or <epic>/<feature>.`,
    };
  }
  for (const segment of segments) {
    if (
      !SEGMENT.test(segment) ||
      segment.includes('..') ||
      segment.endsWith('.') ||
      segment.endsWith('.lock')
    ) {
      return {
        ok: false,
        reason: `"${value}" is not a feature reference. Each segment takes letters, digits, ".", "_", and "-".`,
      };
    }
  }
  return { ok: true, path: segments.join('/'), segments };
}

/**
 * The lines of a doc, ready to parse: the rule of `hooks/lib/docs.ts`.
 * Splits on `\r?\n`, removes the trailing spaces and one trailing `\` of
 * each line, and drops every line inside a fence of three backticks or
 * three tildes (the fence lines too). The leading indent stays, so an
 * indented checkbox is never a task line.
 *
 * @param {string} text
 * @returns {string[]}
 */
function docLines(text) {
  /** @type {string[]} */
  const out = [];
  let fence = null;
  for (const raw of text.split(/\r?\n/)) {
    const mark = /^\s*(```|~~~)/.exec(raw)?.[1] ?? null;
    if (fence !== null) {
      if (mark === fence) fence = null;
      continue;
    }
    if (mark !== null) {
      fence = mark;
      continue;
    }
    let line = raw.trimEnd();
    if (line.endsWith('\\')) line = line.slice(0, -1).trimEnd();
    out.push(line);
  }
  return out;
}

const PHASE_HEADING = /^##\s+phase\s+\S/i;
const PHASE_NUMBER = /^##\s+phase\s+(\d+)(?!\w)/i;
const PHASE_LEAD = /^phase\s+[^\s:]+\s*(?:[:.–—-]\s*)?/i;
const TASK_LINE = /^[-*]\s+\\?\[([ xX])\\?\]\s*(.*)$/;
const COUNT_GROUP = /\(\d+\/\d+/;
const DEMO_LABEL = '**Demo:**';
/** A heading that marks its phase out of this run: DEFERRED, SKIPPED, or (NOT|OUT OF) SCOPE. */
const DEFERRED_HEADING = /\b(?:deferred|skipped|not in scope|out of scope)\b/i;

/**
 * Parse the phases of a tasks.md text, by the rule of
 * `hooks/lib/tasks.ts:39-85`. Only a `## Phase <n>` heading opens a phase,
 * and the next `# ` or `## ` line closes it, so a `###` group stays inside
 * its phase, and the bug and debt sections count nowhere. A phase whose
 * heading says DEFERRED, SKIPPED, NOT IN SCOPE or OUT OF SCOPE is no phase
 * of the run, and its lines count nowhere either. A task line
 * matches `^[-*]\s+\\?\[([ xX])\\?\]\s*(.*)$`. Never throws.
 *
 * @param {unknown} text
 * @returns {{ phases: TasksPhase[] }}
 */
export function parseTasks(text) {
  /** @type {TasksPhase[]} */
  const phases = [];
  if (typeof text !== 'string') return { phases };

  /** @type {TasksPhase | null} */
  let open = null;
  for (const line of docLines(text)) {
    if (line.startsWith('# ') || line.startsWith('## ')) {
      open = null;
      if (PHASE_HEADING.test(line)) {
        const heading = line.replace(/^##\s+/, '');
        // A deferred phase is no phase of this run: it opens no tab and its
        // lines count nowhere, as a bug or debt section counts nowhere.
        if (DEFERRED_HEADING.test(heading)) continue;
        const cut = COUNT_GROUP.exec(heading);
        const title = (cut === null ? heading : heading.slice(0, cut.index)).trim();
        const number = PHASE_NUMBER.exec(line);
        open = {
          number: number ? Number(number[1]) : phases.length + 1,
          title,
          name: title.replace(PHASE_LEAD, '').trim(),
          done: 0,
          total: 0,
          open: [],
          demo: null,
        };
        phases.push(open);
      }
      continue;
    }
    if (open === null) continue;

    if (open.demo === null && line.startsWith(DEMO_LABEL)) {
      open.demo = line.slice(DEMO_LABEL.length).trim();
      continue;
    }

    const match = TASK_LINE.exec(line);
    if (match === null) continue;
    open.total += 1;
    if (match[1] === ' ') {
      open.open.push((match[2] ?? '').trim());
    } else {
      open.done += 1;
    }
  }
  return { phases };
}

/**
 * Is every task line of the phase checked? A phase with no task line never
 * passes (Decision 6).
 *
 * @param {{ done: number, total: number } | null | undefined} phase
 * @returns {boolean}
 */
export function isPhaseComplete(phase) {
  return Boolean(phase) && phase.total > 0 && phase.done === phase.total;
}

/**
 * Is the value a phase number? A `## Phase <n>` heading gives a whole number
 * from 0 up, so Phase 0 is a real phase. A check of a phase number uses this
 * test, and never the truth of the value, because 0 is falsy.
 *
 * @param {unknown} value
 * @returns {value is number}
 */
export function isPhaseNumber(value) {
  return Number.isInteger(value) && /** @type {number} */ (value) >= 0;
}

/**
 * @typedef {Object} ReviewFinding One finding of code-review.md.
 * @property {string} id "CR-3", or "base CR-3" in the per-feature form of an epic review.
 * @property {string | null} feature The feature of the per-feature form, else null.
 * @property {number} number
 * @property {boolean} done Every line of the finding reads [x].
 * @property {string} text The text of its first open line (else its first line), word for word.
 */

/**
 * @typedef {Object} ReviewRead The findings of code-review.md.
 * @property {ReviewFinding[]} findings One entry per id, in the order of the first line.
 * @property {string[]} open The text of each open finding.
 * @property {number} total
 * @property {number} closed
 */

/**
 * @typedef {Object} InboxLine One open line of inbox.md.
 * @property {string | null} kind `bug`, `note`, `change small`, `change medium`, `change large`, or `change`. Null for no kind.
 * @property {string} text The text after the box, word for word.
 */

/**
 * @typedef {Object} InboxClosedLine One line of inbox.md closed `done: new requirements.md` (section 12 rule 10).
 * @property {string | null} kind The kind of the line, as InboxLine names it.
 * @property {string} text The text after the box, word for word, with the outcome.
 * @property {string | null} time The `YYYY-MM-DD HH:MM` time of the line, else null.
 */

/**
 * @typedef {Object} InboxRead The lines of inbox.md.
 * @property {InboxLine[]} open Every open line.
 * @property {InboxLine[]} actionable The open `bug` and `change` lines: the lines of the inbox stage (rule F20).
 * @property {InboxClosedLine[]} newRequirements Each line closed `done: new requirements.md`, with its time.
 */

/** The id of a finding line, with the optional feature of the per-feature form. */
const REVIEW_ID = /^(?:([A-Za-z0-9][A-Za-z0-9._-]*)\s+)?CR-(\d+)(?!\d)/;

/** The bold, strike, or code marks that can lead the text of a finding line. */
const LEAD_MARKS = /^[*_~`]+/;

/** The heading of the human tests in context.md. */
const HUMAN_HEADING = /^##\s+needs human verification\b/i;

/** A template placeholder line, such as "[Item that needs a human eye]". */
const PLACEHOLDER = /^\[[^\]]*\]$/;

/** The kind that leads an inbox line (section 12 rule 2 of phase-handoff.md). */
const INBOX_KIND = /^(bug|note|change(?:\s+(?:small|medium|large))?)(?=\s|$)/i;

/** The time after the kind of an inbox line. */
const INBOX_TIME = /^(?:bug|note|change(?:\s+(?:small|medium|large))?)\s+(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2})(?!\d)/i;

/** The outcome of a large change that moved the goal (section 12 rule 10). */
const NEW_REQUIREMENTS = /\|\s*done:\s*new requirements\.md(?![\w-])/i;

/** The heading of the items in inbox.md. */
const ITEMS_HEADING = /^##\s+items\s*$/i;

/** A heading that closes the `## Items` section: `# ` or `## `. */
const SECTION_HEADING = /^#{1,2}\s/;

/**
 * Parse the findings of a code-review.md text. A finding is a task line
 * whose text starts with `CR-<n>`, or with `<feature> CR-<n>` in the
 * per-feature form of `/review-feature`. A heading such as `### CR-1: Title`
 * is not a finding line. A finding with two lines is open while one of them
 * is open. Never throws.
 *
 * @param {unknown} text
 * @returns {ReviewRead}
 */
export function parseReview(text) {
  /** @type {ReviewFinding[]} */
  const findings = [];
  if (typeof text === 'string') {
    /** @type {Map<string, ReviewFinding>} */
    const byId = new Map();
    for (const line of docLines(text)) {
      const task = TASK_LINE.exec(line);
      if (task === null) continue;
      const body = (task[2] ?? '').trim();
      const match = REVIEW_ID.exec(body.replace(LEAD_MARKS, ''));
      if (match === null) continue;
      const feature = match[1] ?? null;
      const number = Number(match[2]);
      const id = feature ? `${feature} CR-${number}` : `CR-${number}`;
      const open = task[1] === ' ';
      const known = byId.get(id);
      if (!known) {
        const finding = { id, feature, number, done: !open, text: body };
        byId.set(id, finding);
        findings.push(finding);
      } else if (open && known.done) {
        known.done = false;
        known.text = body;
      }
    }
  }
  const open = findings.filter((finding) => !finding.done).map((finding) => finding.text);
  return { findings, open, total: findings.length, closed: findings.length - open.length };
}

/**
 * The open lines of `## Needs Human Verification` in a context.md text. The
 * next `# ` or `## ` heading closes the section. A template placeholder line
 * counts nowhere. Never throws.
 *
 * @param {unknown} text
 * @returns {{ open: string[] }}
 */
export function parseHumanTests(text) {
  /** @type {string[]} */
  const open = [];
  if (typeof text !== 'string') return { open };
  let inside = false;
  for (const line of docLines(text)) {
    if (line.startsWith('# ') || line.startsWith('## ')) {
      inside = HUMAN_HEADING.test(line);
      continue;
    }
    if (!inside) continue;
    const task = TASK_LINE.exec(line);
    if (task === null || task[1] !== ' ') continue;
    const body = (task[2] ?? '').trim();
    if (body.length > 0 && !PLACEHOLDER.test(body)) open.push(body);
  }
  return { open };
}

/**
 * The lines of an inbox.md text: `- [ ] <kind> <YYYY-MM-DD HH:MM> | <text>`.
 * `open` holds every open line. A line with no known kind still counts
 * there, with a null kind. `actionable` holds the open `bug` and `change`
 * lines, the lines that start the inbox stage (rule F20). `newRequirements`
 * holds each closed line whose outcome reads `done: new requirements.md`,
 * with its time. Never throws.
 *
 * @param {unknown} text
 * @returns {InboxRead}
 */
export function parseInbox(text) {
  /** @type {InboxRead} */
  const read = { open: [], actionable: [], newRequirements: [] };
  if (typeof text !== 'string') return read;
  for (const line of docLines(text)) {
    const task = TASK_LINE.exec(line);
    if (task === null) continue;
    const body = (task[2] ?? '').trim();
    if (body.length === 0 || PLACEHOLDER.test(body)) continue;
    const match = INBOX_KIND.exec(body);
    const kind = match ? match[1].toLowerCase().replace(/\s+/g, ' ') : null;
    if (task[1] === ' ') {
      const entry = { kind, text: body };
      read.open.push(entry);
      if (kind === 'bug' || (kind !== null && kind.startsWith('change'))) read.actionable.push(entry);
    } else if (NEW_REQUIREMENTS.test(body)) {
      read.newRequirements.push({ kind, text: body, time: INBOX_TIME.exec(body)?.[1] ?? null });
    }
  }
  return read;
}

/**
 * @param {Date} date
 * @returns {string} The local `YYYY-MM-DD HH:MM` time of an inbox line (section 12 rule 2).
 */
export function inboxTime(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/**
 * One open inbox line in the shape of section 12 rule 2:
 * `- [ ] <kind> <YYYY-MM-DD HH:MM> | <text>`. The text keeps its words, and
 * its line breaks become single spaces, so the item stays one line.
 *
 * @param {string} kind
 * @param {Date} date The write time.
 * @param {string} text
 * @returns {string}
 */
export function inboxLine(kind, date, text) {
  const words = String(text)
    .split(/\r?\n/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join(' ');
  return `- [ ] ${kind} ${inboxTime(date)} | ${words}`;
}

/**
 * The inbox text with one more line at the end of its `## Items` section:
 * after the last line of the section that is not blank, and before the
 * next `# ` or `## ` heading. Every other line stays as it is. A text with
 * no `## Items` section gets the section at its end. A line inside a fence
 * never counts as a heading. Pure.
 *
 * @param {string} text
 * @param {string} line
 * @returns {string}
 */
export function insertInboxLine(text, line) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

  let items = -1;
  let end = lines.length;
  let fence = null;
  for (let i = 0; i < lines.length; i += 1) {
    const mark = /^\s*(```|~~~)/.exec(lines[i])?.[1] ?? null;
    if (fence !== null) {
      if (mark === fence) fence = null;
      continue;
    }
    if (mark !== null) {
      fence = mark;
      continue;
    }
    if (items === -1) {
      if (ITEMS_HEADING.test(lines[i].trimEnd())) items = i;
    } else if (SECTION_HEADING.test(lines[i])) {
      end = i;
      break;
    }
  }

  if (items === -1) {
    const out = [...lines];
    while (out.length > 0 && out[out.length - 1].trim() === '') out.pop();
    out.push(...(out.length > 0 ? [''] : []), '## Items', '', line);
    return `${out.join(eol)}${eol}`;
  }
  let last = end - 1;
  while (last > items && lines[last].trim() === '') last -= 1;
  const added = last === items ? ['', line] : [line];
  return `${[...lines.slice(0, last + 1), ...added, ...lines.slice(last + 1)].join(eol)}${eol}`;
}

/**
 * A new inbox text from the template of `.beast-mode/templates/inbox.md`,
 * with the feature name in the H1 (section 12 rule 1). With no template,
 * the smallest inbox: the H1 and the `## Items` heading. Pure.
 *
 * @param {string | null} template
 * @param {string} feature The feature path, as `/start-feature` fills it in.
 * @returns {string}
 */
export function inboxFromTemplate(template, feature) {
  if (typeof template !== 'string' || template.trim().length === 0) return `# ${feature} - Inbox\n\n## Items\n`;
  const filled = template.split('[Feature Name]').join(feature);
  return filled.endsWith('\n') ? filled : `${filled}\n`;
}

/**
 * @typedef {Object} FeatureDocs The docs of one feature, as `next` and the act steps read them.
 * @property {boolean} valid The feature reference passed checkFeaturePath().
 * @property {string | null} reason Why the reference is not valid.
 * @property {boolean} exists The feature folder exists.
 * @property {boolean} isEpic The folder holds `epic-overview.md`.
 * @property {string | null} epic The epic of a feature inside an epic.
 * @property {{ requirements: boolean, implementation: boolean, tasks: boolean, context: boolean, inbox: boolean, codeReview: boolean }} has
 *   The docs that exist in the folder.
 * @property {{ phases: TasksPhase[] } | null} tasks Null with no readable tasks.md.
 * @property {string | null} tasksError The read error of a tasks.md that exists.
 * @property {ReviewRead | null} review Null with no readable code-review.md.
 * @property {string | null} reviewError The read error of a code-review.md that exists.
 * @property {string[]} humanTests The open lines of `## Needs Human Verification` in context.md.
 * @property {InboxLine[]} inbox The open lines of inbox.md.
 * @property {InboxLine[]} inboxActionable The open `bug` and `change` lines of inbox.md.
 * @property {InboxClosedLine[]} inboxNewRequirements The lines of inbox.md closed `done: new requirements.md`.
 * @property {Record<string, StepVerdictFact>} stepVerdicts The verdict files of the briefs folder of the feature, by key (`feature:0`).
 * @property {Record<string, PhaseVerdictFact>} phaseVerdicts The phase verdict files of the briefs folder, by phase number.
 */

/**
 * @param {string} file
 * @returns {boolean}
 */
function isFile(file) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

/**
 * @param {string} file
 * @returns {boolean}
 */
function isDirectory(file) {
  try {
    return fs.statSync(file).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Read one doc. A missing file answers no text and no error. Any other
 * read error answers the error, and the file counts as present.
 *
 * @param {string} file
 * @returns {{ exists: boolean, text: string | null, error: string | null }}
 */
function readDoc(file) {
  try {
    return { exists: true, text: fs.readFileSync(file, 'utf8'), error: null };
  } catch (err) {
    const code = /** @type {NodeJS.ErrnoException} */ (err)?.code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return { exists: false, text: null, error: null };
    return { exists: true, text: null, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Read a verdict file (§The orchestration object, Decision 17). Line 1 is
 * `PASS`, `FAIL`, or `BLOCKED`, and the evidence follows. Anything else
 * reads as no verdict: a null answer. Never throws.
 *
 * @param {unknown} text
 * @returns {{ verdict: 'PASS' | 'FAIL' | 'BLOCKED', evidence: string } | null}
 */
export function readVerdict(text) {
  if (typeof text !== 'string') return null;
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const word = lines[0].trim();
  if (!VERDICT_WORDS.includes(word)) return null;
  return { verdict: /** @type {'PASS' | 'FAIL' | 'BLOCKED'} */ (word), evidence: lines.slice(1).join('\n').trim() };
}

/**
 * @param {string} after A step point: "phase", "feature", or "epic".
 * @param {number | string | null | undefined} phase The phase number of a phase step.
 * @returns {string} The point name: "phase-2", "feature", or "epic".
 */
export function stepPoint(after, phase) {
  return after === 'phase' ? `phase-${phase}` : after;
}

/**
 * @param {string} point A point name from stepPoint().
 * @param {number} index The index of the line in `orchestration.steps`.
 * @returns {string} The key of the run record mark, for example "feature:0".
 */
export function stepKey(point, index) {
  return `${point}:${index}`;
}

/**
 * @param {string} point
 * @param {number} index
 * @returns {string} The file name of the spec of one step tab.
 */
export function stepSpecName(point, index) {
  return `orca-step-${point}-${index}.md`;
}

/**
 * @param {string} point
 * @param {number} index
 * @returns {string} The file name of the verdict of one step tab.
 */
export function stepVerdictName(point, index) {
  return `orca-step-${point}-${index}.verdict.md`;
}

/** A verdict file name of the briefs folder. */
const VERDICT_FILE = /^orca-step-((?:phase-(?:0|[1-9]\d{0,5}))|feature|epic)-(\d{1,2})\.verdict\.md$/;

/** The longest evidence text that a fact holds. */
const MAX_EVIDENCE = 4000;

/**
 * @typedef {Object} StepVerdictFact One verdict file of the briefs folder.
 * @property {'PASS' | 'FAIL' | 'BLOCKED' | null} verdict Null when line 1 names no verdict.
 * @property {string} evidence The text after line 1, cut at 4000 characters.
 */

/**
 * Read the verdict files of one briefs folder, by key (`feature:0`). A file
 * with no verdict on line 1 answers a null verdict. Never throws.
 *
 * @param {string} dir The absolute briefs folder.
 * @returns {Record<string, StepVerdictFact>}
 */
export function readStepVerdicts(dir) {
  /** @type {Record<string, StepVerdictFact>} */
  const out = {};
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of names) {
    const match = VERDICT_FILE.exec(name);
    if (!match) continue;
    const body = readDoc(path.join(dir, name));
    if (!body.exists) continue;
    const read = readVerdict(body.text);
    out[stepKey(match[1], Number(match[2]))] = read
      ? { verdict: read.verdict, evidence: read.evidence.slice(0, MAX_EVIDENCE) }
      : { verdict: null, evidence: '' };
  }
  return out;
}

/**
 * @param {number} phase
 * @returns {string} The file name of the verdict of one phase: the phase tab (verify equal to implement), the verify tab, or a fix tab that verifies writes it.
 */
export function phaseVerdictName(phase) {
  return `orca-phase-${phase}.verdict.md`;
}

/**
 * @param {number} phase
 * @param {number} round The fix round that the verdict started.
 * @returns {string} The file name that a fix start gives to the old verdict of the phase.
 */
export function phaseVerdictKeptName(phase, round) {
  return `orca-phase-${phase}-r${round}.verdict.md`;
}

/**
 * @param {number} phase
 * @returns {string} The file name of the spec of the verify tab of one phase.
 */
export function verifySpecName(phase) {
  return `orca-verify-${phase}.md`;
}

/**
 * @param {number} phase
 * @param {number} round
 * @returns {string} The file name of the spec of the fix tab of one phase and round.
 */
export function fixSpecName(phase, round) {
  return `orca-fix-${phase}-r${round}.md`;
}

/**
 * @param {number} phase
 * @returns {string} The file name of the verification brief of one phase (section 9 of the handoff file).
 */
export function verifyBriefName(phase) {
  return `phase-${phase}-verify.md`;
}

/**
 * The demo result of a verdict text: the last line of the file, when it reads
 * `Demo: PASS`, `Demo: FAIL`, `Demo: MANUAL`, or `Demo: none` (section 9).
 *
 * @param {unknown} text
 * @returns {'PASS' | 'FAIL' | 'MANUAL' | 'none' | null}
 */
export function demoResultOf(text) {
  if (typeof text !== 'string') return null;
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
  if (lines.length < 2) return null;
  const match = /^Demo:\s*(PASS|FAIL|MANUAL|none)\b/i.exec(lines[lines.length - 1]);
  if (!match) return null;
  const word = match[1].toUpperCase();
  return /** @type {'PASS' | 'FAIL' | 'MANUAL' | 'none'} */ (word === 'NONE' ? 'none' : word);
}

/** A phase verdict file name of the briefs folder. */
const PHASE_VERDICT_FILE = /^orca-phase-(0|[1-9]\d{0,5})\.verdict\.md$/;

/**
 * @typedef {Object} PhaseVerdictFact One phase verdict file of the briefs folder.
 * @property {'PASS' | 'FAIL' | 'BLOCKED' | null} verdict Null when line 1 names no verdict.
 * @property {string} evidence The text after line 1, cut at 4000 characters.
 * @property {'PASS' | 'FAIL' | 'MANUAL' | 'none' | null} demo The demo result on the last line, or null.
 */

/**
 * Read the phase verdict files of one briefs folder, by phase number. A file
 * with no verdict on line 1 answers a null verdict. Never throws.
 *
 * @param {string} dir The absolute briefs folder.
 * @returns {Record<string, PhaseVerdictFact>}
 */
export function readPhaseVerdicts(dir) {
  /** @type {Record<string, PhaseVerdictFact>} */
  const out = {};
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of names) {
    const match = PHASE_VERDICT_FILE.exec(name);
    if (!match) continue;
    const body = readDoc(path.join(dir, name));
    if (!body.exists) continue;
    const read = readVerdict(body.text);
    out[String(Number(match[1]))] = read
      ? { verdict: read.verdict, evidence: read.evidence.slice(0, MAX_EVIDENCE), demo: demoResultOf(body.text) }
      : { verdict: null, evidence: '', demo: null };
  }
  return out;
}

/**
 * Read the docs of a checked feature reference: which docs exist, the
 * phases of tasks.md, the findings of code-review.md, the open human tests
 * of context.md, and the open lines of inbox.md. Never throws.
 *
 * @param {string} projectRoot
 * @param {ReturnType<typeof checkFeaturePath>} checked
 * @returns {FeatureDocs}
 */
export function readFeatureDocs(projectRoot, checked) {
  /** @type {FeatureDocs} */
  const docs = {
    valid: checked.ok,
    reason: checked.ok ? null : checked.reason,
    exists: false,
    isEpic: false,
    epic: null,
    has: { requirements: false, implementation: false, tasks: false, context: false, inbox: false, codeReview: false },
    tasks: null,
    tasksError: null,
    review: null,
    reviewError: null,
    humanTests: [],
    inbox: [],
    inboxActionable: [],
    inboxNewRequirements: [],
    stepVerdicts: {},
    phaseVerdicts: {},
  };
  if (!checked.ok) return docs;

  const featuresDir = path.join(projectRoot, 'docs', 'features');
  const dir = path.join(featuresDir, ...checked.segments);
  docs.exists = isDirectory(dir);
  docs.epic =
    checked.segments.length === 2 && fs.existsSync(path.join(featuresDir, checked.segments[0], 'epic-overview.md'))
      ? checked.segments[0]
      : null;
  if (!docs.exists) return docs;

  docs.isEpic = fs.existsSync(path.join(dir, 'epic-overview.md'));
  docs.has.requirements = isFile(path.join(dir, 'requirements.md'));
  docs.has.implementation = isFile(path.join(dir, 'implementation.md'));

  const tasks = readDoc(path.join(dir, 'tasks.md'));
  docs.has.tasks = tasks.exists;
  docs.tasks = tasks.text === null ? null : parseTasks(tasks.text);
  docs.tasksError = tasks.error;

  const review = readDoc(path.join(dir, 'code-review.md'));
  docs.has.codeReview = review.exists;
  docs.review = review.text === null ? null : parseReview(review.text);
  docs.reviewError = review.error;

  const context = readDoc(path.join(dir, 'context.md'));
  docs.has.context = context.exists;
  docs.humanTests = parseHumanTests(context.text).open;

  const inbox = readDoc(path.join(dir, 'inbox.md'));
  docs.has.inbox = inbox.exists;
  const lines = parseInbox(inbox.text);
  docs.inbox = lines.open;
  docs.inboxActionable = lines.actionable;
  docs.inboxNewRequirements = lines.newRequirements;
  const briefs = path.join(projectRoot, '.beast-mode', 'briefs', ...checked.segments);
  docs.stepVerdicts = readStepVerdicts(briefs);
  docs.phaseVerdicts = readPhaseVerdicts(briefs);
  return docs;
}

/**
 * @param {string} projectRoot
 * @param {string} featurePath A checked feature reference.
 * @returns {string} The absolute path of the run record.
 */
export function recordPath(projectRoot, featurePath) {
  return path.join(projectRoot, '.beast-mode', 'briefs', ...featurePath.split('/'), RECORD_NAME);
}

/**
 * @param {string} featurePath
 * @returns {string} The project-relative path of the run record.
 */
export function recordRel(featurePath) {
  return `.beast-mode/briefs/${featurePath}/${RECORD_NAME}`;
}

/**
 * A new, empty run record of one feature.
 *
 * @param {string} featurePath
 * @returns {Record<string, any>}
 */
export function newRecord(featurePath) {
  return {
    schema: RECORD_SCHEMA,
    feature: featurePath,
    active: null,
    failedStart: null,
    done: { docs: false, steps: {} },
  };
}

/**
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function count(value, fallback) {
  return Number.isInteger(value) && /** @type {number} */ (value) >= 0 ? /** @type {number} */ (value) : fallback;
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function text(value) {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Normalize the `active` entry of a record. Null for no entry. Undefined
 * for an entry that names no stage or no dispatch, which makes the whole
 * record unreadable. Unknown keys stay.
 *
 * @param {unknown} value
 * @returns {Record<string, any> | null | undefined}
 */
function readActive(value) {
  if (value === null || value === undefined) return null;
  if (!isPlainObject(value) || !text(value.dispatchId) || !text(value.stage)) return undefined;
  return {
    ...value,
    stage: value.stage,
    phase: isPhaseNumber(value.phase) ? value.phase : null,
    step: value.step ?? null,
    round: count(value.round, 0),
    agent: text(value.agent),
    placement: text(value.placement) ?? 'current',
    dispatchId: value.dispatchId,
    taskId: text(value.taskId),
    runId: text(value.runId),
    startedAt: text(value.startedAt),
    sendBacks: count(value.sendBacks, 0),
    escalations: count(value.escalations, 0),
  };
}

/** The longest list of residual resources that a failed start keeps. */
const MAX_RESIDUAL = 20;

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function textList(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
}

/**
 * Normalize the `failedStart` entry of a record (§The run record): the
 * stage, the phase, and the agent of the start, the Orca code, and the
 * exit-1 receipt of fact O1 (`failedStage`, `lastError`, the Task and the
 * dispatch, `residualResources`, and the recovery commands). `count` is the
 * number of failed starts in one `--retry-of` chain, 1 or more. `circuit`
 * is true when Orca refused a retry because it broke the circuit. Null for
 * no entry. Unknown keys stay.
 *
 * @param {unknown} value
 * @returns {Record<string, any> | null}
 */
export function readFailedStart(value) {
  if (!isPlainObject(value)) return null;
  const residual = Array.isArray(value.residualResources)
    ? value.residualResources.filter((item) => typeof item === 'string' || isPlainObject(item)).slice(0, MAX_RESIDUAL)
    : [];
  return {
    ...value,
    stage: text(value.stage),
    phase: isPhaseNumber(value.phase) ? value.phase : null,
    agent: text(value.agent),
    at: text(value.at),
    code: text(value.code),
    failedStage: text(value.failedStage),
    lastError: text(value.lastError),
    taskId: text(value.taskId),
    dispatchId: text(value.dispatchId),
    residualResources: residual,
    nextCommands: textList(value.nextCommands),
    recovery: text(value.recovery),
    detail: textList(value.detail),
    count: Number.isInteger(value.count) && /** @type {number} */ (value.count) > 0 ? value.count : 1,
    circuit: value.circuit === true,
  };
}

/**
 * Normalize the `largeChange` entry of a record: the inbox lines that the
 * inbox tab of this run closed `done: new requirements.md`, and the time of
 * the close. Null for no entry, or for an entry with no line.
 *
 * @param {unknown} value
 * @returns {{ lines: string[], at: string | null } | null}
 */
function readLargeChange(value) {
  if (!isPlainObject(value)) return null;
  const lines = textList(value.lines);
  return lines.length > 0 ? { ...value, lines, at: text(value.at) } : null;
}

/**
 * Normalize the `verify` entry of a record: the fix rounds of each phase,
 * `{ "<n>": { "round": k } }`, with `<n>` a phase number from 0 up. An entry
 * with no whole round over -1 drops.
 *
 * @param {Record<string, unknown>} value
 * @returns {Record<string, { round: number }>}
 */
function readVerify(value) {
  /** @type {Record<string, { round: number }>} */
  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!/^(?:0|[1-9]\d{0,5})$/.test(key) || !isPlainObject(entry)) continue;
    const round = count(entry.round, -1);
    if (round >= 0) out[key] = { ...entry, round };
  }
  return out;
}

/**
 * Normalize the `stepRounds` entry of a record (fix 11): the FAIL rounds of
 * each step, `{ "<point>:<k>": n }`, with `<point>` `phase-<n>`, `feature`,
 * or `epic`. It sits beside `done.steps`, not in it, so a start that clears
 * the step marks keeps the count. An entry with no whole count over 0 drops.
 *
 * @param {Record<string, unknown>} value
 * @returns {Record<string, number>}
 */
function readStepRounds(value) {
  /** @type {Record<string, number>} */
  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!/^(?:phase-(?:0|[1-9]\d{0,5})|feature|epic):(?:0|[1-9]\d{0,5})$/.test(key)) continue;
    const rounds = count(entry, 0);
    if (rounds > 0) out[key] = rounds;
  }
  return out;
}

/**
 * Parse the text of a run record. Null when the text does not parse: not
 * JSON, not an object, another schema, or an `active` entry with no stage
 * or no dispatch. Unknown keys stay, so a later writer keeps them. Never
 * throws.
 *
 * @param {string} body
 * @param {string} featurePath The feature path, or the epic of an epic record.
 * @param {'feature' | 'epic'} [key] The key that names the run: `feature`, or `epic` for an epic record.
 * @returns {Record<string, any> | null}
 */
export function parseRecord(body, featurePath, key = 'feature') {
  let value;
  try {
    value = JSON.parse(body);
  } catch {
    return null;
  }
  if (!isPlainObject(value) || value.schema !== RECORD_SCHEMA) return null;
  const active = readActive(value.active);
  if (active === undefined) return null;
  const done = isPlainObject(value.done) ? value.done : {};
  return {
    ...value,
    schema: RECORD_SCHEMA,
    [key]: featurePath,
    active,
    failedStart: readFailedStart(value.failedStart),
    largeChange: readLargeChange(value.largeChange),
    ...(isPlainObject(value.verify) ? { verify: readVerify(value.verify) } : {}),
    ...(isPlainObject(value.stepRounds) ? { stepRounds: readStepRounds(value.stepRounds) } : {}),
    done: {
      ...done,
      docs: done.docs === true,
      steps: isPlainObject(done.steps) ? done.steps : {},
    },
  };
}

/**
 * @param {unknown} err
 * @returns {string} The error code of a failed read, for example "EACCES".
 */
function readErrorCode(err) {
  const code = err && /** @type {NodeJS.ErrnoException} */ (err).code;
  return typeof code === 'string' && code.length > 0 ? code : 'unknown error';
}

/**
 * Read the run record of one feature. A missing file answers a null record
 * and no note. A record that does not parse, or a file that cannot be read,
 * answers a null record and one note. The record holds the active dispatch,
 * so a note is never an absent record: `next` stops `record-unreadable`, and
 * `start` and `close` refuse it (CR-1). Never throws.
 *
 * @param {string} projectRoot
 * @param {string} featurePath A checked feature reference.
 * @returns {{ record: Record<string, any> | null, note: string | null }}
 */
export function readRecord(projectRoot, featurePath) {
  let body;
  try {
    body = fs.readFileSync(recordPath(projectRoot, featurePath), 'utf8');
  } catch (err) {
    if (err && /** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') return { record: null, note: null };
    return {
      record: null,
      note: `The run record at "${recordRel(featurePath)}" cannot be read (${readErrorCode(err)}).`,
    };
  }
  const record = parseRecord(body, featurePath);
  if (record === null) {
    return {
      record: null,
      note: `The run record at "${recordRel(featurePath)}" does not parse as a record of schema ${RECORD_SCHEMA}.`,
    };
  }
  return { record, note: null };
}

/**
 * Write one file the safe way: a temporary file in the same folder, made
 * with the `wx` flag, renamed over the target. A reader never sees half a
 * file. The folder must exist. Throws on a write failure, after it removes
 * the temporary file, so each caller keeps its own catch. Every atomic
 * write of this module family goes through this one function.
 *
 * @param {string} file The absolute path of the target.
 * @param {string} text
 * @returns {void}
 */
export function writeFileAtomic(file, text) {
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  try {
    fs.writeFileSync(temporary, text, { flag: 'wx' });
    fs.renameSync(temporary, file);
  } catch (err) {
    try {
      fs.rmSync(temporary, { force: true });
    } catch {
      // The write fault below is the one that the caller needs.
    }
    throw err;
  }
}

/**
 * Write the run record of one feature: a temporary file in the same
 * folder, renamed over the target. `schema` and `feature` lead the object,
 * and every other key keeps its order. Throws on a write failure, after it
 * removes the temporary file.
 *
 * @param {string} projectRoot
 * @param {string} featurePath A checked feature reference.
 * @param {Record<string, any>} record
 * @returns {string} The absolute path of the record.
 */
export function writeRecord(projectRoot, featurePath, record) {
  const file = recordPath(projectRoot, featurePath);
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });

  const { schema: _schema, feature: _feature, ...rest } = record;
  const body = `${JSON.stringify({ schema: RECORD_SCHEMA, feature: featurePath, ...rest }, null, 2)}\n`;
  writeFileAtomic(file, body);
  return file;
}

// ---------------------------------------------------------------------------
// The epic run (Phase 5): the Build Order, the epic docs, the epic record,
// and the human tests that `merge` writes
// ---------------------------------------------------------------------------

/** The file name of the record of one epic run (§The run record). */
export const EPIC_RECORD_NAME = 'orca-epic-run.json';

/** A folder inside an epic that is never a feature: the moodboard folder of the web app. */
export const RESERVED_EPIC_FOLDERS = ['moodboard'];

/** The heading of the Build Order: `## Build Order`, or `## Build Order / Dependencies` of the template. */
const BUILD_ORDER_HEADING = /^##\s+build order\b/i;

/** A numbered item of the Build Order. Only an item at column 0 opens an item, so a nested list stays inside it. */
const BUILD_ORDER_ITEM = /^\d{1,9}[.)](?:\s+(.*))?$/;

/** A bold text: `**name**` or `__name__`. */
const BOLD_TEXT = /\*\*(.+?)\*\*|__(.+?)__/g;

/**
 * @typedef {Object} BuildOrderGroup One numbered item of the Build Order that names a feature folder.
 * @property {number} item The place of the item among the numbered items, from 1.
 * @property {string[]} features The feature folders that the item names in bold, in text order.
 */

/**
 * @typedef {Object} BuildOrderProblem
 * @property {'no-build-order' | 'repeated' | 'not-listed'} code
 * @property {string | null} feature
 * @property {number[]} items The items that name the feature.
 * @property {string} detail One line for the user.
 */

/**
 * @typedef {Object} BuildOrder
 * @property {boolean} found The doc holds a Build Order section.
 * @property {BuildOrderGroup[]} groups In the order of the items. A feature stays in its first item only.
 * @property {BuildOrderProblem[]} problems
 */

/**
 * @param {number[]} items
 * @returns {string} "2 and 3", or "1, 2, and 3".
 */
function itemList(items) {
  if (items.length <= 2) return items.join(' and ');
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

/**
 * Read the numbered items of `## Build Order` in order (Decision 11). Each
 * item holds the bold names in its text that equal a feature folder. An
 * indented line continues the item, a blank line keeps it open, and any
 * other line ends it, so the dependency bullets under the list count
 * nowhere. A bold text that names no folder is prose. A folder in no item,
 * and a name in two items, are problems. Never throws.
 *
 * @param {unknown} text The text of epic-overview.md.
 * @param {string[]} folders The feature folders of the epic.
 * @returns {BuildOrder}
 */
export function parseBuildOrder(text, folders) {
  /** @type {BuildOrder} */
  const order = { found: false, groups: [], problems: [] };
  if (typeof text === 'string') {
    /** @type {string[][]} */
    const items = [];
    /** @type {string[] | null} */
    let current = null;
    let inside = false;
    for (const line of docLines(text)) {
      if (SECTION_HEADING.test(line)) {
        inside = BUILD_ORDER_HEADING.test(line);
        if (inside) order.found = true;
        current = null;
        continue;
      }
      if (!inside) continue;
      const item = BUILD_ORDER_ITEM.exec(line);
      if (item) {
        current = [item[1] ?? ''];
        items.push(current);
      } else if (line.trim().length > 0) {
        if (current && /^\s/.test(line)) current.push(line);
        else current = null;
      }
    }

    const known = new Set(folders);
    /** @type {Map<string, number[]>} */
    const owners = new Map();
    items.forEach((lines, index) => {
      const place = index + 1;
      /** @type {string[]} */
      const kept = [];
      for (const line of lines) {
        for (const match of line.matchAll(BOLD_TEXT)) {
          const name = (match[1] ?? match[2] ?? '').replace(/^[\s`*_]+|[\s`*_:.]+$/g, '');
          if (!known.has(name)) continue;
          const places = owners.get(name);
          if (!places) {
            owners.set(name, [place]);
            kept.push(name);
          } else if (!places.includes(place)) {
            places.push(place);
          }
        }
      }
      if (kept.length > 0) order.groups.push({ item: place, features: kept });
    });
    for (const [name, places] of owners) {
      if (places.length > 1) {
        order.problems.push({
          code: 'repeated',
          feature: name,
          items: places,
          detail: `"${name}" is in items ${itemList(places)} of the Build Order.`,
        });
      }
    }
    if (order.found) {
      for (const name of folders) {
        if (!owners.has(name)) {
          order.problems.push({ code: 'not-listed', feature: name, items: [], detail: `"${name}" is in no item of the Build Order.` });
        }
      }
    }
  }
  if (!order.found) {
    order.problems.push({ code: 'no-build-order', feature: null, items: [], detail: 'The doc holds no "## Build Order" section.' });
  }
  return order;
}

/**
 * Check an epic reference: one safe folder name under `docs/features/`.
 * Epics do not nest, so a second segment fails.
 *
 * @param {unknown} value
 * @returns {{ ok: true, name: string } | { ok: false, reason: string }}
 */
export function checkEpicName(value) {
  if (typeof value !== 'string' || value.length === 0) return { ok: false, reason: 'The epic reference is empty.' };
  const checked = checkFeaturePath(value);
  if (!checked.ok || checked.segments.length !== 1) {
    return {
      ok: false,
      reason: `"${value.slice(0, 80)}" is not an epic reference. An epic is one folder name under docs/features/, and epics do not nest.`,
    };
  }
  return { ok: true, name: checked.path };
}

/**
 * The open lines of a human-testing.md text, in every `## <feature>`
 * section. A template placeholder line counts nowhere. Never throws.
 *
 * @param {unknown} text
 * @returns {string[]}
 */
export function parseHumanTesting(text) {
  /** @type {string[]} */
  const open = [];
  if (typeof text !== 'string') return open;
  for (const line of docLines(text)) {
    const task = TASK_LINE.exec(line);
    if (task === null || task[1] !== ' ') continue;
    const body = (task[2] ?? '').trim();
    if (body.length > 0 && !PLACEHOLDER.test(body)) open.push(body);
  }
  return open;
}

/**
 * @typedef {Object} EpicDocs The docs of one epic, as `next --epic` reads them.
 * @property {boolean} valid The epic reference passed checkEpicName().
 * @property {string | null} reason Why the reference is not valid.
 * @property {boolean} exists The epic folder exists.
 * @property {boolean} isEpic The folder holds `epic-overview.md`.
 * @property {string | null} overviewError The read error of an epic-overview.md that exists.
 * @property {string[]} folders The feature folders, sorted. A reserved folder, and a name that is no feature reference, stay out.
 * @property {BuildOrder} buildOrder
 * @property {string[]} humanTests The open lines of human-testing.md.
 * @property {Record<string, StepVerdictFact>} stepVerdicts The verdict files of the epic briefs folder, by key.
 */

/**
 * Read the docs of a checked epic reference: the marker, the feature
 * folders, the Build Order, and the open lines of human-testing.md. Never
 * throws.
 *
 * @param {string} projectRoot
 * @param {ReturnType<typeof checkEpicName>} checked
 * @returns {EpicDocs}
 */
export function readEpicDocs(projectRoot, checked) {
  /** @type {EpicDocs} */
  const docs = {
    valid: checked.ok,
    reason: checked.ok ? null : checked.reason,
    exists: false,
    isEpic: false,
    overviewError: null,
    folders: [],
    humanTests: [],
    stepVerdicts: {},
    humanTests: [],
  };
  if (!checked.ok) return docs;
  const dir = path.join(projectRoot, 'docs', 'features', checked.name);
  docs.exists = isDirectory(dir);
  if (!docs.exists) return docs;

  const overview = readDoc(path.join(dir, 'epic-overview.md'));
  docs.isEpic = overview.exists;
  docs.overviewError = overview.error;
  try {
    docs.folders = fs
      .readdirSync(dir)
      .filter(
        (name) =>
          !RESERVED_EPIC_FOLDERS.includes(name) &&
          checkFeaturePath(`${checked.name}/${name}`).ok &&
          isDirectory(path.join(dir, name))
      )
      .sort();
  } catch {
    docs.folders = [];
  }
  docs.buildOrder = parseBuildOrder(overview.text, docs.folders);
  docs.humanTests = parseHumanTesting(readDoc(path.join(dir, 'human-testing.md')).text);
  docs.stepVerdicts = readStepVerdicts(path.join(projectRoot, '.beast-mode', 'briefs', checked.name));
  return docs;
}

/**
 * A new human-testing.md text from the template of
 * `.beast-mode/templates/human-testing.md`: the epic name and the time
 * filled in, and the placeholder section `## [feature]` left out. With no
 * template, the smallest file: the H1 only. Pure.
 *
 * @param {string | null} template
 * @param {string} epic
 * @param {string} time The `YYYY-MM-DD HH:MM` time of the write.
 * @returns {string}
 */
export function humanTestingFromTemplate(template, epic, time) {
  if (typeof template !== 'string' || template.trim().length === 0) return `# ${epic} - Human Testing\n`;
  /** @type {string[]} */
  const out = [];
  let placeholder = false;
  for (const line of template.split(/\r?\n/)) {
    if (/^##\s+\[[^\]]*\]\s*$/.test(line)) {
      placeholder = true;
      continue;
    }
    if (placeholder && SECTION_HEADING.test(line)) placeholder = false;
    if (!placeholder) out.push(line);
  }
  while (out.length > 0 && out[out.length - 1].trim() === '') out.pop();
  const filled = out.join('\n').split('[Epic Name]').join(epic).split('[epic]').join(epic).split('[YYYY-MM-DD HH:MM]').join(time);
  return `${filled}\n`;
}

/**
 * Append open human test lines at the end of the `## <feature>` section of
 * a human-testing.md text: append only, and no line that the section
 * already holds, open or checked. An absent section is added at the end
 * of the text. Every other line stays. Pure.
 *
 * @param {string} text
 * @param {string} feature The section name: the feature folder name.
 * @param {string[]} lines The texts of the open lines, without the box.
 * @returns {{ text: string, added: string[] }}
 */
export function appendHumanTests(text, feature, lines) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const rows = text.split(/\r?\n/);
  if (rows.length > 0 && rows[rows.length - 1] === '') rows.pop();

  let start = -1;
  let end = rows.length;
  let fence = null;
  for (let i = 0; i < rows.length; i += 1) {
    const mark = /^\s*(```|~~~)/.exec(rows[i])?.[1] ?? null;
    if (fence !== null) {
      if (mark === fence) fence = null;
      continue;
    }
    if (mark !== null) {
      fence = mark;
      continue;
    }
    if (start === -1) {
      if (/^##\s/.test(rows[i]) && rows[i].replace(/^##\s+/, '').trim() === feature) start = i;
    } else if (SECTION_HEADING.test(rows[i])) {
      end = i;
      break;
    }
  }

  /** @type {Set<string>} */
  const held = new Set();
  for (let i = start + 1; start !== -1 && i < end; i += 1) {
    const task = TASK_LINE.exec(rows[i].trimEnd());
    if (task) held.add((task[2] ?? '').trim());
  }
  /** @type {string[]} */
  const added = [];
  for (const line of lines) {
    const body = String(line).trim();
    if (body.length > 0 && !held.has(body) && !added.includes(body)) added.push(body);
  }
  if (added.length === 0) return { text, added };

  const boxes = added.map((body) => `- [ ] ${body}`);
  if (start === -1) {
    const out = [...rows];
    while (out.length > 0 && out[out.length - 1].trim() === '') out.pop();
    out.push(...(out.length > 0 ? [''] : []), `## ${feature}`, '', ...boxes);
    return { text: `${out.join(eol)}${eol}`, added };
  }
  let last = end - 1;
  while (last > start && rows[last].trim() === '') last -= 1;
  const insert = last === start ? ['', ...boxes] : boxes;
  return { text: `${[...rows.slice(0, last + 1), ...insert, ...rows.slice(last + 1)].join(eol)}${eol}`, added };
}

/**
 * @param {string} projectRoot
 * @param {string} epic A checked epic name.
 * @returns {string} The absolute path of the epic record.
 */
export function epicRecordPath(projectRoot, epic) {
  return path.join(projectRoot, '.beast-mode', 'briefs', epic, EPIC_RECORD_NAME);
}

/**
 * @param {string} epic
 * @returns {string} The project-relative path of the epic record.
 */
export function epicRecordRel(epic) {
  return `.beast-mode/briefs/${epic}/${EPIC_RECORD_NAME}`;
}

/**
 * A new, empty record of one epic run. It holds the epic docs tab, its
 * failed start, a failed git write of the epic branch, and the done mark
 * of the epic docs. Each lane keeps the record of its own feature.
 *
 * @param {string} epic
 * @returns {Record<string, any>}
 */
export function newEpicRecord(epic) {
  return {
    schema: RECORD_SCHEMA,
    epic,
    active: null,
    failedStart: null,
    done: { docs: false, steps: {} },
  };
}

/**
 * Read the record of one epic run, by the rules of readRecord(). Never
 * throws.
 *
 * @param {string} projectRoot
 * @param {string} epic A checked epic name.
 * @returns {{ record: Record<string, any> | null, note: string | null }}
 */
export function readEpicRecord(projectRoot, epic) {
  let body;
  try {
    body = fs.readFileSync(epicRecordPath(projectRoot, epic), 'utf8');
  } catch (err) {
    if (err && /** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') return { record: null, note: null };
    return { record: null, note: `The epic record at "${epicRecordRel(epic)}" cannot be read (${readErrorCode(err)}).` };
  }
  const record = parseRecord(body, epic, 'epic');
  if (record === null) {
    return { record: null, note: `The epic record at "${epicRecordRel(epic)}" does not parse as a record of schema ${RECORD_SCHEMA}.` };
  }
  return { record, note: null };
}

/**
 * Write the record of one epic run: a temporary file renamed over the
 * target. `schema` and `epic` lead the object. Throws on a write failure,
 * after it removes the temporary file.
 *
 * @param {string} projectRoot
 * @param {string} epic A checked epic name.
 * @param {Record<string, any>} record
 * @returns {string} The absolute path of the record.
 */
export function writeEpicRecord(projectRoot, epic, record) {
  const file = epicRecordPath(projectRoot, epic);
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });

  const { schema: _schema, epic: _epic, ...rest } = record;
  const body = `${JSON.stringify({ schema: RECORD_SCHEMA, epic, ...rest }, null, 2)}\n`;
  writeFileAtomic(file, body);
  return file;
}

// ---------------------------------------------------------------------------
// The lanes of a side-by-side group (Phase 6, rule E14)
// ---------------------------------------------------------------------------

/** The file that a lane worktree must hold, because every worker reads it first. */
export const HANDOFF_REL = '.beast-mode/phase-handoff.md';

/** The beast-mode keys of a branch that holds none. */
export const NO_KEYS = Object.freeze({ base: null, epic: null, feature: null, merged: null });

/** @typedef {{ base: string | null, epic: string | null, feature: string | null, merged: string | null }} RunKeys */

/**
 * @typedef {Object} WorktreeEntry One worktree of `git worktree list --porcelain`.
 * @property {string} path The absolute path of the worktree.
 * @property {string | null} head The commit of its HEAD.
 * @property {string | null} branch The branch of its HEAD, without `refs/heads/`. Null when detached.
 * @property {boolean} bare
 * @property {boolean} detached
 * @property {boolean} locked
 * @property {boolean} prunable Git lost the folder of the worktree.
 */

/**
 * A Build Order group builds side by side when two or more of its names
 * are left and `orchestration.concurrent` is true (rule E14). With one name
 * left, or `concurrent: false`, it builds one feature at a time (rule E13).
 *
 * @param {string[]} names The features of the group that are still in the run list.
 * @param {{ concurrent?: unknown } | null | undefined} orchestration The resolved orchestration object.
 * @returns {boolean}
 */
export function isConcurrentGroup(names, orchestration) {
  return Array.isArray(names) && names.length >= 2 && orchestration?.concurrent === true;
}

/**
 * Parse the lines of `git config --get-regexp` for the beast-mode keys:
 * `branch.<b>.beast-mode-<key> <value>`. A branch name can hold a dot, so
 * the key follows the last `.beast-mode-`. Never throws.
 *
 * @param {unknown} body
 * @returns {Map<string, RunKeys>}
 */
export function parseRunKeys(body) {
  /** @type {Map<string, RunKeys>} */
  const keys = new Map();
  for (const line of String(body ?? '').split('\n')) {
    const space = line.indexOf(' ');
    const match = /^branch\.(.+)\.beast-mode-(base|epic|feature|merged)$/.exec(space === -1 ? line.trim() : line.slice(0, space));
    if (!match) continue;
    const entry = keys.get(match[1]) ?? { ...NO_KEYS };
    entry[/** @type {keyof RunKeys} */ (match[2])] = space === -1 ? null : line.slice(space + 1).trim() || null;
    keys.set(match[1], entry);
  }
  return keys;
}

/**
 * Parse `git worktree list --porcelain`: one block per worktree, each led
 * by a `worktree <path>` line, with `HEAD`, `branch`, `detached`, `bare`,
 * `locked`, and `prunable` lines. Never throws.
 *
 * @param {unknown} body
 * @returns {WorktreeEntry[]}
 */
export function parseWorktreeList(body) {
  /** @type {WorktreeEntry[]} */
  const entries = [];
  /** @type {WorktreeEntry | null} */
  let current = null;
  for (const raw of String(body ?? '').split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    const space = line.indexOf(' ');
    const key = space === -1 ? line : line.slice(0, space);
    const value = space === -1 ? '' : line.slice(space + 1);
    if (key === 'worktree' && value) {
      current = { path: value, head: null, branch: null, bare: false, detached: false, locked: false, prunable: false };
      entries.push(current);
      continue;
    }
    if (!current || line.length === 0) continue;
    if (key === 'HEAD') current.head = value || null;
    else if (key === 'branch') current.branch = (value.startsWith('refs/heads/') ? value.slice('refs/heads/'.length) : value) || null;
    else if (key === 'bare') current.bare = true;
    else if (key === 'detached') current.detached = true;
    else if (key === 'locked') current.locked = true;
    else if (key === 'prunable') current.prunable = true;
  }
  return entries;
}

/**
 * @param {string} file
 * @returns {string} The real path of a file, else its resolved path.
 */
function realPath(file) {
  try {
    return fs.realpathSync(file);
  } catch {
    return path.resolve(file);
  }
}

/**
 * The child worktree of a lane: the worktree whose HEAD is the lane branch.
 * The workspace of the run itself never counts, and neither does a bare
 * entry or one whose folder git lost.
 *
 * @param {WorktreeEntry[]} entries
 * @param {string | null} branch The lane branch.
 * @param {string} mainRoot The workspace of the run.
 * @returns {WorktreeEntry | null}
 */
export function laneWorktree(entries, branch, mainRoot) {
  if (!branch) return null;
  const main = realPath(mainRoot);
  return entries.find((entry) => entry.branch === branch && !entry.bare && !entry.prunable && realPath(entry.path) !== main) ?? null;
}

/**
 * The branch of one lane, by its config keys: a branch whose
 * `beast-mode-epic` key names the epic and whose `beast-mode-feature` key
 * names the feature. Orca names the branch of a child worktree (Notes 6),
 * so the keys find it. A keyed branch with a child worktree wins, then
 * `feat/<epic>/<feature>`, then the first keyed branch in name order. Null
 * when no branch holds the keys of the lane.
 *
 * @param {Map<string, RunKeys>} keys From parseRunKeys().
 * @param {string} epic
 * @param {string} featurePath `<epic>/<feature>`.
 * @param {WorktreeEntry[]} entries From parseWorktreeList().
 * @param {string} mainRoot The workspace of the run.
 * @returns {string | null}
 */
export function laneBranchOf(keys, epic, featurePath, entries, mainRoot) {
  const keyed = [...keys]
    .filter(([, value]) => value.epic === epic && value.feature === featurePath)
    .map(([branch]) => branch)
    .sort();
  if (keyed.length === 0) return null;
  return keyed.find((branch) => laneWorktree(entries, branch, mainRoot)) ?? keyed.find((branch) => branch === `feat/${featurePath}`) ?? keyed[0];
}

/**
 * @param {string} root The root of a lane worktree.
 * @returns {boolean} The worktree holds `.beast-mode/phase-handoff.md`, so the project commits `.beast-mode/`.
 */
export function hasHandoff(root) {
  return isFile(path.join(root, ...HANDOFF_REL.split('/')));
}
