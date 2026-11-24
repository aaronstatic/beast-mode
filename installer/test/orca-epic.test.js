// installer/test/orca-epic.test.js
//
// The epic run of `beast-mode orca` (orca-plugin/orchestration, Phase 5):
// the Build Order table, the epic decision walk over fact sets, the epic
// specs, the human test writer, and temporary git repositories that build
// an epic with a fake Orca. The git tests skip when git is absent. No test
// starts a real Orca CLI, and no test sets a global git config.
//
// Phase 6 adds the tests named `lanes:`: the features of one Build Order
// item build side by side, each in a child worktree that the fake Orca
// makes with real git, and each merges into epic/<epic> with --no-ff.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { adapters } from '../adapters/index.js';
import { UsageError } from '../lib/errors.js';
import { findPluginRoot } from '../lib/source.js';
import { decideEpic, laneState } from '../lib/orca/decide.js';
import { defaultRunner, gitCalls, laneSelector, orcaCalls, receiptWorktree } from '../lib/orca/exec.js';
import {
  appendHumanTests,
  humanTestingFromTemplate,
  isConcurrentGroup,
  laneBranchOf,
  laneWorktree,
  newEpicRecord,
  newRecord,
  parseBuildOrder,
  parseOrcaConfig,
  parseRunKeys,
  parseTasks,
  parseWorktreeList,
  readEpicRecord,
  readRecord,
  writeEpicRecord,
} from '../lib/orca/read.js';
import { docsSpec, epicDocsSpec, phaseSpec } from '../lib/orca/spec.js';
import { runLine, runOrca } from '../lib/orca/steps.js';
import { createTempProjectRoot, removeFixture } from './helpers.js';

const PLUGIN_ROOT = findPluginRoot(import.meta.dirname);
const BIN = path.join(PLUGIN_ROOT, 'installer', 'bin', 'beast-mode.js');
const NODE = '/usr/bin/node';
const FAKE_ORCA = 'fake-orca';
const NOW = new Date('2026-11-18T07:10:00.000Z');
const CONFIG = { version: 1, orchestration: { stages: { implement: 'dsh', review: false } } };
const HAS_GIT = spawnSync('git', ['--version'], { encoding: 'utf8' }).status === 0;
const NO_GIT = HAS_GIT ? false : 'git is not installed';
const BUILD_ORDER = [
  '# Editor - Epic Overview',
  '',
  '## Build Order / Dependencies',
  '',
  '1. **base** - the foundation.',
  '2. **ux** - it needs base.',
  '',
  '**Dependencies between features:**',
  '- base → ux',
  '',
].join('\n');
const RUNNING_STATUS = { running: true, detail: [] };

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

/**
 * @param {number} number
 * @param {{ done?: number, open?: number }} [opts]
 * @returns {string}
 */
function phaseText(number, { done = 0, open = 0 } = {}) {
  const lines = [`## Phase ${number}: Slice ${number} (${done}/${done + open} complete)`, ''];
  for (let i = 1; i <= done; i += 1) lines.push(`- [x] Task ${number}.${i}`);
  for (let i = 1; i <= open; i += 1) lines.push(`- [ ] Task ${number}.${done + i}`);
  lines.push('');
  return lines.join('\n');
}

const OPEN = ['# Tasks', '', phaseText(1, { open: 2 })].join('\n');
const COMPLETE = ['# Tasks', '', phaseText(1, { done: 2 })].join('\n');

/**
 * @param {string} name
 * @returns {{ base: string, epic: string, feature: string, merged: null }}
 */
function laneKeys(name) {
  return { base: 'epic/editor', epic: 'editor', feature: `editor/${name}`, merged: null };
}

/**
 * One feature folder of the epic `editor`: a plan, open tasks, no branch, and no record.
 *
 * @param {string} name
 * @param {{ tasks?: string, has?: Record<string, boolean>, record?: Record<string, any> | null, branchExists?: boolean, held?: boolean, keys?: Record<string, any>, subjects?: string[] }} [opts]
 * @returns {import('../lib/orca/decide.js').EpicFeatureFacts}
 */
function featureEntry(name, { tasks = OPEN, has = {}, record = null, branchExists = false, held = false, keys = {}, subjects = [] } = {}) {
  return /** @type {any} */ ({
    name,
    path: `editor/${name}`,
    docs: {
      valid: true,
      reason: null,
      exists: true,
      isEpic: false,
      epic: 'editor',
      has: { requirements: true, implementation: true, tasks: true, context: true, inbox: true, codeReview: false, ...has },
      tasks: parseTasks(tasks),
      tasksError: null,
      review: null,
      reviewError: null,
      humanTests: [],
      inbox: [],
      inboxActionable: [],
      inboxNewRequirements: [],
    },
    record: { record, note: null },
    branch: `feat/editor/${name}`,
    branchExists,
    held,
    keys: { base: null, epic: null, feature: null, merged: null, ...keys },
    subjects,
  });
}

/**
 * @param {string} name
 * @returns {import('../lib/orca/decide.js').EpicFeatureFacts}
 */
function mergedEntry(name) {
  return featureEntry(name, { tasks: COMPLETE, branchExists: true, held: true, keys: { ...laneKeys(name), merged: 'abc1234def567' } });
}

/**
 * A fact set where every check passes: an Orca tab, a valid config with the
 * review off, both harnesses, HEAD on `epic/editor`, and two open features.
 *
 * @param {Record<string, any>} [patch] Top-level keys replace. `flags`, `git`, and `epicDocs` merge one level.
 * @returns {import('../lib/orca/decide.js').EpicFacts}
 */
function epicFacts(patch = {}) {
  const base = {
    epic: 'editor',
    flags: { fresh: false, wake: null, dispatch: null, stop: false, acceptDirty: false },
    terminalHandle: 'term-1',
    config: parseOrcaConfig(JSON.stringify(CONFIG)),
    harnesses: ['claude', 'dsh'],
    git: {
      workTree: true,
      detail: [],
      error: null,
      head: 'epic/editor',
      defaultBranch: 'main',
      epicBranchExists: true,
      epicBase: 'main',
      dirty: [],
    },
    epicDocs: {
      valid: true,
      reason: null,
      exists: true,
      isEpic: true,
      overviewError: null,
      folders: ['base', 'ux'],
      buildOrder: parseBuildOrder(BUILD_ORDER, ['base', 'ux']),
      humanTests: [],
    },
    features: [featureEntry('base'), featureEntry('ux')],
    record: { record: null, note: null },
    orcaStatus: null,
    workers: {},
  };
  /** @type {Record<string, any>} */
  const out = { ...base, ...patch };
  for (const key of ['flags', 'git', 'epicDocs']) {
    if (patch[key]) out[key] = { .../** @type {any} */ (base)[key], ...patch[key] };
  }
  return /** @type {any} */ (out);
}

/**
 * @param {Record<string, any>} [extra]
 * @returns {Record<string, any>}
 */
function activeEntry(extra = {}) {
  return {
    stage: 'phase',
    phase: 1,
    step: null,
    round: 0,
    agent: 'dsh',
    placement: 'current',
    dispatchId: 'disp-1',
    taskId: 'task-1',
    runId: 'run-1',
    startedAt: '2026-11-18T07:10:00.000Z',
    sendBacks: 0,
    escalations: 0,
    ...extra,
  };
}

/**
 * @param {Record<string, any>} action
 * @param {string} kind
 * @returns {Record<string, any>}
 */
function assertAction(action, kind) {
  assert.equal(action.schema, 1);
  assert.equal(action.action, kind, JSON.stringify(action));
  assert.equal(typeof action.say, 'string');
  assert.ok(action.say.length > 0);
  assert.equal(action.epic, 'editor', 'every action of the epic run names the epic');
  return action;
}

/**
 * @param {Record<string, any>} action
 * @param {string} reason
 * @returns {Record<string, any>}
 */
function assertStop(action, reason) {
  assertAction(action, 'stop');
  assert.equal(action.reason, reason, JSON.stringify(action));
  assert.ok(Array.isArray(action.detail));
  assert.equal(typeof action.fix, 'string');
  return action;
}

// ---------------------------------------------------------------------------
// The Build Order table
// ---------------------------------------------------------------------------

const BUILD_ORDER_CASES = [
  {
    name: 'the template shape: one feature per item, and the dependency bullets count nowhere',
    text: [
      '## Build Order / Dependencies',
      '',
      '1. **base** - first.',
      '2. **ux** - second.',
      '3. **polish** - last.',
      '',
      '**Dependencies between features:**',
      '- **base** → ux',
      '',
    ].join('\n'),
    folders: ['base', 'polish', 'ux'],
    groups: [
      [1, ['base']],
      [2, ['ux']],
      [3, ['polish']],
    ],
    problems: [],
  },
  {
    name: 'two bold names in one item are one group, and bold prose names no feature',
    text: ['## Build Order', '', '1. **base** - **Complete (v3.1.0).**', '2. **ux** and **api** - side by side, **in parallel**.', ''].join('\n'),
    folders: ['api', 'base', 'ux'],
    groups: [
      [1, ['base']],
      [2, ['ux', 'api']],
    ],
    problems: [],
  },
  {
    name: 'an indented line continues its item, a blank line keeps it open, and a fence counts nowhere',
    text: ['## Build Order', '', '1. The base:', '   - **base**', '   1. a nested step', '', '2. **ux**', '```', '3. **api**', '```', ''].join('\n'),
    folders: ['base', 'ux'],
    groups: [
      [1, ['base']],
      [2, ['ux']],
    ],
    problems: [],
  },
  {
    name: 'a name in two items, and a folder in no item, are problems',
    text: ['## Build Order', '', '1. **base**', '2. **ux**', '3. **base** again', ''].join('\n'),
    folders: ['api', 'base', 'ux'],
    groups: [
      [1, ['base']],
      [2, ['ux']],
    ],
    problems: [
      ['repeated', 'base', [1, 3], '"base" is in items 1 and 3 of the Build Order.'],
      ['not-listed', 'api', [], '"api" is in no item of the Build Order.'],
    ],
  },
  {
    name: 'a numbered list of another section counts nowhere, and no Build Order is one problem',
    text: ['## Features', '', '1. **base**', '2. **ux**', ''].join('\n'),
    folders: ['base', 'ux'],
    groups: [],
    problems: [['no-build-order', null, [], 'The doc holds no "## Build Order" section.']],
  },
  {
    name: 'a code span inside the bold and a trailing colon pass, and the next heading ends the section',
    text: ['## Build order', '', '1. **`base`**: first.', '2. __ux:__ second.', '## Integration', '', '3. **api**', ''].join('\n'),
    folders: ['api', 'base', 'ux'],
    groups: [
      [1, ['base']],
      [2, ['ux']],
    ],
    problems: [['not-listed', 'api', [], '"api" is in no item of the Build Order.']],
  },
];

for (const entry of BUILD_ORDER_CASES) {
  test(`build order: ${entry.name}`, () => {
    const order = parseBuildOrder(entry.text, entry.folders);
    assert.deepEqual(
      order.groups.map((group) => [group.item, group.features]),
      entry.groups
    );
    assert.deepEqual(
      order.problems.map((problem) => [problem.code, problem.feature, problem.items, problem.detail]),
      entry.problems
    );
  });
}

test('build order: a text that is not a string has no Build Order, and the parse never throws', () => {
  for (const value of [null, undefined, 42]) {
    const order = parseBuildOrder(value, ['base']);
    assert.deepEqual([order.found, order.groups, order.problems.map((problem) => problem.code)], [false, [], ['no-build-order']]);
  }
});

// ---------------------------------------------------------------------------
// The epic decision walk
// ---------------------------------------------------------------------------

test('epic decide E1 to E9d: each setup check stops with its reason', () => {
  assert.match(assertStop(decideEpic(epicFacts({ terminalHandle: null })), 'not-orca-tab').fix, /run \/orca-epic editor there/);
  assertStop(decideEpic(epicFacts({ config: { state: 'missing', problems: [], orchestration: null } })), 'config-missing');
  assertStop(decideEpic(epicFacts({ epicDocs: { valid: false, reason: 'bad' } })), 'epic-missing');
  assertStop(decideEpic(epicFacts({ epicDocs: { exists: false } })), 'epic-missing');
  assertStop(decideEpic(epicFacts({ epicDocs: { isEpic: false } })), 'not-an-epic');
  const small = assertStop(decideEpic(epicFacts({ epicDocs: { folders: ['base'] }, features: [featureEntry('base')] })), 'epic-too-small');
  assert.match(small.fix, /\/orca-feature editor\/base/);
  assertStop(decideEpic(epicFacts({ harnesses: ['claude'] })), 'harness-missing');
  assertStop(decideEpic(epicFacts({ git: { workTree: false, detail: ['not a repository'] } })), 'not-git');
  assertStop(decideEpic(epicFacts({ git: { defaultBranch: null } })), 'no-default-branch');
  const noInput = assertStop(
    decideEpic(epicFacts({ features: [featureEntry('base'), featureEntry('ux', { has: { requirements: false, implementation: false } })] })),
    'no-plan-input'
  );
  assert.equal(noInput.feature, 'editor/ux');
  const order = assertStop(
    decideEpic(epicFacts({ epicDocs: { buildOrder: parseBuildOrder('## Build Order\n\n1. **base**\n', ['base', 'ux']) } })),
    'build-order'
  );
  assert.deepEqual(order.detail, ['"ux" is in no item of the Build Order.']);
  assertStop(decideEpic(epicFacts({ flags: { fresh: true }, orcaStatus: { running: false, detail: ['down'] } })), 'orca-not-running');
});

test('epic decide E10 and E13: a fresh run makes the epic branch, then the lane branch, then starts the lane', () => {
  let action = assertAction(decideEpic(epicFacts({ git: { head: 'main', epicBranchExists: false, epicBase: null } })), 'branch');
  assert.deepEqual([action.branch, action.base, action.create, action.feature], ['epic/editor', 'main', true, null]);
  assert.deepEqual(action.run, ['branch', '--epic', 'editor']);

  action = assertAction(decideEpic(epicFacts()), 'branch');
  assert.deepEqual([action.branch, action.base, action.create, action.feature], ['feat/editor/base', 'epic/editor', true, 'editor/base']);
  assert.deepEqual(action.run, ['branch', '--epic', 'editor', '--feature', 'editor/base']);

  const onLane = epicFacts({
    git: { head: 'feat/editor/base' },
    features: [featureEntry('base', { branchExists: true, keys: laneKeys('base') }), featureEntry('ux')],
  });
  action = assertAction(decideEpic(onLane), 'start');
  assert.deepEqual(action.run, ['start', '--feature', 'editor/base', '--epic', 'editor', '--stage', 'phase', '--phase', '1']);
  assert.deepEqual([action.feature, action.stage, action.agent], ['editor/base', 'phase', 'dsh']);
});

test('epic decide E13: a run resumed on a lane branch waits on a busy tab, and closes a done tab with --epic', () => {
  const resumed = (worker, tasks = OPEN, flags = {}) =>
    epicFacts({
      flags,
      git: { head: 'feat/editor/base' },
      features: [
        featureEntry('base', { branchExists: true, keys: laneKeys('base'), tasks, record: { ...newRecord('editor/base'), active: activeEntry() } }),
        featureEntry('ux'),
      ],
      workers: { 'disp-1': worker },
    });
  const busy = { state: 'busy', detail: [] };
  const waited = assertAction(decideEpic(resumed(busy)), 'wait');
  assert.deepEqual([waited.workers[0].dispatchId, waited.workers[0].feature], ['disp-1', 'editor/base']);
  // Fix 7: a lane wait on a dsh tab names the timer of the epic run, and a busy dsh lane with undelivered mail gets the send.
  assert.deepEqual(waited.timer.run, ['next', '--epic', 'editor', '--wake', 'timer']);
  const mailed = assertAction(decideEpic(resumed({ ...busy, mail: { messages: [{ id: 'msg_a' }], detail: [] } })), 'send');
  assert.deepEqual(mailed.run, ['send', '--feature', 'editor/base', '--epic', 'editor', '--reason', 'escalation', '--mail']);
  // Fix 9: an idle lane tab with an open question gets the question action of its lane, not a send.
  const asked = decideEpic(resumed({ state: 'idle', detail: [], questions: { questions: [{ id: 'msg_q', question: 'All hold?', options: [] }], detail: [] } }, OPEN, { wake: 'timer' }));
  assert.deepEqual([asked.action, asked.feature, asked.questions[0].id], ['question', 'editor/base', 'msg_q']);

  const closed = assertAction(decideEpic(resumed({ state: 'done', detail: [] }, COMPLETE)), 'close');
  assert.deepEqual(closed.run, ['close', '--feature', 'editor/base', '--epic', 'editor']);

  const stopped = assertStop(decideEpic(resumed(busy, OPEN, { fresh: true })), 'tab-still-runs');
  assert.match(stopped.fix, /run \/orca-epic editor again\.$/);
});

test('epic decide: the lane docs run /update-feature only, then the feature-end commit at any cadence, then the merge', () => {
  const docsDone = { ...newRecord('editor/base'), done: { docs: true, steps: {} } };
  const laneDone = (record, dirty = [], config = CONFIG) =>
    epicFacts({
      config: parseOrcaConfig(JSON.stringify(config)),
      git: { head: 'feat/editor/base', dirty },
      features: [
        featureEntry('base', { branchExists: true, keys: laneKeys('base'), tasks: COMPLETE, record, subjects: ['feat: editor/base phase 1'] }),
        featureEntry('ux'),
      ],
    });

  let action = assertAction(decideEpic(laneDone(null)), 'start');
  assert.equal(action.stage, 'docs');
  assert.match(action.say, /: \/update-feature editor\/base\.$/);
  assert.deepEqual(action.run, ['start', '--feature', 'editor/base', '--epic', 'editor', '--stage', 'docs']);

  action = assertAction(decideEpic(laneDone(docsDone, ['docs/features/editor/base/context.md'])), 'commit');
  assert.deepEqual([action.point, action.subject, action.phase], ['feature', 'feat: editor/base', null]);
  assert.deepEqual(action.run, ['commit', '--feature', 'editor/base', '--epic', 'editor', '--point', 'feature']);
  const featureCadence = { version: 1, orchestration: { stages: { implement: 'dsh', review: false }, commit: 'feature' } };
  assert.equal(assertAction(decideEpic(laneDone(docsDone, ['a.txt'], featureCadence)), 'commit').point, 'feature');

  action = assertAction(decideEpic(laneDone(docsDone)), 'merge');
  assert.deepEqual([action.feature, action.from, action.into], ['editor/base', 'feat/editor/base', 'epic/editor']);
  assert.deepEqual(action.run, ['merge', '--epic', 'editor', '--feature', 'editor/base']);
});

test('epic decide run list: a merged feature and a feature built outside the run leave it, and a foreign branch stops', () => {
  const plain = epicFacts();
  assert.equal(laneState(plain, mergedEntry('base')), 'merged');
  assert.equal(laneState(plain, featureEntry('base', { tasks: COMPLETE })), 'outside');
  assert.equal(laneState(plain, featureEntry('base', { tasks: COMPLETE, branchExists: true, held: true })), 'outside');
  assert.equal(laneState(plain, featureEntry('base', { tasks: COMPLETE, branchExists: true, keys: laneKeys('base') })), 'run');
  assert.equal(laneState(plain, featureEntry('base', { keys: { ...laneKeys('base'), merged: 'abc' }, branchExists: true })), 'run');

  for (const done of [mergedEntry('base'), featureEntry('base', { tasks: COMPLETE })]) {
    const action = assertAction(decideEpic(epicFacts({ features: [done, featureEntry('ux')] })), 'branch');
    assert.equal(action.feature, 'editor/ux');
  }

  const foreign = featureEntry('ux', { branchExists: true, keys: { base: 'main' } });
  const stopped = assertStop(decideEpic(epicFacts({ features: [featureEntry('base'), foreign] })), 'branch-foreign');
  assert.deepEqual(stopped.detail, ['feat/editor/ux holds no beast-mode-epic key, and epic/editor does not hold it.']);
  assert.equal(stopped.feature, 'editor/ux');
});

// ---------------------------------------------------------------------------
// The lanes of a side-by-side group (Phase 6, rule E14)
// ---------------------------------------------------------------------------

const SIDE_BY_SIDE = '## Build Order / Dependencies\n\n1. **base** and **ux** build side by side.\n';
const BUSY = { state: 'busy', detail: [] };
const DONE = { state: 'done', detail: [] };

/**
 * A lane that builds in its child worktree `/wt/<name>`, on the branch `orca/<name>` that Orca gave it.
 *
 * @param {string} name
 * @param {{ tasks?: string, record?: Record<string, any> | null, dirty?: string[], handoff?: boolean, merged?: boolean, subjects?: string[] }} [opts]
 * @returns {import('../lib/orca/decide.js').EpicFeatureFacts}
 */
function laneEntry(name, { tasks = OPEN, record = null, dirty = [], handoff = true, merged = false, subjects = [] } = {}) {
  return /** @type {any} */ ({
    ...featureEntry(name, { tasks, record, branchExists: true, held: merged, keys: { ...laneKeys(name), merged: merged ? 'fed4321cba987' : null }, subjects }),
    branch: `orca/${name}`,
    worktree: { path: `/wt/${name}`, head: `orca/${name}`, dirty, handoff, error: null },
  });
}

/**
 * @param {string} name
 * @param {Record<string, any>} extra
 * @returns {Record<string, any>}
 */
function laneRecord(name, extra) {
  return { ...newRecord(`editor/${name}`), ...extra };
}

/**
 * The facts of the epic `editor` whose one Build Order item names base and ux.
 *
 * @param {import('../lib/orca/decide.js').EpicFeatureFacts[]} features
 * @param {Record<string, any>} [workers]
 * @param {Record<string, any>} [patch]
 */
function laneFacts(features, workers = {}, patch = {}) {
  return epicFacts({
    epicDocs: { buildOrder: parseBuildOrder(SIDE_BY_SIDE, ['base', 'ux']) },
    features,
    workers,
    ...patch,
    git: { epicHandoff: true, ...patch.git },
  });
}

test('lanes: an item with two features starts both lanes in new child worktrees, waits on both tabs, and takes the reports in either order', () => {
  // A Build Order with one name per item runs in sequence, also with concurrent true (the default).
  assert.equal(parseOrcaConfig(JSON.stringify(CONFIG)).orchestration.concurrent, true);
  assert.equal(assertAction(decideEpic(epicFacts()), 'branch').branch, 'feat/editor/base');

  // 1. No lane has a branch: the first lane starts in a new child worktree from the epic branch.
  let action = assertAction(decideEpic(laneFacts([featureEntry('base'), featureEntry('ux')])), 'start');
  assert.deepEqual([action.feature, action.stage, action.placement, action.worktree], ['editor/base', 'phase', 'new-child', null]);
  assert.deepEqual(action.run, ['start', '--feature', 'editor/base', '--epic', 'editor', '--stage', 'phase', '--phase', '1']);
  assert.match(action.say, / It opens in a new worktree from epic\/editor\.$/);

  // 2. base works in its worktree, so ux starts in its own new child worktree.
  const baseBusy = laneEntry('base', { record: laneRecord('base', { active: activeEntry({ dispatchId: 'disp-b', placement: 'new-child' }) }) });
  action = assertAction(decideEpic(laneFacts([baseBusy, featureEntry('ux')], { 'disp-b': BUSY })), 'start');
  assert.deepEqual([action.feature, action.placement], ['editor/ux', 'new-child']);

  // 3. Both tabs work: one wait lists every tab, in group order, with its worktree.
  const uxBusy = laneEntry('ux', { record: laneRecord('ux', { active: activeEntry({ dispatchId: 'disp-u', placement: 'new-child' }) }) });
  action = assertAction(decideEpic(laneFacts([baseBusy, uxBusy], { 'disp-b': BUSY, 'disp-u': BUSY })), 'wait');
  assert.deepEqual(
    action.workers.map((worker) => [worker.feature, worker.dispatchId, worker.worktree]),
    [
      ['editor/base', 'disp-b', '/wt/base'],
      ['editor/ux', 'disp-u', '/wt/ux'],
    ]
  );
  assert.equal(action.say, '2 tabs work: the Phase 1 tab of editor/base on dsh and the Phase 1 tab of editor/ux on dsh. Orca wakes this tab when one reports.');
  // Fix 7: one backstop timer for the group, and it names the epic run, not a lane.
  assert.deepEqual(action.timer, { seconds: 600, statusEveryMinutes: 30, run: ['next', '--epic', 'editor', '--wake', 'timer'] });

  // 4. ux reports first: its close wins while base still works.
  const uxDone = laneEntry('ux', { tasks: COMPLETE, record: uxBusy.record.record });
  action = assertAction(decideEpic(laneFacts([baseBusy, uxDone], { 'disp-b': BUSY, 'disp-u': DONE })), 'close');
  assert.deepEqual(action.run, ['close', '--feature', 'editor/ux', '--epic', 'editor']);

  // 5. base reports first: its close wins while ux still works.
  const baseDone = laneEntry('base', { tasks: COMPLETE, record: baseBusy.record.record });
  action = assertAction(decideEpic(laneFacts([baseDone, uxBusy], { 'disp-b': DONE, 'disp-u': BUSY })), 'close');
  assert.deepEqual(action.run, ['close', '--feature', 'editor/base', '--epic', 'editor']);

  // 6. A later tab of a lane opens in its worktree, and the phase commit runs there.
  const uxClosed = laneEntry('ux', { tasks: COMPLETE, dirty: ['ux.txt'] });
  action = assertAction(decideEpic(laneFacts([baseBusy, uxClosed], { 'disp-b': BUSY })), 'commit');
  assert.deepEqual([action.feature, action.subject], ['editor/ux', 'feat: editor/ux phase 1']);
  const uxCommitted = laneEntry('ux', { tasks: COMPLETE, subjects: ['feat: editor/ux phase 1'] });
  action = assertAction(decideEpic(laneFacts([baseBusy, uxCommitted], { 'disp-b': BUSY })), 'start');
  assert.deepEqual([action.stage, action.placement, action.worktree], ['docs', 'worktree', '/wt/ux']);
  assert.match(action.say, / It opens in the worktree \/wt\/ux\.$/);

  // 7. With concurrent false, the item builds one feature at a time in the main workspace.
  const config = parseOrcaConfig(JSON.stringify({ version: 1, orchestration: { stages: { implement: 'dsh', review: false }, concurrent: false } }));
  action = assertAction(decideEpic(laneFacts([featureEntry('base'), featureEntry('ux')], {}, { config })), 'branch');
  assert.deepEqual([action.branch, action.feature], ['feat/editor/base', 'editor/base']);
});

test('lanes: one lane asks while the other merges, and the group order holds', () => {
  const uxReady = laneEntry('ux', { tasks: COMPLETE, record: laneRecord('ux', { done: { docs: true, steps: {} } }), subjects: ['feat: editor/ux phase 1'] });
  const baseGone = laneEntry('base', { record: laneRecord('base', { active: activeEntry({ dispatchId: 'disp-b' }) }) });

  // base comes first in the group, so its ask wins. The tab of ux keeps its state.
  let action = assertAction(decideEpic(laneFacts([baseGone, uxReady], { 'disp-b': { state: 'gone', detail: [] } })), 'ask');
  assert.deepEqual([action.reason, action.feature], ['worker-gone', 'editor/base']);
  assert.match(action.question, /^\[editor\/base phase 1\] /);

  // The user drops the tab, and base works again: ux merges.
  action = assertAction(decideEpic(laneFacts([baseGone, uxReady], { 'disp-b': BUSY })), 'merge');
  assert.deepEqual([action.feature, action.from, action.into], ['editor/ux', 'orca/ux', 'epic/editor']);
  assert.deepEqual(action.run, ['merge', '--epic', 'editor', '--feature', 'editor/ux']);
  assert.equal(action.say, 'Merge editor/ux into epic/editor. Then remove its worktree /wt/ux.');

  // The other order: a merge of base comes before an ask of ux.
  const baseReady = laneEntry('base', { tasks: COMPLETE, record: laneRecord('base', { done: { docs: true, steps: {} } }), subjects: ['feat: editor/base phase 1'] });
  const uxGone = laneEntry('ux', { record: laneRecord('ux', { active: activeEntry({ dispatchId: 'disp-u' }) }) });
  action = assertAction(decideEpic(laneFacts([baseReady, uxGone], { 'disp-u': { state: 'gone', detail: [] } })), 'merge');
  assert.equal(action.feature, 'editor/base');

  // A lane in a worktree merges from the epic branch: a main work tree off it switches first, and a dirty one stops.
  action = assertAction(decideEpic(laneFacts([baseReady, uxGone], { 'disp-u': BUSY }, { git: { head: 'feat/editor/old' }, features: [baseReady, uxGone, featureEntry('old')] })), 'branch');
  assert.deepEqual([action.branch, action.create], ['epic/editor', false]);
  const stopped = assertStop(decideEpic(laneFacts([baseReady, uxGone], { 'disp-u': BUSY }, { git: { dirty: ['notes.txt'] } })), 'dirty-tree');
  assert.equal(stopped.feature, 'editor/base');
});

test('lanes: a branch with no worktree stops worktree-missing, an uncommitted .beast-mode/ stops, and a lane keeps its worktree when its group drops to one', () => {
  const branchOnly = featureEntry('base', { branchExists: true, keys: laneKeys('base') });
  let stopped = assertStop(decideEpic(laneFacts([branchOnly, featureEntry('ux')])), 'worktree-missing');
  assert.equal(stopped.feature, 'editor/base');
  assert.match(stopped.fix, /"concurrent": false/);

  stopped = assertStop(decideEpic(laneFacts([featureEntry('base'), featureEntry('ux')], {}, { git: { epicHandoff: false } })), 'beast-mode-uncommitted');
  assert.deepEqual(stopped.detail, ['The tree of epic/editor holds no .beast-mode/phase-handoff.md, and every worker reads it first.']);
  stopped = assertStop(decideEpic(laneFacts([laneEntry('base', { handoff: false }), featureEntry('ux')])), 'beast-mode-uncommitted');
  assert.match(stopped.detail[0], /^The worktree \/wt\/base holds no /);

  // ux merged and base is left alone: base stays in its worktree, with no lane branch switch.
  const uxMerged = laneEntry('ux', { tasks: COMPLETE, merged: true });
  const baseBusy = laneEntry('base', { record: laneRecord('base', { active: activeEntry({ dispatchId: 'disp-b' }) }) });
  let action = assertAction(decideEpic(laneFacts([baseBusy, uxMerged], { 'disp-b': BUSY })), 'wait');
  assert.deepEqual(action.workers.map((worker) => worker.worktree), ['/wt/base']);
  const baseOpen = laneEntry('base');
  action = assertAction(decideEpic(laneFacts([baseOpen, uxMerged])), 'start');
  assert.deepEqual([action.placement, action.worktree], ['worktree', '/wt/base']);
});

test('lanes: --stop waits on every tab that works, and the epic summary lists the worktrees that stay', () => {
  const baseBusy = laneEntry('base', { record: laneRecord('base', { active: activeEntry({ dispatchId: 'disp-b' }) }) });
  const uxBusy = laneEntry('ux', { record: laneRecord('ux', { active: activeEntry({ dispatchId: 'disp-u' }) }) });
  let action = assertAction(decideEpic(laneFacts([baseBusy, uxBusy], { 'disp-b': BUSY, 'disp-u': BUSY }, { flags: { stop: true } })), 'wait');
  assert.deepEqual(action.workers.map((worker) => worker.dispatchId), ['disp-b', 'disp-u']);
  assert.match(action.say, /^The run stops after the Phase 1 tab of editor\/base and the Phase 1 tab of editor\/ux report\./);

  action = assertAction(decideEpic(laneFacts([baseBusy, uxBusy], { 'disp-b': DONE, 'disp-u': DONE }, { flags: { stop: true } })), 'done');
  assert.ok(action.show.includes('Open tab: the Phase 1 tab of editor/ux on dsh, dispatch disp-u. It stays open in Orca.'));
  assert.ok(action.show.includes('Worktrees:\n- /wt/base (editor/base, orca/base)\n- /wt/ux (editor/ux, orca/ux)'));

  // Both lanes merged. Orca removed the worktree of base, and the one of ux stays.
  const baseMerged = { ...laneEntry('base', { tasks: COMPLETE, merged: true }), worktree: null };
  const uxMerged = laneEntry('ux', { tasks: COMPLETE, merged: true });
  const end = laneFacts([baseMerged, uxMerged], {}, { record: { record: { ...newEpicRecord('editor'), done: { docs: true, steps: {} } }, note: null } });
  action = assertAction(decideEpic(end), 'done');
  assert.ok(action.show.includes('- editor/base: merged into epic/editor (fed4321)\n- editor/ux: merged into epic/editor (fed4321). Its worktree /wt/ux stays'));
  assert.ok(action.show.includes('Worktrees:\n- /wt/ux (editor/ux, orca/ux)'));
  assert.ok(action.show.includes('- Remove the worktree /wt/ux in Orca. The run did not remove it.'));
  const clean = laneFacts([baseMerged, { ...uxMerged, worktree: null }], {}, { record: end.record });
  assert.ok(assertAction(decideEpic(clean), 'done').show.includes('Worktrees: none left.'));
});

test('lanes: the lane facts and builders: a concurrent group, the keyed branch, the worktree list, the receipt worktree, and the Orca calls', () => {
  const orchestration = parseOrcaConfig(JSON.stringify(CONFIG)).orchestration;
  assert.equal(isConcurrentGroup(['base', 'ux'], orchestration), true);
  assert.equal(isConcurrentGroup(['base'], orchestration), false);
  assert.equal(isConcurrentGroup(['base', 'ux'], { ...orchestration, concurrent: false }), false);

  const list = parseWorktreeList(
    [
      'worktree /repo', 'HEAD aaa', 'branch refs/heads/epic/editor', '',
      'worktree /wt/ux', 'HEAD bbb', 'branch refs/heads/orca/ux', '',
      'worktree /wt/gone', 'HEAD ccc', 'branch refs/heads/orca/gone', 'prunable gitdir file points to non-existent location', '',
      'worktree /wt/detached', 'HEAD ddd', 'detached', '',
    ].join('\n')
  );
  assert.deepEqual(
    list.map((entry) => [entry.path, entry.branch, entry.prunable, entry.detached]),
    [
      ['/repo', 'epic/editor', false, false],
      ['/wt/ux', 'orca/ux', false, false],
      ['/wt/gone', 'orca/gone', true, false],
      ['/wt/detached', null, false, true],
    ]
  );
  assert.equal(laneWorktree(list, 'orca/ux', '/repo')?.path, '/wt/ux');
  assert.equal(laneWorktree(list, 'epic/editor', '/repo'), null, 'the workspace of the run never counts');
  assert.equal(laneWorktree(list, 'orca/gone', '/repo'), null, 'a worktree whose folder git lost never counts');

  const keys = parseRunKeys(
    [
      'branch.orca/ux-2.beast-mode-epic editor', 'branch.orca/ux-2.beast-mode-feature editor/ux',
      'branch.orca/ux.beast-mode-base epic/editor', 'branch.orca/ux.beast-mode-epic editor', 'branch.orca/ux.beast-mode-feature editor/ux',
      'branch.feat/editor/base.beast-mode-epic editor', 'branch.feat/editor/base.beast-mode-feature editor/base',
    ].join('\n')
  );
  assert.equal(laneBranchOf(keys, 'editor', 'editor/ux', list, '/repo'), 'orca/ux', 'the keyed branch with a worktree wins');
  assert.equal(laneBranchOf(keys, 'editor', 'editor/ux', [], '/repo'), 'orca/ux', 'else the first keyed branch in name order');
  assert.equal(laneBranchOf(keys, 'editor', 'editor/base', list, '/repo'), 'feat/editor/base');
  assert.equal(laneBranchOf(keys, 'editor', 'editor/none', list, '/repo'), null);

  assert.deepEqual(receiptWorktree({ workspace: 'repo-1::/wt/ux' }), { id: 'repo-1::/wt/ux', path: '/wt/ux' });
  assert.deepEqual(receiptWorktree({ effects: [{ kind: 'terminal', id: 't' }, { kind: 'worktree', id: 'r::/wt/b' }] }), { id: 'r::/wt/b', path: '/wt/b' });
  assert.equal(receiptWorktree({ workspace: 'repo-1' }), null, 'a repository id names no checkout');
  assert.equal(receiptWorktree(null), null);

  assert.deepEqual(orcaCalls.worktreeRemove(laneSelector('/wt/ux')).args, ['worktree', 'rm', '--worktree', 'path:/wt/ux', '--json']);
  assert.deepEqual(gitCalls.inTree('/wt/ux', gitCalls.branchName()).args, ['-C', '/wt/ux', 'rev-parse', '--abbrev-ref', 'HEAD']);
  const retry = orcaCalls.workerRetry({ taskId: 't', retryOf: 'd', agent: 'dsh', placement: { worktree: 'new-child', name: 'ux', baseBranch: 'epic/editor' } });
  assert.deepEqual(retry.args.slice(2, 12), ['--task', 't', '--retry-of', 'd', '--worktree', 'new-child', '--name', 'ux', '--base-branch', 'epic/editor']);
  assert.deepEqual(orcaCalls.workerStart({ specFile: '/s.md', agent: 'dsh' }).args.slice(4, 6), ['--worktree', 'current'], 'a plain start keeps the current workspace');
  assert.deepEqual(gitCalls.addAll().args, ['add', '-A', '--', '.', ':(exclude,glob).beast-mode/brief[s]/**']);
});

test('epic decide E12: the epic end switches to the epic branch, runs the epic docs tab, and ends with no commit', () => {
  const merged = () => [mergedEntry('base'), mergedEntry('ux')];
  let action = assertAction(decideEpic(epicFacts({ git: { head: 'feat/editor/ux' }, features: merged() })), 'branch');
  assert.deepEqual([action.branch, action.create, action.run], ['epic/editor', false, ['branch', '--epic', 'editor']]);

  action = assertAction(decideEpic(epicFacts({ features: merged() })), 'start');
  assert.deepEqual(action.run, ['start', '--epic', 'editor', '--stage', 'epic-docs']);
  assert.deepEqual([action.stage, action.feature, action.agent], ['epic-docs', null, 'dsh']);
  assert.match(action.say, /: \/update-epic editor, \/update-master editor\.$/);

  const tab = { record: { ...newEpicRecord('editor'), active: activeEntry({ stage: 'epic-docs', phase: null, dispatchId: 'disp-9' }) }, note: null };
  const withTab = (state, flags = {}) => epicFacts({ flags, features: merged(), record: tab, workers: { 'disp-9': { state, detail: [] } } });
  action = assertAction(decideEpic(withTab('busy')), 'wait');
  assert.deepEqual([action.workers[0].feature, action.workers[0].epic], [null, 'editor']);
  action = assertAction(decideEpic(withTab('idle', { wake: 'escalation' })), 'send');
  assert.deepEqual(action.run, ['send', '--epic', 'editor', '--reason', 'report']);
  action = assertAction(decideEpic(withTab('done')), 'close');
  assert.deepEqual([action.run, action.feature], [['close', '--epic', 'editor'], null]);
  action = assertAction(decideEpic(withTab('gone')), 'ask');
  assert.deepEqual(action.options[0].run, ['close', '--epic', 'editor', '--discard']);

  const failed = { record: { ...newEpicRecord('editor'), failedStart: { stage: 'epic-docs', phase: null, taskId: 'task-9', dispatchId: 'disp-9', count: 1 } }, note: null };
  action = assertAction(decideEpic(epicFacts({ features: merged(), record: failed })), 'ask');
  assert.deepEqual(action.options[0].run, ['start', '--epic', 'editor', '--stage', 'epic-docs', '--retry']);

  const done = { record: { ...newEpicRecord('editor'), done: { docs: true, steps: {} } }, note: null };
  action = assertAction(
    decideEpic(epicFacts({ features: merged(), record: done, git: { dirty: ['docs/overview.md'] }, epicDocs: { humanTests: ['Phase 1 demo: one'] } })),
    'done'
  );
  assert.match(action.show, /^Epic run summary - editor\n\nFeatures:\n- editor\/base: merged into epic\/editor \(abc1234\)\n- editor\/ux: merged/);
  assert.match(action.show, /\nUncommitted: 1 file on epic\/editor\.\n- docs\/overview\.md\n/);
  assert.match(action.show, /\nHuman tests: 1 open line in docs\/features\/editor\/human-testing\.md\.\n/);
  assert.match(action.show, /\n- Merge epic\/editor into main when you are ready\. The feature branches stay for you to delete\.$/);
});

test('epic decide E12: the summary lists the step results with overridden first, and the verify verdict of each lane phase (CR-7)', () => {
  const config = parseOrcaConfig(
    '{"version":1,"orchestration":{"stages":{"review":false},"steps":[{"after":"feature","command":"/audit","agent":"dsh"},{"after":"epic","command":"/ship-check","agent":"dsh"}]}}'
  );
  const base = mergedEntry('base');
  base.record = { record: { ...newRecord('editor/base'), done: { docs: true, steps: { 'feature:0': 'PASS' } }, verify: { 1: { round: 1 } } }, note: null };
  base.docs.phaseVerdicts = { 1: { verdict: 'PASS', evidence: '', demo: null } };
  const ux = mergedEntry('ux');
  ux.record = { record: { ...newRecord('editor/ux'), done: { docs: true, steps: { 'feature:0': 'overridden' } } }, note: null };
  const done = { record: { ...newEpicRecord('editor'), done: { docs: true, steps: { 'epic:1': 'PASS' } } }, note: null };
  const action = assertAction(decideEpic(epicFacts({ config, features: [base, ux], record: done })), 'done');
  const lines = action.show.split('\n');
  const at = lines.indexOf('Steps:');
  assert.deepEqual(lines.slice(at, at + 4), ['Steps:', '- editor/ux: /audit (the feature): overridden', '- editor/base: /audit (the feature): PASS', '- editor: /ship-check (the epic): PASS']);
  const verify = lines.indexOf('Verify:');
  assert.deepEqual(lines.slice(verify, verify + 2), ['Verify:', '- editor/base Phase 1: verified PASS after 1 fix round']);
});

test('epic decide E12: a lane step accepted at its round cap reads "overridden after <n> rounds", first in the Steps block (fix 11)', () => {
  const config = parseOrcaConfig(
    '{"version":1,"orchestration":{"stages":{"review":false},"steps":[{"after":"feature","command":"/audit","agent":"dsh"},{"after":"epic","command":"/ship-check","agent":"dsh"}]}}'
  );
  const base = mergedEntry('base');
  base.record = { record: { ...newRecord('editor/base'), done: { docs: true, steps: { 'feature:0': 'PASS' } } }, note: null };
  const ux = mergedEntry('ux');
  ux.record = { record: { ...newRecord('editor/ux'), done: { docs: true, steps: { 'feature:0': 'overridden-final' } }, stepRounds: { 'feature:0': 4 } }, note: null };
  const done = { record: { ...newEpicRecord('editor'), done: { docs: true, steps: { 'epic:1': 'PASS' } } }, note: null };
  const action = assertAction(decideEpic(epicFacts({ config, features: [base, ux], record: done })), 'done');
  const lines = action.show.split('\n');
  const at = lines.indexOf('Steps:');
  assert.deepEqual(lines.slice(at, at + 4), ['Steps:', '- editor/ux: /audit (the feature): overridden after 4 rounds', '- editor/base: /audit (the feature): PASS', '- editor: /ship-check (the epic): PASS']);
});

test('epic decide stops: a dirty switch, a failed switch, a failed feature-end commit, and a failed merge stop until a fresh call', () => {
  const fresh = { flags: { fresh: true }, orcaStatus: RUNNING_STATUS };
  assertStop(decideEpic(epicFacts({ git: { dirty: ['notes.txt'] } })), 'dirty-tree');
  assertStop(decideEpic(epicFacts({ git: { head: 'main', dirty: ['notes.txt'] } })), 'dirty-tree');

  const epicFailed = { record: { ...newEpicRecord('editor'), failedGit: { step: 'branch', code: 'git-failed', detail: ['git switch exited 128.'] } }, note: null };
  assertStop(decideEpic(epicFacts({ git: { head: 'main' }, record: epicFailed })), 'branch-failed');
  assertAction(decideEpic(epicFacts({ git: { head: 'main' }, record: epicFailed, ...fresh })), 'branch');

  const laneFailed = { ...newRecord('editor/base'), failedGit: { step: 'branch', code: 'git-failed', detail: ['git switch exited 128.'] } };
  assertStop(decideEpic(epicFacts({ features: [featureEntry('base', { record: laneFailed }), featureEntry('ux')] })), 'branch-failed');

  const onLane = (record, extra = {}) =>
    epicFacts({
      git: { head: 'feat/editor/base', dirty: ['a.txt'] },
      features: [
        featureEntry('base', { branchExists: true, keys: laneKeys('base'), tasks: COMPLETE, record, subjects: ['feat: editor/base phase 1'] }),
        featureEntry('ux'),
      ],
      ...extra,
    });
  const commitFailed = {
    ...newRecord('editor/base'),
    done: { docs: true, steps: {} },
    failedGit: { step: 'commit', point: 'feature', code: 'commit-failed', detail: ['the pre-commit hook said no'] },
  };
  assertStop(decideEpic(onLane(commitFailed)), 'commit-failed');
  assertAction(decideEpic(onLane(commitFailed, fresh)), 'commit');

  const onEpic = (record, extra = {}) =>
    epicFacts({ features: [featureEntry('base', { branchExists: true, keys: laneKeys('base'), tasks: COMPLETE, record }), featureEntry('ux')], ...extra });
  const conflict = {
    ...newRecord('editor/base'),
    done: { docs: true, steps: {} },
    failedGit: { step: 'merge', point: 'merge', code: 'merge-conflict', detail: ['Conflict: shared.txt', 'git merge exited 1.'] },
  };
  const stopped = assertStop(decideEpic(onEpic(conflict)), 'merge-conflict');
  assert.equal(stopped.detail[0], 'Conflict: shared.txt');
  assert.match(stopped.fix, /Resolve the conflict between feat\/editor\/base and epic\/editor by hand/);
  assertAction(decideEpic(onEpic(conflict, fresh)), 'branch');
  assertStop(decideEpic(onEpic({ ...conflict, failedGit: { ...conflict.failedGit, code: 'merge-failed' } })), 'merge-failed');

  // A failed human test commit after the merge stops, and a fresh call runs merge again.
  const tests = { ...newRecord('editor/base'), failedGit: { step: 'merge', point: 'human-tests', code: 'commit-failed', detail: ['hook'] } };
  const merged = featureEntry('base', { tasks: COMPLETE, branchExists: true, held: true, keys: { ...laneKeys('base'), merged: 'abc' }, record: tests });
  assertStop(decideEpic(epicFacts({ features: [merged, featureEntry('ux')] })), 'commit-failed');
  const again = assertAction(decideEpic(epicFacts({ features: [merged, featureEntry('ux')], ...fresh })), 'merge');
  assert.deepEqual(again.run, ['merge', '--epic', 'editor', '--feature', 'editor/base']);
});

test('epic decide E11: a fresh call with changes on the lane branch asks, and --stop waits for a busy tab or ends the run', () => {
  const lane = (record, extra = {}) =>
    epicFacts({
      git: { head: 'feat/editor/base', dirty: ['notes.txt'] },
      features: [featureEntry('base', { branchExists: true, keys: laneKeys('base'), record }), featureEntry('ux')],
      ...extra,
    });
  const asked = assertAction(decideEpic(lane(null, { flags: { fresh: true }, orcaStatus: RUNNING_STATUS })), 'ask');
  assert.deepEqual([asked.reason, asked.feature, asked.recommended], ['dirty-start', 'editor/base', 'stop']);
  assert.deepEqual(asked.options.map((option) => [option.key, option.run]), [
    ['stop', null],
    ['go-on', ['next', '--epic', 'editor', '--fresh', '--accept-dirty']],
  ]);
  assert.match(asked.question, /^\[editor\/base\] /);
  assertAction(decideEpic(lane(null, { flags: { fresh: true, acceptDirty: true }, orcaStatus: RUNNING_STATUS })), 'start');

  const busy = { ...newRecord('editor/base'), active: activeEntry() };
  const waited = assertAction(decideEpic(lane(busy, { flags: { stop: true }, workers: { 'disp-1': { state: 'busy', detail: [] } } })), 'wait');
  assert.match(waited.say, /^The run stops after the Phase 1 tab of editor\/base reports\./);

  const ended = assertAction(decideEpic(epicFacts({ flags: { stop: true }, git: { head: 'main' } })), 'done');
  assert.match(ended.show, /^Run stopped on request - editor\n\nFeatures:\n- editor\/base: not started, 0 of 2 tasks done\n/);
  assert.match(ended.show, /\n- Run \/orca-epic editor to go on from here\.$/);
});

test('epic decide E6a: an unreadable epic record or lane record stops record-unreadable, and a merged lane only adds a note', () => {
  const epicNote = 'The epic record does not parse.';
  const laneNote = 'The run record of editor/base does not parse.';
  const unread = (entry) => ({ ...entry, record: { record: null, note: laneNote } });

  const stopped = assertStop(decideEpic(epicFacts({ record: { record: null, note: epicNote } })), 'record-unreadable');
  assert.deepEqual(stopped.detail, [epicNote]);
  assert.ok(!stopped.say.includes('Note:'), 'the note is the detail, not a second note');
  assert.match(stopped.fix, /^Check Orca for an open tab of editor, then move the file away and run \/orca-epic editor again\./);
  assert.equal(stopped.feature, undefined);

  const lane = assertStop(decideEpic(epicFacts({ features: [unread(featureEntry('base')), featureEntry('ux')] })), 'record-unreadable');
  assert.deepEqual([lane.detail, lane.feature], [[laneNote], 'editor/base']);

  const both = assertStop(
    decideEpic(epicFacts({ record: { record: null, note: epicNote }, features: [unread(featureEntry('base')), featureEntry('ux')] })),
    'record-unreadable'
  );
  assert.deepEqual(both.detail, [epicNote, laneNote]);
  assert.match(both.fix, /^Check Orca for an open tab of editor and editor\/base, /);

  // A merged lane starts no tab, so its record only adds a note.
  const merged = decideEpic(epicFacts({ features: [unread(mergedEntry('base')), featureEntry('ux')] }));
  assert.notEqual(merged.reason, 'record-unreadable');
  assert.match(merged.say, / Note: The run record of editor\/base does not parse\.$/);

  // An earlier stop keeps the note in say.
  const early = assertStop(decideEpic(epicFacts({ terminalHandle: null, record: { record: null, note: epicNote } })), 'not-orca-tab');
  assert.match(early.say, / Note: The epic record does not parse\.$/);
});

test('epic steps: an epic record of another schema stops next, and start and close refuse it with no Orca call (CR-1)', { skip: NO_GIT }, () => {
  const root = makeEpicProject();
  try {
    const file = path.join(root, '.beast-mode', 'briefs', 'editor', 'orca-epic-run.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const body = `${JSON.stringify({ schema: 2, epic: 'editor', active: { stage: 'epic-docs', dispatchId: 'disp-7' } })}\n`;
    fs.writeFileSync(file, body);
    // The runner fails on any Orca call, so each answer below ran with none.
    const fake = fakeRunner({});

    const next = assertStop(orcaStep(root, ['next', '--epic', 'editor', '--fresh'], fake.runner), 'record-unreadable');
    assert.deepEqual(next.detail, ['The epic record at ".beast-mode/briefs/editor/orca-epic-run.json" does not parse as a record of schema 1.']);
    for (const args of [
      ['start', '--epic', 'editor', '--stage', 'epic-docs'],
      ['close', '--epic', 'editor', '--discard'],
    ]) {
      const json = orcaStep(root, args, fake.runner);
      assert.deepEqual([json.ok, json.code, json.epic], [false, 'record-unreadable', 'editor'], args.join(' '));
    }
    assert.equal(fs.readFileSync(file, 'utf8'), body, 'no step replaces a record that it cannot read');
  } finally {
    removeFixture(root);
  }
});

test('close --epic --discard stops an epic tab that Orca did not release as not settled (fix 10)', () => {
  const root = makeEpicProject();
  try {
    writeEpicRecord(root, 'editor', { ...newEpicRecord('editor'), active: activeEntry({ stage: 'epic-docs', phase: null, dispatchId: 'disp-9' }) });
    const fake = fakeRunner({
      'worker-release': refused('dispatch_inactive', 'Dispatch disp-9 is ready; only a settled worker can release.'),
      'worker-stop': envelope({ dispatchId: 'disp-9', state: 'stopped', processAction: 'closed_agent_terminal' }),
    });
    const json = orcaStep(root, ['close', '--epic', 'editor', '--discard'], fake.runner);
    assert.deepEqual(fake.orca(), [
      ['orchestration', 'worker-release', '--dispatch', 'disp-9', '--json'],
      ['orchestration', 'worker-stop', '--dispatch', 'disp-9', '--json'],
    ]);
    assert.deepEqual([json.ok, json.docsDone], [true, false]);
    assert.equal(json.say, 'Closed the epic-docs tab of editor. Orca did not release disp-9, so the close stopped it, and the record is clear.');
    assert.equal(readEpicRecord(root, 'editor').record.active, null);
  } finally {
    removeFixture(root);
  }
});

// ---------------------------------------------------------------------------
// The specs and the human test writer
// ---------------------------------------------------------------------------

test('spec: the epic form of the phase spec writes no human-testing.md, the lane docs run /update-feature only, and the epic docs run /update-epic, then /update-master', () => {
  const phase = phaseSpec({ feature: 'editor/base', epic: 'editor', phase: { number: 1, name: 'Slice' }, lane: true });
  assert.ok(phase.includes('   Write no line to `human-testing.md`. The coordinator copies the open human tests of `context.md`\n'));
  assert.ok(!phaseSpec({ feature: 'editor/base', epic: 'editor', phase: { number: 1, name: 'Slice' } }).includes('human-testing.md'));

  const docs = docsSpec({ feature: 'editor/base', epic: 'editor', lane: true });
  assert.ok(docs.includes('\n1. Run the `/update-feature editor/base` command.\nChange no source file.\n'));
  assert.ok(!docs.includes('/update-epic') && !docs.includes('/update-master'));

  const epicDocs = epicDocsSpec({ epic: 'editor' });
  assert.ok(epicDocs.startsWith('# Beast Mode orca worker - editor, Epic docs\n'));
  assert.ok(epicDocs.includes('\n1. Run the `/update-epic editor` command.\n2. Run the `/update-master editor` command.\n'));
  assert.ok(epicDocs.includes('- Make no git write. No commit, branch, merge, stash, reset, or push. The coordinator owns git.'));
  assert.ok(epicDocs.includes('Start the question with `[editor epic-docs]`, then end your turn.'));
  for (const spec of [phase, docs, epicDocs]) {
    assert.doesNotMatch(spec, /subagent/i);
    assert.doesNotMatch(spec, /\.claude\/|AskUserQuestion|SendMessage|WebSearch|TodoWrite/);
    assert.ok(spec.replace(/\s+/g, ' ').includes('Every agent prompt that you write holds the inbox sentence of section 12 rule 4.'));
  }
});

test('human tests: the template fills the epic and drops its placeholder section, and the append adds each new line once', () => {
  const template = fs.readFileSync(path.join(PLUGIN_ROOT, 'templates', 'dev-docs', 'human-testing.md'), 'utf8');
  const fresh = humanTestingFromTemplate(template, 'editor', '2026-11-18 07:10');
  assert.match(fresh, /^# editor — Human Testing\n/);
  assert.ok(fresh.includes('**Epic:** editor\n**Last Updated:** 2026-11-18 07:10\n'));
  assert.ok(!fresh.includes('[feature]') && !fresh.includes('[item]'));
  assert.equal(humanTestingFromTemplate(null, 'editor', 'now'), '# editor - Human Testing\n');

  const once = appendHumanTests(fresh, 'base', ['Phase 1 demo: one', 'Phase 1 demo: one']);
  assert.deepEqual(once.added, ['Phase 1 demo: one']);
  assert.ok(once.text.endsWith('\n## base\n\n- [ ] Phase 1 demo: one\n'));

  const checked = once.text.replace('- [ ] Phase 1 demo: one', '- [x] Phase 1 demo: one');
  const again = appendHumanTests(checked, 'base', ['Phase 1 demo: one', 'Phase 2 demo: two']);
  assert.deepEqual(again.added, ['Phase 2 demo: two']);
  assert.ok(again.text.includes('- [x] Phase 1 demo: one\n- [ ] Phase 2 demo: two\n'));

  const other = appendHumanTests(again.text, 'ux', ['Phase 1 demo: ux']);
  assert.ok(other.text.endsWith('- [ ] Phase 2 demo: two\n\n## ux\n\n- [ ] Phase 1 demo: ux\n'));
  const middle = appendHumanTests(other.text, 'base', ['Phase 3 demo: three']);
  assert.ok(middle.text.includes('- [ ] Phase 2 demo: two\n- [ ] Phase 3 demo: three\n\n## ux\n'));
  const none = appendHumanTests(middle.text, 'base', ['Phase 3 demo: three']);
  assert.deepEqual([none.added, none.text], [[], middle.text]);
});

test('cli: next takes --feature or --epic, not both, and merge needs --epic and --feature', () => {
  const ctx = { stdout: /** @type {any} */ ({ write: () => true }), cwd: os.tmpdir(), pluginRoot: PLUGIN_ROOT, env: {} };
  assert.throws(() => runOrca(['next', '--epic', 'editor', '--feature', 'editor/base'], ctx), UsageError);
  assert.throws(() => runOrca(['merge', '--epic', 'editor'], ctx), UsageError);
  assert.throws(() => runOrca(['merge', '--feature', 'editor/base'], ctx), UsageError);
  assert.throws(() => runOrca(['commit', '--epic', 'editor', '--point', 'feature'], ctx), UsageError);
});

// ---------------------------------------------------------------------------
// Temporary git repositories
// ---------------------------------------------------------------------------

/**
 * @returns {Record<string, string | undefined>}
 */
function testEnv() {
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CEILING_DIRECTORIES: os.tmpdir(),
    ORCA_TERMINAL_HANDLE: 'term-test',
    ORCA_CLI_COMMAND: FAKE_ORCA,
    WSL_DISTRO_NAME: '', // host-independent: a WSL test host must not translate spec paths (issue #10)
  };
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_COMMON_DIR']) delete env[key];
  return env;
}

/**
 * @param {string} root
 * @param {string[]} args
 * @returns {string}
 */
function gitIn(root, args) {
  const result = spawnSync('git', args, { cwd: root, env: testEnv(), encoding: 'utf8' });
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout;
}

/**
 * @param {string} root
 * @returns {string}
 */
function headOf(root) {
  return gitIn(root, ['symbolic-ref', '--short', 'HEAD']).trim();
}

/**
 * A temporary project with the epic `editor`: two features with a plan and
 * open tasks, a Build Order, the human-testing template of the project, both
 * harnesses, an orca.json with the review off, and a git repository on main
 * with one commit. The user name and email live in the repository config.
 *
 * @returns {string}
 */
function makeEpicProject() {
  const root = createTempProjectRoot();
  for (const id of ['claude', 'dsh']) {
    const dir = path.join(root, ...adapters[id].harnessRoot.split('/'));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '.beast-mode-manifest.json'), '{}\n');
  }
  fs.mkdirSync(path.join(root, '.beast-mode', 'templates'), { recursive: true });
  fs.writeFileSync(path.join(root, '.beast-mode', 'orca.json'), `${JSON.stringify(CONFIG, null, 2)}\n`);
  fs.copyFileSync(path.join(PLUGIN_ROOT, 'templates', 'dev-docs', 'human-testing.md'), path.join(root, '.beast-mode', 'templates', 'human-testing.md'));
  const epic = path.join(root, 'docs', 'features', 'editor');
  fs.mkdirSync(epic, { recursive: true });
  fs.writeFileSync(path.join(epic, 'epic-overview.md'), BUILD_ORDER);
  for (const name of ['base', 'ux']) {
    fs.mkdirSync(path.join(epic, name));
    fs.writeFileSync(path.join(epic, name, 'implementation.md'), `# ${name} - Implementation Plan\n`);
    fs.writeFileSync(path.join(epic, name, 'tasks.md'), OPEN);
    fs.writeFileSync(path.join(epic, name, 'context.md'), `# ${name} - Context\n\n## Needs Human Verification\n\n`);
  }
  gitIn(root, ['init', '-q']);
  gitIn(root, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
  gitIn(root, ['config', 'user.name', 'Orca Test']);
  gitIn(root, ['config', 'user.email', 'orca-test@example.invalid']);
  gitIn(root, ['config', 'commit.gpgsign', 'false']);
  gitIn(root, ['add', '-A']);
  gitIn(root, ['commit', '-q', '-m', 'init']);
  return root;
}

/**
 * @param {unknown} result
 * @returns {import('../lib/orca/exec.js').RunResult}
 */
function envelope(result) {
  return { status: 0, signal: null, stdout: `${JSON.stringify({ ok: true, result })}\n`, stderr: '', error: null };
}

/**
 * A runner that answers each Orca call from `answers`, keyed by the verb,
 * and runs git for real. Every call is recorded.
 *
 * @param {Record<string, import('../lib/orca/exec.js').RunResult>} answers
 */
function fakeRunner(answers) {
  /** @type {{ command: string, args: string[] }[]} */
  const calls = [];
  /** @type {import('../lib/orca/exec.js').Runner} */
  const runner = (command, args, options) => {
    calls.push({ command, args: [...args] });
    if (command === 'git') return defaultRunner(command, args, options);
    assert.equal(command, FAKE_ORCA, `the runner got the unexpected command ${command}`);
    const verb = args[0] === 'orchestration' ? args[1] : args[0];
    assert.ok(answers[verb], `no fake Orca answer for: ${args.join(' ')}`);
    return answers[verb];
  };
  return {
    runner,
    answers,
    git: () => calls.filter((call) => call.command === 'git').map((call) => call.args),
    orca: () => calls.filter((call) => call.command !== 'git').map((call) => call.args),
  };
}

/**
 * Run one step and parse its one JSON object.
 *
 * @param {string} root
 * @param {string[]} args
 * @param {import('../lib/orca/exec.js').Runner} runner
 * @returns {Record<string, any>}
 */
function orcaStep(root, args, runner) {
  let out = '';
  const stdout = /** @type {any} */ ({ write: (chunk) => ((out += chunk), true) });
  const code = runOrca([...args, '--project', root], {
    stdout,
    cwd: root,
    pluginRoot: PLUGIN_ROOT,
    env: testEnv(),
    runner,
    sleep: () => {},
    platform: 'linux',
    execPath: NODE,
    now: () => NOW,
  });
  assert.equal(code, 0, out);
  const lines = out.split('\n').filter((line) => line.length > 0);
  assert.equal(lines.length, 1, `one JSON object per call, got: ${out}`);
  return JSON.parse(lines[0]);
}

/**
 * @param {string} root
 * @param {string[]} args
 * @returns {string}
 */
function lineOf(root, args) {
  return runLine({ node: NODE, bin: BIN, project: root }, args);
}

const RUNNING = envelope({ app: { running: true, pid: 1 }, runtime: { state: 'ready', reachable: true }, graph: {} });
const RELEASED = envelope({ state: 'already_released', processAction: 'none' });

test('git: an epic lane builds on its own branch, merges --no-ff, records the merged key, commits the human tests, and leaves main where it was', { skip: NO_GIT }, () => {
  const root = makeEpicProject();
  try {
    const mainBefore = gitIn(root, ['rev-parse', 'main']).trim();
    const fake = fakeRunner({
      status: RUNNING,
      'worker-start': envelope({ runId: 'run-1', taskId: 'task-1', dispatchId: 'disp-1', state: 'ready' }),
      'worker-show': envelope({ dispatchId: 'disp-1', state: 'ready', stage: 'turn', liveness: 'live', activity: 'working' }),
      'worker-release': RELEASED,
    });
    const step = (args) => orcaStep(root, args, fake.runner);
    const lane = ['--feature', 'editor/base', '--epic', 'editor'];
    const featureDir = path.join(root, 'docs', 'features', 'editor', 'base');

    // 1. A fresh call on main makes the epic branch from main.
    let json = step(['next', '--epic', 'editor', '--fresh']);
    assert.deepEqual([json.action, json.run], ['branch', lineOf(root, ['branch', '--epic', 'editor'])]);
    json = step(['branch', '--epic', 'editor']);
    assert.deepEqual([json.ok, json.created, json.base, json.branch], [true, true, 'main', 'epic/editor']);
    assert.equal(headOf(root), 'epic/editor');
    assert.equal(gitIn(root, ['config', '--get', 'branch.epic/editor.beast-mode-base']).trim(), 'main');

    // 2. The lane branch of base starts from epic/editor, with its three keys.
    json = step(['next', '--epic', 'editor']);
    assert.equal(json.run, lineOf(root, ['branch', '--epic', 'editor', '--feature', 'editor/base']));
    json = step(['branch', '--epic', 'editor', '--feature', 'editor/base']);
    assert.deepEqual([json.ok, json.created, json.base], [true, true, 'epic/editor']);
    assert.equal(headOf(root), 'feat/editor/base');
    for (const [key, value] of [
      ['base', 'epic/editor'],
      ['epic', 'editor'],
      ['feature', 'editor/base'],
    ]) {
      assert.equal(gitIn(root, ['config', '--get', `branch.feat/editor/base.beast-mode-${key}`]).trim(), value);
    }

    // 3. Phase 1 starts with the epic form of the phase spec.
    json = step(['next', '--epic', 'editor']);
    assert.equal(json.run, lineOf(root, ['start', ...lane, '--stage', 'phase', '--phase', '1']));
    assert.equal(step(['start', ...lane, '--stage', 'phase', '--phase', '1']).ok, true);
    const phaseFile = path.join(root, '.beast-mode', 'briefs', 'editor', 'base', 'orca-phase-1.md');
    assert.ok(fs.readFileSync(phaseFile, 'utf8').includes('Write no line to `human-testing.md`.'));

    // 3b. CR-9: a stale commit or merge line refuses while the Phase 1 tab works, and it makes no git write and no release.
    const gitCalls = fake.git().length;
    const orcaCalls = fake.orca().length;
    for (const args of [
      ['commit', ...lane, '--point', 'phase', '--phase', '1'],
      ['commit', ...lane, '--point', 'feature'],
      ['merge', '--epic', 'editor', '--feature', 'editor/base'],
    ]) {
      const refused = step(args);
      assert.deepEqual([refused.step, refused.ok, refused.code], [args[0], false, 'tab-active'], args.join(' '));
    }
    assert.equal(headOf(root), 'feat/editor/base', 'a refused merge never switches the branch');
    assert.deepEqual(fake.git().slice(gitCalls).filter((args) => ['add', 'commit', 'merge', 'switch'].includes(args[0])), []);
    assert.equal(fake.orca().length, orcaCalls, 'a refused step makes no Orca call, so no release');

    // 4. The tab works and reports. Its demo line waits in context.md.
    fs.writeFileSync(path.join(root, 'base.txt'), 'base\n');
    fs.writeFileSync(path.join(featureDir, 'tasks.md'), COMPLETE);
    fs.appendFileSync(path.join(featureDir, 'context.md'), '- [ ] Phase 1 demo: base.txt holds one line\n');
    fake.answers['worker-show'] = envelope({ dispatchId: 'disp-1', state: 'succeeded', stage: 'settled' });
    json = step(['next', '--epic', 'editor', '--wake', 'worker_done', '--dispatch', 'disp-1']);
    assert.deepEqual([json.action, json.run], ['close', lineOf(root, ['close', ...lane])]);
    assert.equal(step(['close', ...lane]).ok, true);

    // 5. The phase commit lands on the lane branch.
    json = step(['next', '--epic', 'editor']);
    assert.deepEqual([json.action, json.subject], ['commit', 'feat: editor/base phase 1']);
    assert.equal(step(['commit', ...lane, '--point', 'phase', '--phase', '1']).ok, true);

    // 6. The lane docs tab runs /update-feature only.
    json = step(['next', '--epic', 'editor']);
    assert.deepEqual([json.action, json.stage], ['start', 'docs']);
    fake.answers['worker-start'] = envelope({ runId: 'run-2', taskId: 'task-2', dispatchId: 'disp-2', state: 'ready' });
    assert.equal(step(['start', ...lane, '--stage', 'docs']).ok, true);
    const docsFile = path.join(root, '.beast-mode', 'briefs', 'editor', 'base', 'orca-docs.md');
    assert.ok(fs.readFileSync(docsFile, 'utf8').includes('\n1. Run the `/update-feature editor/base` command.\nChange no source file.\n'));
    fs.appendFileSync(path.join(featureDir, 'implementation.md'), '\nThe docs tab updated this file.\n');
    fake.answers['worker-show'] = envelope({ dispatchId: 'disp-2', state: 'succeeded', stage: 'settled' });
    assert.equal(step(['next', '--epic', 'editor']).action, 'close');
    assert.equal(step(['close', ...lane]).docsDone, true);

    // 7. The feature-end commit takes the docs changes.
    json = step(['next', '--epic', 'editor']);
    assert.deepEqual([json.action, json.point, json.subject], ['commit', 'feature', 'feat: editor/base']);
    json = step(['commit', ...lane, '--point', 'feature']);
    assert.deepEqual([json.ok, json.subject], [true, 'feat: editor/base']);
    assert.equal(gitIn(root, ['log', '-1', '--format=%s']).trim(), 'feat: editor/base');

    // 8. The merge: --no-ff into epic/editor, the merged key, and the human test commit.
    json = step(['next', '--epic', 'editor']);
    assert.deepEqual([json.action, json.run], ['merge', lineOf(root, ['merge', '--epic', 'editor', '--feature', 'editor/base'])]);
    json = step(['merge', '--epic', 'editor', '--feature', 'editor/base']);
    assert.deepEqual([json.ok, json.merged, json.humanTests, json.created], [true, true, ['Phase 1 demo: base.txt holds one line'], true]);
    assert.ok(
      fake.git().some((args) => JSON.stringify(args) === JSON.stringify(['merge', '--no-ff', '--no-edit', '-m', 'Merge editor/base into epic/editor', 'feat/editor/base']))
    );
    assert.equal(headOf(root), 'epic/editor');
    assert.equal(gitIn(root, ['rev-list', '--parents', '-n', '1', json.commit]).trim().split(' ').length, 3, 'the merge commit has two parents');
    assert.equal(gitIn(root, ['log', '-1', '--format=%s', json.commit]).trim(), 'Merge editor/base into epic/editor');
    assert.equal(gitIn(root, ['config', '--get', 'branch.feat/editor/base.beast-mode-merged']).trim(), json.commit);
    assert.equal(gitIn(root, ['log', '-1', '--format=%s']).trim(), 'docs: editor/base human testing');
    assert.equal(gitIn(root, ['rev-parse', 'HEAD']).trim(), json.docsCommit);
    const humanTesting = fs.readFileSync(path.join(root, 'docs', 'features', 'editor', 'human-testing.md'), 'utf8');
    assert.match(humanTesting, /^# editor — Human Testing\n/);
    assert.ok(humanTesting.endsWith('\n## base\n\n- [ ] Phase 1 demo: base.txt holds one line\n'));
    assert.equal(gitIn(root, ['status', '--porcelain', '--', 'docs']).trim(), '');

    // 9. A second merge call changes nothing.
    json = step(['merge', '--epic', 'editor', '--feature', 'editor/base']);
    assert.deepEqual([json.ok, json.merged, json.docsCommit, json.humanTests], [true, false, null, []]);

    // 10. The run moves on to ux: its lane branch starts from the epic branch.
    json = step(['next', '--epic', 'editor']);
    assert.deepEqual([json.action, json.feature, json.base, json.create], ['branch', 'editor/ux', 'epic/editor', true]);

    // 11. main never moved, and no destructive verb ran.
    assert.equal(gitIn(root, ['rev-parse', 'main']).trim(), mainBefore);
    // CR-8: the same never list as the static test, matched on every element (a `-C <dir>` call puts the verb later).
    const never = ['push', 'pull', 'fetch', 'rebase', 'reset', 'stash', 'clean', 'tag', '-D', '-d', '--delete', '--delete-branch'];
    assert.ok(!fake.git().some((args) => args.some((arg) => never.includes(arg))), 'no destructive git verb ran');
    assert.ok(!fake.orca().some((args) => args.some((arg) => never.includes(arg))), 'no Orca call carries a delete flag');
  } finally {
    removeFixture(root);
  }
});

test('git: merge refuses every branch but the lane and epic/<epic>, and the default branch always; a conflict aborts and stops merge-conflict', { skip: NO_GIT }, () => {
  const root = makeEpicProject();
  try {
    const mainBefore = gitIn(root, ['rev-parse', 'main']).trim();
    const fake = fakeRunner({ status: RUNNING, 'worker-release': RELEASED });
    const step = (args) => orcaStep(root, args, fake.runner);
    const merge = ['merge', '--epic', 'editor', '--feature', 'editor/base'];

    let json = step(merge);
    assert.deepEqual([json.ok, json.code], [false, 'default-branch']);

    gitIn(root, ['switch', '-q', '-c', 'epic/editor', 'main']);
    gitIn(root, ['switch', '-q', '-c', 'feat/editor/base', 'epic/editor']);
    gitIn(root, ['config', 'branch.feat/editor/base.beast-mode-epic', 'editor']);
    fs.writeFileSync(path.join(root, 'shared.txt'), 'the lane\n');
    gitIn(root, ['add', '-A']);
    gitIn(root, ['commit', '-q', '-m', 'lane change']);
    gitIn(root, ['switch', '-q', 'epic/editor']);
    fs.writeFileSync(path.join(root, 'shared.txt'), 'the epic\n');
    gitIn(root, ['add', '-A']);
    gitIn(root, ['commit', '-q', '-m', 'epic change']);
    const epicBefore = gitIn(root, ['rev-parse', 'epic/editor']).trim();

    gitIn(root, ['switch', '-q', '-c', 'other', 'main']);
    json = step(merge);
    assert.deepEqual([json.ok, json.code], [false, 'not-run-branch']);
    json = step(['merge', '--epic', 'editor', '--feature', 'other/base']);
    assert.deepEqual([json.ok, json.code], [false, 'not-in-epic']);

    gitIn(root, ['switch', '-q', 'feat/editor/base']);
    json = step(merge);
    assert.deepEqual([json.ok, json.code, json.files], [false, 'merge-conflict', ['shared.txt']]);
    assert.ok(fake.git().some((args) => JSON.stringify(args) === JSON.stringify(['merge', '--abort'])));
    assert.equal(headOf(root), 'epic/editor');
    assert.equal(gitIn(root, ['rev-parse', 'epic/editor']).trim(), epicBefore, 'the aborted merge left no commit');
    assert.equal(gitIn(root, ['status', '--porcelain', '--untracked-files=no']).trim(), '', 'the abort left a clean tree');
    assert.equal(readRecord(root, 'editor/base').record.failedGit.code, 'merge-conflict');

    json = step(['next', '--epic', 'editor']);
    assert.deepEqual([json.action, json.reason], ['stop', 'merge-conflict']);
    assert.ok(json.detail.includes('Conflict: shared.txt'));
    assert.equal(gitIn(root, ['rev-parse', 'main']).trim(), mainBefore);
  } finally {
    removeFixture(root);
  }
});

test('git: the epic docs tab starts on epic/<epic> with its spec, takes a send, and closes with the docs mark', { skip: NO_GIT }, () => {
  const root = makeEpicProject();
  try {
    const fake = fakeRunner({
      'worker-start': envelope({ runId: 'run-9', taskId: 'task-9', dispatchId: 'disp-9', state: 'ready' }),
      // The submit loop of the dsh tab reads the tab one time, and the turn runs (fix 1).
      'worker-show': envelope({ dispatchId: 'disp-9', state: 'ready', stage: 'input_accepted', liveness: 'live', activity: 'working' }),
      'worker-release': RELEASED,
      send: envelope({ messageId: 'msg-1' }),
    });
    const step = (args) => orcaStep(root, args, fake.runner);
    const start = ['start', '--epic', 'editor', '--stage', 'epic-docs'];

    assert.deepEqual([step(start).ok, step(start).code], [false, 'not-run-branch']);
    assert.equal(step(['start', '--epic', 'editor', '--stage', 'phase', '--phase', '1']).code, 'stage-not-supported');
    gitIn(root, ['switch', '-q', '-c', 'epic/editor', 'main']);

    let json = step(start);
    assert.deepEqual([json.ok, json.dispatchId, json.agent, json.feature, json.epic], [true, 'disp-9', 'dsh', null, 'editor']);
    const spec = fs.readFileSync(path.join(root, '.beast-mode', 'briefs', 'editor', 'orca-epic-docs.md'), 'utf8');
    assert.ok(spec.startsWith('# Beast Mode orca worker - editor, Epic docs\n'));
    assert.equal(readEpicRecord(root, 'editor').record.active.dispatchId, 'disp-9');
    // The Task title of the epic tab leads with the epic (fix 5).
    const startArgs = fake.orca().find((args) => args[1] === 'worker-start');
    assert.equal(startArgs?.[startArgs.indexOf('--task-title') + 1], 'editor: epic docs');
    assert.equal(step(start).code, 'tab-active');

    assert.equal(step(['send', '--epic', 'editor', '--reason', 'open-tasks']).code, 'nothing-open');
    json = step(['send', '--epic', 'editor', '--reason', 'report']);
    assert.deepEqual([json.ok, json.subject], [true, 'Report: the epic-docs stage of editor']);
    assert.equal(readEpicRecord(root, 'editor').record.active.escalations, 1);

    json = step(['close', '--epic', 'editor']);
    assert.deepEqual([json.ok, json.docsDone, json.dispatchId], [true, true, 'disp-9']);
    const record = readEpicRecord(root, 'editor').record;
    assert.deepEqual([record.active, record.done.docs], [null, true]);
    assert.equal(step(start).code, 'docs-done');
  } finally {
    removeFixture(root);
  }
});

// ---------------------------------------------------------------------------
// The lanes in temporary repositories (Phase 6)
// ---------------------------------------------------------------------------

/**
 * The epic project of makeEpicProject(), with one Build Order item that
 * names base and ux, a committed `.beast-mode/phase-handoff.md`, and a
 * `.gitignore` that keeps the briefs out of git.
 *
 * @returns {string}
 */
function makeLaneProject() {
  const root = makeEpicProject();
  fs.writeFileSync(path.join(root, '.beast-mode', 'phase-handoff.md'), '# Phase handoff\n');
  fs.writeFileSync(path.join(root, '.gitignore'), '.beast-mode/briefs/\n');
  fs.writeFileSync(path.join(root, 'docs', 'features', 'editor', 'epic-overview.md'), `# Editor - Epic Overview\n\n${SIDE_BY_SIDE}`);
  gitIn(root, ['add', '-A']);
  gitIn(root, ['commit', '-q', '-m', 'lanes']);
  return root;
}

/**
 * @param {string} code
 * @param {string} message
 * @returns {import('../lib/orca/exec.js').RunResult}
 */
function refused(code, message) {
  return { status: 1, signal: null, stdout: `${JSON.stringify({ ok: false, error: { code, message } })}\n`, stderr: '', error: null };
}

/**
 * A fake Orca for the lanes, with real git. `worker-start --worktree
 * new-child` makes the worktree `<root>-wt/<name>` on the branch
 * `orca/<name>` from the base branch, as Orca does, and names it in the
 * receipt as `workspace: "repo-1::<path>"` (fact O11). `worktree rm`
 * removes the worktree with git, or refuses when `refuseRemoval` is set.
 * `worker-show` answers by the `shows` map: a dispatch works until the
 * test marks it `succeeded`.
 *
 * @param {string} root
 */
function laneOrca(root) {
  const wtRoot = `${root}-wt`;
  /** @type {Record<string, string>} */
  const shows = {};
  const state = { refuseRemoval: false, count: 0 };
  /** @type {{ command: string, args: string[] }[]} */
  const calls = [];
  /** @type {import('../lib/orca/exec.js').Runner} */
  const runner = (command, args, options) => {
    calls.push({ command, args: [...args] });
    if (command === 'git') return defaultRunner(command, args, options);
    assert.equal(command, FAKE_ORCA, `the runner got the unexpected command ${command}`);
    assert.equal(options.cwd, root, 'every Orca call starts in the main workspace');
    if (args[0] === 'status') return RUNNING;
    if (args[0] === 'worktree') {
      if (state.refuseRemoval) return refused('worktree_busy', 'the worktree has a live terminal');
      gitIn(root, ['worktree', 'remove', args[3].slice('path:'.length)]);
      return envelope({ removed: true });
    }
    const verb = args[1];
    if (verb === 'worker-start') {
      state.count += 1;
      const dispatchId = `disp-${state.count}`;
      shows[dispatchId] = 'working';
      /** @type {Record<string, any>} */
      const result = { runId: `run-${state.count}`, taskId: `task-${state.count}`, dispatchId, state: 'ready' };
      if (args[args.indexOf('--worktree') + 1] === 'new-child') {
        const name = args[args.indexOf('--name') + 1];
        const tree = path.join(wtRoot, name);
        gitIn(root, ['worktree', 'add', '-q', '-b', `orca/${name}`, tree, args[args.indexOf('--base-branch') + 1]]);
        result.workspace = `repo-1::${tree}`;
      }
      return envelope(result);
    }
    if (verb === 'worker-show') {
      const id = args[args.indexOf('--dispatch') + 1];
      return shows[id] === 'succeeded'
        ? envelope({ dispatchId: id, state: 'succeeded', stage: 'settled' })
        : envelope({ dispatchId: id, state: 'ready', stage: 'turn', liveness: 'live', activity: 'working' });
    }
    if (verb === 'worker-release') return envelope({ state: 'released', processAction: 'closed' });
    return assert.fail(`no fake Orca answer for: ${args.join(' ')}`);
  };
  return {
    runner,
    shows,
    state,
    wtRoot,
    orca: () => calls.filter((entry) => entry.command === FAKE_ORCA).map((entry) => entry.args),
    git: () => calls.filter((entry) => entry.command === 'git').map((entry) => entry.args),
  };
}

test('lanes: git: two lanes start with new-child, build in their worktrees, report in either order, merge, and remove each worktree', { skip: NO_GIT }, () => {
  const root = makeLaneProject();
  const fake = laneOrca(root);
  try {
    const mainBefore = gitIn(root, ['rev-parse', 'main']).trim();
    const step = (args) => orcaStep(root, args, fake.runner);
    const lane = (name) => ['--feature', `editor/${name}`, '--epic', 'editor'];
    const tree = (name) => path.join(fake.wtRoot, name);
    const mainClean = () => assert.equal(gitIn(root, ['status', '--porcelain']).trim(), '', 'no lane writes to the main work tree');

    // 1. The epic branch, then base starts in a new child worktree.
    assert.equal(step(['next', '--epic', 'editor', '--fresh']).action, 'branch');
    assert.equal(step(['branch', '--epic', 'editor']).ok, true);
    let json = step(['next', '--epic', 'editor']);
    assert.deepEqual([json.action, json.feature, json.placement, json.run], ['start', 'editor/base', 'new-child', lineOf(root, ['start', ...lane('base'), '--stage', 'phase', '--phase', '1'])]);
    json = step(['start', ...lane('base'), '--stage', 'phase', '--phase', '1']);
    assert.deepEqual([json.ok, json.placement, json.worktree, json.branch, json.worktreeId], [true, 'new-child', tree('base'), 'orca/base', `repo-1::${tree('base')}`]);
    const mainSpec = path.join(root, '.beast-mode', 'briefs', 'editor', 'base', 'orca-phase-1.md');
    // The submit loop of the dsh tab reads the tab one time after the start, and the turn runs (fix 1).
    assert.deepEqual(fake.orca().at(-1), ['orchestration', 'worker-show', '--dispatch', 'disp-1', '--json']);
    assert.deepEqual(fake.orca().at(-2), [
      'orchestration', 'worker-start', '--spec-file', mainSpec, '--task-title', 'base: Phase 1 implement', '--worktree', 'new-child', '--name', 'base', '--base-branch', 'epic/editor',
      '--agent', 'dsh', '--timeout-ms', '120000', '--json',
    ]);
    for (const [key, value] of [['base', 'epic/editor'], ['epic', 'editor'], ['feature', 'editor/base']]) {
      assert.equal(gitIn(root, ['config', '--get', `branch.orca/base.beast-mode-${key}`]).trim(), value);
    }
    assert.ok(fake.git().some((args) => JSON.stringify(args) === JSON.stringify(['-C', tree('base'), 'rev-parse', '--abbrev-ref', 'HEAD'])));
    assert.equal(readRecord(tree('base'), 'editor/base').record.active.dispatchId, 'disp-1', 'the lane record lives in its worktree');
    assert.equal(readRecord(root, 'editor/base').record, null, 'the main workspace holds no lane record');
    assert.ok(fs.existsSync(path.join(tree('base'), '.beast-mode', 'briefs', 'editor', 'base', 'orca-phase-1.md')), 'the spec has a copy in the worktree');

    // 2. base works, so ux starts in its own new child worktree. Then one wait names both tabs.
    json = step(['next', '--epic', 'editor']);
    assert.deepEqual([json.action, json.feature, json.placement], ['start', 'editor/ux', 'new-child']);
    assert.equal(step(['start', ...lane('ux'), '--stage', 'phase', '--phase', '1']).worktree, tree('ux'));
    json = step(['next', '--epic', 'editor']);
    assert.equal(json.action, 'wait');
    assert.deepEqual(json.workers.map((worker) => [worker.feature, worker.dispatchId, worker.worktree]), [
      ['editor/base', 'disp-1', tree('base')],
      ['editor/ux', 'disp-2', tree('ux')],
    ]);
    mainClean();

    // 3. ux reports first. Its close, its phase commit, its docs tab, and its feature-end commit run in its worktree.
    fs.writeFileSync(path.join(tree('ux'), 'ux.txt'), 'ux\n');
    fs.writeFileSync(path.join(tree('ux'), 'docs', 'features', 'editor', 'ux', 'tasks.md'), COMPLETE);
    fake.shows['disp-2'] = 'succeeded';
    json = step(['next', '--epic', 'editor', '--wake', 'worker_done', '--dispatch', 'disp-2']);
    assert.deepEqual([json.action, json.feature], ['close', 'editor/ux']);
    assert.equal(step(['close', ...lane('ux')]).ok, true);
    json = step(['next', '--epic', 'editor']);
    assert.deepEqual([json.action, json.subject], ['commit', 'feat: editor/ux phase 1']);
    json = step(['commit', ...lane('ux'), '--point', 'phase', '--phase', '1']);
    assert.equal(json.ok, true, JSON.stringify(json));
    assert.ok(fake.git().some((args) => JSON.stringify(args) === JSON.stringify(['-C', tree('ux'), 'commit', '-m', 'feat: editor/ux phase 1'])));
    json = step(['next', '--epic', 'editor']);
    assert.deepEqual([json.action, json.stage, json.placement, json.worktree], ['start', 'docs', 'worktree', tree('ux')]);
    json = step(['start', ...lane('ux'), '--stage', 'docs']);
    assert.deepEqual([json.ok, json.placement, json.dispatchId], [true, 'worktree', 'disp-3']);
    assert.equal(fake.orca().at(-2)[7], `path:${tree('ux')}`, 'a later tab selects the lane worktree, before the read of the submit loop');
    fs.appendFileSync(path.join(tree('ux'), 'docs', 'features', 'editor', 'ux', 'implementation.md'), '\nThe docs tab updated this file.\n');
    fake.shows['disp-3'] = 'succeeded';
    assert.equal(step(['next', '--epic', 'editor']).action, 'close');
    assert.equal(step(['close', ...lane('ux')]).docsDone, true);
    json = step(['next', '--epic', 'editor']);
    assert.deepEqual([json.action, json.point], ['commit', 'feature']);
    assert.deepEqual([step(['commit', ...lane('ux'), '--point', 'feature']).worktree], [tree('ux')]);
    mainClean();
    assert.equal(fs.readFileSync(path.join(root, 'docs', 'features', 'editor', 'ux', 'tasks.md'), 'utf8'), OPEN, 'the main docs wait for the merge');

    // 4. ux merges into epic/editor, and Orca removes its worktree with no flag that stops a process or deletes the branch.
    json = step(['next', '--epic', 'editor']);
    assert.deepEqual([json.action, json.feature, json.from], ['merge', 'editor/ux', 'orca/ux']);
    json = step(['merge', '--epic', 'editor', '--feature', 'editor/ux']);
    assert.deepEqual([json.ok, json.merged, json.worktree, json.removal.ok], [true, true, tree('ux'), true]);
    assert.deepEqual(fake.orca().at(-1), ['worktree', 'rm', '--worktree', `path:${tree('ux')}`, '--json']);
    assert.ok(!fs.existsSync(tree('ux')));
    assert.equal(gitIn(root, ['rev-parse', '--verify', 'orca/ux']).trim().length, 40, 'the lane branch stays');
    assert.equal(headOf(root), 'epic/editor');

    // 5. base reports now. It is the last lane of the group, and it keeps its worktree.
    fs.writeFileSync(path.join(tree('base'), 'base.txt'), 'base\n');
    fs.writeFileSync(path.join(tree('base'), 'docs', 'features', 'editor', 'base', 'tasks.md'), COMPLETE);
    fake.shows['disp-1'] = 'succeeded';
    assert.deepEqual(step(['next', '--epic', 'editor']).run, lineOf(root, ['close', ...lane('base')]));
    assert.equal(step(['close', ...lane('base')]).ok, true);
    assert.equal(step(['commit', ...lane('base'), '--point', 'phase', '--phase', '1']).ok, true);
    json = step(['next', '--epic', 'editor']);
    assert.deepEqual([json.stage, json.placement], ['docs', 'worktree']);
    assert.equal(step(['start', ...lane('base'), '--stage', 'docs']).dispatchId, 'disp-4');
    fake.shows['disp-4'] = 'succeeded';
    assert.equal(step(['close', ...lane('base')]).docsDone, true);

    // 6. A refused removal is a note in the result: the merge stands, and the worktree stays.
    fake.state.refuseRemoval = true;
    json = step(['next', '--epic', 'editor']);
    assert.deepEqual([json.action, json.feature], ['merge', 'editor/base']);
    json = step(['merge', '--epic', 'editor', '--feature', 'editor/base']);
    assert.deepEqual([json.ok, json.merged, json.removal.ok, json.removal.code], [true, true, false, 'worktree_busy']);
    assert.match(json.say, new RegExp(`The worktree ${tree('base').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} stays: remove it in Orca\\.$`));
    assert.ok(json.detail.some((line) => line.includes('the worktree has a live terminal')));
    assert.ok(fs.existsSync(tree('base')));
    for (const subject of ['Merge editor/ux into epic/editor', 'Merge editor/base into epic/editor']) {
      const sha = gitIn(root, ['log', '-1', '--format=%H', `--grep=^${subject}$`, 'epic/editor']).trim();
      assert.equal(gitIn(root, ['rev-list', '--parents', '-n', '1', sha]).trim().split(' ').length, 3, `${subject} is a --no-ff merge`);
    }
    for (const args of fake.orca().filter((entry) => entry[0] === 'worktree')) {
      assert.ok(!args.some((arg) => arg.startsWith('--') && !['--worktree', '--json'].includes(arg)), `no other flag: ${args.join(' ')}`);
    }

    // 7. The epic docs tab, then the summary lists the worktree that stays.
    json = step(['next', '--epic', 'editor']);
    assert.deepEqual([json.action, json.stage], ['start', 'epic-docs']);
    assert.equal(step(['start', '--epic', 'editor', '--stage', 'epic-docs']).dispatchId, 'disp-5');
    fake.shows['disp-5'] = 'succeeded';
    assert.equal(step(['close', '--epic', 'editor']).docsDone, true);
    json = step(['next', '--epic', 'editor']);
    assert.equal(json.action, 'done');
    assert.ok(json.show.includes(`Worktrees:\n- ${tree('base')} (editor/base, orca/base)`), json.show);
    assert.equal(gitIn(root, ['rev-parse', 'main']).trim(), mainBefore, 'main never moved');
  } finally {
    removeFixture(root);
    removeFixture(fake.wtRoot);
  }
});

/**
 * makeLaneProject with a project command for dsh in orca.json, committed.
 *
 * @returns {string}
 */
function makeCommandLaneProject() {
  const root = makeLaneProject();
  const config = { ...CONFIG, agents: { dsh: { command: 'dsh-personal' } } };
  fs.writeFileSync(path.join(root, '.beast-mode', 'orca.json'), `${JSON.stringify(config, null, 2)}\n`);
  gitIn(root, ['commit', '-qam', 'command']);
  return root;
}

/**
 * laneOrca with the command path (Decision 16). `worktree create` makes
 * `<root>-wt/<name>` on `orca/<name>` from the base branch and names it in
 * `result.worktree`, or refuses when `refuseCreate` is set (fact O15).
 * `terminal create` names a new handle, and the `tui-idle` wait holds.
 * Every Orca call is recorded in order.
 *
 * @param {string} root
 */
function commandLaneOrca(root) {
  const lanes = laneOrca(root);
  const commandState = { refuseCreate: false, terminals: 0 };
  /** @type {string[][]} */
  const seen = [];
  /** @type {import('../lib/orca/exec.js').Runner} */
  const runner = (command, args, options) => {
    if (command !== FAKE_ORCA) return lanes.runner(command, args, options);
    seen.push([...args]);
    if (args[0] === 'worktree' && args[1] === 'create') {
      assert.equal(options.cwd, root, 'every Orca call starts in the main workspace');
      if (commandState.refuseCreate) return refused('invalid_argument', '--parent-worktree active names no workspace');
      const name = args[args.indexOf('--name') + 1];
      const tree = path.join(lanes.wtRoot, name);
      gitIn(root, ['worktree', 'add', '-q', '-b', `orca/${name}`, tree, args[args.indexOf('--base-branch') + 1]]);
      return envelope({ worktree: { id: `repo-1::${tree}`, path: tree, branch: `orca/${name}`, displayName: name } });
    }
    if (args[0] === 'terminal') {
      assert.equal(options.cwd, root, 'every Orca call starts in the main workspace');
      if (args[1] === 'create') {
        commandState.terminals += 1;
        return envelope({ terminal: { handle: `term-${commandState.terminals}`, title: null } });
      }
      // The rename after a start (fix 6).
      if (args[1] === 'rename') return envelope({ terminal: { handle: args[3], title: args[5] } });
      return envelope({ wait: { handle: args[3], condition: 'tui-idle', satisfied: true, status: 'running', exitCode: null } });
    }
    return lanes.runner(command, args, options);
  };
  return { ...lanes, runner, commandState, orca: () => seen };
}

test('command: lanes: git: a new lane with a project command makes its worktree first, opens its tab with the three calls, and a later tab of that lane uses the worktree', { skip: NO_GIT }, () => {
  const root = makeCommandLaneProject();
  const fake = commandLaneOrca(root);
  try {
    const step = (args) => orcaStep(root, args, fake.runner);
    const lane = ['--feature', 'editor/base', '--epic', 'editor'];
    const tree = path.join(fake.wtRoot, 'base');
    const selector = `path:${tree}`;
    assert.equal(step(['next', '--epic', 'editor', '--fresh']).action, 'branch');
    assert.equal(step(['branch', '--epic', 'editor']).ok, true);

    // 1. The start action names the command path.
    let json = step(['next', '--epic', 'editor']);
    assert.deepEqual([json.action, json.feature, json.placement, json.path, json.command], ['start', 'editor/base', 'new-child', 'command', 'dsh-personal']);
    assert.equal(json.say, 'Start the Phase 1 tab of editor/base on dsh with the project command "dsh-personal". It opens in a new worktree from epic/editor.');

    // 2. worktree create first, then the three calls in the new worktree.
    let before = fake.orca().length;
    json = step(['start', ...lane, '--stage', 'phase', '--phase', '1']);
    const spec = path.join(tree, '.beast-mode', 'briefs', 'editor', 'base', 'orca-phase-1.md');
    assert.deepEqual(fake.orca().slice(before), [
      ['worktree', 'create', '--name', 'base', '--parent-worktree', 'active', '--base-branch', 'epic/editor', '--json'],
      ['terminal', 'create', '--worktree', selector, '--command', 'dsh-personal', '--json'],
      ['terminal', 'wait', '--terminal', 'term-1', '--for', 'tui-idle', '--timeout-ms', '60000', '--json'],
      ['orchestration', 'worker-start', '--spec-file', spec, '--task-title', 'base: Phase 1 implement', '--terminal', 'term-1', '--worktree', selector, '--json'],
      // The submit loop of the dsh tab reads the tab one time, and the turn runs (fix 1).
      ['orchestration', 'worker-show', '--dispatch', 'disp-1', '--json'],
      // The rename runs after the submit loop, with the Task title (fix 6).
      ['terminal', 'rename', '--terminal', 'term-1', '--title', 'base: Phase 1 implement', '--json'],
    ]);
    assert.deepEqual(
      [json.ok, json.placement, json.path, json.terminal, json.readyState, json.worktree, json.worktreeId, json.branch, json.dispatchId],
      [true, 'new-child', 'command', 'term-1', 'ready', tree, `repo-1::${tree}`, 'orca/base', 'disp-1'],
      JSON.stringify(json)
    );
    // The lane is recorded as in Phase 6: the three keys, the handoff check, and the worktree for every later call.
    for (const [key, value] of [['base', 'epic/editor'], ['epic', 'editor'], ['feature', 'editor/base']]) {
      assert.equal(gitIn(root, ['config', '--get', `branch.orca/base.beast-mode-${key}`]).trim(), value);
    }
    assert.ok(fs.existsSync(spec), 'the spec is written in the worktree');
    assert.ok(!fs.existsSync(path.join(root, '.beast-mode', 'briefs', 'editor', 'base', 'orca-phase-1.md')), 'the main briefs folder holds no spec');
    const active = readRecord(tree, 'editor/base').record.active;
    assert.deepEqual([active.path, active.command, active.terminal, active.worktree, active.dispatchId], ['command', 'dsh-personal', 'term-1', tree, 'disp-1']);
    assert.equal(readRecord(root, 'editor/base').record, null, 'the main workspace holds no lane record');

    // 3. A later tab of that lane: the docs tab opens with the command in the lane worktree, with no worktree create.
    fs.writeFileSync(path.join(tree, 'base.txt'), 'base\n');
    fs.writeFileSync(path.join(tree, 'docs', 'features', 'editor', 'base', 'tasks.md'), COMPLETE);
    fake.shows['disp-1'] = 'succeeded';
    assert.equal(step(['next', '--epic', 'editor']).action, 'close');
    assert.equal(step(['close', ...lane]).ok, true);
    assert.equal(step(['commit', ...lane, '--point', 'phase', '--phase', '1']).ok, true);
    json = step(['next', '--epic', 'editor']);
    assert.deepEqual([json.action, json.stage, json.placement, json.path, json.worktree], ['start', 'docs', 'worktree', 'command', tree]);
    before = fake.orca().length;
    json = step(['start', ...lane, '--stage', 'docs']);
    assert.deepEqual(fake.orca().slice(before), [
      ['terminal', 'create', '--worktree', selector, '--command', 'dsh-personal', '--json'],
      ['terminal', 'wait', '--terminal', 'term-2', '--for', 'tui-idle', '--timeout-ms', '60000', '--json'],
      ['orchestration', 'worker-start', '--spec-file', path.join(tree, '.beast-mode', 'briefs', 'editor', 'base', 'orca-docs.md'), '--task-title', 'base: docs', '--terminal', 'term-2', '--worktree', selector, '--json'],
      ['orchestration', 'worker-show', '--dispatch', 'disp-2', '--json'],
      ['terminal', 'rename', '--terminal', 'term-2', '--title', 'base: docs', '--json'],
    ]);
    assert.deepEqual([json.ok, json.placement, json.path, json.terminal, json.dispatchId], [true, 'worktree', 'command', 'term-2', 'disp-2']);
    assert.ok(
      fake.orca().every((args) => !args.includes('--agent') && (args[1] === 'rename' || !args.includes('--title'))),
      'the command path names no agent and no title, except the rename of the tab'
    );
  } finally {
    removeFixture(root);
    removeFixture(fake.wtRoot);
  }
});

test('close tab: lanes: git: a lane close closes its own terminal, a failed close is retried by the merge, and a lane merge closes an own retained tab', { skip: NO_GIT }, () => {
  const root = makeCommandLaneProject();
  const fake = commandLaneOrca(root);
  const closing = { refuse: true };
  /** @type {import('../lib/orca/exec.js').Runner} */
  const runner = (command, args, options) => {
    if (command === FAKE_ORCA && args[1] === 'worker-release') {
      fake.orca().push([...args]);
      return envelope({ state: 'retained', reason: 'no_owned_resource', processAction: 'none' });
    }
    if (command === FAKE_ORCA && args[0] === 'terminal' && args[1] === 'close') {
      fake.orca().push([...args]);
      return closing.refuse ? refused('terminal_not_found', `No terminal ${args[3]}.`) : envelope({ handle: args[3], closed: true });
    }
    return fake.runner(command, args, options);
  };
  try {
    const step = (args) => orcaStep(root, args, runner);
    const lane = ['--feature', 'editor/base', '--epic', 'editor'];
    const tree = path.join(fake.wtRoot, 'base');
    assert.equal(step(['branch', '--epic', 'editor']).ok, true);

    // 1. The start keeps the own terminal in the lane record.
    assert.equal(step(['start', ...lane, '--stage', 'phase', '--phase', '1']).ok, true);
    const active = readRecord(tree, 'editor/base').record.active;
    assert.deepEqual([active.terminal, active.ownTerminal], ['term-1', true]);

    // 2. The close runs terminal close after the release. A refused close keeps the close good, and the record keeps the handle.
    fs.writeFileSync(path.join(tree, 'base.txt'), 'base\n');
    fs.writeFileSync(path.join(tree, 'docs', 'features', 'editor', 'base', 'tasks.md'), COMPLETE);
    fake.shows['disp-1'] = 'succeeded';
    let before = fake.orca().length;
    let json = step(['close', ...lane]);
    assert.deepEqual(fake.orca().slice(before), [
      ['orchestration', 'worker-release', '--dispatch', 'disp-1', '--json'],
      ['terminal', 'close', '--terminal', 'term-1', '--json'],
    ]);
    assert.deepEqual([json.ok, json.terminalClosed], [true, false]);
    assert.ok(json.say.endsWith(' The tab term-1 stays open: close it in Orca.'), json.say);
    const kept = readRecord(tree, 'editor/base').record;
    assert.deepEqual([kept.active, kept.retained, kept.retainedTerminals], [null, ['disp-1'], { 'disp-1': 'term-1' }]);
    assert.equal(step(['commit', ...lane, '--point', 'phase', '--phase', '1']).ok, true);

    // 3. The docs tab closes its own terminal at once.
    closing.refuse = false;
    json = step(['start', ...lane, '--stage', 'docs']);
    assert.deepEqual([json.ok, json.terminal], [true, 'term-2']);
    fs.appendFileSync(path.join(tree, 'docs', 'features', 'editor', 'base', 'implementation.md'), '\nThe docs tab updated this file.\n');
    fake.shows['disp-2'] = 'succeeded';
    before = fake.orca().length;
    json = step(['close', ...lane]);
    assert.deepEqual(fake.orca().slice(before).at(-1), ['terminal', 'close', '--terminal', 'term-2', '--json']);
    assert.deepEqual([json.ok, json.docsDone, json.terminalClosed], [true, true, true]);
    assert.equal(step(['commit', ...lane, '--point', 'feature']).ok, true);

    // 4. The merge releases the retained tab again and closes its own terminal, then removes the worktree.
    before = fake.orca().length;
    json = step(['merge', '--epic', 'editor', '--feature', 'editor/base']);
    assert.deepEqual([json.ok, json.merged, json.removal.ok], [true, true, true], JSON.stringify(json));
    assert.deepEqual(fake.orca().slice(before), [
      ['orchestration', 'worker-release', '--dispatch', 'disp-1', '--json'],
      ['orchestration', 'worker-release', '--dispatch', 'disp-2', '--json'],
      ['terminal', 'close', '--terminal', 'term-1', '--json'],
      ['worktree', 'rm', '--worktree', `path:${tree}`, '--json'],
    ]);
    assert.deepEqual(json.terminals, [{ dispatchId: 'disp-1', terminal: 'term-1', closed: true }]);
  } finally {
    removeFixture(root);
    removeFixture(fake.wtRoot);
  }
});

test('close tab: lanes: git: an already_released lane close whose terminal close fails is retried by the merge, which releases no id outside retained', { skip: NO_GIT }, () => {
  const root = makeCommandLaneProject();
  const fake = commandLaneOrca(root);
  const closing = { refuse: true };
  /** @type {import('../lib/orca/exec.js').Runner} */
  const runner = (command, args, options) => {
    if (command === FAKE_ORCA && args[1] === 'worker-release') {
      fake.orca().push([...args]);
      return envelope({ state: 'already_released', processAction: 'none' });
    }
    if (command === FAKE_ORCA && args[0] === 'terminal' && args[1] === 'close') {
      fake.orca().push([...args]);
      return closing.refuse ? refused('terminal_not_found', `No terminal ${args[3]}.`) : envelope({ handle: args[3], closed: true });
    }
    return fake.runner(command, args, options);
  };
  try {
    const step = (args) => orcaStep(root, args, runner);
    const lane = ['--feature', 'editor/base', '--epic', 'editor'];
    const tree = path.join(fake.wtRoot, 'base');
    assert.equal(step(['branch', '--epic', 'editor']).ok, true);
    assert.equal(step(['start', ...lane, '--stage', 'phase', '--phase', '1']).ok, true);
    fs.writeFileSync(path.join(tree, 'base.txt'), 'base\n');
    fs.writeFileSync(path.join(tree, 'docs', 'features', 'editor', 'base', 'tasks.md'), COMPLETE);
    fake.shows['disp-1'] = 'succeeded';

    // 1. already_released, and the terminal close fails: the id is not in retained, but the handle is kept.
    let json = step(['close', ...lane]);
    assert.deepEqual([json.ok, json.terminalClosed], [true, false]);
    const kept = readRecord(tree, 'editor/base').record;
    assert.deepEqual([kept.active, kept.retained, kept.retainedTerminals], [null, undefined, { 'disp-1': 'term-1' }]);
    assert.equal(step(['commit', ...lane, '--point', 'phase', '--phase', '1']).ok, true);

    // 2. The docs tab closes its terminal.
    closing.refuse = false;
    assert.equal(step(['start', ...lane, '--stage', 'docs']).ok, true);
    fs.appendFileSync(path.join(tree, 'docs', 'features', 'editor', 'base', 'implementation.md'), '\nThe docs tab updated this file.\n');
    fake.shows['disp-2'] = 'succeeded';
    assert.equal(step(['close', ...lane]).terminalClosed, true);
    assert.equal(step(['commit', ...lane, '--point', 'feature']).ok, true);

    // 3. The merge retries the handle with no release, then removes the worktree.
    const before = fake.orca().length;
    json = step(['merge', '--epic', 'editor', '--feature', 'editor/base']);
    assert.deepEqual([json.ok, json.merged, json.removal.ok], [true, true, true], JSON.stringify(json));
    assert.deepEqual(fake.orca().slice(before), [
      ['terminal', 'close', '--terminal', 'term-1', '--json'],
      ['worktree', 'rm', '--worktree', `path:${tree}`, '--json'],
    ]);
    assert.deepEqual(json.terminals, [{ dispatchId: 'disp-1', terminal: 'term-1', closed: true }]);
  } finally {
    removeFixture(root);
    removeFixture(fake.wtRoot);
  }
});

test('close tab: lanes: git: a failed release of an own lane or epic terminal runs no terminal close and says the tab stays open (fix 5)', { skip: NO_GIT }, () => {
  const root = makeCommandLaneProject();
  const fake = commandLaneOrca(root);
  /** @type {import('../lib/orca/exec.js').Runner} */
  const runner = (command, args, options) => {
    if (command === FAKE_ORCA && args[1] === 'worker-release') {
      fake.orca().push([...args]);
      return refused('dispatch_inactive', 'not settled');
    }
    return fake.runner(command, args, options);
  };
  try {
    const step = (args) => orcaStep(root, args, runner);
    const lane = ['--feature', 'editor/base', '--epic', 'editor'];
    const tree = path.join(fake.wtRoot, 'base');
    assert.equal(step(['branch', '--epic', 'editor']).ok, true);

    // The lane form: a failed release closes no terminal and says the tab stays open.
    assert.equal(step(['start', ...lane, '--stage', 'phase', '--phase', '1']).ok, true);
    fs.writeFileSync(path.join(tree, 'base.txt'), 'base\n');
    fs.writeFileSync(path.join(tree, 'docs', 'features', 'editor', 'base', 'tasks.md'), COMPLETE);
    fake.shows['disp-1'] = 'succeeded';
    let before = fake.orca().length;
    let json = step(['close', ...lane]);
    assert.deepEqual(fake.orca().slice(before), [['orchestration', 'worker-release', '--dispatch', 'disp-1', '--json']], 'no terminal close');
    assert.deepEqual([json.ok, json.terminalClosed], [true, false]);
    assert.ok(json.say.endsWith(' The tab term-1 stays open: close it in Orca.'), json.say);

    // The epic form: the same rule for the epic docs tab.
    json = step(['start', '--epic', 'editor', '--stage', 'epic-docs']);
    assert.equal(json.ok, true, JSON.stringify(json));
    const terminal = json.terminal;
    before = fake.orca().length;
    json = step(['close', '--epic', 'editor']);
    assert.deepEqual(fake.orca().slice(before), [['orchestration', 'worker-release', '--dispatch', json.dispatchId, '--json']], 'no terminal close');
    assert.deepEqual([json.ok, json.terminalClosed], [true, false]);
    assert.ok(json.say.endsWith(` The tab ${terminal} stays open: close it in Orca.`), json.say);
  } finally {
    removeFixture(root);
    removeFixture(fake.wtRoot);
  }
});

test('command: lanes: git: when Orca refuses the new worktree, the run stops lane-worktree-refused, and after the clear the lane builds in sequence in the main workspace', { skip: NO_GIT }, () => {
  const root = makeCommandLaneProject();
  const fake = commandLaneOrca(root);
  fake.commandState.refuseCreate = true;
  try {
    const step = (args) => orcaStep(root, args, fake.runner);
    const lane = ['--feature', 'editor/base', '--epic', 'editor'];
    assert.equal(step(['next', '--epic', 'editor', '--fresh']).action, 'branch');
    assert.equal(step(['branch', '--epic', 'editor']).ok, true);
    let json = step(['next', '--epic', 'editor']);
    assert.deepEqual([json.action, json.placement, json.path], ['start', 'new-child', 'command']);

    // 1. Orca refuses the worktree: no terminal opens, and the lane record keeps the cause and the mark.
    let before = fake.orca().length;
    json = step(['start', ...lane, '--stage', 'phase', '--phase', '1']);
    assert.deepEqual(fake.orca().slice(before).map((args) => args.slice(0, 2)), [['worktree', 'create']], 'no terminal opens');
    assert.deepEqual([json.ok, json.code, json.path, json.command], [false, 'lane-worktree-refused', 'command', 'dsh-personal']);
    assert.ok(json.detail.some((line) => line.includes('--parent-worktree active names no workspace')), JSON.stringify(json.detail));
    let record = readRecord(root, 'editor/base').record;
    assert.deepEqual([record.failedStart.code, record.failedStart.taskId, record.sequential.command], ['lane-worktree-refused', null, 'dsh-personal']);

    // 2. A clear stop, with the clear as its fix. The clear keeps the mark.
    json = step(['next', '--epic', 'editor']);
    assert.deepEqual([json.action, json.reason, json.feature], ['stop', 'lane-worktree-refused', 'editor/base'], JSON.stringify(json));
    assert.match(json.fix, /builds in the main workspace/);
    assert.equal(step(['close', ...lane]).ok, true);
    record = readRecord(root, 'editor/base').record;
    assert.deepEqual([record.failedStart, typeof record.sequential], [null, 'object']);

    // 3. The group builds in sequence: base takes its branch in the main workspace, and its tab opens there with the command.
    json = step(['next', '--epic', 'editor']);
    assert.deepEqual([json.action, json.feature], ['branch', 'editor/base'], JSON.stringify(json));
    assert.equal(step(['branch', '--epic', 'editor', '--feature', 'editor/base']).ok, true);
    json = step(['next', '--epic', 'editor']);
    assert.deepEqual([json.action, json.feature, json.placement, json.path], ['start', 'editor/base', 'current', 'command']);
    before = fake.orca().length;
    json = step(['start', ...lane, '--stage', 'phase', '--phase', '1']);
    assert.deepEqual(fake.orca().slice(before), [
      ['terminal', 'create', '--worktree', 'current', '--command', 'dsh-personal', '--json'],
      ['terminal', 'wait', '--terminal', 'term-1', '--for', 'tui-idle', '--timeout-ms', '60000', '--json'],
      ['orchestration', 'worker-start', '--spec-file', path.join(root, '.beast-mode', 'briefs', 'editor', 'base', 'orca-phase-1.md'), '--task-title', 'base: Phase 1 implement', '--terminal', 'term-1', '--worktree', 'current', '--json'],
      // The submit loop of the dsh tab reads the tab one time, and the turn runs (fix 1).
      ['orchestration', 'worker-show', '--dispatch', 'disp-1', '--json'],
      ['terminal', 'rename', '--terminal', 'term-1', '--title', 'base: Phase 1 implement', '--json'],
    ]);
    assert.deepEqual([json.ok, json.placement], [true, 'current']);
    assert.equal(headOf(root), 'feat/editor/base');
    assert.equal(step(['next', '--epic', 'editor']).action, 'wait', 'ux waits for base');
    assert.ok(!fs.existsSync(fake.wtRoot), 'no worktree was made');
  } finally {
    removeFixture(root);
    removeFixture(fake.wtRoot);
  }
});

test('tab title: a new-child lane start on the agent path renames the tab of the receipt with the Task title', { skip: NO_GIT }, () => {
  const root = makeLaneProject();
  const fake = laneOrca(root);
  /** @type {string[][]} */
  const seen = [];
  /** @type {import('../lib/orca/exec.js').Runner} */
  const runner = (command, args, options) => {
    if (command === FAKE_ORCA) seen.push([...args]);
    if (command === FAKE_ORCA && args[0] === 'terminal' && args[1] === 'rename') return envelope({ terminal: { handle: args[3], title: args[5] } });
    const answer = fake.runner(command, args, options);
    if (command === FAKE_ORCA && args[1] === 'worker-start') {
      const result = JSON.parse(answer.stdout).result;
      return envelope({ ...result, terminal: `term-${result.dispatchId}` });
    }
    return answer;
  };
  try {
    const step = (args) => orcaStep(root, args, runner);
    assert.equal(step(['branch', '--epic', 'editor']).ok, true);
    const json = step(['start', '--feature', 'editor/base', '--epic', 'editor', '--stage', 'phase', '--phase', '1']);
    assert.deepEqual([json.ok, json.placement, json.tabTitled], [true, 'new-child', true], JSON.stringify(json));
    assert.deepEqual(seen.at(-2).slice(0, 2), ['orchestration', 'worker-show']);
    assert.deepEqual(seen.at(-1), ['terminal', 'rename', '--terminal', 'term-disp-1', '--title', 'base: Phase 1 implement', '--json']);
  } finally {
    removeFixture(root);
    removeFixture(fake.wtRoot);
  }
});

test('tab title: git: the epic docs start renames its tab, and a failed rename keeps the start good', { skip: NO_GIT }, () => {
  for (const refusedRename of [false, true]) {
    const root = makeEpicProject();
    try {
      const fake = fakeRunner({
        'worker-start': envelope({ runId: 'run-9', taskId: 'task-9', dispatchId: 'disp-9', state: 'ready', terminal: 'term-9' }),
        'worker-show': envelope({ dispatchId: 'disp-9', state: 'ready', stage: 'input_accepted', liveness: 'live', activity: 'working' }),
        terminal: refusedRename ? refused('terminal_not_found', 'No terminal term-9.') : envelope({ terminal: { handle: 'term-9', title: 'editor: epic docs' } }),
      });
      gitIn(root, ['switch', '-q', '-c', 'epic/editor', 'main']);
      const json = orcaStep(root, ['start', '--epic', 'editor', '--stage', 'epic-docs'], fake.runner);
      assert.deepEqual([json.ok, json.dispatchId, json.tabTitled], [true, 'disp-9', !refusedRename], JSON.stringify(json));
      assert.deepEqual(fake.orca().at(-1), ['terminal', 'rename', '--terminal', 'term-9', '--title', 'editor: epic docs', '--json']);
      assert.equal(fake.orca().filter((args) => args[1] === 'rename').length, 1);
      assert.equal(readEpicRecord(root, 'editor').record.active.dispatchId, 'disp-9');
    } finally {
      removeFixture(root);
    }
  }
});

test('lanes: git: two diverged lane branches both merge --no-ff, and a conflicting pair aborts with a clean tree and epic/<epic> unchanged', { skip: NO_GIT }, () => {
  const root = makeLaneProject();
  const fake = laneOrca(root);
  try {
    const step = (args) => orcaStep(root, args, fake.runner);
    const merge = (name) => step(['merge', '--epic', 'editor', '--feature', `editor/${name}`]);
    gitIn(root, ['switch', '-q', '-c', 'epic/editor', 'main']);
    gitIn(root, ['config', 'branch.epic/editor.beast-mode-base', 'main']);
    /**
     * A lane worktree that Orca made, with the three lane keys and one commit.
     *
     * @param {string} name
     * @param {string} file
     * @param {string} text
     */
    const laneWith = (name, file, text) => {
      const tree = path.join(fake.wtRoot, name);
      gitIn(root, ['worktree', 'add', '-q', '-b', `orca/${name}`, tree, 'epic/editor']);
      for (const [key, value] of [['base', 'epic/editor'], ['epic', 'editor'], ['feature', `editor/${name}`]]) {
        gitIn(root, ['config', `branch.orca/${name}.beast-mode-${key}`, value]);
      }
      fs.writeFileSync(path.join(tree, file), text);
      gitIn(tree, ['add', '-A']);
      gitIn(tree, ['commit', '-q', '-m', `feat: editor/${name}`]);
      return tree;
    };

    // 1. Two lanes and the epic branch diverge, and both merges land as merge commits.
    laneWith('base', 'base.txt', 'base\n');
    laneWith('ux', 'ux.txt', 'ux\n');
    fs.writeFileSync(path.join(root, 'epic.txt'), 'the epic\n');
    gitIn(root, ['add', '-A']);
    gitIn(root, ['commit', '-q', '-m', 'epic change']);
    for (const name of ['base', 'ux']) {
      const json = merge(name);
      assert.deepEqual([json.ok, json.merged, json.from, json.removal.ok], [true, true, `orca/${name}`, true], JSON.stringify(json));
      assert.equal(gitIn(root, ['rev-list', '--parents', '-n', '1', json.commit]).trim().split(' ').length, 3, `${name} merged --no-ff`);
      assert.equal(gitIn(root, ['config', '--get', `branch.orca/${name}.beast-mode-merged`]).trim(), json.commit);
    }
    assert.deepEqual(fs.readdirSync(root).filter((name) => name.endsWith('.txt')).sort(), ['base.txt', 'epic.txt', 'ux.txt']);
    assert.equal(gitIn(root, ['status', '--porcelain']).trim(), '');
  } finally {
    removeFixture(root);
    removeFixture(fake.wtRoot);
  }

  const second = makeLaneProject();
  const other = laneOrca(second);
  try {
    const step = (args) => orcaStep(second, args, other.runner);
    gitIn(second, ['switch', '-q', '-c', 'epic/editor', 'main']);
    const trees = {};
    for (const name of ['base', 'ux']) {
      const tree = path.join(other.wtRoot, name);
      trees[name] = tree;
      gitIn(second, ['worktree', 'add', '-q', '-b', `orca/${name}`, tree, 'epic/editor']);
      for (const [key, value] of [['base', 'epic/editor'], ['epic', 'editor'], ['feature', `editor/${name}`]]) {
        gitIn(second, ['config', `branch.orca/${name}.beast-mode-${key}`, value]);
      }
      fs.writeFileSync(path.join(tree, 'shared.txt'), `the lane ${name}\n`);
      gitIn(tree, ['add', '-A']);
      gitIn(tree, ['commit', '-q', '-m', `feat: editor/${name}`]);
    }

    // 2. A conflicting pair: base merges, ux hits the conflict, and the run aborts it.
    assert.equal(step(['merge', '--epic', 'editor', '--feature', 'editor/base']).ok, true);
    const epicBefore = gitIn(second, ['rev-parse', 'epic/editor']).trim();
    const removals = other.orca().filter((args) => args[0] === 'worktree').length;
    const json = step(['merge', '--epic', 'editor', '--feature', 'editor/ux']);
    assert.deepEqual([json.ok, json.code, json.files, json.worktree], [false, 'merge-conflict', ['shared.txt'], trees.ux]);
    assert.equal(gitIn(second, ['status', '--porcelain']).trim(), '', 'the abort leaves a clean tree');
    assert.equal(gitIn(second, ['rev-parse', 'epic/editor']).trim(), epicBefore, 'the epic branch is unchanged');
    assert.equal(headOf(second), 'epic/editor');
    assert.ok(fs.existsSync(trees.ux), 'the conflict keeps the worktree');
    assert.equal(other.orca().filter((args) => args[0] === 'worktree').length, removals, 'no removal after a conflict');
    assert.equal(readRecord(trees.ux, 'editor/ux').record.failedGit.code, 'merge-conflict', 'the failure lives in the lane record');
    assert.equal(readRecord(second, 'editor/ux').record, null);

    // 3. next stops merge-conflict and names the worktree.
    const stopped = step(['next', '--epic', 'editor']);
    assert.deepEqual([stopped.action, stopped.reason, stopped.feature], ['stop', 'merge-conflict', 'editor/ux']);
    assert.ok(stopped.detail.includes('Conflict: shared.txt'));
    assert.ok(stopped.fix.includes(`in its worktree ${trees.ux}`));
  } finally {
    removeFixture(second);
    removeFixture(other.wtRoot);
  }
});
