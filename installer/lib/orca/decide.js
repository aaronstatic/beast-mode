// installer/lib/orca/decide.js
//
// The decision of one `beast-mode orca next` call for one feature. Facts
// come in, and one action goes out: the first matching rule wins. Pure: no
// file, no process, no clock, and no environment. A `run` field holds the
// argument list of the next step, and steps.js turns it into the exact
// command line, so this module never names a path.
//
// Phase 3 holds the rules F1 to F18, F20, F21, and F23: the plan tab, every
// phase tab, the cross-phase review (in the last phase tab, or a review tab
// and a review-fix tab), the inbox tab, the docs tab, and the run summary.
// F5 checks the agent of every stage that the run still uses. F11 asks
// before a fresh run goes on with changes that no tab of the run owns, and
// F12 answers a stop request. The active rules A1 to A6 check the done
// proof of each stage, and they turn an escalation, an exit, a loss, and a
// broken circuit into a send, an ask, or a stop. An idle dsh tab whose
// subagent session still writes waits (fix 2): the child-activity fact of
// dsh.js comes in on the worker. F14 asks before a failed
// start runs again, and only as a retry of the same Orca Task. Until Phase
// 9, a split verify runs inside the phase tab (Notes 13). From Phase 9, a
// verify agent that differs from the implement agent gets its own tab: a
// complete phase with no PASS starts a verify tab, a FAIL starts a fix tab
// and then a verify tab again, up to three fix rounds, and the phase commits
// only after a PASS (rule F16). A git write or a
// send that failed stops the next call of the same run, so the coordinator
// never repeats it in a loop. The worker specs live in spec.js.
//
// Phase 5 adds decideEpic(): the rules E1 to E13 of `/orca-epic`. The run
// makes `epic/<epic>` from the default branch, and it takes the features of
// the Build Order one at a time. A lane runs the feature rules F13 to F21
// on its own branch, then the feature-end commit and the merge. The epic
// ends with the epic docs tab and no commit. A lane and the epic docs tab
// reuse the feature rules: the `target` of their facts names the run in
// each step line and in each fix.
//
// Phase 6 adds rule E14. With `concurrent: true`, the features of one
// Build Order item that are left build side by side. Each lane builds in a
// child worktree that Orca makes from `epic/<epic>`, on the branch that
// Orca names. Every lane runs the feature rules on the facts read inside
// its worktree. The first action that is not `wait` wins, in group order,
// else the run waits on every tab. A lane that holds a worktree keeps it to
// its merge, also when its group drops to one feature.

import {
  fillStepTokens,
  isConcurrentGroup,
  isPhaseComplete,
  phaseVerdictName,
  stepKey,
  stepPoint,
  stepVerdictName,
} from './read.js';
import { docsCommands, epicDocsCommands } from './spec.js';

/** The schema of every action. */
export const SCHEMA = 1;

/** A3: the sends of one tab before the run asks the user. */
export const SEND_BACK_CAP = 2;

/** A4: the resume or report sends to an idle tab before the run asks the user (Decision 6). */
export const ESCALATION_CAP = 1;

/** A4, fix 2: the `say` of an idle dsh tab whose subagent session still writes. */
export const DSH_WAIT_SAY = 'The dsh worker waits on its own subagent. The run waits for its report.';

/** F14: the failed starts of one `--retry-of` chain. Orca breaks the circuit at the third. */
export const START_FAILURE_CAP = 3;

/** F16: the fix rounds of one phase before the run asks the user (section 10 part 1). */
export const VERIFY_ROUND_CAP = 3;

/** The longest file list that the `dirty-start` question shows. */
const MAX_QUESTION_FILES = 5;

/** The longest file list that a `dirty-tree` stop shows. */
const MAX_LISTED_FILES = 20;

/** The longest detail list that a stop copies from a record. */
const MAX_DETAIL_LINES = 20;

/**
 * @typedef {'busy' | 'idle' | 'done' | 'failed' | 'gone' | 'circuit' | 'unknown'} WorkerState
 *   The state of one dispatch, normalized from `worker-show` by fact O3.
 */

/**
 * @typedef {Object} GitFacts
 * @property {boolean} workTree The project is inside a git work tree.
 * @property {string[]} detail Why the project is not a work tree.
 * @property {string[] | null} error The lines of a git read that failed after the work tree check.
 * @property {string | null} head The branch of HEAD, null when HEAD is detached.
 * @property {string | null} defaultBranch
 * @property {string | null} runBranch `feat/<path>`.
 * @property {boolean} runBranchExists
 * @property {string | null} base The `branch.<b>.beast-mode-base` value.
 * @property {string[]} dirty The changed files outside `.beast-mode/briefs/`.
 * @property {string[]} subjects The commit subjects of the run branch since its base.
 */

/** @typedef {import('./read.js').FeatureDocs} DocsFacts The feature docs, from readFeatureDocs(). */

/** The longest list of open inbox lines that the summary shows. */
const MAX_SUMMARY_LINES = 10;

/**
 * @typedef {Object} FeatureFacts
 * @property {string} feature The feature reference, for example "editor/ux".
 * @property {{ fresh: boolean, wake: string | null, dispatch: string | null, stop?: boolean, acceptDirty?: boolean }} flags
 * @property {string | null} terminalHandle The `ORCA_TERMINAL_HANDLE` value.
 * @property {import('./read.js').OrcaConfigRead} config
 * @property {string[]} harnesses The installed harness ids.
 * @property {GitFacts} git
 * @property {DocsFacts} docs
 * @property {{ record: Record<string, any> | null, note: string | null }} record
 * @property {{ running: boolean, detail: string[] } | null} orcaStatus Null when the call is not fresh.
 * @property {WorkerFact | null} worker Null with no active dispatch.
 * @property {RunTarget} [target] Set for a lane and for the epic docs tab of `/orca-epic`.
 */

/**
 * @typedef {Object} WorkerFact The state of the active dispatch, from `worker-show` by fact O3.
 * @property {WorkerState} state
 * @property {string[]} detail
 * @property {string | null} [terminal]
 * @property {{ active: boolean, detail: string[] }} [child] The child-activity fact of dsh.js (fix 2). steps.js
 *   reads it only for an idle dsh tab that rule A4 judges (wantsDshChild).
 */

/**
 * @typedef {Object} RunTarget The run that a step line and a fix name, in the facts of `/orca-epic`.
 * @property {string[]} args The flags that name the run in a step line.
 * @property {string} command The command that goes on with the run.
 * @property {boolean} lane The facts are a lane: its docs tab runs `/update-feature` only.
 */

/**
 * @param {{ feature: string, target?: RunTarget }} facts
 * @returns {string[]} The flags that name the run in a step line: `--feature <path>` for `/orca-feature`.
 */
function targetArgs(facts) {
  return facts.target ? [...facts.target.args] : ['--feature', facts.feature];
}

/**
 * @param {{ feature: string, target?: RunTarget }} facts
 * @returns {string} The command that goes on with the run: `/orca-feature <path>` for `/orca-feature`.
 */
function rerun(facts) {
  return facts.target ? facts.target.command : `/orca-feature ${facts.feature}`;
}

/**
 * Rules F2 to F4: the settings. Shared by `/orca-feature` and `/orca-epic`.
 *
 * @param {import('./read.js').OrcaConfigRead} config
 * @returns {Record<string, any> | null}
 */
function configStop(config) {
  if (config.state === 'missing') {
    return stop(
      'config-missing',
      'The project has no Orca settings.',
      ['.beast-mode/orca.json does not exist.'],
      'Run /orca-setup to write the settings, then run the command again.'
    );
  }
  if (config.state === 'invalid') {
    return stop(
      'config-invalid',
      '.beast-mode/orca.json fails the schema.',
      config.problems.map((problem) => `${problem.code} at ${problem.at}`),
      'Fix each problem in .beast-mode/orca.json, then run the command again.'
    );
  }
  if (!config.orchestration) {
    return stop(
      'orchestration-missing',
      'The Orca settings hold no orchestration object.',
      ['.beast-mode/orca.json holds no "orchestration" key.'],
      'Run /orca-setup to add the orchestration settings, then run the command again.'
    );
  }
  return null;
}

/**
 * Rule F5: the agent of each stage that the run still uses is installed.
 *
 * @param {{ stage: string, agent: string }[]} used
 * @param {string[]} harnesses
 * @returns {Record<string, any> | null}
 */
function harnessStop(used, harnesses) {
  const missing = used.filter((use) => !harnesses.includes(use.agent));
  if (missing.length === 0) return null;
  const first = missing[0];
  const agents = [...new Set(missing.map((use) => use.agent))];
  return stop(
    'harness-missing',
    missing.length === 1
      ? `The ${first.stage} stage runs on ${first.agent}, and Beast Mode is not installed for ${first.agent}.`
      : `${missing.length} stages of this run use a harness where Beast Mode is not installed.`,
    [
      ...missing.map((use) => `${use.what ?? `stages.${use.stage}`} is "${use.agent}".`),
      `The installed harnesses: ${harnesses.length > 0 ? harnesses.join(', ') : 'none'}.`,
    ],
    `Run ${agents.map((agent) => `"beast-mode install ${agent}"`).join(' and ')}, or set each stage above to an ` +
      'installed harness. Then run the command again.'
  );
}

/**
 * Rule F6: the work tree, a git read, and the default branch.
 *
 * @param {{ workTree: boolean, detail: string[], error: string[] | null, defaultBranch: string | null }} git
 * @returns {Record<string, any> | null}
 */
function gitStop(git) {
  if (!git.workTree) {
    return stop(
      'not-git',
      'The project is not a git work tree.',
      git.detail,
      'Run "git init" and make a first commit, then run the command again.'
    );
  }
  if (git.error) {
    return stop(
      'git-failed',
      'A git read failed.',
      git.error,
      'Fix the git error above, then run the command again.'
    );
  }
  if (!git.defaultBranch) {
    return stop(
      'no-default-branch',
      'The project has no default branch.',
      ['origin/HEAD names no branch, and no main or master branch exists.'],
      'Make a first commit on main, then run the command again.'
    );
  }
  return null;
}

/**
 * @param {string} epic
 * @returns {string} The branch of `/orca-epic`. Every lane merges into it.
 */
export function epicBranchOf(epic) {
  return `epic/${epic}`;
}

/**
 * @param {string} feature `<epic>/<feature>`.
 * @returns {string} The subject of the feature-end commit of a lane.
 */
export function featureSubject(feature) {
  return `feat: ${feature}`;
}

/**
 * @param {string} feature `<epic>/<feature>`.
 * @param {string} epic
 * @returns {string} The message of the merge commit of a lane.
 */
export function mergeSubject(feature, epic) {
  return `Merge ${feature} into ${epicBranchOf(epic)}`;
}

/**
 * @param {string} feature `<epic>/<feature>`.
 * @returns {string} The subject of the human test commit after a merge.
 */
export function humanTestsSubject(feature) {
  return `docs: ${feature} human testing`;
}

/**
 * @param {string} feature
 * @returns {string} The run branch of `/orca-feature`, and the lane branch of `<epic>/<feature>`.
 */
export function runBranchOf(feature) {
  return `feat/${feature}`;
}

/**
 * @param {string} feature
 * @param {number} phase
 * @returns {string} The commit subject of one phase.
 */
export function phaseSubject(feature, phase) {
  return `feat: ${feature} phase ${phase}`;
}

/**
 * @param {string} feature
 * @returns {string} The commit subject of the split review fixes.
 */
export function reviewSubject(feature) {
  return `fix: ${feature} cross-phase review`;
}

/**
 * Where the cross-phase review runs (Decision 8). `off` for `review: false`.
 * `tab` when the review agent equals the implement agent: the last phase
 * tab holds the review. Else `split`: a review tab writes the findings, and
 * a review-fix tab on the implement agent fixes them.
 *
 * @param {{ implement: string, review: string | false }} stages
 * @returns {'off' | 'tab' | 'split'}
 */
export function reviewPlacement(stages) {
  if (stages.review === false) return 'off';
  return stages.review === stages.implement ? 'tab' : 'split';
}

/**
 * @param {string} reason
 * @param {string} say
 * @param {string[]} detail
 * @param {string} fix
 * @param {Record<string, unknown>} [extra]
 * @returns {Record<string, any>}
 */
function stop(reason, say, detail, fix, extra = {}) {
  return { schema: SCHEMA, action: 'stop', say, reason, detail, fix, ...extra };
}

/**
 * @param {string} value
 * @returns {string}
 */
function capital(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * @param {number} n
 * @param {string} noun
 * @returns {string}
 */
function countText(n, noun) {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

/**
 * @param {string[]} files
 * @returns {string[]}
 */
function fileLines(files) {
  const shown = files.slice(0, MAX_LISTED_FILES);
  if (files.length > shown.length) shown.push(`and ${files.length - shown.length} more`);
  return shown;
}

/**
 * @param {unknown} detail
 * @returns {string[]}
 */
function detailLines(detail) {
  if (!Array.isArray(detail)) return [];
  return detail.filter((line) => typeof line === 'string').slice(0, MAX_DETAIL_LINES);
}

/**
 * @param {{ number: number, name: string }} phase
 * @returns {string} "Phase 2 - Name", or "Phase 2" for a heading with no name.
 */
function phaseLabel(phase) {
  return phase.name ? `Phase ${phase.number} - ${phase.name}` : `Phase ${phase.number}`;
}

/**
 * @param {string} feature
 * @param {Record<string, any>} active
 * @returns {string} The name of the tab of an active dispatch.
 */
function tabName(feature, active) {
  if (active.stage === 'phase' && active.phase) return `the Phase ${active.phase} tab of ${feature}`;
  if ((active.stage === 'verify' || active.stage === 'fix') && active.phase) {
    return `the ${active.stage} tab of Phase ${active.phase} of ${feature}`;
  }
  if (active.stage === 'step' && typeof active.stepCommand === 'string') {
    return `the step tab "${active.stepCommand}" of ${feature}`;
  }
  return `the ${active.stage} tab of ${feature}`;
}

/**
 * @param {string} feature
 * @param {Record<string, any>} entry An active entry or a failed start.
 * @returns {string} The question prefix of the stage, for example "demo phase 2".
 */
function tagOf(feature, entry) {
  if (entry.stage === 'step') return `${feature} step ${entry.point ?? ''}`.trim();
  if ((entry.stage === 'verify' || entry.stage === 'fix') && entry.phase) return `${feature} phase ${entry.phase} ${entry.stage}`;
  return `${feature} ${entry.stage === 'phase' && entry.phase ? `phase ${entry.phase}` : entry.stage ?? 'run'}`;
}

/**
 * @param {Record<string, any>} entry An active entry or a failed start.
 * @returns {string} The work of the stage, for example "Phase 2" or "the review stage".
 */
function stageWords(entry) {
  if (entry.stage === 'step') return 'the same step';
  if (entry.stage === 'verify' && entry.phase) return `the verification of Phase ${entry.phase}`;
  if (entry.stage === 'fix' && entry.phase) return `the fix of Phase ${entry.phase}`;
  return entry.stage === 'phase' && entry.phase ? `Phase ${entry.phase}` : `the ${entry.stage ?? 'same'} stage`;
}

/**
 * Add the note of the record read to `say`.
 *
 * @param {Record<string, any>} action
 * @param {string | null} note
 * @returns {Record<string, any>}
 */
function withNote(action, note) {
  return note && action.reason !== RECORD_UNREADABLE ? { ...action, say: `${action.say} Note: ${note}` } : action;
}

/** The stop code of a run record that exists and cannot be read or does not parse (CR-1). */
export const RECORD_UNREADABLE = 'record-unreadable';

/**
 * Rules F7a and E6a: a run record that exists and cannot be read, or does
 * not parse, stops the run before any Orca call. The record names the
 * active dispatch, so the run never reads it as absent: a new start would
 * open a second tab on the same work tree (CR-1).
 *
 * @param {string[]} notes The note of each record read.
 * @param {string[]} runs The feature or the epic of each record.
 * @param {string} command The command that goes on with the run.
 * @param {Record<string, unknown>} [extra]
 * @returns {Record<string, any>}
 */
function recordStop(notes, runs, command, extra = {}) {
  return stop(
    RECORD_UNREADABLE,
    notes.length === 1
      ? 'The run record cannot be read, so the run cannot tell which tab is open.'
      : `${notes.length} run records cannot be read, so the run cannot tell which tabs are open.`,
    notes,
    `Check Orca for an open tab of ${wordList(runs)}, then move the file away and run ${command} again. ` +
      'For a file that cannot be read, fix its permission instead.',
    extra
  );
}

/**
 * The rules F1 to F8: the checks that need no Orca call. steps.js runs the
 * Orca reads only when this answers null, and decideFeature() starts here.
 *
 * @param {FeatureFacts} facts
 * @returns {Record<string, any> | null}
 */
export function setupStop(facts) {
  const { feature, config, git, docs } = facts;

  // F1
  if (!facts.terminalHandle) {
    return stop(
      'not-orca-tab',
      'This run needs an Orca agent tab.',
      ['ORCA_TERMINAL_HANDLE is not set, so this shell is not an Orca terminal.'],
      `Open an agent tab in Orca, and run /orca-feature ${feature} there.`
    );
  }

  // F2 to F4
  const unset = configStop(config);
  if (unset) return unset;

  // F5: the agent of every stage that the run still uses.
  const missing = harnessStop(stagesInUse(facts), facts.harnesses);
  if (missing) return missing;

  // F6
  const broken = gitStop(git);
  if (broken) return broken;

  // F7
  if (!docs.valid) {
    return stop(
      'feature-missing',
      'The feature reference is not valid.',
      [docs.reason ?? 'The feature reference is not valid.'],
      'Run the command with a feature name, or with <epic>/<feature>.'
    );
  }
  if (!docs.exists) {
    return stop(
      'feature-missing',
      `The feature ${feature} does not exist.`,
      [`docs/features/${feature}/ does not exist.`],
      `Check the name. Run /plan-feature ${feature} to plan a new feature.`
    );
  }
  if (docs.isEpic) {
    return stop(
      'feature-missing',
      `${feature} is an epic, not a feature.`,
      [`docs/features/${feature}/ holds epic-overview.md.`],
      `Run the command with one feature of the epic: ${feature}/<feature>.`
    );
  }

  // F7a: a run record that cannot be read is never an absent record (CR-1).
  if (facts.record?.note) return recordStop([facts.record.note], [feature], `/orca-feature ${feature}`);

  // F8: the plan needs an input. A tasks.md that cannot be read stops too.
  // No tasks.md runs the plan tab (F15). A tasks.md with no phase stops at
  // F15, after the active rules, so a plan tab that writes it is not cut off.
  if (docs.tasksError) {
    return stop(
      'no-tasks',
      `The task list of ${feature} cannot be read.`,
      [`docs/features/${feature}/tasks.md cannot be read: ${docs.tasksError}`],
      'Fix the file permission, then run the command again.'
    );
  }
  if (!docs.has.requirements && !docs.has.implementation) {
    return stop(
      'no-plan-input',
      `The feature ${feature} has no requirements.md and no implementation.md.`,
      [`docs/features/${feature}/ holds neither requirements.md nor implementation.md.`],
      `Write docs/features/${feature}/requirements.md, or run /plan-feature ${feature}. Then run the command again.`
    );
  }

  return null;
}

/**
 * @param {FeatureFacts} facts
 * @returns {import('./read.js').Orchestration} The resolved orchestration object. Rule F4 passed.
 */
function orchestrationOf(facts) {
  return /** @type {any} */ (facts.config).orchestration;
}

/**
 * The code of a new lane whose worktree Orca refused for a project command
 * (fact O15, Notes 8): a start refusal, a failed start code, and a stop.
 */
export const LANE_REFUSED = 'lane-worktree-refused';

/**
 * The project command of one agent (Decision 16): `agents.<id>.command` of
 * a valid orca.json, else null. The reader checked it by the launch-config
 * rule, so it is one line of safe words. It runs exactly as written.
 *
 * @param {import('./read.js').OrcaConfigRead | null | undefined} config
 * @param {unknown} agent
 * @returns {string | null}
 */
export function projectCommandOf(config, agent) {
  if (!config || config.state !== 'valid' || typeof agent !== 'string') return null;
  const agents = /** @type {Record<string, any>} */ (config.config).agents;
  if (agents === null || typeof agents !== 'object' || Array.isArray(agents)) return null;
  const entry = Object.prototype.hasOwnProperty.call(agents, agent) ? agents[agent] : null;
  const command = entry !== null && typeof entry === 'object' ? entry.command : undefined;
  return typeof command === 'string' && command.length > 0 ? command : null;
}

/**
 * A start action names its path: `agent` (`worker-start --agent`), or
 * `command` (the project command of the agent, Decision 16). The say of the
 * command path names the command after the agent. Any other action, and
 * the say of the agent path, stay as they are.
 *
 * @param {{ config: import('./read.js').OrcaConfigRead }} facts
 * @param {Record<string, any>} action
 * @returns {Record<string, any>}
 */
function withLaunchPath(facts, action) {
  if (action.action !== 'start') return action;
  const command = projectCommandOf(facts.config, action.agent);
  if (!command) return { ...action, path: 'agent', command: null };
  const named = ` on ${action.agent}`;
  const at = action.say.indexOf(named);
  const how = ` with the project command "${command}"`;
  const say =
    at === -1 ? `${action.say}${how.replace(' with', ' It starts with')}.` : `${action.say.slice(0, at + named.length)}${how}${action.say.slice(at + named.length)}`;
  return { ...action, say, path: 'command', command };
}

/**
 * @param {FeatureFacts} facts
 * @returns {boolean} The record marks the docs tab done.
 */
function docsDone(facts) {
  return facts.record?.record?.done?.docs === true;
}

/**
 * @param {FeatureFacts} facts
 * @returns {boolean} The record marks an inbox tab done since the last start of new work.
 */
function inboxDone(facts) {
  return facts.record?.record?.done?.inbox === true;
}

/**
 * @param {FeatureFacts} facts
 * @returns {boolean} The verify agent differs from the implement agent, so a verify tab runs.
 */
function verifySplit(facts) {
  const { stages } = orchestrationOf(facts);
  return stages.verify !== stages.implement;
}

/**
 * @param {FeatureFacts} facts
 * @param {number} phase
 * @returns {import('./read.js').PhaseVerdictFact | null} The phase verdict file, or null.
 */
function verdictOf(facts, phase) {
  return facts.docs.phaseVerdicts?.[String(phase)] ?? null;
}

/**
 * @param {FeatureFacts} facts
 * @param {number} phase
 * @returns {number} The fix rounds of the phase in the run record.
 */
function verifyRound(facts, phase) {
  const round = facts.record?.record?.verify?.[String(phase)]?.round;
  return Number.isInteger(round) && round > 0 ? round : 0;
}

/**
 * A split verify still has work: a phase is open, or a complete phase has no
 * PASS verdict and no phase commit.
 *
 * @param {FeatureFacts} facts
 * @returns {boolean}
 */
function verifyPending(facts) {
  const subjects = facts.git?.subjects ?? [];
  return (facts.docs.tasks?.phases ?? []).some(
    (phase) =>
      !isPhaseComplete(phase) ||
      (verdictOf(facts, phase.number)?.verdict !== 'PASS' && !subjects.includes(phaseSubject(facts.feature, phase.number)))
  );
}

/**
 * The stages whose agent this run still uses (rule F5), in run order: the
 * plan while `implementation.md` or `tasks.md` is missing, the implement
 * stage always (the phases and the review fixes), a split review tab while
 * `code-review.md` is missing, and the docs tab until the record marks it.
 * A split verify (the verify agent differs from the implement agent) uses
 * its agent while a phase has no PASS and no phase commit.
 *
 * @param {FeatureFacts} facts
 * @returns {{ stage: string, agent: string }[]}
 */
function stagesInUse(facts) {
  const { stages } = orchestrationOf(facts);
  const { docs } = facts;
  /** @type {{ stage: string, agent: string }[]} */
  const used = [];
  if (docs.exists && !docs.isEpic && (!docs.has.implementation || !docs.has.tasks)) {
    used.push({ stage: 'plan', agent: stages.plan });
  }
  used.push({ stage: 'implement', agent: stages.implement });
  if (verifySplit(facts) && !docsDone(facts) && verifyPending(facts)) used.push({ stage: 'verify', agent: stages.verify });
  if (reviewPlacement(stages) === 'split' && !docs.has.codeReview) {
    used.push({ stage: 'review', agent: /** @type {string} */ (stages.review) });
  }
  used.push(...stepsInUse(facts));
  if (!docsDone(facts)) used.push({ stage: 'docs', agent: stages.docs });
  return used;
}

/**
 * The step lines of the settings that hold a valid point, each with its index.
 *
 * @param {{ config: import('./read.js').OrcaConfigRead }} facts
 * @returns {{ after: string, command: string, agent: string, k: number }[]}
 */
function stepLinesOf(facts) {
  const steps = orchestrationOf(/** @type {any} */ (facts)).steps;
  if (!Array.isArray(steps)) return [];
  return steps
    .map((line, k) => ({ ...line, k }))
    .filter((line) => typeof line.command === 'string' && ['phase', 'feature', 'epic'].includes(line.after));
}

/**
 * @param {{ record: { record: Record<string, any> | null } | null | undefined }} facts
 * @returns {Record<string, unknown>} The step marks of the run record: `feature:0` is `PASS` or `overridden`.
 */
function stepMarks(facts) {
  const marks = facts.record?.record?.done?.steps;
  return marks !== null && typeof marks === 'object' ? marks : {};
}

/**
 * The first step line of one point with no mark in the record. A step runs
 * once per point, also after a resume: the mark is the proof.
 *
 * @param {FeatureFacts} facts
 * @param {'phase' | 'feature' | 'epic'} after
 * @param {number | null} [phase] The phase of a phase step.
 * @returns {{ after: string, command: string, agent: string, k: number } | null}
 */
function pendingStep(facts, after, phase = null) {
  const point = stepPoint(after, phase);
  const marks = stepMarks(facts);
  return stepLinesOf(facts).find((line) => line.after === after && !marks[stepKey(point, line.k)]) ?? null;
}

/**
 * The start action of one step tab. Its command has the tokens filled
 * (`{feature}`, `{phase}`, `{epic}`). The `say` keeps " on <agent>", so the
 * launch path of the agent can follow it.
 *
 * @param {FeatureFacts} facts
 * @param {{ after: string, command: string, agent: string, k: number }} line
 * @param {number | null} phase
 * @returns {Record<string, any>}
 */
function stepStartAction(facts, line, phase) {
  const point = stepPoint(line.after, phase);
  const command = fillStepTokens(line.command, { feature: facts.feature, phase, epic: facts.feature });
  const where = line.after === 'phase' ? ` after Phase ${phase}` : '';
  return {
    schema: SCHEMA,
    action: 'start',
    say: `Start the step tab of ${facts.feature}${where} on ${line.agent}: ${command}.`,
    run: [
      'start',
      ...targetArgs(facts),
      '--stage',
      'step',
      '--step',
      String(line.k),
      ...(line.after === 'phase' ? ['--phase', String(phase)] : []),
    ],
    feature: facts.feature,
    stage: 'step',
    phase: line.after === 'phase' ? phase : null,
    step: line.k,
    point,
    stepCommand: command,
    agent: line.agent,
    placement: 'current',
    verdictFile: stepVerdictName(point, line.k),
  };
}

/**
 * The agents of the step lines that the feature run still uses (rule F5).
 * A feature step counts until its mark is set. A phase step counts while a
 * phase is open, and for the last phase until its mark is set. The docs
 * tab ends the run, so no step counts after it.
 *
 * @param {FeatureFacts} facts
 * @returns {{ stage: string, agent: string, what: string }[]}
 */
function stepsInUse(facts) {
  if (docsDone(facts)) return [];
  const marks = stepMarks(facts);
  const phases = facts.docs.tasks?.phases ?? [];
  const last = phases.at(-1);
  const anyOpen = phases.some((phase) => !isPhaseComplete(phase));
  return stepLinesOf(facts)
    .filter((line) => {
      if (line.after === 'feature') return !marks[stepKey('feature', line.k)];
      if (line.after !== 'phase') return false;
      return anyOpen || (last !== undefined && !marks[stepKey(stepPoint('phase', last.number), line.k)]);
    })
    .map((line) => ({ stage: 'step', agent: line.agent, what: `orchestration.steps[${line.k}].agent` }));
}

/**
 * Rule F19: the feature steps run after the review, before the inbox and
 * the docs. Each runs once, and the docs tab ends the run.
 *
 * @param {FeatureFacts} facts
 * @returns {Record<string, any> | null}
 */
function featureStepRule(facts) {
  if (docsDone(facts)) return null;
  const line = pendingStep(facts, 'feature');
  return line ? stepStartAction(facts, line, null) : null;
}

/**
 * Rule F9: a fresh call whose `status --json` failed, or names an app that
 * does not run.
 *
 * @param {FeatureFacts} facts
 * @returns {Record<string, any> | null}
 */
function orcaRule(facts) {
  const status = facts.orcaStatus;
  if (!facts.flags.fresh || !status || status.running) return null;
  return stop(
    'orca-not-running',
    'Orca does not answer.',
    status.detail,
    'Start Orca, then run the command again.'
  );
}

/**
 * Rule F10: HEAD is not the run branch. A dirty tree stops. A switch that
 * failed in this run stops too, and a fresh call tries it again.
 *
 * @param {FeatureFacts} facts
 * @returns {Record<string, any> | null}
 */
function branchRule(facts) {
  const { feature, git } = facts;
  const branch = git.runBranch ?? runBranchOf(feature);
  if (git.head === branch) return null;

  if (git.dirty.length > 0) {
    return stop(
      'dirty-tree',
      `The work tree has changes, so the run cannot switch to ${branch}.`,
      fileLines(git.dirty),
      'Commit the changes, or move them out of the work tree. Then run the command again.'
    );
  }

  const failed = facts.record?.record?.failedGit;
  if (failed && failed.step === 'branch' && !facts.flags.fresh) {
    return stop(
      'branch-failed',
      `The switch to ${branch} failed.`,
      detailLines(failed.detail),
      `Fix the cause above, then run ${rerun(facts)} again.`
    );
  }

  const create = !git.runBranchExists;
  const base = create ? git.defaultBranch : (git.base ?? git.defaultBranch);
  return {
    schema: SCHEMA,
    action: 'branch',
    say: create ? `Create the branch ${branch} from ${base}.` : `Switch to the branch ${branch}.`,
    run: ['branch', ...targetArgs(facts)],
    branch,
    base,
    create,
  };
}

/**
 * @param {FeatureFacts} facts
 * @returns {boolean} The newest complete phase has no commit subject yet, no later phase
 *   holds a done task, and no end stage has run. Its changes are then the work of this run.
 */
function newestPhaseAwaitsCommit(facts) {
  const review = reviewState(facts);
  if (docsDone(facts) || inboxDone(facts) || (review.placement === 'split' && review.state !== 'missing')) return false;
  const phases = facts.docs.tasks?.phases ?? [];
  return phases.some(
    (phase, i) =>
      isPhaseComplete(phase) &&
      !facts.git.subjects.includes(phaseSubject(facts.feature, phase.number)) &&
      !phases.slice(i + 1).some((entry) => entry.done > 0)
  );
}

/**
 * Rule F11: a fresh run on the run branch finds changes in the work tree,
 * and the call holds no `--accept-dirty`. The next commit of the run would
 * take those changes, so the run asks first (R5). A record with an active
 * dispatch skips the rule, because the tab owns the changes and the active
 * rules decide (A1 names a busy tab). A git write that failed in the run
 * skips it too: the changes are the work that it tried to commit, and the
 * fresh call tries again. Under the `feature` cadence no commit takes the
 * changes, so the rule never asks.
 *
 * @param {FeatureFacts} facts
 * @returns {Record<string, any> | null}
 */
function dirtyStartRule(facts) {
  const { feature, git, flags } = facts;
  if (!flags.fresh || flags.acceptDirty === true || git.dirty.length === 0) return null;
  const record = facts.record?.record;
  if (record?.active || record?.failedGit) return null;
  if (orchestrationOf(facts).commit !== 'phase') return null;
  // The changes are the work of the run, not a stray start state: the docs tab left them
  // (as in the lane rule E11), or the newest complete phase still waits for its commit.
  if (docsDone(facts) || newestPhaseAwaitsCommit(facts)) return null;

  const branch = git.runBranch ?? runBranchOf(feature);
  const listed = git.dirty.slice(0, MAX_QUESTION_FILES).join(', ');
  const more = git.dirty.length > MAX_QUESTION_FILES ? `, and ${git.dirty.length - MAX_QUESTION_FILES} more` : '';
  return {
    schema: SCHEMA,
    action: 'ask',
    reason: 'dirty-start',
    say: `The work tree of ${branch} holds ${countText(git.dirty.length, 'changed file')} at the start of the run.`,
    question:
      `[${feature}] The work tree holds ${countText(git.dirty.length, 'changed file')}: ${listed}${more}. ` +
      'The next commit of the run takes them. What now?',
    options: [
      {
        key: 'stop',
        label: 'Stop the run. Commit the changes, or move them out of the work tree. Then run the command again.',
        run: null,
      },
      {
        key: 'go-on',
        label: 'Go on with the changes. The next commit of the run takes them.',
        run: ['next', ...targetArgs(facts), '--fresh', '--accept-dirty'],
      },
    ],
    recommended: 'stop',
    feature,
    files: fileLines(git.dirty),
  };
}

/**
 * The `done` action of a stop request: where the run stands, and the
 * command that goes on from there.
 *
 * @param {FeatureFacts} facts
 * @param {Record<string, any> | null} active The tab that stays open, if any.
 * @returns {Record<string, any>}
 */
function stoppedDone(facts, active) {
  const { feature, git, docs } = facts;
  const branch = git.runBranch ?? runBranchOf(feature);
  const lines = [`Run stopped on request - ${feature}`, ''];
  const phases = docs.tasks?.phases ?? [];
  if (phases.length > 0) {
    lines.push('Phases:');
    for (const phase of phases) {
      const subject = phaseSubject(feature, phase.number);
      const state = git.subjects.includes(subject)
        ? `committed as "${subject}"`
        : isPhaseComplete(phase)
          ? 'complete, with no phase commit'
          : `${phase.done} of ${countText(phase.total, 'task')} done`;
      lines.push(`- ${phaseLabel(phase)}: ${state}`);
    }
    lines.push('');
  }
  if (active) {
    lines.push(`Open tab: ${tabName(feature, active)} on ${active.agent ?? 'its agent'}, dispatch ${active.dispatchId}. It stays open in Orca.`);
  }
  lines.push(git.dirty.length === 0 ? 'Uncommitted: none.' : `Uncommitted: ${countText(git.dirty.length, 'file')} on ${branch}.`);
  lines.push('', 'Next:', `- Run /orca-feature ${feature} to go on from here.`);
  return {
    schema: SCHEMA,
    action: 'done',
    say: `The run of ${feature} stopped on request.`,
    show: lines.join('\n'),
  };
}

/**
 * Rule F12: `--stop`. While the tab of the record works (busy, or a state
 * that Orca cannot read), the run waits for its report, so no work is cut
 * off. Else the run ends with "stopped on request". A tab that reported
 * stays in the record, and the next run closes and commits it. The rule
 * runs before F10 and F11, so a stop request starts no git write.
 *
 * @param {FeatureFacts} facts
 * @returns {Record<string, any> | null}
 */
function stopRule(facts) {
  if (facts.flags.stop !== true) return null;
  const active = facts.record?.record?.active ?? null;
  const state = facts.worker?.state ?? 'unknown';
  if (active && (state === 'busy' || state === 'unknown')) {
    const tab = tabName(facts.feature, active);
    return {
      ...waitAction(facts, active),
      say: `The run stops after ${tab} reports. Orca wakes this tab when it reports.`,
    };
  }
  return stoppedDone(facts, active);
}

/**
 * @param {FeatureFacts} facts
 * @param {Record<string, any>} active
 * @returns {Record<string, any>}
 */
function waitAction(facts, active) {
  const tab = tabName(facts.feature, active);
  return {
    schema: SCHEMA,
    action: 'wait',
    say: `${capital(tab)} works on ${active.agent ?? 'its agent'}. Orca wakes this tab when it reports.`,
    workers: [
      {
        feature: facts.feature,
        stage: active.stage,
        phase: active.phase,
        agent: active.agent,
        dispatchId: active.dispatchId,
      },
    ],
  };
}

/**
 * The stop of a tab that this version cannot judge: a report of a stage
 * that the record names and this version does not run.
 *
 * @param {FeatureFacts} facts
 * @param {Record<string, any>} active
 * @param {string} what What happened to the tab, for example "is gone".
 * @param {string[]} detail
 * @returns {Record<string, any>}
 */
function workerStopped(facts, active, what, detail) {
  const tab = tabName(facts.feature, active);
  return stop(
    'worker-stopped',
    `${capital(tab)} ${what}.`,
    [`${capital(tab)} runs on ${active.agent ?? 'its agent'}, dispatch ${active.dispatchId}.`, ...detail],
    `Check the tab in Orca. To drop it and start over, run {run}. Then run ${rerun(facts)} again.`,
    // `--discard` marks no stage done, so a lost docs tab runs again.
    { fixRun: ['close', ...targetArgs(facts), '--discard'] }
  );
}

/**
 * The slice block of a phase with a Demo line (`phase-handoff.md` section
 * 10 part 3, in its autorun form). Null for no Demo line, and for a Demo
 * line that starts with "none". The `Verifier:` line reads the demo result
 * on the last line of the phase verdict file (Phase 9): the phase tab wrote
 * it (verify equal to implement), or the verify tab wrote it (split). With
 * no demo result, the line stays out.
 *
 * @param {import('./read.js').TasksPhase | undefined} phase
 * @param {import('./read.js').PhaseVerdictFact | null} [fact] The verdict file of the phase.
 * @returns {string | null}
 */
function sliceBlock(phase, fact = null) {
  if (!phase || !phase.demo || /^none\b/i.test(phase.demo)) return null;
  const demo = fact?.demo ?? null;
  return [
    `Slice ready: Phase ${phase.number} - ${phase.name || phase.title}`,
    `Demo: ${phase.demo}`,
    ...(demo && demo !== 'none' ? [`Verifier: Demo ${demo}`] : []),
    'The run goes on. Try the demo when you can.',
  ].join('\n');
}

/**
 * The `send` action of one reason. A send of the same reason that failed in
 * this run stops `send-failed` instead, so the coordinator never repeats it
 * in a loop. A fresh call sends again.
 *
 * @param {FeatureFacts} facts
 * @param {Record<string, any>} active
 * @param {'open-tasks' | 'escalation' | 'report' | 'missing-verdict'} reason
 * @param {string[]} open
 * @param {string} say
 * @returns {Record<string, any>}
 */
function sendAction(facts, active, reason, open, say) {
  const { feature } = facts;
  const failed = active.failedSend;
  if (failed && failed.reason === reason && !facts.flags.fresh) {
    const tab = tabName(feature, active);
    return stop(
      'send-failed',
      `The send to ${tab} failed.`,
      detailLines(failed.detail),
      `Fix the cause above, then run ${rerun(facts)} again.`
    );
  }
  return {
    schema: SCHEMA,
    action: 'send',
    say,
    run: ['send', ...targetArgs(facts), '--reason', reason],
    feature,
    dispatchId: active.dispatchId,
    reason,
    open,
  };
}

/**
 * @param {FeatureFacts['flags']} flags
 * @param {Record<string, any>} active
 * @returns {boolean} The call is an escalation wake for this tab: a wake with no dispatch, or with its dispatch.
 */
function escalatedFor(flags, active) {
  const forThisTab = !flags.dispatch || flags.dispatch === active.dispatchId;
  return flags.wake === 'escalation' && forThisTab;
}

/**
 * Rule A4 reads the child-activity fact (fix 2) of an idle dsh tab only, on
 * an escalation wake for that tab or on a fresh call. steps.js asks this
 * before it reads the dsh home, so no other path reads a file. A stop
 * request needs no fact: rule F12 runs first.
 *
 * @param {FeatureFacts['flags']} flags
 * @param {Record<string, any> | null | undefined} active
 * @param {{ state: WorkerState } | null | undefined} worker
 * @returns {boolean}
 */
export function wantsDshChild(flags, active, worker) {
  if (!active || active.agent !== 'dsh' || worker?.state !== 'idle' || flags.stop === true) return false;
  return flags.fresh === true || escalatedFor(flags, active);
}

/**
 * The escalation sends of a tab that count against ESCALATION_CAP. A tab
 * whose open items dropped below the count of the last escalation send
 * (`escalationOpen`) made progress, so its count starts again at 0 (fix 2).
 * `next` writes nothing: the next escalation send writes the new count.
 *
 * @param {Record<string, any>} active
 * @param {number | null} open The open items of the stage now. Null when the stage has no done check.
 * @returns {number}
 */
export function escalationsOf(active, open) {
  const before = active.escalationOpen;
  if (typeof open === 'number' && Number.isInteger(before) && open < before) return 0;
  return active.escalations;
}

/**
 * The record counts of one good send (P3-16). An open-tasks or a verdict
 * send adds 1 to `sendBacks`. A resume or a report send adds 1 to the count
 * of escalationsOf(), and it records the open items at the send as
 * `escalationOpen`, for the progress check of the next wake.
 *
 * @param {Record<string, any>} active
 * @param {string} reason
 * @param {number} open The open items of the stage at the send.
 * @returns {Record<string, number>}
 */
export function sendCounts(active, reason, open) {
  if (reason === 'escalation' || reason === 'report') {
    return { escalations: escalationsOf(active, open) + 1, escalationOpen: open };
  }
  return { sendBacks: active.sendBacks + 1 };
}

/**
 * Rule A4, fix 2: an idle dsh tab with open work whose subagent session
 * still writes. dsh brings the result of the subagent in as a new turn, so
 * the run sends nothing and counts no escalation. The tab reports when its
 * work is done.
 *
 * @param {FeatureFacts} facts
 * @param {Record<string, any>} active
 * @param {WorkerFact} worker
 * @returns {Record<string, any>}
 */
function dshWaitAction(facts, active, worker) {
  return { ...waitAction(facts, active), say: DSH_WAIT_SAY, detail: [...(worker.child?.detail ?? [])] };
}

/**
 * Rule A4 past its cap: an idle tab that got its one send and is idle
 * again. With the done proof met, the user can close the tab. Else the
 * user can drop it for a new tab.
 *
 * @param {FeatureFacts} facts
 * @param {Record<string, any>} active
 * @param {{ pass: boolean, open: string[], what: string } | null} check
 * @param {{ detail: string[] }} worker
 * @returns {Record<string, any>}
 */
function escalationCapAsk(facts, active, check, worker) {
  const { feature } = facts;
  const tab = tabName(feature, active);
  const done = check?.pass === true;
  const what = check ? check.what : `the run record names the stage "${active.stage}"`;
  const options = done
    ? [
        {
          key: 'close',
          label: `Close the tab. ${capital(what)}, so the run goes on.`,
          run: ['close', ...targetArgs(facts)],
        },
        { key: 'stop', label: 'Stop the run. The tab stays open in Orca.', run: null },
      ]
    : [
        { key: 'stop', label: 'Stop the run. The tab stays open, so you can help it in Orca.', run: null },
        {
          key: 'new-tab',
          label: `Drop the tab. The run then starts a new tab for ${stageWords(active)}.`,
          run: ['close', ...targetArgs(facts), '--discard'],
        },
      ];
  return {
    schema: SCHEMA,
    action: 'ask',
    reason: 'escalation-cap',
    say: `${capital(tab)} is idle again after one send, and it did not report.`,
    question: `[${tagOf(feature, active)}] The tab is idle again after one send, and ${what}. What now?`,
    options,
    recommended: options[0].key,
    feature,
    open: check?.open ?? [],
    detail: [...worker.detail],
  };
}

/** The sends of the verdict note to one step tab before the run asks the user. */
export const VERDICT_SEND_CAP = 1;

/**
 * The reported step tab (rule A3 for the stage `step`). `PASS` closes, and
 * `close` records the mark. `FAIL` and `BLOCKED` ask: go on (`close
 * --override`, recorded `overridden`), or stop. No verdict sends the
 * verdict note once (`missing-verdict`), then asks the same question.
 *
 * @param {FeatureFacts} facts
 * @param {Record<string, any>} active
 * @param {{ pass: boolean, open: string[], what: string, verdict?: string, evidence?: string }} check
 * @returns {Record<string, any>}
 */
function stepDoneAction(facts, active, check) {
  const { feature } = facts;
  const tab = tabName(feature, active);
  if (check.pass) {
    return {
      schema: SCHEMA,
      action: 'close',
      say: `The step "${active.stepCommand ?? active.stage}" of ${feature} passed. Close its tab.`,
      run: ['close', ...targetArgs(facts)],
      feature,
      stage: 'step',
      phase: active.phase ?? null,
      step: active.step ?? null,
      point: active.point ?? null,
      verdict: 'PASS',
      show: null,
    };
  }
  if (check.verdict === 'none' && active.sendBacks < VERDICT_SEND_CAP) {
    return sendAction(
      facts,
      active,
      'missing-verdict',
      check.open,
      `${capital(tab)} reported with no verdict file. Send the verdict note.`
    );
  }
  const verdict = check.verdict ?? 'none';
  const evidence = String(check.evidence ?? '')
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .slice(0, MAX_DETAIL_LINES);
  const why = verdict === 'none' ? 'it reported with no verdict file' : `its verdict is ${verdict}`;
  return {
    schema: SCHEMA,
    action: 'ask',
    reason: 'step-failed',
    say: `${capital(tab)} did not pass: ${why}.`,
    question: `[${tagOf(feature, active)}] The step "${active.stepCommand ?? 'step'}" did not pass: ${why}. What now?`,
    options: [
      { key: 'stop', label: 'Stop the run. The tab stays open, so you can read its evidence.', run: null },
      {
        key: 'go-on',
        label: 'Go on with the run. The result is recorded as overridden.',
        run: ['close', ...targetArgs(facts), '--override'],
      },
    ],
    recommended: 'stop',
    feature,
    verdict,
    open: verdict === 'none' ? check.open : [],
    detail: evidence,
  };
}

/**
 * The reported verify tab, and the reported fix tab of a phase that it
 * verifies itself (rule A3 for the stages `verify` and `fix`). `PASS` and
 * `FAIL` are reports, so the tab closes: a `PASS` shows the slice block, and
 * a `FAIL` goes to rule F16, which starts a fix tab. `BLOCKED` asks, with
 * the reason. No verdict sends the verdict note once (`missing-verdict`),
 * then asks.
 *
 * @param {FeatureFacts} facts
 * @param {Record<string, any>} active
 * @param {{ pass: boolean, open: string[], what: string, verdict?: string, evidence?: string }} check
 * @returns {Record<string, any>}
 */
function verifyDoneAction(facts, active, check) {
  const { feature } = facts;
  const tab = tabName(feature, active);
  const n = active.phase;
  if (check.pass) {
    const phase = facts.docs.tasks?.phases.find((entry) => entry.number === n);
    const passed = check.verdict === 'PASS';
    return {
      schema: SCHEMA,
      action: 'close',
      say: passed
        ? `${capital(tab)} reported PASS. Close its tab.`
        : `${capital(tab)} reported FAIL. Close its tab, so the run goes on with the fix.`,
      run: ['close', ...targetArgs(facts)],
      feature,
      stage: active.stage,
      phase: n,
      verdict: check.verdict,
      show: passed ? sliceBlock(phase, verdictOf(facts, n)) : null,
    };
  }
  if (check.verdict === 'none' && active.sendBacks < VERDICT_SEND_CAP) {
    return sendAction(
      facts,
      active,
      'missing-verdict',
      check.open,
      `${capital(tab)} reported with no verdict file. Send the verdict note.`
    );
  }
  const verdict = check.verdict ?? 'none';
  const evidence = String(check.evidence ?? '')
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .slice(0, MAX_DETAIL_LINES);
  const why = verdict === 'none' ? 'it reported with no verdict file' : `its verdict is ${verdict}`;
  return {
    schema: SCHEMA,
    action: 'ask',
    reason: verdict === 'none' ? 'verify-missing' : 'verify-blocked',
    say: `${capital(tab)} did not give a verdict: ${why}.`,
    question: `[${tagOf(feature, active)}] The tab did not give a verdict: ${why}. What now?`,
    options: [
      { key: 'stop', label: 'Stop the run. The tab stays open, so you can read its evidence.', run: null },
      {
        key: 'retry',
        label: `Drop the tab. The run then starts a new tab for ${stageWords(active)}.`,
        run: ['close', ...targetArgs(facts), '--discard'],
      },
    ],
    recommended: 'stop',
    feature,
    phase: n,
    verdict,
    open: verdict === 'none' ? check.open : [],
    detail: evidence,
  };
}

/**
 * Rule F13 and the active rules A1 to A6. A busy tab is never replaced:
 * a fresh call stops and names it (A1), and any other call waits (A2).
 *
 * @param {FeatureFacts} facts
 * @returns {Record<string, any> | null}
 */
function activeRule(facts) {
  const active = facts.record?.record?.active;
  if (!active) return null;

  const { feature } = facts;
  const worker = facts.worker ?? { state: 'unknown', detail: [], terminal: null };
  const tab = tabName(feature, active);
  const where = [
    `dispatch ${active.dispatchId}`,
    ...(typeof worker.terminal === 'string' && worker.terminal ? [`terminal ${worker.terminal}`] : []),
  ].join(', ');

  switch (worker.state) {
    case 'busy':
      // A1, then A2. A busy tab after an escalation is a false stop, so it waits.
      if (facts.flags.fresh) {
        return stop(
          'tab-still-runs',
          `${capital(tab)} still runs on ${active.agent ?? 'its agent'} (${where}).`,
          [`${capital(tab)} runs on ${active.agent ?? 'its agent'}, ${where}.`, ...worker.detail],
          `Wait for the tab to report, or stop it in Orca. Then run ${rerun(facts)} again.`
        );
      }
      return waitAction(facts, active);

    case 'unknown':
      // A2.
      return waitAction(facts, active);

    case 'done': {
      // A3: the done check of the stage of the tab.
      const check = doneCheck(feature, facts.docs, active);
      if (check === null) {
        return workerStopped(facts, active, 'reported', [
          `The run record names the stage "${active.stage}", and this version does not run it.`,
        ]);
      }
      if (active.stage === 'step') return stepDoneAction(facts, active, check);
      if (active.stage === 'verify' || (active.stage === 'fix' && active.verifies === true)) {
        return verifyDoneAction(facts, active, check);
      }
      const isPhase = active.stage === 'phase';
      if (check.pass) {
        const phase = isPhase ? facts.docs.tasks?.phases.find((entry) => entry.number === active.phase) : undefined;
        const large = active.stage === 'inbox' && largeChangesSince(facts.docs, active.closedLarge).length > 0;
        // The slice block of a phase tab that verifies itself: a verdict that is not PASS or BLOCKED holds it back.
        const fact = isPhase ? verdictOf(facts, active.phase) : null;
        const shown = isPhase && !verifySplit(facts) && (fact === null || fact.verdict === null || fact.verdict === 'PASS');
        return {
          schema: SCHEMA,
          action: 'close',
          say: large
            ? `A large change of ${feature} wrote a new requirements.md. Close its tab.`
            : `${CLOSE_SAY[active.stage](feature, active.phase)} Close its tab.`,
          run: ['close', ...targetArgs(facts)],
          feature,
          stage: active.stage,
          phase: isPhase || active.stage === 'fix' ? active.phase : null,
          show: shown ? sliceBlock(phase, fact) : null,
        };
      }
      if (active.sendBacks < SEND_BACK_CAP) {
        return sendAction(
          facts,
          active,
          'open-tasks',
          check.open,
          `${capital(tab)} reported, and ${check.what}. Send the open items back.`
        );
      }
      return {
        schema: SCHEMA,
        action: 'ask',
        reason: 'send-back-cap',
        say: `${capital(tab)} reported done three times, and ${check.what}.`,
        question: `[${tagOf(feature, active)}] The tab reported done three times, and ${check.what}. What now?`,
        options: [
          {
            key: 'stop',
            label: 'Stop the run. The tab stays open, so you can finish the open items there.',
            run: null,
          },
          {
            key: 'new-tab',
            label: `Close the tab. The run then starts a new tab for ${stageWords(active)}.`,
            run: ['close', ...targetArgs(facts)],
          },
        ],
        recommended: 'stop',
        feature,
        open: check.open,
      };
    }

    case 'idle': {
      // A4. An idle tab with no escalation for it, on a call that is not fresh, waits.
      const escalated = escalatedFor(facts.flags, active);
      if (!escalated && !facts.flags.fresh) return waitAction(facts, active);
      const check = doneCheck(feature, facts.docs, active);
      // Fix 2: a dsh tab with open work whose subagent session still writes waits on that subagent.
      if (check?.pass === false && active.agent === 'dsh' && worker.child?.active === true) {
        return dshWaitAction(facts, active, worker);
      }
      // Fix 2: open items that dropped since the last escalation send start the count again.
      if (escalationsOf(active, check ? check.open.length : null) >= ESCALATION_CAP) {
        return escalationCapAsk(facts, active, check, worker);
      }
      if (check?.pass === true) {
        return sendAction(facts, active, 'report', [], `${capital(tab)} is idle, and its work is done. Ask it for its report.`);
      }
      return sendAction(
        facts,
        active,
        'escalation',
        check?.open ?? [],
        escalated
          ? `${capital(tab)} escalated, and it is idle. Send it the resume text.`
          : `${capital(tab)} is idle, and no report arrived. Send it the resume text.`
      );
    }

    case 'circuit':
      // A6: only the user reopens the Task (Research Finding 1).
      return stop(
        'circuit-broken',
        `Orca broke the circuit of ${tab}.`,
        [`${capital(tab)} runs on ${active.agent ?? 'its agent'}, ${where}.`, ...worker.detail],
        'Check the Task in Orca. Only you can reopen it, and the run never retries around the breaker. ' +
          `To drop the tab and start over, run {run}. Then run ${rerun(facts)} again.`,
        { fixRun: ['close', ...targetArgs(facts), '--discard'] }
      );

    default: {
      // A5: the tab is gone, or it failed.
      const what = worker.state === 'failed' ? 'failed' : 'is gone';
      return {
        schema: SCHEMA,
        action: 'ask',
        reason: 'worker-gone',
        say: `${capital(tab)} ${what}.`,
        question: `[${tagOf(feature, active)}] The tab ${what}. What now?`,
        options: [
          {
            key: 'new-tab',
            label: `Drop the tab, and go on. The run then starts a new tab for the open work of ${stageWords(active)}.`,
            run: ['close', ...targetArgs(facts), '--discard'],
          },
          { key: 'stop', label: 'Stop the run, and check the tab in Orca first.', run: null },
        ],
        recommended: 'new-tab',
        feature,
        detail: [`${capital(tab)} runs on ${active.agent ?? 'its agent'}, ${where}.`, ...worker.detail],
      };
    }
  }
}

/**
 * Rule F14: the record holds a failed start. The coordinator never starts
 * a second tab on its own (Decision 13). While fewer than three starts of
 * one `--retry-of` chain failed, the run asks: retry the same stage with
 * `start --retry`, which reuses the Orca Task, or stop. A failed start that
 * names no Task or no dispatch cannot retry, so the ask offers to clear it
 * instead. The third failure, or a retry that Orca refused for its broken
 * circuit, stops `circuit-broken`.
 *
 * A start whose outcome is unknown comes first (CR-3): a `worker-start`
 * that ran past its process limit, or a start step that ended before it
 * recorded the answer of Orca (CR-2). Orca can have opened the tab, so the
 * run asks `start-unknown`: stop (recommended), or clear after a check in
 * Orca. It never offers a retry, which can open a second tab.
 *
 * @param {FeatureFacts} facts
 * @returns {Record<string, any> | null}
 */
function failedStartRule(facts) {
  const failed = facts.record?.record?.failedStart;
  if (!failed) return null;
  const { feature } = facts;
  const tab = failed.stage ? tabName(feature, failed) : `the tab of ${feature}`;
  const count = Number.isInteger(failed.count) && failed.count > 0 ? failed.count : 1;
  const detail = detailLines(failed.detail);

  // A record of an earlier version marks a process timeout by its code alone.
  if (failed.unknown === true || failed.code === 'timeout') {
    const work = stageWords(failed);
    return {
      schema: SCHEMA,
      action: 'ask',
      reason: 'start-unknown',
      say: `The outcome of the start of ${tab} is unknown, so a tab can be open.`,
      question: `[${tagOf(feature, failed)}] Orca gave no answer to the start of the tab, so a tab can be open. What now?`,
      options: [
        { key: 'stop', label: `Stop the run. Check Orca for a new tab of ${work} first.`, run: null },
        {
          key: 'clear',
          label: `Clear the start. Check Orca for a new tab of ${work} first, and close it, because the run then opens a new tab for ${work}.`,
          run: ['close', ...targetArgs(facts)],
        },
      ],
      recommended: 'stop',
      feature,
      detail,
    };
  }

  if (failed.circuit === true || count >= START_FAILURE_CAP) {
    return stop(
      'circuit-broken',
      `The start of ${tab} failed ${countText(count, 'time')}, so Orca broke the circuit.`,
      detail,
      'Orca makes no more retries of this Task, and the run never retries around the breaker. Check the cause ' +
        `above in Orca. To give up this start and open a new tab, run {run}. Then run ${rerun(facts)} again.`,
      { fixRun: ['close', ...targetArgs(facts)] }
    );
  }

  const canRetry = Boolean(failed.stage && failed.taskId && failed.dispatchId);
  const retryRun = [
    'start',
    ...targetArgs(facts),
    '--stage',
    String(failed.stage),
    ...(failed.stage === 'step' && Number.isInteger(failed.step) ? ['--step', String(failed.step)] : []),
    ...(['phase', 'step', 'verify', 'fix'].includes(failed.stage) && failed.phase ? ['--phase', String(failed.phase)] : []),
    ...(failed.stage === 'fix' && Number.isInteger(failed.round) && failed.round > 0 ? ['--round', String(failed.round)] : []),
    '--retry',
  ];
  const cause = failed.failedStage ? `at the ${failed.failedStage} stage of Orca` : `with ${failed.code ?? 'an error'}`;
  return {
    schema: SCHEMA,
    action: 'ask',
    reason: 'start-failed',
    say: `The start of ${tab} failed ${cause}.`,
    question: `[${tagOf(feature, failed)}] The start of the tab failed ${cause} (${countText(count, 'failed start')}). What now?`,
    options: canRetry
      ? [
          {
            key: 'retry',
            label: `Retry the start of ${stageWords(failed)}. Orca reuses the same Task.`,
            run: retryRun,
          },
          { key: 'stop', label: 'Stop the run. Fix the cause, then run the command again.', run: null },
        ]
      : [
          { key: 'stop', label: 'Stop the run. Fix the cause, then run the command again.', run: null },
          {
            key: 'clear',
            label: `Clear the failed start. Orca named no Task for it, so the run then opens a new tab for ${stageWords(failed)}.`,
            run: ['close', ...targetArgs(facts)],
          },
        ],
    recommended: canRetry ? 'retry' : 'stop',
    feature,
    detail,
  };
}

/** The `say` of the close of each stage. */
const CLOSE_SAY = {
  plan: (feature) => `The plan of ${feature} is done.`,
  phase: (feature, phase) => `Phase ${phase} of ${feature} is done.`,
  verify: (feature, phase) => `The verification of Phase ${phase} of ${feature} reported.`,
  fix: (feature, phase) => `The fix of Phase ${phase} of ${feature} is done.`,
  review: (feature) => `The review of ${feature} is written.`,
  'review-fix': (feature) => `The review fixes of ${feature} are done.`,
  inbox: (feature) => `The inbox lines of ${feature} are handled.`,
  docs: (feature) => `The docs tab of ${feature} reported.`,
  'epic-docs': (epic) => `The epic docs tab of ${epic} reported.`,
};

/**
 * The lines of inbox.md closed `done: new requirements.md` that were not
 * closed when the inbox tab started: the large changes of this run
 * (section 12 rule 10). `before` is the list that `start` recorded.
 *
 * @param {DocsFacts} docs
 * @param {unknown} before The texts of the lines closed at the start of the tab.
 * @returns {import('./read.js').InboxClosedLine[]}
 */
export function largeChangesSince(docs, before) {
  const seen = new Set(Array.isArray(before) ? before : []);
  return (docs.inboxNewRequirements ?? []).filter((line) => !seen.has(line.text));
}

/**
 * The open items of the cross-phase review: one line for a missing or an
 * unreadable code-review.md, else the text of each open finding.
 *
 * @param {string} feature
 * @param {DocsFacts} docs
 * @returns {string[]}
 */
function reviewItems(feature, docs) {
  if (!docs.has.codeReview) return [`docs/features/${feature}/code-review.md does not exist.`];
  if (!docs.review) {
    return [`docs/features/${feature}/code-review.md cannot be read: ${docs.reviewError ?? 'unknown error'}`];
  }
  return [...docs.review.open];
}

/**
 * The done check of the stage of an active tab. Plan: implementation.md and
 * tasks.md exist, and tasks.md holds a phase. Phase: every task line of the
 * phase reads [x], and with the review in the tab, code-review.md holds no
 * open finding. Review: code-review.md exists. Review-fix: no open finding
 * is left. Inbox: no open `bug` or `change` line is left, or a line closed
 * `done: new requirements.md` since the start of the tab closes the stage.
 * Docs: the report is enough. Null for a stage that this version does not
 * run. `open` lists the open items word for word, for the send text.
 *
 * @param {string} feature
 * @param {DocsFacts} docs
 * @param {Record<string, any>} active
 * @returns {{ pass: boolean, open: string[], what: string, verdict?: string, evidence?: string } | null}
 *   A step tab adds `verdict` (`PASS`, `FAIL`, `BLOCKED`, or `none`) and its `evidence`.
 */
export function doneCheck(feature, docs, active) {
  const dir = `docs/features/${feature}`;
  switch (active.stage) {
    case 'plan': {
      /** @type {string[]} */
      const open = [];
      if (!docs.has.implementation) open.push(`${dir}/implementation.md does not exist.`);
      if (!docs.has.tasks) {
        open.push(`${dir}/tasks.md does not exist.`);
      } else if (!docs.tasks || docs.tasks.phases.length === 0) {
        open.push(`${dir}/tasks.md holds no "## Phase" section.`);
      }
      return { pass: open.length === 0, open, what: 'the plan docs are not complete' };
    }
    case 'phase': {
      const phase = docs.tasks?.phases.find((entry) => entry.number === active.phase);
      const open = phase ? [...phase.open] : [];
      let what = `tasks.md shows ${countText(open.length, 'open task')}`;
      let pass = isPhaseComplete(phase);
      if (active.review === true) {
        // The spec of this tab held the cross-phase review.
        const review = reviewItems(feature, docs);
        if (review.length > 0) {
          pass = false;
          open.push(...review);
          what += ', and the cross-phase review is not closed';
        }
      }
      return { pass, open, what };
    }
    case 'review':
      return docs.has.codeReview
        ? { pass: true, open: [], what: 'code-review.md exists' }
        : { pass: false, open: [`${dir}/code-review.md does not exist.`], what: 'code-review.md does not exist' };
    case 'review-fix': {
      const open = reviewItems(feature, docs);
      return { pass: open.length === 0, open, what: `code-review.md shows ${countText(open.length, 'open finding')}` };
    }
    case 'inbox': {
      if (largeChangesSince(docs, active.closedLarge).length > 0) {
        return { pass: true, open: [], what: 'a large change wrote a new requirements.md' };
      }
      const open = (docs.inboxActionable ?? []).map((line) => line.text);
      return { pass: open.length === 0, open, what: `inbox.md shows ${countText(open.length, 'open bug or change line')}` };
    }
    case 'step': {
      // The verdict file decides: PASS passes. FAIL and BLOCKED are a report, so the run asks.
      const fact = docs.stepVerdicts?.[stepKey(String(active.point), Number(active.step))];
      const verdict = fact?.verdict ?? null;
      const evidence = fact?.evidence ?? '';
      if (verdict === 'PASS') return { pass: true, open: [], what: 'the verdict file reads PASS', verdict, evidence };
      if (verdict === 'FAIL' || verdict === 'BLOCKED') {
        return { pass: false, open: [], what: `the verdict file reads ${verdict}`, verdict, evidence };
      }
      const file = typeof active.verdictFile === 'string' ? active.verdictFile : '.beast-mode/briefs/ (the verdict file)';
      return {
        pass: false,
        open: [`${file} does not exist, or its line 1 is not PASS, FAIL, or BLOCKED.`],
        what: 'the verdict file holds no verdict',
        verdict: 'none',
        evidence: '',
      };
    }
    case 'verify':
    case 'fix': {
      // A fix tab of a split verify needs no verdict: the verify tab that follows writes it.
      if (active.stage === 'fix' && active.verifies !== true) return { pass: true, open: [], what: 'the fix tab reported' };
      // PASS and FAIL are reports, so they pass. BLOCKED and no verdict ask the user (rule A3).
      const fact = docs.phaseVerdicts?.[String(active.phase)];
      const verdict = fact?.verdict ?? null;
      const evidence = fact?.evidence ?? '';
      if (verdict === 'PASS' || verdict === 'FAIL') {
        return { pass: true, open: [], what: `the verdict file reads ${verdict}`, verdict, evidence };
      }
      if (verdict === 'BLOCKED') return { pass: false, open: [], what: 'the verdict file reads BLOCKED', verdict, evidence };
      const file = typeof active.verdictFile === 'string' ? active.verdictFile : '.beast-mode/briefs/ (the verdict file)';
      return {
        pass: false,
        open: [`${file} does not exist, or its line 1 is not PASS, FAIL, or BLOCKED.`],
        what: 'the verdict file holds no verdict',
        verdict: 'none',
        evidence: '',
      };
    }
    case 'docs':
    case 'epic-docs':
      return { pass: true, open: [], what: 'the docs tab reported' };
    default:
      return null;
  }
}

/**
 * The placement and the state of the cross-phase review.
 *
 * @param {FeatureFacts} facts
 * @returns {{ placement: 'off' | 'tab' | 'split', state: 'off' | 'missing' | 'error' | 'open' | 'closed' }}
 */
function reviewState(facts) {
  const placement = reviewPlacement(orchestrationOf(facts).stages);
  const { docs } = facts;
  if (placement === 'off') return { placement, state: 'off' };
  if (!docs.has.codeReview) return { placement, state: 'missing' };
  if (!docs.review) return { placement, state: 'error' };
  return { placement, state: docs.review.open.length > 0 ? 'open' : 'closed' };
}

/**
 * @param {FeatureFacts} facts
 * @returns {Record<string, any>}
 */
function reviewUnreadable(facts) {
  return stop(
    'review-unreadable',
    `The code review of ${facts.feature} cannot be read.`,
    [`docs/features/${facts.feature}/code-review.md cannot be read: ${facts.docs.reviewError ?? 'unknown error'}`],
    'Fix the file permission, then run the command again.'
  );
}

/**
 * The start action of a stage with no phase number.
 *
 * @param {FeatureFacts} facts
 * @param {string} stage
 * @param {string} agent
 * @param {string} say
 * @returns {Record<string, any>}
 */
function stageStart(facts, stage, agent, say) {
  return {
    schema: SCHEMA,
    action: 'start',
    say,
    run: ['start', ...targetArgs(facts), '--stage', stage],
    feature: facts.feature,
    stage,
    phase: null,
    agent,
    placement: 'current',
  };
}

/**
 * Rule F15: no `implementation.md` starts the plan tab in its full form
 * (`/plan-feature`, then `/start-feature`). No `tasks.md` starts it in its
 * start form (`/start-feature` only). A plan whose tasks.md holds no
 * `## Phase` section stops `no-tasks` (Phase 1 decision D5).
 *
 * @param {FeatureFacts} facts
 * @returns {Record<string, any> | null}
 */
function planRule(facts) {
  const { feature, docs } = facts;
  const agent = orchestrationOf(facts).stages.plan;
  if (!docs.has.implementation || !docs.has.tasks) {
    const commands = docs.has.implementation ? '/start-feature' : '/plan-feature, then /start-feature';
    return stageStart(facts, 'plan', agent, `Start the plan tab of ${feature} on ${agent}: ${commands}.`);
  }
  if (!docs.tasks || docs.tasks.phases.length === 0) {
    return stop(
      'no-tasks',
      `The task list of ${feature} holds no phase.`,
      [`docs/features/${feature}/tasks.md holds no "## Phase" section.`],
      `Add the phases to docs/features/${feature}/tasks.md, or run /start-feature ${feature} again. ` +
        'Then run the command again.'
    );
  }
  return null;
}

/**
 * The start action of the verify tab or of a fix tab of one phase.
 *
 * @param {FeatureFacts} facts
 * @param {{ number: number }} phase
 * @param {'verify' | 'fix'} stage
 * @param {number} [round] The fix round of a fix tab.
 * @returns {Record<string, any>}
 */
function verifyStartAction(facts, phase, stage, round = 0) {
  const { stages } = orchestrationOf(facts);
  const agent = stage === 'verify' ? stages.verify : stages.implement;
  const n = phase.number;
  const base = {
    schema: SCHEMA,
    action: 'start',
    run: ['start', ...targetArgs(facts), '--stage', stage, '--phase', String(n), ...(stage === 'fix' ? ['--round', String(round)] : [])],
    feature: facts.feature,
    stage,
    phase: n,
    agent,
    placement: 'current',
    verdictFile: phaseVerdictName(n),
  };
  if (stage === 'verify') {
    return { ...base, say: `Start the verify tab of Phase ${n} of ${facts.feature} on ${agent}.` };
  }
  const verifies = !verifySplit(facts);
  return {
    ...base,
    round,
    say: `Start the fix tab of Phase ${n} of ${facts.feature} on ${agent}, fix round ${round}${verifies ? '. The tab verifies the fix itself' : ''}.`,
  };
}

/**
 * Rule F16, the verify part: a complete phase that no commit follows needs a
 * `PASS` verdict before its steps and its commit. With a split verify, no
 * verdict starts the verify tab, a `FAIL` starts a fix tab (round 1 to 3),
 * and the fix tab goes back to the verify tab. A `BLOCKED` asks, and a `FAIL`
 * after the third fix round asks. With the verify agent equal to the
 * implement agent, no verify tab opens: the phase tab wrote the verdict, so
 * no verdict passes (an older tab), and a `FAIL` or a `BLOCKED` still holds
 * the commit back. A fix tab then verifies itself. The phase commits only
 * after a `PASS` or an old tab with no verdict.
 *
 * @param {FeatureFacts} facts
 * @param {import('./read.js').TasksPhase} phase
 * @returns {Record<string, any> | null}
 */
function verifyGate(facts, phase) {
  const { feature } = facts;
  const n = phase.number;
  const split = verifySplit(facts);
  const fact = verdictOf(facts, n);
  const verdict = fact?.verdict ?? null;
  if (verdict === 'PASS') return null;
  const round = verifyRound(facts, n);
  const retry = () => (split ? verifyStartAction(facts, phase, 'verify') : verifyStartAction(facts, phase, 'fix', round + 1));
  const detail = String(fact?.evidence ?? '')
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .slice(0, MAX_DETAIL_LINES);

  if (verdict === null) {
    if (split) return verifyStartAction(facts, phase, 'verify');
    if (round === 0) return null;
  } else if (verdict === 'BLOCKED') {
    const next = retry();
    return {
      schema: SCHEMA,
      action: 'ask',
      reason: 'verify-blocked',
      say: `The verifier could not check Phase ${n} of ${feature}.`,
      question: `[${feature} phase ${n}] The verifier could not check the phase (BLOCKED). What now?`,
      options: [
        { key: 'stop', label: 'Stop the run. Read the evidence, and fix the cause.', run: null },
        {
          key: 'retry',
          label: split
            ? 'Start a new verify tab. Fix the cause of the block first.'
            : 'Start a fix tab that verifies again. Fix the cause of the block first.',
          run: next.run,
        },
      ],
      recommended: 'stop',
      feature,
      phase: n,
      verdict,
      detail,
    };
  }

  // A FAIL, or no verdict after a fix of a phase that its own tab verifies.
  if (round >= VERIFY_ROUND_CAP) {
    return {
      schema: SCHEMA,
      action: 'ask',
      reason: 'verify-fail-cap',
      say: `Phase ${n} of ${feature} still fails after ${countText(round, 'fix round')}.`,
      question: `[${feature} phase ${n}] The phase still fails after ${countText(round, 'fix round')}. What now?`,
      options: [
        { key: 'stop', label: 'Stop the run. The phase stays uncommitted, so you can fix it in Orca.', run: null },
        {
          key: 'fix',
          label: `Start one more fix tab (round ${round + 1}). The phase commits only after a PASS.`,
          run: verifyStartAction(facts, phase, 'fix', round + 1).run,
        },
      ],
      recommended: 'stop',
      feature,
      phase: n,
      verdict: verdict ?? 'none',
      detail,
    };
  }
  return verifyStartAction(facts, phase, 'fix', round + 1);
}

/**
 * Rule F16, the open phase and the commit parts. Per phase, in order, an
 * open task starts the phase tab. With the review in the tab, the last
 * phase stays open until code-review.md holds no open finding. Under the
 * `phase` cadence, a complete phase with no commit and a dirty tree
 * commits, but only while it is the newest work: no later phase holds a
 * done task, and no end stage (a split review tab, an inbox tab, or the
 * docs tab) has run.
 *
 * @param {FeatureFacts} facts
 * @returns {Record<string, any> | null}
 */
function phaseRule(facts) {
  const { feature, git } = facts;
  const orchestration = orchestrationOf(facts);
  const agent = orchestration.stages.implement;
  const phases = facts.docs.tasks?.phases ?? [];
  const review = reviewState(facts);
  const endStarted =
    docsDone(facts) || inboxDone(facts) || (review.placement === 'split' && review.state !== 'missing');

  for (let i = 0; i < phases.length; i += 1) {
    const phase = phases[i];
    const reviewHere = review.placement === 'tab' && i === phases.length - 1;
    if (reviewHere && isPhaseComplete(phase) && review.state === 'error') return reviewUnreadable(facts);
    if (!isPhaseComplete(phase) || (reviewHere && review.state !== 'closed')) {
      return {
        schema: SCHEMA,
        action: 'start',
        say: `Start the Phase ${phase.number} tab of ${feature} on ${agent}${reviewHere ? ', with the cross-phase review' : ''}.`,
        run: ['start', ...targetArgs(facts), '--stage', 'phase', '--phase', String(phase.number)],
        feature,
        stage: 'phase',
        phase: phase.number,
        agent,
        placement: 'current',
      };
    }

    const subject = phaseSubject(feature, phase.number);
    // Rule F16: the verify gate and the phase steps run before the phase commit, but only for the newest work.
    // A later phase with a done task, an end stage, or a phase commit means the point has passed.
    if (!endStarted && !git.subjects.includes(subject) && !phases.slice(i + 1).some((entry) => entry.done > 0)) {
      const gate = verifyGate(facts, phase);
      if (gate) return gate;
      const line = pendingStep(facts, 'phase', phase.number);
      if (line) return stepStartAction(facts, line, phase.number);
    }
    if (orchestration.commit !== 'phase' || git.subjects.includes(subject) || git.dirty.length === 0) {
      continue;
    }
    // The changes of a later phase, of a split review, or of the docs tab
    // never commit under the subject of this phase.
    if (endStarted || phases.slice(i + 1).some((entry) => entry.done > 0)) continue;

    const failed = facts.record?.record?.failedGit;
    if (failed && failed.step === 'commit' && failed.phase === phase.number && !facts.flags.fresh) {
      return stop(
        'commit-failed',
        `The commit of Phase ${phase.number} of ${feature} failed.`,
        detailLines(failed.detail),
        `Fix the cause above, then run ${rerun(facts)} again.`
      );
    }

    return {
      schema: SCHEMA,
      action: 'commit',
      say: `Commit Phase ${phase.number} of ${feature}.`,
      run: ['commit', ...targetArgs(facts), '--point', 'phase', '--phase', String(phase.number)],
      feature,
      point: 'phase',
      phase: phase.number,
      subject,
    };
  }
  return null;
}

/**
 * Rule F17, the split review: no code-review.md starts the review tab on
 * the review agent. An open finding starts the review-fix tab on the
 * implement agent. The placements `off` and `tab` open no review tab.
 *
 * @param {FeatureFacts} facts
 * @returns {Record<string, any> | null}
 */
function reviewRule(facts) {
  const { feature } = facts;
  const { stages } = orchestrationOf(facts);
  const review = reviewState(facts);
  if (review.placement !== 'split') return null;
  if (review.state === 'error') return reviewUnreadable(facts);
  if (review.state === 'missing') {
    const agent = /** @type {string} */ (stages.review);
    return stageStart(facts, 'review', agent, `Start the review tab of ${feature} on ${agent}. It writes the findings only.`);
  }
  if (review.state === 'open') {
    const open = facts.docs.review?.open.length ?? 0;
    return stageStart(
      facts,
      'review-fix',
      stages.implement,
      `Start the review-fix tab of ${feature} on ${stages.implement} for ${countText(open, 'open finding')}.`
    );
  }
  return null;
}

/**
 * Rule F18: under the `phase` cadence, the closed split review with a dirty
 * tree and no review commit commits `review`. A docs tab or an inbox tab
 * that has run stops the rule, so their changes never commit as the review
 * fixes.
 *
 * @param {FeatureFacts} facts
 * @returns {Record<string, any> | null}
 */
function reviewCommitRule(facts) {
  const { feature, git } = facts;
  const review = reviewState(facts);
  if (orchestrationOf(facts).commit !== 'phase' || review.placement !== 'split' || review.state !== 'closed') {
    return null;
  }
  const subject = reviewSubject(feature);
  if (git.subjects.includes(subject) || git.dirty.length === 0 || docsDone(facts) || inboxDone(facts)) return null;

  const failed = facts.record?.record?.failedGit;
  if (failed && failed.step === 'commit' && failed.point === 'review' && !facts.flags.fresh) {
    return stop(
      'commit-failed',
      `The review commit of ${feature} failed.`,
      detailLines(failed.detail),
      `Fix the cause above, then run ${rerun(facts)} again.`
    );
  }
  return {
    schema: SCHEMA,
    action: 'commit',
    say: `Commit the cross-phase review fixes of ${feature}.`,
    run: ['commit', ...targetArgs(facts), '--point', 'review'],
    feature,
    point: 'review',
    phase: null,
    subject,
  };
}

/**
 * Rule F20. A large change that the inbox tab of this run closed
 * `done: new requirements.md` stops `large-change`, naming `/plan-feature`.
 * `close` of that tab records it. The next start, or a `close`, clears it.
 * Else an open `bug` or `change` line of inbox.md starts the inbox tab on
 * the implement agent, after the review and before the docs. A note alone
 * starts no tab.
 *
 * @param {FeatureFacts} facts
 * @returns {Record<string, any> | null}
 */
function inboxRule(facts) {
  const { feature, docs } = facts;
  const large = facts.record?.record?.largeChange;
  if (large) {
    return stop(
      'large-change',
      `A large change moved the goal of ${feature}, and the inbox tab wrote a new requirements.md.`,
      [...detailLines(large.lines), `docs/features/${feature}/requirements.md holds the new requirements.`],
      `Run /plan-feature ${feature} to plan the new requirements.md. Then run ${rerun(facts)} again. ` +
        'To go on with the plan as it is, run {run} first.',
      { fixRun: ['close', ...targetArgs(facts)] }
    );
  }
  const open = docs.inboxActionable ?? [];
  if (open.length === 0) return null;
  const agent = orchestrationOf(facts).stages.implement;
  return stageStart(
    facts,
    'inbox',
    agent,
    `Start the inbox tab of ${feature} on ${agent} for ${countText(open.length, 'open bug or change line')}.`
  );
}

/**
 * Rule F21: the docs tab runs until the record marks it done. `close` sets
 * the mark, and a start of new work clears it.
 *
 * @param {FeatureFacts} facts
 * @returns {Record<string, any> | null}
 */
function docsRule(facts) {
  if (docsDone(facts)) return null;
  const { feature, docs } = facts;
  const agent = orchestrationOf(facts).stages.docs;
  return stageStart(facts, 'docs', agent, `Start the docs tab of ${feature} on ${agent}: ${docsCommands(feature, docs.epic, facts.target?.lane === true).join(', ')}.`);
}

/**
 * @param {string[]} items
 * @returns {string[]} The items as open lines, capped.
 */
function summaryList(items) {
  const shown = items.slice(0, MAX_SUMMARY_LINES).map((item) => `- [ ] ${item}`);
  if (items.length > shown.length) shown.push(`- and ${items.length - shown.length} more`);
  return shown;
}

/**
 * The review line of the run summary.
 *
 * @param {FeatureFacts} facts
 * @returns {string}
 */
function reviewLine(facts) {
  const { stages } = orchestrationOf(facts);
  const placement = reviewPlacement(stages);
  if (placement === 'off') return 'Review: off (stages.review is false).';
  const parsed = facts.docs.review;
  const count = parsed ? `${countText(parsed.total, 'finding')}, ${parsed.closed} closed` : 'no code-review.md';
  if (placement === 'tab') {
    const last = facts.docs.tasks?.phases.at(-1);
    return `Review: in the ${last ? `Phase ${last.number} ` : 'last phase '}tab on ${stages.implement}, ${count}.`;
  }
  const subject = reviewSubject(facts.feature);
  const commit = facts.git.subjects.includes(subject) ? ` Committed as "${subject}".` : '';
  return `Review: a ${stages.review} review tab, with the fixes on ${stages.implement}, ${count}.${commit}`;
}

/**
 * The verify part of a phase line in the run summary: the verdict of the
 * phase verdict file, and the fix rounds of the record.
 *
 * @param {FeatureFacts} facts
 * @param {number} phase
 * @returns {string} For example ", verified PASS after 2 fix rounds", or "" with no verdict and no round.
 */
function verifyPart(facts, phase) {
  const verdict = verdictOf(facts, phase)?.verdict ?? null;
  const round = verifyRound(facts, phase);
  const rounds = round > 0 ? ` after ${countText(round, 'fix round')}` : '';
  if (verdict) return `, verified ${verdict}${rounds}`;
  return round > 0 ? `, no verdict${rounds}` : '';
}

/**
 * The step results of the run record, one line per mark. An `overridden`
 * step comes first: the run went on past its FAIL.
 *
 * @param {FeatureFacts} facts
 * @param {string} [owner] A feature path that starts each line, for an epic summary.
 * @returns {string[]} Lines like "- /review-code (Phase 2): PASS", or [] with no mark.
 */
function stepResultLines(facts, owner = '') {
  const lines = stepLinesOf(facts);
  const rows = Object.entries(stepMarks(facts)).map(([key, mark]) => {
    const split = key.lastIndexOf(':');
    const point = key.slice(0, split);
    const found = lines.find((line) => line.k === Number(key.slice(split + 1)));
    const where = /^phase-\d+$/.test(point) ? `Phase ${point.slice(6)}` : point === 'feature' ? 'the feature' : point === 'epic' ? 'the epic' : point;
    return { overridden: mark === 'overridden', text: `- ${owner ? `${owner}: ` : ''}${found ? found.command : `step ${key}`} (${where}): ${String(mark)}` };
  });
  return [...rows.filter((row) => row.overridden), ...rows.filter((row) => !row.overridden)].map((row) => row.text);
}

/**
 * Rule F23: the run is done. The summary block holds the phases with their
 * subjects, the review count, the docs, the files left uncommitted, the
 * human test count, the open inbox lines, and the next steps.
 *
 * @param {FeatureFacts} facts
 * @returns {Record<string, any>}
 */
function doneRule(facts) {
  const { feature, git, docs } = facts;
  const dir = `docs/features/${feature}`;
  const branch = git.runBranch ?? runBranchOf(feature);
  const base = git.base ?? git.defaultBranch ?? 'the default branch';
  const lines = [`Run summary - ${feature}`, '', 'Phases:'];
  for (const phase of docs.tasks?.phases ?? []) {
    const subject = phaseSubject(feature, phase.number);
    const state = git.subjects.includes(subject) ? `committed as "${subject}"` : 'complete, with no phase commit';
    lines.push(`- ${phaseLabel(phase)}: ${state}${verifyPart(facts, phase.number)}`);
  }
  const results = stepResultLines(facts);
  if (results.length > 0) lines.push('', 'Steps:', ...results);
  lines.push('', reviewLine(facts), `Docs: the docs tab ran ${docsCommands(feature, docs.epic).join(', ')}.`);
  if (git.dirty.length === 0) {
    lines.push('Uncommitted: none.');
  } else {
    lines.push(`Uncommitted: ${countText(git.dirty.length, 'file')} on ${branch}.`, ...fileLines(git.dirty).map((file) => `- ${file}`));
  }
  lines.push(
    `Human tests: ${countText(docs.humanTests.length, 'open line')} under "## Needs Human Verification" in ${dir}/context.md.`,
    `Inbox: ${countText(docs.inbox.length, 'open line')} in ${dir}/inbox.md.`,
    ...summaryList(docs.inbox.map((line) => line.text)),
    '',
    'Next:'
  );
  if (git.dirty.length > 0) {
    const cadence = orchestrationOf(facts).commit === 'feature' ? ' The feature cadence makes no commit.' : '';
    lines.push(`- Review and commit the ${countText(git.dirty.length, 'uncommitted file')}.${cadence}`);
  }
  if (docs.humanTests.length > 0) lines.push(`- Run the ${countText(docs.humanTests.length, 'human test')} in ${dir}/context.md.`);
  if (docs.inbox.length > 0) lines.push(`- Act on the ${countText(docs.inbox.length, 'open inbox line')} in ${dir}/inbox.md.`);
  lines.push(`- Merge ${branch} into ${base} when you are ready.`);
  return {
    schema: SCHEMA,
    action: 'done',
    say: `The run of ${feature} is done.`,
    show: lines.join('\n'),
  };
}

/**
 * Decide the next action of a feature run. The first matching rule wins:
 * F1 to F8, F9, F12, F10, F11, F13 with A1 to A6, F14, F15, F16, F17, F18,
 * F20, F21, and F23. F12 comes before F10 and F11, so a stop request never
 * switches a branch and never asks about the work tree. The `feature`
 * cadence answers no `commit` at any point.
 *
 * @param {FeatureFacts} facts
 * @returns {Record<string, any>}
 */
export function decideFeature(facts) {
  const action =
    setupStop(facts) ??
    orcaRule(facts) ??
    stopRule(facts) ??
    branchRule(facts) ??
    dirtyStartRule(facts) ??
    activeRule(facts) ??
    failedStartRule(facts) ??
    planRule(facts) ??
    phaseRule(facts) ??
    reviewRule(facts) ??
    reviewCommitRule(facts) ??
    featureStepRule(facts) ??
    inboxRule(facts) ??
    docsRule(facts) ??
    doneRule(facts);
  return withNote(withLaunchPath(facts, action), facts.record?.note ?? null);
}

// ---------------------------------------------------------------------------
// The epic run (Phase 5): the rules E1 to E13 of `/orca-epic`
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} EpicFeatureFacts The facts of one feature folder of an epic.
 * @property {string} name The folder name, for example "ux".
 * @property {string} path The feature reference, for example "editor/ux".
 * @property {DocsFacts} docs
 * @property {{ record: Record<string, any> | null, note: string | null }} record The run record of the feature.
 * @property {string} branch The lane branch: the branch that the lane keys name, else `feat/<epic>/<feature>`.
 * @property {boolean} branchExists
 * @property {boolean} held `epic/<epic>` holds the lane branch.
 * @property {{ base: string | null, epic: string | null, feature: string | null, merged: string | null }} keys
 *   The beast-mode keys of the lane branch.
 * @property {string[]} subjects The commit subjects of the lane branch since its base, read while HEAD is on it.
 * @property {LaneTree | null} [worktree] The child worktree that holds the lane branch, read inside it.
 */

/**
 * @typedef {Object} LaneTree The child worktree of a lane (rule E14). Every fact is read inside it.
 * @property {string} path The absolute path, from `git worktree list --porcelain`.
 * @property {string | null} head The branch of its HEAD.
 * @property {string[]} dirty Its changed files outside `.beast-mode/briefs/`.
 * @property {boolean} handoff It holds `.beast-mode/phase-handoff.md`.
 * @property {string[] | null} error The lines of a git read inside it that failed.
 */

/** @typedef {'main' | 'new-child' | 'worktree' | 'missing'} LaneMode Where a lane builds. */

/**
 * @typedef {Object} EpicGitFacts
 * @property {boolean} workTree
 * @property {string[]} detail
 * @property {string[] | null} error
 * @property {string | null} head
 * @property {string | null} defaultBranch
 * @property {boolean} epicBranchExists
 * @property {string | null} epicBase The `branch.epic/<epic>.beast-mode-base` value.
 * @property {string[]} dirty
 * @property {boolean} [epicHandoff] The tree of `epic/<epic>` holds `.beast-mode/phase-handoff.md`, so a new
 *   child worktree holds it too. Read only when the epic branch exists.
 */

/**
 * @typedef {Object} EpicFacts
 * @property {string} epic
 * @property {FeatureFacts['flags']} flags
 * @property {string | null} terminalHandle
 * @property {import('./read.js').OrcaConfigRead} config
 * @property {string[]} harnesses
 * @property {EpicGitFacts} git
 * @property {import('./read.js').EpicDocs} epicDocs
 * @property {EpicFeatureFacts[]} features One entry per feature folder, in folder order.
 * @property {{ record: Record<string, any> | null, note: string | null }} record The epic record.
 * @property {{ running: boolean, detail: string[] } | null} orcaStatus
 * @property {Record<string, WorkerFact>} workers By dispatch id.
 */

/**
 * @param {DocsFacts} docs
 * @returns {boolean} tasks.md holds a phase, and every phase is complete: the feature is at 100 percent.
 */
function tasksComplete(docs) {
  const phases = docs.tasks?.phases ?? [];
  return phases.length > 0 && phases.every((phase) => isPhaseComplete(phase));
}

/**
 * Where one feature of the epic stands (§The run list of an epic). The lane
 * key is `branch.<b>.beast-mode-epic`, which only `branch --epic` sets.
 * `merged`: the merged key is set, and the epic branch holds the lane
 * branch. `foreign`: a lane branch with no lane key of this epic that the
 * epic branch does not hold. `outside`: built outside this run, with no
 * lane key, tasks.md at 100 percent, and no lane branch or one that the
 * epic branch holds. Else `run`: the feature is in the run list.
 *
 * @param {EpicFacts} facts
 * @param {EpicFeatureFacts} entry
 * @returns {'merged' | 'outside' | 'foreign' | 'run'}
 */
export function laneState(facts, entry) {
  if (entry.keys.merged && entry.held) return 'merged';
  if (entry.keys.epic === facts.epic) return 'run';
  if (entry.branchExists && !entry.held) return 'foreign';
  return tasksComplete(entry.docs) ? 'outside' : 'run';
}

/**
 * @typedef {Object} EpicPlan
 * @property {Map<string, string>} states The state of each feature, by folder name.
 * @property {EpicFeatureFacts[]} foreign
 * @property {import('./read.js').BuildOrderGroup | null} group The current group.
 * @property {EpicFeatureFacts[]} lanes The features of the group in the run list, in group order.
 * @property {boolean} concurrent The lanes build side by side (rule E14).
 * @property {EpicFeatureFacts | null} lane The first lane.
 */

/**
 * The run list of an epic, its current group, and its lanes (rules E12 to
 * E14). The current group is the first Build Order item that holds a
 * feature of the run list. Its lanes are those features, in group order.
 * They build side by side when two or more are left and `concurrent` is
 * true. Else the first lane builds alone.
 *
 * @param {EpicFacts} facts
 * @returns {EpicPlan}
 */
export function epicPlan(facts) {
  /** @type {Map<string, string>} */
  const states = new Map();
  /** @type {EpicFeatureFacts[]} */
  const foreign = [];
  for (const entry of facts.features) {
    const state = laneState(facts, entry);
    states.set(entry.name, state);
    if (state === 'foreign') foreign.push(entry);
  }
  const orchestration = /** @type {any} */ (facts.config)?.orchestration ?? null;
  for (const group of facts.epicDocs.buildOrder.groups) {
    const lanes = group.features
      .filter((feature) => states.get(feature) === 'run')
      .map((feature) => facts.features.find((entry) => entry.name === feature))
      .filter((entry) => entry !== undefined);
    if (lanes.length > 0) {
      // A lane whose worktree Orca refused for a project command makes its group build in sequence (Notes 8).
      const concurrent = isConcurrentGroup(lanes.map((entry) => entry.name), orchestration) && !lanes.some(inSequence);
      return { states, foreign, group, lanes, concurrent, lane: lanes[0] };
    }
  }
  return { states, foreign, group: null, lanes: [], concurrent: false, lane: null };
}

/**
 * Where one lane builds. A lane that holds a child worktree builds there
 * to its merge, in any group. A lane of a side-by-side group with no
 * branch gets a new child worktree, and one with a branch and no worktree
 * is `missing`. Every other lane builds in the main workspace (rule E13).
 *
 * @param {EpicPlan} plan
 * @param {EpicFeatureFacts} entry
 * @returns {LaneMode}
 */
export function laneMode(plan, entry) {
  if (entry.worktree) return 'worktree';
  if (!plan.concurrent || !plan.lanes.includes(entry)) return 'main';
  return entry.branchExists ? 'missing' : 'new-child';
}

/**
 * @param {EpicFacts} facts
 * @param {Record<string, any> | null | undefined} active
 * @returns {{ state: WorkerState, detail: string[], terminal?: string | null } | null}
 */
function workerOf(facts, active) {
  return active ? (facts.workers?.[active.dispatchId] ?? null) : null;
}

/**
 * The feature facts of a lane, for the feature rules F13 to F21. Its step
 * lines name `--feature <epic>/<feature> --epic <epic>`, and its fixes
 * name `/orca-epic <epic>`. A lane in a worktree reads HEAD and the dirty
 * files of its worktree. A lane that waits for its new child worktree has
 * no work tree yet, so it has no dirty file.
 *
 * @param {EpicFacts} facts
 * @param {EpicFeatureFacts} entry
 * @param {LaneMode} [mode]
 * @returns {FeatureFacts}
 */
function laneFacts(facts, entry, mode = 'main') {
  const tree = mode === 'worktree' && entry.worktree ? entry.worktree : null;
  const away = mode === 'new-child' || mode === 'missing';
  return {
    feature: entry.path,
    flags: facts.flags,
    terminalHandle: facts.terminalHandle,
    config: facts.config,
    harnesses: facts.harnesses,
    git: {
      workTree: facts.git.workTree,
      detail: facts.git.detail,
      error: facts.git.error,
      head: tree ? tree.head : away ? null : facts.git.head,
      defaultBranch: facts.git.defaultBranch,
      runBranch: entry.branch,
      runBranchExists: entry.branchExists,
      base: entry.keys.base,
      dirty: tree ? tree.dirty : away ? [] : facts.git.dirty,
      subjects: entry.subjects,
    },
    docs: entry.docs,
    record: entry.record,
    orcaStatus: facts.orcaStatus,
    worker: workerOf(facts, entry.record.record?.active),
    target: { args: ['--feature', entry.path, '--epic', facts.epic], command: `/orca-epic ${facts.epic}`, lane: true },
  };
}

/**
 * The facts of the epic docs tab, for the active rules A1 to A6 and rule
 * F14. Its step lines name `--epic <epic>` alone, and its record is the
 * epic record.
 *
 * @param {EpicFacts} facts
 * @returns {FeatureFacts}
 */
function epicTabFacts(facts) {
  return {
    feature: facts.epic,
    flags: facts.flags,
    terminalHandle: facts.terminalHandle,
    config: facts.config,
    harnesses: facts.harnesses,
    git: {
      workTree: facts.git.workTree,
      detail: facts.git.detail,
      error: facts.git.error,
      head: facts.git.head,
      defaultBranch: facts.git.defaultBranch,
      runBranch: epicBranchOf(facts.epic),
      runBranchExists: facts.git.epicBranchExists,
      base: facts.git.epicBase,
      dirty: facts.git.dirty,
      subjects: [],
    },
    // The done check of the epic-docs stage reads no doc.
    docs: /** @type {any} */ ({
      has: {},
      tasks: null,
      inbox: [],
      inboxActionable: [],
      inboxNewRequirements: [],
      stepVerdicts: facts.epicDocs.stepVerdicts ?? {},
    }),
    record: facts.record,
    orcaStatus: facts.orcaStatus,
    worker: workerOf(facts, facts.record?.record?.active),
    target: { args: ['--epic', facts.epic], command: `/orca-epic ${facts.epic}`, lane: false },
  };
}

/**
 * An action of the epic docs tab names the epic and no feature.
 *
 * @param {Record<string, any>} action
 * @param {string} epic
 * @returns {Record<string, any>}
 */
function asEpicAction(action, epic) {
  const out = { ...action, epic };
  if (out.feature === epic) out.feature = null;
  if (Array.isArray(out.workers)) {
    out.workers = out.workers.map((worker) => (worker.feature === epic ? { ...worker, feature: null, epic } : { ...worker, epic }));
  }
  return out;
}

/**
 * The stages whose agent the epic run still uses (rule E5): the stages of
 * every feature that builds, and the docs agent until the epic docs are
 * done.
 *
 * @param {EpicFacts} facts
 * @returns {{ stage: string, agent: string }[]}
 */
function epicStagesInUse(facts) {
  const { stages } = orchestrationOf(/** @type {any} */ (facts));
  const open = facts.features.filter((entry) => ['run', 'foreign'].includes(laneState(facts, entry)));
  /** @type {{ stage: string, agent: string }[]} */
  const used = [];
  if (open.some((entry) => !entry.docs.has.implementation || !entry.docs.has.tasks)) used.push({ stage: 'plan', agent: stages.plan });
  if (open.length > 0) used.push({ stage: 'implement', agent: stages.implement });
  if (reviewPlacement(stages) === 'split' && open.some((entry) => !entry.docs.has.codeReview)) {
    used.push({ stage: 'review', agent: /** @type {string} */ (stages.review) });
  }
  const marks = stepMarks(facts);
  const lines = stepLinesOf(facts);
  const docsDone = facts.record?.record?.done?.docs === true;
  for (const line of lines) {
    // The feature and phase steps run in each lane. The epic steps run once, before the epic docs.
    const inUse = line.after === 'epic' ? !docsDone && !marks[stepKey('epic', line.k)] : open.length > 0;
    if (inUse) used.push({ stage: 'step', agent: line.agent, what: `orchestration.steps[${line.k}].agent` });
  }
  if (open.length > 0 || facts.record?.record?.done?.docs !== true) used.push({ stage: 'docs', agent: stages.docs });
  return used;
}

/**
 * The rules E1 to E9d: the checks that need no Orca call. steps.js runs the
 * Orca reads only when this answers null. E7 checks the epic reference
 * before E5, because E5 reads the features of the epic.
 *
 * @param {EpicFacts} facts
 * @returns {Record<string, any> | null}
 */
export function epicSetupStop(facts) {
  const { epic, epicDocs } = facts;
  const dir = `docs/features/${epic}`;

  // E1
  if (!facts.terminalHandle) {
    return stop(
      'not-orca-tab',
      'This run needs an Orca agent tab.',
      ['ORCA_TERMINAL_HANDLE is not set, so this shell is not an Orca terminal.'],
      `Open an agent tab in Orca, and run /orca-epic ${epic} there.`
    );
  }

  // E2 to E4
  const unset = configStop(facts.config);
  if (unset) return unset;

  // E7
  if (!epicDocs.valid) {
    return stop(
      'epic-missing',
      'The epic reference is not valid.',
      [epicDocs.reason ?? 'The epic reference is not valid.'],
      'Run the command with the name of one epic folder under docs/features/.'
    );
  }
  if (!epicDocs.exists) {
    return stop('epic-missing', `The epic ${epic} does not exist.`, [`${dir}/ does not exist.`], `Check the name. Run /plan-epic ${epic} to plan a new epic.`);
  }

  // E9a
  if (!epicDocs.isEpic) {
    return stop(
      'not-an-epic',
      `${epic} is not an epic.`,
      [`${dir}/ holds no epic-overview.md.`],
      `Run /orca-feature ${epic} to build it as one feature, or run /plan-epic ${epic} to make it an epic.`
    );
  }

  // E9b
  if (epicDocs.folders.length < 2) {
    const one = epicDocs.folders[0];
    return stop(
      'epic-too-small',
      `The epic ${epic} holds ${countText(epicDocs.folders.length, 'feature folder')}, and an epic run needs two or more.`,
      [`${dir}/ holds ${one ? `one feature folder: ${one}` : 'no feature folder'}.`],
      one ? `Run /orca-feature ${epic}/${one} to build the one feature.` : `Run /plan-epic ${epic} to add the features of the epic.`
    );
  }

  // E5
  const missing = harnessStop(epicStagesInUse(facts), facts.harnesses);
  if (missing) return missing;

  // E6
  const broken = gitStop(facts.git);
  if (broken) return broken;

  // E6a: the epic record, and the record of each feature that the run still builds (CR-1). A merged lane and a
  // feature built outside the run start no tab, so their records only add a note.
  const unread = [
    ...(facts.record?.note ? [{ note: facts.record.note, run: epic, feature: null }] : []),
    ...facts.features
      .filter((entry) => entry.record?.note && ['run', 'foreign'].includes(laneState(facts, entry)))
      .map((entry) => ({ note: /** @type {string} */ (entry.record.note), run: entry.path, feature: entry.path })),
  ];
  if (unread.length > 0) {
    const named = unread.find((item) => item.feature !== null);
    return recordStop(
      unread.map((item) => item.note),
      unread.map((item) => item.run),
      `/orca-epic ${epic}`,
      named ? { feature: named.feature } : {}
    );
  }

  // E8 and E9c: every task list can be read, and every feature has a plan input.
  for (const entry of facts.features) {
    if (entry.docs.tasksError) {
      return stop(
        'no-tasks',
        `The task list of ${entry.path} cannot be read.`,
        [`docs/features/${entry.path}/tasks.md cannot be read: ${entry.docs.tasksError}`],
        'Fix the file permission, then run the command again.',
        { feature: entry.path }
      );
    }
    if (!entry.docs.has.requirements && !entry.docs.has.implementation) {
      return stop(
        'no-plan-input',
        `The feature ${entry.path} has no requirements.md and no implementation.md.`,
        [`docs/features/${entry.path}/ holds neither requirements.md nor implementation.md.`],
        `Write docs/features/${entry.path}/requirements.md, or run /plan-feature ${entry.path}. Then run the command again.`,
        { feature: entry.path }
      );
    }
  }

  // E9d
  const order = epicDocs.buildOrder;
  if (epicDocs.overviewError || order.problems.length > 0) {
    return stop(
      'build-order',
      `The Build Order of ${epic} does not name each feature once.`,
      [
        ...(epicDocs.overviewError ? [`${dir}/epic-overview.md cannot be read: ${epicDocs.overviewError}`] : []),
        ...order.problems.map((problem) => problem.detail),
      ],
      `Edit the "## Build Order" section of ${dir}/epic-overview.md: one numbered item per step, with each feature ` +
        'folder in bold in exactly one item. Then run the command again.'
    );
  }
  return null;
}

/**
 * The lines of the features in a summary, in Build Order order. A lane in
 * a worktree names it, and a merged lane whose worktree stays names it too.
 *
 * @param {EpicFacts} facts
 * @param {EpicPlan} plan
 * @returns {string[]}
 */
function featureLines(facts, plan) {
  const into = epicBranchOf(facts.epic);
  /** @type {string[]} */
  const lines = [];
  for (const group of facts.epicDocs.buildOrder.groups) {
    for (const name of group.features) {
      const entry = facts.features.find((item) => item.name === name);
      if (!entry) continue;
      const state = plan.states.get(name);
      let words;
      if (state === 'merged') {
        words = `merged into ${into}${entry.keys.merged ? ` (${entry.keys.merged.slice(0, 7)})` : ''}`;
        if (entry.worktree) words += `. Its worktree ${entry.worktree.path} stays`;
      } else if (state === 'outside') {
        words = 'built outside this run';
      } else if (state === 'foreign') {
        words = `${entry.branch} was not made by this run`;
      } else {
        const phases = entry.docs.tasks?.phases ?? [];
        const done = phases.reduce((sum, phase) => sum + phase.done, 0);
        const total = phases.reduce((sum, phase) => sum + phase.total, 0);
        const where = entry.worktree
          ? `on ${entry.branch} in the worktree ${entry.worktree.path}`
          : entry.branchExists
            ? `on ${entry.branch}`
            : 'not started';
        words = total > 0 ? `${where}, ${done} of ${countText(total, 'task')} done` : where;
      }
      lines.push(`- ${entry.path}: ${words}`);
    }
  }
  return lines;
}

/**
 * The worktree lines of a summary: each lane worktree that still exists.
 *
 * @param {EpicFacts} facts
 * @returns {string[]}
 */
function worktreeLines(facts) {
  const trees = facts.features.filter((entry) => entry.worktree);
  if (trees.length === 0) return ['Worktrees: none left.'];
  return ['Worktrees:', ...trees.map((entry) => `- ${/** @type {LaneTree} */ (entry.worktree).path} (${entry.path}, ${entry.branch})`)];
}

/**
 * Every tab of the run: the tab of each lane of the current group, in group
 * order, then the epic docs tab.
 *
 * @param {EpicFacts} facts
 * @param {EpicPlan} plan
 * @returns {{ facts: FeatureFacts, active: Record<string, any> }[]}
 */
function openTabs(facts, plan) {
  /** @type {{ facts: FeatureFacts, active: Record<string, any> }[]} */
  const tabs = [];
  for (const entry of plan.lanes) {
    const active = entry.record.record?.active;
    if (active) tabs.push({ facts: laneFacts(facts, entry, laneMode(plan, entry)), active });
  }
  const epicActive = facts.record?.record?.active;
  if (epicActive) tabs.push({ facts: epicTabFacts(facts), active: epicActive });
  return tabs;
}

/**
 * @param {string[]} items
 * @returns {string} "a", "a and b", or "a, b, and c".
 */
function wordList(items) {
  if (items.length <= 2) return items.join(' and ');
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

/**
 * One `wait` for the waits of several tabs: its `workers` list holds every
 * tab, in group order. One wait stays as it is.
 *
 * @param {Record<string, any>[]} waits
 * @returns {Record<string, any>}
 */
function groupWait(waits) {
  if (waits.length === 1) return waits[0];
  const workers = waits.flatMap((action) => action.workers ?? []);
  const tabs = workers.map((worker) => `${tabName(worker.feature, worker)} on ${worker.agent ?? 'its agent'}`);
  return {
    schema: SCHEMA,
    action: 'wait',
    say: `${countText(workers.length, 'tab')} work: ${wordList(tabs)}. Orca wakes this tab when one reports.`,
    workers,
  };
}

/**
 * Rule E11, `--stop`, as F12: while a tab of the run works, the run waits
 * for its report. With several tabs, it waits for each tab that works.
 * Else it ends with "stopped on request". It runs before E10, so a stop
 * request never switches a branch (P3-3).
 *
 * @param {EpicFacts} facts
 * @returns {Record<string, any> | null}
 */
function epicStopRule(facts) {
  if (facts.flags.stop !== true) return null;
  const plan = epicPlan(facts);
  const tabs = openTabs(facts, plan);
  const working = tabs.filter((tab) => ['busy', 'unknown'].includes(tab.facts.worker?.state ?? 'unknown'));
  if (working.length > 0) {
    const names = working.map((tab) => tabName(tab.facts.feature, tab.active));
    return asEpicAction(
      {
        ...groupWait(working.map((tab) => waitAction(tab.facts, tab.active))),
        say: `The run stops after ${wordList(names)} report${names.length === 1 ? 's' : ''}. Orca wakes this tab when ${names.length === 1 ? 'it reports' : 'each one reports'}.`,
      },
      facts.epic
    );
  }
  const { epic, git } = facts;
  const lines = [`Run stopped on request - ${epic}`, '', 'Features:', ...featureLines(facts, plan), ''];
  for (const tab of tabs) {
    lines.push(`Open tab: ${tabName(tab.facts.feature, tab.active)} on ${tab.active.agent ?? 'its agent'}, dispatch ${tab.active.dispatchId}. It stays open in Orca.`);
  }
  lines.push(git.dirty.length === 0 ? 'Uncommitted: none.' : `Uncommitted: ${countText(git.dirty.length, 'file')} on ${git.head ?? 'a detached HEAD'}.`);
  if (facts.features.some((entry) => entry.worktree)) lines.push(...worktreeLines(facts));
  lines.push('', 'Next:', `- Run /orca-epic ${epic} to go on from here.`);
  return { schema: SCHEMA, action: 'done', say: `The run of ${epic} stopped on request.`, show: lines.join('\n') };
}

/**
 * The branch action to `epic/<epic>`: create it from the default branch,
 * or switch to it. A dirty tree stops, and a switch that failed in this run
 * stops until a fresh call.
 *
 * @param {EpicFacts} facts
 * @returns {Record<string, any>}
 */
function toEpicBranch(facts) {
  const { epic, git } = facts;
  const branch = epicBranchOf(epic);
  if (git.dirty.length > 0) {
    return stop(
      'dirty-tree',
      `The work tree has changes, so the run cannot switch to ${branch}.`,
      fileLines(git.dirty),
      'Commit the changes, or move them out of the work tree. Then run the command again.'
    );
  }
  const failed = facts.record?.record?.failedGit;
  if (failed && failed.step === 'branch' && !facts.flags.fresh) {
    return stop('branch-failed', `The switch to ${branch} failed.`, detailLines(failed.detail), `Fix the cause above, then run /orca-epic ${epic} again.`);
  }
  const create = !git.epicBranchExists;
  const base = create ? git.defaultBranch : (git.epicBase ?? git.defaultBranch);
  return {
    schema: SCHEMA,
    action: 'branch',
    say: create ? `Create the branch ${branch} from ${base}.` : `Switch to the branch ${branch}.`,
    run: ['branch', '--epic', epic],
    branch,
    base,
    create,
    feature: null,
  };
}

/**
 * Rule E10: HEAD is neither `epic/<epic>` nor a lane branch of this epic.
 *
 * @param {EpicFacts} facts
 * @returns {Record<string, any> | null}
 */
function epicBranchRule(facts) {
  const { head } = facts.git;
  if (head === epicBranchOf(facts.epic) || facts.features.some((entry) => entry.branch === head)) return null;
  return toEpicBranch(facts);
}

/**
 * @param {EpicFacts} facts
 * @param {EpicFeatureFacts} entry
 * @param {string} say
 * @returns {Record<string, any>}
 */
function mergeAction(facts, entry, say) {
  return {
    schema: SCHEMA,
    action: 'merge',
    say,
    run: ['merge', '--epic', facts.epic, '--feature', entry.path],
    feature: entry.path,
    from: entry.branch,
    into: epicBranchOf(facts.epic),
  };
}

/**
 * A merged feature whose human test commit failed after the merge. The
 * next call stops, and a fresh call runs `merge` again: the merge is done,
 * so it writes and commits only the human tests.
 *
 * @param {EpicFacts} facts
 * @returns {Record<string, any> | null}
 */
function epicFollowUpRule(facts) {
  for (const entry of facts.features) {
    const failed = entry.record.record?.failedGit;
    if (!failed || failed.step !== 'merge' || failed.point !== 'human-tests' || laneState(facts, entry) !== 'merged') continue;
    if (!facts.flags.fresh) {
      return stop(
        'commit-failed',
        `The human test commit of ${entry.path} failed after its merge.`,
        detailLines(failed.detail),
        `Fix the cause above, then run /orca-epic ${facts.epic} again.`,
        { feature: entry.path }
      );
    }
    return mergeAction(facts, entry, `Add the human tests of ${entry.path} to human-testing.md, and commit them.`);
  }
  return null;
}

/**
 * A merge of the lane that failed in this run stops until a fresh call: a
 * conflict stops `merge-conflict` (the merge step aborted it), any other
 * failure `merge-failed`. It runs before the lane branch rule, so the stop
 * comes first.
 *
 * @param {EpicFacts} facts
 * @param {EpicFeatureFacts} entry
 * @returns {Record<string, any> | null}
 */
function laneMergeFailedRule(facts, entry) {
  const failed = entry.record.record?.failedGit;
  if (!failed || failed.step !== 'merge' || failed.point === 'human-tests' || facts.flags.fresh) return null;
  const into = epicBranchOf(facts.epic);
  if (failed.code === 'merge-conflict') {
    const where = entry.worktree ? ` in its worktree ${entry.worktree.path}` : '';
    return stop(
      'merge-conflict',
      `The merge of ${entry.path} into ${into} hit a conflict, so the run aborted it.`,
      detailLines(failed.detail),
      `Resolve the conflict between ${entry.branch} and ${into} by hand, and commit the result on ${entry.branch}${where}. ` +
        `Then run /orca-epic ${facts.epic} again.`
    );
  }
  return stop('merge-failed', `The merge of ${entry.path} into ${into} failed.`, detailLines(failed.detail), `Fix the cause above, then run /orca-epic ${facts.epic} again.`);
}

/**
 * Rule E13, the lane branch: with HEAD off the lane branch, create
 * `feat/<epic>/<feature>` from `epic/<epic>`, or switch to it.
 *
 * @param {EpicFacts} facts
 * @param {EpicFeatureFacts} entry
 * @returns {Record<string, any> | null}
 */
function laneBranchRule(facts, entry) {
  const { git } = facts;
  if (git.head === entry.branch) return null;
  if (git.dirty.length > 0) {
    return stop(
      'dirty-tree',
      `The work tree has changes, so the run cannot switch to ${entry.branch}.`,
      fileLines(git.dirty),
      'Commit the changes, or move them out of the work tree. Then run the command again.'
    );
  }
  const failed = entry.record.record?.failedGit;
  if (failed && failed.step === 'branch' && !facts.flags.fresh) {
    return stop('branch-failed', `The switch to ${entry.branch} failed.`, detailLines(failed.detail), `Fix the cause above, then run /orca-epic ${facts.epic} again.`);
  }
  const into = epicBranchOf(facts.epic);
  const create = !entry.branchExists;
  const base = create ? into : (entry.keys.base ?? into);
  return {
    schema: SCHEMA,
    action: 'branch',
    say: create ? `Create the lane branch ${entry.branch} from ${base}.` : `Switch to the lane branch ${entry.branch}.`,
    run: ['branch', '--epic', facts.epic, '--feature', entry.path],
    branch: entry.branch,
    base,
    create,
    feature: entry.path,
  };
}

/**
 * Rule E11, the fresh start, as F11 for the lane: a fresh call on the lane
 * branch finds changes that no tab owns. The feature-end commit takes them
 * at any cadence, so the cadence never skips the ask. A tab, a failed git
 * write, and a docs tab that ran own the changes, so the ask stays away.
 *
 * @param {EpicFacts} facts
 * @param {EpicFeatureFacts} entry
 * @param {{ head: string | null, dirty: string[] }} [git] The work tree of the lane: the main one, or its worktree.
 * @returns {Record<string, any> | null}
 */
function laneDirtyStartRule(facts, entry, git = facts.git) {
  const { flags } = facts;
  if (!flags.fresh || flags.acceptDirty === true || git.dirty.length === 0 || git.head !== entry.branch) return null;
  const record = entry.record.record;
  if (record?.active || record?.failedGit || record?.done?.docs === true) return null;
  const listed = git.dirty.slice(0, MAX_QUESTION_FILES).join(', ');
  const more = git.dirty.length > MAX_QUESTION_FILES ? `, and ${git.dirty.length - MAX_QUESTION_FILES} more` : '';
  return {
    schema: SCHEMA,
    action: 'ask',
    reason: 'dirty-start',
    say: `The work tree of ${entry.branch} holds ${countText(git.dirty.length, 'changed file')} at the start of the run.`,
    question:
      `[${entry.path}] The work tree holds ${countText(git.dirty.length, 'changed file')}: ${listed}${more}. ` +
      'The next commit of the run takes them. What now?',
    options: [
      {
        key: 'stop',
        label: 'Stop the run. Commit the changes, or move them out of the work tree. Then run the command again.',
        run: null,
      },
      {
        key: 'go-on',
        label: 'Go on with the changes. The next commit of the run takes them.',
        run: ['next', '--epic', facts.epic, '--fresh', '--accept-dirty'],
      },
    ],
    recommended: 'stop',
    feature: entry.path,
    files: fileLines(git.dirty),
  };
}

/**
 * The lane end: the docs tab of the lane is done. A dirty tree commits the
 * feature end at any cadence (Decision 10), then a clean tree merges the
 * lane into the epic branch.
 *
 * @param {EpicFacts} facts
 * @param {EpicFeatureFacts} entry
 * @returns {Record<string, any>}
 */
function laneEndRule(facts, entry) {
  const tree = entry.worktree ?? null;
  const into = epicBranchOf(facts.epic);
  if ((tree ? tree.dirty : facts.git.dirty).length === 0) {
    if (!tree) return mergeAction(facts, entry, `Merge ${entry.path} into ${into}.`);
    // A lane in a worktree merges in the main workspace, which stays on the epic branch.
    if (facts.git.head !== into) return toEpicBranch(facts);
    if (facts.git.dirty.length > 0) {
      return stop(
        'dirty-tree',
        `The work tree of ${into} has changes, so the run cannot merge ${entry.path}.`,
        fileLines(facts.git.dirty),
        `Commit the changes, or move them out of the work tree. Then run /orca-epic ${facts.epic} again.`,
        { feature: entry.path }
      );
    }
    return mergeAction(facts, entry, `Merge ${entry.path} into ${into}. Then remove its worktree ${tree.path}.`);
  }
  const failed = entry.record.record?.failedGit;
  if (failed && failed.step === 'commit' && failed.point === 'feature' && !facts.flags.fresh) {
    return stop(
      'commit-failed',
      `The feature-end commit of ${entry.path} failed.`,
      detailLines(failed.detail),
      `Fix the cause above, then run /orca-epic ${facts.epic} again.`
    );
  }
  return {
    schema: SCHEMA,
    action: 'commit',
    say: tree ? `Commit the end of ${entry.path} in its worktree.` : `Commit the end of ${entry.path}.`,
    run: ['commit', ...laneFacts(facts, entry).target.args, '--point', 'feature'],
    feature: entry.path,
    point: 'feature',
    phase: null,
    subject: featureSubject(entry.path),
  };
}

/**
 * The checks of a lane that builds away from the main workspace, before
 * its feature rules. A branch with no worktree stops `worktree-missing`.
 * A new child worktree starts from `epic/<epic>`, so a lane needs
 * `.beast-mode/phase-handoff.md` in that tree, and a worktree needs it on
 * disk: else the stop `beast-mode-uncommitted` names the cause. A git read
 * inside the worktree that failed stops `git-failed`.
 *
 * @param {EpicFacts} facts
 * @param {EpicFeatureFacts} entry
 * @param {LaneMode} mode
 * @returns {Record<string, any> | null}
 */
function laneSiteRule(facts, entry, mode) {
  const { epic } = facts;
  const into = epicBranchOf(epic);
  const extra = { feature: entry.path };
  if (mode === 'missing') {
    return stop(
      'worktree-missing',
      `The lane branch ${entry.branch} of ${entry.path} exists, and no worktree holds it.`,
      [`A lane of a side-by-side group builds in its own worktree, and git worktree list names none for ${entry.branch}.`],
      `Open ${entry.branch} in an Orca worktree again, or set "concurrent": false in .beast-mode/orca.json to build ` +
        `the group one feature at a time. Then run /orca-epic ${epic} again.`,
      extra
    );
  }
  const uncommitted = (where) =>
    stop(
      'beast-mode-uncommitted',
      `The lane ${entry.path} cannot build in a worktree, because the project does not commit .beast-mode/.`,
      [`${where} holds no .beast-mode/phase-handoff.md, and every worker reads it first.`],
      `Commit .beast-mode/ to ${into} (the briefs folder stays out), or set "concurrent": false in ` +
        `.beast-mode/orca.json. Then run /orca-epic ${epic} again.`,
      extra
    );
  if (mode === 'new-child') return facts.git.epicHandoff === false ? uncommitted(`The tree of ${into}`) : null;
  if (mode !== 'worktree' || !entry.worktree) return null;
  if (entry.worktree.error) {
    return stop(
      'git-failed',
      `A git read in the worktree of ${entry.path} failed.`,
      detailLines(entry.worktree.error),
      `Fix the git error above in ${entry.worktree.path}, then run /orca-epic ${epic} again.`,
      extra
    );
  }
  return entry.worktree.handoff ? null : uncommitted(`The worktree ${entry.worktree.path}`);
}

/**
 * A start of a lane away from the main workspace names its placement: a
 * new child worktree from the epic branch, or the worktree of the lane.
 *
 * @param {Record<string, any>} action
 * @param {EpicFacts} facts
 * @param {EpicFeatureFacts} entry
 * @param {LaneMode} mode
 * @returns {Record<string, any>}
 */
function placed(action, facts, entry, mode) {
  if (action.action !== 'start' || (mode !== 'new-child' && mode !== 'worktree')) return action;
  const tree = entry.worktree?.path ?? null;
  const where =
    mode === 'new-child' ? `It opens in a new worktree from ${epicBranchOf(facts.epic)}.` : `It opens in the worktree ${tree}.`;
  return { ...action, say: `${action.say} ${where}`, placement: mode, worktree: tree };
}

/**
 * A lane: the feature rules F13 to F21 of one feature (the docs tab runs
 * `/update-feature` only), then the lane end. A lane in the main workspace
 * takes its branch first (rule E13). A lane away from it takes the checks
 * of its worktree first, and its facts come from inside the worktree (rule
 * E14). A wait names the worktree of its tab.
 *
 * @param {EpicFacts} facts
 * @param {EpicFeatureFacts} entry
 * @param {LaneMode} [mode]
 * @returns {Record<string, any>}
 */
function laneRule(facts, entry, mode = 'main') {
  const lane = laneFacts(facts, entry, mode);
  const away = mode !== 'main';
  const action =
    laneMergeFailedRule(facts, entry) ??
    (away ? laneSiteRule(facts, entry, mode) : laneBranchRule(facts, entry)) ??
    laneDirtyStartRule(facts, entry, lane.git) ??
    activeRule(lane) ??
    failedStartRule(lane) ??
    planRule(lane) ??
    phaseRule(lane) ??
    reviewRule(lane) ??
    reviewCommitRule(lane) ??
    featureStepRule(lane) ??
    inboxRule(lane) ??
    docsRule(lane) ??
    laneEndRule(facts, entry);
  const out = placed({ ...action, feature: action.feature ?? entry.path }, facts, entry, mode);
  if (out.action === 'wait' && Array.isArray(out.workers)) {
    out.workers = out.workers.map((worker) => ({ ...worker, worktree: entry.worktree?.path ?? null }));
  }
  return out;
}

/**
 * Rule E14: the lanes of a side-by-side group, in group order. Each lane
 * runs its rules on its own facts. The first action that is not `wait`
 * wins, so an ask of one lane leaves the tabs of the others running. When
 * every lane waits, one `wait` lists every tab.
 *
 * @param {EpicFacts} facts
 * @param {EpicPlan} plan
 * @returns {Record<string, any>}
 */
function concurrentRule(facts, plan) {
  /** @type {Record<string, any>[]} */
  const waits = [];
  for (const entry of plan.lanes) {
    const action = laneRule(facts, entry, laneMode(plan, entry));
    if (action.action !== 'wait') return action;
    waits.push(action);
  }
  return groupWait(waits);
}

/**
 * @param {EpicFacts} facts
 * @returns {Record<string, any>}
 */
function epicDocsStart(facts) {
  const agent = orchestrationOf(/** @type {any} */ (facts)).stages.docs;
  return {
    schema: SCHEMA,
    action: 'start',
    say: `Start the epic docs tab of ${facts.epic} on ${agent}: ${epicDocsCommands(facts.epic).join(', ')}.`,
    run: ['start', '--epic', facts.epic, '--stage', 'epic-docs'],
    feature: null,
    stage: 'epic-docs',
    phase: null,
    agent,
    placement: 'current',
  };
}

/**
 * The step results and the verify verdicts of an epic summary: the marks of
 * each lane record and of the epic record, and the verdict of each phase of
 * each lane. Empty with no mark and no verdict.
 *
 * @param {EpicFacts} facts
 * @returns {string[]}
 */
function epicResultLines(facts) {
  const tabs = facts.features.map((entry) => ({ owner: entry.path, tab: laneFacts(facts, entry) }));
  const steps = [
    ...tabs.flatMap(({ owner, tab }) => stepResultLines(tab, owner)),
    ...stepResultLines(epicTabFacts(facts), facts.epic),
  ];
  const verify = tabs.flatMap(({ owner, tab }) =>
    (tab.docs.tasks?.phases ?? [])
      .map((phase) => ({ phase, part: verifyPart(tab, phase.number) }))
      .filter((row) => row.part !== '')
      .map((row) => `- ${owner} Phase ${row.phase.number}${row.part.replace(/^, /, ': ')}`)
  );
  const overridden = steps.filter((line) => line.endsWith(': overridden'));
  return [
    ...(steps.length > 0 ? ['', 'Steps:', ...overridden, ...steps.filter((line) => !overridden.includes(line))] : []),
    ...(verify.length > 0 ? ['', 'Verify:', ...verify] : []),
  ];
}

/**
 * The epic summary: the features, the epic docs, the files left
 * uncommitted, the human tests, and the next steps. No epic commit lands.
 *
 * @param {EpicFacts} facts
 * @param {ReturnType<typeof epicPlan>} plan
 * @returns {Record<string, any>}
 */
function epicDoneRule(facts, plan) {
  const { epic, git } = facts;
  const dir = `docs/features/${epic}`;
  const into = epicBranchOf(epic);
  const base = git.epicBase ?? git.defaultBranch ?? 'the default branch';
  const tests = facts.epicDocs.humanTests.length;
  const lines = [
    `Epic run summary - ${epic}`,
    '',
    'Features:',
    ...featureLines(facts, plan),
    ...epicResultLines(facts),
    '',
    `Docs: the epic docs tab ran ${epicDocsCommands(epic).join(', ')}. No epic commit.`,
  ];
  if (git.dirty.length === 0) {
    lines.push('Uncommitted: none.');
  } else {
    lines.push(`Uncommitted: ${countText(git.dirty.length, 'file')} on ${into}.`, ...fileLines(git.dirty).map((file) => `- ${file}`));
  }
  const trees = facts.features.filter((entry) => entry.worktree);
  // A summary of a run that built no lane in a worktree keeps its Phase 5 lines.
  if (trees.length > 0 || facts.features.some((entry) => entry.branch !== runBranchOf(entry.path))) lines.push(...worktreeLines(facts));
  lines.push(`Human tests: ${countText(tests, 'open line')} in ${dir}/human-testing.md.`, '', 'Next:');
  if (git.dirty.length > 0) lines.push(`- Review and commit the ${countText(git.dirty.length, 'uncommitted file')}. The run makes no epic commit.`);
  if (tests > 0) lines.push(`- Run the ${countText(tests, 'human test')} in ${dir}/human-testing.md.`);
  for (const entry of trees) {
    lines.push(`- Remove the worktree ${/** @type {LaneTree} */ (entry.worktree).path} in Orca. The run did not remove it.`);
  }
  lines.push(`- Merge ${into} into ${base} when you are ready. The feature branches stay for you to delete.`);
  return { schema: SCHEMA, action: 'done', say: `The epic run of ${epic} is done.`, show: lines.join('\n') };
}

/**
 * The epic point of rule E12: the epic steps run after the last merge, in
 * the main workspace on the epic branch, before the epic docs tab. Each
 * runs once. They never run in `/orca-feature`, and an epic with its docs
 * done runs none.
 *
 * @param {FeatureFacts} tab The facts of the epic tab.
 * @returns {Record<string, any> | null}
 */
function epicStepRule(tab) {
  if (docsDone(tab)) return null;
  const line = pendingStep(tab, 'epic');
  return line ? stepStartAction(tab, line, null) : null;
}

/**
 * Rule E12: no Build Order group holds a feature of the run list. On the
 * epic branch, the epic steps run (point `epic`), then the epic docs tab (with the
 * active rules A1 to A6 and rule F14 for each tab), then `done` with the
 * summary and no commit.
 *
 * @param {EpicFacts} facts
 * @param {ReturnType<typeof epicPlan>} plan
 * @returns {Record<string, any>}
 */
function epicEndRule(facts, plan) {
  if (facts.git.head !== epicBranchOf(facts.epic)) return toEpicBranch(facts);
  const tab = epicTabFacts(facts);
  const action =
    activeRule(tab) ??
    failedStartRule(tab) ??
    epicStepRule(tab) ??
    (facts.record?.record?.done?.docs === true ? null : epicDocsStart(facts)) ??
    epicDoneRule(facts, plan);
  return asEpicAction(action, facts.epic);
}

/**
 * @param {EpicFeatureFacts} entry
 * @returns {boolean} The lane record holds the mark `sequential`: Orca refused a new worktree for the
 *   project command of the lane (fact O15), so the lane builds in the main workspace (Notes 8).
 */
function inSequence(entry) {
  const mark = entry.record?.record?.sequential;
  return mark !== null && typeof mark === 'object';
}

/**
 * Notes 8: Orca refused the new worktree of a lane with a project command
 * (fact O15). The run stops with the cause, before any lane builds. The
 * clear of the failed start keeps the mark `sequential`, so the group then
 * builds in sequence, and the lane builds in the main workspace.
 *
 * @param {EpicFacts} facts
 * @param {EpicPlan} plan
 * @returns {Record<string, any> | null}
 */
function laneRefusedRule(facts, plan) {
  const entry = plan.lanes.find((lane) => lane.record?.record?.failedStart?.code === LANE_REFUSED);
  if (!entry) return null;
  const failed = /** @type {Record<string, any>} */ (entry.record.record).failedStart;
  const command = typeof failed.command === 'string' && failed.command ? failed.command : null;
  return stop(
    LANE_REFUSED,
    `Orca refused a new worktree for the lane ${entry.path}${command ? ` with the project command "${command}"` : ''}.`,
    detailLines(failed.detail),
    `The lanes of this group now build in sequence, and ${entry.path} builds in the main workspace. Run {run} to clear ` +
      `the failed start. Then run /orca-epic ${facts.epic} again.`,
    { feature: entry.path, fixRun: ['close', '--feature', entry.path, '--epic', facts.epic] }
  );
}

/**
 * The run list (§The run list of an epic), then rule E12, E13, or E14. A
 * foreign lane branch stops the run before any lane builds. A side-by-side
 * group runs every lane (E14). Else the first lane builds alone (E13), in
 * its worktree when it holds one.
 *
 * @param {EpicFacts} facts
 * @returns {Record<string, any>}
 */
function epicLaneRule(facts) {
  const plan = epicPlan(facts);
  if (plan.foreign.length > 0) {
    const into = epicBranchOf(facts.epic);
    return stop(
      'branch-foreign',
      plan.foreign.length === 1
        ? `The branch ${plan.foreign[0].branch} was not made by this run, and ${into} does not hold it.`
        : `${plan.foreign.length} lane branches were not made by this run, and ${into} does not hold them.`,
      plan.foreign.map((entry) => `${entry.branch} holds no beast-mode-epic key, and ${into} does not hold it.`),
      `Merge each branch above into ${into}, or rename it. Then run /orca-epic ${facts.epic} again.`,
      { feature: plan.foreign[0].path }
    );
  }
  if (!facts.git.epicBranchExists) return toEpicBranch(facts);
  if (!plan.lane) return epicEndRule(facts, plan);
  const refused = laneRefusedRule(facts, plan);
  if (refused) return refused;
  return plan.concurrent ? concurrentRule(facts, plan) : laneRule(facts, plan.lane, laneMode(plan, plan.lane));
}

/**
 * Decide the next action of an epic run. The first matching rule wins: E1
 * to E9d, E9, E11 (`--stop`), E10, the human test follow-up, then the run
 * list with E12, E13, or E14. Every action names the epic.
 *
 * @param {EpicFacts} facts
 * @returns {Record<string, any>}
 */
export function decideEpic(facts) {
  const action =
    epicSetupStop(facts) ??
    orcaRule(/** @type {any} */ (facts)) ??
    epicStopRule(facts) ??
    epicBranchRule(facts) ??
    epicFollowUpRule(facts) ??
    epicLaneRule(facts);
  const notes = [facts.record?.note, ...facts.features.map((entry) => entry.record?.note)].filter(
    (note) => typeof note === 'string' && note.length > 0
  );
  return withNote(withLaunchPath(facts, { ...action, epic: facts.epic }), notes.length > 0 ? notes.join(' ') : null);
}
