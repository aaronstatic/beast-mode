// installer/test/orca-steps.test.js
//
// The custom steps of `beast-mode orca` (orca-plugin/orchestration, Phase 8,
// Decision 17): the `orchestration.steps` schema and its token rules, the
// verdict reader, the decision walk of the three points (after a phase,
// after a feature, after the epic), the verdict answers (PASS closes, FAIL
// and BLOCKED ask, no verdict sends once and then asks), the `start --stage
// step` and `close` steps over a temporary git project with a fake Orca,
// and the two lists of `detect` that feed `/orca-setup`. The git tests skip
// when git is absent. No test starts a real Orca CLI.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { adapters } from '../adapters/index.js';
import { findPluginRoot } from '../lib/source.js';
import { decideEpic, decideFeature } from '../lib/orca/decide.js';
import { defaultRunner } from '../lib/orca/exec.js';
import {
  fillStepTokens,
  newEpicRecord,
  newRecord,
  parseBuildOrder,
  parseOrcaConfig,
  parseReview,
  parseTasks,
  readEpicRecord,
  readRecord,
  readStepVerdicts,
  readVerdict,
  stepKey,
  stepPoint,
  writeRecord,
} from '../lib/orca/read.js';
import { stepSpec } from '../lib/orca/spec.js';
import { runOrca } from '../lib/orca/steps.js';
import { UsageError } from '../lib/errors.js';
import { createTempProjectRoot, removeFixture } from './helpers.js';

const PLUGIN_ROOT = findPluginRoot(import.meta.dirname);
const NODE = '/usr/bin/node';
const FAKE_ORCA = 'fake-orca';
const NOW = new Date('2026-11-18T07:10:00.000Z');
const HAS_GIT = spawnSync('git', ['--version'], { encoding: 'utf8' }).status === 0;
const NO_GIT = HAS_GIT ? false : 'git is not installed';

const REVIEW_UX = { after: 'feature', command: '/review-ux {feature}', agent: 'claude' };
const PHASE_STEP = { after: 'phase', command: '/check-phase {feature} {phase}', agent: 'claude' };
const EPIC_STEP = { after: 'epic', command: '/review-epic {epic}', agent: 'claude' };

/**
 * @param {unknown[]} steps
 * @param {Record<string, any>} [extra] Keys of the orchestration object.
 * @returns {Record<string, any>} A settings file with the review off, so the review never gates a step.
 */
function configWith(steps, extra = {}) {
  return { version: 1, orchestration: { stages: { implement: 'dsh', review: false }, steps, ...extra } };
}

// ---------------------------------------------------------------------------
// The schema: the codes of the steps table
// ---------------------------------------------------------------------------

/**
 * @param {unknown} steps
 * @returns {{ code: string, at: string }[]} The problems of a settings file with these steps, or none.
 */
function problemsOf(steps) {
  const read = parseOrcaConfig(JSON.stringify({ version: 1, orchestration: { steps } }));
  return read.state === 'invalid' ? read.problems : [];
}

const LONG_OK = `/${'a'.repeat(199)}`;
const SCHEMA_CASES = [
  { name: 'no step line', steps: [], problems: [] },
  {
    name: 'one valid line at each point, with its tokens',
    steps: [
      { after: 'phase', command: '/check {feature} {phase}', agent: 'claude' },
      { after: 'feature', command: '/review-ux {feature}', agent: 'dsh' },
      { after: 'epic', command: '/review-epic {epic}', agent: 'claude' },
    ],
    problems: [],
  },
  { name: 'a command with no token', steps: [{ after: 'feature', command: '/lint', agent: 'dsh' }], problems: [] },
  { name: 'a command of exactly 200 characters', steps: [{ after: 'feature', command: LONG_OK, agent: 'dsh' }], problems: [] },
  { name: 'steps as an object', steps: {}, problems: [{ code: 'steps-not-array', at: '$.orchestration.steps' }] },
  { name: 'steps as a string', steps: 'x', problems: [{ code: 'steps-not-array', at: '$.orchestration.steps' }] },
  { name: 'a line that is a string', steps: ['/x'], problems: [{ code: 'step-not-object', at: '$.orchestration.steps[0]' }] },
  { name: 'a line that is null', steps: [null], problems: [{ code: 'step-not-object', at: '$.orchestration.steps[0]' }] },
  {
    name: 'a line with another key',
    steps: [{ ...REVIEW_UX, when: 'always' }],
    problems: [{ code: 'step-unknown-key', at: '$.orchestration.steps[0].when' }],
  },
  {
    name: 'an unknown point',
    steps: [{ ...REVIEW_UX, after: 'sometime' }],
    problems: [{ code: 'step-after', at: '$.orchestration.steps[0].after' }],
  },
  {
    name: 'no point',
    steps: [{ command: '/x', agent: 'dsh' }],
    problems: [{ code: 'step-after', at: '$.orchestration.steps[0].after' }],
  },
  {
    name: 'an unknown point and a token that no point holds: the token check waits for a valid point',
    steps: [{ after: 'sometime', command: '/x {bogus}', agent: 'dsh' }],
    problems: [{ code: 'step-after', at: '$.orchestration.steps[0].after' }],
  },
  { name: 'an empty command', steps: [{ ...REVIEW_UX, command: '' }], problems: [{ code: 'step-command', at: '$.orchestration.steps[0].command' }] },
  { name: 'a command with no slash', steps: [{ ...REVIEW_UX, command: 'review-ux' }], problems: [{ code: 'step-command', at: '$.orchestration.steps[0].command' }] },
  { name: 'a command of 201 characters', steps: [{ ...REVIEW_UX, command: `${LONG_OK}a` }], problems: [{ code: 'step-command', at: '$.orchestration.steps[0].command' }] },
  { name: 'a command of two lines', steps: [{ ...REVIEW_UX, command: '/x\n/y' }], problems: [{ code: 'step-command', at: '$.orchestration.steps[0].command' }] },
  { name: 'a command that is a number', steps: [{ ...REVIEW_UX, command: 5 }], problems: [{ code: 'step-command', at: '$.orchestration.steps[0].command' }] },
  { name: 'no command', steps: [{ after: 'feature', agent: 'dsh' }], problems: [{ code: 'step-command', at: '$.orchestration.steps[0].command' }] },
  { name: 'the epic token after a feature', steps: [{ ...REVIEW_UX, command: '/x {epic}' }], problems: [{ code: 'step-token', at: '$.orchestration.steps[0].command' }] },
  { name: 'the phase token after a feature', steps: [{ ...REVIEW_UX, command: '/x {phase}' }], problems: [{ code: 'step-token', at: '$.orchestration.steps[0].command' }] },
  { name: 'the feature token after the epic', steps: [{ ...EPIC_STEP, command: '/x {feature}' }], problems: [{ code: 'step-token', at: '$.orchestration.steps[0].command' }] },
  { name: 'the epic token after a phase', steps: [{ ...PHASE_STEP, command: '/x {epic}' }], problems: [{ code: 'step-token', at: '$.orchestration.steps[0].command' }] },
  { name: 'an unknown token', steps: [{ ...PHASE_STEP, command: '/x {bogus}' }], problems: [{ code: 'step-token', at: '$.orchestration.steps[0].command' }] },
  { name: 'an open brace', steps: [{ ...REVIEW_UX, command: '/x {' }], problems: [{ code: 'step-token', at: '$.orchestration.steps[0].command' }] },
  { name: 'a close brace', steps: [{ ...REVIEW_UX, command: '/x }' }], problems: [{ code: 'step-token', at: '$.orchestration.steps[0].command' }] },
  { name: 'an empty token', steps: [{ ...REVIEW_UX, command: '/x {}' }], problems: [{ code: 'step-token', at: '$.orchestration.steps[0].command' }] },
  { name: 'an agent that is not claude or dsh', steps: [{ ...REVIEW_UX, agent: 'gpt' }], problems: [{ code: 'step-agent', at: '$.orchestration.steps[0].agent' }] },
  { name: 'no agent', steps: [{ after: 'feature', command: '/x' }], problems: [{ code: 'step-agent', at: '$.orchestration.steps[0].agent' }] },
  {
    name: 'two bad lines report in file order, with their own paths',
    steps: [REVIEW_UX, { after: 'epic', command: 'x', agent: 'nobody' }],
    problems: [
      { code: 'step-command', at: '$.orchestration.steps[1].command' },
      { code: 'step-agent', at: '$.orchestration.steps[1].agent' },
    ],
  },
];

for (const { name, steps, problems } of SCHEMA_CASES) {
  test(`steps schema: ${name} answers ${problems.length === 0 ? 'no problem' : problems.map((p) => p.code).join(', ')}`, () => {
    assert.deepEqual(problemsOf(steps), problems);
  });
}

test('steps schema: 16 lines pass, 17 lines answer steps-too-many once and still check the first 16', () => {
  const line = { after: 'feature', command: '/lint', agent: 'dsh' };
  assert.deepEqual(problemsOf(Array.from({ length: 16 }, () => line)), []);
  assert.deepEqual(problemsOf(Array.from({ length: 17 }, () => line)), [{ code: 'steps-too-many', at: '$.orchestration.steps' }]);
  const bad = Array.from({ length: 17 }, (_, i) => (i === 3 ? { ...line, agent: 'x' } : line));
  assert.deepEqual(problemsOf(bad), [
    { code: 'steps-too-many', at: '$.orchestration.steps' },
    { code: 'step-agent', at: '$.orchestration.steps[3].agent' },
  ]);
});

test('steps schema: a valid file resolves its lines, and a file with no steps resolves none', () => {
  const read = parseOrcaConfig(JSON.stringify(configWith([REVIEW_UX, EPIC_STEP])));
  assert.equal(read.state, 'valid');
  assert.deepEqual(/** @type {any} */ (read).orchestration.steps, [REVIEW_UX, EPIC_STEP]);
  const none = parseOrcaConfig(JSON.stringify({ version: 1, orchestration: {} }));
  assert.deepEqual(/** @type {any} */ (none).orchestration.steps, []);
});

test('tokens: fillStepTokens fills the three tokens, every copy, and leaves a token with no value', () => {
  assert.equal(fillStepTokens('/check {feature} {phase} {feature}', { feature: 'editor/ux', phase: 2 }), '/check editor/ux 2 editor/ux');
  assert.equal(fillStepTokens('/review-epic {epic}', { epic: 'editor' }), '/review-epic editor');
  assert.equal(fillStepTokens('/x {phase}', { feature: 'demo', phase: null }), '/x {phase}');
  assert.equal(fillStepTokens('/plain', { feature: 'demo' }), '/plain');
  assert.equal(stepPoint('phase', 3), 'phase-3');
  assert.equal(stepPoint('feature', 3), 'feature');
  assert.equal(stepKey('phase-3', 0), 'phase-3:0');
});

// ---------------------------------------------------------------------------
// The verdict reader
// ---------------------------------------------------------------------------

const VERDICT_CASES = [
  ['PASS', { verdict: 'PASS', evidence: '' }],
  ['PASS\n', { verdict: 'PASS', evidence: '' }],
  ['FAIL\nthe form drops a field\nsecond line', { verdict: 'FAIL', evidence: 'the form drops a field\nsecond line' }],
  ['﻿BLOCKED\r\nthe server is down\r\n', { verdict: 'BLOCKED', evidence: 'the server is down' }],
  ['  PASS  \nok', { verdict: 'PASS', evidence: 'ok' }],
  ['pass', null],
  ['Pass\nok', null],
  ['PASS: all fine', null],
  ['PASSED', null],
  ['\nPASS', null],
  ['The result is PASS', null],
  ['', null],
  [null, null],
  [undefined, null],
  [42, null],
];

for (const [text, expected] of VERDICT_CASES) {
  test(`verdict: ${JSON.stringify(text)} reads as ${expected ? expected.verdict : 'no verdict'}`, () => {
    assert.deepEqual(readVerdict(text), expected);
  });
}

test('verdict: readStepVerdicts keys each verdict file, marks a bad line 1 as null, and ignores every other file', () => {
  const dir = createTempProjectRoot();
  try {
    const write = (name, body) => fs.writeFileSync(path.join(dir, name), body);
    write('orca-step-feature-0.verdict.md', 'PASS\nall good');
    write('orca-step-phase-2-1.verdict.md', 'looks fine to me');
    write('orca-step-epic-0.verdict.md', 'BLOCKED\nno network');
    write('orca-step-feature-0.md', 'a spec, not a verdict');
    write('orca-step-other-0.verdict.md', 'PASS');
    write('orca-step-phase-0-0.verdict.md', 'PASS');
    write('orca-step-phase-01-0.verdict.md', 'PASS');
    assert.deepEqual(readStepVerdicts(dir), {
      'feature:0': { verdict: 'PASS', evidence: 'all good' },
      'phase-2:1': { verdict: null, evidence: '' },
      'epic:0': { verdict: 'BLOCKED', evidence: 'no network' },
      // Phase 0 is a real phase (fix 4). A phase number with a leading zero names no phase.
      'phase-0:0': { verdict: 'PASS', evidence: '' },
    });
    assert.deepEqual(readStepVerdicts(path.join(dir, 'missing')), {});
  } finally {
    removeFixture(dir);
  }
});

test('stepSpec: the command with its tokens, the verdict file, no git write, and worker_done; the epic form loads the epic', () => {
  const feature = stepSpec({ target: 'demo', epic: null, point: 'feature', command: '/review-ux demo', verdictFile: '.beast-mode/briefs/demo/orca-step-feature-0.verdict.md' });
  for (const part of [
    '# Beast Mode orca worker - demo, Step',
    '`/review-ux demo`',
    '`.beast-mode/briefs/demo/orca-step-feature-0.verdict.md`',
    '`PASS`, `FAIL`, or `BLOCKED`',
    'Make no git write.',
    'worker_done',
    '`[demo step]`',
  ]) {
    assert.ok(feature.includes(part), `the step spec lacks: ${part}`);
  }
  assert.ok(!/subagent/i.test(feature));
  const epic = stepSpec({ target: 'editor', epic: null, point: 'epic', command: '/review-epic editor', verdictFile: '.beast-mode/briefs/editor/orca-step-epic-0.verdict.md' });
  assert.ok(epic.includes('`/review-epic editor`'));
  assert.ok(epic.includes('epic-resolution.md'));
  assert.ok(!epic.includes('inbox.md'), 'the epic tab has no inbox.md of its own');
  const inLane = stepSpec({ target: 'editor/ux', epic: 'editor', point: 'phase-1', command: '/check editor/ux 1', verdictFile: 'v.md' });
  assert.ok(inLane.includes('Load the epic context'));
});

// ---------------------------------------------------------------------------
// The decision walk: builders
// ---------------------------------------------------------------------------

/**
 * @param {number} number
 * @param {{ done?: number, open?: number }} [opts]
 * @returns {string}
 */
function phaseText(number, { done = 0, open = 0 } = {}) {
  const lines = [`## Phase ${number}: Slice ${number} (${done}/${done + open} complete)`, ''];
  for (let i = 1; i <= done; i += 1) lines.push(`- [x] **Task ${number}.${i}** done`);
  for (let i = 1; i <= open; i += 1) lines.push(`- [ ] **Task ${number}.${done + i}** open`);
  lines.push('', '---', '');
  return lines.join('\n');
}

/**
 * @param {...string} phases
 * @returns {string}
 */
function tasksDoc(...phases) {
  return ['# Demo - Task Checklist', '', '---', '', ...phases].join('\n');
}

const TWO_PHASES_ONE_DONE = tasksDoc(phaseText(1, { done: 2 }), phaseText(2, { open: 1 }));
const ALL_DONE = tasksDoc(phaseText(1, { done: 2 }), phaseText(2, { done: 1 }));

/**
 * A fact set of `/orca-feature` where every check passes: an Orca tab, the
 * settings with the review off, both harnesses, the run branch, no record.
 *
 * @param {{ steps?: unknown[], tasks?: string, record?: Record<string, any> | null, git?: Record<string, any>, docs?: Record<string, any>, harnesses?: string[], stages?: Record<string, any>, worker?: Record<string, any> | null, commit?: string }} [opts]
 * @returns {import('../lib/orca/decide.js').FeatureFacts}
 */
function facts({ steps = [], tasks = TWO_PHASES_ONE_DONE, record = null, git = {}, docs = {}, harnesses = ['claude', 'dsh'], stages = {}, worker = null, commit = 'phase' } = {}) {
  const config = configWith(steps, { commit });
  Object.assign(config.orchestration.stages, stages);
  return /** @type {any} */ ({
    feature: 'demo',
    flags: { fresh: false, wake: null, dispatch: null, stop: false, acceptDirty: false },
    terminalHandle: 'term-1',
    config: parseOrcaConfig(JSON.stringify(config)),
    harnesses,
    git: {
      workTree: true,
      detail: [],
      error: null,
      head: 'feat/demo',
      defaultBranch: 'main',
      runBranch: 'feat/demo',
      runBranchExists: true,
      base: 'main',
      dirty: [],
      subjects: [],
      ...git,
    },
    docs: {
      valid: true,
      reason: null,
      exists: true,
      isEpic: false,
      epic: null,
      has: { requirements: true, implementation: true, tasks: true, context: true, inbox: true, codeReview: false },
      tasks: parseTasks(tasks),
      tasksError: null,
      review: null,
      reviewError: null,
      humanTests: [],
      inbox: [],
      inboxActionable: [],
      inboxNewRequirements: [],
      stepVerdicts: {},
      ...docs,
    },
    record: { record, note: null },
    orcaStatus: null,
    worker,
  });
}

/**
 * @param {Record<string, any>} [done] The `done` marks.
 * @returns {Record<string, any>} A run record of `demo` with no active tab.
 */
function recordDone(done = {}) {
  return { ...newRecord('demo'), done: { docs: false, steps: {}, ...done } };
}

/**
 * @param {Record<string, any>} [active]
 * @param {Record<string, any>} [done]
 * @returns {Record<string, any>} A run record of `demo` with an active step tab of the feature point.
 */
function stepRecord(active = {}, done = {}) {
  return {
    ...recordDone(done),
    active: {
      stage: 'step',
      phase: null,
      step: 0,
      point: 'feature',
      stepCommand: '/review-ux demo',
      verdictFile: '.beast-mode/briefs/demo/orca-step-feature-0.verdict.md',
      round: 0,
      agent: 'claude',
      placement: 'current',
      dispatchId: 'disp-1',
      taskId: 'task-1',
      runId: 'run-1',
      startedAt: '2026-11-18T07:10:00.000Z',
      sendBacks: 0,
      escalations: 0,
      ...active,
    },
  };
}

// ---------------------------------------------------------------------------
// The decision walk: the three points, in order
// ---------------------------------------------------------------------------

test('points: a phase step starts after its phase, with its tokens filled, and the next phase waits for it', () => {
  const action = decideFeature(facts({ steps: [PHASE_STEP] }));
  assert.equal(action.action, 'start');
  assert.deepEqual(action.run, ['start', '--feature', 'demo', '--stage', 'step', '--step', '0', '--phase', '1']);
  assert.deepEqual([action.stage, action.phase, action.step, action.point, action.agent], ['step', 1, 0, 'phase-1', 'claude']);
  assert.equal(action.stepCommand, '/check-phase demo 1');
  assert.equal(action.placement, 'current');
  assert.ok(action.say.includes('after Phase 1 on claude'), action.say);

  // The mark of the step lets Phase 2 start.
  const marked = decideFeature(facts({ steps: [PHASE_STEP], record: recordDone({ steps: { 'phase-1:0': 'PASS' } }) }));
  assert.deepEqual([marked.action, marked.stage, marked.phase], ['start', 'phase', 2]);
});

test('points: two phase lines run in order, one at a time', () => {
  const second = { after: 'phase', command: '/second {feature}', agent: 'dsh' };
  const first = decideFeature(facts({ steps: [PHASE_STEP, second] }));
  assert.equal(first.step, 0);
  const next = decideFeature(facts({ steps: [PHASE_STEP, second], record: recordDone({ steps: { 'phase-1:0': 'PASS' } }) }));
  assert.deepEqual([next.stage, next.step, next.agent, next.stepCommand], ['step', 1, 'dsh', '/second demo']);
});

test('points: the phase steps run before the phase commit, and the commit follows the mark', () => {
  const dirty = { dirty: ['src/a.js'] };
  const before = decideFeature(facts({ steps: [PHASE_STEP], git: dirty }));
  assert.deepEqual([before.action, before.stage], ['start', 'step']);
  const after = decideFeature(facts({ steps: [PHASE_STEP], git: dirty, record: recordDone({ steps: { 'phase-1:0': 'overridden' } }) }));
  assert.deepEqual([after.action, after.point, after.phase], ['commit', 'phase', 1]);
});

test('points: a phase step never runs for old work: a later phase with a done task, a commit, or an end stage', () => {
  const later = tasksDoc(phaseText(1, { done: 2 }), phaseText(2, { done: 1, open: 1 }));
  const laterAction = decideFeature(facts({ steps: [PHASE_STEP], tasks: later }));
  assert.deepEqual([laterAction.action, laterAction.stage, laterAction.phase], ['start', 'phase', 2]);
  const committed = decideFeature(facts({ steps: [PHASE_STEP], git: { subjects: ['feat: demo phase 1'] } }));
  assert.deepEqual([committed.action, committed.stage, committed.phase], ['start', 'phase', 2]);
  const docsDone = decideFeature(facts({ steps: [PHASE_STEP], tasks: ALL_DONE, record: recordDone({ docs: true }) }));
  assert.equal(docsDone.action, 'done');
});

test('points: the last phase step runs after the last phase, and the feature step follows', () => {
  const steps = [PHASE_STEP, REVIEW_UX];
  const last = decideFeature(facts({ steps, tasks: ALL_DONE, record: recordDone({ steps: { 'phase-1:0': 'PASS' } }) }));
  // Phase 1 is old work now (Phase 2 holds a done task), so the last phase step comes first.
  assert.deepEqual([last.stage, last.point, last.phase], ['step', 'phase-2', 2]);
  const feature = decideFeature(facts({ steps, tasks: ALL_DONE, record: recordDone({ steps: { 'phase-2:0': 'PASS' } }) }));
  assert.deepEqual([feature.stage, feature.point, feature.phase, feature.stepCommand], ['step', 'feature', null, '/review-ux demo']);
  assert.deepEqual(feature.run, ['start', '--feature', 'demo', '--stage', 'step', '--step', '1']);
});

test('points: the feature steps run before the inbox and the docs, and each line runs once', () => {
  const inbox = { inboxActionable: [{ text: '- [ ] bug 2026-11-18 10:00 | the form drops a field' }] };
  const step = decideFeature(facts({ steps: [REVIEW_UX], tasks: ALL_DONE, docs: inbox }));
  assert.deepEqual([step.action, step.stage, step.point], ['start', 'step', 'feature']);
  const afterMark = decideFeature(facts({ steps: [REVIEW_UX], tasks: ALL_DONE, docs: inbox, record: recordDone({ steps: { 'feature:0': 'PASS' } }) }));
  assert.deepEqual([afterMark.action, afterMark.stage], ['start', 'inbox']);
  const docs = decideFeature(facts({ steps: [REVIEW_UX], tasks: ALL_DONE, record: recordDone({ steps: { 'feature:0': 'overridden' } }) }));
  assert.deepEqual([docs.action, docs.stage], ['start', 'docs']);
  const twoLines = decideFeature(facts({ steps: [REVIEW_UX, { after: 'feature', command: '/second', agent: 'dsh' }], tasks: ALL_DONE, record: recordDone({ steps: { 'feature:0': 'PASS' } }) }));
  assert.deepEqual([twoLines.stage, twoLines.step], ['step', 1]);
});

test('points: CR-6: with a split review, the feature step starts only after the review commit, and a tab review starts it at once', () => {
  const split = { implement: 'dsh', review: 'claude' };
  const base = { steps: [REVIEW_UX], tasks: ALL_DONE, stages: split };
  const reviewDoc = (open) => ({ has: { requirements: true, implementation: true, tasks: true, context: true, inbox: true, codeReview: true }, review: parseReview(open) });
  const openDoc = reviewDoc('- [ ] CR-1: a finding\n');
  const closedDoc = reviewDoc('- [x] CR-1: a finding\n');
  const dirty = { dirty: ['src/a.js'] };
  const subject = 'fix: demo cross-phase review';

  // 1. No code-review.md: the review tab starts.
  const start = decideFeature(facts({ ...base }));
  assert.deepEqual([start.action, start.stage], ['start', 'review']);
  // 2. An open finding: the review-fix tab starts.
  const fix = decideFeature(facts({ ...base, docs: openDoc }));
  assert.deepEqual([fix.action, fix.stage], ['start', 'review-fix']);
  // 3. A closed review with a dirty tree: the review commit comes before the step.
  const commit = decideFeature(facts({ ...base, docs: closedDoc, git: dirty }));
  assert.deepEqual([commit.action, commit.point, commit.subject], ['commit', 'review', subject]);
  // 4. The step starts only after the review subject exists.
  const step = decideFeature(facts({ ...base, docs: closedDoc, git: { ...dirty, subjects: [subject] } }));
  assert.deepEqual([step.action, step.stage, step.point], ['start', 'step', 'feature']);
  const clean = decideFeature(facts({ ...base, docs: closedDoc }));
  assert.deepEqual([clean.action, clean.stage, clean.point], ['start', 'step', 'feature']);
  // 5. Tab placement (review equals implement): no review tab and no review commit. A dirty tree is the phase commit, a clean tree starts the step.
  const tabBase = { steps: [REVIEW_UX], tasks: ALL_DONE, stages: { implement: 'dsh', review: 'dsh' }, docs: closedDoc };
  const tabDirty = decideFeature(facts({ ...tabBase, git: dirty }));
  assert.deepEqual([tabDirty.action, tabDirty.point], ['commit', 'phase']);
  const tab = decideFeature(facts(tabBase));
  assert.deepEqual([tab.action, tab.stage, tab.point], ['start', 'step', 'feature']);
});

test('points: a step with after epic never runs in /orca-feature', () => {
  const action = decideFeature(facts({ steps: [EPIC_STEP], tasks: ALL_DONE }));
  assert.deepEqual([action.action, action.stage], ['start', 'docs']);
  const phases = decideFeature(facts({ steps: [EPIC_STEP] }));
  assert.deepEqual([phases.action, phases.stage, phases.phase], ['start', 'phase', 2]);
});

test('points: a step after the docs are done never starts, and a resume with a mark never repeats a step', () => {
  const done = decideFeature(facts({ steps: [REVIEW_UX], tasks: ALL_DONE, record: recordDone({ docs: true }) }));
  assert.equal(done.action, 'done');
  // A resume: the record has no active tab, and it holds the mark of the finished step.
  const resumed = decideFeature(facts({ steps: [REVIEW_UX], tasks: ALL_DONE, record: recordDone({ steps: { 'feature:0': 'PASS' } }) }));
  assert.deepEqual([resumed.action, resumed.stage], ['start', 'docs']);
});

test('points: with no steps, nothing changes', () => {
  assert.deepEqual(decideFeature(facts({ tasks: ALL_DONE })).stage, 'docs');
  assert.deepEqual(decideFeature(facts()).stage, 'phase');
});

test('points: the project command of the step agent joins the start action, and the command field stays the step command', () => {
  const config = configWith([REVIEW_UX]);
  /** @type {any} */ (config).agents = { claude: { command: 'claude-personal' } };
  const f = facts({ tasks: ALL_DONE });
  f.config = parseOrcaConfig(JSON.stringify(config));
  const action = decideFeature(f);
  assert.deepEqual([action.path, action.command, action.stepCommand], ['command', 'claude-personal', '/review-ux demo']);
  assert.ok(action.say.includes('with the project command "claude-personal"'), action.say);
});

test('points: a step agent that is not installed stops harness-missing, and a done step does not', () => {
  const stages = { implement: 'claude', plan: 'claude' };
  const stop = decideFeature(facts({ steps: [{ ...REVIEW_UX, agent: 'dsh' }], tasks: ALL_DONE, harnesses: ['claude'], stages }));
  assert.equal(stop.action, 'stop');
  assert.equal(stop.reason, 'harness-missing');
  assert.ok(stop.detail.includes('orchestration.steps[0].agent is "dsh".'), JSON.stringify(stop.detail));
  const marked = decideFeature(
    facts({ steps: [{ ...REVIEW_UX, agent: 'dsh' }], tasks: ALL_DONE, harnesses: ['claude'], stages, record: recordDone({ steps: { 'feature:0': 'PASS' } }) })
  );
  assert.deepEqual([marked.action, marked.stage], ['start', 'docs']);
});

// ---------------------------------------------------------------------------
// The decision walk: the verdicts
// ---------------------------------------------------------------------------

/**
 * @param {Record<string, any> | null} verdict The verdict fact of `feature:0`, or null for no file.
 * @param {{ sendBacks?: number }} [opts]
 * @returns {Record<string, any>}
 */
function reported(verdict, { sendBacks = 0 } = {}) {
  return decideFeature(
    facts({
      steps: [REVIEW_UX],
      tasks: ALL_DONE,
      record: stepRecord({ sendBacks }),
      worker: { state: 'done', detail: [] },
      docs: { stepVerdicts: verdict ? { 'feature:0': verdict } : {} },
    })
  );
}

test('verdicts: PASS closes the step tab', () => {
  const action = reported({ verdict: 'PASS', evidence: 'all good' });
  assert.equal(action.action, 'close');
  assert.deepEqual(action.run, ['close', '--feature', 'demo']);
  assert.deepEqual([action.stage, action.step, action.point, action.verdict], ['step', 0, 'feature', 'PASS']);
});

for (const word of ['FAIL', 'BLOCKED']) {
  test(`verdicts: ${word} asks step-failed with go on (override) and stop, and shows the evidence`, () => {
    const action = reported({ verdict: word, evidence: 'the form drops a field\nthe list is empty' });
    assert.equal(action.action, 'ask');
    assert.equal(action.reason, 'step-failed');
    assert.equal(action.verdict, word);
    assert.deepEqual(action.options.map((option) => option.key), ['stop', 'go-on']);
    assert.equal(action.recommended, 'stop');
    assert.equal(action.options[0].run, null);
    assert.deepEqual(action.options[1].run, ['close', '--feature', 'demo', '--override']);
    assert.deepEqual(action.detail, ['the form drops a field', 'the list is empty']);
    assert.ok(action.question.startsWith('[demo step feature]'), action.question);
    assert.ok(action.say.includes(word), action.say);
  });
}

test('verdicts: no verdict sends the verdict note once, then asks with the same options', () => {
  const first = reported(null);
  assert.equal(first.action, 'send');
  assert.equal(first.reason, 'missing-verdict');
  assert.deepEqual(first.run, ['send', '--feature', 'demo', '--reason', 'missing-verdict']);
  assert.equal(first.dispatchId, 'disp-1');
  assert.equal(first.open.length, 1);

  const second = reported(null, { sendBacks: 1 });
  assert.equal(second.action, 'ask');
  assert.equal(second.reason, 'step-failed');
  assert.equal(second.verdict, 'none');
  assert.deepEqual(second.options.map((option) => option.key), ['stop', 'go-on']);
  assert.deepEqual(second.options[1].run, ['close', '--feature', 'demo', '--override']);
});

test('verdicts: a verdict file with a bad line 1 reads as no verdict', () => {
  const action = reported({ verdict: null, evidence: '' });
  assert.deepEqual([action.action, action.reason], ['send', 'missing-verdict']);
});

test('verdicts: a busy step tab waits, and the failed start of a step retries with its step and phase flags', () => {
  const busy = decideFeature(facts({ steps: [PHASE_STEP], record: stepRecord({ phase: 1, point: 'phase-1', step: 0 }), worker: { state: 'busy', detail: [] } }));
  assert.equal(busy.action, 'wait');
  assert.ok(busy.say.includes('"/review-ux demo"'), busy.say);
  const failed = { stage: 'step', phase: 1, step: 0, agent: 'claude', taskId: 't', dispatchId: 'd', count: 1, code: 'x' };
  const ask = decideFeature(facts({ steps: [PHASE_STEP], record: { ...recordDone(), failedStart: failed } }));
  assert.equal(ask.reason, 'start-failed');
  assert.deepEqual(ask.options[0].run, ['start', '--feature', 'demo', '--stage', 'step', '--step', '0', '--phase', '1', '--retry']);
});

// ---------------------------------------------------------------------------
// The decision walk: the epic point and the lanes
// ---------------------------------------------------------------------------

const BUILD_ORDER = ['## Build Order / Dependencies', '', '1. **base** - first.', '2. **ux** - second.', ''].join('\n');

/**
 * One feature of the epic `editor`: complete tasks, a lane branch, and the lane keys. A merged lane is held by the epic branch.
 *
 * @param {string} name
 * @param {{ merged?: boolean, tasks?: string }} [opts]
 * @returns {any}
 */
function laneEntry(name, { merged = false, tasks = ALL_DONE } = {}) {
  return {
    name,
    path: `editor/${name}`,
    docs: {
      valid: true,
      reason: null,
      exists: true,
      isEpic: false,
      epic: 'editor',
      has: { requirements: true, implementation: true, tasks: true, context: true, inbox: true, codeReview: false },
      tasks: parseTasks(tasks),
      tasksError: null,
      review: null,
      reviewError: null,
      humanTests: [],
      inbox: [],
      inboxActionable: [],
      inboxNewRequirements: [],
      stepVerdicts: {},
    },
    record: { record: null, note: null },
    branch: `feat/editor/${name}`,
    branchExists: true,
    held: merged,
    keys: { base: 'epic/editor', epic: 'editor', feature: `editor/${name}`, merged: merged ? 'abc1234def567' : null },
    subjects: [],
  };
}

/**
 * @param {{ steps?: unknown[], features?: any[], record?: Record<string, any> | null, head?: string, worker?: Record<string, any> | null, docs?: Record<string, any>, harnesses?: string[] }} [opts]
 * @returns {import('../lib/orca/decide.js').EpicFacts}
 */
function epicFacts({ steps = [], features, record = null, head = 'epic/editor', worker = null, docs = {}, harnesses = ['claude', 'dsh'] } = {}) {
  const base = { stages: { implement: 'dsh', review: false } };
  return /** @type {any} */ ({
    epic: 'editor',
    flags: { fresh: false, wake: null, dispatch: null, stop: false, acceptDirty: false },
    terminalHandle: 'term-1',
    config: parseOrcaConfig(JSON.stringify({ version: 1, orchestration: { ...base, steps } })),
    harnesses,
    git: { workTree: true, detail: [], error: null, head, defaultBranch: 'main', epicBranchExists: true, epicBase: 'main', dirty: [] },
    epicDocs: {
      valid: true,
      reason: null,
      exists: true,
      isEpic: true,
      overviewError: null,
      folders: ['base', 'ux'],
      buildOrder: parseBuildOrder(BUILD_ORDER, ['base', 'ux']),
      humanTests: [],
      stepVerdicts: {},
      ...docs,
    },
    features: features ?? [laneEntry('base', { merged: true }), laneEntry('ux', { merged: true })],
    record: { record, note: null },
    orcaStatus: null,
    workers: worker ? { 'disp-1': worker } : {},
  });
}

test('epic point: after the last merge the epic steps run, before the epic docs tab', () => {
  const action = decideEpic(epicFacts({ steps: [EPIC_STEP] }));
  assert.equal(action.action, 'start');
  assert.deepEqual(action.run, ['start', '--epic', 'editor', '--stage', 'step', '--step', '0']);
  assert.deepEqual([action.stage, action.point, action.agent, action.feature, action.epic], ['step', 'epic', 'claude', null, 'editor']);
  assert.equal(action.stepCommand, '/review-epic editor');
  assert.ok(action.say.includes('on claude'), action.say);

  const marked = decideEpic(epicFacts({ steps: [EPIC_STEP], record: { ...newEpicRecord('editor'), done: { docs: false, steps: { 'epic:0': 'PASS' } } } }));
  assert.deepEqual([marked.action, marked.stage], ['start', 'epic-docs']);
});

test('epic point: the epic steps need HEAD on the epic branch, and they never run while a feature is left', () => {
  const off = decideEpic(epicFacts({ steps: [EPIC_STEP], head: 'main' }));
  assert.equal(off.action, 'branch');
  const left = decideEpic(epicFacts({ steps: [EPIC_STEP], features: [laneEntry('base', { merged: true }), laneEntry('ux', { tasks: tasksDoc(phaseText(1, { open: 1 })) })], head: 'feat/editor/ux' }));
  assert.notEqual(left.stage, 'step');
});

test('epic point: a step with another point in the epic list is not an epic step, and a done epic runs none', () => {
  const lineOnly = decideEpic(epicFacts({ steps: [REVIEW_UX] }));
  assert.deepEqual([lineOnly.action, lineOnly.stage], ['start', 'epic-docs']);
  const docsDone = decideEpic(epicFacts({ steps: [EPIC_STEP], record: { ...newEpicRecord('editor'), done: { docs: true, steps: {} } } }));
  assert.equal(docsDone.action, 'done');
});

test('epic point: the epic step agent must be installed', () => {
  const stop = decideEpic(epicFacts({ steps: [{ ...EPIC_STEP, agent: 'dsh' }], harnesses: ['claude'] }));
  assert.equal(stop.action, 'stop');
  assert.equal(stop.reason, 'harness-missing');
});

test('epic point: a reported epic step tab closes on PASS, and asks on FAIL, with the epic flags', () => {
  const record = (extra = {}) => ({
    ...newEpicRecord('editor'),
    active: {
      stage: 'step',
      phase: null,
      step: 0,
      point: 'epic',
      stepCommand: '/review-epic editor',
      verdictFile: '.beast-mode/briefs/editor/orca-step-epic-0.verdict.md',
      round: 0,
      agent: 'claude',
      placement: 'current',
      dispatchId: 'disp-1',
      taskId: 'task-1',
      runId: 'run-1',
      startedAt: '2026-11-18T07:10:00.000Z',
      sendBacks: 0,
      escalations: 0,
      ...extra,
    },
  });
  const done = { state: 'done', detail: [] };
  const pass = decideEpic(epicFacts({ steps: [EPIC_STEP], record: record(), worker: done, docs: { stepVerdicts: { 'epic:0': { verdict: 'PASS', evidence: '' } } } }));
  assert.equal(pass.action, 'close');
  assert.deepEqual(pass.run, ['close', '--epic', 'editor']);
  const fail = decideEpic(epicFacts({ steps: [EPIC_STEP], record: record(), worker: done, docs: { stepVerdicts: { 'epic:0': { verdict: 'FAIL', evidence: 'x' } } } }));
  assert.deepEqual([fail.action, fail.reason], ['ask', 'step-failed']);
  assert.deepEqual(fail.options[1].run, ['close', '--epic', 'editor', '--override']);
  const missing = decideEpic(epicFacts({ steps: [EPIC_STEP], record: record(), worker: done }));
  assert.deepEqual([missing.action, missing.reason], ['send', 'missing-verdict']);
  assert.deepEqual(missing.run, ['send', '--epic', 'editor', '--reason', 'missing-verdict']);
});

test('lanes: a feature step runs in each lane, with the epic flags in its step line', () => {
  const action = decideEpic(
    epicFacts({
      steps: [REVIEW_UX],
      head: 'feat/editor/base',
      features: [laneEntry('base'), laneEntry('ux', { tasks: tasksDoc(phaseText(1, { open: 1 })) })],
    })
  );
  assert.equal(action.action, 'start', JSON.stringify(action));
  assert.deepEqual(action.run, ['start', '--feature', 'editor/base', '--epic', 'editor', '--stage', 'step', '--step', '0']);
  assert.equal(action.stepCommand, '/review-ux editor/base');
});

// ---------------------------------------------------------------------------
// The steps, over a temporary git project with a fake Orca
// ---------------------------------------------------------------------------

/**
 * @param {Record<string, string | undefined>} [extra]
 * @returns {Record<string, string | undefined>}
 */
function testEnv(extra = {}) {
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CEILING_DIRECTORIES: os.tmpdir(),
    ORCA_TERMINAL_HANDLE: 'term-test',
    ORCA_CLI_COMMAND: FAKE_ORCA,
    WSL_DISTRO_NAME: '', // host-independent: a WSL test host must not translate spec paths (issue #10)
    ...extra,
  };
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_COMMON_DIR']) {
    delete env[key];
  }
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
 * A temporary project with both harnesses, the settings, the feature `demo`,
 * the epic `editor`, and a git repository on the branch `branch`.
 *
 * @param {{ tasks?: string, config?: Record<string, any>, branch?: string }} [opts]
 * @returns {string}
 */
function makeProject({ tasks = ALL_DONE, config = configWith([REVIEW_UX]), branch = 'feat/demo' } = {}) {
  const root = createTempProjectRoot();
  for (const id of ['claude', 'dsh']) {
    const dir = path.join(root, ...adapters[id].harnessRoot.split('/'));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '.beast-mode-manifest.json'), '{}\n');
  }
  fs.mkdirSync(path.join(root, '.beast-mode'), { recursive: true });
  fs.writeFileSync(path.join(root, '.beast-mode', 'orca.json'), `${JSON.stringify(config, null, 2)}\n`);
  const feature = path.join(root, 'docs', 'features', 'demo');
  fs.mkdirSync(feature, { recursive: true });
  fs.writeFileSync(path.join(feature, 'implementation.md'), '# Demo - Implementation Plan\n');
  fs.writeFileSync(path.join(feature, 'tasks.md'), tasks);
  const epic = path.join(root, 'docs', 'features', 'editor');
  fs.mkdirSync(path.join(epic, 'base'), { recursive: true });
  fs.writeFileSync(path.join(epic, 'epic-overview.md'), `# Editor - Epic Overview\n\n${BUILD_ORDER}`);
  fs.writeFileSync(path.join(epic, 'base', 'tasks.md'), ALL_DONE);
  gitIn(root, ['init', '-q']);
  gitIn(root, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
  gitIn(root, ['config', 'user.name', 'Orca Test']);
  gitIn(root, ['config', 'user.email', 'orca-test@example.invalid']);
  gitIn(root, ['config', 'commit.gpgsign', 'false']);
  gitIn(root, ['add', '-A']);
  gitIn(root, ['commit', '-q', '-m', 'init']);
  gitIn(root, ['switch', '-q', '-c', branch]);
  return root;
}

/**
 * @param {unknown} result
 * @returns {import('../lib/orca/steps.js').RunResult}
 */
function envelope(result) {
  return { status: 0, signal: null, stdout: `${JSON.stringify({ ok: true, result })}\n`, stderr: '', error: null };
}

/**
 * A runner that answers each Orca call from `answers` by its verb, and runs git for real.
 *
 * @param {Record<string, import('../lib/orca/steps.js').RunResult>} answers
 */
function fakeRunner(answers) {
  /** @type {string[][]} */
  const orca = [];
  /** @type {import('../lib/orca/steps.js').Runner} */
  const runner = (command, args, options) => {
    if (command === 'git') return defaultRunner(command, args, options);
    assert.equal(command, FAKE_ORCA, `the runner got the unexpected command ${command}`);
    orca.push([...args]);
    const verb = args[0] === 'orchestration' ? args[1] : args[0];
    assert.ok(answers[verb], `no fake Orca answer for: ${args.join(' ')}`);
    return answers[verb];
  };
  return { runner, orca };
}

const ORCA_ANSWERS = {
  status: envelope({ app: { running: true, pid: 1 }, runtime: { state: 'ready', reachable: true }, graph: {} }),
  'worker-start': envelope({ runId: 'run-1', taskId: 'task-1', dispatchId: 'disp-1', state: 'ready' }),
  'worker-show': envelope({ dispatchId: 'disp-1', state: 'ready', stage: 'turn', liveness: 'live', activity: 'working' }),
  'worker-release': envelope({ dispatchId: 'disp-1', state: 'already_released', processAction: 'none' }),
};

/**
 * @param {string} root
 * @param {string[]} args
 * @param {{ runner?: import('../lib/orca/steps.js').Runner }} [opts]
 * @returns {{ code: number, json: Record<string, any> }}
 */
function orcaStep(root, args, { runner = fakeRunner(ORCA_ANSWERS).runner } = {}) {
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
  const lines = out.split('\n').filter((line) => line.length > 0);
  assert.equal(lines.length, 1, `one JSON object per call, got: ${out}`);
  const json = JSON.parse(lines[0]);
  assert.equal(json.schema, 1);
  return { code, json };
}

/**
 * @param {string} root
 * @param {string} name A file in the briefs folder of `demo`.
 * @param {string} body
 */
function writeBrief(root, name, body) {
  const dir = path.join(root, '.beast-mode', 'briefs', 'demo');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), body);
}

test('start: a feature step writes its spec, drops the old verdict, and records the tab with its point', { skip: NO_GIT }, () => {
  const root = makeProject();
  try {
    writeBrief(root, 'orca-step-feature-0.verdict.md', 'PASS\nthe verdict of an earlier tab');
    const fake = fakeRunner(ORCA_ANSWERS);
    const { code, json } = orcaStep(root, ['start', '--feature', 'demo', '--stage', 'step', '--step', '0'], { runner: fake.runner });
    assert.equal(code, 0);
    assert.deepEqual([json.ok, json.stage, json.agent, json.dispatchId], [true, 'step', 'claude', 'disp-1']);
    assert.equal(json.spec, '.beast-mode/briefs/demo/orca-step-feature-0.md');
    const spec = fs.readFileSync(path.join(root, '.beast-mode', 'briefs', 'demo', 'orca-step-feature-0.md'), 'utf8');
    assert.ok(spec.includes('`/review-ux demo`'));
    assert.ok(spec.includes('`.beast-mode/briefs/demo/orca-step-feature-0.verdict.md`'));
    assert.equal(fs.existsSync(path.join(root, '.beast-mode', 'briefs', 'demo', 'orca-step-feature-0.verdict.md')), false, 'the old verdict is gone');
    const start = fake.orca.find((args) => args.includes('worker-start'));
    assert.ok(start?.includes('claude'), 'the tab runs on the agent of the line');
    const { active } = /** @type {any} */ (readRecord(root, 'demo').record);
    assert.deepEqual(
      [active.stage, active.step, active.point, active.stepCommand, active.phase],
      ['step', 0, 'feature', '/review-ux demo', null]
    );
    assert.equal(active.verdictFile, '.beast-mode/briefs/demo/orca-step-feature-0.verdict.md');
  } finally {
    removeFixture(root);
  }
});

test('start: a step refuses a missing line, an epic line, a step that ran, and an open phase', { skip: NO_GIT }, () => {
  const root = makeProject({
    tasks: TWO_PHASES_ONE_DONE,
    config: configWith([REVIEW_UX, EPIC_STEP, PHASE_STEP]),
  });
  try {
    const start = (...rest) => orcaStep(root, ['start', '--feature', 'demo', '--stage', 'step', ...rest]).json;
    assert.equal(start('--step', '9').code, 'step-missing');
    assert.equal(start('--step', '1').code, 'step-after-epic');
    assert.equal(start('--step', '0').code, 'phase-incomplete', 'a feature step waits for every phase');
    assert.equal(start('--step', '2', '--phase', '2').code, 'phase-incomplete');
    assert.equal(start('--step', '2', '--phase', '7').code, 'phase-missing');
    writeRecord(root, 'demo', { ...newRecord('demo'), done: { docs: false, steps: { 'phase-1:2': 'PASS' } } });
    assert.equal(start('--step', '2', '--phase', '1').code, 'step-done');
    assert.throws(() => start(), UsageError);
    assert.throws(() => start('--step', 'x'), UsageError);
  } finally {
    removeFixture(root);
  }
});

test('close: PASS marks the step, FAIL refuses, and --override marks overridden with the tab released', { skip: NO_GIT }, () => {
  const root = makeProject();
  try {
    const run = (args) => orcaStep(root, args).json;
    assert.equal(run(['start', '--feature', 'demo', '--stage', 'step', '--step', '0']).ok, true);

    // No verdict file, then a FAIL verdict: a plain close refuses, and the tab stays in the record.
    let json = run(['close', '--feature', 'demo']);
    assert.deepEqual([json.ok, json.code], [false, 'step-not-passed']);
    writeBrief(root, 'orca-step-feature-0.verdict.md', 'FAIL\nthe form drops a field');
    json = run(['close', '--feature', 'demo']);
    assert.deepEqual([json.ok, json.code], [false, 'step-not-passed']);
    assert.ok(json.detail.includes('The verdict file reads FAIL.'), JSON.stringify(json.detail));
    assert.equal(/** @type {any} */ (readRecord(root, 'demo').record).active.dispatchId, 'disp-1');

    // The override closes the tab and records the result.
    json = run(['close', '--feature', 'demo', '--override']);
    assert.equal(json.ok, true, JSON.stringify(json));
    assert.deepEqual(json.stepResult, { key: 'feature:0', mark: 'overridden' });
    const record = /** @type {any} */ (readRecord(root, 'demo').record);
    assert.equal(record.active, null);
    assert.deepEqual(record.done.steps, { 'feature:0': 'overridden' });

    // The mark ends the point: next goes on to the docs, and a second start refuses.
    const next = orcaStep(root, ['next', '--feature', 'demo']).json;
    assert.deepEqual([next.action, next.stage], ['start', 'docs']);
    assert.equal(run(['start', '--feature', 'demo', '--stage', 'step', '--step', '0']).code, 'step-done');
  } finally {
    removeFixture(root);
  }
});

test('close: a PASS verdict records PASS with no override, and --discard records nothing', { skip: NO_GIT }, () => {
  const root = makeProject();
  try {
    const run = (args) => orcaStep(root, args).json;
    run(['start', '--feature', 'demo', '--stage', 'step', '--step', '0']);
    run(['close', '--feature', 'demo', '--discard']);
    assert.deepEqual(/** @type {any} */ (readRecord(root, 'demo').record).done.steps, {});

    run(['start', '--feature', 'demo', '--stage', 'step', '--step', '0']);
    writeBrief(root, 'orca-step-feature-0.verdict.md', 'PASS\nall good');
    const reported = fakeRunner({ ...ORCA_ANSWERS, 'worker-show': envelope({ dispatch: { status: 'completed' } }) });
    const next = orcaStep(root, ['next', '--feature', 'demo'], { runner: reported.runner }).json;
    assert.equal(next.action, 'close', 'a PASS verdict closes the done tab');
    assert.equal(next.verdict, 'PASS');
    const json = run(['close', '--feature', 'demo']);
    assert.deepEqual(json.stepResult, { key: 'feature:0', mark: 'PASS' });
    assert.deepEqual(/** @type {any} */ (readRecord(root, 'demo').record).done.steps, { 'feature:0': 'PASS' });
  } finally {
    removeFixture(root);
  }
});

test('close: a phase step keeps its mark when the next phase starts, and new work clears the feature marks', { skip: NO_GIT }, () => {
  const root = makeProject({ tasks: TWO_PHASES_ONE_DONE, config: configWith([PHASE_STEP, REVIEW_UX]) });
  try {
    const run = (args) => orcaStep(root, args).json;
    let json = run(['start', '--feature', 'demo', '--stage', 'step', '--step', '0', '--phase', '1']);
    assert.equal(json.ok, true, JSON.stringify(json));
    assert.equal(json.spec, '.beast-mode/briefs/demo/orca-step-phase-1-0.md');
    writeBrief(root, 'orca-step-phase-1-0.verdict.md', 'PASS');
    json = run(['close', '--feature', 'demo']);
    assert.deepEqual(json.stepResult, { key: 'phase-1:0', mark: 'PASS' });

    // A feature mark that an earlier run left: the start of Phase 2 clears it, and keeps the phase mark.
    const record = /** @type {any} */ (readRecord(root, 'demo').record);
    writeRecord(root, 'demo', { ...record, done: { ...record.done, steps: { ...record.done.steps, 'feature:1': 'PASS' } } });
    json = run(['start', '--feature', 'demo', '--stage', 'phase', '--phase', '2']);
    assert.equal(json.ok, true, JSON.stringify(json));
    assert.deepEqual(/** @type {any} */ (readRecord(root, 'demo').record).done.steps, { 'phase-1:0': 'PASS' });
  } finally {
    removeFixture(root);
  }
});

test('epic start and close: an epic step tab runs on the epic branch, and its close writes the epic record', { skip: NO_GIT }, () => {
  const root = makeProject({ config: configWith([REVIEW_UX, EPIC_STEP]), branch: 'epic/editor' });
  try {
    const run = (args) => orcaStep(root, args).json;
    assert.equal(run(['start', '--epic', 'editor', '--stage', 'step', '--step', '0']).code, 'step-not-epic');
    assert.equal(run(['start', '--epic', 'editor', '--stage', 'step', '--step', '5']).code, 'step-missing');

    const started = run(['start', '--epic', 'editor', '--stage', 'step', '--step', '1']);
    assert.equal(started.ok, true, JSON.stringify(started));
    assert.deepEqual([started.stage, started.agent, started.spec], ['step', 'claude', '.beast-mode/briefs/editor/orca-step-epic-1.md']);
    const spec = fs.readFileSync(path.join(root, '.beast-mode', 'briefs', 'editor', 'orca-step-epic-1.md'), 'utf8');
    assert.ok(spec.includes('`/review-epic editor`'));
    const active = /** @type {any} */ (readEpicRecord(root, 'editor').record).active;
    assert.deepEqual([active.stage, active.step, active.point], ['step', 1, 'epic']);

    // No verdict: a plain close refuses. A PASS verdict closes with the mark.
    assert.equal(run(['close', '--epic', 'editor']).code, 'step-not-passed');
    fs.writeFileSync(path.join(root, '.beast-mode', 'briefs', 'editor', 'orca-step-epic-1.verdict.md'), 'PASS\nthe epic is whole');
    const closed = run(['close', '--epic', 'editor']);
    assert.deepEqual(closed.stepResult, { key: 'epic:1', mark: 'PASS' });
    const record = /** @type {any} */ (readEpicRecord(root, 'editor').record);
    assert.deepEqual([record.active, record.done.steps], [null, { 'epic:1': 'PASS' }]);
    assert.equal(run(['start', '--epic', 'editor', '--stage', 'step', '--step', '1']).code, 'step-done');
  } finally {
    removeFixture(root);
  }
});

// ---------------------------------------------------------------------------
// detect: the project skills and the edited autorun skills
// ---------------------------------------------------------------------------

/**
 * @param {string} text
 * @returns {string}
 */
function sha(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

/**
 * Write a claude install by hand: the shipped `autorun-feature` skill and its manifest entry,
 * a shipped skill with no manifest entry, a skill that only the manifest names, and one project skill.
 *
 * @param {string} root
 * @returns {{ file: string, original: string }}
 */
function installClaude(root) {
  const skills = path.join(root, '.claude', 'skills');
  const original = fs.readFileSync(path.join(PLUGIN_ROOT, 'templates', 'skills', 'autorun-feature', 'SKILL.md'), 'utf8');
  const file = path.join(skills, 'autorun-feature', 'SKILL.md');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, original);
  fs.mkdirSync(path.join(skills, 'plan-feature'), { recursive: true });
  fs.writeFileSync(path.join(skills, 'plan-feature', 'SKILL.md'), '---\nname: plan-feature\ndescription: shipped\n---\n');
  fs.mkdirSync(path.join(skills, 'retired-skill'), { recursive: true });
  fs.writeFileSync(path.join(skills, 'retired-skill', 'SKILL.md'), '---\nname: retired-skill\ndescription: a skill the plugin stopped shipping\n---\n');
  fs.mkdirSync(path.join(skills, 'ship-check'), { recursive: true });
  fs.writeFileSync(path.join(skills, 'ship-check', 'SKILL.md'), '---\nname: ship-check\ndescription: Review the UX of a feature.\n---\n\n# Ship check\n');
  fs.mkdirSync(path.join(skills, 'notes-only'), { recursive: true });
  fs.writeFileSync(path.join(skills, 'notes-only', 'readme.txt'), 'no SKILL.md here');
  const manifest = {
    schema: 1,
    beastModeVersion: '6.1.1',
    harness: 'claude',
    harnessRoot: '.claude',
    generated: NOW.toISOString(),
    files: [
      { destination: '.claude/skills/autorun-feature/SKILL.md', source: 'templates/skills/autorun-feature/SKILL.md', sha256: sha(original), owned: true },
      { destination: '.claude/skills/retired-skill/SKILL.md', source: 'templates/skills/retired-skill/SKILL.md', sha256: sha('x'), owned: true },
    ],
  };
  fs.writeFileSync(path.join(root, '.claude', '.beast-mode-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return { file, original };
}

test('detect: lists a project skill with its description, and not a shipped, a retired, or a non-skill folder', () => {
  const root = createTempProjectRoot();
  try {
    installClaude(root);
    const { code, json } = orcaStep(root, ['detect']);
    assert.equal(code, 0);
    assert.deepEqual(json.projectSkills, [
      { harness: 'claude', name: 'ship-check', description: 'Review the UX of a feature.', path: '.claude/skills/ship-check/SKILL.md' },
    ]);
    assert.deepEqual(json.editedAutoruns, [], 'an autorun skill that matches its manifest hash is not edited');
  } finally {
    removeFixture(root);
  }
});

test('detect: an edited autorun skill lists the lines that the plugin source does not hold', () => {
  const root = createTempProjectRoot();
  try {
    const { file, original } = installClaude(root);
    const added = ['- After each phase, run /review-ux {feature}.', '- Before the docs, run /lint-all.'];
    fs.writeFileSync(file, `${original.trimEnd()}\n\n${added.join('\n')}\n`);
    const { json } = orcaStep(root, ['detect']);
    assert.equal(json.editedAutoruns.length, 1);
    assert.deepEqual(json.editedAutoruns[0], {
      harness: 'claude',
      skill: 'autorun-feature',
      path: '.claude/skills/autorun-feature/SKILL.md',
      sourceFound: true,
      added,
      more: 0,
    });
  } finally {
    removeFixture(root);
  }
});

test('detect: an edit that removes a line lists no added line, a file with no manifest lists none, and detect writes nothing', () => {
  const root = createTempProjectRoot();
  try {
    const { file, original } = installClaude(root);
    fs.writeFileSync(file, original.split('\n').slice(1).join('\n'));
    const removed = orcaStep(root, ['detect']).json.editedAutoruns;
    assert.equal(removed.length, 1);
    assert.deepEqual(removed[0].added, []);

    const before = fs.readFileSync(file, 'utf8');
    fs.rmSync(path.join(root, '.claude', '.beast-mode-manifest.json'));
    assert.deepEqual(orcaStep(root, ['detect']).json.editedAutoruns, []);
    assert.equal(fs.readFileSync(file, 'utf8'), before);
  } finally {
    removeFixture(root);
  }
});

test('detect: a description that the scalar parser refuses still reads from its first description line', () => {
  const root = createTempProjectRoot();
  try {
    installClaude(root);
    fs.writeFileSync(
      path.join(root, '.claude', 'skills', 'ship-check', 'SKILL.md'),
      '---\nname: ship-check\ndescription: "Review the UX."\nmetadata:\n  nested: value\n---\n'
    );
    assert.equal(orcaStep(root, ['detect']).json.projectSkills[0].description, 'Review the UX.');
  } finally {
    removeFixture(root);
  }
});

// ---------------------------------------------------------------------------
// Fix 7: wakes that Orca never delivered to the coordinator
// ---------------------------------------------------------------------------

/**
 * The `inbox --full` answer of the Run mailbox: one worker_done of `disp-1`
 * that Orca never delivered, sent five minutes before NOW.
 *
 * @param {Record<string, any>} [patch]
 * @returns {import('../lib/orca/exec.js').RunResult}
 */
function lostReport(patch = {}) {
  return envelope({
    messages: [
      {
        id: 'msg_lost',
        to_handle: 'run:run-1',
        type: 'worker_done',
        subject: 'PASS',
        read: 1,
        created_at: new Date(NOW.getTime() - 5 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
        delivered_at: null,
        payload: JSON.stringify({ taskId: 'task-1', dispatchId: 'disp-1', outcome: 'succeeded' }),
        ...patch,
      },
    ],
    count: 1,
  });
}

const IDLE_SHOW = envelope({ dispatchId: 'disp-1', state: 'ready', stage: 'turn', liveness: 'live', activity: 'idle' });

test('fix 7: a claude step tab whose worker_done never reached the coordinator closes on a timer wake, and every wait names the timer', { skip: NO_GIT }, () => {
  const root = makeProject();
  try {
    orcaStep(root, ['start', '--feature', 'demo', '--stage', 'step', '--step', '0']);
    writeBrief(root, 'orca-step-feature-0.verdict.md', 'PASS\nall good');
    const fake = fakeRunner({ ...ORCA_ANSWERS, 'worker-show': IDLE_SHOW, inbox: lostReport() });

    // The wake never came. The wait on the claude tab names the backstop timer.
    const wait = orcaStep(root, ['next', '--feature', 'demo'], { runner: fake.runner }).json;
    assert.equal(wait.action, 'wait');
    assert.equal(wait.timer.seconds, 600);
    assert.match(wait.timer.run, / orca next --feature demo --wake timer --project /);
    assert.ok(!fake.orca.some((args) => args[1] === 'inbox' && args[2] === '--terminal' && args[3] === 'run:run-1'), 'only a timer wake or a fresh call reads the Run mailbox');
    // Fix 9: the run mail read for an open question is a different read, and an idle tab makes it on any call.
    assert.ok(fake.orca.some((args) => args[1] === 'inbox' && args[2] === '--run' && args[3] === 'run-1'), 'an idle tab reads the run mail for a question');

    // The timer wake finds the lost worker_done in the Run mailbox and accepts the report.
    const json = orcaStep(root, ['next', '--feature', 'demo', '--wake', 'timer'], { runner: fake.runner }).json;
    assert.equal(json.action, 'close', JSON.stringify(json));
    assert.equal(json.verdict, 'PASS');
    assert.deepEqual(fake.orca.at(-2), ['orchestration', 'inbox', '--terminal', 'run:run-1', '--limit', '50', '--full', '--json']);
    // The lost worker_done makes the tab done before a question counts, so no run mail read follows (fix 7, then fix 9).
    assert.deepEqual(fake.orca.at(-1).slice(0, 2), ['orchestration', 'worker-show']);
    assert.ok(!fake.orca.some((args) => args[1] === 'check'), 'the read marks nothing');

    // A delivered message, a message for another dispatch, and a young message are no lost wake.
    for (const patch of [
      { delivered_at: NOW.toISOString() },
      { payload: JSON.stringify({ dispatchId: 'disp-9' }) },
      { created_at: new Date(NOW.getTime() - 30 * 1000).toISOString() },
    ]) {
      const other = fakeRunner({ ...ORCA_ANSWERS, 'worker-show': IDLE_SHOW, inbox: lostReport(patch) });
      assert.notEqual(orcaStep(root, ['next', '--feature', 'demo', '--wake', 'timer'], { runner: other.runner }).json.action, 'close', JSON.stringify(patch));
    }

    // Orca lost the message entirely, and the worker is settled: the timer wake closes from the state alone.
    const settled = fakeRunner({ ...ORCA_ANSWERS, 'worker-show': envelope({ dispatchId: 'disp-1', state: 'succeeded', stage: 'settled' }) });
    assert.equal(orcaStep(root, ['next', '--feature', 'demo', '--wake', 'timer'], { runner: settled.runner }).json.action, 'close');
  } finally {
    removeFixture(root);
  }
});

test('fix 7: a failed read of the Run mailbox is no wake: a busy tab waits, with the timer', { skip: NO_GIT }, () => {
  const root = makeProject();
  try {
    orcaStep(root, ['start', '--feature', 'demo', '--stage', 'step', '--step', '0']);
    // No fake answer for inbox: the read fails.
    const fake = fakeRunner({ ...ORCA_ANSWERS });
    const json = orcaStep(root, ['next', '--feature', 'demo', '--wake', 'timer'], { runner: fake.runner }).json;
    assert.equal(json.action, 'wait', JSON.stringify(json));
    assert.equal(json.timer.seconds, 600);
    assert.ok(fake.orca.some((args) => args[1] === 'inbox'), 'the read was tried');
    // An Orca error answer reads the same way.
    const failed = fakeRunner({ ...ORCA_ANSWERS, inbox: { status: 1, signal: null, stdout: '', stderr: 'boom', error: null } });
    assert.equal(orcaStep(root, ['next', '--feature', 'demo', '--wake', 'timer'], { runner: failed.runner }).json.action, 'wait');
  } finally {
    removeFixture(root);
  }
});

test('fix 7: a lost escalation counts as the escalation wake of its tab, once', () => {
  const lost = (createdAt, stopReason = null) => [{ id: 'msg_e', kind: 'escalation', dispatch: 'disp-1', stopReason, createdAt }];
  const base = facts({ steps: [], tasks: TWO_PHASES_ONE_DONE, worker: { state: 'idle', detail: [] } });
  const phaseRecord = (active = {}) => ({
    ...newRecord('demo'),
    active: { stage: 'phase', phase: 2, step: null, round: 0, agent: 'claude', placement: 'current', dispatchId: 'disp-1', taskId: 'task-1', runId: 'run-1', startedAt: '2026-11-18T06:00:00.000Z', sendBacks: 0, escalations: 0, ...active },
  });
  const with_ = (record, mailWakes) => ({ ...base, flags: { ...base.flags, mailWakes }, record: { record, note: null } });
  // No wake: an idle tab waits. A lost escalation for it: the resume send.
  assert.equal(decideFeature(with_(phaseRecord(), [])).action, 'wait');
  const send = decideFeature(with_(phaseRecord(), lost('2026-11-18T07:00:00.000Z')));
  assert.deepEqual([send.action, send.reason], ['send', 'escalation']);
  // Answered by a later send: no second send from the same message.
  assert.equal(decideFeature(with_(phaseRecord({ escalationAt: '2026-11-18T07:05:00.000Z' }), lost('2026-11-18T07:00:00.000Z'))).action, 'wait');
  // A lost escalation of another tab does not count.
  assert.equal(decideFeature(with_(phaseRecord(), [{ ...lost('2026-11-18T07:00:00.000Z')[0], dispatch: 'disp-9' }])).action, 'wait');
});
