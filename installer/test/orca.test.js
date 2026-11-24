// installer/test/orca.test.js
//
// The suite of `beast-mode orca` (Phases 1 to 3): the config table, the
// doc parses, the run record, the decision table, the worker specs, the
// tables of exec.js, the steps and the stage walks over a temporary project
// with a fake runner, the resume and note tests, and the static test. No
// test starts a real Orca CLI: every Orca call reaches the fake runner, and
// a retry waits on a fake sleep. Git runs for real, in temporary
// repositories only, with the global and system git config switched off.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { adapters } from '../adapters/index.js';
import { main } from '../bin/beast-mode.js';
import { UsageError } from '../lib/errors.js';
import { findPluginRoot } from '../lib/source.js';
import {
  ORCA_JSON_MAX_BYTES,
  checkFeaturePath,
  inboxFromTemplate,
  inboxLine,
  insertInboxLine,
  isCustomCommand,
  isPhaseComplete,
  isPhaseNumber,
  newRecord,
  parseHumanTests,
  parseInbox,
  parseOrcaConfig,
  parseReview,
  parseTasks,
  readFeatureDocs,
  readOrcaConfig,
  readRecord,
  recordPath,
  writeFileAtomic,
  writeRecord,
} from '../lib/orca/read.js';
import {
  DSH_TIMER_SECONDS,
  DSH_WAIT_SAY,
  ESCALATION_CAP,
  RESUME_QUIET_MS,
  SEND_BACK_CAP,
  STALE_TURN_MS,
  START_FAILURE_CAP,
  UNDELIVERED_MAIL_MS,
  decideFeature,
  escalationsOf,
  reviewPlacement,
  sendCounts,
  wantsDshChild,
  wantsOpenQuestions,
  wantsPendingMail,
} from '../lib/orca/decide.js';
import {
  DSH_CHILD_ACTIVE_MS,
  dshChildFact,
  dshProjectKey,
  dshSegment,
  readDshChild,
  resolveDshHome,
  showWorkspace,
  wrapperHome,
} from '../lib/orca/dsh.js';
import {
  docsSpec,
  fixSpec,
  inboxSpec,
  noteText,
  phaseSpec,
  planSpec,
  reviewFixSpec,
  reviewSpec,
  sendText,
  taskTitleOf,
  verifySpec,
} from '../lib/orca/spec.js';
import {
  MAX_REPLY_BYTES,
  SUBMIT_DELAY_MS,
  SUBMIT_MAX_ENTERS,
  SUBMIT_UNCONFIRMED_SAY,
  SUBMIT_WINDOW_MS,
  quoteArg,
  renderAction,
  runLine,
  runOrca,
} from '../lib/orca/steps.js';
import {
  BRIEFS_EXCLUDE,
  BRIEFS_GLOB_EXCLUDE,
  RETRY_DELAY_MS,
  bodyArgs,
  call,
  defaultRunner,
  gitCalls,
  normalizeWorker,
  openQuestions,
  orcaCalls,
  parseEnvelope,
  parsePorcelain,
  receiptTerminal,
  resolveOrcaExecutable,
  sleepSync,
  turnQuietMs,
  turnStartOf,
  undeliveredMail,
} from '../lib/orca/exec.js';
import { createTempProjectRoot, removeFixture } from './helpers.js';

const PLUGIN_ROOT = findPluginRoot(import.meta.dirname);
const BIN = path.join(PLUGIN_ROOT, 'installer', 'bin', 'beast-mode.js');
const NODE = '/usr/bin/node';
const FAKE_ORCA = 'fake-orca';
const NOW = new Date('2026-11-18T07:10:00.000Z');
const ACTIONS = ['branch', 'start', 'wait', 'send', 'close', 'commit', 'merge', 'ask', 'question', 'stop', 'done'];
const DEFAULT_CONFIG = { version: 1, orchestration: { stages: { implement: 'dsh' } } };

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

/**
 * One `## Phase <n>` section of a tasks.md text.
 *
 * @param {number} number
 * @param {{ done?: number, open?: number, demo?: string | null, name?: string }} [opts]
 * @returns {string}
 */
function phaseText(number, { done = 0, open = 0, demo = null, name = `Slice ${number}` } = {}) {
  const lines = [`## Phase ${number}: ${name} (${done}/${done + open} complete)`, ''];
  if (demo) lines.push(`**Demo:** ${demo}`, '**Needs:** none', '');
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
  return ['# Demo - Task Checklist', '', '**Progress:** 0/0', '', '---', '', ...phases, '## Bugs & Issues', '', '- [ ] a bug that never counts', ''].join('\n');
}

/**
 * A fact set where every check passes: an Orca tab, a valid config, both
 * harnesses, the run branch checked out, no record, and two open phases.
 *
 * @param {Record<string, any>} [patch] Top-level keys replace. `flags`, `git`, `docs`, and `docs.has` merge one level.
 * @returns {import('../lib/orca/decide.js').FeatureFacts}
 */
function facts(patch = {}) {
  const base = {
    feature: 'demo',
    flags: { fresh: false, wake: null, dispatch: null, stop: false, acceptDirty: false },
    terminalHandle: 'term-1',
    config: parseOrcaConfig(JSON.stringify(DEFAULT_CONFIG)),
    harnesses: ['claude', 'dsh'],
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
    },
    docs: {
      valid: true,
      reason: null,
      exists: true,
      isEpic: false,
      epic: null,
      has: { requirements: true, implementation: true, tasks: true, context: true, inbox: true, codeReview: false },
      tasks: parseTasks(tasksDoc(phaseText(1, { open: 2, demo: 'the page shows one row' }), phaseText(2, { open: 1 }))),
      tasksError: null,
      review: null,
      reviewError: null,
      humanTests: [],
      inbox: [],
      inboxActionable: [],
      inboxNewRequirements: [],
    },
    record: { record: null, note: null },
    orcaStatus: null,
    worker: null,
  };
  const out = { ...base, ...patch };
  for (const key of ['flags', 'git', 'docs']) {
    if (patch[key]) out[key] = { ...base[key], ...patch[key] };
  }
  if (patch.docs?.has) out.docs.has = { ...base.docs.has, ...patch.docs.has };
  return /** @type {any} */ (out);
}

/**
 * @param {Record<string, any>} [active]
 * @param {Record<string, any>} [extra]
 * @returns {{ record: Record<string, any>, note: null }}
 */
function recordWith(active = {}, extra = {}) {
  return {
    record: {
      ...newRecord('demo'),
      active: {
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
        ...active,
      },
      ...extra,
    },
    note: null,
  };
}

/** The docs patch of a feature whose Phase 1 is complete and Phase 2 open. */
function phaseOneComplete(demo = 'the page shows one row') {
  return { tasks: parseTasks(tasksDoc(phaseText(1, { done: 2, demo }), phaseText(2, { open: 1 }))) };
}

/**
 * Assert the shape that every action of `next` shares.
 *
 * @param {Record<string, any>} action
 * @param {string} kind
 * @returns {Record<string, any>}
 */
function assertAction(action, kind) {
  assert.equal(action.schema, 1);
  assert.ok(ACTIONS.includes(action.action), `"${action.action}" is not an action`);
  assert.equal(action.action, kind, JSON.stringify(action));
  assert.equal(typeof action.say, 'string');
  assert.ok(action.say.length > 0);
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
// The config table
// ---------------------------------------------------------------------------

const CONFIG_CASES = [
  {
    name: 'a text over the cap in characters',
    text: `{"version":1,"x":"${'a'.repeat(ORCA_JSON_MAX_BYTES)}"}`,
    problems: [{ code: 'config-too-large', at: '$' }],
  },
  {
    name: 'a text under the cap in characters and over it in bytes',
    text: `{"version":1,"x":"${'é'.repeat(40000)}"}`,
    problems: [{ code: 'config-too-large', at: '$' }],
  },
  { name: 'a text that is not JSON', text: '{"version":1,', problems: [{ code: 'not-json', at: '$' }] },
  { name: 'an array', text: '[]', problems: [{ code: 'not-object', at: '$' }] },
  { name: 'null', text: 'null', problems: [{ code: 'not-object', at: '$' }] },
  { name: 'a string', text: '"orca"', problems: [{ code: 'not-object', at: '$' }] },
  { name: 'version 2', text: '{"version":2,"orchestration":{}}', problems: [{ code: 'version', at: '$.version' }] },
  { name: 'no version', text: '{"orchestration":{}}', problems: [{ code: 'version', at: '$.version' }] },
  {
    name: 'an orchestration array',
    text: '{"version":1,"orchestration":[]}',
    problems: [{ code: 'orchestration-not-object', at: '$.orchestration' }],
  },
  {
    name: 'an orchestration null',
    text: '{"version":1,"orchestration":null}',
    problems: [{ code: 'orchestration-not-object', at: '$.orchestration' }],
  },
  {
    name: 'an implement agent that is not claude or dsh',
    text: '{"version":1,"orchestration":{"stages":{"implement":"codex"}}}',
    problems: [{ code: 'stage-agent', at: '$.orchestration.stages.implement' }],
  },
  {
    name: 'an implement agent of null',
    text: '{"version":1,"orchestration":{"stages":{"implement":null}}}',
    problems: [{ code: 'stage-agent', at: '$.orchestration.stages.implement' }],
  },
  {
    name: 'two problems at once',
    text: '{"version":3,"orchestration":"phase"}',
    problems: [
      { code: 'version', at: '$.version' },
      { code: 'orchestration-not-object', at: '$.orchestration' },
    ],
  },
];

for (const { name, text, problems } of CONFIG_CASES) {
  test(`config: ${name} answers ${problems.map((p) => p.code).join(' and ')}`, () => {
    assert.deepEqual(parseOrcaConfig(text), { state: 'invalid', problems });
  });
}

test('config: a text of exactly 64 KiB passes the cap', () => {
  const head = '{"version":1,"x":"';
  const tail = '"}';
  const text = `${head}${'a'.repeat(ORCA_JSON_MAX_BYTES - head.length - tail.length)}${tail}`;
  assert.equal(Buffer.byteLength(text, 'utf8'), ORCA_JSON_MAX_BYTES);
  assert.equal(parseOrcaConfig(text).state, 'valid');
});

test('config: the defaults fill every key, and verify and docs follow implement', () => {
  const empty = parseOrcaConfig('{"version":1,"orchestration":{}}');
  assert.equal(empty.state, 'valid');
  assert.deepEqual(empty.orchestration, {
    stages: { plan: 'claude', implement: 'dsh', verify: 'dsh', review: 'claude', docs: 'dsh' },
    commit: 'phase',
    concurrent: true,
    steps: [],
    backstopSeconds: 600,
    statusEveryMinutes: 30,
    stepRoundCap: 3,
  });

  const claude = parseOrcaConfig('{"version":1,"orchestration":{"stages":{"implement":"claude"}}}');
  assert.deepEqual(claude.orchestration.stages, {
    plan: 'claude',
    implement: 'claude',
    verify: 'claude',
    review: 'claude',
    docs: 'claude',
  });

  const set = parseOrcaConfig(
    JSON.stringify({
      version: 1,
      orchestration: {
        stages: { plan: 'dsh', implement: 'claude', verify: 'dsh', review: false, docs: 'dsh' },
        commit: 'feature',
        concurrent: false,
      },
    })
  );
  assert.deepEqual(set.orchestration, {
    stages: { plan: 'dsh', implement: 'claude', verify: 'dsh', review: false, docs: 'dsh' },
    commit: 'feature',
    concurrent: false,
    steps: [],
    backstopSeconds: 600,
    statusEveryMinutes: 30,
    stepRoundCap: 3,
  });
});

test('config: backstopSeconds and statusEveryMinutes parse, take their defaults, and refuse a bad value (fix 7)', () => {
  const set = parseOrcaConfig('{"version":1,"orchestration":{"backstopSeconds":300,"statusEveryMinutes":15}}');
  assert.equal(set.state, 'valid');
  assert.deepEqual([set.orchestration.backstopSeconds, set.orchestration.statusEveryMinutes], [300, 15]);
  // The bounds are inclusive.
  const edges = parseOrcaConfig('{"version":1,"orchestration":{"backstopSeconds":60,"statusEveryMinutes":1}}');
  assert.deepEqual([edges.orchestration.backstopSeconds, edges.orchestration.statusEveryMinutes], [60, 1]);
  // A bad value is a problem with its own code and path, never a silent default.
  for (const [value, code, at] of [
    ['{"backstopSeconds":59}', 'backstop-value', '$.orchestration.backstopSeconds'],
    ['{"backstopSeconds":0}', 'backstop-value', '$.orchestration.backstopSeconds'],
    ['{"backstopSeconds":600.5}', 'backstop-value', '$.orchestration.backstopSeconds'],
    ['{"backstopSeconds":"600"}', 'backstop-value', '$.orchestration.backstopSeconds'],
    ['{"backstopSeconds":86401}', 'backstop-value', '$.orchestration.backstopSeconds'],
    ['{"statusEveryMinutes":0}', 'status-every-value', '$.orchestration.statusEveryMinutes'],
    ['{"statusEveryMinutes":-5}', 'status-every-value', '$.orchestration.statusEveryMinutes'],
    ['{"statusEveryMinutes":null}', 'status-every-value', '$.orchestration.statusEveryMinutes'],
  ]) {
    const read = parseOrcaConfig(`{"version":1,"orchestration":${value}}`);
    assert.equal(read.state, 'invalid', value);
    assert.deepEqual(read.problems, [{ code, at }], value);
  }
});

test('config: a file with no orchestration key is valid, and an unknown top-level key stays', () => {
  const bare = parseOrcaConfig('{"version":1,"agents":{"dsh":{"command":"dsh-personal"}}}');
  assert.equal(bare.state, 'valid');
  assert.equal(bare.orchestration, null);

  const text = '{"x":1,"version":1,"agents":{"dsh":{"command":"dsh-personal"}},"orchestration":{},"commands":{}}';
  const parsed = parseOrcaConfig(text);
  assert.equal(parsed.state, 'valid');
  assert.deepEqual(Object.keys(parsed.config), ['x', 'version', 'agents', 'orchestration', 'commands']);
  assert.equal(parsed.config.x, 1);
  assert.deepEqual(parsed.config.agents, { dsh: { command: 'dsh-personal' } });
});

test('config: readOrcaConfig reads missing, valid, folder, and oversized files', () => {
  const root = createTempProjectRoot();
  try {
    assert.deepEqual(readOrcaConfig(root), { state: 'missing' });

    const file = path.join(root, '.beast-mode', 'orca.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(DEFAULT_CONFIG));
    const valid = readOrcaConfig(root);
    assert.equal(valid.state, 'valid');
    assert.equal(valid.orchestration.stages.implement, 'dsh');

    fs.writeFileSync(file, `{"version":1,"x":"${'a'.repeat(ORCA_JSON_MAX_BYTES)}"}`);
    assert.deepEqual(readOrcaConfig(root), { state: 'invalid', problems: [{ code: 'config-too-large', at: '$' }] });

    fs.rmSync(file);
    fs.mkdirSync(file);
    assert.deepEqual(readOrcaConfig(root), { state: 'invalid', problems: [{ code: 'config-unreadable', at: '$' }] });
  } finally {
    removeFixture(root);
  }
});

// ---------------------------------------------------------------------------
// The tasks table
// ---------------------------------------------------------------------------

test('tasks: the template shape gives three phases, and its bug section counts nowhere', () => {
  const text = fs.readFileSync(path.join(PLUGIN_ROOT, 'templates', 'dev-docs', 'tasks.md'), 'utf8');
  const { phases } = parseTasks(text);
  assert.deepEqual(
    phases.map((p) => [p.number, p.title, p.name, p.done, p.total]),
    [
      [1, 'Phase 1: [Slice Name]', '[Slice Name]', 0, 3],
      [2, 'Phase 2: [Slice Name]', '[Slice Name]', 0, 2],
      [3, 'Phase 3: [Base Phase Name] (Base)', '[Base Phase Name] (Base)', 0, 1],
    ]
  );
  assert.equal(phases[0].demo, '[The Demo line of Phase 1 in implementation.md]');
  assert.match(phases[2].demo, /^none \(base phase/);
  assert.deepEqual(phases[1].open, ['**Task 1 Title**', '**Task 2 Title**']);
});

test('tasks: a ### group stays inside its phase', () => {
  const text = [
    '## Phase 1: Build (1/3 complete)',
    '',
    '### Group A: one (1/2 complete)',
    '',
    '- [x] a',
    '- [ ] b',
    '',
    '### Group B: two (0/1 complete)',
    '',
    '- [ ] c',
    '',
    '## Phase 2: Ship',
    '',
    '- [x] d',
  ].join('\n');
  const { phases } = parseTasks(text);
  assert.equal(phases.length, 2);
  assert.deepEqual([phases[0].done, phases[0].total, phases[0].open], [1, 3, ['b', 'c']]);
  assert.deepEqual([phases[1].done, phases[1].total, phases[1].title], [1, 1, 'Phase 2: Ship']);
});

test('tasks: a star bullet and an escaped box both count', () => {
  const text = ['## Phase 1: Marks', '* [x] star done', '- \\[x\\] escaped done', '- \\[ \\] escaped open', '* [X] upper done'].join('\n');
  const [phase] = parseTasks(text).phases;
  assert.deepEqual([phase.done, phase.total, phase.open], [3, 4, ['escaped open']]);
});

test('tasks: a checkbox outside a phase section, in a fence, or indented counts nowhere', () => {
  const text = [
    '# Demo - Task Checklist',
    '- [ ] before any phase',
    '## Phase 1: Real (0/1 complete)',
    '- [ ] the one task\\',
    '  - [ ] an indented sub item',
    '```text',
    '- [ ] inside a fence',
    '```',
    '## Bugs & Issues',
    '- [ ] a bug',
    '## Phase 2: After the bugs',
    '- [x] counted',
    '# A top heading closes it',
    '- [ ] after the top heading',
  ].join('\r\n');
  const { phases } = parseTasks(text);
  assert.deepEqual(
    phases.map((p) => [p.number, p.done, p.total, p.open]),
    [
      [1, 0, 1, ['the one task']],
      [2, 1, 1, []],
    ]
  );
});

test('tasks: a phase with no task line never passes, and a bad input never throws', () => {
  const { phases } = parseTasks('## Phase 1: Empty (0/0 complete)\n\n**Demo:** none\n\nSome text.\n## Phase Two\n- [x] x');
  assert.deepEqual([phases[0].total, phases[0].demo], [0, 'none']);
  assert.equal(isPhaseComplete(phases[0]), false);
  assert.equal(phases[1].number, 2, 'a heading with no number takes its position');
  assert.equal(phases[1].name, '');
  assert.deepEqual(parseTasks(undefined), { phases: [] });
  assert.deepEqual(parseTasks(42), { phases: [] });
  assert.deepEqual(parseTasks(''), { phases: [] });
});

// ---------------------------------------------------------------------------
// The feature reference and the run record
// ---------------------------------------------------------------------------

test('feature reference: a name and an epic path pass, a traversal and a third segment fail', () => {
  assert.deepEqual(checkFeaturePath('user-auth'), { ok: true, path: 'user-auth', segments: ['user-auth'] });
  assert.deepEqual(checkFeaturePath('editor/ux/'), { ok: true, path: 'editor/ux', segments: ['editor', 'ux'] });
  for (const bad of ['', '../etc', 'a/../b', 'a/b/c', '/abs', 'a b', '.hidden', 'name.lock', 'x..y', 42]) {
    assert.equal(checkFeaturePath(bad).ok, false, `"${bad}" must fail`);
  }
});

test('record: a missing record is absent with no note, and a round trip keeps unknown keys', () => {
  const root = createTempProjectRoot();
  try {
    assert.deepEqual(readRecord(root, 'editor/ux'), { record: null, note: null });

    const record = { ...recordWith().record, feature: 'editor/ux', later: { kept: true } };
    const file = writeRecord(root, 'editor/ux', record);
    assert.equal(file, recordPath(root, 'editor/ux'));
    assert.equal(file, path.join(root, '.beast-mode', 'briefs', 'editor', 'ux', 'orca-run.json'));
    assert.deepEqual(fs.readdirSync(path.dirname(file)), ['orca-run.json'], 'no temporary file stays');

    const body = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.deepEqual(Object.keys(body).slice(0, 2), ['schema', 'feature']);

    const read = readRecord(root, 'editor/ux');
    assert.equal(read.note, null);
    assert.equal(read.record.active.dispatchId, 'disp-1');
    assert.equal(read.record.active.sendBacks, 0);
    assert.deepEqual(read.record.later, { kept: true });
    assert.deepEqual(read.record.done, { docs: false, steps: {} });
  } finally {
    removeFixture(root);
  }
});

test('record: a record that does not parse, or a file that cannot be read, answers one note, and next stops record-unreadable', () => {
  const root = createTempProjectRoot();
  try {
    const file = recordPath(root, 'demo');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    for (const body of ['{not json', '[]', '{"schema":2,"active":null}', '{"schema":1,"active":{"stage":"phase"}}']) {
      fs.writeFileSync(file, body);
      const read = readRecord(root, 'demo');
      assert.equal(read.record, null, body);
      assert.equal(read.note, 'The run record at ".beast-mode/briefs/demo/orca-run.json" does not parse as a record of schema 1.');
      // The record names the active dispatch, so a note never reads as an absent record (CR-1).
      const stopped = assertStop(decideFeature(facts({ record: read })), 'record-unreadable');
      assert.deepEqual(stopped.detail, [read.note], body);
    }
    // A folder in the place of the file cannot be read, also for a run as root.
    fs.rmSync(file);
    fs.mkdirSync(file);
    const read = readRecord(root, 'demo');
    assert.deepEqual(read, { record: null, note: 'The run record at ".beast-mode/briefs/demo/orca-run.json" cannot be read (EISDIR).' });
    assertStop(decideFeature(facts({ record: read })), 'record-unreadable');
  } finally {
    removeFixture(root);
  }
});

// ---------------------------------------------------------------------------
// The decision table: one test per Phase 1 rule, from built facts
// ---------------------------------------------------------------------------

test('decide F1: no ORCA_TERMINAL_HANDLE stops not-orca-tab', () => {
  assertStop(decideFeature(facts({ terminalHandle: null })), 'not-orca-tab');
});

test('decide F2: a missing orca.json stops config-missing and names /orca-setup', () => {
  const action = assertStop(decideFeature(facts({ config: { state: 'missing' } })), 'config-missing');
  assert.match(action.fix, /\/orca-setup/);
});

test('decide F3: an invalid orca.json stops config-invalid with one detail line per problem', () => {
  const action = assertStop(decideFeature(facts({ config: parseOrcaConfig('{"version":3,"orchestration":"x"}') })), 'config-invalid');
  assert.deepEqual(action.detail, ['version at $.version', 'orchestration-not-object at $.orchestration']);
});

test('decide F4: no orchestration object stops orchestration-missing and names /orca-setup', () => {
  const action = assertStop(decideFeature(facts({ config: parseOrcaConfig('{"version":1}') })), 'orchestration-missing');
  assert.match(action.fix, /\/orca-setup/);
});

test('decide F5: an implement agent that is not installed stops harness-missing', () => {
  const action = assertStop(decideFeature(facts({ harnesses: ['claude'] })), 'harness-missing');
  assert.match(action.detail.join('\n'), /stages\.implement is "dsh"/);
});

test('decide F6: no work tree stops not-git, a read error git-failed, no default branch no-default-branch', () => {
  assertStop(decideFeature(facts({ git: { workTree: false, detail: ['not a repo'] } })), 'not-git');
  assertStop(decideFeature(facts({ git: { error: ['git status exited 128.'] } })), 'git-failed');
  assertStop(decideFeature(facts({ git: { defaultBranch: null } })), 'no-default-branch');
});

test('decide F7: a bad reference, a missing folder, or an epic folder stops feature-missing', () => {
  assertStop(decideFeature(facts({ docs: { valid: false, reason: 'bad', exists: false, tasks: null } })), 'feature-missing');
  assertStop(decideFeature(facts({ docs: { exists: false, tasks: null } })), 'feature-missing');
  const epic = assertStop(decideFeature(facts({ docs: { isEpic: true, tasks: null } })), 'feature-missing');
  assert.match(epic.fix, /demo\/<feature>/);
});

test('decide F8: neither requirements.md nor implementation.md stops no-plan-input; an unreadable tasks.md no-tasks', () => {
  const none = assertStop(
    decideFeature(facts({ docs: { has: { requirements: false, implementation: false } } })),
    'no-plan-input'
  );
  assert.match(none.fix, /requirements\.md/);
  assertStop(decideFeature(facts({ docs: { tasks: null, tasksError: 'EACCES: permission denied' } })), 'no-tasks');
  assertAction(decideFeature(facts({ docs: { has: { requirements: false } } })), 'start');
  assertAction(decideFeature(facts({ docs: { has: { implementation: false } } })), 'start');
});

test('decide F15: no implementation.md runs plan and start, no tasks.md runs start only, no phase stops no-tasks', () => {
  const full = assertAction(
    decideFeature(facts({ docs: { has: { implementation: false, tasks: false }, tasks: null } })),
    'start'
  );
  assert.deepEqual(
    { run: full.run, stage: full.stage, phase: full.phase, agent: full.agent, placement: full.placement },
    { run: ['start', '--feature', 'demo', '--stage', 'plan'], stage: 'plan', phase: null, agent: 'claude', placement: 'current' }
  );
  assert.match(full.say, /\/plan-feature, then \/start-feature/);
  const startOnly = assertAction(decideFeature(facts({ docs: { has: { tasks: false }, tasks: null } })), 'start');
  assert.equal(startOnly.stage, 'plan');
  assert.match(startOnly.say, /: \/start-feature\.$/);
  assertStop(decideFeature(facts({ docs: { tasks: parseTasks('# Demo\n- [ ] no phase') } })), 'no-tasks');

  const planDsh = parseOrcaConfig('{"version":1,"orchestration":{"stages":{"plan":"dsh"}}}');
  assert.equal(decideFeature(facts({ config: planDsh, docs: { has: { tasks: false }, tasks: null } })).agent, 'dsh');
});

test('decide F9: a fresh call with Orca down stops orca-not-running with the exact error', () => {
  const detail = ['fake-orca status: runtime_unavailable: Orca is not running.'];
  const action = assertStop(
    decideFeature(facts({ flags: { fresh: true }, orcaStatus: { running: false, detail } })),
    'orca-not-running'
  );
  assert.deepEqual(action.detail, detail);
  assertAction(decideFeature(facts({ orcaStatus: { running: false, detail } })), 'start');
});

test('decide F10: off the run branch, create it or switch to it; a dirty tree stops dirty-tree', () => {
  const create = assertAction(decideFeature(facts({ git: { head: 'main', runBranchExists: false, base: null } })), 'branch');
  assert.deepEqual(
    { run: create.run, branch: create.branch, base: create.base, create: create.create },
    { run: ['branch', '--feature', 'demo'], branch: 'feat/demo', base: 'main', create: true }
  );
  const switchTo = assertAction(decideFeature(facts({ git: { head: null, runBranchExists: true } })), 'branch');
  assert.equal(switchTo.create, false);
  const dirty = assertStop(decideFeature(facts({ git: { head: 'main', dirty: ['src/a.js', 'notes.txt'] } })), 'dirty-tree');
  assert.deepEqual(dirty.detail, ['src/a.js', 'notes.txt']);
});

test('decide F10: a switch that failed in this run stops branch-failed, and a fresh call tries again', () => {
  const failed = recordWith({}, { active: null, failedGit: { step: 'branch', phase: null, detail: ['git switch exited 128.'] } });
  const action = assertStop(decideFeature(facts({ git: { head: 'main' }, record: failed })), 'branch-failed');
  assert.deepEqual(action.detail, ['git switch exited 128.']);
  assertAction(decideFeature(facts({ flags: { fresh: true }, git: { head: 'main' }, record: failed })), 'branch');
});

test('decide A1: a fresh call with a busy tab stops tab-still-runs', () => {
  const action = assertStop(
    decideFeature(facts({ flags: { fresh: true }, record: recordWith(), worker: { state: 'busy', detail: [] } })),
    'tab-still-runs'
  );
  assert.match(action.detail[0], /disp-1/);
});

test('decide A2: a tab that waits on a person is busy, so every call waits, and a fresh call stops tab-still-runs', () => {
  const ok = (/** @type {any} */ result) => ({ kind: 'ok', result, detail: [] });
  const waiting = normalizeWorker(
    /** @type {any} */ (ok({ state: 'ready', stage: 'turn', liveness: 'live', activity: 'blocked', waitingOnHuman: 'ask the user (via hook)' }))
  );
  assert.equal(waiting.state, 'busy');
  const plan = recordWith({ stage: 'plan', phase: null, agent: 'claude' });
  for (const flags of [{}, { wake: 'escalation' }, { wake: 'escalation', dispatch: 'disp-1' }]) {
    assertAction(decideFeature(facts({ flags, record: plan, worker: waiting })), 'wait');
  }
  assertStop(decideFeature(facts({ flags: { fresh: true }, record: plan, worker: waiting })), 'tab-still-runs');
  // An exited tab stays gone, and a reason of `unknown` is no wait on a person.
  assert.equal(normalizeWorker(/** @type {any} */ (ok({ state: 'ready', liveness: 'exited', waitingOnHuman: 'ask the user' }))).state, 'gone');
  assert.equal(normalizeWorker(/** @type {any} */ (ok({ state: 'ready', liveness: 'live', activity: 'idle', waitingOnHuman: 'unknown' }))).state, 'idle');
});

test('spec: only the plan spec asks in its own tab, and every other spec keeps the worker ask rule', () => {
  const plan = planSpec({ feature: 'demo', epic: null, form: 'full' });
  assert.ok(plan.includes('ask the user to choose'));
  assert.ok(!plan.includes('run the `ask` command of your worker'));
  const others = [
    phaseSpec({ feature: 'demo', epic: null, phase: { number: 1, name: 'A' } }),
    reviewSpec({ feature: 'demo', epic: null }),
    reviewFixSpec({ feature: 'demo', epic: null }),
    docsSpec({ feature: 'demo', epic: null }),
    verifySpec({ feature: 'demo', epic: null, phase: { number: 1, name: 'A' }, briefFile: 'b.md', verdictFile: 'v.md' }),
    fixSpec({ feature: 'demo', epic: null, phase: { number: 1, name: 'A' }, round: 1, evidence: 'x', verdictFile: 'v.md', verifies: false }),
    inboxSpec({ feature: 'demo', epic: null }),
  ];
  for (const spec of others) {
    assert.ok(spec.includes('run the `ask` command of your worker'));
    assert.ok(!spec.includes('Ask the user in your own tab'));
  }
});

test('decide A2: a busy or an unknown tab waits', () => {
  for (const state of ['busy', 'unknown']) {
    const action = assertAction(decideFeature(facts({ record: recordWith(), worker: { state, detail: [] } })), 'wait');
    assert.deepEqual(action.workers, [{ feature: 'demo', stage: 'phase', phase: 1, agent: 'dsh', dispatchId: 'disp-1' }]);
  }
});

test('decide A3: a done tab with a complete phase closes, with the slice block', () => {
  const action = assertAction(
    decideFeature(facts({ docs: phaseOneComplete(), record: recordWith(), worker: { state: 'done', detail: [] } })),
    'close'
  );
  assert.deepEqual(action.run, ['close', '--feature', 'demo']);
  assert.equal(action.stage, 'phase');
  assert.equal(
    action.show,
    'Slice ready: Phase 1 - Slice 1\nDemo: the page shows one row\nThe run goes on. Try the demo when you can.'
  );
  const quiet = decideFeature(
    facts({ docs: phaseOneComplete('none (base phase: the schema)'), record: recordWith(), worker: { state: 'done', detail: [] } })
  );
  assert.equal(quiet.show, null);
});

test('decide A3: the first and the second report with an open task send it back, the third asks', () => {
  assert.equal(SEND_BACK_CAP, 2);
  for (const sendBacks of [0, 1]) {
    const action = assertAction(
      decideFeature(facts({ record: recordWith({ sendBacks }), worker: { state: 'done', detail: [] } })),
      'send'
    );
    assert.deepEqual(action.run, ['send', '--feature', 'demo', '--reason', 'open-tasks']);
    assert.equal(action.reason, 'open-tasks');
    assert.equal(action.dispatchId, 'disp-1');
    assert.deepEqual(action.open, ['**Task 1.1** open', '**Task 1.2** open']);
  }
  const ask = assertAction(
    decideFeature(facts({ record: recordWith({ sendBacks: 2 }), worker: { state: 'done', detail: [] } })),
    'ask'
  );
  assert.match(ask.question, /^\[demo phase 1\] /);
  assert.equal(ask.recommended, 'stop');
  assert.deepEqual(
    ask.options.map((option) => [option.key, option.run]),
    [
      ['stop', null],
      ['new-tab', ['close', '--feature', 'demo']],
    ]
  );
});

test('resume: an idle tab after an escalation gets one send, then an ask, and a busy tab after an escalation waits', () => {
  const idle = { state: 'idle', detail: ['Orca: worker ready, liveness live, activity idle.'] };
  assert.equal(ESCALATION_CAP, 1);
  for (const flags of [{ wake: 'escalation' }, { wake: 'escalation', dispatch: 'disp-1' }, { fresh: true }]) {
    const action = assertAction(decideFeature(facts({ flags, record: recordWith(), worker: idle })), 'send');
    assert.deepEqual(action.run, ['send', '--feature', 'demo', '--reason', 'escalation']);
    assert.deepEqual([action.reason, action.dispatchId], ['escalation', 'disp-1']);
    assert.deepEqual(action.open, ['**Task 1.1** open', '**Task 1.2** open']);
  }
  // The done proof holds, so the one send asks for the report.
  const report = assertAction(
    decideFeature(facts({ flags: { wake: 'escalation' }, docs: phaseOneComplete(), record: recordWith(), worker: idle })),
    'send'
  );
  assert.deepEqual([report.reason, report.run.at(-1), report.open], ['report', 'report', []]);

  // Past the one send, the run asks. With the work done, the user can close the tab.
  const ask = assertAction(
    decideFeature(facts({ flags: { wake: 'escalation' }, record: recordWith({ escalations: 1 }), worker: idle })),
    'ask'
  );
  assert.match(ask.question, /^\[demo phase 1\] The tab is idle again after one send, and tasks\.md shows 2 open tasks\./);
  assert.deepEqual(ask.options.map((option) => [option.key, option.run]), [
    ['stop', null],
    ['new-tab', ['close', '--feature', 'demo', '--discard']],
  ]);
  assert.equal(ask.recommended, 'stop');
  const done = assertAction(
    decideFeature(facts({ flags: { fresh: true }, docs: phaseOneComplete(), record: recordWith({ escalations: 1 }), worker: idle })),
    'ask'
  );
  assert.deepEqual(done.options.map((option) => [option.key, option.run]), [
    ['close', ['close', '--feature', 'demo']],
    ['stop', null],
  ]);
  assert.equal(done.recommended, 'close');

  // D6: no escalation for this tab on a call that is not fresh waits. A busy tab after an escalation waits (O10).
  assertAction(decideFeature(facts({ record: recordWith(), worker: idle })), 'wait');
  assertAction(decideFeature(facts({ flags: { wake: 'escalation', dispatch: 'disp-other' }, record: recordWith(), worker: idle })), 'wait');
  for (const state of ['busy', 'unknown']) {
    assertAction(
      decideFeature(facts({ flags: { wake: 'escalation', dispatch: 'disp-1' }, record: recordWith(), worker: { state, detail: [] } })),
      'wait'
    );
  }
});

test('resume: a gone or failed tab asks worker-gone, a broken circuit stops circuit-broken, and a failed send stops send-failed', () => {
  for (const state of ['gone', 'failed']) {
    const ask = assertAction(decideFeature(facts({ record: recordWith(), worker: { state, detail: ['Orca: worker stopped.'] } })), 'ask');
    assert.match(ask.question, /^\[demo phase 1\] The tab (is gone|failed)\. What now\?$/);
    assert.deepEqual(ask.options.map((option) => [option.key, option.run]), [
      ['new-tab', ['close', '--feature', 'demo', '--discard']],
      ['stop', null],
    ]);
    assert.equal(ask.recommended, 'new-tab');
    assert.ok(ask.detail.includes('Orca: worker stopped.'));
  }
  const circuit = assertStop(decideFeature(facts({ record: recordWith(), worker: { state: 'circuit', detail: [] } })), 'circuit-broken');
  assert.deepEqual(circuit.fixRun, ['close', '--feature', 'demo', '--discard'], 'a dropped tab marks no stage done');
  assert.match(circuit.fix, /Only you can reopen it/);

  const reported = { state: 'done', detail: [] };
  const failedSend = recordWith({ sendBacks: 1, failedSend: { reason: 'open-tasks', code: 'runtime_unavailable', detail: ['Orca is down.'] } });
  const stopped = assertStop(decideFeature(facts({ record: failedSend, worker: reported })), 'send-failed');
  assert.deepEqual(stopped.detail, ['Orca is down.']);
  assertAction(decideFeature(facts({ flags: { fresh: true }, record: failedSend, worker: reported })), 'send');
  assertAction(decideFeature(facts({ docs: phaseOneComplete(), record: failedSend, worker: reported })), 'close');
});

test('resume: a failed start asks start-failed with the retry line, and three failed starts stop circuit-broken', () => {
  assert.equal(START_FAILURE_CAP, 3);
  const failed = (extra = {}) =>
    recordWith({}, {
      active: null,
      failedStart: {
        stage: 'phase',
        phase: 1,
        agent: 'dsh',
        code: 'start_failed',
        failedStage: 'terminal',
        taskId: 'task-9',
        dispatchId: 'disp-9',
        count: 1,
        detail: ['Failed stage: terminal.'],
        ...extra,
      },
    });
  const ask = assertAction(decideFeature(facts({ record: failed() })), 'ask');
  assert.match(ask.question, /^\[demo phase 1\] The start of the tab failed at the terminal stage of Orca \(1 failed start\)\./);
  assert.deepEqual(ask.options.map((option) => [option.key, option.run]), [
    ['retry', ['start', '--feature', 'demo', '--stage', 'phase', '--phase', '1', '--retry']],
    ['stop', null],
  ]);
  assert.deepEqual([ask.recommended, ask.detail], ['retry', ['Failed stage: terminal.']]);

  const docs = assertAction(decideFeature(facts({ record: failed({ stage: 'docs', phase: null, count: 2 }) })), 'ask');
  assert.deepEqual(docs.options[0].run, ['start', '--feature', 'demo', '--stage', 'docs', '--retry']);

  // No Task to retry: the user can clear the failed start, and stop is the recommendation.
  const noTask = assertAction(decideFeature(facts({ record: failed({ taskId: null, dispatchId: null, code: 'timeout' }) })), 'ask');
  assert.deepEqual(noTask.options.map((option) => [option.key, option.run]), [
    ['stop', null],
    ['clear', ['close', '--feature', 'demo']],
  ]);
  assert.equal(noTask.recommended, 'stop');

  for (const extra of [{ count: 3 }, { count: 1, circuit: true }]) {
    const stopped = assertStop(decideFeature(facts({ record: failed(extra) })), 'circuit-broken');
    assert.deepEqual(stopped.fixRun, ['close', '--feature', 'demo']);
    assert.deepEqual(stopped.detail, ['Failed stage: terminal.']);
  }
});

test('decide F16: the first open phase starts its tab on the implement agent', () => {
  const action = assertAction(decideFeature(facts()), 'start');
  assert.deepEqual(
    { run: action.run, stage: action.stage, phase: action.phase, agent: action.agent, placement: action.placement },
    {
      run: ['start', '--feature', 'demo', '--stage', 'phase', '--phase', '1'],
      stage: 'phase',
      phase: 1,
      agent: 'dsh',
      placement: 'current',
    }
  );
  const claude = decideFeature(
    facts({ config: parseOrcaConfig('{"version":1,"orchestration":{"stages":{"implement":"claude"}}}') })
  );
  assert.equal(claude.agent, 'claude');
});

test('decide F16: a complete phase with no commit and a dirty tree commits under the phase cadence', () => {
  const action = assertAction(decideFeature(facts({ docs: phaseOneComplete(), git: { dirty: ['src/a.js'] } })), 'commit');
  assert.deepEqual(
    { run: action.run, point: action.point, phase: action.phase, subject: action.subject },
    {
      run: ['commit', '--feature', 'demo', '--point', 'phase', '--phase', '1'],
      point: 'phase',
      phase: 1,
      subject: 'feat: demo phase 1',
    }
  );
});

test('decide F16: a committed phase, a clean tree, or the feature cadence moves on to the next phase', () => {
  const cases = [
    { git: { dirty: ['src/a.js'], subjects: ['feat: demo phase 1'] } },
    { git: { dirty: [] } },
    {
      git: { dirty: ['src/a.js'] },
      config: parseOrcaConfig('{"version":1,"orchestration":{"commit":"feature"}}'),
    },
  ];
  for (const patch of cases) {
    const action = assertAction(decideFeature(facts({ docs: phaseOneComplete(), ...patch })), 'start');
    assert.equal(action.phase, 2);
  }
});

test('decide F16: a commit that failed in this run stops commit-failed, and a fresh call tries again', () => {
  const record = recordWith({}, { active: null, failedGit: { step: 'commit', phase: 1, detail: ['pre-commit refused.'] } });
  const patch = { docs: phaseOneComplete(), git: { dirty: ['src/a.js'] }, record };
  const action = assertStop(decideFeature(facts(patch)), 'commit-failed');
  assert.deepEqual(action.detail, ['pre-commit refused.']);
  assertAction(decideFeature(facts({ ...patch, flags: { fresh: true } })), 'commit');
});

test('decide F23: the done action carries the full summary block', () => {
  const tasks = parseTasks(tasksDoc(phaseText(1, { done: 1 }), phaseText(2, { done: 2 })));
  const action = assertAction(
    decideFeature(
      facts({
        docs: {
          tasks,
          has: { codeReview: true },
          review: parseReview('## Progress\n- [x] CR-1: one\n- [x] CR-2: two\n'),
          humanTests: ['the page shows one row on a phone'],
          inbox: [{ kind: 'note', text: 'note 2026-11-18 10:00 | keep the old icon' }],
        },
        git: {
          subjects: ['fix: demo cross-phase review', 'feat: demo phase 2', 'feat: demo phase 1'],
          dirty: ['docs/features/demo/context.md', 'docs/overview.md'],
        },
        record: recordWith({}, { active: null, done: { docs: true, steps: {} } }),
      })
    ),
    'done'
  );
  assert.equal(
    action.show,
    [
      'Run summary - demo',
      '',
      'Phases:',
      '- Phase 1 - Slice 1: committed as "feat: demo phase 1"',
      '- Phase 2 - Slice 2: committed as "feat: demo phase 2"',
      '',
      'Review: a claude review tab, with the fixes on dsh, 2 findings, 2 closed. Committed as "fix: demo cross-phase review".',
      'Docs: the docs tab ran /update-feature demo, /update-master demo.',
      'Uncommitted: 2 files on feat/demo.',
      '- docs/features/demo/context.md',
      '- docs/overview.md',
      'Human tests: 1 open line under "## Needs Human Verification" in docs/features/demo/context.md.',
      'Inbox: 1 open line in docs/features/demo/inbox.md.',
      '- [ ] note 2026-11-18 10:00 | keep the old icon',
      '',
      'Next:',
      '- Review and commit the 2 uncommitted files.',
      '- Run the 1 human test in docs/features/demo/context.md.',
      '- Act on the 1 open inbox line in docs/features/demo/inbox.md.',
      '- Merge feat/demo into main when you are ready.',
    ].join('\n')
  );
});

test('decide F23: the summary lists each step result with overridden first, and the verify verdict of each phase (CR-7)', () => {
  const config = parseOrcaConfig(
    '{"version":1,"orchestration":{"stages":{"review":false},"steps":[{"after":"phase","command":"/check {phase}","agent":"dsh"},{"after":"feature","command":"/audit","agent":"dsh"}]}}'
  );
  const tasks = parseTasks(tasksDoc(phaseText(1, { done: 1 }), phaseText(2, { done: 1 })));
  const action = assertAction(
    decideFeature(
      facts({
        config,
        docs: {
          tasks,
          phaseVerdicts: { 1: { verdict: 'PASS', evidence: '', demo: null }, 2: { verdict: 'PASS', evidence: '', demo: null } },
        },
        git: { subjects: ['feat: demo phase 2', 'feat: demo phase 1'] },
        record: recordWith(
          {},
          {
            active: null,
            done: { docs: true, steps: { 'phase-1:0': 'PASS', 'phase-2:0': 'overridden', 'feature:1': 'PASS' } },
            verify: { 2: { round: 2 } },
          }
        ),
      })
    ),
    'done'
  );
  const lines = action.show.split('\n');
  assert.ok(lines.includes('- Phase 1 - Slice 1: committed as "feat: demo phase 1", verified PASS'), action.show);
  assert.ok(lines.includes('- Phase 2 - Slice 2: committed as "feat: demo phase 2", verified PASS after 2 fix rounds'), action.show);
  const at = lines.indexOf('Steps:');
  assert.deepEqual(lines.slice(at, at + 4), ['Steps:', '- /check {phase} (Phase 2): overridden', '- /check {phase} (Phase 1): PASS', '- /audit (the feature): PASS']);
});

test('config: stepRoundCap defaults to 3, parses a whole number from 1 to 20, and refuses a bad value (fix 11)', () => {
  assert.equal(parseOrcaConfig('{"version":1,"orchestration":{}}').orchestration.stepRoundCap, 3);
  assert.equal(parseOrcaConfig('{"version":1,"orchestration":{"stepRoundCap":5}}').orchestration.stepRoundCap, 5);
  assert.deepEqual(
    [1, 20].map((n) => parseOrcaConfig(`{"version":1,"orchestration":{"stepRoundCap":${n}}}`).orchestration.stepRoundCap),
    [1, 20]
  );
  for (const value of ['0', '21', '2.5', '"3"', 'null', '-1']) {
    const read = parseOrcaConfig(`{"version":1,"orchestration":{"stepRoundCap":${value}}}`);
    assert.equal(read.state, 'invalid', value);
    assert.deepEqual(read.problems, [{ code: 'step-round-cap-value', at: '$.orchestration.stepRoundCap' }], value);
  }
});

test('decide F23: a step accepted at its round cap reads "overridden after <n> rounds", first in the Steps block (fix 11)', () => {
  const config = parseOrcaConfig(
    '{"version":1,"orchestration":{"stages":{"review":false},"steps":[{"after":"phase","command":"/check {phase}","agent":"dsh"},{"after":"feature","command":"/audit","agent":"dsh"}]}}'
  );
  const tasks = parseTasks(tasksDoc(phaseText(1, { done: 1 })));
  const action = assertAction(
    decideFeature(
      facts({
        config,
        docs: { tasks, phaseVerdicts: { 1: { verdict: 'PASS', evidence: '', demo: null } } },
        git: { subjects: ['feat: demo phase 1'] },
        record: recordWith(
          {},
          {
            active: null,
            done: { docs: true, steps: { 'phase-1:0': 'PASS', 'feature:1': 'overridden-final' } },
            stepRounds: { 'feature:1': 3 },
          }
        ),
      })
    ),
    'done'
  );
  const lines = action.show.split('\n');
  const at = lines.indexOf('Steps:');
  assert.deepEqual(lines.slice(at, at + 3), ['Steps:', '- /audit (the feature): overridden after 3 rounds', '- /check {phase} (Phase 1): PASS']);
});

test('decide F7a: an unreadable record stops record-unreadable before F8, and an earlier stop keeps the note in say', () => {
  const record = { record: null, note: 'The run record does not parse.' };
  const stopped = assertStop(decideFeature(facts({ record })), 'record-unreadable');
  assert.deepEqual(stopped.detail, ['The run record does not parse.']);
  assert.ok(!stopped.say.includes('Note:'), 'the note is the detail, not a second note');
  assert.equal(
    stopped.fix,
    'Check Orca for an open tab of demo, then move the file away and run /orca-feature demo again. For a file that cannot be read, fix its permission instead.'
  );
  assertStop(decideFeature(facts({ record, docs: { has: { requirements: false, implementation: false } } })), 'record-unreadable');

  const early = assertStop(decideFeature(facts({ record, terminalHandle: null })), 'not-orca-tab');
  assert.match(early.say, / Note: The run record does not parse\.$/);
});

test('decide F14: a start whose outcome is unknown asks start-unknown with stop first, and never offers a retry', () => {
  const unknown = (extra = {}) =>
    recordWith({}, {
      active: null,
      failedStart: {
        stage: 'phase',
        phase: 2,
        agent: 'dsh',
        code: 'timeout',
        unknown: true,
        taskId: 'task-9',
        dispatchId: 'disp-9',
        count: 1,
        detail: ['The start ran past its time limit, so Orca can have opened the tab.'],
        ...extra,
      },
    });
  const ask = assertAction(decideFeature(facts({ docs: phaseOneComplete(), record: unknown() })), 'ask');
  assert.deepEqual([ask.reason, ask.recommended], ['start-unknown', 'stop']);
  assert.deepEqual(ask.options.map((option) => [option.key, option.run]), [
    ['stop', null],
    ['clear', ['close', '--feature', 'demo']],
  ]);
  for (const option of ask.options) assert.match(option.label, /Check Orca for a new tab of Phase 2 first/, option.key);
  assert.match(ask.question, /^\[demo phase 2\] /);
  assert.deepEqual(ask.detail, ['The start ran past its time limit, so Orca can have opened the tab.']);

  // The entry that a start writes before its Orca call, a third start of the chain, and a timeout of an earlier
  // version (its code alone) ask the same way.
  for (const extra of [{ code: 'start-unrecorded', taskId: null, dispatchId: null }, { count: 3 }, { unknown: undefined }]) {
    assert.equal(decideFeature(facts({ docs: phaseOneComplete(), record: unknown(extra) })).reason, 'start-unknown', JSON.stringify(extra));
  }
});

// ---------------------------------------------------------------------------
// The worker specs
// ---------------------------------------------------------------------------

/** The parts of the header, the read list, and the rules that every spec keeps. */
function sharedParts(feature, tag) {
  return [
    `# Beast Mode orca worker - ${feature}, `,
    'You are a worker of a Beast Mode orca run. The coordinator started you through Orca, and it waits for',
    '1. `.beast-mode/harness.md`. It maps each neutral term below to a tool of your harness.',
    '2. The project instruction file.',
    '3. `.beast-mode/phase-handoff.md`. It is the single source of truth for this work.',
    `4. In \`docs/features/${feature}/\`:`,
    '- Make no git write. No commit, branch, merge, stash, reset, or push. The coordinator owns git.',
    'run the `ask` command of your worker',
    `Start the question with \`[${tag}]\`, then end your turn.`,
    'is an inbox item of section 12 rule 3.',
    'Every agent prompt that you write holds the inbox sentence of',
    '- Start no Orca worker and no Orca task of your own. Delegate only by the term "delegate to the',
    '  `<name>` agent" of `.beast-mode/harness.md`, in the form whose call returns the result of the agent',
    '  in the same turn. Never end your turn while an agent that you started still works.',
    '- Touch no shared or production environment.',
    'Done proof: run `worker_done` from your worker preamble',
  ];
}

const SPEC_CASES = [
  {
    name: 'phase',
    spec: phaseSpec({ feature: 'demo', epic: null, phase: { number: 2, name: 'Hello file' } }),
    tag: 'demo phase 2',
    parts: [
      '# Beast Mode orca worker - demo, Phase 2: Hello file\n',
      'In `docs/features/demo/`: the Phase 2 section of `implementation.md`, `tasks.md`,',
      'Run the post-phase step of section 10.',
      'act on\n  it at part 5 of section 10.',
      'only when every task of Phase 2 in\n`tasks.md` reads `[x]`. The coordinator',
    ],
    absent: ['/review-feature', 'code-review.md', 'epic-resolution.md'],
  },
  {
    name: 'phase with the review',
    spec: phaseSpec({ feature: 'demo', epic: null, phase: { number: 3, name: 'Last' }, review: true }),
    tag: 'demo phase 3',
    parts: [
      '3. Then run the `/review-feature demo` command. Fix every open finding by the code review groups',
      'of section 6, one agent at a time. Run one verifier. Mark each fixed finding `- [x] CR-<n>` in',
      'When every task of Phase 3 already reads `[x]`, skip steps 1 and 2.',
      '`tasks.md` reads `[x]`, and `code-review.md` holds no open finding.',
    ],
    absent: ['epic-resolution.md'],
  },
  {
    name: 'phase in an epic, with no phase name',
    spec: phaseSpec({ feature: 'editor/ux', epic: 'editor', phase: { number: 1, name: '' } }),
    tag: 'editor/ux phase 1',
    parts: [
      '# Beast Mode orca worker - editor/ux, Phase 1\n',
      'The feature is part of the epic `editor`. Load the epic context by section 4 of',
    ],
    absent: ['/review-feature'],
  },
  {
    name: 'plan, full form',
    spec: planSpec({ feature: 'demo', epic: null, form: 'full' }),
    tag: 'demo plan',
    parts: [
      '# Beast Mode orca worker - demo, Plan\n',
      '1. Run the `/plan-feature demo` command as it is written, with the plan interview and its',
      'stop check. Ask each question in your own tab by the ask rule below.',
      '- Ask the user in your own tab, as a normal run of the command does: ask the user to choose, with the',
      'Do not run the `ask` command',
      '2. Do not wait at the approval step of `/plan-feature`. This run is the approval, so go on at once.',
      '3. Run the `/start-feature demo` command.',
      '`tasks.md` holds a `## Phase` section.',
    ],
    absent: ['epic-resolution.md', 'part 5 of section 10', 'Start the question with', 'Ask the user nothing directly'],
    nativeAsk: true,
  },
  {
    name: 'plan, start form, in an epic',
    spec: planSpec({ feature: 'editor/ux', epic: 'editor', form: 'start' }),
    tag: 'editor/ux plan',
    parts: [
      '1. `implementation.md` exists, so the plan is written. Write no new plan.',
      '2. Run the `/start-feature editor/ux` command.',
      'The feature is part of the epic `editor`.',
    ],
    absent: ['/plan-feature', 'Start the question with', 'Ask the user nothing directly'],
    nativeAsk: true,
  },
  {
    name: 'review',
    spec: reviewSpec({ feature: 'demo', epic: null }),
    tag: 'demo review',
    parts: [
      '# Beast Mode orca worker - demo, Cross-phase review\n',
      '1. Run the `/review-feature demo` command.',
      '2. Write the findings only. Fix nothing, and edit no source file.',
      '`- [ ] CR-<n>: <title>`, under `## Progress` of `code-review.md`.',
      'only when `docs/features/demo/code-review.md`\nexists.',
    ],
    absent: ['Mark each fixed finding', 'part 5 of section 10'],
  },
  {
    name: 'review-fix',
    spec: reviewFixSpec({ feature: 'demo', epic: null }),
    tag: 'demo review-fix',
    parts: [
      '# Beast Mode orca worker - demo, Review fixes\n',
      'into code review groups by section 6.',
      'run one verifier with the verification brief of section 9.',
      '3. Mark each fixed finding `- [x] CR-<n>` in `code-review.md`.',
      'only when `code-review.md` holds no open\n`CR-<n>` line.',
    ],
    absent: ['/review-feature', 'part 5 of section 10'],
  },
  {
    name: 'docs',
    spec: docsSpec({ feature: 'demo', epic: null }),
    tag: 'demo docs',
    parts: ['# Beast Mode orca worker - demo, Docs\n', '1. Run the `/update-feature demo` command.', '2. Run the `/update-master demo` command.'],
    absent: ['/update-epic'],
  },
  {
    name: 'docs in an epic',
    spec: docsSpec({ feature: 'editor/ux', epic: 'editor' }),
    tag: 'editor/ux docs',
    parts: [
      '1. Run the `/update-feature editor/ux` command.',
      '2. Run the `/update-epic editor` command.',
      '3. Run the `/update-master editor` command.',
    ],
    absent: [],
  },
  {
    name: 'inbox',
    spec: inboxSpec({ feature: 'demo', epic: null }),
    tag: 'demo inbox',
    parts: [
      '# Beast Mode orca worker - demo, Inbox\n',
      'In `docs/features/demo/`: `inbox.md`, `implementation.md`, `tasks.md`, and',
      '1. Run part 5 of the post-phase step of section 10 for each open line of `inbox.md`, by the rule of',
      '2. When part 5 sends the step back to part 1, run part 1 of section 10: one fix brief for the open',
      'A medium or a large change is a question for the user.',
      'answer by section 12 rule 9 or rule 10.',
      '4. Build no task of `tasks.md`.',
      'After a large change that writes a new `requirements.md`, act on no other line.',
      '`inbox.md`, and act on it by step 1.',
      'only when `inbox.md` holds no open `bug` or\n`change` line, or when a large change line reads `done: new requirements.md`.',
    ],
    absent: ['/review-feature', 'epic-resolution.md'],
  },
];

for (const { name, spec, tag, parts, absent, nativeAsk } of SPEC_CASES) {
  test(`spec: the ${name} spec holds its parts, names worker_done, and names no harness tool or path`, () => {
    const feature = tag.split(' ')[0];
    // The plan spec asks in its own tab, so it holds no worker `ask` rule for a question.
    const shared = sharedParts(feature, tag).filter((part) => !nativeAsk || !/`ask` command|Start the question with/.test(part));
    for (const part of [...shared, ...parts]) {
      assert.ok(spec.includes(part), `the ${name} spec lacks: ${part}`);
    }
    for (const part of absent) assert.ok(!spec.includes(part), `the ${name} spec holds: ${part}`);
    assert.match(spec, /\bworker_done\b/);
    assert.doesNotMatch(spec, /AskUserQuestion|SlashCommand|ask_user_question|send_message/);
    assert.doesNotMatch(spec, /\bTask\b|\bSkill\b/);
    assert.doesNotMatch(spec, /\bsubagents?\b/i, 'subagent is a dsh tool name');
    assert.doesNotMatch(spec, /\.claude\/|\.agents\//);
    assert.ok(spec.endsWith('\n'));
  });
}

test('spec: the send texts and the note text keep the items word for word, name worker_done, and name no harness tool or path', () => {
  const open = ['Write the hello file', 'CR-2: `hello` reads "hi" & $HOME'];
  const spec = '.beast-mode/briefs/demo/orca-phase-2.md';
  const label = 'Phase 2 of demo';
  const cases = [
    [sendText({ label, reason: 'open-tasks', open, spec }), 'Open items: Phase 2 of demo', ['- Write the hello file\n', '- CR-2: `hello` reads "hi" & $HOME\n']],
    [sendText({ label, reason: 'escalation', open, spec }), 'Resume: Phase 2 of demo', ['by your spec, `.beast-mode/briefs/demo/orca-phase-2.md`.', 'run the `ask` command']],
    [sendText({ label, reason: 'report', open: [], spec }), 'Report: Phase 2 of demo', ['the done proof of your spec holds.']],
    [
      sendText({ label, reason: 'escalation', open, spec, mail: 2, dispatchId: 'disp-1' }),
      'Resume: Phase 2 of demo',
      [
        'You have unread orchestration mail: 2 messages that Orca has not delivered to you.',
        'Read it now with the `check` command of your worker preamble, and act on it.',
        'list the mail with the `inbox` command of Orca for `dispatch:disp-1`, with `--full`.',
      ],
    ],
    [sendText({ label, reason: 'report', open: [], spec, mail: 1, dispatchId: 'disp-1' }), 'Report: Phase 2 of demo', ['You have unread orchestration mail: 1 message that']],
    [sendText({ label, reason: 'missing-verdict', open: [], spec }), 'Verdict: Phase 2 of demo', ['Line 1 is `PASS`, `FAIL`, or `BLOCKED`.']],
    [
      noteText({ feature: 'editor/ux', kind: 'change small', text: 'Move the button.\nKeep the icon.' }),
      'User message (change small)',
      ['Move the button.\nKeep the icon.\n\n---\n', 'of the kind `change small`', '`docs/features/editor/ux/inbox.md`, by section 12 rule 2'],
    ],
  ];
  for (const [text, subject, parts] of cases) {
    assert.equal(text.subject, subject);
    for (const part of parts) assert.ok(text.body.includes(part), `the ${subject} body lacks: ${part}\n${text.body}`);
    assert.match(text.body, /\bworker_done\b|section 12 rule 3/);
    assert.doesNotMatch(text.body, /AskUserQuestion|SlashCommand|ask_user_question|send_message|\bTask\b|\bSkill\b/);
    assert.doesNotMatch(text.body, /\bsubagents?\b/i);
    assert.doesNotMatch(text.body, /\.claude\/|\.agents\//);
  }
});

// ---------------------------------------------------------------------------
// The pure tables of the step frame
// ---------------------------------------------------------------------------

test('exec: the Orca executable follows the environment and the platform, chosen once', () => {
  const cases = [
    [{ ORCA_CLI_COMMAND: ' /opt/orca/bin/orca ' }, 'linux', '/opt/orca/bin/orca'],
    [{ ORCA_CLI_COMMAND: '   ', ORCA_DEV_REPO_ROOT: '/src/orca' }, 'linux', 'orca-dev'],
    [{}, 'linux', 'orca-ide'],
    [{ ORCA_TERMINAL_HANDLE: 'term-1' }, 'linux', 'orca'],
    [{}, 'darwin', 'orca'],
  ];
  for (const [env, platform, expected] of cases) {
    assert.equal(resolveOrcaExecutable(env, platform), expected, JSON.stringify(env));
  }
});

test('exec: the envelope parse reads both outcomes, the agent view failure, and no envelope', () => {
  assert.deepEqual(parseEnvelope('{"ok":true,"result":{"a":1}}\n'), { ok: true, result: { a: 1 } });
  assert.deepEqual(parseEnvelope('{\n  "id": "local",\n  "ok": false,\n  "error": { "code": "runtime_unavailable", "message": "down" }\n}'), {
    ok: false,
    error: { code: 'runtime_unavailable', message: 'down' },
    result: null,
  });
  assert.deepEqual(parseEnvelope('{"ok":false,"result":{"state":"failed"}}', 'error: start_failed: terminal: boom\n'), {
    ok: false,
    error: { code: 'start_failed', message: 'terminal: boom' },
    result: { state: 'failed' },
  });
  assert.deepEqual(parseEnvelope('a profile line\n{"ok":true,"result":null}'), { ok: true, result: null });
  assert.deepEqual(
    parseEnvelope('{"ok":false,"error":{"code":"task_not_startable","message":"Task t failed 3 times.","data":{"failureCount":3}}}'),
    { ok: false, error: { code: 'task_not_startable', message: 'Task t failed 3 times.', data: { failureCount: 3 } }, result: null },
    'the data object of an error stays'
  );
  for (const bad of ['', 'not json', '{"result":{}}', '[1]', undefined]) {
    assert.equal(parseEnvelope(bad), null, String(bad));
  }
});

test('exec: worker-show answers normalize by fact O3, in the field view and the full shape', () => {
  const ok = (result) => ({ kind: 'ok', result, detail: [] });
  const cases = [
    [ok({ state: 'succeeded', stage: 'settled' }), 'done'],
    [ok({ state: 'ready', liveness: 'live', activity: 'working' }), 'busy'],
    [ok({ state: 'ready', liveness: 'live', activity: 'idle' }), 'idle'],
    [ok({ state: 'ready', liveness: 'live', activity: 'waiting' }), 'idle'],
    [ok({ state: 'ready', liveness: 'exited' }), 'gone'],
    [ok({ state: 'ready', liveness: 'unverifiable (host_unavailable)' }), 'unknown'],
    [ok({ state: 'starting' }), 'busy'],
    [ok({ state: 'start_unknown' }), 'unknown'],
    [ok({ state: 'failed', lastError: 'boom' }), 'failed'],
    [ok({ state: 'abandoned' }), 'gone'],
    [ok({ dispatch: { status: 'completed' } }), 'done'],
    [ok({ dispatch: { status: 'circuit_broken' } }), 'circuit'],
    [ok({ dispatch: { status: 'failed' } }), 'failed'],
    [ok({ dispatch: { status: 'dispatched' }, projection: { liveness: { verdict: 'live' }, stage: { activity: 'working' } } }), 'busy'],
    [ok({ dispatch: { status: 'dispatched' }, projection: { liveness: { verdict: 'live' }, stage: { activity: 'done' } } }), 'idle'],
    [ok({ dispatch: { status: 'dispatched' }, observation: { status: 'exited' } }), 'gone'],
    [ok({}), 'unknown'],
    [{ kind: 'failed', code: 'dispatch_not_found', message: 'x', result: null, detail: ['x'] }, 'gone'],
    [{ kind: 'failed', code: 'runtime_unavailable', message: 'x', result: null, detail: ['x'] }, 'unknown'],
    [{ kind: 'spawn-error', code: 'not-found', result: null, detail: ['x'] }, 'unknown'],
  ];
  for (const [answer, state] of cases) {
    assert.equal(normalizeWorker(/** @type {any} */ (answer)).state, state, JSON.stringify(answer));
  }
  const detail = normalizeWorker(ok({ state: 'ready', stage: 'turn', liveness: 'live', activity: 'blocked', waitingOnHuman: 'permission prompt (via hook)' })).detail;
  assert.deepEqual(detail, [
    'Orca: worker ready, stage turn, liveness live, activity blocked.',
    'Orca: the tab waits on a person: permission prompt (via hook)',
  ]);
  assert.equal(normalizeWorker(ok({ state: 'ready', liveness: 'live', activity: 'working', terminal: 'term-7' })).terminal, 'term-7');
  assert.equal(normalizeWorker(ok({ dispatch: { status: 'completed' }, worker: { agentTerminalHandle: 'term-8' } })).terminal, 'term-8');
  assert.equal(normalizeWorker(ok({ state: 'ready' })).terminal, null);
});

test('exec: the run line quotes the three paths and any argument outside the safe set', () => {
  const cli = { node: '/usr/bin/node', bin: '/plugins/beast-mode/installer/bin/beast-mode.js', project: '/home/me/app' };
  assert.equal(
    runLine(cli, ['start', '--feature', 'editor/ux', '--stage', 'phase', '--phase', '2']),
    "'/usr/bin/node' '/plugins/beast-mode/installer/bin/beast-mode.js' orca start --feature editor/ux --stage phase --phase 2 --project '/home/me/app'"
  );
  assert.equal(quoteArg('a b'), "'a b'");
  assert.equal(quoteArg("it's"), "'it'\\''s'");
  assert.equal(quoteArg(''), "''");
  assert.equal(quoteArg('x=1:@+-./'), 'x=1:@+-./');

  const rendered = renderAction(
    {
      schema: 1,
      action: 'stop',
      say: 's',
      reason: 'worker-stopped',
      detail: [],
      fix: 'Run {run} now.',
      fixRun: ['close', '--feature', 'demo'],
      options: [
        { key: 'a', run: null },
        { key: 'b', run: ['close', '--feature', 'demo'] },
      ],
    },
    cli
  );
  const close = runLine(cli, ['close', '--feature', 'demo']);
  assert.equal(rendered.fix, `Run ${close} now.`);
  assert.equal('fixRun' in rendered, false);
  assert.deepEqual(rendered.options, [
    { key: 'a', run: null },
    { key: 'b', run: close },
  ]);
});

test('exec: the porcelain parse lists each path and skips the source of a rename', () => {
  assert.deepEqual(parsePorcelain(' M src/a.js\0?? notes.txt\0R  new.js\0old.js\0'), ['src/a.js', 'notes.txt', 'new.js']);
  assert.deepEqual(parsePorcelain(''), []);
});

/** An Orca answer of a runtime that does not answer. */
const DOWN = {
  status: 1,
  signal: null,
  stdout: '{"ok":false,"error":{"code":"runtime_unavailable","message":"Orca is not running."}}\n',
  stderr: '',
  error: null,
};

/** An Orca answer for a dispatch that Orca does not know. */
const NOT_FOUND = {
  status: 1,
  signal: null,
  stdout: '{"ok":false,"error":{"code":"dispatch_not_found","message":"No dispatch disp-1."}}\n',
  stderr: '',
  error: null,
};

/**
 * An exec context whose runner answers from a list, with a fake sleep.
 *
 * @param {import('../lib/orca/exec.js').RunResult[]} answers
 */
function execContext(answers) {
  /** @type {{ command: string, args: string[], env: Record<string, string | undefined>, timeoutMs: number }[]} */
  const calls = [];
  /** @type {number[]} */
  const sleeps = [];
  const ctx = {
    runner: (command, args, options) => {
      calls.push({ command, args: [...args], env: options.env, timeoutMs: options.timeoutMs });
      const answer = answers.shift();
      assert.ok(answer, `no answer left for: ${command} ${args.join(' ')}`);
      return answer;
    },
    orca: FAKE_ORCA,
    projectRoot: os.tmpdir(),
    env: { KEPT: '1' },
    sleep: (ms) => sleeps.push(ms),
  };
  return { ctx, calls, sleeps };
}

test('exec: the argument builders are pure, and each names its tool, its arguments, its timeout, and a state change', () => {
  assert.deepEqual(orcaCalls.status(), { tool: 'orca', args: ['status', '--json'], timeoutMs: 30000, change: false });
  assert.deepEqual(orcaCalls.workerShow('disp-1'), {
    tool: 'orca',
    args: ['orchestration', 'worker-show', '--dispatch', 'disp-1', '--json'],
    timeoutMs: 30000,
    change: false,
  });
  // A first start passes the Task title (fix 5). No title gives no argument.
  assert.deepEqual(orcaCalls.workerStart({ specFile: '/p/orca-phase-1.md', agent: 'dsh', title: 'demo: Phase 1 implement' }), {
    tool: 'orca',
    args: [
      'orchestration', 'worker-start', '--spec-file', '/p/orca-phase-1.md', '--task-title', 'demo: Phase 1 implement',
      '--worktree', 'current', '--agent', 'dsh', '--timeout-ms', '120000', '--json',
    ],
    timeoutMs: 150000,
    change: true,
  });
  assert.ok(!orcaCalls.workerStart({ specFile: '/p/orca-phase-1.md', agent: 'dsh' }).args.includes('--task-title'));
  const retry = orcaCalls.workerRetry({ taskId: 'task-9', retryOf: 'disp-9', agent: 'claude' });
  assert.deepEqual(retry.args, [
    'orchestration',
    'worker-start',
    '--task',
    'task-9',
    '--retry-of',
    'disp-9',
    '--worktree',
    'current',
    '--agent',
    'claude',
    '--timeout-ms',
    '120000',
    '--json',
  ]);
  assert.deepEqual([retry.timeoutMs, retry.change, retry.args.includes('--spec-file')], [150000, true, false]);
  assert.deepEqual(orcaCalls.workerRelease('disp-1').args, ['orchestration', 'worker-release', '--dispatch', 'disp-1', '--json']);
  assert.deepEqual(orcaCalls.send({ dispatchId: 'disp-1', subject: 'User message (bug)', body: 'a\nb' }), {
    tool: 'orca',
    args: ['orchestration', 'send', '--to', 'dispatch:disp-1', '--subject', 'User message (bug)', '--body', 'a\nb', '--json'],
    timeoutMs: 30000,
    change: true,
  });
  assert.deepEqual(orcaCalls.send({ dispatchId: 'd', subject: 's', body: '--x' }).args.slice(-2), ['--body=--x', '--json']);
  assert.deepEqual(orcaCalls.reply({ id: 'msg_1', body: 'yes' }).args, ['orchestration', 'reply', '--id', 'msg_1', '--body', 'yes', '--json']);
  assert.deepEqual(bodyArgs('-x'), ['--body', '-x']);

  assert.deepEqual(gitCalls.status(), {
    tool: 'git',
    args: ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.', BRIEFS_EXCLUDE],
    timeoutMs: 30000,
    change: false,
  });
  assert.deepEqual(gitCalls.addAll(), { tool: 'git', args: ['add', '-A', '--', '.', BRIEFS_GLOB_EXCLUDE], timeoutMs: 120000, change: true });
  assert.equal('addAllGlob' in gitCalls || 'briefsIgnored' in gitCalls, false, 'CR-5: one staging form, no ignore probe');
  assert.deepEqual(gitCalls.commit('feat: demo phase 1'), {
    tool: 'git',
    args: ['commit', '-m', 'feat: demo phase 1'],
    timeoutMs: 300000,
    change: true,
  });
  assert.deepEqual(gitCalls.switchCreate('feat/demo', 'main').args, ['switch', '-c', 'feat/demo', 'main']);
  assert.deepEqual(gitCalls.setBase('feat/demo', 'main').args, ['config', 'branch.feat/demo.beast-mode-base', 'main']);
  assert.throws(() => call(execContext([]).ctx, { tool: 'sh', args: [], timeoutMs: 1, change: false }), /unknown tool "sh"/);
});

test('exec: an Orca read retries one time after 2 seconds on runtime_unavailable, and a state change never retries', () => {
  assert.equal(RETRY_DELAY_MS, 2000);
  const up = envelope({ state: 'ready', liveness: 'live', activity: 'working' });

  let t = execContext([DOWN, up]);
  let answer = call(t.ctx, orcaCalls.workerShow('disp-1'));
  assert.deepEqual([answer.kind, t.calls.length, t.sleeps], ['ok', 2, [2000]]);

  t = execContext([DOWN, DOWN]);
  answer = call(t.ctx, orcaCalls.status());
  assert.deepEqual([answer.kind, answer.code, t.calls.length, t.sleeps], ['failed', 'runtime_unavailable', 2, [2000]], 'one retry only');

  t = execContext([NOT_FOUND]);
  answer = call(t.ctx, orcaCalls.workerShow('disp-1'));
  assert.deepEqual([answer.code, t.calls.length, t.sleeps], ['dispatch_not_found', 1, []], 'another code never retries');

  const changes = [
    orcaCalls.workerStart({ specFile: '/p/s.md', agent: 'dsh' }),
    orcaCalls.workerRetry({ taskId: 't', retryOf: 'd', agent: 'dsh' }),
    orcaCalls.workerRelease('d'),
    orcaCalls.send({ dispatchId: 'd', subject: 's', body: 'b' }),
    orcaCalls.reply({ id: 'msg_1', body: 'b' }),
  ];
  for (const spec of changes) {
    t = execContext([DOWN, up]);
    answer = call(t.ctx, spec);
    assert.deepEqual([answer.kind, answer.code, t.calls.length, t.sleeps], ['failed', 'runtime_unavailable', 1, []], spec.args[1]);
  }

  // A git call runs one time. A read takes no optional lock, and a failure names the command.
  const refused = { status: 128, signal: null, stdout: '', stderr: 'fatal: not a git repository\n', error: null };
  t = execContext([refused, refused]);
  const read = /** @type {any} */ (call(t.ctx, gitCalls.status()));
  assert.deepEqual([read.ok, read.detail], [
    false,
    ['git status --porcelain=v1 -z --untracked-files=all -- . :(exclude).beast-mode/briefs exited 128.', 'fatal: not a git repository'],
  ]);
  const write = /** @type {any} */ (call(t.ctx, gitCalls.commit('feat: demo phase 1')));
  assert.equal(write.ok, false);
  assert.deepEqual(t.calls.map((entry) => [entry.command, entry.env.GIT_OPTIONAL_LOCKS, entry.env.GIT_TERMINAL_PROMPT, entry.env.KEPT]), [
    ['git', '0', '0', '1'],
    ['git', undefined, '0', '1'],
  ]);
  assert.deepEqual(t.sleeps, []);
});

test('exec: sleepSync blocks the thread for the time that it names, and a bad value waits nothing', () => {
  const elapsed = (fn) => {
    const start = process.hrtime.bigint();
    fn();
    return Number(process.hrtime.bigint() - start) / 1e6;
  };
  const waited = elapsed(() => sleepSync(40));
  assert.ok(waited >= 35, `sleepSync(40) took ${waited} ms`);
  for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.ok(elapsed(() => sleepSync(bad)) < 30, `sleepSync(${bad}) waits nothing`);
  }
});

// ---------------------------------------------------------------------------
// The steps, over a temporary project with a fake runner
// ---------------------------------------------------------------------------

/**
 * The environment of a step test: an Orca tab, the fake Orca executable,
 * and git with no global, system, or inherited repository config.
 *
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
 * A temporary project: both harnesses installed, an orca.json, one feature
 * with an implementation.md and a tasks.md, and a git repository on main
 * with one commit. `docs` adds a doc to the feature folder, and a null
 * value leaves the doc out.
 *
 * @param {{ tasks?: string | null, config?: Record<string, any> | null, docs?: Record<string, string | null> }} [opts]
 * @returns {string}
 */
function makeProject({
  tasks = tasksDoc(phaseText(1, { open: 2, demo: 'hello.txt holds two lines' })),
  config = DEFAULT_CONFIG,
  docs = {},
} = {}) {
  const root = createTempProjectRoot();
  for (const id of ['claude', 'dsh']) {
    const dir = path.join(root, ...adapters[id].harnessRoot.split('/'));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '.beast-mode-manifest.json'), '{}\n');
  }
  if (config !== null) {
    fs.mkdirSync(path.join(root, '.beast-mode'), { recursive: true });
    fs.writeFileSync(path.join(root, '.beast-mode', 'orca.json'), `${JSON.stringify(config, null, 2)}\n`);
  }
  const feature = path.join(root, 'docs', 'features', 'demo');
  fs.mkdirSync(feature, { recursive: true });
  const files = { 'implementation.md': '# Demo - Implementation Plan\n', 'tasks.md': tasks, ...docs };
  for (const [name, body] of Object.entries(files)) {
    if (body !== null) fs.writeFileSync(path.join(feature, name), body);
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
 * @param {{ ok?: boolean, status?: number, stderr?: string }} [opts]
 * @returns {import('../lib/orca/steps.js').RunResult}
 */
function envelope(result, { ok = true, status = 0, stderr = '' } = {}) {
  return { status, signal: null, stdout: `${JSON.stringify({ ok, result })}\n`, stderr, error: null };
}

/**
 * A runner that answers each Orca call from `answers`, keyed by the verb
 * (`status`, `worker-start`, `worker-show`, `worker-release`), and runs git
 * for real. Every call is recorded.
 *
 * @param {Record<string, import('../lib/orca/steps.js').RunResult>} answers
 */
function fakeRunner(answers) {
  /** @type {{ command: string, args: string[], timeoutMs: number }[]} */
  const calls = [];
  /** @type {import('../lib/orca/steps.js').Runner} */
  const runner = (command, args, options) => {
    calls.push({ command, args: [...args], timeoutMs: options.timeoutMs });
    if (command === 'git') return defaultRunner(command, args, options);
    assert.equal(command, FAKE_ORCA, `the runner got the unexpected command ${command}`);
    const verb = args[0] === 'orchestration' ? args[1] : args[0];
    assert.ok(answers[verb], `no fake Orca answer for: ${args.join(' ')}`);
    return answers[verb];
  };
  return {
    runner,
    answers,
    calls,
    orca: () => calls.filter((call) => call.command === FAKE_ORCA).map((call) => call.args),
    git: () => calls.filter((call) => call.command === 'git').map((call) => call.args),
  };
}

/**
 * Run one step and parse its one JSON object.
 *
 * @param {string} root
 * @param {string[]} args
 * @param {{ runner: import('../lib/orca/steps.js').Runner, env?: Record<string, string | undefined>, sleep?: (ms: number) => void,
 *   now?: () => Date }} opts `now`: the clock of the step. Default: the fixed NOW.
 * @returns {{ code: number, json: Record<string, any> }}
 */
function orcaStep(root, args, { runner, env = testEnv(), sleep = () => {}, now = () => NOW }) {
  let out = '';
  const stdout = /** @type {any} */ ({ write: (chunk) => ((out += chunk), true) });
  const code = runOrca([...args, '--project', root], {
    stdout,
    cwd: root,
    pluginRoot: PLUGIN_ROOT,
    env,
    runner,
    sleep,
    platform: 'linux',
    execPath: NODE,
    now,
  });
  const lines = out.split('\n').filter((line) => line.length > 0);
  assert.equal(lines.length, 1, `one JSON object per call, got: ${out}`);
  const json = JSON.parse(lines[0]);
  assert.equal(json.schema, 1);
  return { code, json };
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

/**
 * The `worker-show` answer of a tab whose turn runs. The submit loop of a
 * dsh start reads it one time and presses no Enter (fix 1).
 *
 * @param {string} dispatchId
 * @returns {import('../lib/orca/exec.js').RunResult}
 */
function turnStarted(dispatchId) {
  return envelope({ dispatchId, state: 'ready', stage: 'input_accepted', liveness: 'live', activity: 'working' });
}

test('steps: one phase walks branch, start, wait, close, and commit with the exact arguments', () => {
  const root = makeProject();
  try {
    const fake = fakeRunner({
      status: RUNNING,
      'worker-start': envelope({ runId: 'run-1', taskId: 'task-1', dispatchId: 'disp-1', state: 'ready' }),
      'worker-show': envelope({ dispatchId: 'disp-1', state: 'ready', stage: 'turn', liveness: 'live', activity: 'working' }),
      'worker-release': envelope({ dispatchId: 'disp-1', state: 'already_released', processAction: 'none' }),
    });
    const step = (args) => orcaStep(root, args, { runner: fake.runner });

    // 1. A fresh call on main reads the Orca status, then branches.
    let { code, json } = step(['next', '--feature', 'demo', '--fresh']);
    assert.equal(code, 0);
    assertAction(json, 'branch');
    assert.deepEqual([json.branch, json.base, json.create], ['feat/demo', 'main', true]);
    assert.equal(json.run, lineOf(root, ['branch', '--feature', 'demo']));
    assert.deepEqual(fake.orca(), [['status', '--json']]);

    // 2. branch creates the run branch from main and sets its base key.
    ({ json } = step(['branch', '--feature', 'demo']));
    assert.deepEqual([json.step, json.ok, json.created, json.base], ['branch', true, true, 'main']);
    assert.ok(fake.git().some((args) => JSON.stringify(args) === JSON.stringify(['switch', '-c', 'feat/demo', 'main'])));
    assert.ok(
      fake.git().some((args) => JSON.stringify(args) === JSON.stringify(['config', 'branch.feat/demo.beast-mode-base', 'main']))
    );
    assert.equal(gitIn(root, ['symbolic-ref', '--short', 'HEAD']).trim(), 'feat/demo');
    assert.equal(step(['branch', '--feature', 'demo']).json.created, false, 'a second branch call changes nothing');

    // 3. next starts Phase 1 on dsh.
    ({ json } = step(['next', '--feature', 'demo']));
    assertAction(json, 'start');
    assert.equal(json.run, lineOf(root, ['start', '--feature', 'demo', '--stage', 'phase', '--phase', '1']));

    // 4. start writes the spec, runs worker-start, and records the dispatch.
    ({ json } = step(['start', '--feature', 'demo', '--stage', 'phase', '--phase', '1']));
    assert.deepEqual([json.ok, json.dispatchId, json.agent], [true, 'disp-1', 'dsh']);
    const spec = path.join(root, '.beast-mode', 'briefs', 'demo', 'orca-phase-1.md');
    // The submit loop of the dsh tab reads the tab one time after the start, and the turn runs (fix 1).
    assert.deepEqual(fake.orca().at(-1), ['orchestration', 'worker-show', '--dispatch', 'disp-1', '--json']);
    assert.deepEqual([json.submit, json.enters], ['confirmed', 0]);
    assert.deepEqual(fake.orca().at(-2), [
      'orchestration',
      'worker-start',
      '--spec-file',
      spec,
      '--task-title',
      'demo: Phase 1 implement',
      '--worktree',
      'current',
      '--agent',
      'dsh',
      '--timeout-ms',
      '120000',
      '--json',
    ]);
    assert.equal(fake.calls.at(-2).timeoutMs, 150000);
    assert.ok(fs.readFileSync(spec, 'utf8').startsWith('# Beast Mode orca worker - demo, Phase 1: Slice 1\n'));
    assert.equal(readRecord(root, 'demo').record.active.dispatchId, 'disp-1');

    // 5. A second start refuses, with no Orca call.
    const before = fake.orca().length;
    ({ code, json } = step(['start', '--feature', 'demo', '--stage', 'phase', '--phase', '1']));
    assert.deepEqual([code, json.ok, json.code], [0, false, 'tab-active']);
    assert.equal(fake.orca().length, before);

    // 6. next reads worker-show: a busy tab waits, and a fresh call stops. A dsh tab also reads its mail (fix 7),
    // and a failed mail read (no fake answer here) is no mail.
    ({ json } = step(['next', '--feature', 'demo']));
    assertAction(json, 'wait');
    assert.deepEqual(fake.orca().at(-2), ['orchestration', 'worker-show', '--dispatch', 'disp-1', '--json']);
    assert.deepEqual(fake.orca().at(-1), ['orchestration', 'inbox', '--terminal', 'dispatch:disp-1', '--limit', '50', '--full', '--json']);
    assertStop(step(['next', '--feature', 'demo', '--fresh']).json, 'tab-still-runs');

    // 7. The tab works and reports: the phase closes, with the slice block.
    fs.writeFileSync(path.join(root, 'hello.txt'), 'one\ntwo\n');
    fs.writeFileSync(
      path.join(root, 'docs', 'features', 'demo', 'tasks.md'),
      tasksDoc(phaseText(1, { done: 2, demo: 'hello.txt holds two lines' }))
    );
    fake.answers['worker-show'] = envelope({ dispatchId: 'disp-1', state: 'succeeded', stage: 'settled' });
    ({ json } = step(['next', '--feature', 'demo', '--wake', 'worker_done', '--dispatch', 'disp-1']));
    assertAction(json, 'close');
    assert.match(json.show, /^Slice ready: Phase 1 - Slice 1\nDemo: hello.txt holds two lines\n/);
    assert.equal(json.run, lineOf(root, ['close', '--feature', 'demo']));

    // 8. close releases the tab and clears the record.
    ({ json } = step(['close', '--feature', 'demo']));
    assert.deepEqual([json.ok, json.dispatchId], [true, 'disp-1']);
    assert.deepEqual(fake.orca().at(-1), ['orchestration', 'worker-release', '--dispatch', 'disp-1', '--json']);
    assert.equal(readRecord(root, 'demo').record.active, null);

    // 9. next commits Phase 1.
    ({ json } = step(['next', '--feature', 'demo']));
    assertAction(json, 'commit');
    assert.equal(json.subject, 'feat: demo phase 1');
    assert.equal(json.run, lineOf(root, ['commit', '--feature', 'demo', '--point', 'phase', '--phase', '1']));

    // 10. commit stages every change but the briefs, and commits with the subject.
    ({ json } = step(['commit', '--feature', 'demo', '--point', 'phase', '--phase', '1']));
    assert.deepEqual([json.ok, json.subject], [true, 'feat: demo phase 1']);
    const gitCalls = fake.git().map((args) => JSON.stringify(args));
    assert.ok(gitCalls.includes(JSON.stringify(['add', '-A', '--', '.', BRIEFS_GLOB_EXCLUDE])));
    assert.equal(BRIEFS_GLOB_EXCLUDE, ':(exclude,glob).beast-mode/brief[s]/**');
    assert.ok(!gitCalls.some((line) => line.includes('check-ignore')), 'CR-5: no ignore probe');
    assert.ok(gitCalls.includes(JSON.stringify(['commit', '-m', 'feat: demo phase 1'])));
    assert.equal(gitIn(root, ['log', '-1', '--format=%s']).trim(), 'feat: demo phase 1');
    const committed = gitIn(root, ['show', '--name-only', '--format=', 'HEAD']).split('\n').filter(Boolean);
    assert.deepEqual(committed.sort(), ['docs/features/demo/tasks.md', 'hello.txt']);
    assert.match(gitIn(root, ['status', '--porcelain']), /\?\? \.beast-mode\/briefs\//, 'the helper files stay out of the commit');

    // 11. next moves on to the split review: the review agent claude differs from dsh.
    ({ json } = step(['next', '--feature', 'demo']));
    assertAction(json, 'start');
    assert.deepEqual([json.stage, json.agent, json.phase], ['review', 'claude', null]);
  } finally {
    removeFixture(root);
  }
});

/**
 * The exit-1 receipt of a failed `worker-start` (fact O1, S3).
 *
 * @param {string} dispatchId
 * @returns {import('../lib/orca/exec.js').RunResult}
 */
function failedStartAnswer(dispatchId) {
  return envelope(
    {
      runId: 'run-9',
      taskId: 'task-9',
      dispatchId,
      state: 'failed',
      failedStage: 'terminal',
      lastError: 'boom',
      residualResources: ['terminal term-9', { kind: 'worktree', id: 'wt-1' }],
      recovery: `This start left a worker session open. Close it with: orca orchestration worker-release --dispatch ${dispatchId}`,
    },
    { ok: false, status: 1, stderr: 'error: start_failed: terminal: boom\n' }
  );
}

test('resume: a failed start asks start-failed, the retry runs --task and --retry-of with no spec file, and the third failure stops circuit-broken', () => {
  const root = makeProject();
  try {
    gitIn(root, ['switch', '-q', '-c', 'feat/demo']);
    const fake = fakeRunner({ 'worker-start': failedStartAnswer('disp-9'), 'worker-release': envelope({ state: 'released' }) });
    const step = (args) => orcaStep(root, args, { runner: fake.runner }).json;
    const starts = () => fake.orca().filter((args) => args[1] === 'worker-start');
    const retryArgs = ['start', '--feature', 'demo', '--stage', 'phase', '--phase', '1', '--retry'];

    // 1. The first start fails. The record keeps the exit-1 receipt.
    assert.equal(step(retryArgs).code, 'no-failed-start', 'a retry needs a failed start');
    let json = step(['start', '--feature', 'demo', '--stage', 'phase', '--phase', '1']);
    assert.deepEqual([json.ok, json.code, json.count, json.retry], [false, 'start-failed', 1, false]);
    for (const line of ['Failed stage: terminal.', 'Last error: boom', 'Left open: terminal term-9', 'Left open: {"kind":"worktree","id":"wt-1"}']) {
      assert.ok(json.detail.includes(line), `the detail lacks: ${line}`);
    }
    const failed = readRecord(root, 'demo').record.failedStart;
    assert.deepEqual(
      [failed.stage, failed.phase, failed.agent, failed.taskId, failed.dispatchId, failed.failedStage, failed.count, failed.circuit],
      ['phase', 1, 'dsh', 'task-9', 'disp-9', 'terminal', 1, false]
    );
    assert.deepEqual(failed.residualResources, ['terminal term-9', { kind: 'worktree', id: 'wt-1' }]);
    assert.match(failed.recovery, /worker-release --dispatch disp-9$/);

    // 2. next asks: retry the same stage, or stop. A plain start never runs the failed start again.
    json = step(['next', '--feature', 'demo']);
    assertAction(json, 'ask');
    assert.equal(json.recommended, 'retry');
    assert.deepEqual(json.options.map((option) => [option.key, option.run]), [
      ['retry', lineOf(root, retryArgs)],
      ['stop', null],
    ]);
    assert.equal(step(['start', '--feature', 'demo', '--stage', 'phase', '--phase', '1']).code, 'start-failed');
    assert.equal(step(['start', '--feature', 'demo', '--stage', 'docs', '--retry']).code, 'retry-mismatch');
    assert.equal(starts().length, 1, 'no refusal reaches worker-start');

    // 3. The retry names the Task and the failed dispatch, the placement and the agent again, and no spec.
    fake.answers['worker-start'] = failedStartAnswer('disp-10');
    json = step(retryArgs);
    assert.deepEqual([json.ok, json.code, json.count, json.retry], [false, 'start-failed', 2, true]);
    assert.deepEqual(starts().at(-1), [
      'orchestration',
      'worker-start',
      '--task',
      'task-9',
      '--retry-of',
      'disp-9',
      '--worktree',
      'current',
      '--agent',
      'dsh',
      '--timeout-ms',
      '120000',
      '--json',
    ]);
    assert.ok(json.detail.includes('Failed starts of this Task: 2 of 3.'));
    assert.equal(readRecord(root, 'demo').record.failedStart.dispatchId, 'disp-10', 'the next retry names the newest dispatch');
    assertAction(step(['next', '--feature', 'demo']), 'ask');

    fake.answers['worker-start'] = failedStartAnswer('disp-11');
    json = step(retryArgs);
    assert.equal(json.count, 3);
    assert.deepEqual(starts().at(-1).slice(2, 6), ['--task', 'task-9', '--retry-of', 'disp-10']);
    assert.deepEqual(starts().map((args) => args.includes('--spec-file')), [true, false, false], 'only the first start passes a spec');

    // 4. Three failed starts broke the circuit: next stops, and a retry refuses with no Orca call.
    json = assertStop(step(['next', '--feature', 'demo']), 'circuit-broken');
    assert.ok(json.fix.includes(lineOf(root, ['close', '--feature', 'demo'])), json.fix);
    const calls = fake.orca().length;
    assert.equal(step(retryArgs).code, 'circuit-broken');
    assert.equal(fake.orca().length, calls);

    // 5. close releases the failed dispatch first and clears the record.
    json = step(['close', '--feature', 'demo']);
    assert.equal(json.ok, true);
    assert.deepEqual(fake.orca().at(-1), ['orchestration', 'worker-release', '--dispatch', 'disp-11', '--json']);
    assert.equal(readRecord(root, 'demo').record.failedStart, null);
    assertAction(step(['next', '--feature', 'demo']), 'start');

    // 6. A retry that works records the new dispatch on the same Task, and clears the failed start.
    writeRecord(root, 'demo', {
      ...newRecord('demo'),
      failedStart: { stage: 'phase', phase: 1, agent: 'dsh', taskId: 'task-9', dispatchId: 'disp-12', count: 1, detail: [] },
    });
    fake.answers['worker-start'] = envelope({ runId: 'run-9', dispatchId: 'disp-13', state: 'ready' });
    fake.answers['worker-show'] = turnStarted('disp-13');
    json = step(retryArgs);
    assert.deepEqual([json.ok, json.dispatchId, json.retryOf, json.taskId], [true, 'disp-13', 'disp-12', 'task-9']);
    const record = readRecord(root, 'demo').record;
    assert.deepEqual([record.failedStart, record.active.dispatchId, record.active.taskId], [null, 'disp-13', 'task-9']);

    // 7. A failed start with no Task cannot retry.
    writeRecord(root, 'demo', { ...newRecord('demo'), failedStart: { stage: 'phase', phase: 1, code: 'timeout', count: 1 } });
    assert.equal(step(retryArgs).code, 'retry-unavailable');
  } finally {
    removeFixture(root);
  }
});

test('steps: a record of another schema with an active tab stops next, and start and close refuse it with no Orca call (CR-1)', () => {
  const root = makeProject();
  try {
    gitIn(root, ['switch', '-q', '-c', 'feat/demo']);
    const file = recordPath(root, 'demo');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const body = `${JSON.stringify({ schema: 2, feature: 'demo', active: { stage: 'phase', phase: 1, dispatchId: 'disp-1' } })}\n`;
    fs.writeFileSync(file, body);
    const fake = fakeRunner({});
    const step = (args) => orcaStep(root, args, { runner: fake.runner });

    const next = step(['next', '--feature', 'demo', '--fresh']);
    assert.equal(next.code, 0);
    assertStop(next.json, 'record-unreadable');
    assert.deepEqual(next.json.detail, ['The run record at ".beast-mode/briefs/demo/orca-run.json" does not parse as a record of schema 1.']);
    for (const args of [
      ['start', '--feature', 'demo', '--stage', 'phase', '--phase', '1'],
      ['close', '--feature', 'demo', '--discard'],
    ]) {
      const { code, json } = step(args);
      assert.deepEqual([code, json.ok, json.code], [0, false, 'record-unreadable'], args.join(' '));
    }
    assert.deepEqual(fake.orca(), [], 'no status, no worker-show, no worker-start, and no worker-release');
    assert.equal(fs.readFileSync(file, 'utf8'), body, 'no step replaces a record that it cannot read');
  } finally {
    removeFixture(root);
  }
});

test(
  'steps: a record write that fails after a good start ends the run with the dispatch, and next then asks start-unknown (CR-2)',
  { skip: process.platform === 'win32' || (process.getuid && process.getuid() === 0) ? 'a read-only folder needs a POSIX user that is not root' : false },
  () => {
    const root = makeProject();
    const briefs = path.join(root, '.beast-mode', 'briefs', 'demo');
    try {
      gitIn(root, ['switch', '-q', '-c', 'feat/demo']);
      const fake = fakeRunner({ 'worker-start': envelope({ runId: 'run-1', taskId: 'task-1', dispatchId: 'disp-1', state: 'ready' }) });
      // The briefs folder turns read-only while Orca starts the tab: after the spec, before the record.
      /** @type {import('../lib/orca/steps.js').Runner} */
      const runner = (command, args, options) => {
        if (command === FAKE_ORCA && args[1] === 'worker-start') fs.chmodSync(briefs, 0o555);
        return fake.runner(command, args, options);
      };
      const startArgs = ['start', '--feature', 'demo', '--stage', 'phase', '--phase', '1'];
      const start = orcaStep(root, startArgs, { runner });
      fs.chmodSync(briefs, 0o755);
      assert.equal(start.code, 1, 'the run ends: the coordinator calls no next after an exit that is not 0');
      assert.deepEqual(
        [start.json.step, start.json.ok, start.json.code, start.json.dispatchId, start.json.taskId, start.json.agent],
        ['start', false, 'record-unwritable', 'disp-1', 'task-1', 'dsh']
      );
      assert.equal(start.json.detail[0], 'The tab started, but the run record cannot be written. Fix the cause, then close the tab in Orca before you run again.');
      assert.match(start.json.detail[1], /^The write failed: EACCES/);

      // The record keeps the start entry from before the Orca call: a start whose outcome is unknown.
      const pending = readRecord(root, 'demo').record;
      assert.equal(pending.active, null);
      const entry = pending.failedStart;
      assert.deepEqual([entry.stage, entry.phase, entry.agent, entry.code, entry.unknown, entry.dispatchId], ['phase', 1, 'dsh', 'start-unrecorded', true, null]);

      // next asks start-unknown, and a plain start refuses, so no second tab opens.
      const next = orcaStep(root, ['next', '--feature', 'demo'], { runner: fake.runner });
      assertAction(next.json, 'ask');
      assert.deepEqual([next.json.reason, next.json.recommended], ['start-unknown', 'stop']);
      assert.equal(orcaStep(root, startArgs, { runner: fake.runner }).json.code, 'start-failed');
      assert.equal(fake.orca().filter((args) => args[1] === 'worker-start').length, 1, 'one worker-start in all');

      // close clears the start entry, and the run can start again.
      assert.equal(orcaStep(root, ['close', '--feature', 'demo'], { runner: fake.runner }).json.ok, true);
      assertAction(orcaStep(root, ['next', '--feature', 'demo'], { runner: fake.runner }).json, 'start');
    } finally {
      if (fs.existsSync(briefs)) fs.chmodSync(briefs, 0o755);
      removeFixture(root);
    }
  }
);

test('steps: a worker-start past its time limit records an unknown outcome, next asks start-unknown, and a retry refuses (CR-3)', () => {
  const root = makeProject();
  try {
    gitIn(root, ['switch', '-q', '-c', 'feat/demo']);
    const timeout = {
      status: null,
      signal: 'SIGTERM',
      stdout: '',
      stderr: '',
      error: Object.assign(new Error('spawnSync fake-orca ETIMEDOUT'), { code: 'ETIMEDOUT' }),
    };
    const fake = fakeRunner({ 'worker-start': timeout });
    const step = (args) => orcaStep(root, args, { runner: fake.runner }).json;
    const startArgs = ['start', '--feature', 'demo', '--stage', 'phase', '--phase', '1'];

    const start = step(startArgs);
    assert.deepEqual([start.ok, start.code], [false, 'start-failed']);
    assert.ok(start.detail.includes('The start ran past its time limit, so Orca can have opened the tab.'), start.detail.join('\n'));
    const failed = readRecord(root, 'demo').record.failedStart;
    assert.deepEqual([failed.code, failed.unknown, failed.taskId, failed.dispatchId], ['timeout', true, null, null]);

    const ask = step(['next', '--feature', 'demo']);
    assertAction(ask, 'ask');
    assert.deepEqual([ask.reason, ask.recommended], ['start-unknown', 'stop']);
    assert.deepEqual(ask.options.map((option) => [option.key, option.run]), [
      ['stop', null],
      ['clear', lineOf(root, ['close', '--feature', 'demo'])],
    ]);
    assert.match(ask.options[1].label, /^Clear the start\. Check Orca for a new tab of Phase 1 first, and close it,/);

    // A retry of the same Task can open a second tab, so it refuses with no Orca call.
    assert.equal(step([...startArgs, '--retry']).code, 'retry-unavailable');
    assert.equal(fake.orca().filter((args) => args[1] === 'worker-start').length, 1, 'no second start');
  } finally {
    removeFixture(root);
  }
});

test('steps: a refused release never blocks the clear', () => {
  const root = makeProject();
  try {
    writeRecord(root, 'demo', recordWith().record);
    const fake = fakeRunner({
      'worker-release': envelope(null, { ok: false, status: 1 }),
    });
    fake.answers['worker-release'] = {
      status: 1,
      signal: null,
      stdout: '{"ok":false,"error":{"code":"runtime_unavailable","message":"Orca is not running."}}\n',
      stderr: '',
      error: null,
    };
    const { json } = orcaStep(root, ['close', '--feature', 'demo'], { runner: fake.runner });
    assert.equal(json.ok, true);
    assert.deepEqual(json.release, [
      { dispatchId: 'disp-1', ok: false, code: 'runtime_unavailable', detail: [`${FAKE_ORCA} orchestration worker-release: runtime_unavailable: Orca is not running.`] },
    ]);
    assert.match(json.say, /Orca did not release disp-1/);
    assert.equal(readRecord(root, 'demo').record.active, null);
  } finally {
    removeFixture(root);
  }
});

test('steps: commit refuses the feature cadence, another branch, and an incomplete phase', () => {
  const featureCadence = makeProject({
    tasks: tasksDoc(phaseText(1, { done: 1 })),
    config: { version: 1, orchestration: { commit: 'feature' } },
  });
  const project = makeProject({ tasks: tasksDoc(phaseText(1, { done: 1 }), phaseText(2, { open: 1 })) });
  try {
    const fake = fakeRunner({});
    const commit = (root, phase) =>
      orcaStep(root, ['commit', '--feature', 'demo', '--point', 'phase', '--phase', phase], { runner: fake.runner }).json;

    assert.equal(commit(featureCadence, '1').code, 'cadence');
    assert.equal(commit(project, '1').code, 'not-run-branch');
    gitIn(project, ['switch', '-q', '-c', 'feat/demo']);
    fs.writeFileSync(path.join(project, 'work.txt'), 'x\n');
    const incomplete = commit(project, '2');
    assert.deepEqual([incomplete.code, incomplete.detail], ['phase-incomplete', ['**Task 2.1** open']]);
    assert.equal(commit(project, '3').code, 'phase-missing');
    assert.ok(!fake.git().some((args) => args[0] === 'commit' || args[0] === 'add'), 'no refusal stages or commits');
  } finally {
    removeFixture(featureCadence);
    removeFixture(project);
  }
});

test('steps: a commit hook that fails records the failure, next stops, and a fresh call tries again', () => {
  const root = makeProject({ tasks: tasksDoc(phaseText(1, { done: 1 }), phaseText(2, { open: 1 })) });
  try {
    gitIn(root, ['switch', '-q', '-c', 'feat/demo']);
    fs.writeFileSync(path.join(root, 'work.txt'), 'x\n');
    const hook = path.join(root, '.git', 'hooks', 'pre-commit');
    fs.writeFileSync(hook, '#!/bin/sh\necho "pre-commit: the hook refuses this commit" >&2\nexit 1\n');
    fs.chmodSync(hook, 0o755);
    const fake = fakeRunner({ status: RUNNING });
    const step = (args) => orcaStep(root, args, { runner: fake.runner });

    let { json } = step(['commit', '--feature', 'demo', '--point', 'phase', '--phase', '1']);
    assert.deepEqual([json.ok, json.code], [false, 'commit-failed']);
    assert.ok(json.detail.some((line) => line.includes('the hook refuses this commit')), JSON.stringify(json.detail));
    assert.equal(readRecord(root, 'demo').record.failedGit.step, 'commit');

    assertStop(step(['next', '--feature', 'demo']).json, 'commit-failed');
    ({ json } = step(['next', '--feature', 'demo', '--fresh']));
    assertAction(json, 'commit');

    fs.rmSync(hook);
    ({ json } = step(['commit', '--feature', 'demo', '--point', 'phase', '--phase', '1']));
    assert.equal(json.ok, true);
    assert.equal(readRecord(root, 'demo').record.failedGit, null);
    assertAction(step(['next', '--feature', 'demo']).json, 'start');
  } finally {
    removeFixture(root);
  }
});

test('steps: branch refuses a dirty tree, and next stops dirty-tree', () => {
  const root = makeProject();
  try {
    fs.writeFileSync(path.join(root, 'stray.txt'), 'x\n');
    const fake = fakeRunner({});
    const branch = orcaStep(root, ['branch', '--feature', 'demo'], { runner: fake.runner }).json;
    assert.deepEqual([branch.ok, branch.code, branch.detail], [false, 'dirty-tree', ['stray.txt']]);
    assertStop(orcaStep(root, ['next', '--feature', 'demo'], { runner: fake.runner }).json, 'dirty-tree');
    assert.ok(!fake.git().some((args) => args[0] === 'switch'));
  } finally {
    removeFixture(root);
  }
});

test('steps: next stops with no Orca call for no tab, no settings, a bad reference, and no work tree', () => {
  const bare = makeProject({ config: null });
  const project = makeProject();
  const plain = createTempProjectRoot();
  try {
    const fake = fakeRunner({});
    const noTab = testEnv();
    delete noTab.ORCA_TERMINAL_HANDLE;
    const next = (root, feature, env) =>
      orcaStep(root, ['next', '--feature', feature, '--fresh'], { runner: fake.runner, env }).json;

    assertStop(next(bare, 'demo', noTab), 'not-orca-tab');
    assertStop(next(bare, 'demo'), 'config-missing');
    const bad = assertStop(next(project, '../x'), 'feature-missing');
    assert.match(bad.detail[0], /is not a feature reference/);
    assertStop(next(project, 'other'), 'feature-missing');

    for (const id of ['claude', 'dsh']) {
      const dir = path.join(plain, ...adapters[id].harnessRoot.split('/'));
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, '.beast-mode-manifest.json'), '{}\n');
    }
    fs.mkdirSync(path.join(plain, '.beast-mode'), { recursive: true });
    fs.writeFileSync(path.join(plain, '.beast-mode', 'orca.json'), JSON.stringify(DEFAULT_CONFIG));
    assertStop(next(plain, 'demo'), 'not-git');

    assert.deepEqual(fake.orca(), []);
    assert.ok(!fs.existsSync(path.join(project, '.beast-mode', 'briefs')), 'next writes nothing');
  } finally {
    removeFixture(bare);
    removeFixture(project);
    removeFixture(plain);
  }
});

test('cli: orca reaches its steps through main, and a usage error exits 2 with three lines', () => {
  const root = makeProject();
  try {
    const capture = () => {
      let text = '';
      return { stream: /** @type {any} */ ({ write: (chunk) => ((text += chunk), true) }), text: () => text };
    };
    const usage = [
      ['orca'],
      ['orca', 'bogus'],
      ['orca', 'next'],
      ['orca', 'next', '--feature', 'demo', '--not-a-flag'],
      ['orca', 'next', '--feature'],
      ['orca', 'start', '--feature', 'demo', '--phase', '1.5'],
      ['orca', 'commit', '--feature', 'demo'],
      ['orca', 'next', '--feature', 'demo', 'extra'],
      ['orca', 'next', '--feature', 'demo', '--project', path.join(root, 'missing')],
      ['--project', root, 'orca', 'next'],
    ];
    for (const argv of usage) {
      const out = capture();
      const err = capture();
      const code = main(argv, { stdout: out.stream, stderr: err.stream, cwd: root, env: testEnv(), runner: fakeRunner({}).runner });
      assert.equal(code, 2, argv.join(' '));
      assert.equal(out.text(), '', argv.join(' '));
      assert.equal(err.text().trimEnd().split('\n').length, 3, `${argv.join(' ')}: ${err.text()}`);
    }
    assert.throws(() => runOrca(['bogus'], { stdout: capture().stream, cwd: root, pluginRoot: PLUGIN_ROOT }), UsageError);

    const out = capture();
    const fake = fakeRunner({});
    const noTab = testEnv();
    delete noTab.ORCA_TERMINAL_HANDLE;
    const code = main(['orca', 'next', '--feature', 'demo', '--project', root], {
      stdout: out.stream,
      stderr: capture().stream,
      cwd: root,
      env: noTab,
      runner: fake.runner,
    });
    assert.equal(code, 0);
    assert.equal(JSON.parse(out.text()).reason, 'not-orca-tab');
    assert.deepEqual(fake.orca(), []);
  } finally {
    removeFixture(root);
  }
});

// ---------------------------------------------------------------------------
// Phase 2: the full schema of the orchestration object
// ---------------------------------------------------------------------------

const PHASE_2_CONFIG_CASES = [
  {
    name: 'stages as an array',
    text: '{"version":1,"orchestration":{"stages":[]}}',
    problems: [{ code: 'stages-not-object', at: '$.orchestration.stages' }],
  },
  {
    name: 'stages as null',
    text: '{"version":1,"orchestration":{"stages":null}}',
    problems: [{ code: 'stages-not-object', at: '$.orchestration.stages' }],
  },
  {
    name: 'an unknown stage key',
    text: '{"version":1,"orchestration":{"stages":{"build":"dsh"}}}',
    problems: [{ code: 'stage-unknown', at: '$.orchestration.stages.build' }],
  },
  {
    name: 'a bad agent on plan, verify, review, and docs',
    text: '{"version":1,"orchestration":{"stages":{"plan":"codex","verify":false,"review":true,"docs":1}}}',
    problems: [
      { code: 'stage-agent', at: '$.orchestration.stages.plan' },
      { code: 'stage-agent', at: '$.orchestration.stages.verify' },
      { code: 'stage-agent', at: '$.orchestration.stages.review' },
      { code: 'stage-agent', at: '$.orchestration.stages.docs' },
    ],
  },
  {
    name: 'a review agent of "codex"',
    text: '{"version":1,"orchestration":{"stages":{"review":"codex"}}}',
    problems: [{ code: 'stage-agent', at: '$.orchestration.stages.review' }],
  },
  {
    name: 'a commit value of "phases"',
    text: '{"version":1,"orchestration":{"commit":"phases"}}',
    problems: [{ code: 'commit-value', at: '$.orchestration.commit' }],
  },
  {
    name: 'a commit value of null',
    text: '{"version":1,"orchestration":{"commit":null}}',
    problems: [{ code: 'commit-value', at: '$.orchestration.commit' }],
  },
  {
    name: 'a concurrent value of "yes"',
    text: '{"version":1,"orchestration":{"concurrent":"yes"}}',
    problems: [{ code: 'concurrent-value', at: '$.orchestration.concurrent' }],
  },
  {
    name: 'the typo key "comit" (R3)',
    text: '{"version":1,"orchestration":{"comit":"feature"}}',
    problems: [{ code: 'orchestration-unknown-key', at: '$.orchestration.comit' }],
  },
  {
    name: 'a steps key that is not an array (Phase 8 takes the key)',
    text: '{"version":1,"orchestration":{"steps":{}}}',
    problems: [{ code: 'steps-not-array', at: '$.orchestration.steps' }],
  },
  {
    name: 'an unknown key with a space',
    text: '{"version":1,"orchestration":{"max tabs":2}}',
    problems: [{ code: 'orchestration-unknown-key', at: '$.orchestration["max tabs"]' }],
  },
  {
    name: 'agents as an array',
    text: '{"version":1,"agents":[]}',
    problems: [{ code: 'agents-not-object', at: '$.agents' }],
  },
  {
    name: 'an agent entry that is not an object',
    text: '{"version":1,"agents":{"claude":"claude"}}',
    problems: [{ code: 'agent-not-object', at: '$.agents.claude' }],
  },
  {
    name: 'an agent with env, args, and an unsafe command',
    text: '{"version":1,"agents":{"dsh":{"env":{},"args":[],"command":"dsh;rm"}}}',
    problems: [
      { code: 'agent-env', at: '$.agents.dsh.env' },
      { code: 'agent-args', at: '$.agents.dsh.args' },
      { code: 'agent-command', at: '$.agents.dsh.command' },
    ],
  },
  {
    name: 'problems in the order of the file',
    text: '{"version":2,"agents":{"claude":[]},"orchestration":{"concurrent":0,"stages":{"x":"dsh"},"commit":"never"}}',
    problems: [
      { code: 'version', at: '$.version' },
      { code: 'agent-not-object', at: '$.agents.claude' },
      { code: 'concurrent-value', at: '$.orchestration.concurrent' },
      { code: 'stage-unknown', at: '$.orchestration.stages.x' },
      { code: 'commit-value', at: '$.orchestration.commit' },
    ],
  },
];

for (const { name, text, problems } of PHASE_2_CONFIG_CASES) {
  test(`config (Phase 2): ${name} answers ${problems.map((p) => p.code).join(', ')}`, () => {
    assert.deepEqual(parseOrcaConfig(text), { state: 'invalid', problems });
  });
}

test('config (Phase 2): every allowed value passes, a safe agent command passes, and another agent id stays unchecked', () => {
  const read = parseOrcaConfig(
    JSON.stringify({
      version: 1,
      agents: { claude: { command: 'claude' }, dsh: { command: 'dsh-personal .' }, codex: { env: {} } },
      orchestration: {
        stages: { plan: 'dsh', implement: 'claude', verify: 'claude', review: false, docs: 'dsh' },
        commit: 'feature',
        concurrent: false,
      },
      commands: { 'plan-feature': 'anything' },
    })
  );
  assert.equal(read.state, 'valid', JSON.stringify(read));
  assert.deepEqual(read.orchestration.stages, { plan: 'dsh', implement: 'claude', verify: 'claude', review: false, docs: 'dsh' });
  const commands = [
    ['dsh-personal', true],
    ['dsh-personal .', true],
    ['~/bin/dsh:x@1+2', true],
    ['dsh --profile=x', false],
    ['a  b', false],
    ['', false],
    ['a;b', false],
    ['x'.repeat(200), true],
    ['x'.repeat(201), false],
  ];
  for (const [command, ok] of commands) assert.equal(isCustomCommand(command), ok, command);
});

test('config (Phase 2): the reader stops at 20 problems', () => {
  const orchestration = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`key${i}`, i]));
  const read = parseOrcaConfig(JSON.stringify({ version: 1, orchestration }));
  assert.equal(read.problems.length, 20);
  assert.deepEqual(read.problems[19], { code: 'orchestration-unknown-key', at: '$.orchestration.key19' });
});

// ---------------------------------------------------------------------------
// Phase 2: the doc parses
// ---------------------------------------------------------------------------

test('review: parseReview reads open and closed CR lines and the <feature> CR-<n> form, and never a heading', () => {
  const text = [
    '# Demo - Code Review',
    '## Findings',
    '### CR-1: Barrel import',
    '| CR-1 | High |',
    '## Progress',
    '- [x] CR-1: Barrel import',
    '- [ ] CR-2: Effect state',
    '- [ ] **CR-3**: Bold id',
    '* [X] base CR-1: epic form, closed',
    '- [ ] ux CR-1: epic form, open',
    '- [ ] CR-2: Effect state, a second line',
    '- [ ] Not a finding line',
    '  - [ ] CR-9: indented, counts nowhere',
    '```',
    '- [ ] CR-8: in a fence',
    '```',
  ].join('\n');
  const read = parseReview(text);
  assert.deepEqual(
    read.findings.map((f) => [f.id, f.feature, f.number, f.done]),
    [
      ['CR-1', null, 1, true],
      ['CR-2', null, 2, false],
      ['CR-3', null, 3, false],
      ['base CR-1', 'base', 1, true],
      ['ux CR-1', 'ux', 1, false],
    ]
  );
  assert.deepEqual(read.open, ['CR-2: Effect state', '**CR-3**: Bold id', 'ux CR-1: epic form, open']);
  assert.deepEqual([read.total, read.closed], [5, 2]);
  assert.deepEqual(parseReview('- [x] CR-1: a\n- [ ] CR-1: a again').open, ['CR-1: a again'], 'one open line keeps a finding open');
  assert.deepEqual(parseReview(undefined), { findings: [], open: [], total: 0, closed: 0 });
});

test('docs: parseHumanTests reads the open lines of its section, and parseInbox reads each open line with its kind', () => {
  const context = [
    '# Demo - Context',
    '- [ ] before the section',
    '## Needs Human Verification',
    '',
    '`/autorun-feature` adds one line per item.',
    '',
    '- [ ] [Item that needs a human eye]',
    '- [ ] The page shows one row on a phone',
    '- [x] A checked line',
    '## Session Notes',
    '- [ ] after the section',
  ].join('\n');
  assert.deepEqual(parseHumanTests(context).open, ['The page shows one row on a phone']);
  assert.deepEqual(parseHumanTests(null).open, []);

  const template = fs.readFileSync(path.join(PLUGIN_ROOT, 'templates', 'dev-docs', 'inbox.md'), 'utf8');
  assert.deepEqual(parseInbox(template).open, [], 'the template holds no open line');
  const inbox = [
    template.trimEnd(),
    '- [ ] bug 2026-11-18 10:00 | the save button fails',
    '- [x] note 2026-11-18 10:05 | done | done: phase-2-g1.md',
    '- [ ] change medium 2026-11-18 10:10 | move the panel',
    '- [ ] a line with no kind',
  ].join('\n');
  assert.deepEqual(parseInbox(inbox).open, [
    { kind: 'bug', text: 'bug 2026-11-18 10:00 | the save button fails' },
    { kind: 'change medium', text: 'change medium 2026-11-18 10:10 | move the panel' },
    { kind: null, text: 'a line with no kind' },
  ]);
});

test('docs: readFeatureDocs reads the presence of each doc, the review, the human tests, and the inbox', () => {
  const root = createTempProjectRoot();
  try {
    const dir = path.join(root, 'docs', 'features', 'editor', 'ux');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(root, 'docs', 'features', 'editor', 'epic-overview.md'), '# Editor\n');
    fs.writeFileSync(path.join(dir, 'requirements.md'), '# Requirements\n');
    fs.writeFileSync(path.join(dir, 'tasks.md'), tasksDoc(phaseText(1, { done: 1 })));
    fs.writeFileSync(path.join(dir, 'code-review.md'), '## Progress\n- [ ] CR-1: a\n');
    fs.writeFileSync(path.join(dir, 'context.md'), '## Needs Human Verification\n- [ ] look at it\n');
    fs.writeFileSync(path.join(dir, 'inbox.md'), '## Items\n- [ ] note 2026-11-18 10:00 | hi\n');
    const docs = readFeatureDocs(root, checkFeaturePath('editor/ux'));
    assert.deepEqual(docs.has, { requirements: true, implementation: false, tasks: true, context: true, inbox: true, codeReview: true });
    assert.deepEqual(
      [docs.exists, docs.isEpic, docs.epic, docs.tasks.phases.length, docs.review.open, docs.humanTests, docs.inbox.length],
      [true, false, 'editor', 1, ['CR-1: a'], ['look at it'], 1]
    );
    const missing = readFeatureDocs(root, checkFeaturePath('editor/none'));
    assert.deepEqual([missing.exists, missing.epic, missing.has.tasks, missing.review], [false, 'editor', false, null]);
    const bad = readFeatureDocs(root, checkFeaturePath('../x'));
    assert.deepEqual([bad.valid, bad.exists], [false, false]);
    assert.match(bad.reason, /not a feature reference/);
  } finally {
    removeFixture(root);
  }
});

// ---------------------------------------------------------------------------
// Phase 2: the decision table of the stages
// ---------------------------------------------------------------------------

const TAB = parseOrcaConfig('{"version":1,"orchestration":{"stages":{"implement":"dsh","review":"dsh"}}}');
const OFF = parseOrcaConfig('{"version":1,"orchestration":{"stages":{"review":false}}}');
const FEATURE_CADENCE = parseOrcaConfig('{"version":1,"orchestration":{"commit":"feature"}}');
const COMMITTED = ['feat: demo phase 2', 'feat: demo phase 1'];
const DONE = { state: 'done', detail: [] };

/** @returns {{ phases: import('../lib/orca/read.js').TasksPhase[] }} Two complete phases. */
function allDone() {
  return parseTasks(tasksDoc(phaseText(1, { done: 2 }), phaseText(2, { done: 1 })));
}

/**
 * @param {string} text
 * @returns {Record<string, any>} The docs patch of a code-review.md with this text.
 */
function reviewDocs(text) {
  return { has: { codeReview: true }, review: parseReview(text) };
}

/** @returns {{ record: Record<string, any>, note: null }} A record that marks the docs done. */
function docsDoneRecord() {
  return recordWith({}, { active: null, done: { docs: true, steps: {} } });
}

test('decide F5: every stage that the run still uses needs an installed harness', () => {
  const noPlan = { docs: { has: { implementation: false, tasks: false }, tasks: null } };
  const plan = assertStop(decideFeature(facts({ ...noPlan, harnesses: ['dsh'] })), 'harness-missing');
  assert.deepEqual(plan.detail, ['stages.plan is "claude".', 'stages.review is "claude".', 'The installed harnesses: dsh.']);
  assert.match(plan.fix, /"beast-mode install claude"/);

  assertStop(decideFeature(facts({ harnesses: ['dsh'] })), 'harness-missing');
  const written = decideFeature(
    facts({ harnesses: ['dsh'], docs: { tasks: allDone(), ...reviewDocs('- [x] CR-1: a') }, git: { subjects: COMMITTED } })
  );
  assert.equal(assertAction(written, 'start').stage, 'docs', 'a written review frees the review agent');

  const docsClaude = parseOrcaConfig('{"version":1,"orchestration":{"stages":{"review":false,"docs":"claude"}}}');
  const docs = assertStop(decideFeature(facts({ config: docsClaude, harnesses: ['dsh'] })), 'harness-missing');
  assert.equal(docs.say, 'The docs stage runs on claude, and Beast Mode is not installed for claude.');
  assertAction(decideFeature(facts({ config: docsClaude, harnesses: ['dsh'], record: docsDoneRecord() })), 'start');

  const gone = { docs: { exists: false, tasks: null, has: { implementation: false, tasks: false } } };
  assertStop(decideFeature(facts({ ...gone, config: OFF, harnesses: ['dsh'] })), 'feature-missing');

  // From Phase 9, a split verify opens its own tab, so its agent counts.
  const verifyClaude = parseOrcaConfig('{"version":1,"orchestration":{"stages":{"verify":"claude","review":false}}}');
  const verify = assertStop(decideFeature(facts({ config: verifyClaude, harnesses: ['dsh'] })), 'harness-missing');
  assert.equal(verify.say, 'The verify stage runs on claude, and Beast Mode is not installed for claude.');
  const phase = assertAction(decideFeature(facts({ config: verifyClaude, harnesses: ['claude', 'dsh'] })), 'start');
  assert.deepEqual([phase.stage, phase.phase, phase.agent], ['phase', 1, 'dsh']);
  // With the verify agent equal to the implement agent, no verify tab opens, so no extra harness counts.
  const same = parseOrcaConfig('{"version":1,"orchestration":{"stages":{"implement":"dsh","verify":"dsh","review":false}}}');
  assertAction(decideFeature(facts({ config: same, harnesses: ['dsh'] })), 'start');
});

test('decide A3: the done check of the plan, review, review-fix, and docs tabs', () => {
  const plan = recordWith({ stage: 'plan', phase: null, agent: 'claude' });
  const missing = { has: { implementation: false, tasks: false }, tasks: null };
  const send = assertAction(decideFeature(facts({ docs: missing, record: plan, worker: DONE })), 'send');
  assert.deepEqual(send.open, ['docs/features/demo/implementation.md does not exist.', 'docs/features/demo/tasks.md does not exist.']);
  assert.equal(send.reason, 'open-tasks');
  const noPhase = assertAction(decideFeature(facts({ docs: { tasks: parseTasks('# Demo\n') }, record: plan, worker: DONE })), 'send');
  assert.deepEqual(noPhase.open, ['docs/features/demo/tasks.md holds no "## Phase" section.']);
  const closePlan = assertAction(decideFeature(facts({ record: plan, worker: DONE })), 'close');
  assert.deepEqual([closePlan.stage, closePlan.phase, closePlan.show, closePlan.run], ['plan', null, null, ['close', '--feature', 'demo']]);
  const ask = assertAction(
    decideFeature(facts({ docs: missing, record: recordWith({ stage: 'plan', phase: null, sendBacks: 2 }), worker: DONE })),
    'ask'
  );
  assert.match(ask.question, /^\[demo plan\] /);
  assert.match(ask.options[1].label, /the plan stage/);

  const tasks = allDone();
  const review = recordWith({ stage: 'review', phase: null, agent: 'claude' });
  assert.deepEqual(assertAction(decideFeature(facts({ docs: { tasks }, record: review, worker: DONE })), 'send').open, [
    'docs/features/demo/code-review.md does not exist.',
  ]);
  const closeReview = decideFeature(facts({ docs: { tasks, ...reviewDocs('- [ ] CR-1: a') }, record: review, worker: DONE }));
  assert.equal(assertAction(closeReview, 'close').stage, 'review');

  const fix = recordWith({ stage: 'review-fix', phase: null });
  const fixSend = decideFeature(facts({ docs: { tasks, ...reviewDocs('- [x] CR-1: a\n- [ ] CR-2: b') }, record: fix, worker: DONE }));
  assert.deepEqual(assertAction(fixSend, 'send').open, ['CR-2: b']);
  const fixClose = decideFeature(facts({ docs: { tasks, ...reviewDocs('- [x] CR-1: a') }, record: fix, worker: DONE }));
  assert.equal(assertAction(fixClose, 'close').stage, 'review-fix');

  const docsClose = decideFeature(facts({ docs: { tasks }, record: recordWith({ stage: 'docs', phase: null }), worker: DONE }));
  assert.equal(assertAction(docsClose, 'close').stage, 'docs');
  assertStop(decideFeature(facts({ record: recordWith({ stage: 'mystery' }), worker: DONE })), 'worker-stopped');
});

test('decide F16 and A3: with the review in the tab, the last phase runs until code-review.md holds no open finding', () => {
  const tasks = allDone();
  const again = assertAction(decideFeature(facts({ config: TAB, docs: { tasks }, git: { subjects: COMMITTED } })), 'start');
  assert.deepEqual([again.stage, again.phase, again.agent], ['phase', 2, 'dsh']);
  assert.match(again.say, /with the cross-phase review/);
  assert.equal(decideFeature(facts({ config: TAB, docs: { tasks, ...reviewDocs('- [ ] CR-1: a') } })).phase, 2);
  const unreadable = { tasks, has: { codeReview: true }, review: null, reviewError: 'EACCES: permission denied' };
  assertStop(decideFeature(facts({ config: TAB, docs: unreadable })), 'review-unreadable');

  const active = recordWith({ phase: 2, review: true });
  const send = assertAction(decideFeature(facts({ config: TAB, docs: { tasks }, record: active, worker: DONE })), 'send');
  assert.deepEqual(send.open, ['docs/features/demo/code-review.md does not exist.']);
  assert.match(send.say, /the cross-phase review is not closed/);
  const closed = { tasks, ...reviewDocs('- [x] CR-1: a') };
  assertAction(decideFeature(facts({ config: TAB, docs: closed, record: active, worker: DONE })), 'close');

  const commit = assertAction(
    decideFeature(facts({ config: TAB, docs: closed, git: { subjects: ['feat: demo phase 1'], dirty: ['src/a.js'] } })),
    'commit'
  );
  assert.deepEqual([commit.point, commit.phase], ['phase', 2]);
  const docs = decideFeature(facts({ config: TAB, docs: closed, git: { subjects: COMMITTED, dirty: ['src/late.js'] } }));
  assert.equal(assertAction(docs, 'start').stage, 'docs', 'the tab placement opens no review tab and makes no review commit');
});

test('decide F17: review false skips the review stage, and the placement follows the agents', () => {
  const action = assertAction(decideFeature(facts({ config: OFF, docs: { tasks: allDone() }, git: { subjects: COMMITTED } })), 'start');
  assert.equal(action.stage, 'docs');
  assert.equal(reviewPlacement({ implement: 'dsh', review: false }), 'off');
  assert.equal(reviewPlacement({ implement: 'dsh', review: 'dsh' }), 'tab');
  assert.equal(reviewPlacement({ implement: 'dsh', review: 'claude' }), 'split');
});

test('decide F17 and F18: a split review starts the review tab, then the review-fix tab, then the review commit', () => {
  const tasks = allDone();
  const review = assertAction(decideFeature(facts({ docs: { tasks }, git: { subjects: COMMITTED } })), 'start');
  assert.deepEqual(
    { run: review.run, stage: review.stage, phase: review.phase, agent: review.agent },
    { run: ['start', '--feature', 'demo', '--stage', 'review'], stage: 'review', phase: null, agent: 'claude' }
  );
  const fix = assertAction(decideFeature(facts({ docs: { tasks, ...reviewDocs('- [ ] CR-1: a\n- [ ] CR-2: b') } })), 'start');
  assert.deepEqual([fix.stage, fix.agent], ['review-fix', 'dsh']);
  assert.match(fix.say, /2 open findings/);

  const closed = { tasks, ...reviewDocs('- [x] CR-1: a\n- [x] CR-2: b') };
  const commit = assertAction(decideFeature(facts({ docs: closed, git: { subjects: COMMITTED, dirty: ['src/a.js'] } })), 'commit');
  assert.deepEqual(
    { run: commit.run, point: commit.point, phase: commit.phase, subject: commit.subject },
    { run: ['commit', '--feature', 'demo', '--point', 'review'], point: 'review', phase: null, subject: 'fix: demo cross-phase review' }
  );
  for (const patch of [
    { git: { subjects: ['fix: demo cross-phase review', ...COMMITTED], dirty: ['src/a.js'] } },
    { git: { subjects: COMMITTED, dirty: [] } },
    { config: FEATURE_CADENCE, git: { subjects: [], dirty: ['src/a.js'] } },
  ]) {
    assert.equal(assertAction(decideFeature(facts({ docs: closed, ...patch })), 'start').stage, 'docs', JSON.stringify(patch));
  }
  const afterDocs = { docs: closed, git: { subjects: COMMITTED, dirty: ['docs/overview.md'] }, record: docsDoneRecord() };
  assertAction(decideFeature(facts(afterDocs)), 'done');

  const failed = recordWith({}, { active: null, failedGit: { step: 'commit', phase: null, point: 'review', detail: ['hook refused.'] } });
  const dirtyClosed = { docs: closed, git: { subjects: COMMITTED, dirty: ['src/a.js'] }, record: failed };
  assert.deepEqual(assertStop(decideFeature(facts(dirtyClosed)), 'commit-failed').detail, ['hook refused.']);
  assertAction(decideFeature(facts({ ...dirtyClosed, flags: { fresh: true } })), 'commit');
});

test('decide F16: a phase commit takes only the newest work', () => {
  const later = parseTasks(tasksDoc(phaseText(1, { done: 2 }), phaseText(2, { done: 1, open: 1 })));
  const action = assertAction(decideFeature(facts({ docs: { tasks: later }, git: { dirty: ['src/b.js'] } })), 'start');
  assert.equal(action.phase, 2, 'a later phase with a done task holds the changes');
  const afterReview = decideFeature(
    facts({
      docs: { tasks: allDone(), ...reviewDocs('- [ ] CR-1: a') },
      git: { subjects: ['feat: demo phase 1'], dirty: ['docs/features/demo/code-review.md'] },
    })
  );
  assert.equal(assertAction(afterReview, 'start').stage, 'review-fix', 'the review changes never commit as Phase 2');
});

test('decide F21: the docs tab runs until the record marks it, with /update-epic in an epic', () => {
  const closed = { tasks: allDone(), ...reviewDocs('- [x] CR-1: a') };
  const start = assertAction(decideFeature(facts({ docs: closed, git: { subjects: COMMITTED } })), 'start');
  assert.deepEqual(
    { run: start.run, stage: start.stage, phase: start.phase, agent: start.agent },
    { run: ['start', '--feature', 'demo', '--stage', 'docs'], stage: 'docs', phase: null, agent: 'dsh' }
  );
  assert.match(start.say, /\/update-feature demo, \/update-master demo\.$/);
  const epic = decideFeature(
    facts({
      feature: 'editor/ux',
      docs: { ...closed, epic: 'editor' },
      git: { head: 'feat/editor/ux', runBranch: 'feat/editor/ux', subjects: ['feat: editor/ux phase 1', 'feat: editor/ux phase 2'] },
    })
  );
  assert.match(assertAction(epic, 'start').say, /\/update-feature editor\/ux, \/update-epic editor, \/update-master editor\.$/);
  assertAction(decideFeature(facts({ docs: closed, git: { subjects: COMMITTED }, record: docsDoneRecord() })), 'done');
});

// ---------------------------------------------------------------------------
// Phase 2: the stage walks over a temporary project
// ---------------------------------------------------------------------------

/**
 * @param {Record<string, any>} config
 * @returns {string} A project whose feature holds requirements.md alone.
 */
function walkProject(config) {
  return makeProject({ tasks: null, config, docs: { 'implementation.md': null, 'requirements.md': '# Demo - Requirements\n' } });
}

/**
 * The work of each tab of the walk: it moves the fixture tree forward, as
 * the tab of the stage would.
 *
 * @param {string} root
 * @param {{ reviewInTab?: boolean }} [opts]
 * @returns {(stage: string, phase: number | null) => void}
 */
function walkWork(root, { reviewInTab = false } = {}) {
  const dir = path.join(root, 'docs', 'features', 'demo');
  const write = (name, body) => fs.writeFileSync(path.join(dir, name), body);
  const tasksAfter = (done) =>
    tasksDoc(
      phaseText(1, done >= 1 ? { done: 2, demo: 'a.txt holds one line' } : { open: 2, demo: 'a.txt holds one line' }),
      phaseText(2, done >= 2 ? { done: 1 } : { open: 1 })
    );
  return (stage, phase) => {
    if (stage === 'plan') {
      write('implementation.md', '# Demo - Implementation Plan\n');
      write('tasks.md', tasksAfter(0));
      write('context.md', '# Demo - Context\n\n## Needs Human Verification\n\n- [ ] [Item that needs a human eye]\n');
      write('inbox.md', '# Demo - Inbox\n\n## Items\n');
    } else if (stage === 'phase') {
      write('tasks.md', tasksAfter(/** @type {number} */ (phase)));
      fs.writeFileSync(path.join(root, `phase-${phase}.txt`), `phase ${phase}\n`);
      if (phase === 1) {
        write('context.md', '# Demo - Context\n\n## Needs Human Verification\n\n- [ ] a.txt reads well on a phone\n');
        write('inbox.md', '# Demo - Inbox\n\n## Items\n- [ ] note 2026-11-18 10:00 | keep the old icon\n');
      }
      if (phase === 2 && reviewInTab) write('code-review.md', '# Demo - Code Review\n\n## Progress\n- [x] CR-1: one\n');
    } else if (stage === 'review') {
      write('code-review.md', '# Demo - Code Review\n\n## Progress\n- [ ] CR-1: one\n- [ ] CR-2: two\n');
    } else if (stage === 'review-fix') {
      write('code-review.md', '# Demo - Code Review\n\n## Progress\n- [x] CR-1: one\n- [x] CR-2: two\n');
      fs.writeFileSync(path.join(root, 'phase-2.txt'), 'phase 2, reviewed\n');
    } else if (stage === 'docs') {
      fs.appendFileSync(path.join(dir, 'context.md'), '\n## Session Notes\n\n- The run is done.\n');
    }
  };
}

/**
 * Walk a feature run from a fresh `next` to `done` over the real steps.
 * Each `run` line must name the step that the walk runs. After each start,
 * a busy tab waits, `work` moves the tree forward, and the fake runner
 * answers `completed`.
 *
 * @param {string} root
 * @param {ReturnType<typeof fakeRunner>} fake
 * @param {(stage: string, phase: number | null) => void} work
 * @param {string[]} [until] The actions that end the walk. A walk of a fix or a verify tab ends at an `ask`, too.
 * @returns {{ trail: string[], done: Record<string, any>, actions: Record<string, any>[] }}
 */
function walk(root, fake, work, until = ['done']) {
  /** @type {string[]} */
  const trail = [];
  /** @type {Record<string, any>[]} */
  const actions = [];
  const step = (args) => orcaStep(root, args, { runner: fake.runner }).json;
  let starts = 0;
  let json = step(['next', '--feature', 'demo', '--fresh']);
  for (let i = 0; i < 40; i += 1) {
    if (until.includes(json.action)) return { trail, done: json, actions };
    actions.push(json);
    /** @type {string[]} */
    let args;
    if (json.action === 'branch') {
      args = ['branch', '--feature', 'demo'];
      trail.push('branch');
    } else if (json.action === 'start') {
      args = [
        'start',
        '--feature',
        'demo',
        '--stage',
        json.stage,
        ...(json.stage === 'step' ? ['--step', String(json.step)] : []),
        // Phase 0 is a real phase, so the walk tests the type, never the truth of the number.
        ...(typeof json.phase === 'number' ? ['--phase', String(json.phase)] : []),
        ...(json.round ? ['--round', String(json.round)] : []),
      ];
      trail.push(`start ${json.stage}${typeof json.phase === 'number' ? ` ${json.phase}` : ''}`);
      starts += 1;
      fake.answers['worker-start'] = envelope({ runId: 'run-1', taskId: `task-${starts}`, dispatchId: `disp-${starts}`, state: 'ready' });
      // The submit loop of a dsh start reads the new tab one time (fix 1).
      fake.answers['worker-show'] = turnStarted(`disp-${starts}`);
    } else if (json.action === 'close') {
      args = ['close', '--feature', 'demo'];
      trail.push(`close ${json.stage}`);
    } else if (json.action === 'commit') {
      args = ['commit', '--feature', 'demo', '--point', json.point, ...(json.point === 'phase' ? ['--phase', String(json.phase)] : [])];
      trail.push(`commit ${json.point}${typeof json.phase === 'number' ? ` ${json.phase}` : ''}`);
    } else {
      assert.fail(`the walk got the action ${json.action}: ${JSON.stringify(json)}`);
    }
    assert.equal(json.run, lineOf(root, args), 'the run line names the step that the walk runs');
    const result = step(args);
    assert.equal(result.ok, true, JSON.stringify(result));
    if (json.action === 'start') {
      fake.answers['worker-show'] = envelope({ dispatchId: result.dispatchId, state: 'ready', liveness: 'live', activity: 'working' });
      assertAction(step(['next', '--feature', 'demo']), 'wait');
      work(json.stage, json.phase);
      fake.answers['worker-show'] = envelope({ dispatch: { dispatchId: result.dispatchId, status: 'completed' } });
      json = step(['next', '--feature', 'demo', '--wake', 'worker_done', '--dispatch', result.dispatchId]);
    } else {
      json = step(['next', '--feature', 'demo']);
    }
  }
  return assert.fail(`the walk did not reach done: ${trail.join(', ')}`);
}

/**
 * @param {ReturnType<typeof fakeRunner>} fake
 * @returns {string[]} The --agent value of each worker-start.
 */
function startAgents(fake) {
  return fake
    .orca()
    .filter((args) => args[1] === 'worker-start')
    .map((args) => args[args.indexOf('--agent') + 1]);
}

test('walk: requirements.md alone walks plan, phases, a split review, the review commit, docs, and done', () => {
  const root = walkProject(DEFAULT_CONFIG);
  try {
    const fake = fakeRunner({ status: RUNNING, 'worker-release': envelope({ state: 'already_released' }) });
    const { trail, done } = walk(root, fake, walkWork(root));
    assert.deepEqual(trail, [
      'branch',
      'start plan',
      'close plan',
      'start phase 1',
      'close phase',
      'commit phase 1',
      'start phase 2',
      'close phase',
      'commit phase 2',
      'start review',
      'close review',
      'start review-fix',
      'close review-fix',
      'commit review',
      'start docs',
      'close docs',
    ]);
    assert.deepEqual(startAgents(fake), ['claude', 'dsh', 'dsh', 'claude', 'dsh', 'dsh']);
    const briefs = path.join(root, '.beast-mode', 'briefs', 'demo');
    for (const name of ['orca-plan.md', 'orca-phase-1.md', 'orca-phase-2.md', 'orca-review.md', 'orca-review-fix.md', 'orca-docs.md']) {
      assert.ok(fs.existsSync(path.join(briefs, name)), `${name} is missing`);
    }
    assert.ok(!fs.readFileSync(path.join(briefs, 'orca-phase-2.md'), 'utf8').includes('/review-feature'));
    assert.match(fs.readFileSync(path.join(briefs, 'orca-plan.md'), 'utf8'), /\/plan-feature demo/);
    assert.deepEqual(gitIn(root, ['log', '--format=%s', 'main..HEAD']).trim().split('\n'), [
      'fix: demo cross-phase review',
      'feat: demo phase 2',
      'feat: demo phase 1',
    ]);
    for (const part of [
      '- Phase 1 - Slice 1: committed as "feat: demo phase 1"\n- Phase 2 - Slice 2: committed as "feat: demo phase 2"',
      'Review: a claude review tab, with the fixes on dsh, 2 findings, 2 closed. Committed as "fix: demo cross-phase review".',
      'Docs: the docs tab ran /update-feature demo, /update-master demo.',
      'Uncommitted: 1 file on feat/demo.\n- docs/features/demo/context.md',
      'Human tests: 1 open line',
      'Inbox: 1 open line in docs/features/demo/inbox.md.\n- [ ] note 2026-11-18 10:00 | keep the old icon',
      '- Merge feat/demo into main when you are ready.',
    ]) {
      assert.ok(done.show.includes(part), `the summary lacks: ${part}\n${done.show}`);
    }
  } finally {
    removeFixture(root);
  }
});

test('walk: with the review in the last phase tab, the walk opens no review tab and makes no review commit', () => {
  const root = walkProject({ version: 1, orchestration: { stages: { implement: 'dsh', review: 'dsh' } } });
  try {
    const fake = fakeRunner({ status: RUNNING, 'worker-release': envelope({ state: 'already_released' }) });
    const { trail, done } = walk(root, fake, walkWork(root, { reviewInTab: true }));
    assert.deepEqual(trail, [
      'branch',
      'start plan',
      'close plan',
      'start phase 1',
      'close phase',
      'commit phase 1',
      'start phase 2',
      'close phase',
      'commit phase 2',
      'start docs',
      'close docs',
    ]);
    assert.deepEqual(startAgents(fake), ['claude', 'dsh', 'dsh', 'dsh']);
    const briefs = path.join(root, '.beast-mode', 'briefs', 'demo');
    assert.ok(fs.readFileSync(path.join(briefs, 'orca-phase-2.md'), 'utf8').includes('3. Then run the `/review-feature demo` command.'));
    assert.ok(!fs.readFileSync(path.join(briefs, 'orca-phase-1.md'), 'utf8').includes('/review-feature'));
    assert.deepEqual(gitIn(root, ['log', '--format=%s', 'main..HEAD']).trim().split('\n'), ['feat: demo phase 2', 'feat: demo phase 1']);
    assert.ok(gitIn(root, ['show', '--name-only', '--format=', 'HEAD']).includes('docs/features/demo/code-review.md'));
    assert.ok(done.show.includes('Review: in the Phase 2 tab on dsh, 1 finding, 1 closed.'), done.show);
  } finally {
    removeFixture(root);
  }
});

test('walk: the feature cadence walks every stage and passes no git commit argument array at any point', () => {
  const root = walkProject({ version: 1, orchestration: { commit: 'feature' } });
  try {
    const fake = fakeRunner({ status: RUNNING, 'worker-release': envelope({ state: 'already_released' }) });
    const { trail, done } = walk(root, fake, walkWork(root));
    assert.deepEqual(trail, [
      'branch',
      'start plan',
      'close plan',
      'start phase 1',
      'close phase',
      'start phase 2',
      'close phase',
      'start review',
      'close review',
      'start review-fix',
      'close review-fix',
      'start docs',
      'close docs',
    ]);
    assert.ok(!fake.git().some((args) => args[0] === 'commit' || args[0] === 'add'), 'no git add and no git commit');
    assert.equal(gitIn(root, ['log', '--format=%s']).trim(), 'init');
    assert.ok(done.show.includes('- Phase 1 - Slice 1: complete, with no phase commit'), done.show);
    assert.ok(done.show.includes('The feature cadence makes no commit.'), done.show);
  } finally {
    removeFixture(root);
  }
});

// ---------------------------------------------------------------------------
// Phase 2: the act steps of the stages, and reply
// ---------------------------------------------------------------------------

test('steps: start checks the guard of each stage, and a refusal makes no Orca call', () => {
  const tasks = tasksDoc(phaseText(1, { done: 1 }));
  const split = makeProject({ tasks });
  const off = makeProject({ tasks, config: { version: 1, orchestration: { stages: { review: false } } } });
  const tab = makeProject({ tasks, config: { version: 1, orchestration: { stages: { implement: 'dsh', review: 'dsh' } } } });
  try {
    for (const root of [split, off, tab]) gitIn(root, ['switch', '-q', '-c', 'feat/demo']);
    const fake = fakeRunner({
      'worker-start': envelope({ runId: 'run-1', taskId: 'task-1', dispatchId: 'disp-1', state: 'ready' }),
      'worker-show': turnStarted('disp-1'),
    });
    const start = (root, stage, extra = []) =>
      orcaStep(root, ['start', '--feature', 'demo', '--stage', stage, ...extra], { runner: fake.runner }).json;

    assert.equal(start(split, 'plan').code, 'plan-complete');
    assert.equal(start(split, 'mystery').code, 'stage-not-supported');
    assert.equal(start(split, 'verify', ['--phase', '1']).code, 'verify-same-agent');
    assert.equal(start(split, 'review-fix').code, 'review-missing');
    assert.equal(start(split, 'docs').code, 'review-open');
    fs.writeFileSync(path.join(split, 'docs', 'features', 'demo', 'code-review.md'), '## Progress\n- [x] CR-1: one\n');
    assert.equal(start(split, 'review').code, 'review-written');
    assert.equal(start(split, 'review-fix').code, 'review-closed');
    writeRecord(split, 'demo', { ...newRecord('demo'), done: { docs: true, steps: {} } });
    assert.equal(start(split, 'docs').code, 'docs-done');
    assert.equal(start(off, 'review').code, 'review-off');
    assert.equal(start(off, 'phase', ['--phase', '1']).code, 'phase-complete');
    assert.equal(start(tab, 'review').code, 'review-in-phase');
    assert.deepEqual(fake.orca(), [], 'no refusal reaches Orca');

    const json = start(tab, 'phase', ['--phase', '1']);
    assert.equal(json.ok, true, JSON.stringify(json));
    assert.equal(readRecord(tab, 'demo').record.active.review, true);
    assert.match(fs.readFileSync(path.join(tab, '.beast-mode', 'briefs', 'demo', 'orca-phase-1.md'), 'utf8'), /\/review-feature demo/);
  } finally {
    removeFixture(split);
    removeFixture(off);
    removeFixture(tab);
  }
});

test('steps: close marks the docs done, --discard marks nothing, and a phase start clears the marks', () => {
  const root = makeProject({ tasks: tasksDoc(phaseText(1, { done: 1 }), phaseText(2, { open: 1 })) });
  try {
    gitIn(root, ['switch', '-q', '-c', 'feat/demo']);
    const fake = fakeRunner({
      'worker-release': envelope({ state: 'released' }),
      'worker-start': envelope({ runId: 'run-2', taskId: 'task-2', dispatchId: 'disp-2', state: 'ready' }),
      'worker-show': turnStarted('disp-2'),
    });
    const step = (args) => orcaStep(root, args, { runner: fake.runner }).json;

    writeRecord(root, 'demo', recordWith({ stage: 'docs', phase: null }).record);
    let json = step(['close', '--feature', 'demo', '--discard']);
    assert.deepEqual([json.ok, json.discard, json.docsDone], [true, true, false]);
    assert.equal(readRecord(root, 'demo').record.done.docs, false);

    writeRecord(root, 'demo', recordWith({ stage: 'docs', phase: null }).record);
    json = step(['close', '--feature', 'demo']);
    assert.deepEqual([json.ok, json.discard, json.docsDone], [true, false, true]);
    assert.match(json.say, /The docs are marked done\./);
    assert.equal(readRecord(root, 'demo').record.done.docs, true);

    json = step(['start', '--feature', 'demo', '--stage', 'phase', '--phase', '2']);
    assert.equal(json.ok, true, JSON.stringify(json));
    const record = readRecord(root, 'demo').record;
    assert.deepEqual([record.done.docs, record.done.steps, record.active.stage, record.active.review], [false, {}, 'phase', false]);
  } finally {
    removeFixture(root);
  }
});

test('steps: commit --point review commits the closed split review once, with its subject', () => {
  const root = makeProject({ tasks: tasksDoc(phaseText(1, { done: 1 })), docs: { 'code-review.md': '## Progress\n- [ ] CR-1: one\n' } });
  try {
    gitIn(root, ['switch', '-q', '-c', 'feat/demo']);
    const fake = fakeRunner({});
    const commit = () => orcaStep(root, ['commit', '--feature', 'demo', '--point', 'review'], { runner: fake.runner }).json;
    fs.writeFileSync(path.join(root, 'fix.txt'), 'x\n');
    assert.equal(commit().code, 'review-open');
    fs.writeFileSync(path.join(root, 'docs', 'features', 'demo', 'code-review.md'), '## Progress\n- [x] CR-1: one\n');
    writeRecord(root, 'demo', { ...newRecord('demo'), done: { docs: true, steps: {} } });
    assert.equal(commit().code, 'docs-done');
    assert.ok(!fake.git().some((args) => args[0] === 'commit' || args[0] === 'add'), 'no refusal stages or commits');

    writeRecord(root, 'demo', newRecord('demo'));
    const json = commit();
    assert.deepEqual([json.ok, json.point, json.phase, json.subject], [true, 'review', null, 'fix: demo cross-phase review']);
    assert.ok(fake.git().some((args) => JSON.stringify(args) === JSON.stringify(['commit', '-m', 'fix: demo cross-phase review'])));
    assert.equal(gitIn(root, ['log', '-1', '--format=%s']).trim(), 'fix: demo cross-phase review');
    fs.writeFileSync(path.join(root, 'more.txt'), 'y\n');
    assert.equal(commit().code, 'review-committed');
  } finally {
    removeFixture(root);
  }
});

test('steps: reply passes the answer as one argument, and an answer that starts with -- takes the equals form', () => {
  const root = makeProject();
  try {
    const fake = fakeRunner({ reply: envelope({ messageId: 'msg_2', delivered: true }) });
    const file = path.join(root, '.beast-mode', 'briefs', 'orca', 'answer.md');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const answer = 'Use the blue one; it\'s "fine" & $HOME stays `as is`.\nA second line.';
    fs.writeFileSync(file, `${answer}\n\n`);
    let { code, json } = orcaStep(root, ['reply', '--id', 'msg_1', '--body-file', file], { runner: fake.runner });
    assert.equal(code, 0);
    assert.deepEqual([json.step, json.ok, json.id, json.result], ['reply', true, 'msg_1', { messageId: 'msg_2', delivered: true }]);
    assert.deepEqual(fake.orca().at(-1), ['orchestration', 'reply', '--id', 'msg_1', '--body', answer, '--json']);

    fs.writeFileSync(file, '--force is fine\n');
    ({ json } = orcaStep(root, ['reply', '--id', 'msg_1', '--body-file', '.beast-mode/briefs/orca/answer.md'], { runner: fake.runner }));
    assert.equal(json.ok, true, 'a relative file resolves against the working directory');
    assert.deepEqual(fake.orca().at(-1), ['orchestration', 'reply', '--id', 'msg_1', '--body=--force is fine', '--json']);
    assert.deepEqual(bodyArgs('-x'), ['--body', '-x']);
  } finally {
    removeFixture(root);
  }
});

test('steps: reply refuses a missing, an empty, a large, a NUL, or a folder answer with no Orca call, and names an Orca failure', () => {
  const root = makeProject();
  try {
    const fake = fakeRunner({});
    const file = path.join(root, 'answer.md');
    const reply = () => orcaStep(root, ['reply', '--id', 'msg_1', '--body-file', file], { runner: fake.runner }).json;
    assert.equal(reply().code, 'body-missing');
    fs.writeFileSync(file, '  \n\n');
    assert.equal(reply().code, 'body-empty');
    fs.writeFileSync(file, 'a'.repeat(MAX_REPLY_BYTES + 1));
    assert.equal(reply().code, 'body-too-large');
    fs.writeFileSync(file, 'a\0b');
    assert.equal(reply().code, 'body-invalid');
    fs.rmSync(file);
    fs.mkdirSync(file);
    assert.equal(reply().code, 'body-unreadable');
    assert.deepEqual(fake.orca(), []);

    fs.rmdirSync(file);
    fs.writeFileSync(file, 'yes');
    fake.answers.reply = {
      status: 1,
      signal: null,
      stdout: '{"ok":false,"error":{"code":"message_not_found","message":"No message msg_1."}}\n',
      stderr: '',
      error: null,
    };
    const failed = reply();
    assert.deepEqual([failed.ok, failed.code, failed.orcaCode, failed.id], [false, 'reply-failed', 'message_not_found', 'msg_1']);
  } finally {
    removeFixture(root);
  }
});

test('cli: reply needs --id with a message id and --body-file, and takes no --feature', () => {
  const root = makeProject();
  try {
    const ctx = { stdout: /** @type {any} */ ({ write: () => true }), cwd: root, pluginRoot: PLUGIN_ROOT, env: testEnv(), runner: fakeRunner({}).runner };
    for (const args of [
      ['reply', '--body-file', 'a.md'],
      ['reply', '--id', 'msg 1', '--body-file', 'a.md'],
      ['reply', '--id', '_msg', '--body-file', 'a.md'],
      ['reply', '--id', `m${'x'.repeat(200)}`, '--body-file', 'a.md'],
      ['reply', '--id', 'msg_1'],
      ['reply', '--id', 'msg_1', '--body-file', ''],
      ['reply', '--id', 'msg_1', '--body-file', 'a.md', '--feature', 'demo'],
    ]) {
      assert.throws(() => runOrca([...args, '--project', root], ctx), UsageError, args.join(' '));
    }
  } finally {
    removeFixture(root);
  }
});

// ---------------------------------------------------------------------------
// Phase 3: a stopped run continues, and the user talks to it
// ---------------------------------------------------------------------------

/**
 * @param {Date} date
 * @returns {string} The local `YYYY-MM-DD HH:MM` time, built apart from read.js.
 */
function localStamp(date) {
  const two = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`;
}

/**
 * @param {string} root
 * @returns {string} The path of the inbox of the demo feature.
 */
function inboxOf(root) {
  return path.join(root, 'docs', 'features', 'demo', 'inbox.md');
}

test('resume: every ask names its reason, so the coordinator knows the question', () => {
  const failedStart = recordWith({}, { active: null, failedStart: { stage: 'phase', phase: 1, taskId: 't', dispatchId: 'd', count: 1, detail: [] } });
  const cases = [
    [{ git: { dirty: ['a.txt'] }, flags: { fresh: true } }, 'dirty-start'],
    [{ record: failedStart }, 'start-failed'],
    [{ flags: { wake: 'escalation' }, record: recordWith({ escalations: 1 }), worker: { state: 'idle', detail: [] } }, 'escalation-cap'],
    [{ record: recordWith(), worker: { state: 'gone', detail: [] } }, 'worker-gone'],
    [{ record: recordWith({ sendBacks: 2 }), worker: DONE }, 'send-back-cap'],
  ];
  for (const [patch, reason] of cases) {
    const ask = assertAction(decideFeature(facts(patch)), 'ask');
    assert.equal(ask.reason, reason);
    assert.ok(ask.options.some((option) => option.key === ask.recommended), `${reason} recommends one of its options`);
    assert.ok(ask.options.some((option) => option.run === null), `${reason} offers a stop with a null run`);
  }
});

test('resume: a dirty fresh start asks dirty-start, and the go-on line passes --accept-dirty', () => {
  const dirty = { git: { dirty: ['stray.txt'] } };
  const ask = assertAction(decideFeature(facts({ ...dirty, flags: { fresh: true } })), 'ask');
  assert.deepEqual(ask.options.map((option) => [option.key, option.run]), [
    ['stop', null],
    ['go-on', ['next', '--feature', 'demo', '--fresh', '--accept-dirty']],
  ]);
  assert.deepEqual([ask.recommended, ask.files], ['stop', ['stray.txt']]);
  const many = assertAction(decideFeature(facts({ git: { dirty: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }, flags: { fresh: true } })), 'ask');
  assert.match(many.question, /The work tree holds 7 changed files: a, b, c, d, e, and 2 more\./);

  // The rule skips --accept-dirty, a call that is not fresh, the feature cadence, a tab, and a failed git write.
  assertAction(decideFeature(facts({ ...dirty, flags: { fresh: true, acceptDirty: true } })), 'start');
  assertAction(decideFeature(facts(dirty)), 'start');
  assertAction(decideFeature(facts({ ...dirty, flags: { fresh: true }, config: FEATURE_CADENCE })), 'start');
  assertStop(
    decideFeature(facts({ ...dirty, flags: { fresh: true }, record: recordWith(), worker: { state: 'busy', detail: [] } })),
    'tab-still-runs'
  );
  // CR-4: the docs tab left its changes (scenario A), or the newest complete phase waits for its commit (scenario B).
  const docsRan = recordWith({}, { active: null, done: { docs: true, steps: {} } });
  const allComplete = { tasks: allDone() };
  assert.notEqual(decideFeature(facts({ ...dirty, docs: allComplete, flags: { fresh: true }, record: docsRan, git: { dirty: ['a.txt'], subjects: COMMITTED } })).reason, 'dirty-start');
  assertAction(decideFeature(facts({ ...dirty, docs: phaseOneComplete(), flags: { fresh: true } })), 'commit');
  // A complete phase that holds a commit subject, with no later work, is not the newest uncommitted phase: the ask stays.
  const committedOne = { ...dirty, git: { dirty: ['stray.txt'], subjects: ['feat: demo phase 1'] }, docs: phaseOneComplete(), flags: { fresh: true } };
  assert.equal(assertAction(decideFeature(facts(committedOne)), 'ask').reason, 'dirty-start');
  const failedGit = recordWith({}, { active: null, failedGit: { step: 'commit', phase: 1, detail: ['hook refused.'] } });
  assertAction(decideFeature(facts({ ...dirty, docs: phaseOneComplete(), flags: { fresh: true }, record: failedGit })), 'commit');

  const root = makeProject();
  try {
    gitIn(root, ['switch', '-q', '-c', 'feat/demo']);
    fs.writeFileSync(path.join(root, 'stray.txt'), 'x\n');
    const fake = fakeRunner({ status: RUNNING });
    const step = (args) => orcaStep(root, args, { runner: fake.runner }).json;
    const json = assertAction(step(['next', '--feature', 'demo', '--fresh']), 'ask');
    assert.equal(json.question, '[demo] The work tree holds 1 changed file: stray.txt. The next commit of the run takes them. What now?');
    assert.deepEqual(json.options.map((option) => option.run), [null, lineOf(root, ['next', '--feature', 'demo', '--fresh', '--accept-dirty'])]);
    assertAction(step(['next', '--feature', 'demo', '--fresh', '--accept-dirty']), 'start');
    assertAction(step(['next', '--feature', 'demo']), 'start');
    assert.ok(!fs.existsSync(path.join(root, '.beast-mode', 'briefs')), 'next writes nothing');
  } finally {
    removeFixture(root);
  }
});

test('resume: a fresh run names the busy tab of an earlier run and stops, and a completed report closes, commits, and starts the next phase', () => {
  const root = makeProject({ tasks: tasksDoc(phaseText(1, { open: 1 }), phaseText(2, { open: 1 })) });
  try {
    gitIn(root, ['switch', '-q', '-c', 'feat/demo']);
    gitIn(root, ['config', 'branch.feat/demo.beast-mode-base', 'main']);
    // The earlier run started Phase 1, and its coordinator tab closed. The tab still works.
    writeRecord(root, 'demo', recordWith().record);
    fs.writeFileSync(path.join(root, 'phase-1.txt'), 'half done\n');
    const fake = fakeRunner({
      status: RUNNING,
      'worker-show': envelope({ dispatchId: 'disp-1', state: 'ready', liveness: 'live', activity: 'working', terminal: 'term-7' }),
      'worker-release': envelope({ state: 'already_released' }),
      'worker-start': envelope({ runId: 'run-2', taskId: 'task-2', dispatchId: 'disp-2', state: 'ready' }),
    });
    const step = (args) => orcaStep(root, args, { runner: fake.runner }).json;

    const stopped = assertStop(step(['next', '--feature', 'demo', '--fresh']), 'tab-still-runs');
    assert.equal(stopped.say, 'The Phase 1 tab of demo still runs on dsh (dispatch disp-1, terminal term-7).');
    const calls = fake.orca().length;
    assert.equal(step(['start', '--feature', 'demo', '--stage', 'phase', '--phase', '1']).code, 'tab-active');
    assert.equal(fake.orca().length, calls, 'a start refuses with no Orca call');
    // CR-9: a stale commit line refuses too, and it takes no change of the working tab.
    const headBefore = gitIn(root, ['rev-parse', 'HEAD']).trim();
    const refused = step(['commit', '--feature', 'demo', '--point', 'phase', '--phase', '1']);
    assert.deepEqual([refused.ok, refused.code], [false, 'tab-active']);
    assert.equal(gitIn(root, ['rev-parse', 'HEAD']).trim(), headBefore, 'a refused commit makes no commit');
    assert.equal(fake.orca().length, calls, 'a refused commit makes no Orca call');
    assertAction(step(['next', '--feature', 'demo', '--wake', 'escalation', '--dispatch', 'disp-1']), 'wait');

    // The tab reports while no coordinator runs. The next fresh run finds the completed report.
    fs.writeFileSync(path.join(root, 'phase-1.txt'), 'done\n');
    fs.writeFileSync(path.join(root, 'docs', 'features', 'demo', 'tasks.md'), tasksDoc(phaseText(1, { done: 1 }), phaseText(2, { open: 1 })));
    fake.answers['worker-show'] = envelope({ dispatch: { dispatchId: 'disp-1', status: 'completed' } });
    let json = assertAction(step(['next', '--feature', 'demo', '--fresh']), 'close');
    assert.equal(json.run, lineOf(root, ['close', '--feature', 'demo']));
    assert.equal(step(['close', '--feature', 'demo']).ok, true);
    json = assertAction(step(['next', '--feature', 'demo']), 'commit');
    assert.equal(json.subject, 'feat: demo phase 1');
    assert.equal(step(['commit', '--feature', 'demo', '--point', 'phase', '--phase', '1']).ok, true);
    json = assertAction(step(['next', '--feature', 'demo']), 'start');
    assert.equal(json.phase, 2);
    assert.equal(fake.orca().filter((args) => args[1] === 'worker-start').length, 0, 'no rule started a second tab');
  } finally {
    removeFixture(root);
  }
});

test('resume: a gone tab asks worker-gone, close --discard releases first, and the next start opens a new tab', () => {
  const root = makeProject();
  try {
    gitIn(root, ['switch', '-q', '-c', 'feat/demo']);
    writeRecord(root, 'demo', recordWith({ sendBacks: 1, escalations: 1 }).record);
    const fake = fakeRunner({
      'worker-show': NOT_FOUND,
      'worker-release': NOT_FOUND,
      'worker-start': envelope({ runId: 'run-2', taskId: 'task-2', dispatchId: 'disp-2', state: 'ready' }),
    });
    const step = (args) => orcaStep(root, args, { runner: fake.runner }).json;

    const ask = assertAction(step(['next', '--feature', 'demo']), 'ask');
    assert.equal(ask.recommended, 'new-tab');
    const discard = ['close', '--feature', 'demo', '--discard'];
    assert.equal(ask.options[0].run, lineOf(root, discard));
    let json = step(discard);
    assert.deepEqual([json.ok, json.discard, json.docsDone], [true, true, false]);
    assert.deepEqual(json.release.map((entry) => [entry.dispatchId, entry.ok, entry.code]), [['disp-1', false, 'dispatch_not_found']]);
    assert.deepEqual(fake.orca().at(-1), ['orchestration', 'worker-release', '--dispatch', 'disp-1', '--json']);
    assert.equal(readRecord(root, 'demo').record.active, null, 'a refused release never blocks the clear');

    json = assertAction(step(['next', '--feature', 'demo']), 'start');
    assert.deepEqual([json.stage, json.phase], ['phase', 1]);
    json = step(['start', '--feature', 'demo', '--stage', 'phase', '--phase', '1']);
    assert.deepEqual([json.ok, json.dispatchId], [true, 'disp-2']);
    const active = readRecord(root, 'demo').record.active;
    assert.deepEqual([active.dispatchId, active.sendBacks, active.escalations, active.spec], [
      'disp-2',
      0,
      0,
      '.beast-mode/briefs/demo/orca-phase-1.md',
    ]);
  } finally {
    removeFixture(root);
  }
});

test('resume: send builds the text of each reason, counts it, and a follow-up dispatch id replaces the active id', () => {
  const root = makeProject({ tasks: tasksDoc(phaseText(1, { done: 1, open: 1 })) });
  try {
    gitIn(root, ['switch', '-q', '-c', 'feat/demo']);
    writeRecord(root, 'demo', recordWith().record);
    const fake = fakeRunner({ send: envelope({ message: { id: 'msg_1', subject: 'x' } }) });
    const step = (args) => orcaStep(root, args, { runner: fake.runner }).json;
    const sent = () => fake.orca().at(-1);

    let json = step(['send', '--feature', 'demo', '--reason', 'open-tasks']);
    assert.deepEqual([json.ok, json.reason, json.followUp, json.dispatchId, json.open], [true, 'open-tasks', false, 'disp-1', ['**Task 1.2** open']]);
    assert.deepEqual(sent().slice(0, 7), ['orchestration', 'send', '--to', 'dispatch:disp-1', '--subject', 'Open items: Phase 1 of demo', '--body']);
    assert.equal(sent()[7], sendText({ label: 'Phase 1 of demo', reason: 'open-tasks', open: ['**Task 1.2** open'], spec: null }).body);
    assert.equal(sent().at(-1), '--json');
    assert.equal(readRecord(root, 'demo').record.active.sendBacks, 1);

    json = step(['send', '--feature', 'demo', '--reason', 'escalation']);
    assert.equal(sent()[5], 'Resume: Phase 1 of demo');
    assert.ok(sent()[7].includes('by your spec, `.beast-mode/briefs/demo/orca-phase-1.md`.'), sent()[7]);
    assert.equal(readRecord(root, 'demo').record.active.escalations, 1);

    json = step(['send', '--feature', 'demo', '--reason', 'missing-verdict']);
    assert.deepEqual([json.ok, sent()[5]], [true, 'Verdict: Phase 1 of demo']);
    assert.equal(step(['send', '--feature', 'demo', '--reason', 'report']).code, 'report-not-ready');

    fs.writeFileSync(path.join(root, 'docs', 'features', 'demo', 'tasks.md'), tasksDoc(phaseText(1, { done: 2 })));
    assert.equal(step(['send', '--feature', 'demo', '--reason', 'open-tasks']).code, 'nothing-open');

    // A send to a finished worker starts a follow-up. Its dispatch replaces the active id (fact O9).
    fake.answers.send = envelope({ runId: 'run-1', taskId: 'task-f', dispatchId: 'disp-f', state: 'ready' });
    json = step(['send', '--feature', 'demo', '--reason', 'report']);
    assert.deepEqual([json.ok, json.followUp, json.dispatchId, json.previousDispatchId], [true, true, 'disp-f', 'disp-1']);
    assert.equal(sent()[5], 'Report: Phase 1 of demo');
    const active = readRecord(root, 'demo').record.active;
    // Fix 2: the open items fell from 1 at the resume send to 0, so the report send starts the count again.
    assert.deepEqual([active.dispatchId, active.taskId, active.runId, active.escalations, active.sendBacks], ['disp-f', 'task-f', 'run-1', 1, 2]);
    assert.equal(active.escalationOpen, 0);
    assert.equal(fake.orca().filter((args) => args[1] === 'send').length, 4, 'every refusal stays away from Orca');
  } finally {
    removeFixture(root);
  }
});

test('resume: a send that fails stops send-failed until a fresh call, and never retries by itself', () => {
  const root = makeProject();
  try {
    gitIn(root, ['switch', '-q', '-c', 'feat/demo']);
    writeRecord(root, 'demo', recordWith().record);
    const fake = fakeRunner({ status: RUNNING, send: DOWN, 'worker-show': envelope({ dispatchId: 'disp-1', state: 'succeeded', stage: 'settled' }) });
    /** @type {number[]} */
    const sleeps = [];
    const step = (args) => orcaStep(root, args, { runner: fake.runner, sleep: (ms) => sleeps.push(ms) }).json;

    assertAction(step(['next', '--feature', 'demo', '--wake', 'worker_done', '--dispatch', 'disp-1']), 'send');
    let json = step(['send', '--feature', 'demo', '--reason', 'open-tasks']);
    assert.deepEqual([json.ok, json.code, json.orcaCode], [false, 'send-failed', 'runtime_unavailable']);
    assert.equal(fake.orca().filter((args) => args[1] === 'send').length, 1, 'a state change never retries');
    assert.deepEqual(sleeps, []);
    assert.equal(readRecord(root, 'demo').record.active.failedSend.reason, 'open-tasks');

    json = assertStop(step(['next', '--feature', 'demo']), 'send-failed');
    assert.deepEqual(json.detail, [`${FAKE_ORCA} orchestration send: runtime_unavailable: Orca is not running.`]);
    fake.answers.send = envelope({ message: { id: 'msg_2' } });
    assertAction(step(['next', '--feature', 'demo', '--fresh']), 'send');
    assert.equal(step(['send', '--feature', 'demo', '--reason', 'open-tasks']).ok, true);
    const active = readRecord(root, 'demo').record.active;
    assert.deepEqual([active.failedSend, active.sendBacks], [undefined, 1]);
  } finally {
    removeFixture(root);
  }
});

test('resume: the repair commit of rule F16 commits a complete phase that a stopped run left uncommitted', () => {
  const root = makeProject({ tasks: tasksDoc(phaseText(1, { open: 1 }), phaseText(2, { open: 1 })) });
  try {
    gitIn(root, ['switch', '-q', '-c', 'feat/demo']);
    gitIn(root, ['config', 'branch.feat/demo.beast-mode-base', 'main']);
    // The last run closed the Phase 1 tab, and it stopped before the commit.
    fs.writeFileSync(path.join(root, 'docs', 'features', 'demo', 'tasks.md'), tasksDoc(phaseText(1, { done: 1 }), phaseText(2, { open: 1 })));
    fs.writeFileSync(path.join(root, 'phase-1.txt'), 'phase 1\n');
    writeRecord(root, 'demo', newRecord('demo'));
    const fake = fakeRunner({ status: RUNNING });
    const step = (args) => orcaStep(root, args, { runner: fake.runner }).json;

    // CR-4: the changes are the work of the run, so a fresh call asks nothing and commits.
    let json = assertAction(step(['next', '--feature', 'demo', '--fresh']), 'commit');
    assert.deepEqual([json.point, json.phase], ['phase', 1]);
    json = assertAction(step(['next', '--feature', 'demo', '--fresh', '--accept-dirty']), 'commit');
    assert.deepEqual([json.point, json.phase, json.subject], ['phase', 1, 'feat: demo phase 1']);
    assertAction(step(['next', '--feature', 'demo']), 'commit');
    assert.equal(step(['commit', '--feature', 'demo', '--point', 'phase', '--phase', '1']).ok, true);
    const committed = gitIn(root, ['show', '--name-only', '--format=', 'HEAD']).split('\n').filter(Boolean).sort();
    assert.deepEqual(committed, ['docs/features/demo/tasks.md', 'phase-1.txt']);
    json = assertAction(step(['next', '--feature', 'demo', '--fresh']), 'start');
    assert.equal(json.phase, 2, 'a clean tree asks nothing');
    assert.deepEqual(fake.orca().filter((args) => args[0] !== 'status'), []);
  } finally {
    removeFixture(root);
  }
});

test('note: a running tab gets orchestration send with the subject, and the text with the inbox instruction as one argument', () => {
  const root = makeProject();
  try {
    writeRecord(root, 'demo', recordWith().record);
    const fake = fakeRunner({ 'worker-show': turnStarted('disp-1'), send: envelope({ message: { id: 'msg_1' } }) });
    const file = path.join(root, '.beast-mode', 'briefs', 'orca', 'note.md');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const text = 'The save fails on "Enter"; it\'s `broken` & $HOME stays.\nA second line.';
    fs.writeFileSync(file, `${text}\n\n`);
    const note = (kind, textFile = file) =>
      orcaStep(root, ['note', '--feature', 'demo', '--kind', kind, '--text-file', textFile], { runner: fake.runner }).json;

    let json = note('bug');
    assert.deepEqual([json.ok, json.delivery, json.kind, json.dispatchId, json.followUp], [true, 'send', 'bug', 'disp-1', false]);
    const message = noteText({ feature: 'demo', kind: 'bug', text });
    assert.deepEqual(fake.orca().at(-1), ['orchestration', 'send', '--to', 'dispatch:disp-1', '--subject', 'User message (bug)', '--body', message.body, '--json']);
    assert.ok(message.body.startsWith(`${text}\n\n---\n`));
    assert.ok(message.body.includes('`docs/features/demo/inbox.md`, by section 12 rule 2'));
    assert.ok(!fs.existsSync(inboxOf(root)), 'a delivered message writes no inbox line');

    // A text that starts with -- takes the equals form. The kind of change-small reads "change small".
    fs.writeFileSync(file, '--verbose output is too long\n');
    json = note('change-small', '.beast-mode/briefs/orca/note.md');
    const args = fake.orca().at(-1);
    assert.deepEqual([json.kind, args[5], args.length], ['change small', 'User message (change small)', 8]);
    assert.ok(args[6].startsWith('--body=--verbose output is too long\n\n---\n'), args[6]);

    // A worker that settles between the show and the send gets a follow-up, and its dispatch replaces the
    // active id (fact O9). The record marks it as the follow-up of a note, so a close keeps it while it works.
    fake.answers.send = envelope({ runId: 'run-1', taskId: 'task-f', dispatchId: 'disp-f', state: 'ready' });
    json = note('note');
    assert.deepEqual([json.followUp, json.dispatchId], [true, 'disp-f']);
    const active = readRecord(root, 'demo').record.active;
    assert.equal(active.dispatchId, 'disp-f');
    assert.deepEqual(active.noteFollowUp, { dispatchId: 'disp-f', of: 'disp-1' });
  } finally {
    removeFixture(root);
  }
});

test('note: with no tab, one line goes at the end of ## Items in the shape of section 12 rule 2, and Orca gets no call', () => {
  const before = [
    '# demo - Inbox',
    '',
    '> The rules.',
    '',
    '## Items',
    '',
    '- [ ] note 2026-11-17 09:00 | keep the old icon',
    '- [x] bug 2026-11-17 09:05 | the save fails | done: phase-1-fix1.md',
    '',
    '## Archive',
    '',
    '- [x] note 2026-11-01 08:00 | old',
    '',
  ];
  const root = makeProject({ docs: { 'inbox.md': before.join('\n') } });
  try {
    const fake = fakeRunner({});
    const file = path.join(root, 'note.md');
    fs.writeFileSync(file, 'the list  loses its scroll\n  position after a save\n');
    const json = orcaStep(root, ['note', '--feature', 'demo', '--kind', 'change-medium', '--text-file', file], { runner: fake.runner }).json;
    const line = `- [ ] change medium ${localStamp(NOW)} | the list  loses its scroll position after a save`;
    assert.deepEqual([json.ok, json.delivery, json.kind, json.line, json.created], [true, 'inbox', 'change medium', line, false]);
    const after = [...before.slice(0, 8), line, ...before.slice(8)];
    assert.equal(fs.readFileSync(inboxOf(root), 'utf8'), after.join('\n'));
    assert.deepEqual(fake.orca(), []);
    assert.deepEqual(parseInbox(after.join('\n')).actionable, [{ kind: 'change medium', text: line.slice(6) }]);
    assert.deepEqual(fs.readdirSync(path.dirname(inboxOf(root))).filter((name) => name.endsWith('.tmp')), [], 'no temporary file stays');
  } finally {
    removeFixture(root);
  }
});

test('note: an absent inbox.md is made from the template with the feature name, and a send that Orca refuses falls back to it', () => {
  const root = makeProject();
  try {
    const template = fs.readFileSync(path.join(PLUGIN_ROOT, 'templates', 'dev-docs', 'inbox.md'), 'utf8');
    fs.mkdirSync(path.join(root, '.beast-mode', 'templates'), { recursive: true });
    fs.writeFileSync(path.join(root, '.beast-mode', 'templates', 'inbox.md'), template);
    writeRecord(root, 'demo', recordWith().record);
    const fake = fakeRunner({ 'worker-show': turnStarted('disp-1'), send: NOT_FOUND });
    const file = path.join(root, 'note.md');
    fs.writeFileSync(file, 'keep the old icon\n');
    const json = orcaStep(root, ['note', '--feature', 'demo', '--kind', 'note', '--text-file', file], { runner: fake.runner }).json;
    assert.deepEqual([json.ok, json.delivery, json.created], [true, 'inbox', true]);
    assert.match(json.say, /, a new file\. Orca did not deliver it to the tab\.$/);
    assert.equal(json.detail[0], 'Orca did not deliver the message to the Phase 1 tab of demo, so it went into the inbox.');
    assert.equal(fake.orca().filter((args) => args[1] === 'send').length, 1, 'a send never retries by itself');
    const expected = `${template.replace('[Feature Name]', 'demo').trimEnd()}\n\n- [ ] note ${localStamp(NOW)} | keep the old icon\n`;
    assert.equal(fs.readFileSync(inboxOf(root), 'utf8'), expected);
    assert.ok(expected.startsWith('# demo - Inbox\n'));

    // With no project template, the template of the plugin stands in.
    fs.rmSync(inboxOf(root));
    fs.rmSync(path.join(root, '.beast-mode', 'templates'), { recursive: true });
    writeRecord(root, 'demo', newRecord('demo'));
    const again = orcaStep(root, ['note', '--feature', 'demo', '--kind', 'note', '--text-file', file], { runner: fake.runner }).json;
    assert.deepEqual([again.ok, again.delivery, again.created, again.detail], [true, 'inbox', true, undefined]);
    assert.equal(fs.readFileSync(inboxOf(root), 'utf8'), expected);
  } finally {
    removeFixture(root);
  }
});

test('note: a tab that has ended its work gets no send, and the message goes into the inbox', () => {
  // The live case: the step tab "/review-pr" wrote its FAIL verdict and sent worker_done, so Orca settled its
  // dispatch, and the run waited on the step-failed ask. A send there started a follow-up dispatch, and the
  // go-on line of the ask (close --override) then closed the tab while the follow-up worked.
  for (const show of [
    envelope({ dispatchId: 'disp-1', state: 'succeeded', liveness: 'live', activity: 'idle' }),
    envelope({ dispatchId: 'disp-1', state: 'failed' }),
    envelope({ dispatchId: 'disp-1', state: 'stopped' }),
    NOT_FOUND,
  ]) {
    const root = makeProject();
    try {
      writeRecord(root, 'demo', recordWith().record);
      const fake = fakeRunner({ 'worker-show': show, send: envelope({ runId: 'run-1', taskId: 'task-f', dispatchId: 'disp-f', state: 'ready' }) });
      const file = path.join(root, 'note.md');
      fs.writeFileSync(file, 'the import answers 500 on a deep upload\n');
      const json = orcaStep(root, ['note', '--feature', 'demo', '--kind', 'bug', '--text-file', file], { runner: fake.runner }).json;
      assert.deepEqual([json.ok, json.delivery, json.settled], [true, 'inbox', true], JSON.stringify(json));
      assert.match(json.say, /\. The tab has ended its work, so it got no send\.$/);
      assert.equal(json.detail[0], 'The Phase 1 tab of demo has ended its work, so the message went into the inbox.');
      assert.deepEqual(fake.orca(), [['orchestration', 'worker-show', '--dispatch', 'disp-1', '--json']], 'no send');
      assert.ok(fs.readFileSync(inboxOf(root), 'utf8').includes(`- [ ] bug ${localStamp(NOW)} | the import answers 500 on a deep upload`));
      assert.equal(readRecord(root, 'demo').record.active.dispatchId, 'disp-1', 'the record keeps the tab for its ask or close');
    } finally {
      removeFixture(root);
    }
  }
});

test('note: a tab whose state Orca cannot read still gets the send, and an idle tab too', () => {
  for (const show of [
    envelope(null, { ok: false, status: 1 }),
    envelope({ dispatchId: 'disp-1', state: 'ready', liveness: 'live', activity: 'idle' }),
  ]) {
    const root = makeProject();
    try {
      writeRecord(root, 'demo', recordWith().record);
      const fake = fakeRunner({ 'worker-show': show, send: envelope({ message: { id: 'msg_1' } }) });
      const file = path.join(root, 'note.md');
      fs.writeFileSync(file, 'keep the old icon\n');
      const json = orcaStep(root, ['note', '--feature', 'demo', '--kind', 'note', '--text-file', file], { runner: fake.runner }).json;
      assert.deepEqual([json.ok, json.delivery, json.followUp], [true, 'send', false]);
      assert.equal(fake.orca().at(-1)[1], 'send');
    } finally {
      removeFixture(root);
    }
  }
});

test('close: a follow-up that a note started is kept while it works, and --discard or its report lets the close go on', () => {
  const root = makeProject();
  try {
    const followUp = { dispatchId: 'disp-f', taskId: 'task-f', noteFollowUp: { dispatchId: 'disp-f', of: 'disp-1' } };
    writeRecord(root, 'demo', recordWith(followUp).record);
    const notSettled = {
      status: 1,
      signal: null,
      stdout: `${JSON.stringify({ ok: false, error: { code: 'dispatch_inactive', message: 'Dispatch disp-f is ready; only a settled worker can release. Use worker-stop to cancel an active worker.' } })}\n`,
      stderr: '',
      error: null,
    };
    const fake = fakeRunner({ 'worker-release': notSettled });
    const step = (args) => orcaStep(root, args, { runner: fake.runner }).json;

    let json = step(['close', '--feature', 'demo']);
    assert.deepEqual([json.ok, json.code, json.dispatchId], [false, 'follow-up-working', 'disp-f'], JSON.stringify(json));
    assert.equal(json.say, 'The follow-up disp-f that a user note started for the Phase 1 tab of demo still works.');
    assert.ok(json.detail.includes('Close it with "--discard" to drop it anyway.'));
    assert.equal(readRecord(root, 'demo').record.active.dispatchId, 'disp-f', 'the record keeps the follow-up');

    // The follow-up reported, so Orca releases it, and the close clears the record.
    fake.answers['worker-release'] = envelope({ dispatchId: 'disp-f', state: 'already_released', processAction: 'none' });
    json = step(['close', '--feature', 'demo']);
    assert.equal(json.ok, true, JSON.stringify(json));
    assert.equal(readRecord(root, 'demo').record.active, null);

    // --discard drops a follow-up that still works, and stops it (fix 10).
    writeRecord(root, 'demo', recordWith(followUp).record);
    fake.answers['worker-release'] = notSettled;
    fake.answers['worker-stop'] = envelope({ dispatchId: 'disp-f', state: 'stopped', processAction: 'closed_agent_terminal' });
    json = step(['close', '--feature', 'demo', '--discard']);
    assert.deepEqual([json.ok, json.discard], [true, true]);
    assert.deepEqual(fake.orca().at(-1), ['orchestration', 'worker-stop', '--dispatch', 'disp-f', '--json']);
    assert.equal(readRecord(root, 'demo').record.active, null);

    // A tab that no note followed up keeps the old rule: a refused release never blocks the clear.
    writeRecord(root, 'demo', recordWith().record);
    json = step(['close', '--feature', 'demo']);
    assert.equal(json.ok, true);
    assert.equal(readRecord(root, 'demo').record.active, null);
  } finally {
    removeFixture(root);
  }
});

test('close: --discard stops a tab that Orca did not release as not settled, and a failed stop says the tab still runs (fix 10)', () => {
  const root = makeProject();
  try {
    const notSettled = {
      status: 1,
      signal: null,
      stdout: `${JSON.stringify({ ok: false, error: { code: 'dispatch_inactive', message: 'Dispatch disp-1 is ready; only a settled worker can release. Use worker-stop to cancel an active worker.' } })}\n`,
      stderr: '',
      error: null,
    };
    const fake = fakeRunner({
      'worker-release': notSettled,
      'worker-stop': envelope({ dispatchId: 'disp-1', state: 'stopped', processAction: 'closed_agent_terminal' }),
    });
    const step = (args) => orcaStep(root, args, { runner: fake.runner }).json;

    // A plain close never stops a tab: only --discard drops one that has not reported.
    writeRecord(root, 'demo', recordWith().record);
    let json = step(['close', '--feature', 'demo']);
    assert.equal(json.ok, true);
    assert.equal(fake.orca().filter((args) => args[1] === 'worker-stop').length, 0, 'a plain close stops nothing');
    assert.match(json.say, /Orca did not release disp-1, and the record is clear\.$/);

    // The stalled tab of the incident: --discard releases first, and the refusal as not settled stops it.
    writeRecord(root, 'demo', recordWith().record);
    let before = fake.orca().length;
    json = step(['close', '--feature', 'demo', '--discard']);
    assert.deepEqual(fake.orca().slice(before), [
      ['orchestration', 'worker-release', '--dispatch', 'disp-1', '--json'],
      ['orchestration', 'worker-stop', '--dispatch', 'disp-1', '--json'],
    ]);
    assert.equal(json.ok, true);
    assert.deepEqual(json.release.map((entry) => [entry.dispatchId, entry.code, entry.stopped, entry.processAction]), [
      ['disp-1', 'dispatch_inactive', true, 'closed_agent_terminal'],
    ]);
    assert.equal(json.say, 'Closed the Phase 1 tab of demo. Orca did not release disp-1, so the close stopped it, and the record is clear.');
    assert.equal(readRecord(root, 'demo').record.active, null);

    // A failed stop never blocks the clear, and the say line tells the coordinator that the tab can still work.
    fake.answers['worker-stop'] = {
      status: 1,
      signal: null,
      stdout: `${JSON.stringify({ ok: false, error: { code: 'stop_unknown', message: 'The agent exit was not proven.' } })}\n`,
      stderr: '',
      error: null,
    };
    writeRecord(root, 'demo', recordWith().record);
    json = step(['close', '--feature', 'demo', '--discard']);
    assert.equal(json.ok, true);
    assert.deepEqual([json.release[0].stopped, json.release[0].stopCode], [false, 'stop_unknown']);
    assert.ok(json.say.endsWith(' Orca did not release disp-1, and the record is clear. Its tab can still work: stop it in Orca before a new tab of the same work starts.'), json.say);
    assert.equal(readRecord(root, 'demo').record.active, null);

    // A gone dispatch has no worker to stop: no stop call, and no "still work" line.
    fake.answers['worker-release'] = NOT_FOUND;
    writeRecord(root, 'demo', recordWith().record);
    before = fake.orca().length;
    json = step(['close', '--feature', 'demo', '--discard']);
    assert.deepEqual(fake.orca().slice(before), [['orchestration', 'worker-release', '--dispatch', 'disp-1', '--json']]);
    assert.doesNotMatch(json.say, /can still work/);
  } finally {
    removeFixture(root);
  }
});

test('close: --discard of an own-terminal tab that a stop fenced closes the terminal that Orca does not own (fix 10)', () => {
  const root = makeProject();
  try {
    writeRecord(root, 'demo', recordWith({ terminal: 'term-7', ownTerminal: true }).record);
    const fake = fakeRunner({
      'worker-release': {
        status: 1,
        signal: null,
        stdout: `${JSON.stringify({ ok: false, error: { code: 'dispatch_inactive', message: 'only a settled worker can release.' } })}\n`,
        stderr: '',
        error: null,
      },
      'worker-stop': envelope({ dispatchId: 'disp-1', state: 'stopped', processAction: 'none' }),
      terminal: envelope({ handle: 'term-7', closed: true }),
    });
    const json = orcaStep(root, ['close', '--feature', 'demo', '--discard'], { runner: fake.runner }).json;
    assert.deepEqual(fake.orca(), [
      ['orchestration', 'worker-release', '--dispatch', 'disp-1', '--json'],
      ['orchestration', 'worker-stop', '--dispatch', 'disp-1', '--json'],
      ['terminal', 'close', '--terminal', 'term-7', '--json'],
    ]);
    assert.deepEqual([json.ok, json.terminalClosed], [true, true]);
  } finally {
    removeFixture(root);
  }
});

test('note: the inbox line helpers keep every other line, add a missing section, and skip a fence', () => {
  const line = '- [ ] bug 2026-11-18 10:00 | x';
  assert.equal(inboxLine('bug', new Date(2026, 10, 18, 10, 0), ' x \n'), line);
  assert.equal(inboxLine('note', new Date(2026, 0, 2, 3, 4), 'a\r\n\r\n b'), '- [ ] note 2026-01-02 03:04 | a b');
  assert.equal(insertInboxLine('# demo - Inbox\n\n## Items\n', line), `# demo - Inbox\n\n## Items\n\n${line}\n`);
  assert.equal(insertInboxLine('# demo - Inbox\n', line), `# demo - Inbox\n\n## Items\n\n${line}\n`, 'a missing section goes at the end');
  assert.equal(insertInboxLine('', line), `## Items\n\n${line}\n`);
  assert.equal(insertInboxLine('## Items\r\n- [ ] note a\r\n', line), `## Items\r\n- [ ] note a\r\n${line}\r\n`, 'CRLF stays');
  assert.equal(
    insertInboxLine('```\n## Items\n```\n## Items\n- [ ] a\n## Next\n', line),
    `\`\`\`\n## Items\n\`\`\`\n## Items\n- [ ] a\n${line}\n## Next\n`,
    'a heading inside a fence never counts'
  );
  assert.equal(insertInboxLine('## Items\n- [ ] a\n### Group\n- [ ] b\n', line), `## Items\n- [ ] a\n### Group\n- [ ] b\n${line}\n`);
  assert.equal(inboxFromTemplate('# [Feature Name] - Inbox\n\n## Items\n', 'editor/ux'), '# editor/ux - Inbox\n\n## Items\n');
  assert.equal(inboxFromTemplate(null, 'demo'), '# demo - Inbox\n\n## Items\n');
});

test('note: an open bug or change line starts the inbox tab after the review and before the docs, and a note alone starts none', () => {
  const bug = { kind: 'bug', text: 'bug 2026-11-18 10:00 | the save fails' };
  const closed = { tasks: allDone(), ...reviewDocs('- [x] CR-1: a') };
  const end = { git: { subjects: COMMITTED } };
  const inbox = assertAction(decideFeature(facts({ ...end, docs: { ...closed, inbox: [bug], inboxActionable: [bug] } })), 'start');
  assert.deepEqual([inbox.stage, inbox.agent, inbox.phase, inbox.run], ['inbox', 'dsh', null, ['start', '--feature', 'demo', '--stage', 'inbox']]);
  assert.match(inbox.say, /for 1 open bug or change line\.$/);
  assert.equal(decideFeature(facts({ docs: { inbox: [bug], inboxActionable: [bug] } })).stage, 'phase', 'an open phase comes first');
  assert.equal(decideFeature(facts({ ...end, docs: { tasks: allDone(), inboxActionable: [bug] } })).stage, 'review', 'the review comes first');
  const note = { kind: 'note', text: 'note 2026-11-18 10:00 | keep the icon' };
  assert.equal(decideFeature(facts({ ...end, docs: { ...closed, inbox: [note] } })).stage, 'docs');

  // A3 of the inbox tab: open lines go back, and no open bug or change line closes it.
  const tab = recordWith({ stage: 'inbox', phase: null, closedLarge: [] });
  const send = assertAction(decideFeature(facts({ ...end, docs: { ...closed, inboxActionable: [bug] }, record: tab, worker: DONE })), 'send');
  assert.deepEqual([send.reason, send.open], ['open-tasks', [bug.text]]);
  const close = assertAction(decideFeature(facts({ ...end, docs: closed, record: tab, worker: DONE })), 'close');
  assert.equal(close.say, 'The inbox lines of demo are handled. Close its tab.');

  const config = { version: 1, orchestration: { stages: { implement: 'dsh', review: false } } };
  const old = '- [x] change large 2026-11-01 09:00 | an old goal | done: new requirements.md';
  const root = makeProject({ tasks: tasksDoc(phaseText(1, { done: 1 })), config, docs: { 'inbox.md': `# demo - Inbox\n\n## Items\n\n${old}\n- [ ] ${bug.text}\n` } });
  const empty = makeProject({ tasks: tasksDoc(phaseText(1, { done: 1 })), config });
  const open = makeProject({ config, docs: { 'inbox.md': `## Items\n- [ ] ${bug.text}\n` } });
  try {
    for (const project of [root, empty, open]) gitIn(project, ['switch', '-q', '-c', 'feat/demo']);
    const fake = fakeRunner({
      'worker-start': envelope({ runId: 'run-1', taskId: 'task-1', dispatchId: 'disp-1', state: 'ready' }),
      'worker-show': turnStarted('disp-1'),
    });
    const start = (project) => orcaStep(project, ['start', '--feature', 'demo', '--stage', 'inbox'], { runner: fake.runner }).json;
    assert.equal(start(empty).code, 'inbox-empty');
    assert.equal(start(open).code, 'phase-incomplete');
    assert.deepEqual(fake.orca(), [], 'no refusal reaches Orca');

    assertAction(orcaStep(root, ['next', '--feature', 'demo'], { runner: fake.runner }).json, 'start');
    const json = start(root);
    assert.deepEqual([json.ok, json.stage, json.agent, json.spec], [true, 'inbox', 'dsh', '.beast-mode/briefs/demo/orca-inbox.md']);
    const spec = path.join(root, '.beast-mode', 'briefs', 'demo', 'orca-inbox.md');
    assert.deepEqual(fake.orca().at(-2).slice(0, 4), ['orchestration', 'worker-start', '--spec-file', spec], 'the submit loop reads the tab last');
    assert.ok(fs.readFileSync(spec, 'utf8').startsWith('# Beast Mode orca worker - demo, Inbox\n'));
    assert.deepEqual(readRecord(root, 'demo').record.active.closedLarge, [old.slice(6)]);
  } finally {
    removeFixture(root);
    removeFixture(empty);
    removeFixture(open);
  }
});

test('note: a line closed new requirements.md by the inbox tab closes the stage, and the run stops large-change, naming /plan-feature', () => {
  const config = { version: 1, orchestration: { stages: { implement: 'dsh', review: false } } };
  const old = '- [x] change large 2026-11-01 09:00 | an old goal | done: new requirements.md';
  const large = 'change large 2026-11-18 09:00 | make it a phone app';
  const bug = 'bug 2026-11-18 09:05 | the save fails';
  const root = makeProject({
    tasks: tasksDoc(phaseText(1, { done: 1 })),
    config,
    docs: { 'inbox.md': `# demo - Inbox\n\n## Items\n\n${old}\n- [ ] ${large}\n- [ ] ${bug}\n` },
  });
  try {
    gitIn(root, ['switch', '-q', '-c', 'feat/demo']);
    const fake = fakeRunner({
      status: RUNNING,
      'worker-start': envelope({ runId: 'run-1', taskId: 'task-1', dispatchId: 'disp-1', state: 'ready' }),
      'worker-show': envelope({ dispatchId: 'disp-1', state: 'succeeded', stage: 'settled' }),
      'worker-release': envelope({ state: 'already_released' }),
    });
    const step = (args) => orcaStep(root, args, { runner: fake.runner }).json;

    let json = assertAction(step(['next', '--feature', 'demo']), 'start');
    assert.equal(json.stage, 'inbox');
    assert.equal(step(['start', '--feature', 'demo', '--stage', 'inbox']).ok, true);

    // The tab asks the user, writes the new requirements.md, and closes the large change. The bug stays open (rule 10).
    const closedLarge = `- [x] ${large} | done: new requirements.md`;
    fs.writeFileSync(inboxOf(root), `# demo - Inbox\n\n## Items\n\n${old}\n${closedLarge}\n- [ ] ${bug}\n`);
    fs.writeFileSync(path.join(root, 'docs', 'features', 'demo', 'requirements.md'), '# Demo - Requirements\n\nA phone app.\n');
    json = assertAction(step(['next', '--feature', 'demo', '--wake', 'worker_done', '--dispatch', 'disp-1']), 'close');
    assert.equal(json.say, 'A large change of demo wrote a new requirements.md. Close its tab.');
    json = step(['close', '--feature', 'demo']);
    assert.deepEqual([json.ok, json.largeChange], [true, true]);
    assert.deepEqual(readRecord(root, 'demo').record.largeChange.lines, [closedLarge.slice(6)]);

    json = assertStop(step(['next', '--feature', 'demo']), 'large-change');
    assert.ok(json.detail.includes(closedLarge.slice(6)));
    assert.match(json.fix, /^Run \/plan-feature demo to plan the new requirements\.md\. Then run \/orca-feature demo again\./);
    assert.ok(json.fix.includes(lineOf(root, ['close', '--feature', 'demo'])), json.fix);
    assertStop(step(['next', '--feature', 'demo', '--fresh', '--accept-dirty']), 'large-change');
    assert.equal(step(['start', '--feature', 'demo', '--stage', 'inbox']).code, 'large-change');

    // close clears the mark, so the run goes on with the plan as it is: the open bug gets its inbox tab.
    json = step(['close', '--feature', 'demo']);
    assert.match(json.say, /The large-change stop is clear/);
    assert.equal(readRecord(root, 'demo').record.largeChange, null);
    assert.equal(assertAction(step(['next', '--feature', 'demo']), 'start').stage, 'inbox');
  } finally {
    removeFixture(root);
  }

  // A line closed new requirements.md before the inbox tab never stops the run.
  const before = { tasks: allDone(), ...reviewDocs('- [x] CR-1: a'), inboxNewRequirements: [{ kind: 'change large', text: old.slice(6), time: '2026-11-01 09:00' }] };
  assert.equal(decideFeature(facts({ git: { subjects: COMMITTED }, docs: before })).stage, 'docs');
  const tab = recordWith({ stage: 'inbox', phase: null, closedLarge: [old.slice(6)] });
  const bugLine = { kind: 'bug', text: bug };
  assertAction(
    decideFeature(facts({ git: { subjects: COMMITTED }, docs: { ...before, inboxActionable: [bugLine] }, record: tab, worker: DONE })),
    'send'
  );
});

test('note: --stop waits while a tab works, and else ends the run with stopped on request', () => {
  const busy = assertAction(decideFeature(facts({ flags: { stop: true }, record: recordWith(), worker: { state: 'busy', detail: [] } })), 'wait');
  assert.equal(busy.say, 'The run stops after the Phase 1 tab of demo reports. Orca wakes this tab when it reports.');
  assert.deepEqual(busy.workers, [{ feature: 'demo', stage: 'phase', phase: 1, agent: 'dsh', dispatchId: 'disp-1' }]);
  assertAction(decideFeature(facts({ flags: { stop: true }, record: recordWith(), worker: { state: 'unknown', detail: [] } })), 'wait');
  for (const state of ['done', 'idle', 'gone']) {
    const done = assertAction(
      decideFeature(facts({ flags: { stop: true, wake: 'worker_done', dispatch: 'disp-1' }, record: recordWith(), worker: { state, detail: [] } })),
      'done'
    );
    assert.equal(done.say, 'The run of demo stopped on request.');
    assert.ok(done.show.includes('\nOpen tab: the Phase 1 tab of demo on dsh, dispatch disp-1. It stays open in Orca.\n'), done.show);
  }
  const quiet = assertAction(
    decideFeature(facts({ flags: { stop: true }, docs: phaseOneComplete(), git: { subjects: ['feat: demo phase 1'], dirty: ['a.txt'] } })),
    'done'
  );
  assert.equal(
    quiet.show,
    [
      'Run stopped on request - demo',
      '',
      'Phases:',
      '- Phase 1 - Slice 1: committed as "feat: demo phase 1"',
      '- Phase 2 - Slice 2: 0 of 1 task done',
      '',
      'Uncommitted: 1 file on feat/demo.',
      '',
      'Next:',
      '- Run /orca-feature demo to go on from here.',
    ].join('\n')
  );
  // F12 comes before F10 and F11: a stop request never switches a branch and never asks about the work tree.
  assertAction(decideFeature(facts({ flags: { stop: true }, git: { head: 'main', dirty: ['src/a.js'] } })), 'done');
  assertAction(decideFeature(facts({ flags: { stop: true, fresh: true }, git: { dirty: ['src/a.js'] } })), 'done');

  const root = makeProject();
  try {
    gitIn(root, ['switch', '-q', '-c', 'feat/demo']);
    const fake = fakeRunner({});
    const json = assertAction(orcaStep(root, ['next', '--feature', 'demo', '--stop'], { runner: fake.runner }).json, 'done');
    assert.match(json.show, /^Run stopped on request - demo\n/);
    assert.deepEqual(fake.orca(), [], 'a stop with no tab makes no Orca call');
  } finally {
    removeFixture(root);
  }
});

test('note: note and send refuse a bad kind, a bad text file, a missing feature, and a bad reason, and their flags parse strictly', () => {
  const root = makeProject();
  try {
    const fake = fakeRunner({});
    const run = (args) => orcaStep(root, args, { runner: fake.runner }).json;
    const file = path.join(root, 'note.md');
    const note = (kind = 'bug', feature = 'demo') => run(['note', '--feature', feature, '--kind', kind, '--text-file', file]);
    assert.equal(note('change').code, 'kind-not-supported');
    assert.equal(note().code, 'text-missing');
    fs.writeFileSync(file, ' \n');
    assert.equal(note().code, 'text-empty');
    fs.writeFileSync(file, 'a\0b');
    assert.equal(note().code, 'text-invalid');
    fs.writeFileSync(file, 'x'.repeat(MAX_REPLY_BYTES + 1));
    assert.equal(note().code, 'text-too-large');
    fs.writeFileSync(file, 'hi\n');
    assert.equal(note('bug', 'other').code, 'feature-missing');
    assert.equal(note('bug', '../x').code, 'feature-missing');
    assert.equal(run(['send', '--feature', 'demo', '--reason', 'bogus']).code, 'reason-not-supported');
    assert.equal(run(['send', '--feature', 'demo', '--reason', 'report']).code, 'no-tab');
    assert.deepEqual(fake.orca(), []);
    assert.ok(!fs.existsSync(inboxOf(root)), 'no refusal writes the inbox');

    const ctx = { stdout: /** @type {any} */ ({ write: () => true }), cwd: root, pluginRoot: PLUGIN_ROOT, env: testEnv(), runner: fake.runner };
    for (const args of [
      ['note', '--feature', 'demo', '--text-file', file],
      ['note', '--feature', 'demo', '--kind', 'bug'],
      ['note', '--kind', 'bug', '--text-file', file],
      ['note', '--feature', 'demo', '--kind', 'bug', '--text-file', file, '--body', 'x'],
      ['send', '--feature', 'demo'],
      ['send', '--feature', 'demo', '--reason'],
      ['next', '--feature', 'demo', '--stop', 'yes'],
      ['start', '--feature', 'demo', '--retry', '--stage', 'phase'],
    ]) {
      assert.throws(() => runOrca([...args, '--project', root], ctx), UsageError, args.join(' '));
    }
  } finally {
    removeFixture(root);
  }
});

// ---------------------------------------------------------------------------
// Phase 7: a project agent command starts the tab (Decision 16, fact O15)
// ---------------------------------------------------------------------------

const COMMAND_CONFIG = { version: 1, agents: { dsh: { command: 'dsh-personal .' } }, orchestration: { stages: { implement: 'dsh' } } };
/** The answer of `terminal rename` (fix 6). */
const RENAMED = envelope({ terminal: { handle: 'term-7', title: 'demo: Phase 1 implement' } });
const TERMINAL_7 = envelope({ terminal: { handle: 'term-7', worktreeId: 'repo-1::/tmp/demo', title: null } });
const IDLE_7 = envelope({ wait: { handle: 'term-7', condition: 'tui-idle', satisfied: true, status: 'running', exitCode: null } });
const STARTED_7 = envelope({ runId: 'run-7', taskId: 'task-7', dispatchId: 'disp-7', state: 'ready' });
const PHASE_1_START = ['start', '--feature', 'demo', '--stage', 'phase', '--phase', '1'];

/**
 * A runner like fakeRunner that keys a `terminal` or a `worktree` call by
 * its first two words, so `terminal create` and `terminal wait` answer apart.
 *
 * @param {Record<string, import('../lib/orca/steps.js').RunResult>} answers
 */
function commandFake(answers) {
  /** @type {{ command: string, args: string[], timeoutMs: number }[]} */
  const calls = [];
  /** @type {import('../lib/orca/steps.js').Runner} */
  const runner = (command, args, options) => {
    calls.push({ command, args: [...args], timeoutMs: options.timeoutMs });
    if (command === 'git') return defaultRunner(command, args, options);
    assert.equal(command, FAKE_ORCA, `the runner got the unexpected command ${command}`);
    const key = args[0] === 'orchestration' ? args[1] : ['terminal', 'worktree'].includes(args[0]) ? `${args[0]} ${args[1]}` : args[0];
    // The rename after a start (fix 6) answers ok unless a test scripts it.
    if (key === 'terminal rename' && !answers[key]) return RENAMED;
    assert.ok(answers[key], `no fake Orca answer for: ${args.join(' ')}`);
    return answers[key];
  };
  return { runner, answers, calls, orca: () => calls.filter((entry) => entry.command === FAKE_ORCA).map((entry) => entry.args) };
}

/**
 * @returns {string} A project with a project command for dsh, on its run branch.
 */
function commandProject() {
  const root = makeProject({ config: COMMAND_CONFIG });
  assert.equal(orcaStep(root, ['branch', '--feature', 'demo'], { runner: fakeRunner({}).runner }).json.ok, true);
  return root;
}

test('command: the start action names the path and the command in say, and an agent with no command keeps the agent path', () => {
  const action = assertAction(decideFeature(facts({ config: parseOrcaConfig(JSON.stringify(COMMAND_CONFIG)) })), 'start');
  assert.deepEqual([action.path, action.command, action.agent], ['command', 'dsh-personal .', 'dsh']);
  assert.equal(action.say, 'Start the Phase 1 tab of demo on dsh with the project command "dsh-personal .".');
  assert.deepEqual(action.run, PHASE_1_START, 'the run line does not change');
  const plain = assertAction(decideFeature(facts()), 'start');
  assert.deepEqual([plain.path, plain.command, plain.say], ['agent', null, 'Start the Phase 1 tab of demo on dsh.']);
  const other = parseOrcaConfig('{"version":1,"agents":{"claude":{"command":"claude-work"}},"orchestration":{"stages":{"implement":"dsh"}}}');
  assert.equal(decideFeature(facts({ config: other })).path, 'agent', 'only the command of the stage agent counts');
});

test('command: a phase start with a project command runs terminal create, the tui-idle wait, and worker-start --terminal, in order', () => {
  const root = commandProject();
  try {
    const fake = commandFake({ 'terminal create': TERMINAL_7, 'terminal wait': IDLE_7, 'worker-start': STARTED_7, 'worker-show': turnStarted('disp-7') });
    const next = assertAction(orcaStep(root, ['next', '--feature', 'demo'], { runner: fake.runner }).json, 'start');
    assert.deepEqual([next.path, next.command, next.run], ['command', 'dsh-personal .', lineOf(root, PHASE_1_START)]);

    const before = fake.calls.length;
    const { json } = orcaStep(root, PHASE_1_START, { runner: fake.runner });
    const spec = path.join(root, '.beast-mode', 'briefs', 'demo', 'orca-phase-1.md');
    const calls = fake.calls.slice(before).filter((entry) => entry.command === FAKE_ORCA);
    assert.deepEqual(
      calls.map((entry) => entry.args),
      [
        ['terminal', 'create', '--worktree', 'current', '--command', 'dsh-personal .', '--json'],
        ['terminal', 'wait', '--terminal', 'term-7', '--for', 'tui-idle', '--timeout-ms', '60000', '--json'],
        ['orchestration', 'worker-start', '--spec-file', spec, '--task-title', 'demo: Phase 1 implement', '--terminal', 'term-7', '--worktree', 'current', '--json'],
        // The submit loop of the dsh tab reads the tab one time, and the turn runs (fix 1).
        ['orchestration', 'worker-show', '--dispatch', 'disp-7', '--json'],
        // The rename of the tab runs after the submit loop (fix 6).
        ['terminal', 'rename', '--terminal', 'term-7', '--title', 'demo: Phase 1 implement', '--json'],
      ]
    );
    assert.deepEqual(calls.map((entry) => entry.timeoutMs), [30000, 75000, 150000, 30000, 30000]);
    for (const args of fake.orca().filter((entry) => entry[1] !== 'rename')) {
      assert.ok(!args.includes('--title'), `no --title: ${args.join(' ')}`);
      assert.ok(!args.includes('--agent'), `the command path names no agent: ${args.join(' ')}`);
      assert.ok(!args.includes('dsh-personal'), 'the command stays one argument');
    }
    assert.ok(fs.readFileSync(spec, 'utf8').startsWith('# Beast Mode orca worker - demo, Phase 1: Slice 1\n'));
    assert.deepEqual(
      [json.ok, json.path, json.command, json.terminal, json.readyState, json.dispatchId, json.agent],
      [true, 'command', 'dsh-personal .', 'term-7', 'ready', 'disp-7', 'dsh']
    );
    assert.match(json.say, / of demo on dsh with the project command "dsh-personal \."\.$/);
    const active = readRecord(root, 'demo').record.active;
    assert.deepEqual(
      [active.path, active.command, active.terminal, active.readyState, active.dispatchId, active.placement],
      ['command', 'dsh-personal .', 'term-7', 'ready', 'disp-7', 'current']
    );
  } finally {
    removeFixture(root);
  }
});

test('command: a wait that times out, or ends unsatisfied, still runs worker-start, and the start answers ready-unconfirmed', () => {
  const waits = [
    { status: 1, signal: null, stdout: `${JSON.stringify({ ok: false, error: { code: 'timeout', message: 'timeout' } })}\n`, stderr: '', error: null },
    envelope({ wait: { handle: 'term-7', condition: 'tui-idle', satisfied: false, status: 'running', exitCode: null } }, { status: 1 }),
    { status: null, signal: 'SIGTERM', stdout: '', stderr: '', error: { code: 'ETIMEDOUT', message: 'spawnSync fake-orca ETIMEDOUT' } },
  ];
  for (const wait of waits) {
    const root = commandProject();
    try {
      const fake = commandFake({ 'terminal create': TERMINAL_7, 'terminal wait': wait, 'worker-start': STARTED_7, 'worker-show': turnStarted('disp-7') });
      const { json } = orcaStep(root, PHASE_1_START, { runner: fake.runner });
      assert.deepEqual(fake.orca().map((args) => args.slice(0, 2)), [
        ['terminal', 'create'],
        ['terminal', 'wait'],
        ['orchestration', 'worker-start'],
        ['orchestration', 'worker-show'],
        ['terminal', 'rename'],
      ]);
      assert.deepEqual([json.ok, json.readyState, json.dispatchId], [true, 'ready-unconfirmed', 'disp-7'], JSON.stringify(json));
      assert.match(json.say, /Orca did not confirm that the tab was ready\.$/);
      assert.match(json.detail[0], /^The terminal term-7 did not show ready in 60 seconds/);
      assert.equal(readRecord(root, 'demo').record.active.readyState, 'ready-unconfirmed');
    } finally {
      removeFixture(root);
    }
  }
});

test('command: a failed start names the terminal and closes nothing, its retry opens a new terminal on the same Task, and a terminal that does not open runs no wait and no start', () => {
  let root = commandProject();
  try {
    const fake = commandFake({ 'terminal create': TERMINAL_7, 'terminal wait': IDLE_7, 'worker-start': failedStartAnswer('disp-9') });
    const { json } = orcaStep(root, PHASE_1_START, { runner: fake.runner });
    assert.deepEqual([json.ok, json.code, json.path, json.terminal], [false, 'start-failed', 'command', 'term-7']);
    assert.ok(json.detail.includes('The terminal term-7 stays open: close it in Orca.'), JSON.stringify(json.detail));
    assert.deepEqual(
      fake.orca().map((args) => args.slice(0, 2)),
      [['terminal', 'create'], ['terminal', 'wait'], ['orchestration', 'worker-start']],
      'the step closes nothing'
    );
    const failed = readRecord(root, 'demo').record.failedStart;
    assert.deepEqual(
      [failed.path, failed.command, failed.terminal, failed.taskId, failed.dispatchId],
      ['command', 'dsh-personal .', 'term-7', 'task-9', 'disp-9']
    );
    const ask = orcaStep(root, ['next', '--feature', 'demo'], { runner: fake.runner }).json;
    assert.deepEqual([ask.action, ask.reason], ['ask', 'start-failed']);

    // The retry takes the command path again: a new terminal, then worker-start on the same Task.
    fake.answers['terminal create'] = envelope({ terminal: { handle: 'term-8', title: null } });
    fake.answers['worker-start'] = envelope({ runId: 'run-9', taskId: 'task-9', dispatchId: 'disp-10', state: 'ready' });
    fake.answers['worker-show'] = turnStarted('disp-10');
    const before = fake.orca().length;
    const retried = orcaStep(root, [...PHASE_1_START, '--retry'], { runner: fake.runner }).json;
    assert.deepEqual(fake.orca().slice(before), [
      ['terminal', 'create', '--worktree', 'current', '--command', 'dsh-personal .', '--json'],
      ['terminal', 'wait', '--terminal', 'term-8', '--for', 'tui-idle', '--timeout-ms', '60000', '--json'],
      ['orchestration', 'worker-start', '--task', 'task-9', '--retry-of', 'disp-9', '--terminal', 'term-8', '--worktree', 'current', '--json'],
      ['orchestration', 'worker-show', '--dispatch', 'disp-10', '--json'],
      // A retry renames its new tab too (fix 6).
      ['terminal', 'rename', '--terminal', 'term-8', '--title', 'demo: Phase 1 implement', '--json'],
    ]);
    assert.deepEqual([retried.ok, retried.retry, retried.terminal, retried.dispatchId], [true, true, 'term-8', 'disp-10']);
  } finally {
    removeFixture(root);
  }

  root = commandProject();
  try {
    const refusedCreate = {
      status: 1,
      signal: null,
      stdout: `${JSON.stringify({ ok: false, error: { code: 'invalid_argument', message: 'bad command' } })}\n`,
      stderr: '',
      error: null,
    };
    const fake = commandFake({ 'terminal create': refusedCreate });
    const { json } = orcaStep(root, PHASE_1_START, { runner: fake.runner });
    assert.deepEqual(fake.orca().map((args) => args.slice(0, 2)), [['terminal', 'create']], 'no terminal, so no wait and no start');
    assert.deepEqual([json.ok, json.code, json.terminal, json.readyState], [false, 'start-failed', null, null]);
    const failed = readRecord(root, 'demo').record.failedStart;
    assert.deepEqual([failed.code, failed.taskId, failed.terminal], ['invalid_argument', null, null]);
  } finally {
    removeFixture(root);
  }
});

// ---------------------------------------------------------------------------
// Fix 3: the close step closes the tab of a finished command-path worker
// ---------------------------------------------------------------------------

const CLOSE_7 = ['terminal', 'close', '--terminal', 'term-7', '--json'];
const RELEASE_7 = ['orchestration', 'worker-release', '--dispatch', 'disp-7', '--json'];
const CLOSED_7 = envelope({ handle: 'term-7', closed: true });

/**
 * A command-path start of Phase 1, then the answers for a close.
 *
 * @param {string} root
 * @param {Record<string, import('../lib/orca/steps.js').RunResult>} close The answers of the close step.
 */
function startedCommandTab(root, close) {
  const fake = commandFake({
    'terminal create': TERMINAL_7,
    'terminal wait': IDLE_7,
    'worker-start': STARTED_7,
    'worker-show': turnStarted('disp-7'),
    ...close,
  });
  assert.equal(orcaStep(root, PHASE_1_START, { runner: fake.runner }).json.ok, true);
  const active = readRecord(root, 'demo').record.active;
  assert.deepEqual([active.terminal, active.ownTerminal], ['term-7', true], 'the record keeps the own terminal');
  return { fake, before: fake.orca().length };
}

test('close tab: a command-path close with a retained release closes the own terminal with the exact args', () => {
  const root = commandProject();
  try {
    const { fake, before } = startedCommandTab(root, {
      'worker-release': envelope({ dispatchId: 'disp-7', state: 'retained', reason: 'no_owned_resource', processAction: 'none' }),
      'terminal close': CLOSED_7,
    });
    assert.equal(orcaStep(root, PHASE_1_START, { runner: fake.runner }).json.code, 'tab-active', 'a start never closes the tab');
    assert.deepEqual(fake.orca().slice(before), [], 'the refused start runs no Orca call');
    const { json } = orcaStep(root, ['close', '--feature', 'demo'], { runner: fake.runner });
    assert.deepEqual(fake.orca().slice(before), [RELEASE_7, CLOSE_7]);
    assert.deepEqual([json.ok, json.terminalClosed], [true, true]);
    assert.doesNotMatch(json.say, /stays open/);
    assert.equal(readRecord(root, 'demo').record.active, null);
  } finally {
    removeFixture(root);
  }
});

test('close tab: an already_released answer closes the own terminal too, and the discard closes it', () => {
  for (const args of [['close', '--feature', 'demo'], ['close', '--feature', 'demo', '--discard']]) {
    const root = commandProject();
    try {
      const { fake, before } = startedCommandTab(root, {
        'worker-release': envelope({ dispatchId: 'disp-7', state: 'already_released', processAction: 'none' }),
        'terminal close': CLOSED_7,
      });
      const { json } = orcaStep(root, args, { runner: fake.runner });
      assert.deepEqual(fake.orca().slice(before), [RELEASE_7, CLOSE_7], args.join(' '));
      assert.deepEqual([json.ok, json.terminalClosed], [true, true]);
    } finally {
      removeFixture(root);
    }
  }
});

test('close tab: a release that Orca owned (requested) closes no terminal and says nothing of the tab', () => {
  const root = commandProject();
  try {
    const { fake, before } = startedCommandTab(root, { 'worker-release': envelope({ dispatchId: 'disp-7', state: 'requested' }) });
    const { json } = orcaStep(root, ['close', '--feature', 'demo'], { runner: fake.runner });
    assert.deepEqual(fake.orca().slice(before), [RELEASE_7]);
    assert.equal(json.terminalClosed, undefined);
  } finally {
    removeFixture(root);
  }
});

test('close tab: a failed release of an own terminal runs no terminal close and says the tab stays open (fix 5)', () => {
  const refusedRelease = {
    status: 1,
    signal: null,
    stdout: `${JSON.stringify({ ok: false, error: { code: 'dispatch_inactive', message: 'not settled' } })}\n`,
    stderr: '',
    error: null,
  };
  const root = commandProject();
  try {
    const { fake, before } = startedCommandTab(root, { 'worker-release': refusedRelease });
    const { json } = orcaStep(root, ['close', '--feature', 'demo'], { runner: fake.runner });
    assert.deepEqual(fake.orca().slice(before), [RELEASE_7], 'no terminal close: the worker can still run');
    assert.equal(json.ok, true);
    assert.equal(json.terminalClosed, false);
    assert.match(json.say, /The tab term-7 stays open: close it in Orca\./);
  } finally {
    removeFixture(root);
  }
});

test('close tab: an agent-path close never runs terminal close', () => {
  const root = makeProject();
  try {
    assert.equal(orcaStep(root, ['branch', '--feature', 'demo'], { runner: fakeRunner({}).runner }).json.ok, true);
    const fake = fakeRunner({
      'worker-start': envelope({ runId: 'run-1', taskId: 'task-1', dispatchId: 'disp-1', state: 'ready' }),
      'worker-show': turnStarted('disp-1'),
      'worker-release': envelope({ dispatchId: 'disp-1', state: 'retained', reason: 'no_owned_resource' }),
    });
    assert.equal(orcaStep(root, PHASE_1_START, { runner: fake.runner }).json.ok, true);
    const active = readRecord(root, 'demo').record.active;
    assert.equal(active.ownTerminal, undefined, 'an agent-path start sets no ownTerminal');
    const { json } = orcaStep(root, ['close', '--feature', 'demo'], { runner: fake.runner });
    assert.equal(json.ok, true);
    assert.equal(json.terminalClosed, undefined);
    assert.ok(!fake.orca().some((args) => args[0] === 'terminal'), 'no terminal call at all');
  } finally {
    removeFixture(root);
  }
});

test('close tab: a failed terminal close keeps the close good, with terminalClosed false and one say line', () => {
  const root = commandProject();
  try {
    const refusedClose = {
      status: 1,
      signal: null,
      stdout: `${JSON.stringify({ ok: false, error: { code: 'terminal_not_found', message: 'No terminal term-7.' } })}\n`,
      stderr: '',
      error: null,
    };
    const { fake, before } = startedCommandTab(root, {
      'worker-release': envelope({ dispatchId: 'disp-7', state: 'retained', reason: 'no_owned_resource' }),
      'terminal close': refusedClose,
    });
    const { code, json } = orcaStep(root, ['close', '--feature', 'demo'], { runner: fake.runner });
    assert.deepEqual(fake.orca().slice(before), [RELEASE_7, CLOSE_7], 'the failed close never runs again');
    assert.deepEqual([code, json.ok, json.terminalClosed], [0, true, false]);
    assert.ok(json.say.endsWith(' The tab term-7 stays open: close it in Orca.'), json.say);
    assert.equal(readRecord(root, 'demo').record.active, null, 'the record is clear');
  } finally {
    removeFixture(root);
  }
});

test('close tab: a failed start never closes its terminal, and a retry that starts closes nothing', () => {
  const root = commandProject();
  try {
    const fake = commandFake({
      'terminal create': TERMINAL_7,
      'terminal wait': IDLE_7,
      'worker-start': failedStartAnswer('disp-9'),
      'worker-release': envelope({ dispatchId: 'disp-9', state: 'retained', reason: 'no_owned_resource' }),
    });
    assert.equal(orcaStep(root, PHASE_1_START, { runner: fake.runner }).json.ok, false);
    assert.ok(!fake.orca().some((args) => args[1] === 'close'), 'the failed start closes nothing');
    const failed = readRecord(root, 'demo').record.failedStart;
    assert.equal(failed.ownTerminal, undefined, 'a failed start keeps no own mark');
    // The close of the failed start releases the dispatch and leaves the tab for the user.
    const { json } = orcaStep(root, ['close', '--feature', 'demo'], { runner: fake.runner });
    assert.equal(json.ok, true);
    assert.equal(json.terminalClosed, undefined);
    assert.ok(!fake.orca().some((args) => args[0] === 'terminal' && args[1] === 'close'), 'no terminal close for a failed start');

    // The retry opens a new terminal and closes none, and its record owns the new terminal.
    const retry = commandFake({
      'terminal create': envelope({ terminal: { handle: 'term-8', title: null } }),
      'terminal wait': IDLE_7,
      'worker-start': envelope({ runId: 'run-9', taskId: 'task-9', dispatchId: 'disp-10', state: 'ready' }),
      'worker-show': turnStarted('disp-10'),
    });
    const root2 = commandProject();
    try {
      const failing = commandFake({ 'terminal create': TERMINAL_7, 'terminal wait': IDLE_7, 'worker-start': failedStartAnswer('disp-9') });
      orcaStep(root2, PHASE_1_START, { runner: failing.runner });
      const retried = orcaStep(root2, [...PHASE_1_START, '--retry'], { runner: retry.runner }).json;
      assert.equal(retried.ok, true);
      assert.ok(!retry.orca().some((args) => args[1] === 'close'), 'a retry closes nothing');
      const active = readRecord(root2, 'demo').record.active;
      assert.deepEqual([active.terminal, active.ownTerminal], ['term-8', true]);
    } finally {
      removeFixture(root2);
    }
  } finally {
    removeFixture(root);
  }
});

test('CR-5: the one staging form stages everything but the briefs, with and without the .gitignore line', () => {
  for (const ignored of [true, false]) {
    const root = makeProject();
    try {
      if (ignored) fs.writeFileSync(path.join(root, '.gitignore'), '.beast-mode/briefs/\n');
      fs.mkdirSync(path.join(root, '.beast-mode', 'briefs', 'demo'), { recursive: true });
      fs.writeFileSync(path.join(root, '.beast-mode', 'briefs', 'demo', 'spec.md'), 'brief\n');
      fs.writeFileSync(path.join(root, 'hello.txt'), 'hi\n');
      const added = spawnSync('git', gitCalls.addAll().args, { cwd: root, env: testEnv(), encoding: 'utf8' });
      assert.equal(added.status, 0, `ignored=${ignored}: ${added.stderr}`);
      const staged = gitIn(root, ['diff', '--cached', '--name-only']).split('\n').filter(Boolean);
      assert.deepEqual(staged.filter((file) => file !== '.gitignore'), ['hello.txt'], `ignored=${ignored}`);
    } finally {
      removeFixture(root);
    }
  }
});

// ---------------------------------------------------------------------------
// The dsh submit loop (fix 1)
// ---------------------------------------------------------------------------

/** The `worker-show` read of disp-1. */
const SHOW_1 = ['orchestration', 'worker-show', '--dispatch', 'disp-1', '--json'];
/** The bare Enter of the submit loop in term-1. */
const ENTER_1 = ['terminal', 'send', '--terminal', 'term-1', '--enter', '--json'];
/** The answer of a bare Enter that Orca took. */
const ENTER_OK = envelope({ send: { handle: 'term-1', accepted: true, bytesWritten: 1 } });
/** The rename of the tab in term-1 after a start (fix 6): the Task title of Phase 1. */
const RENAME_1 = ['terminal', 'rename', '--terminal', 'term-1', '--title', 'demo: Phase 1 implement', '--json'];
/** A worker-start receipt of the agent path that names the terminal of the agent. */
const RECEIPT_1 = envelope({ runId: 'run-1', taskId: 'task-1', dispatchId: 'disp-1', state: 'ready', terminal: 'term-1' });

/**
 * The `worker-show` answer of a dsh tab before its turn: the session
 * opened (dsh sends `idle` at SessionStart), and the prompt can be a draft.
 *
 * @param {Record<string, unknown>} [extra]
 * @returns {import('../lib/orca/exec.js').RunResult}
 */
function preTurn(extra = {}) {
  return envelope({ dispatchId: 'disp-1', state: 'ready', stage: 'input_accepted', liveness: 'live', activity: 'idle', ...extra });
}

/**
 * commandFake, with `worker-show` answered from a list: one answer for
 * each read, and the last answer repeats.
 *
 * @param {Record<string, import('../lib/orca/steps.js').RunResult>} answers
 * @param {import('../lib/orca/steps.js').RunResult[]} shows
 */
function submitFake(answers, shows) {
  const fake = commandFake(answers);
  const queue = [...shows];
  /** @type {import('../lib/orca/steps.js').Runner} */
  const runner = (command, args, options) => {
    if (command === FAKE_ORCA && args[0] === 'orchestration' && args[1] === 'worker-show') {
      fake.calls.push({ command, args: [...args], timeoutMs: options.timeoutMs });
      return /** @type {import('../lib/orca/steps.js').RunResult} */ (queue.length > 1 ? queue.shift() : queue[0]);
    }
    return fake.runner(command, args, options);
  };
  return { ...fake, runner };
}

/**
 * Run the Phase 1 start of demo, and list the Orca calls after its worker-start.
 *
 * @param {string} root
 * @param {import('../lib/orca/steps.js').Runner} runner
 * @param {{ now?: () => Date, onSleep?: (ms: number) => void }} [opts]
 */
function submitStart(root, runner, { now, onSleep } = {}) {
  /** @type {number[]} */
  const sleeps = [];
  /** @type {string[][]} */
  const orca = [];
  /** @type {import('../lib/orca/steps.js').Runner} */
  const recording = (command, args, options) => {
    if (command === FAKE_ORCA) orca.push([...args]);
    return runner(command, args, options);
  };
  const sleep = (ms) => {
    sleeps.push(ms);
    if (onSleep) onSleep(ms);
  };
  const { code, json } = orcaStep(root, PHASE_1_START, { runner: recording, sleep, ...(now ? { now } : {}) });
  const at = orca.findIndex((args) => args[1] === 'worker-start');
  return { code, json, sleeps, all: orca, after: at === -1 ? [] : orca.slice(at + 1) };
}

/**
 * @param {Record<string, any> | null} [config]
 * @returns {string} A project on its run branch.
 */
function submitProject(config = DEFAULT_CONFIG) {
  const root = makeProject({ config });
  gitIn(root, ['switch', '-q', '-c', 'feat/demo']);
  return root;
}

/**
 * @param {string[]} args
 * @returns {boolean} The call is a bare Enter.
 */
function isEnter(args) {
  return args[0] === 'terminal' && args[1] === 'send';
}

test('dsh submit: turnStartOf reads the turn signal of the field view, and receiptTerminal and terminalEnter read and build the Enter', () => {
  const ok = (result) => /** @type {import('../lib/orca/exec.js').OrcaAnswer} */ ({ kind: 'ok', result, detail: [] });
  const turnOf = (result) => turnStartOf(ok(result)).turn;
  const live = { state: 'ready', stage: 'input_accepted', liveness: 'live' };
  for (const activity of ['working', 'waiting', 'blocked']) assert.equal(turnOf({ ...live, activity }), 'started', activity);
  assert.equal(turnOf({ state: 'succeeded', stage: 'settled' }), 'started');
  assert.equal(turnOf({ state: 'failed', stage: 'settled' }), 'started', 'a report settled the worker, so its turn ran');
  assert.equal(turnOf({ ...live, activity: 'waiting', waitingOnHuman: 'question (via hook)' }), 'started', 'a started turn comes first');
  assert.equal(turnOf({ ...live, activity: 'idle', waitingOnHuman: 'trust this folder (via screen)' }), 'person');
  for (const result of [
    { ...live, activity: 'idle' },
    live,
    { ...live, activity: 'idle', waitingOnHuman: 'unknown' },
    { state: 'start_unknown', stage: 'turn_start_unobserved', liveness: 'live' },
    { state: 'starting', stage: 'dispatch_input' },
    { state: 'ready', liveness: 'unverifiable (missing_liveness_verdict)' },
  ]) {
    assert.equal(turnOf(result), 'pre-turn', JSON.stringify(result));
  }
  for (const result of [
    { state: 'ready', liveness: 'exited' },
    { state: 'stopping' },
    { state: 'stopped' },
    { state: 'stop_unknown' },
    { state: 'abandoned' },
    { state: 'failed', stage: 'terminal_missing' },
  ]) {
    assert.equal(turnOf(result), 'stopped', JSON.stringify(result));
  }
  assert.deepEqual(turnStartOf(ok({ ...live, activity: 'idle', terminal: 'term-3' })), {
    turn: 'pre-turn',
    detail: ['Orca: worker ready, stage input_accepted, liveness live, activity idle.'],
    terminal: 'term-3',
  });
  assert.deepEqual(turnStartOf(ok({ dispatch: { status: 'dispatched' } })), { turn: 'unread', detail: ['worker-show named no worker state.'], terminal: null });
  const missing = { kind: 'failed', code: 'dispatch_not_found', message: 'No dispatch disp-1.', data: null, result: null, detail: ['not found'] };
  assert.deepEqual(turnStartOf(/** @type {any} */ (missing)), { turn: 'unread', detail: ['not found'], terminal: null });

  assert.equal(receiptTerminal({ dispatchId: 'disp-1', terminal: 'term-1' }), 'term-1');
  assert.equal(
    receiptTerminal({ effects: [{ kind: 'worktree', id: 'w' }, { kind: 'terminal', role: 'coordinator', id: 'term-0' }, { kind: 'terminal', role: 'agent', id: 'term-2' }] }),
    'term-2'
  );
  for (const value of [null, 'term-1', {}, { terminal: '' }, { terminal: { handle: 'term-1' } }, { effects: [{ kind: 'terminal', role: 'coordinator', id: 'term-0' }] }]) {
    assert.equal(receiptTerminal(value), null, JSON.stringify(value));
  }

  assert.deepEqual(orcaCalls.terminalEnter('term-1'), { tool: 'orca', args: ENTER_1, timeoutMs: 30000, change: true });
  const t = execContext([DOWN, ENTER_OK]);
  const answer = call(t.ctx, orcaCalls.terminalEnter('term-1'));
  assert.deepEqual([answer.kind, t.calls.length, t.sleeps], ['failed', 1, []], 'an Enter never runs again by itself');
});

test('dsh submit: the turn starts after two Enter presses, with the exact terminal send arrays and a wait of 2 seconds after each', () => {
  const root = submitProject();
  try {
    const fake = submitFake({ 'worker-start': RECEIPT_1, 'terminal send': ENTER_OK }, [preTurn(), preTurn(), turnStarted('disp-1')]);
    const { code, json, sleeps, after } = submitStart(root, fake.runner);
    assert.deepEqual(after, [SHOW_1, ENTER_1, SHOW_1, ENTER_1, SHOW_1, RENAME_1], 'the rename runs after the submit loop');
    assert.deepEqual(fake.calls.filter((entry) => isEnter(entry.args)).map((entry) => entry.timeoutMs), [30000, 30000]);
    assert.deepEqual(sleeps, [SUBMIT_DELAY_MS, SUBMIT_DELAY_MS]);
    assert.deepEqual([code, json.ok, json.path, json.dispatchId, json.submit, json.enters], [0, true, 'agent', 'disp-1', 'confirmed', 2]);
    assert.ok(!json.say.includes(SUBMIT_UNCONFIRMED_SAY), json.say);
    assert.equal(json.detail, undefined);
    assert.equal(readRecord(root, 'demo').record.active.dispatchId, 'disp-1');
  } finally {
    removeFixture(root);
  }
});

test('dsh submit: a turn that already runs, a settled worker, and a question in the tab get no Enter', () => {
  const answers = [
    turnStarted('disp-1'),
    envelope({ dispatchId: 'disp-1', state: 'succeeded', stage: 'settled' }),
    preTurn({ activity: 'waiting', waitingOnHuman: 'question (via hook)' }),
  ];
  for (const shown of answers) {
    const root = submitProject();
    try {
      const fake = submitFake({ 'worker-start': RECEIPT_1 }, [shown]);
      const { json, sleeps, after } = submitStart(root, fake.runner);
      assert.deepEqual(after, [SHOW_1, RENAME_1], 'one read, and no Enter, then the rename');
      assert.deepEqual([json.ok, json.submit, json.enters, sleeps], [true, 'confirmed', 0, []], JSON.stringify(json));
    } finally {
      removeFixture(root);
    }
  }
});

test('dsh submit: a turn that never starts ends unconfirmed after a bounded count of Enter presses, and the start still succeeds', () => {
  assert.deepEqual([SUBMIT_WINDOW_MS, SUBMIT_DELAY_MS, SUBMIT_MAX_ENTERS], [45000, 2000, 22]);
  let root = submitProject();
  try {
    // A clock that stands still: the cap of one Enter for each wait of the window ends the loop.
    const fake = submitFake({ 'worker-start': RECEIPT_1, 'terminal send': ENTER_OK }, [preTurn()]);
    const { code, json, sleeps, after } = submitStart(root, fake.runner);
    assert.equal(after.filter(isEnter).length, SUBMIT_MAX_ENTERS);
    assert.equal(after.length, 2 * SUBMIT_MAX_ENTERS + 2, 'one read before each Enter, one read after the last wait, and the rename');
    assert.deepEqual(after.at(-1), RENAME_1);
    assert.equal(sleeps.length, SUBMIT_MAX_ENTERS);
    assert.deepEqual([code, json.ok, json.submit, json.enters], [0, true, 'unconfirmed', SUBMIT_MAX_ENTERS]);
    assert.ok(json.say.endsWith(` ${SUBMIT_UNCONFIRMED_SAY}`), json.say);
    assert.equal(SUBMIT_UNCONFIRMED_SAY, 'dsh did not confirm the prompt. Press Enter in the tab if the prompt is still a draft.');
    assert.deepEqual(json.detail, ['dsh showed no turn start in 45 seconds, after 22 Enter presses.', 'Orca: worker ready, stage input_accepted, liveness live, activity idle.']);
    assert.equal(readRecord(root, 'demo').record.active.dispatchId, 'disp-1', 'the tab stays recorded');
  } finally {
    removeFixture(root);
  }

  root = submitProject();
  try {
    // A real clock: each Orca call takes 1 second, and each wait its 2 seconds. The 45 seconds end the loop.
    let clock = 0;
    const fake = submitFake({ 'worker-start': RECEIPT_1, 'terminal send': ENTER_OK }, [preTurn()]);
    /** @type {import('../lib/orca/steps.js').Runner} */
    const runner = (command, args, options) => {
      if (command === FAKE_ORCA) clock += 1000;
      return fake.runner(command, args, options);
    };
    const { json, after } = submitStart(root, runner, { now: () => new Date(NOW.getTime() + clock), onSleep: (ms) => (clock += ms) });
    assert.deepEqual([json.ok, json.submit, json.enters, after.filter(isEnter).length], [true, 'unconfirmed', 11, 11]);
    assert.equal(json.detail[0], 'dsh showed no turn start in 45 seconds, after 11 Enter presses.');
  } finally {
    removeFixture(root);
  }
});

test('dsh submit: a tab that waits on a person gets no Enter, also after an earlier Enter', () => {
  const person = preTurn({ waitingOnHuman: 'trust this folder (via screen)' });
  let root = submitProject();
  try {
    const fake = submitFake({ 'worker-start': RECEIPT_1, 'terminal send': ENTER_OK }, [person]);
    const { json, sleeps, after } = submitStart(root, fake.runner);
    assert.deepEqual([after, sleeps], [[SHOW_1, RENAME_1], []], 'no Enter on a tab that waits on a person');
    assert.deepEqual([json.ok, json.submit, json.enters], [true, 'unconfirmed', 0]);
    assert.ok(json.say.endsWith(SUBMIT_UNCONFIRMED_SAY), json.say);
    assert.ok(json.detail.includes('Orca: the tab waits on a person: trust this folder (via screen)'), JSON.stringify(json.detail));
    assert.ok(json.detail.includes('The tab waits on a person, so the step stopped after 0 Enter presses.'), JSON.stringify(json.detail));
  } finally {
    removeFixture(root);
  }

  root = submitProject();
  try {
    const fake = submitFake({ 'worker-start': RECEIPT_1, 'terminal send': ENTER_OK }, [preTurn(), person]);
    const { json, after } = submitStart(root, fake.runner);
    assert.deepEqual(after, [SHOW_1, ENTER_1, SHOW_1, RENAME_1]);
    assert.deepEqual([json.submit, json.enters], ['unconfirmed', 1]);
    assert.ok(json.detail.includes('The tab waits on a person, so the step stopped after 1 Enter press.'), JSON.stringify(json.detail));
  } finally {
    removeFixture(root);
  }
});

test('dsh submit: a failed Enter or a failed read ends the loop unconfirmed, and the start stays good with its tab open', () => {
  const refusedEnter = {
    status: 1,
    signal: null,
    stdout: `${JSON.stringify({ ok: false, error: { code: 'terminal_not_found', message: 'No terminal term-1.' } })}\n`,
    stderr: '',
    error: null,
  };
  let root = submitProject();
  try {
    const fake = submitFake({ 'worker-start': RECEIPT_1, 'terminal send': refusedEnter }, [preTurn()]);
    const { code, json, sleeps, all, after } = submitStart(root, fake.runner);
    assert.deepEqual([after, sleeps], [[SHOW_1, ENTER_1, RENAME_1], []], 'one Enter: a failed Enter never runs again');
    assert.deepEqual([code, json.ok, json.submit, json.enters], [0, true, 'unconfirmed', 0]);
    assert.deepEqual(json.detail, ['fake-orca terminal send: terminal_not_found: No terminal term-1.', 'The Enter failed after 0 Enter presses.']);
    assert.ok(!all.some((args) => args[0] === 'terminal' && args[1] !== 'send' && args[1] !== 'rename'), 'the agent path opens and closes no terminal');
    assert.ok(!all.some((args) => args[1] === 'worker-release'), 'the tab stays open');
    assert.equal(readRecord(root, 'demo').record.active.dispatchId, 'disp-1');
  } finally {
    removeFixture(root);
  }

  root = submitProject();
  try {
    const fake = submitFake({ 'worker-start': RECEIPT_1, 'terminal send': ENTER_OK }, [NOT_FOUND]);
    const { code, json, after } = submitStart(root, fake.runner);
    assert.deepEqual(after, [SHOW_1, RENAME_1], 'a failed read presses nothing');
    assert.deepEqual([code, json.ok, json.submit, json.enters], [0, true, 'unconfirmed', 0]);
    assert.deepEqual(json.detail, ['fake-orca orchestration worker-show: dispatch_not_found: No dispatch disp-1.']);
  } finally {
    removeFixture(root);
  }
});

test('dsh submit: the command path presses Enter in the terminal of the command', () => {
  const root = commandProject();
  try {
    const answers = { 'terminal create': TERMINAL_7, 'terminal wait': IDLE_7, 'worker-start': STARTED_7, 'terminal send': ENTER_OK };
    // The view names another terminal: the loop keeps the terminal that the command opened.
    const fake = submitFake(answers, [preTurn({ dispatchId: 'disp-7', terminal: 'term-9' }), turnStarted('disp-7')]);
    const { json, sleeps, all } = submitStart(root, fake.runner);
    const spec = path.join(root, '.beast-mode', 'briefs', 'demo', 'orca-phase-1.md');
    const show = ['orchestration', 'worker-show', '--dispatch', 'disp-7', '--json'];
    assert.deepEqual(all, [
      ['terminal', 'create', '--worktree', 'current', '--command', 'dsh-personal .', '--json'],
      ['terminal', 'wait', '--terminal', 'term-7', '--for', 'tui-idle', '--timeout-ms', '60000', '--json'],
      ['orchestration', 'worker-start', '--spec-file', spec, '--task-title', 'demo: Phase 1 implement', '--terminal', 'term-7', '--worktree', 'current', '--json'],
      show,
      ['terminal', 'send', '--terminal', 'term-7', '--enter', '--json'],
      show,
      // The rename runs after the Enter loop, in the terminal of the command (fix 6).
      ['terminal', 'rename', '--terminal', 'term-7', '--title', 'demo: Phase 1 implement', '--json'],
    ]);
    assert.deepEqual(sleeps, [SUBMIT_DELAY_MS]);
    assert.deepEqual(
      [json.ok, json.path, json.terminal, json.readyState, json.submit, json.enters],
      [true, 'command', 'term-7', 'ready', 'confirmed', 1]
    );
  } finally {
    removeFixture(root);
  }
});

test('dsh submit: the agent path presses Enter in the terminal of the receipt, else in the terminal of the view, and with no terminal presses nothing', () => {
  const cases = [
    { receipt: RECEIPT_1, view: { terminal: 'term-9' }, enter: ENTER_1, rename: RENAME_1 },
    {
      receipt: envelope({ runId: 'run-1', taskId: 'task-1', dispatchId: 'disp-1', state: 'ready' }),
      view: { terminal: 'term-9' },
      enter: ['terminal', 'send', '--terminal', 'term-9', '--enter', '--json'],
      // The tab of the view is the tab to rename, when the receipt names none (fix 6).
      rename: ['terminal', 'rename', '--terminal', 'term-9', '--title', 'demo: Phase 1 implement', '--json'],
    },
  ];
  for (const { receipt, view, enter, rename } of cases) {
    const root = submitProject();
    try {
      const fake = submitFake({ 'worker-start': receipt, 'terminal send': ENTER_OK }, [preTurn(view), turnStarted('disp-1')]);
      const { json, after } = submitStart(root, fake.runner);
      assert.deepEqual(after, [SHOW_1, enter, SHOW_1, rename]);
      assert.deepEqual([json.ok, json.path, json.submit, json.enters], [true, 'agent', 'confirmed', 1]);
    } finally {
      removeFixture(root);
    }
  }

  const root = submitProject();
  try {
    const bare = envelope({ runId: 'run-1', taskId: 'task-1', dispatchId: 'disp-1', state: 'ready' });
    const fake = submitFake({ 'worker-start': bare, 'terminal send': ENTER_OK }, [preTurn()]);
    const { json, after } = submitStart(root, fake.runner);
    assert.deepEqual(after, [SHOW_1], 'no terminal, so no Enter and no rename');
    assert.deepEqual([json.ok, json.submit, json.enters], [true, 'unconfirmed', 0]);
    assert.equal(json.detail.at(-1), 'Orca named no terminal of the tab, so the step pressed no Enter.');
  } finally {
    removeFixture(root);
  }
});

test('dsh submit: a claude stage runs no submit loop on the agent path and on the command path', () => {
  const agentPath = { version: 1, orchestration: { stages: { implement: 'claude' } } };
  const commandPath = { version: 1, agents: { claude: { command: 'claude-work' } }, orchestration: { stages: { implement: 'claude' } } };
  let root = submitProject(agentPath);
  try {
    // No worker-show answer and no terminal send answer: a call to either fails the test.
    const fake = submitFake({ 'worker-start': RECEIPT_1 }, []);
    const { json, all, sleeps } = submitStart(root, fake.runner);
    const spec = path.join(root, '.beast-mode', 'briefs', 'demo', 'orca-phase-1.md');
    assert.deepEqual(all, [
      ['orchestration', 'worker-start', '--spec-file', spec, '--task-title', 'demo: Phase 1 implement', '--worktree', 'current', '--agent', 'claude', '--timeout-ms', '120000', '--json'],
      // The tab of a claude stage gets the rename too, with no submit loop (fix 6).
      RENAME_1,
    ]);
    assert.deepEqual([json.ok, json.agent, 'submit' in json, 'enters' in json, sleeps], [true, 'claude', false, false, []], JSON.stringify(json));
  } finally {
    removeFixture(root);
  }

  root = submitProject(commandPath);
  try {
    const fake = submitFake({ 'terminal create': TERMINAL_7, 'terminal wait': IDLE_7, 'worker-start': STARTED_7 }, []);
    const { json, all } = submitStart(root, fake.runner);
    assert.deepEqual(all.map((args) => args.slice(0, 2)), [['terminal', 'create'], ['terminal', 'wait'], ['orchestration', 'worker-start'], ['terminal', 'rename']]);
    assert.deepEqual([json.ok, json.path, json.agent, 'submit' in json], [true, 'command', 'claude', false], JSON.stringify(json));
  } finally {
    removeFixture(root);
  }
});

// ---------------------------------------------------------------------------
// Fix 6: the tab of a started worker gets the Task title with `terminal rename`
// ---------------------------------------------------------------------------

/** A project config whose implement stage runs claude: no submit loop, so the calls after the start are the rename only. */
const CLAUDE_STAGE = { version: 1, orchestration: { stages: { implement: 'claude' } } };
/** The same config with a project command for claude, so the start takes the command path. */
const CLAUDE_COMMAND = { version: 1, agents: { claude: { command: 'claude-work' } }, orchestration: { stages: { implement: 'claude' } } };
const REFUSED_RENAME = {
  status: 1,
  signal: null,
  stdout: `${JSON.stringify({ ok: false, error: { code: 'terminal_not_found', message: 'No terminal term-1.' } })}\n`,
  stderr: '',
  error: null,
};

test('tab title: the builder passes the title as one argument, and a failed rename never runs again by itself', () => {
  assert.deepEqual(orcaCalls.terminalRename({ terminal: 'term-1', title: 'ux-qol-2: Phase 1 implement' }), {
    tool: 'orca',
    args: ['terminal', 'rename', '--terminal', 'term-1', '--title', 'ux-qol-2: Phase 1 implement', '--json'],
    timeoutMs: 30000,
    change: true,
  });
  const t = execContext([DOWN, ENTER_OK]);
  const answer = call(t.ctx, orcaCalls.terminalRename({ terminal: 'term-1', title: 'a: b' }));
  assert.deepEqual([answer.kind, t.calls.length, t.sleeps], ['failed', 1, []], 'a rename never retries by itself');
});

test('tab title: the agent-path start runs terminal rename with the exact args after worker-start', () => {
  const root = submitProject(CLAUDE_STAGE);
  try {
    const fake = submitFake({ 'worker-start': RECEIPT_1 }, []);
    const { json, all } = submitStart(root, fake.runner);
    const spec = path.join(root, '.beast-mode', 'briefs', 'demo', 'orca-phase-1.md');
    assert.deepEqual(all, [
      ['orchestration', 'worker-start', '--spec-file', spec, '--task-title', 'demo: Phase 1 implement', '--worktree', 'current', '--agent', 'claude', '--timeout-ms', '120000', '--json'],
      RENAME_1,
    ]);
    assert.deepEqual([json.ok, json.tabTitled], [true, true]);
  } finally {
    removeFixture(root);
  }
});

test('tab title: the command-path start runs terminal rename after the Enter loop, in the terminal of the command', () => {
  const root = commandProject();
  try {
    const answers = { 'terminal create': TERMINAL_7, 'terminal wait': IDLE_7, 'worker-start': STARTED_7, 'terminal send': ENTER_OK };
    const fake = submitFake(answers, [preTurn({ dispatchId: 'disp-7' }), turnStarted('disp-7')]);
    const { json, all } = submitStart(root, fake.runner);
    assert.deepEqual(all.slice(-3).map((args) => args.slice(0, 2)), [['terminal', 'send'], ['orchestration', 'worker-show'], ['terminal', 'rename']]);
    assert.deepEqual(all.at(-1), ['terminal', 'rename', '--terminal', 'term-7', '--title', 'demo: Phase 1 implement', '--json']);
    assert.deepEqual([json.ok, json.submit, json.tabTitled], [true, 'confirmed', true]);
  } finally {
    removeFixture(root);
  }
});

test('tab title: a retry on the agent path and on the command path renames its new tab with the title of the stage', () => {
  // Agent path: the retry opens a new tab with the worker- title again.
  let root = submitProject(CLAUDE_STAGE);
  try {
    const fake = submitFake({ 'worker-start': failedStartAnswer('disp-9') }, []);
    assert.equal(submitStart(root, fake.runner).json.ok, false);
    assert.ok(!fake.orca().some((args) => args[1] === 'rename'), 'a failed start renames nothing');
    fake.answers['worker-start'] = envelope({ runId: 'run-9', taskId: 'task-9', dispatchId: 'disp-10', state: 'ready', terminal: 'term-3' });
    const before = fake.orca().length;
    const retried = orcaStep(root, [...PHASE_1_START, '--retry'], { runner: fake.runner }).json;
    assert.deepEqual([retried.ok, retried.retry, retried.tabTitled], [true, true, true]);
    assert.deepEqual(fake.orca().slice(before).at(-1), ['terminal', 'rename', '--terminal', 'term-3', '--title', 'demo: Phase 1 implement', '--json']);
  } finally {
    removeFixture(root);
  }

  // Command path: pinned in full by the command test of the failed start; here the title and the terminal.
  root = commandProject();
  try {
    const fake = commandFake({ 'terminal create': TERMINAL_7, 'terminal wait': IDLE_7, 'worker-start': failedStartAnswer('disp-9') });
    orcaStep(root, PHASE_1_START, { runner: fake.runner });
    fake.answers['terminal create'] = envelope({ terminal: { handle: 'term-8', title: null } });
    fake.answers['worker-start'] = envelope({ runId: 'run-9', taskId: 'task-9', dispatchId: 'disp-10', state: 'ready' });
    fake.answers['worker-show'] = turnStarted('disp-10');
    const retried = orcaStep(root, [...PHASE_1_START, '--retry'], { runner: fake.runner }).json;
    assert.deepEqual([retried.ok, retried.tabTitled], [true, true]);
    assert.deepEqual(fake.orca().at(-1), ['terminal', 'rename', '--terminal', 'term-8', '--title', 'demo: Phase 1 implement', '--json']);
  } finally {
    removeFixture(root);
  }
});

test('tab title: a failed rename keeps the start good with tabTitled false, adds no say line, and runs once', () => {
  const good = submitProject(CLAUDE_STAGE);
  const bad = submitProject(CLAUDE_STAGE);
  try {
    const first = submitStart(good, submitFake({ 'worker-start': RECEIPT_1 }, []).runner).json;
    const fake = submitFake({ 'worker-start': RECEIPT_1, 'terminal rename': REFUSED_RENAME }, []);
    const { code, json, all } = submitStart(bad, fake.runner);
    assert.deepEqual([code, json.ok, json.tabTitled, json.dispatchId], [0, true, false, 'disp-1']);
    assert.equal(json.say, first.say, 'a failed rename adds no say line');
    assert.equal(json.detail, undefined);
    assert.equal(all.filter((args) => args[1] === 'rename').length, 1, 'the rename never runs again');
    assert.equal(readRecord(bad, 'demo').record.active.dispatchId, 'disp-1', 'the record keeps the tab');
  } finally {
    removeFixture(good);
    removeFixture(bad);
  }
});

test('tab title: a start with no terminal handle runs no rename and adds no tabTitled', () => {
  const bare = envelope({ runId: 'run-1', taskId: 'task-1', dispatchId: 'disp-1', state: 'ready' });
  // A claude stage on the agent path: the receipt names no terminal, and no view is read.
  let root = submitProject(CLAUDE_STAGE);
  try {
    const { json, all } = submitStart(root, submitFake({ 'worker-start': bare }, []).runner);
    assert.deepEqual([json.ok, 'tabTitled' in json], [true, false]);
    assert.ok(!all.some((args) => args[1] === 'rename'));
  } finally {
    removeFixture(root);
  }
  // A dsh stage whose view names no terminal either: the loop presses no Enter and the step renames nothing.
  root = submitProject();
  try {
    const { json, all } = submitStart(root, submitFake({ 'worker-start': bare, 'terminal send': ENTER_OK }, [preTurn()]).runner);
    assert.deepEqual([json.ok, json.submit, 'tabTitled' in json], [true, 'unconfirmed', false]);
    assert.ok(!all.some((args) => args[1] === 'rename'));
  } finally {
    removeFixture(root);
  }
  // A command-path start of claude: the terminal of the command exists, so the rename runs.
  root = submitProject(CLAUDE_COMMAND);
  try {
    const { json, all } = submitStart(root, submitFake({ 'terminal create': TERMINAL_7, 'terminal wait': IDLE_7, 'worker-start': STARTED_7 }, []).runner);
    assert.deepEqual([json.ok, json.tabTitled], [true, true]);
    assert.deepEqual(all.at(-1), ['terminal', 'rename', '--terminal', 'term-7', '--title', 'demo: Phase 1 implement', '--json']);
  } finally {
    removeFixture(root);
  }
});

test('dsh submit: the record holds the dispatch before the loop runs, so a step that dies in the loop loses no dispatch (CR-2)', () => {
  const root = submitProject();
  try {
    const fake = submitFake({ 'worker-start': RECEIPT_1 }, [preTurn()]);
    /** @type {import('../lib/orca/steps.js').Runner} */
    const runner = (command, args, options) => {
      if (command === FAKE_ORCA && args[1] === 'worker-show') throw new Error('the step was killed');
      return fake.runner(command, args, options);
    };
    const { code, json } = orcaStep(root, PHASE_1_START, { runner });
    assert.deepEqual([code, json.ok, json.code], [1, false, 'internal-error']);
    const active = readRecord(root, 'demo').record.active;
    assert.deepEqual([active.dispatchId, active.agent], ['disp-1', 'dsh']);
  } finally {
    removeFixture(root);
  }
});

// ---------------------------------------------------------------------------
// The dsh wait (fix 2): an idle dsh tab that waits on its own subagent
// ---------------------------------------------------------------------------

const MINUTE = 60 * 1000;

/**
 * @param {number} ms
 * @returns {Date} The time `ms` before NOW, the clock of every step.
 */
function ago(ms) {
  return new Date(NOW.getTime() - ms);
}

/**
 * A temporary home folder with a temporary bin folder, for the dsh wait
 * tests. The bin folder holds the live wrapper shape `dsh-personal`. No
 * test reads the real home: HOME, PATH, and DSH_HOME come from here.
 *
 * @returns {{ base: string, home: string, bin: string, dshHome: string }}
 */
function dshWaitSetup() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'bm-dsh-wait-'));
  const home = path.join(base, 'home');
  const bin = path.join(base, 'bin');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'dsh-personal'), '#!/bin/sh\nexport DSH_HOME="$HOME/.dsh-personal"\nexec dsh-tui "$@"\n', { mode: 0o755 });
  return { base, home, bin, dshHome: path.join(home, '.dsh-personal') };
}

/**
 * The step environment of a dsh wait test: the temporary HOME, the
 * temporary bin folder first on PATH, and no DSH_HOME or DSH_SESSION_ID of
 * the shell that runs the suite.
 *
 * @param {{ home: string, bin: string }} setup
 * @param {Record<string, string>} [extra]
 * @returns {Record<string, string | undefined>}
 */
function dshEnv(setup, extra = {}) {
  const env = testEnv({ HOME: setup.home, PATH: `${setup.bin}${path.delimiter}${process.env.PATH ?? ''}`, ...extra });
  for (const key of ['DSH_HOME', 'DSH_SESSION_ID']) {
    if (!(key in extra)) delete env[key];
  }
  return env;
}

/**
 * Make one dsh session folder of a workspace: a `session.lock` with the open
 * time and a log with the time of its last write.
 *
 * @param {string} dshHome
 * @param {string} workspace
 * @param {string} id
 * @param {{ opened: Date, wrote: Date }} times
 */
function dshSession(dshHome, workspace, id, { opened, wrote }) {
  const dir = path.join(dshHome, 'sessions', /** @type {string} */ (dshProjectKey(workspace)), id);
  fs.mkdirSync(dir, { recursive: true });
  const lock = path.join(dir, 'session.lock');
  const log = path.join(dir, 'session.v4.jsonl.zstd');
  fs.writeFileSync(lock, '');
  fs.writeFileSync(log, 'not zstd\n');
  fs.utimesSync(lock, opened, opened);
  fs.utimesSync(log, wrote, wrote);
}

/**
 * The `worker-show` answer of an idle tab that names its workspace.
 *
 * @param {string} workspace
 * @returns {import('../lib/orca/exec.js').RunResult}
 */
function idleShow(workspace) {
  return envelope({ dispatchId: 'disp-1', state: 'ready', stage: 'turn', liveness: 'live', activity: 'idle', terminal: 'term-7', workspace: `repo-1::${workspace}` });
}

/** A project of demo whose orca.json starts the dsh tab with the wrapper `dsh-personal`. */
const DSH_WRAPPER_CONFIG = { ...DEFAULT_CONFIG, agents: { dsh: { command: 'dsh-personal' } } };

test('dsh wait: the dsh home comes from the wrapper ($HOME, ${HOME}, and ~), then the environment, then ~/.dsh, and orca.json holds no env key', () => {
  const setup = dshWaitSetup();
  try {
    const cwd = setup.base;
    const config = (/** @type {Record<string, any>} */ agents) => parseOrcaConfig(JSON.stringify({ version: 1, agents }));
    const env = { HOME: setup.home, PATH: setup.bin };
    const live = path.join(setup.bin, 'dsh-personal');

    // 1. The wrapper: the live shape, the first word of a command with arguments, and a ~ path.
    assert.deepEqual(resolveDshHome({ config: config({ dsh: { command: 'dsh-personal' } }), env, platform: 'linux', cwd }), {
      home: path.join(setup.home, '.dsh-personal'),
      source: 'wrapper',
      wrapper: live,
    });
    assert.equal(resolveDshHome({ config: config({ dsh: { command: 'dsh-personal --profile p' } }), env, platform: 'linux', cwd }).source, 'wrapper');
    fs.mkdirSync(path.join(setup.home, 'bin'));
    fs.writeFileSync(path.join(setup.home, 'bin', 'dsh-mine'), '#!/bin/sh\n# DSH_HOME=/wrong\nDSH_HOME=~/.dsh-mine exec dsh "$@"\n', { mode: 0o755 });
    assert.deepEqual(resolveDshHome({ config: config({ dsh: { command: '~/bin/dsh-mine' } }), env, platform: 'linux', cwd }), {
      home: path.join(setup.home, '.dsh-mine'),
      source: 'wrapper',
      wrapper: path.join(setup.home, 'bin', 'dsh-mine'),
    });
    // The forms of one assignment line.
    assert.equal(wrapperHome('export DSH_HOME="${HOME}/x"\n', '/h'), '/h/x');
    assert.equal(wrapperHome('export DSH_HOME=$HOME/y/\n', '/h'), '/h/y');
    assert.equal(wrapperHome("DSH_HOME='~/z' dsh\n", '/h'), '/h/z');
    assert.equal(wrapperHome('# DSH_HOME=/wrong\n  export DSH_HOME=/right; exec dsh\n', '/h'), '/right');
    for (const text of ['DSH_HOME="$XDG_DATA_HOME/dsh"\n', "DSH_HOME='$HOME/q'\n", 'DSH_HOME=rel/dir\n', 'DSH_HOME=\n', 'MY_DSH_HOME=/no\n', 'exec dsh-tui "$@"\n']) {
      assert.equal(wrapperHome(text, '/h'), null, text);
    }

    // 2. The environment, when the wrapper sets no home: no line, over 64 KiB, a binary file, or not runnable.
    const withEnv = { ...env, DSH_HOME: '~/.dsh-env' };
    const environment = { home: path.join(setup.home, '.dsh-env'), source: 'environment' };
    const wrappers = {
      'dsh-plain': ['#!/bin/sh\nexec dsh "$@"\n', 0o755],
      'dsh-big': [`#!/bin/sh\n${'#'.repeat(70 * 1024)}\nexport DSH_HOME=/big\n`, 0o755],
      'dsh-binary': [Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x00]), Buffer.from('\nDSH_HOME=/binary\n')]), 0o755],
      'dsh-locked': ['#!/bin/sh\nexport DSH_HOME=/locked\n', 0o644],
    };
    for (const [name, [body, mode]] of Object.entries(wrappers)) {
      fs.writeFileSync(path.join(setup.bin, name), body, { mode });
      const found = resolveDshHome({ config: config({ dsh: { command: name } }), env: withEnv, platform: 'linux', cwd });
      assert.deepEqual({ home: found.home, source: found.source }, environment, name);
    }
    assert.deepEqual(resolveDshHome({ config: config({}), env: { ...env, DSH_HOME: '/abs/home/' }, platform: 'linux', cwd }), {
      home: '/abs/home',
      source: 'environment',
      wrapper: null,
    });

    // 3. The default, for no command, a blank DSH_HOME, and no valid settings file.
    const fallback = { home: path.join(setup.home, '.dsh'), source: 'default', wrapper: null };
    assert.deepEqual(resolveDshHome({ config: config({}), env: { ...env, DSH_HOME: '   ' }, platform: 'linux', cwd }), fallback);
    assert.deepEqual(resolveDshHome({ config: { state: 'missing' }, env, platform: 'linux', cwd }), fallback);

    // The shared launch rules refuse agents.dsh.env (Q5), so a file that sets DSH_HOME there is invalid, not a source.
    assert.deepEqual(parseOrcaConfig('{"version":1,"agents":{"dsh":{"env":{"DSH_HOME":"/x"}}}}'), {
      state: 'invalid',
      problems: [{ code: 'agent-env', at: '$.agents.dsh.env' }],
    });
  } finally {
    fs.rmSync(setup.base, { recursive: true, force: true });
  }
});

test('dsh wait: the session folder of a workspace follows the projectKey rule of dsh, and the worker-show answer names the workspace', () => {
  assert.equal(dshProjectKey('/home/aaronstatic/dev/brutal-ui'), '--home-aaronstatic-dev-brutal-ui--');
  assert.equal(dshProjectKey('/home/aaronstatic/.claude/plugins/dev-marketplace/beast-mode'), '--home-aaronstatic-.claude-plugins-dev-marketplace-beast-mode--');
  assert.equal(dshProjectKey('/srv//a b/~x/'), '--srv-a~0020b-~007Ex---');
  assert.equal(dshProjectKey('C:\\Users\\me'), '--C-Users-me--');
  assert.equal(dshProjectKey('/'), '--root--');
  assert.equal(dshProjectKey(`/${'a'.repeat(300)}`), `--${'a'.repeat(251)}--`);
  assert.equal(dshProjectKey(''), null);
  assert.deepEqual([dshSegment('0b6c-uuid'), dshSegment('a/b'), dshSegment('..'), dshSegment(undefined)], ['0b6c-uuid', 'a~002Fb', '~002E~002E', null]);

  const ok = (/** @type {any} */ result) => ({ kind: 'ok', result, detail: [] });
  assert.equal(showWorkspace(ok({ workspace: 'repo-1::/w/field' })), '/w/field');
  assert.equal(showWorkspace(ok({ projection: { workspace: { id: 'repo-1::/w/full' } } })), '/w/full');
  assert.equal(showWorkspace(ok({ worker: { worktreeId: 'repo-1::/w/older' } })), '/w/older');
  assert.equal(showWorkspace(ok({ workspace: 'no-path' })), null);
  assert.equal(showWorkspace(ok({ workspace: 'repo-1::relative/x' })), null);
  assert.equal(showWorkspace({ kind: 'failed', detail: [] }), null);
});

test('dsh wait: the session of the tab, an older session, and the session of the coordinator never count as a subagent', () => {
  const setup = dshWaitSetup();
  try {
    const workspace = '/work/demo';
    const read = (/** @type {Record<string, any>} */ extra = {}) =>
      readDshChild({ home: setup.dshHome, workspaces: [workspace], startedAt: ago(20 * MINUTE).toISOString(), now: NOW, ...extra });
    // No sessions folder.
    assert.deepEqual([read().active, read().sessions], [false, 0]);
    // The tab wrote its own log at the end of its turn: it is the first session after the start, so it never counts.
    dshSession(setup.dshHome, workspace, 'lead', { opened: ago(19 * MINUTE), wrote: ago(2000) });
    // An older session of the workspace writes now, and it opened before the tab.
    dshSession(setup.dshHome, workspace, 'older', { opened: ago(60 * MINUTE), wrote: ago(5000) });
    // A subagent that ended 11 minutes ago.
    dshSession(setup.dshHome, workspace, 'done-child', { opened: ago(18 * MINUTE), wrote: ago(11 * MINUTE) });
    // The coordinator on dsh opened after the tab, and it writes now.
    dshSession(setup.dshHome, workspace, 'coord-1', { opened: ago(10 * MINUTE), wrote: ago(1000) });
    let fact = read({ exclude: 'coord-1' });
    assert.deepEqual([fact.active, fact.sessions, fact.children, fact.recent], [false, 3, 1, 0]);
    assert.equal(fact.detail[0], 'dsh: no subagent session of the tab wrote in the last 10 minutes (1 subagent session in all).');
    assert.equal(read().active, true, 'with no DSH_SESSION_ID, the coordinator session reads as a child');
    // No start time: no session can be told apart.
    fact = read({ exclude: 'coord-1', startedAt: null });
    assert.equal(fact.active, false);
    assert.match(fact.detail[0], /holds no start time/);

    // A subagent that wrote 30 s ago makes the fact active, up to DSH_CHILD_ACTIVE_MS after its last write.
    dshSession(setup.dshHome, workspace, 'child', { opened: ago(18 * MINUTE), wrote: ago(30 * 1000) });
    fact = read({ exclude: 'coord-1' });
    assert.deepEqual([fact.active, fact.children, fact.recent, fact.newestAt], [true, 2, 1, ago(30 * 1000).toISOString()]);
    assert.equal(fact.detail[0], 'dsh: 1 subagent session of the tab wrote in the last 10 minutes, the newest 30 s ago.');
    assert.equal(read({ exclude: 'coord-1', now: new Date(ago(30 * 1000).getTime() + DSH_CHILD_ACTIVE_MS) }).active, true);
    assert.equal(read({ exclude: 'coord-1', now: new Date(ago(30 * 1000).getTime() + DSH_CHILD_ACTIVE_MS + 1) }).active, false);
  } finally {
    fs.rmSync(setup.base, { recursive: true, force: true });
  }
});

test('dsh wait: an active subagent session gives wait with no send and no escalation count, on an escalation wake and on a fresh call', () => {
  const setup = dshWaitSetup();
  const root = makeProject({ config: DSH_WRAPPER_CONFIG });
  try {
    gitIn(root, ['switch', '-q', '-c', 'feat/demo']);
    writeRecord(root, 'demo', recordWith({ startedAt: ago(20 * MINUTE).toISOString() }).record);
    dshSession(setup.dshHome, root, 'lead', { opened: ago(19 * MINUTE), wrote: ago(2000) });
    dshSession(setup.dshHome, root, 'child', { opened: ago(18 * MINUTE), wrote: ago(30 * 1000) });
    const fake = fakeRunner({ status: RUNNING, 'worker-show': idleShow(root), send: envelope({ message: { id: 'msg_1' } }) });
    const env = dshEnv(setup);
    for (const flags of [['--wake', 'escalation', '--dispatch', 'disp-1'], ['--wake', 'escalation'], ['--fresh']]) {
      const json = assertAction(orcaStep(root, ['next', '--feature', 'demo', ...flags], { runner: fake.runner, env }).json, 'wait');
      assert.equal(json.say, DSH_WAIT_SAY);
      assert.deepEqual(json.workers, [{ feature: 'demo', stage: 'phase', phase: 1, agent: 'dsh', dispatchId: 'disp-1' }]);
      assert.equal(json.detail.length, 3);
      assert.equal(json.detail[0], 'dsh: 1 subagent session of the tab wrote in the last 10 minutes, the newest 30 s ago.');
      // A temporary folder behind a link adds its real path as a second folder.
      assert.ok(json.detail[1].startsWith(`dsh sessions: ${path.join(setup.dshHome, 'sessions', /** @type {string} */ (dshProjectKey(root)))}`), json.detail[1]);
      assert.equal(json.detail[2], `dsh home: ${setup.dshHome} (wrapper).`);
    }
    assert.equal(fake.orca().filter((args) => args[1] === 'send').length, 0, 'no send');
    const active = readRecord(root, 'demo').record.active;
    assert.deepEqual([active.escalations, active.sendBacks, active.escalationOpen], [0, 0, undefined], 'no escalation count');

    // Past the cap, the tab still waits on its subagent, with no ask.
    writeRecord(root, 'demo', recordWith({ startedAt: ago(20 * MINUTE).toISOString(), escalations: 1 }).record);
    assert.equal(assertAction(orcaStep(root, ['next', '--feature', 'demo', '--wake', 'escalation'], { runner: fake.runner, env }).json, 'wait').say, DSH_WAIT_SAY);
  } finally {
    removeFixture(root);
    fs.rmSync(setup.base, { recursive: true, force: true });
  }
});

test('dsh wait: an escalation whose turn ended on an error gets the resume send, even with an active subagent session', () => {
  const setup = dshWaitSetup();
  const root = makeProject({ config: DSH_WRAPPER_CONFIG });
  try {
    gitIn(root, ['switch', '-q', '-c', 'feat/demo']);
    writeRecord(root, 'demo', recordWith({ startedAt: ago(20 * MINUTE).toISOString() }).record);
    dshSession(setup.dshHome, root, 'lead', { opened: ago(19 * MINUTE), wrote: ago(2000) });
    dshSession(setup.dshHome, root, 'child', { opened: ago(18 * MINUTE), wrote: ago(30 * 1000) });
    const fake = fakeRunner({ status: RUNNING, 'worker-show': idleShow(root), send: envelope({ message: { id: 'msg_1' } }) });
    const env = dshEnv(setup);
    // The subagent result does not restart a turn that failed (a 429, say), and Orca reports no later idle turn.
    const json = assertAction(
      orcaStep(root, ['next', '--feature', 'demo', '--wake', 'escalation', '--dispatch', 'disp-1', '--stop-reason', 'errored'], { runner: fake.runner, env }).json,
      'send'
    );
    assert.notEqual(json.say, DSH_WAIT_SAY);
    // Any other stop reason keeps the dsh wait.
    assert.equal(
      assertAction(orcaStep(root, ['next', '--feature', 'demo', '--wake', 'escalation', '--dispatch', 'disp-1', '--stop-reason', 'finished'], { runner: fake.runner, env }).json, 'wait').say,
      DSH_WAIT_SAY
    );
    // An errored stop reason on a wake for another tab does not count for this tab: no send.
    assertAction(orcaStep(root, ['next', '--feature', 'demo', '--wake', 'escalation', '--dispatch', 'other', '--stop-reason', 'errored'], { runner: fake.runner, env }).json, 'wait');
    assert.equal(fake.orca().filter((args) => args[1] === 'send').length, 0, 'next only names the send; the coordinator runs it');
  } finally {
    removeFixture(root);
    fs.rmSync(setup.base, { recursive: true, force: true });
  }
});

test('dsh wait: with no active subagent session, the dsh tab gets the resume send as before, then the cap ask', () => {
  const setup = dshWaitSetup();
  const root = makeProject({ config: DSH_WRAPPER_CONFIG });
  try {
    gitIn(root, ['switch', '-q', '-c', 'feat/demo']);
    writeRecord(root, 'demo', recordWith({ startedAt: ago(20 * MINUTE).toISOString() }).record);
    const fake = fakeRunner({ status: RUNNING, 'worker-show': idleShow(root), send: envelope({ message: { id: 'msg_1' } }) });
    const env = dshEnv(setup, { DSH_SESSION_ID: 'coord-1' });
    const next = (/** @type {string[]} */ flags) => orcaStep(root, ['next', '--feature', 'demo', ...flags], { runner: fake.runner, env }).json;
    const resume = (/** @type {Record<string, any>} */ json) => {
      assertAction(json, 'send');
      assert.deepEqual([json.reason, json.open], ['escalation', ['**Task 1.1** open', '**Task 1.2** open']]);
    };
    // No sessions folder at all.
    resume(next(['--wake', 'escalation', '--dispatch', 'disp-1']));
    // The tab wrote its own log 2 s ago, an older session and the coordinator write now, and the one subagent ended 11 minutes ago.
    dshSession(setup.dshHome, root, 'lead', { opened: ago(19 * MINUTE), wrote: ago(2000) });
    dshSession(setup.dshHome, root, 'older', { opened: ago(60 * MINUTE), wrote: ago(5000) });
    dshSession(setup.dshHome, root, 'coord-1', { opened: ago(10 * MINUTE), wrote: ago(1000) });
    dshSession(setup.dshHome, root, 'done-child', { opened: ago(18 * MINUTE), wrote: ago(11 * MINUTE) });
    resume(next(['--wake', 'escalation', '--dispatch', 'disp-1']));
    resume(next(['--fresh']));
    // A record with no start time cannot tell a subagent session apart, so it keeps the resume send.
    dshSession(setup.dshHome, root, 'child', { opened: ago(18 * MINUTE), wrote: ago(30 * 1000) });
    writeRecord(root, 'demo', recordWith({ startedAt: null }).record);
    resume(next(['--wake', 'escalation']));

    // The send counts one escalation and records the open items. The next idle wake with no progress asks.
    writeRecord(root, 'demo', recordWith({ startedAt: ago(20 * MINUTE).toISOString(), escalations: 0 }).record);
    fs.rmSync(path.join(setup.dshHome, 'sessions'), { recursive: true });
    const sent = orcaStep(root, ['send', '--feature', 'demo', '--reason', 'escalation'], { runner: fake.runner, env }).json;
    assert.deepEqual([sent.ok, sent.reason], [true, 'escalation']);
    const active = readRecord(root, 'demo').record.active;
    assert.deepEqual([active.escalations, active.escalationOpen], [1, 2]);
    const ask = assertAction(next(['--wake', 'escalation', '--dispatch', 'disp-1']), 'ask');
    assert.equal(ask.reason, 'escalation-cap');
  } finally {
    removeFixture(root);
    fs.rmSync(setup.base, { recursive: true, force: true });
  }
});

test('dsh wait: progress since the last escalation send starts the count again, for every agent', () => {
  const idle = { state: 'idle', detail: [] };
  const wake = { wake: 'escalation' };
  const open1 = { tasks: parseTasks(tasksDoc(phaseText(1, { done: 1, open: 1 }), phaseText(2, { open: 1 }))) };
  for (const agent of ['dsh', 'claude']) {
    // The count of escalationsOf(): 2 open now, 3 at the last send, so the count starts again.
    const progressed = recordWith({ agent, escalations: 1, escalationOpen: 3 });
    const send = assertAction(decideFeature(facts({ flags: wake, record: progressed, worker: idle })), 'send');
    assert.equal(send.reason, 'escalation', agent);
    assert.equal(assertAction(decideFeature(facts({ flags: wake, docs: open1, record: recordWith({ agent, escalations: 1, escalationOpen: 2 }), worker: idle })), 'send').reason, 'escalation');
    // No progress, and a record of an older version with no escalationOpen, ask as before.
    assert.equal(assertAction(decideFeature(facts({ flags: wake, record: recordWith({ agent, escalations: 1, escalationOpen: 2 }), worker: idle })), 'ask').reason, 'escalation-cap');
    assert.equal(assertAction(decideFeature(facts({ flags: wake, record: recordWith({ agent, escalations: 1 }), worker: idle })), 'ask').reason, 'escalation-cap');
    // The done proof holds after progress: the report send, not the cap ask.
    assert.equal(assertAction(decideFeature(facts({ flags: wake, docs: phaseOneComplete(), record: progressed, worker: idle })), 'send').reason, 'report');
  }
  const active = { escalations: 1, escalationOpen: 3, sendBacks: 1 };
  assert.deepEqual([escalationsOf(active, 2), escalationsOf(active, 3), escalationsOf(active, null), escalationsOf({ escalations: 1 }, 0)], [0, 1, 1, 1]);
  assert.deepEqual(sendCounts(active, 'escalation', 2), { escalations: 1, escalationOpen: 2 });
  assert.deepEqual(sendCounts(active, 'report', 0), { escalations: 1, escalationOpen: 0 });
  assert.deepEqual(sendCounts(active, 'escalation', 3), { escalations: 2, escalationOpen: 3 });
  assert.deepEqual(sendCounts(active, 'open-tasks', 2), { sendBacks: 2 });
  assert.deepEqual(sendCounts(active, 'missing-verdict', 1), { sendBacks: 2 });

  // The send step writes the count after progress: 1 open task now, 3 at the last send.
  const root = makeProject({ tasks: tasksDoc(phaseText(1, { done: 2, open: 1 })) });
  try {
    gitIn(root, ['switch', '-q', '-c', 'feat/demo']);
    writeRecord(root, 'demo', recordWith({ agent: 'claude', escalations: 1, escalationOpen: 3 }).record);
    const fake = fakeRunner({ send: envelope({ message: { id: 'msg_1' } }) });
    assert.equal(orcaStep(root, ['send', '--feature', 'demo', '--reason', 'escalation'], { runner: fake.runner }).json.ok, true);
    const after = readRecord(root, 'demo').record.active;
    assert.deepEqual([after.escalations, after.escalationOpen, after.sendBacks], [1, 1, 0]);
  } finally {
    removeFixture(root);
  }
});

test('dsh wait: a claude stage keeps the behavior of A4 byte for byte, and only an idle dsh tab that A4 judges reads the fact', () => {
  const idle = { state: 'idle', detail: ['Orca: worker ready, liveness live, activity idle.'] };
  const child = { active: true, detail: ['dsh: 1 subagent session of the tab wrote in the last 10 minutes, the newest 30 s ago.'] };
  const flagSets = [{ wake: 'escalation' }, { wake: 'escalation', dispatch: 'disp-1' }, { fresh: true }];
  for (const flags of flagSets) {
    for (const patch of [{}, { escalations: 1 }, { escalations: 1, escalationOpen: 2 }]) {
      const record = recordWith({ agent: 'claude', ...patch });
      for (const docs of [undefined, phaseOneComplete()]) {
        const plain = decideFeature(facts({ flags, record, worker: idle, ...(docs ? { docs } : {}) }));
        const withChild = decideFeature(facts({ flags, record, worker: { ...idle, child }, ...(docs ? { docs } : {}) }));
        assert.deepEqual(withChild, plain, JSON.stringify({ flags, patch, docs: Boolean(docs) }));
        assert.notEqual(plain.say, DSH_WAIT_SAY);
      }
    }
  }
  // A dsh tab with the fact: work done gives the report send, no escalation for it waits as before, and no fact sends.
  const dsh = recordWith();
  assert.equal(assertAction(decideFeature(facts({ flags: { wake: 'escalation' }, docs: phaseOneComplete(), record: dsh, worker: { ...idle, child } })), 'send').reason, 'report');
  assert.notEqual(assertAction(decideFeature(facts({ record: dsh, worker: { ...idle, child } })), 'wait').say, DSH_WAIT_SAY);
  assert.equal(assertAction(decideFeature(facts({ flags: { wake: 'escalation' }, record: dsh, worker: { ...idle, child: { active: false, detail: [] } } })), 'send').reason, 'escalation');
  assert.equal(assertAction(decideFeature(facts({ flags: { wake: 'escalation' }, record: dsh, worker: idle })), 'send').reason, 'escalation');

  // The read: only an idle dsh tab, on an escalation wake for it or a fresh call, and never on a stop request.
  const active = dsh.record.active;
  const base = { fresh: false, wake: null, dispatch: null, stop: false };
  assert.equal(wantsDshChild({ ...base, wake: 'escalation' }, active, idle), true);
  assert.equal(wantsDshChild({ ...base, wake: 'escalation', dispatch: 'disp-1' }, active, idle), true);
  assert.equal(wantsDshChild({ ...base, fresh: true }, active, idle), true);
  assert.equal(wantsDshChild({ ...base, wake: 'escalation', dispatch: 'disp-other' }, active, idle), false);
  assert.equal(wantsDshChild({ ...base, wake: 'worker_done' }, active, idle), false);
  assert.equal(wantsDshChild(base, active, idle), false);
  assert.equal(wantsDshChild({ ...base, fresh: true, stop: true }, active, idle), false);
  assert.equal(wantsDshChild({ ...base, fresh: true }, { ...active, agent: 'claude' }, idle), false);
  for (const state of ['busy', 'done', 'unknown', 'gone']) assert.equal(wantsDshChild({ ...base, fresh: true }, active, { state }), false);
  assert.equal(wantsDshChild({ ...base, fresh: true }, null, idle), false);

  // A claude tab of a project with an active dsh session still gets the resume send.
  const setup = dshWaitSetup();
  const root = makeProject({ config: DSH_WRAPPER_CONFIG });
  try {
    gitIn(root, ['switch', '-q', '-c', 'feat/demo']);
    writeRecord(root, 'demo', recordWith({ agent: 'claude', startedAt: ago(20 * MINUTE).toISOString() }).record);
    dshSession(setup.dshHome, root, 'lead', { opened: ago(19 * MINUTE), wrote: ago(2000) });
    dshSession(setup.dshHome, root, 'child', { opened: ago(18 * MINUTE), wrote: ago(30 * 1000) });
    const fake = fakeRunner({ 'worker-show': idleShow(root) });
    const json = orcaStep(root, ['next', '--feature', 'demo', '--wake', 'escalation', '--dispatch', 'disp-1'], { runner: fake.runner, env: dshEnv(setup) }).json;
    assert.equal(assertAction(json, 'send').reason, 'escalation');
    assert.equal(json.detail, undefined);
    // The fact itself reads active for this workspace, so only the agent check keeps the claude tab apart.
    const fact = dshChildFact({
      config: readOrcaConfig(root),
      env: dshEnv(setup),
      platform: 'linux',
      now: NOW,
      active: recordWith({ startedAt: ago(20 * MINUTE).toISOString() }).record.active,
      workspace: root,
    });
    assert.deepEqual([fact.active, fact.source, fact.home], [true, 'wrapper', setup.dshHome]);
  } finally {
    removeFixture(root);
    fs.rmSync(setup.base, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// The static test
// ---------------------------------------------------------------------------

test('static: no file under installer/lib/orca holds a forbidden Orca call, a destructive git verb, or a shell', () => {
  const dir = path.join(PLUGIN_ROOT, 'installer', 'lib', 'orca');
  const files = fs.readdirSync(dir).filter((name) => name.endsWith('.js'));
  for (const name of ['decide.js', 'exec.js', 'read.js', 'spec.js', 'steps.js']) assert.ok(files.includes(name), `${name} is missing`);

  const anywhere = ['orchestration check', 'orchestration reset', '--force', '--no-verify', 'shell: true'];
  const calls = [
    ['orchestration', 'check'],
    ['orchestration', 'reset'],
  ];
  // The worker spec names the git verbs in prose ("No commit, branch,
  // merge, stash, reset, or push."), so a verb fails here as a whole
  // string literal, the form of a git argument, or as "git <verb>".
  const verbs = ['push', 'pull', 'fetch', 'rebase', 'reset', 'stash', 'clean', 'tag'];
  // CR-8: the rest of the guide's never list. A branch deletion, and the
  // Orca `--delete-branch` flag (fact O13: `worktree rm` takes none).
  const deleteFlags = ['-D', '-d', '--delete', '--delete-branch'];
  /** @type {string[]} */
  const importers = [];
  /** @type {string[]} */
  const spawners = [];
  for (const name of files) {
    const body = fs.readFileSync(path.join(dir, name), 'utf8');
    for (const needle of anywhere) assert.ok(!body.includes(needle), `${name} holds "${needle}"`);
    for (const [first, second] of calls) {
      assert.doesNotMatch(body, new RegExp(`['"\`]${first}['"\`]\\s*,\\s*['"\`]${second}['"\`]`), `${name} calls ${first} ${second}`);
    }
    for (const verb of verbs) {
      assert.doesNotMatch(body, new RegExp(`(['"\`])${verb}\\1`), `${name} holds the git argument "${verb}"`);
      assert.doesNotMatch(body, new RegExp(`\\bgit\\s+${verb}\\b`), `${name} holds "git ${verb}"`);
    }
    for (const flag of deleteFlags) {
      assert.doesNotMatch(body, new RegExp(`(['"\`])${flag}\\1`), `${name} holds the argument "${flag}"`);
    }
    assert.doesNotMatch(body, /\bgit\s+branch\s+-[dD]\b/, `${name} holds a git branch deletion`);
    if (/from\s+['"]node:child_process['"]/.test(body)) importers.push(name);
    if (/\bspawnSync\b/.test(body)) spawners.push(name);
  }
  assert.deepEqual(importers, ['exec.js'], 'exec.js is the one child_process importer (D1, Phase 3)');
  assert.deepEqual(spawners, ['exec.js'], 'only exec.js names spawnSync');
});

// Fix 3: `terminal close` is no longer banned. The ban of Decision 13 became a pin: the call exists in the
// `terminalClose` builder only, and only the close and merge paths call the builder.
test('static: terminal close appears only in the terminalClose builder, and only the close and merge paths call it', () => {
  const dir = path.join(PLUGIN_ROOT, 'installer', 'lib', 'orca');
  for (const name of fs.readdirSync(dir).filter((file) => file.endsWith('.js'))) {
    const body = fs.readFileSync(path.join(dir, name), 'utf8');
    const spelled = (body.match(/['"`]terminal['"`]\s*,\s*['"`]close['"`]/g) ?? []).length;
    assert.equal(spelled, name === 'exec.js' ? 1 : 0, `${name} holds ${spelled} terminal close calls`);
    assert.ok(!body.includes('terminal close'), `${name} spells "terminal close" in text`);
    if (name === 'exec.js') {
      assert.match(body, /terminalClose: \(terminal\) => orcaChange\(\['terminal', 'close', '--terminal', terminal, '--json'\]\)/);
    } else {
      assert.doesNotMatch(body, /(?<!orcaCalls\.)\bterminalClose\b/, `${name} names the builder outside a call`);
    }
  }
  const steps = fs.readFileSync(path.join(dir, 'steps.js'), 'utf8');
  const enclosing = (needle) =>
    [...steps.matchAll(needle)].map((match) => {
      const before = steps.slice(0, match.index);
      return [...before.matchAll(/^function (\w+)\(/gm)].pop()[1];
    });
  // The builder: the helper of the close steps, and the lane end of the merge.
  assert.deepEqual(enclosing(/orcaCalls\.terminalClose\(/g), ['closeOwnTerminal', 'removeLaneWorktree']);
  // The helper: the feature close and the epic close, never a start, a retry, or a commit.
  assert.deepEqual(enclosing(/(?<!function )\bcloseOwnTerminal\(run/g), ['stepClose', 'stepCloseEpic']);
});

// Fix 6: `terminal rename` exists in the `terminalRename` builder only, and only the start paths call the builder.
test('static: terminal rename appears only in the terminalRename builder, and only renameTab calls it', () => {
  const dir = path.join(PLUGIN_ROOT, 'installer', 'lib', 'orca');
  for (const name of fs.readdirSync(dir).filter((file) => file.endsWith('.js'))) {
    const body = fs.readFileSync(path.join(dir, name), 'utf8');
    const spelled = (body.match(/['"`]terminal['"`]\s*,\s*['"`]rename['"`]/g) ?? []).length;
    assert.equal(spelled, name === 'exec.js' ? 1 : 0, `${name} holds ${spelled} terminal rename calls`);
    if (name === 'exec.js') {
      assert.match(body, /terminalRename: \(\{ terminal, title \}\) => orcaChange\(\['terminal', 'rename', '--terminal', terminal, '--title', title, '--json'\]\)/);
    } else {
      assert.doesNotMatch(body, /(?<!orcaCalls\.)\bterminalRename\b/, `${name} names the builder outside a call`);
    }
  }
  const steps = fs.readFileSync(path.join(dir, 'steps.js'), 'utf8');
  const enclosing = (needle) =>
    [...steps.matchAll(needle)].map((match) => {
      const before = steps.slice(0, match.index);
      return [...before.matchAll(/^function (\w+)\(/gm)].pop()[1];
    });
  assert.deepEqual(enclosing(/orcaCalls\.terminalRename\(/g), ['renameTab']);
  assert.deepEqual(
    enclosing(/(?<!function )\brenameTab\(run/g),
    ['startStage', 'startNewLaneByCommand', 'startNewLane', 'stepStartEpic']
  );
});

test('static: read.js holds the one temporary-file writer, and steps.js writes a spec only through writeSpec (CR-10)', () => {
  const dir = path.join(PLUGIN_ROOT, 'installer', 'lib', 'orca');
  for (const name of fs.readdirSync(dir).filter((file) => file.endsWith('.js'))) {
    const body = fs.readFileSync(path.join(dir, name), 'utf8');
    const writers = (body.match(/flag:\s*'wx'/g) ?? []).length;
    const names = (body.match(/crypto\.randomBytes/g) ?? []).length;
    assert.equal(writers, name === 'read.js' ? 1 : 0, `${name} holds ${writers} exclusive writes`);
    assert.equal(names, name === 'read.js' ? 1 : 0, `${name} holds ${names} temporary file names`);
  }
  const steps = fs.readFileSync(path.join(dir, 'steps.js'), 'utf8');
  assert.equal((steps.match(/\bfs\.writeFileSync\(/g) ?? []).length, 1, 'steps.js has one plain write, the one inside writeSpec');
});

test('writeFileAtomic: writes the text, replaces a file, and leaves no temporary file (CR-10)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bm-atomic-'));
  try {
    const file = path.join(dir, 'a.json');
    writeFileAtomic(file, 'one\n');
    writeFileAtomic(file, 'two\n');
    assert.equal(fs.readFileSync(file, 'utf8'), 'two\n');
    assert.deepEqual(fs.readdirSync(dir), ['a.json']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('writeFileAtomic: a failed write throws, keeps the old file, and leaves no temporary file (CR-10)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bm-atomic-'));
  try {
    const file = path.join(dir, 'a.json');
    fs.writeFileSync(file, 'old\n');
    // A folder at the target makes the rename fail after the temporary file exists.
    const blocked = path.join(dir, 'blocked');
    fs.mkdirSync(path.join(blocked, 'inside'), { recursive: true });
    assert.throws(() => writeFileAtomic(blocked, 'new\n'));
    assert.equal(fs.readFileSync(file, 'utf8'), 'old\n');
    assert.deepEqual(fs.readdirSync(dir).sort(), ['a.json', 'blocked']);
    assert.throws(() => writeFileAtomic(path.join(dir, 'missing', 'b.json'), 'x'), /ENOENT/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Phase 9: the verify tab, the fix tab, and the phase verdict
// ---------------------------------------------------------------------------

const SPLIT_VERIFY = parseOrcaConfig('{"version":1,"orchestration":{"stages":{"implement":"dsh","verify":"claude","review":false}}}');
const SPLIT_VERIFY_JSON = { version: 1, orchestration: { stages: { implement: 'dsh', verify: 'claude', review: false } } };
const SAME_VERIFY_JSON = { version: 1, orchestration: { stages: { implement: 'dsh', review: false } } };
const PASS_FACT = { verdict: 'PASS', evidence: '', demo: 'PASS' };

/** @param {string} root @returns {string} The briefs folder of the feature "demo". */
function briefsOf(root) {
  return path.join(root, '.beast-mode', 'briefs', 'demo');
}

/**
 * A one-phase project: the phase is open, and its demo line reads "a.txt holds one line".
 *
 * @param {Record<string, any>} config
 * @param {{ done?: boolean }} [opts]
 * @returns {string}
 */
function verifyProject(config, { done = false } = {}) {
  const root = makeProject({
    tasks: tasksDoc(phaseText(1, done ? { done: 2, demo: 'a.txt holds one line' } : { open: 2, demo: 'a.txt holds one line' })),
    config,
  });
  gitIn(root, ['switch', '-q', '-c', 'feat/demo']);
  return root;
}

/**
 * The work of each tab of a one-phase walk. The phase tab ticks the tasks, a verify tab (or a fix tab that
 * verifies) writes the next verdict of `verdicts`, and a fix tab changes a file.
 *
 * @param {string} root
 * @param {string[]} verdicts The verdict texts, in the order that the verifiers write them.
 * @param {{ phaseWritesVerdict?: boolean }} [opts]
 * @returns {(stage: string, phase: number | null) => void}
 */
function verifyWork(root, verdicts, { phaseWritesVerdict = false } = {}) {
  const queue = [...verdicts];
  const verdictFile = path.join(briefsOf(root), 'orca-phase-1.verdict.md');
  const docs = path.join(root, 'docs', 'features', 'demo');
  const writeVerdict = () => {
    const text = queue.shift();
    if (text !== undefined) fs.writeFileSync(verdictFile, text);
  };
  return (stage) => {
    if (stage === 'plan') return;
    if (stage === 'phase') {
      fs.writeFileSync(path.join(docs, 'tasks.md'), tasksDoc(phaseText(1, { done: 2, demo: 'a.txt holds one line' })));
      fs.writeFileSync(path.join(root, 'phase-1.txt'), 'phase 1\n');
      if (phaseWritesVerdict) writeVerdict();
    } else if (stage === 'verify') {
      writeVerdict();
    } else if (stage === 'fix') {
      fs.appendFileSync(path.join(root, 'phase-1.txt'), 'fixed\n');
      if (!phaseWritesVerdict) return;
      writeVerdict();
    } else if (stage === 'docs') {
      fs.appendFileSync(path.join(docs, 'context.md'), '\n## Session Notes\n\n- done.\n');
    }
  };
}

/** The fake runner of the verify walks: the app runs, and every release answers. */
function verifyFake() {
  return fakeRunner({ status: RUNNING, 'worker-release': envelope({ state: 'already_released' }) });
}

test('verify: a PASS closes the verify tab, shows the slice block with the Verifier line, and only then commits', () => {
  const root = verifyProject(SPLIT_VERIFY_JSON);
  try {
    const fake = verifyFake();
    const { trail, actions } = walk(root, fake, verifyWork(root, ['PASS\nthe gate is green\nDemo: PASS']));
    assert.deepEqual(trail, [
      'start phase 1',
      'close phase',
      'start verify 1',
      'close verify',
      'commit phase 1',
      'start docs',
      'close docs',
    ]);
    assert.deepEqual(startAgents(fake), ['dsh', 'claude', 'dsh'], 'the verify tab runs on the verify agent');
    const closePhase = actions.find((action) => action.action === 'close' && action.stage === 'phase');
    assert.equal(closePhase?.show, null, 'a split verify shows no slice block at the phase tab');
    const closeVerify = actions.find((action) => action.action === 'close' && action.stage === 'verify');
    assert.deepEqual([closeVerify?.phase, closeVerify?.verdict], [1, 'PASS']);
    assert.equal(
      closeVerify?.show,
      ['Slice ready: Phase 1 - Slice 1', 'Demo: a.txt holds one line', 'Verifier: Demo PASS', 'The run goes on. Try the demo when you can.'].join('\n')
    );
    const verifyStart = actions.find((action) => action.action === 'start' && action.stage === 'verify');
    assert.deepEqual([verifyStart?.agent, verifyStart?.verdictFile], ['claude', 'orca-phase-1.verdict.md']);
    assert.equal(verifyStart?.run, lineOf(root, ['start', '--feature', 'demo', '--stage', 'verify', '--phase', '1']));
    assert.match(gitIn(root, ['log', '--format=%s']), /feat: demo phase 1/);
    // The phase tab wrote the verification brief by its spec, and the verify tab reads it.
    const phaseSpecText = fs.readFileSync(path.join(briefsOf(root), 'orca-phase-1.md'), 'utf8');
    assert.match(phaseSpecText, /verification brief of section 9 at `\.beast-mode\/briefs\/demo\/phase-1-verify\.md`/);
    const verifySpecText = fs.readFileSync(path.join(briefsOf(root), 'orca-verify-1.md'), 'utf8');
    assert.match(verifySpecText, /Read the verification brief `\.beast-mode\/briefs\/demo\/phase-1-verify\.md`/);
    assert.match(verifySpecText, /Write the verdict file `\.beast-mode\/briefs\/demo\/orca-phase-1\.verdict\.md`/);
  } finally {
    removeFixture(root);
  }
});

test('verify: a FAIL starts a fix tab with the evidence, then a verify tab again, and the phase commits after the PASS', () => {
  const root = verifyProject(SPLIT_VERIFY_JSON);
  try {
    const fake = verifyFake();
    const { trail, actions } = walk(
      root,
      fake,
      verifyWork(root, ['FAIL\n- a.txt holds no second line\nDemo: FAIL', 'PASS\nDemo: PASS'])
    );
    assert.deepEqual(trail, [
      'start phase 1',
      'close phase',
      'start verify 1',
      'close verify',
      'start fix 1',
      'close fix',
      'start verify 1',
      'close verify',
      'commit phase 1',
      'start docs',
      'close docs',
    ]);
    assert.deepEqual(startAgents(fake), ['dsh', 'claude', 'dsh', 'claude', 'dsh'], 'the fix tab runs on the implement agent');
    const fixStart = actions.find((action) => action.action === 'start' && action.stage === 'fix');
    assert.deepEqual([fixStart?.round, fixStart?.agent], [1, 'dsh']);
    const failClose = actions.find((action) => action.action === 'close' && action.stage === 'verify');
    assert.deepEqual([failClose?.verdict, failClose?.show], ['FAIL', null], 'a FAIL shows no slice block');
    const fixSpecText = fs.readFileSync(path.join(briefsOf(root), 'orca-fix-1-r1.md'), 'utf8');
    assert.match(fixSpecText, /> - a\.txt holds no second line/);
    assert.match(fixSpecText, /Run no verifier\. A verify tab of another agent checks the fix/);
    // The old verdict stays as evidence of its round, and the run record keeps the round.
    assert.match(fs.readFileSync(path.join(briefsOf(root), 'orca-phase-1-r1.verdict.md'), 'utf8'), /^FAIL/);
    assert.deepEqual(readRecord(root, 'demo').record?.verify, { 1: { round: 1 } });
    const commits = gitIn(root, ['log', '--format=%s']);
    assert.match(commits, /feat: demo phase 1/);
    // The phase commit follows the second verify close, never the first.
    assert.ok(trail.indexOf('commit phase 1') > trail.lastIndexOf('close verify'));
  } finally {
    removeFixture(root);
  }
});

test('verify: three FAIL rounds ask, and the phase stays uncommitted', () => {
  const root = verifyProject(SPLIT_VERIFY_JSON);
  try {
    const fake = verifyFake();
    const fail = (n) => `FAIL\n- fault ${n}\nDemo: FAIL`;
    const { trail, done: ask, actions } = walk(root, fake, verifyWork(root, [fail(1), fail(2), fail(3), fail(4)]), ['ask']);
    assert.deepEqual(trail, [
      'start phase 1',
      'close phase',
      'start verify 1',
      'close verify',
      'start fix 1',
      'close fix',
      'start verify 1',
      'close verify',
      'start fix 1',
      'close fix',
      'start verify 1',
      'close verify',
      'start fix 1',
      'close fix',
      'start verify 1',
      'close verify',
    ]);
    assert.deepEqual(actions.filter((action) => action.stage === 'fix' && action.action === 'start').map((action) => action.round), [1, 2, 3]);
    assertAction(ask, 'ask');
    assert.equal(ask.reason, 'verify-fail-cap');
    assert.deepEqual(ask.options.map((option) => option.key), ['stop', 'fix']);
    assert.equal(ask.recommended, 'stop');
    assert.equal(ask.options[0].run, null);
    const fourth = ['start', '--feature', 'demo', '--stage', 'fix', '--phase', '1', '--round', '4'];
    assert.equal(ask.options[1].run, lineOf(root, fourth));
    assert.deepEqual(ask.detail, ['- fault 4', 'Demo: FAIL']);
    assert.doesNotMatch(gitIn(root, ['log', '--format=%s']), /phase 1/, 'a phase never commits after a FAIL with no PASS');
    // The fix option starts a fourth round, and the record counts it.
    const start = orcaStep(root, fourth, { runner: fake.runner }).json;
    assert.equal(start.ok, true, JSON.stringify(start));
    assert.deepEqual(readRecord(root, 'demo').record?.verify, { 1: { round: 4 } });
  } finally {
    removeFixture(root);
  }
});

test('verify: a BLOCKED verdict asks with the reason, and the retry drops the tab so a new verify tab starts', () => {
  const root = verifyProject(SPLIT_VERIFY_JSON);
  try {
    const fake = verifyFake();
    const { trail, done: ask } = walk(root, fake, verifyWork(root, ['BLOCKED\nthe dev server does not start']), ['ask']);
    assert.deepEqual(trail, ['start phase 1', 'close phase', 'start verify 1']);
    assertAction(ask, 'ask');
    assert.equal(ask.reason, 'verify-blocked');
    assert.equal(ask.verdict, 'BLOCKED');
    assert.deepEqual(ask.detail, ['the dev server does not start']);
    assert.deepEqual(ask.options.map((option) => option.key), ['stop', 'retry']);
    assert.equal(ask.options[0].run, null);
    const discard = ['close', '--feature', 'demo', '--discard'];
    assert.equal(ask.options[1].run, lineOf(root, discard));
    assert.equal(ask.recommended, 'stop');
    assert.doesNotMatch(gitIn(root, ['log', '--format=%s']), /phase 1/);

    const drop = orcaStep(root, discard, { runner: fake.runner }).json;
    assert.equal(drop.ok, true, JSON.stringify(drop));
    assert.ok(!fs.existsSync(path.join(briefsOf(root), 'orca-phase-1.verdict.md')), 'a dropped verify tab leaves no verdict');
    const next = orcaStep(root, ['next', '--feature', 'demo'], { runner: fake.runner }).json;
    assert.deepEqual([next.action, next.stage, next.phase], ['start', 'verify', 1]);
  } finally {
    removeFixture(root);
  }
});

test('verify: a BLOCKED verdict with no tab asks too, and the retry starts the verify tab', () => {
  const split = decideFeature(
    facts({ config: SPLIT_VERIFY, harnesses: ['claude', 'dsh'], docs: { ...phaseOneComplete(), phaseVerdicts: { 1: { verdict: 'BLOCKED', evidence: 'no browser', demo: null } } } })
  );
  assert.equal(assertAction(split, 'ask').reason, 'verify-blocked');
  assert.equal(split.options[1].run.join(' '), 'start --feature demo --stage verify --phase 1');
  assert.deepEqual(split.detail, ['no browser']);
});

test('verify: a missing verdict sends the verdict note one time, then asks', () => {
  const active = { stage: 'verify', phase: 1, agent: 'claude', verdictFile: '.beast-mode/briefs/demo/orca-phase-1.verdict.md' };
  const withFacts = (sendBacks) =>
    facts({ config: SPLIT_VERIFY, docs: phaseOneComplete(), record: recordWith({ ...active, sendBacks }), worker: DONE });
  const send = assertAction(decideFeature(withFacts(0)), 'send');
  assert.deepEqual([send.reason, send.run], ['missing-verdict', ['send', '--feature', 'demo', '--reason', 'missing-verdict']]);
  assert.deepEqual(send.open, ['.beast-mode/briefs/demo/orca-phase-1.verdict.md does not exist, or its line 1 is not PASS, FAIL, or BLOCKED.']);
  const ask = assertAction(decideFeature(withFacts(1)), 'ask');
  assert.equal(ask.reason, 'verify-missing');
  assert.deepEqual(ask.options.map((option) => option.key), ['stop', 'retry']);
  assert.equal(ask.options[1].run.join(' '), 'close --feature demo --discard');
  // A verdict file whose line 1 names no verdict reads as missing.
  const odd = facts({
    config: SPLIT_VERIFY,
    docs: { ...phaseOneComplete(), phaseVerdicts: { 1: { verdict: null, evidence: '', demo: null } } },
    record: recordWith(active),
    worker: DONE,
  });
  assert.equal(assertAction(decideFeature(odd), 'send').reason, 'missing-verdict');
});

test('verify: the decision table of rule F16 for a split verify', () => {
  const done = phaseOneComplete();
  const decide = (patch = {}) => decideFeature(facts({ config: SPLIT_VERIFY, harnesses: ['claude', 'dsh'], ...patch }));
  // No verdict: the verify tab.
  const verify = assertAction(decide({ docs: done }), 'start');
  assert.deepEqual([verify.stage, verify.phase, verify.agent, verify.verdictFile], ['verify', 1, 'claude', 'orca-phase-1.verdict.md']);
  assert.equal(verify.run.join(' '), 'start --feature demo --stage verify --phase 1');
  // A PASS goes on: no later phase holds a done task, so the commit follows (a dirty tree), else the next phase.
  const dirty = { git: { dirty: ['a.txt'] } };
  const commit = assertAction(decide({ docs: { ...done, phaseVerdicts: { 1: PASS_FACT } }, ...dirty }), 'commit');
  assert.deepEqual([commit.point, commit.phase], ['phase', 1]);
  assert.equal(assertAction(decide({ docs: { ...done, phaseVerdicts: { 1: PASS_FACT } } }), 'start').stage, 'phase');
  // A FAIL: the fix tab of the first round, on the implement agent. The dirty tree never commits.
  const failFact = { verdict: 'FAIL', evidence: '- a fault', demo: 'FAIL' };
  const fix = assertAction(decide({ docs: { ...done, phaseVerdicts: { 1: failFact } }, ...dirty }), 'start');
  assert.deepEqual([fix.stage, fix.round, fix.agent], ['fix', 1, 'dsh']);
  assert.equal(fix.run.join(' '), 'start --feature demo --stage fix --phase 1 --round 1');
  // The fix rounds count in the record.
  const second = assertAction(
    decide({ docs: { ...done, phaseVerdicts: { 1: failFact } }, record: { record: { ...newRecord('demo'), verify: { 1: { round: 2 } } }, note: null } }),
    'start'
  );
  assert.deepEqual([second.stage, second.round], ['fix', 3]);
  const capped = assertAction(
    decide({ docs: { ...done, phaseVerdicts: { 1: failFact } }, record: { record: { ...newRecord('demo'), verify: { 1: { round: 3 } } }, note: null } }),
    'ask'
  );
  assert.equal(capped.reason, 'verify-fail-cap');
  // A fix that closed leaves no verdict (the fix start moved it), so the verify tab runs again.
  const again = assertAction(
    decide({ docs: done, record: { record: { ...newRecord('demo'), verify: { 1: { round: 1 } } }, note: null } }),
    'start'
  );
  assert.deepEqual([again.stage, again.phase], ['verify', 1]);
  // A phase that a commit already holds, or that a later phase passed, runs no verify tab (an old project).
  assert.equal(assertAction(decide({ docs: done, git: { subjects: ['feat: demo phase 1'] } }), 'start').stage, 'phase');
  // The verify steps of the phase wait for the PASS: a phase step starts after it, not before.
  const steps = parseOrcaConfig(
    '{"version":1,"orchestration":{"stages":{"implement":"dsh","verify":"claude","review":false},"steps":[{"after":"phase","command":"/check {phase}","agent":"dsh"}]}}'
  );
  assert.equal(assertAction(decideFeature(facts({ config: steps, harnesses: ['claude', 'dsh'], docs: done })), 'start').stage, 'verify');
  assert.equal(
    assertAction(decideFeature(facts({ config: steps, harnesses: ['claude', 'dsh'], docs: { ...done, phaseVerdicts: { 1: PASS_FACT } } })), 'start').stage,
    'step'
  );
});

test('verify: with verify equal to implement, no verify tab opens and the phase tab writes the verdict', () => {
  const root = verifyProject(SAME_VERIFY_JSON);
  try {
    const fake = verifyFake();
    const { trail, actions } = walk(root, fake, verifyWork(root, ['PASS\nthe gate is green\nDemo: PASS'], { phaseWritesVerdict: true }));
    assert.deepEqual(trail, ['start phase 1', 'close phase', 'commit phase 1', 'start docs', 'close docs']);
    assert.ok(!trail.some((entry) => /verify|fix/.test(entry)), 'no verify tab and no fix tab');
    assert.deepEqual(startAgents(fake), ['dsh', 'dsh']);
    const spec = fs.readFileSync(path.join(briefsOf(root), 'orca-phase-1.md'), 'utf8');
    assert.match(spec, /Write the verdict file `\.beast-mode\/briefs\/demo\/orca-phase-1\.verdict\.md`/);
    assert.match(spec, /Part 1 verifies, with up to three fix rounds/);
    assert.ok(!spec.includes('phase-1-verify.md'), 'the same-agent spec writes no brief for another tab');
    const close = actions.find((action) => action.action === 'close' && action.stage === 'phase');
    assert.equal(close?.show, ['Slice ready: Phase 1 - Slice 1', 'Demo: a.txt holds one line', 'Verifier: Demo PASS', 'The run goes on. Try the demo when you can.'].join('\n'));
  } finally {
    removeFixture(root);
  }
});

test('verify: with verify equal to implement, a FAIL or a BLOCKED verdict holds the commit back, and an older tab with no verdict still commits', () => {
  const same = { config: OFF, harnesses: ['claude', 'dsh'], git: { dirty: ['a.txt'] } };
  const done = phaseOneComplete().tasks;
  const base = { docs: { tasks: done } };
  // No verdict (an older tab): the phase commits as before.
  assert.equal(assertAction(decideFeature(facts({ ...same, ...base })), 'commit').phase, 1);
  const failFact = { verdict: 'FAIL', evidence: '- a fault', demo: 'FAIL' };
  const fail = assertAction(decideFeature(facts({ ...same, docs: { tasks: done, phaseVerdicts: { 1: failFact } } })), 'start');
  assert.deepEqual([fail.stage, fail.round, fail.agent], ['fix', 1, 'dsh']);
  const blocked = assertAction(
    decideFeature(facts({ ...same, docs: { tasks: done, phaseVerdicts: { 1: { verdict: 'BLOCKED', evidence: 'no browser', demo: null } } } })),
    'ask'
  );
  assert.equal(blocked.reason, 'verify-blocked');
  assert.equal(blocked.options[1].run.join(' '), 'start --feature demo --stage fix --phase 1 --round 1', 'the fix tab verifies again');
  // The fix tab of a phase that its own tab verifies writes the verdict: no verdict then asks for a fix, not a commit.
  const record = { record: { ...newRecord('demo'), verify: { 1: { round: 1 } } }, note: null };
  const after = assertAction(decideFeature(facts({ ...same, ...base, record })), 'start');
  assert.deepEqual([after.stage, after.round], ['fix', 2]);
  assert.equal(assertAction(decideFeature(facts({ ...same, docs: { tasks: done, phaseVerdicts: { 1: PASS_FACT } }, record })), 'commit').phase, 1);
});

test('verify: the slice block names the Verifier line from the verdict in both placements', () => {
  const block = (verifier) =>
    ['Slice ready: Phase 1 - Slice 1', 'Demo: the page shows one row', ...(verifier ? [`Verifier: Demo ${verifier}`] : []), 'The run goes on. Try the demo when you can.'].join('\n');
  const tab = (stage, patch = {}, config = TAB) =>
    decideFeature(facts({ config, harnesses: ['claude', 'dsh'], docs: phaseOneComplete(), record: recordWith({ stage, phase: 1, agent: 'dsh', ...patch }), worker: DONE }));
  const withVerdict = (verdict, demo, text = '') => ({ phaseVerdicts: { 1: { verdict, evidence: text, demo } } });
  const phaseTab = (docsPatch, config) =>
    decideFeature(
      facts({ config, harnesses: ['claude', 'dsh'], docs: { ...phaseOneComplete(), ...docsPatch }, record: recordWith({ stage: 'phase', phase: 1 }), worker: DONE })
    );

  // Placement 1: the verify agent equals the implement agent, and the phase tab wrote the verdict.
  assert.equal(assertAction(phaseTab(withVerdict('PASS', 'PASS'), TAB), 'close').show, block('PASS'));
  assert.equal(assertAction(phaseTab(withVerdict('PASS', 'MANUAL'), TAB), 'close').show, block('MANUAL'));
  assert.equal(assertAction(phaseTab(withVerdict('PASS', null), TAB), 'close').show, block(null), 'no demo result, no Verifier line');
  assert.equal(assertAction(phaseTab({}, TAB), 'close').show, block(null), 'an older tab with no verdict file');
  assert.equal(assertAction(phaseTab(withVerdict('FAIL', 'FAIL'), TAB), 'close').show, null, 'a FAIL holds the block back');
  assert.equal(assertAction(phaseTab(withVerdict('BLOCKED', null), TAB), 'close').show, null);

  // Placement 2: a split verify. The phase tab shows no block. The verify tab shows it after a PASS.
  assert.equal(assertAction(phaseTab(withVerdict('PASS', 'PASS'), SPLIT_VERIFY), 'close').show, null);
  const verifyTab = (verdict, demo) => tab('verify', { agent: 'claude' }, SPLIT_VERIFY) && decideFeature(
    facts({ config: SPLIT_VERIFY, harnesses: ['claude', 'dsh'], docs: { ...phaseOneComplete(), ...withVerdict(verdict, demo) }, record: recordWith({ stage: 'verify', phase: 1, agent: 'claude' }), worker: DONE })
  );
  assert.equal(assertAction(verifyTab('PASS', 'PASS'), 'close').show, block('PASS'));
  assert.equal(assertAction(verifyTab('PASS', 'MANUAL'), 'close').show, block('MANUAL'));
  const failClose = assertAction(verifyTab('FAIL', 'FAIL'), 'close');
  assert.deepEqual([failClose.show, failClose.verdict, failClose.stage, failClose.phase], [null, 'FAIL', 'verify', 1]);
  // A fix tab of a split verify needs no verdict. A fix tab that verifies itself does.
  const fixTab = (config, patch, docsPatch = {}) =>
    decideFeature(
      facts({ config, harnesses: ['claude', 'dsh'], docs: { ...phaseOneComplete(), ...docsPatch }, record: recordWith({ stage: 'fix', phase: 1, ...patch }), worker: DONE })
    );
  const splitFix = assertAction(fixTab(SPLIT_VERIFY, { verifies: false }), 'close');
  assert.deepEqual([splitFix.stage, splitFix.phase, splitFix.show], ['fix', 1, null]);
  assert.equal(assertAction(fixTab(TAB, { verifies: true, verdictFile: 'v.md' }), 'send').reason, 'missing-verdict');
  assert.equal(assertAction(fixTab(TAB, { verifies: true }, withVerdict('PASS', 'PASS')), 'close').show, block('PASS'));
});

test('verify: the demo result reads the last line of the verdict file', () => {
  const root = verifyProject(SPLIT_VERIFY_JSON, { done: true });
  try {
    const write = (text) => {
      fs.mkdirSync(briefsOf(root), { recursive: true });
      fs.writeFileSync(path.join(briefsOf(root), 'orca-phase-1.verdict.md'), text);
      return readFeatureDocs(root, checkFeaturePath('demo')).phaseVerdicts;
    };
    assert.deepEqual(write('PASS\n- the gate is green\nDemo: MANUAL needs a phone\n'), {
      1: { verdict: 'PASS', evidence: '- the gate is green\nDemo: MANUAL needs a phone', demo: 'MANUAL' },
    });
    assert.equal(write('PASS\nDemo: none\n')[1].demo, 'none');
    assert.equal(write('FAIL\n- a fault\n')[1].demo, null, 'no demo line, no demo result');
    assert.equal(write('PASS\nDemo: PASS\n- more evidence\n')[1].demo, null, 'only the last line counts');
    assert.deepEqual(write('maybe\nDemo: PASS\n')[1], { verdict: null, evidence: '', demo: null });
    // A kept verdict of a fix round, and a step verdict, never read as the phase verdict.
    fs.writeFileSync(path.join(briefsOf(root), 'orca-phase-1-r1.verdict.md'), 'FAIL\n');
    fs.writeFileSync(path.join(briefsOf(root), 'orca-step-phase-1-0.verdict.md'), 'FAIL\n');
    assert.deepEqual(Object.keys(readFeatureDocs(root, checkFeaturePath('demo')).phaseVerdicts), ['1']);
  } finally {
    removeFixture(root);
  }
});

test('verify: no split verify stays inside the phase tab, and the same-agent spec writes the verdict', () => {
  const verdict = '.beast-mode/briefs/demo/orca-phase-1.verdict.md';
  const brief = '.beast-mode/briefs/demo/phase-1-verify.md';
  const phase = { number: 1, name: 'Slice 1' };
  for (const review of [false, true]) {
    const split = phaseSpec({ feature: 'demo', epic: null, phase, review, briefFile: brief });
    assert.ok(split.includes(`\`${brief}\``), 'the split spec writes the verification brief');
    assert.match(split, /run no verifier and no fix round/);
    assert.match(split, /A verify tab of another agent runs it/);
    assert.doesNotMatch(split, /Part 1 verifies/);
    assert.doesNotMatch(split, /fix rounds/);
    assert.doesNotMatch(split, /Run one verifier/);
    assert.doesNotMatch(split, /verdict file/);
    assert.doesNotMatch(split, /subagent/i);
    for (const part of sharedParts('demo', 'demo phase 1')) assert.ok(split.includes(part), `the split spec keeps: ${part}`);
    const same = phaseSpec({ feature: 'demo', epic: null, phase, review, verdictFile: verdict });
    assert.match(same, /Part 1 verifies, with up to three fix rounds/);
    assert.ok(same.includes(`Write the verdict file \`${verdict}\`.`));
    assert.match(same, /Line 1 is `PASS`/);
    assert.match(same, /The last line is the demo result of section 9/);
    assert.ok(!same.includes(brief));
  }
  assert.match(phaseSpec({ feature: 'demo', epic: null, phase, review: true, verdictFile: verdict }), /4\. Write the verdict file/);
  assert.match(phaseSpec({ feature: 'demo', epic: null, phase, verdictFile: verdict }), /3\. Write the verdict file/);

  const verifyText = verifySpec({ feature: 'demo', epic: null, phase, verdictFile: verdict, briefFile: brief });
  assert.match(verifyText, /^# Beast Mode orca worker - demo, Phase 1 verification\n/);
  assert.match(verifyText, /Run no gate command yourself, and read no source/);
  assert.match(verifyText, /Fix nothing\./);
  assert.match(verifyText, /\[demo phase 1 verify\]/);
  assert.doesNotMatch(verifyText, /subagent/i);
  for (const part of sharedParts('demo', 'demo phase 1 verify').slice(0, 5)) assert.ok(verifyText.includes(part), `the verify spec keeps: ${part}`);

  const fixSplit = fixSpec({ feature: 'demo', epic: null, phase, round: 2, evidence: '- one\n- two', verdictFile: verdict, verifies: false });
  assert.match(fixSplit, /^# Beast Mode orca worker - demo, Phase 1 fix, round 2\n/);
  assert.match(fixSplit, /> - one\n {3}> - two/);
  assert.match(fixSplit, /Run no verifier\./);
  assert.doesNotMatch(fixSplit, /verdict file/);
  const fixSame = fixSpec({ feature: 'demo', epic: null, phase, round: 1, evidence: '', verdictFile: verdict, verifies: true });
  assert.match(fixSame, /The earlier verdict holds no evidence/);
  assert.ok(fixSame.includes(`write the verdict file\n   \`${verdict}\``));
  assert.doesNotMatch(fixSame, /subagent/i);
});

test('verify: the steps refuse a verify or a fix start with no ground, and a verify start removes the old verdict', () => {
  const splitRoot = verifyProject(SPLIT_VERIFY_JSON, { done: true });
  const sameRoot = verifyProject(SAME_VERIFY_JSON, { done: true });
  const openRoot = verifyProject(SPLIT_VERIFY_JSON);
  try {
    const fake = fakeRunner({ 'worker-start': envelope({ runId: 'run-1', taskId: 'task-1', dispatchId: 'disp-1', state: 'ready' }) });
    const start = (root, stage, extra = []) =>
      orcaStep(root, ['start', '--feature', 'demo', '--stage', stage, '--phase', '1', ...extra], { runner: fake.runner }).json;
    assert.equal(start(sameRoot, 'verify').code, 'verify-same-agent');
    assert.equal(start(openRoot, 'verify').code, 'phase-incomplete');
    assert.equal(start(openRoot, 'fix', ['--round', '1']).code, 'phase-incomplete');
    assert.equal(orcaStep(splitRoot, ['start', '--feature', 'demo', '--stage', 'verify', '--phase', '9'], { runner: fake.runner }).json.code, 'phase-missing');
    assert.equal(start(splitRoot, 'fix', ['--round', '1']).code, 'verdict-missing');
    assert.equal(start(sameRoot, 'fix', ['--round', '1']).code, 'verdict-missing');
    fs.mkdirSync(briefsOf(splitRoot), { recursive: true });
    const file = path.join(briefsOf(splitRoot), 'orca-phase-1.verdict.md');
    fs.writeFileSync(file, 'PASS\nDemo: PASS\n');
    assert.equal(start(splitRoot, 'fix', ['--round', '1']).code, 'verify-passed');
    assert.deepEqual(fake.orca(), [], 'no refusal reaches Orca');

    // A verify start removes the old verdict, and a new tab never reads the verdict of an earlier tab.
    const started = start(splitRoot, 'verify');
    assert.equal(started.ok, true, JSON.stringify(started));
    assert.ok(!fs.existsSync(file));
    assert.equal(readRecord(splitRoot, 'demo').record?.active?.verdictFile, '.beast-mode/briefs/demo/orca-phase-1.verdict.md');
    assert.equal(startAgents(fake)[0], 'claude');
    assert.throws(() => start(splitRoot, 'verify', ['--round', '0']), /names no fix round/);
  } finally {
    for (const root of [splitRoot, sameRoot, openRoot]) removeFixture(root);
  }
});

test('verify: a phase start removes the old verdict and clears the rounds of the phase', () => {
  const root = verifyProject(SPLIT_VERIFY_JSON);
  try {
    fs.mkdirSync(briefsOf(root), { recursive: true });
    const file = path.join(briefsOf(root), 'orca-phase-1.verdict.md');
    fs.writeFileSync(file, 'PASS\nDemo: PASS\n');
    writeRecord(root, 'demo', { ...newRecord('demo'), verify: { 1: { round: 2 }, 2: { round: 1 } } });
    const fake = fakeRunner({
      'worker-start': envelope({ runId: 'run-1', taskId: 'task-1', dispatchId: 'disp-1', state: 'ready' }),
      'worker-show': turnStarted('disp-1'),
    });
    const started = orcaStep(root, ['start', '--feature', 'demo', '--stage', 'phase', '--phase', '1'], { runner: fake.runner }).json;
    assert.equal(started.ok, true, JSON.stringify(started));
    assert.ok(!fs.existsSync(file), 'a stale PASS never lets the new work commit');
    assert.deepEqual(readRecord(root, 'demo').record?.verify, { 2: { round: 1 } });
  } finally {
    removeFixture(root);
  }
});

test('verify: commit refuses a phase with no PASS in a split verify, and a FAIL in either placement', () => {
  const splitRoot = verifyProject(SPLIT_VERIFY_JSON, { done: true });
  const sameRoot = verifyProject(SAME_VERIFY_JSON, { done: true });
  try {
    const fake = fakeRunner({});
    const commit = (root) => orcaStep(root, ['commit', '--feature', 'demo', '--point', 'phase', '--phase', '1'], { runner: fake.runner }).json;
    const write = (root, text) => {
      fs.mkdirSync(briefsOf(root), { recursive: true });
      fs.writeFileSync(path.join(briefsOf(root), 'orca-phase-1.verdict.md'), text);
      fs.writeFileSync(path.join(root, 'a.txt'), 'a\n');
    };
    write(splitRoot, 'FAIL\n- a fault\nDemo: FAIL\n');
    const refused = commit(splitRoot);
    assert.equal(refused.code, 'verify-open');
    assert.deepEqual(refused.detail, ['The verdict of Phase 1 reads FAIL.']);
    fs.rmSync(path.join(briefsOf(splitRoot), 'orca-phase-1.verdict.md'));
    assert.equal(commit(splitRoot).code, 'verify-open', 'a split verify commits only after a PASS');
    write(sameRoot, 'FAIL\n');
    assert.equal(commit(sameRoot).code, 'verify-open');
    fs.rmSync(path.join(briefsOf(sameRoot), 'orca-phase-1.verdict.md'));
    assert.equal(commit(sameRoot).ok, true, 'an older tab with no verdict still commits');
    write(splitRoot, 'PASS\nDemo: PASS\n');
    assert.equal(commit(splitRoot).ok, true);
  } finally {
    for (const root of [splitRoot, sameRoot]) removeFixture(root);
  }
});

test('verify: a failed fix start keeps its round for the retry', () => {
  const root = verifyProject(SPLIT_VERIFY_JSON, { done: true });
  try {
    fs.mkdirSync(briefsOf(root), { recursive: true });
    fs.writeFileSync(path.join(briefsOf(root), 'orca-phase-1.verdict.md'), 'FAIL\n- a fault\nDemo: FAIL\n');
    const fake = fakeRunner({ 'worker-start': failedStartAnswer('disp-1') });
    const failed = orcaStep(root, ['start', '--feature', 'demo', '--stage', 'fix', '--phase', '1', '--round', '1'], { runner: fake.runner }).json;
    assert.equal(failed.code, 'start-failed', JSON.stringify(failed));
    const record = readRecord(root, 'demo').record;
    assert.deepEqual([record?.failedStart?.stage, record?.failedStart?.phase, record?.failedStart?.round], ['fix', 1, 1]);
    const ask = assertAction(
      decideFeature(facts({ config: SPLIT_VERIFY, harnesses: ['claude', 'dsh'], docs: phaseOneComplete(), record: { record, note: null } })),
      'ask'
    );
    assert.equal(ask.reason, 'start-failed');
    assert.equal(ask.options[0].run.join(' '), 'start --feature demo --stage fix --phase 1 --round 1 --retry');
  } finally {
    removeFixture(root);
  }
});

// ---------------------------------------------------------------------------
// Fix 4: a plan that starts at Phase 0. A `## Phase 0` heading gives a real
// phase, so every step takes `--phase 0`, and no check reads 0 as no phase.
// ---------------------------------------------------------------------------

const PHASE_STEP_LINE = { after: 'phase', command: '/check-phase {feature} {phase}', agent: 'claude' };

/**
 * A tasks.md text whose first phase is Phase 0: a base phase with no demo
 * line, then Phase 1 with a demo line.
 *
 * @param {number} [done] The phases whose tasks read [x]: 0 for none, 1 for Phase 0, 2 for both.
 * @returns {string}
 */
function phaseZeroTasks(done = 0) {
  return tasksDoc(
    phaseText(0, { name: 'Shared base (Base)', ...(done >= 1 ? { done: 2 } : { open: 2 }) }),
    phaseText(1, { demo: 'b.txt holds one line', ...(done >= 2 ? { done: 1 } : { open: 1 }) })
  );
}

test('phase 0: parseTasks reads a ## Phase 0 heading as the phase number 0', () => {
  const { phases } = parseTasks(phaseZeroTasks(1));
  assert.deepEqual(
    phases.map((phase) => [phase.number, phase.name, phase.done, phase.total, phase.demo]),
    [
      [0, 'Shared base (Base)', 2, 2, null],
      [1, 'Slice 1', 0, 1, 'b.txt holds one line'],
    ]
  );
  assert.equal(isPhaseComplete(phases[0]), true);
  assert.equal(isPhaseNumber(0), true);
  assert.equal(isPhaseNumber(7), true);
  for (const bad of [-1, 1.5, null, undefined, '0', Number.NaN]) assert.equal(isPhaseNumber(bad), false, String(bad));
});

test('phase 0: the --phase flag takes 0 in every step that reads it, and still refuses -1, 1.5, and text', () => {
  const root = makeProject({ config: { version: 1, orchestration: { stages: { implement: 'dsh', review: false }, steps: [PHASE_STEP_LINE] } } });
  try {
    const fake = fakeRunner({ status: RUNNING });
    // The task list holds Phase 1 only, so each step that took "--phase 0" reaches its guard, which names Phase 0.
    for (const args of [
      ['start', '--feature', 'demo', '--phase', '0'],
      ['start', '--feature', 'demo', '--stage', 'phase', '--phase', '0'],
      ['start', '--feature', 'demo', '--stage', 'verify', '--phase', '0'],
      ['start', '--feature', 'demo', '--stage', 'fix', '--phase', '0', '--round', '1'],
      ['start', '--feature', 'demo', '--stage', 'step', '--step', '0', '--phase', '0'],
      ['commit', '--feature', 'demo', '--phase', '0'],
      ['commit', '--feature', 'demo', '--point', 'phase', '--phase', '0'],
    ]) {
      const { code, json } = orcaStep(root, args, { runner: fake.runner });
      assert.deepEqual([code, json.ok, json.code], [0, false, 'phase-missing'], `${args.join(' ')}: ${JSON.stringify(json)}`);
      assert.match(json.say, /holds no Phase 0\.$/, args.join(' '));
    }
    // The epic forms share the parser: "--phase 0" gives a refusal object, never a usage error.
    for (const args of [
      ['start', '--epic', 'editor', '--feature', 'editor/base', '--phase', '0'],
      ['commit', '--epic', 'editor', '--feature', 'editor/base', '--point', 'phase', '--phase', '0'],
    ]) {
      const { code, json } = orcaStep(root, args, { runner: fake.runner });
      assert.deepEqual([code, json.ok], [0, false], `${args.join(' ')}: ${JSON.stringify(json)}`);
    }
    // Six digits still pass, so the upper bound stays.
    assert.equal(orcaStep(root, ['start', '--feature', 'demo', '--phase', '999999'], { runner: fake.runner }).json.code, 'phase-missing');

    for (const bad of ['-1', '1.5', 'x', '', '00', '01', '1000000']) {
      assert.throws(
        () => orcaStep(root, ['start', '--feature', 'demo', `--phase=${bad}`], { runner: fake.runner }),
        (err) =>
          err instanceof UsageError &&
          err.message === `"--phase ${bad}" names no phase.` &&
          err.causeText === 'The "--phase" flag takes a whole number from 0 up.',
        `--phase=${bad}`
      );
    }
    assert.throws(() => orcaStep(root, ['commit', '--feature', 'demo', '--phase', '-1'], { runner: fake.runner }), UsageError);
    assert.deepEqual(fake.orca(), [], 'no refusal and no usage error reaches Orca');
  } finally {
    removeFixture(root);
  }
});

test('phase 0: a plan that starts at Phase 0 walks start, close, and commit for Phase 0 with --phase 0, then moves to Phase 1', () => {
  const root = makeProject({ tasks: phaseZeroTasks(), config: SAME_VERIFY_JSON });
  try {
    const fake = verifyFake();
    const docs = path.join(root, 'docs', 'features', 'demo');
    /** @type {unknown[]} */
    const activePhases = [];
    const work = (stage, phase) => {
      if (stage === 'phase') {
        // The record keeps the phase of the running tab, and Phase 0 is a phase, not a missing value.
        activePhases.push(readRecord(root, 'demo').record?.active?.phase);
        fs.writeFileSync(path.join(docs, 'tasks.md'), phaseZeroTasks(phase + 1));
        fs.writeFileSync(path.join(root, `phase-${phase}.txt`), `phase ${phase}\n`);
        // Verify equal to implement: the phase tab writes the verdict.
        fs.writeFileSync(path.join(briefsOf(root), `orca-phase-${phase}.verdict.md`), `PASS\nthe gate is green\nDemo: ${phase === 0 ? 'none' : 'PASS'}\n`);
      } else if (stage === 'docs') {
        fs.appendFileSync(path.join(docs, 'context.md'), '\n## Session Notes\n\n- done.\n');
      }
    };
    const { trail, actions, done } = walk(root, fake, work);
    assert.deepEqual(trail, [
      'branch',
      'start phase 0',
      'close phase',
      'commit phase 0',
      'start phase 1',
      'close phase',
      'commit phase 1',
      'start docs',
      'close docs',
    ]);
    assert.deepEqual(activePhases, [0, 1]);

    const start = actions.find((action) => action.action === 'start' && action.stage === 'phase' && action.phase === 0);
    assert.equal(start?.run, lineOf(root, ['start', '--feature', 'demo', '--stage', 'phase', '--phase', '0']));
    assert.equal(start?.say, 'Start the Phase 0 tab of demo on dsh.');
    assert.ok(
      fs.readFileSync(path.join(briefsOf(root), 'orca-phase-0.md'), 'utf8').startsWith('# Beast Mode orca worker - demo, Phase 0: Shared base (Base)\n')
    );
    const closes = actions.filter((action) => action.action === 'close' && action.stage === 'phase');
    assert.deepEqual(
      closes.map((action) => [action.phase, action.say]),
      [
        [0, 'Phase 0 of demo is done. Close its tab.'],
        [1, 'Phase 1 of demo is done. Close its tab.'],
      ]
    );
    assert.equal(closes[0].show, null, 'a base phase with no demo line shows no slice block');
    assert.match(closes[1].show, /^Slice ready: Phase 1 - Slice 1\nDemo: b\.txt holds one line\nVerifier: Demo PASS\n/);

    const commit = actions.find((action) => action.action === 'commit' && action.phase === 0);
    assert.deepEqual([commit?.subject, commit?.say], ['feat: demo phase 0', 'Commit Phase 0 of demo.']);
    assert.equal(commit?.run, lineOf(root, ['commit', '--feature', 'demo', '--point', 'phase', '--phase', '0']));
    assert.deepEqual(gitIn(root, ['log', '--format=%s']).trim().split('\n'), ['feat: demo phase 1', 'feat: demo phase 0', 'init']);
    assert.deepEqual(gitIn(root, ['show', '--name-only', '--format=', 'HEAD~1']).split('\n').filter(Boolean).sort(), [
      'docs/features/demo/tasks.md',
      'phase-0.txt',
    ]);

    assertAction(done, 'done');
    assert.match(done.show, /^- Phase 0 - Shared base \(Base\): committed as "feat: demo phase 0", verified PASS$/m);
    assert.match(done.show, /^- Phase 1 - Slice 1: committed as "feat: demo phase 1", verified PASS$/m);
  } finally {
    removeFixture(root);
  }
});

test('phase 0: a split verify, a fix round, and a phase step run for Phase 0 under verify["0"] and the mark phase-0:0', () => {
  const root = makeProject({
    tasks: phaseZeroTasks(),
    config: { version: 1, orchestration: { stages: { implement: 'dsh', verify: 'claude', review: false }, steps: [PHASE_STEP_LINE] } },
  });
  try {
    const fake = verifyFake();
    const docs = path.join(root, 'docs', 'features', 'demo');
    /** @type {Record<number, string[]>} */
    const verdicts = { 0: ['FAIL\n- base.txt holds no second line\nDemo: none', 'PASS\nthe gate is green\nDemo: none'], 1: ['PASS\nDemo: PASS'] };
    const work = (stage, phase) => {
      if (stage === 'phase') {
        fs.writeFileSync(path.join(docs, 'tasks.md'), phaseZeroTasks(phase + 1));
        fs.writeFileSync(path.join(root, `phase-${phase}.txt`), `phase ${phase}\n`);
      } else if (stage === 'verify') {
        fs.writeFileSync(path.join(briefsOf(root), `orca-phase-${phase}.verdict.md`), String(verdicts[phase].shift()));
      } else if (stage === 'fix') {
        fs.appendFileSync(path.join(root, `phase-${phase}.txt`), 'fixed\n');
      } else if (stage === 'step') {
        fs.writeFileSync(path.join(briefsOf(root), `orca-step-phase-${phase}-0.verdict.md`), 'PASS\nthe check is green\n');
      } else if (stage === 'docs') {
        fs.appendFileSync(path.join(docs, 'context.md'), '\n## Session Notes\n\n- done.\n');
      }
    };
    const { trail, actions, done } = walk(root, fake, work);
    assert.deepEqual(trail, [
      'branch',
      'start phase 0',
      'close phase',
      'start verify 0',
      'close verify',
      'start fix 0',
      'close fix',
      'start verify 0',
      'close verify',
      'start step 0',
      'close step',
      'commit phase 0',
      'start phase 1',
      'close phase',
      'start verify 1',
      'close verify',
      'start step 1',
      'close step',
      'commit phase 1',
      'start docs',
      'close docs',
    ]);

    const fix = actions.find((action) => action.action === 'start' && action.stage === 'fix');
    assert.deepEqual([fix?.phase, fix?.round, fix?.verdictFile], [0, 1, 'orca-phase-0.verdict.md']);
    assert.equal(fix?.run, lineOf(root, ['start', '--feature', 'demo', '--stage', 'fix', '--phase', '0', '--round', '1']));
    assert.match(fs.readFileSync(path.join(briefsOf(root), 'orca-fix-0-r1.md'), 'utf8'), /> - base\.txt holds no second line/);
    assert.match(fs.readFileSync(path.join(briefsOf(root), 'orca-phase-0-r1.verdict.md'), 'utf8'), /^FAIL/);
    assert.ok(fs.existsSync(path.join(briefsOf(root), 'orca-verify-0.md')));

    const stepStart = actions.find((action) => action.action === 'start' && action.stage === 'step' && action.phase === 0);
    assert.deepEqual(
      [stepStart?.point, stepStart?.step, stepStart?.stepCommand, stepStart?.verdictFile],
      ['phase-0', 0, '/check-phase demo 0', 'orca-step-phase-0-0.verdict.md']
    );
    assert.equal(stepStart?.say, 'Start the step tab of demo after Phase 0 on claude: /check-phase demo 0.');
    assert.equal(stepStart?.run, lineOf(root, ['start', '--feature', 'demo', '--stage', 'step', '--step', '0', '--phase', '0']));
    assert.ok(fs.existsSync(path.join(briefsOf(root), 'orca-step-phase-0-0.md')));
    // The phase step runs before the phase commit, and the commit follows its mark.
    assert.ok(trail.indexOf('close step') < trail.indexOf('commit phase 0'));

    const record = readRecord(root, 'demo').record;
    assert.deepEqual(record?.verify, { 0: { round: 1 } }, 'the record keeps the fix round of Phase 0');
    assert.deepEqual(record?.done?.steps, { 'phase-0:0': 'PASS', 'phase-1:0': 'PASS' }, 'the mark of Phase 0 stays when Phase 1 starts');

    assertAction(done, 'done');
    assert.match(done.show, /^- Phase 0 - Shared base \(Base\): committed as "feat: demo phase 0", verified PASS after 1 fix round$/m);
    assert.match(done.show, /^- \/check-phase \{feature\} \{phase\} \(Phase 0\): PASS$/m);
    assert.deepEqual(gitIn(root, ['log', '--format=%s']).trim().split('\n'), ['feat: demo phase 1', 'feat: demo phase 0', 'init']);
  } finally {
    removeFixture(root);
  }
});

test('phase 0: the tab names, the retry line, the send text, the spec path, and the close say keep Phase 0', () => {
  // decide: a busy Phase 0 tab waits under its own name.
  const wait = assertAction(decideFeature(facts({ record: recordWith({ phase: 0 }), worker: { state: 'busy', detail: [] } })), 'wait');
  assert.equal(wait.say, 'The Phase 0 tab of demo works on dsh. Orca wakes this tab when it reports.');
  assert.equal(wait.workers[0].phase, 0);
  const verifyWait = assertAction(
    decideFeature(facts({ record: recordWith({ stage: 'verify', phase: 0, agent: 'claude' }), worker: { state: 'busy', detail: [] } })),
    'wait'
  );
  assert.equal(verifyWait.say, 'The verify tab of Phase 0 of demo works on claude. Orca wakes this tab when it reports.');

  // decide: a failed start of Phase 0 retries with "--phase 0", and its question and label name Phase 0.
  const failedOf = (failedStart) =>
    recordWith({}, {
      active: null,
      failedStart: { agent: 'dsh', code: 'start_failed', failedStage: 'terminal', taskId: 'task-9', dispatchId: 'disp-9', count: 1, detail: [], ...failedStart },
    });
  const ask = assertAction(decideFeature(facts({ record: failedOf({ stage: 'phase', phase: 0 }) })), 'ask');
  assert.match(ask.question, /^\[demo phase 0\] The start of the tab failed/);
  assert.deepEqual(ask.options[0].run, ['start', '--feature', 'demo', '--stage', 'phase', '--phase', '0', '--retry']);
  assert.equal(ask.options[0].label, 'Retry the start of Phase 0. Orca reuses the same Task.');
  const fixAsk = assertAction(decideFeature(facts({ record: failedOf({ stage: 'fix', phase: 0, round: 1 }) })), 'ask');
  assert.match(fixAsk.question, /^\[demo phase 0 fix\] /);
  assert.deepEqual(fixAsk.options[0].run, ['start', '--feature', 'demo', '--stage', 'fix', '--phase', '0', '--round', '1', '--retry']);
  assert.equal(fixAsk.options[0].label, 'Retry the start of the fix of Phase 0. Orca reuses the same Task.');

  // steps: the record reader keeps Phase 0, so send, close, and the retry guard name it.
  const root = makeProject({ tasks: phaseZeroTasks() });
  try {
    gitIn(root, ['switch', '-q', '-c', 'feat/demo']);
    writeRecord(root, 'demo', recordWith({ phase: 0 }).record);
    assert.equal(readRecord(root, 'demo').record?.active?.phase, 0);
    const fake = fakeRunner({ send: envelope({ message: { id: 'msg_1', subject: 'x' } }), 'worker-release': envelope({ state: 'already_released' }) });
    const step = (args) => orcaStep(root, args, { runner: fake.runner }).json;
    const sent = () => fake.orca().at(-1);

    let json = step(['send', '--feature', 'demo', '--reason', 'open-tasks']);
    assert.deepEqual([json.ok, json.open], [true, ['**Task 0.1** open', '**Task 0.2** open']]);
    assert.equal(sent()[5], 'Open items: Phase 0 of demo');
    json = step(['send', '--feature', 'demo', '--reason', 'escalation']);
    assert.equal(sent()[5], 'Resume: Phase 0 of demo');
    assert.ok(sent()[7].includes('by your spec, `.beast-mode/briefs/demo/orca-phase-0.md`.'), sent()[7]);
    json = step(['send', '--feature', 'demo', '--reason', 'report']);
    assert.deepEqual([json.code, json.say], ['report-not-ready', 'The done proof of the Phase 0 tab of demo does not hold yet.']);
    json = step(['close', '--feature', 'demo']);
    assert.equal(json.ok, true, JSON.stringify(json));
    assert.match(json.say, /^Closed the Phase 0 tab of demo\./);

    // A failed start of Phase 0 keeps its phase: a retry of Phase 1 is refused, and the refusal names Phase 0.
    writeRecord(root, 'demo', {
      ...newRecord('demo'),
      failedStart: { stage: 'phase', phase: 0, agent: 'dsh', taskId: 'task-9', dispatchId: 'disp-9', count: 1 },
    });
    assert.equal(readRecord(root, 'demo').record?.failedStart?.phase, 0);
    json = step(['start', '--feature', 'demo', '--stage', 'phase', '--phase', '1', '--retry']);
    assert.equal(json.code, 'retry-mismatch', JSON.stringify(json));
    assert.deepEqual(json.detail, ['The run record holds a failed start of Phase 0.']);
  } finally {
    removeFixture(root);
  }
});

// ---------------------------------------------------------------------------
// Fix 5: the tab title. A first start passes `--task-title`, and Orca shows
// the Task title as the tab title. A retry keeps the title of its Task. No
// start pins a custom tab title.
// ---------------------------------------------------------------------------

/** @param {string[]} args @returns {string | undefined} */
function taskTitleArg(args) {
  const at = args.indexOf('--task-title');
  return at === -1 ? undefined : args[at + 1];
}

test('tab title: taskTitleOf leads with the feature leaf and names the work of each stage', () => {
  const title = (facts) => taskTitleOf({ feature: 'nebula-light', ...facts });
  assert.equal(title({ stage: 'phase', phase: 2 }), 'nebula-light: Phase 2 implement');
  assert.equal(title({ stage: 'verify', phase: 2 }), 'nebula-light: Phase 2 verify');
  assert.equal(title({ stage: 'fix', phase: 2, round: 1 }), 'nebula-light: Phase 2 fix 1');
  assert.equal(title({ stage: 'plan' }), 'nebula-light: plan');
  assert.equal(title({ stage: 'review' }), 'nebula-light: review');
  assert.equal(title({ stage: 'review-fix' }), 'nebula-light: review fixes');
  assert.equal(title({ stage: 'docs' }), 'nebula-light: docs');
  assert.equal(title({ stage: 'inbox' }), 'nebula-light: inbox');
  assert.equal(title({ stage: 'step', command: '/update-astrophysics' }), 'nebula-light: step /update-astrophysics');
  assert.equal(title({ stage: 'phase', phase: 0 }), 'nebula-light: Phase 0 implement', 'Phase 0 is a real phase');
  assert.equal(taskTitleOf({ feature: 'map-view', stage: 'epic-docs' }), 'map-view: epic docs');
  assert.equal(taskTitleOf({ feature: 'editor/base', stage: 'docs' }), 'base: docs', 'a lane feature gives its leaf');
});

test('tab title: a long step command ends in an ellipsis and the title stays within 60 characters', () => {
  const command = `/run-the-whole-check ${'very-long-argument '.repeat(10)}`;
  const long = taskTitleOf({ feature: 'nebula-light', stage: 'step', command });
  assert.ok(long.length <= 60, `${long.length}: ${long}`);
  assert.ok(long.startsWith('nebula-light: step /run-the-whole-check'));
  assert.ok(long.endsWith('…'));
  const short = taskTitleOf({ feature: 'nebula-light', stage: 'step', command: '/ok' });
  assert.equal(short, 'nebula-light: step /ok');
  assert.ok(taskTitleOf({ feature: 'f'.repeat(100), stage: 'phase', phase: 3 }).length <= 60, 'a long feature name stays within the cap');
});

test('tab title: the agent-path start passes --task-title, a Phase 0 start too, and a retry passes none', () => {
  const root = makeProject({ tasks: phaseZeroTasks(), config: SAME_VERIFY_JSON });
  try {
    assert.equal(orcaStep(root, ['branch', '--feature', 'demo'], { runner: fakeRunner({}).runner }).json.ok, true);
    const fake = fakeRunner({
      'worker-start': envelope({ runId: 'run-1', taskId: 'task-1', dispatchId: 'disp-1', state: 'ready' }),
      'worker-show': turnStarted('disp-1'),
    });
    const starts = () => fake.orca().filter((args) => args[1] === 'worker-start');
    const first = orcaStep(root, ['start', '--feature', 'demo', '--stage', 'phase', '--phase', '0'], { runner: fake.runner }).json;
    assert.equal(first.ok, true, JSON.stringify(first));
    assert.equal(taskTitleArg(starts()[0]), 'demo: Phase 0 implement');
    for (const args of fake.orca()) assert.ok(!args.includes('--title'), `no pinned tab title: ${args.join(' ')}`);
  } finally {
    removeFixture(root);
  }

  const retryRoot = makeProject();
  try {
    gitIn(retryRoot, ['switch', '-q', '-c', 'feat/demo']);
    const fake = fakeRunner({ 'worker-start': failedStartAnswer('disp-9'), 'worker-release': envelope({ state: 'released' }) });
    const step = (args) => orcaStep(retryRoot, args, { runner: fake.runner }).json;
    step(['start', '--feature', 'demo', '--stage', 'phase', '--phase', '1']);
    step(['start', '--feature', 'demo', '--stage', 'phase', '--phase', '1', '--retry']);
    const starts = fake.orca().filter((args) => args[1] === 'worker-start');
    assert.equal(starts.length, 2);
    assert.equal(taskTitleArg(starts[0]), 'demo: Phase 1 implement');
    assert.equal(taskTitleArg(starts[1]), undefined, 'the retry keeps the title of its Task');
  } finally {
    removeFixture(retryRoot);
  }
});

test('tab title: the command-path start passes --task-title on worker-start, and its retry passes none', () => {
  const root = commandProject();
  try {
    const fake = commandFake({ 'terminal create': TERMINAL_7, 'terminal wait': IDLE_7, 'worker-start': failedStartAnswer('disp-9') });
    orcaStep(root, PHASE_1_START, { runner: fake.runner });
    fake.answers['terminal create'] = envelope({ terminal: { handle: 'term-8', worktreeId: 'repo-1::/tmp/demo', title: null } });
    fake.answers['worker-start'] = envelope({ runId: 'run-9', taskId: 'task-9', dispatchId: 'disp-10', state: 'ready' });
    orcaStep(root, [...PHASE_1_START, '--retry'], { runner: fake.runner });
    const starts = fake.orca().filter((args) => args[1] === 'worker-start');
    assert.equal(starts.length, 2);
    assert.equal(taskTitleArg(starts[0]), 'demo: Phase 1 implement');
    assert.equal(taskTitleArg(starts[1]), undefined, 'the retry keeps the title of its Task');
    assert.ok(fake.orca().every((args) => !args.includes('--title')), 'no pinned tab title');
  } finally {
    removeFixture(root);
  }
});

test('tab title: a step tab carries the step command, trimmed inside the cap', () => {
  const longCommand = '/check-phase {feature} {phase} --with-a-very-long-list-of-flags --and-more-flags --and-even-more-flags';
  const root = makeProject({
    tasks: phaseZeroTasks(1),
    config: { version: 1, orchestration: { stages: { implement: 'dsh', review: false }, steps: [{ after: 'phase', command: longCommand, agent: 'claude' }] } },
  });
  try {
    assert.equal(orcaStep(root, ['branch', '--feature', 'demo'], { runner: fakeRunner({}).runner }).json.ok, true);
    const fake = fakeRunner({ 'worker-start': envelope({ runId: 'run-1', taskId: 'task-1', dispatchId: 'disp-1', state: 'ready' }), 'worker-show': turnStarted('disp-1') });
    const { json } = orcaStep(root, ['start', '--feature', 'demo', '--stage', 'step', '--phase', '0', '--step', '0'], { runner: fake.runner });
    assert.equal(json.ok, true, JSON.stringify(json));
    const title = taskTitleArg(fake.orca().find((args) => args[1] === 'worker-start') ?? []);
    assert.ok(title && title.length <= 60 && title.startsWith('demo: step /check-phase demo 0'), String(title));
    assert.ok(title.endsWith('…'), title);
  } finally {
    removeFixture(root);
  }
});

// ---------------------------------------------------------------------------
// Fix 7: the undelivered report of a helper that a dsh tab started through
// Orca, and the backstop timer of the coordinator
// ---------------------------------------------------------------------------

/**
 * One row of an `inbox --full` answer.
 *
 * @param {Record<string, any>} patch
 * @returns {Record<string, any>}
 */
function mailRow(patch = {}) {
  return {
    id: 'msg_a',
    to_handle: 'dispatch:disp-1',
    type: 'worker_done',
    subject: 'g1 done',
    read: 1,
    created_at: ago(30 * MINUTE).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    delivered_at: null,
    delivery_contract: 'current_delivery',
    ...patch,
  };
}

/** A worker fact of one undelivered message. */
const STUCK_MAIL = { messages: [{ id: 'msg_a' }], detail: ['Orca: the worker_done message msg_a to dispatch:disp-1 is undelivered, 30 min after it was sent.'] };

test('fix 7: undeliveredMail keeps only old, undelivered mail to the tab, and a fault reads as no mail', () => {
  const ok = (/** @type {Record<string, any>[]} */ messages) => ({ kind: 'ok', result: { messages, count: messages.length } });
  const opts = { dispatchId: 'disp-1', now: NOW, minAgeMs: UNDELIVERED_MAIL_MS };
  assert.equal(UNDELIVERED_MAIL_MS, 10 * MINUTE);
  const mail = undeliveredMail(
    ok([
      mailRow(),
      mailRow({ id: 'msg_delivered', delivered_at: ago(29 * MINUTE).toISOString() }),
      mailRow({ id: 'msg_young', created_at: ago(9 * MINUTE).toISOString() }),
      mailRow({ id: 'msg_other', to_handle: 'dispatch:disp-2' }),
      mailRow({ id: 'msg_named' }),
      mailRow({ id: 'msg_sqlite', created_at: ago(60 * MINUTE).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '') }),
      mailRow({ id: 'msg_bad_time', created_at: 'yesterday' }),
      'not a row',
    ]),
    { ...opts, exclude: ['msg_named'] }
  );
  assert.deepEqual(mail.messages.map((message) => message.id), ['msg_sqlite', 'msg_a'], 'oldest first');
  assert.equal(mail.detail[1], 'Orca: the worker_done message msg_a to dispatch:disp-1 is undelivered, 30 min after it was sent.');
  for (const answer of [{ kind: 'failed', code: 'x', detail: [] }, { kind: 'ok', result: {} }, { kind: 'ok', result: null }, null]) {
    assert.deepEqual(undeliveredMail(/** @type {any} */ (answer), opts), { messages: [], detail: [] });
  }
  // The read marks nothing: `inbox`, never a consuming `check`.
  assert.deepEqual(orcaCalls.inbox('disp-1'), {
    tool: 'orca',
    args: ['orchestration', 'inbox', '--terminal', 'dispatch:disp-1', '--limit', '50', '--full', '--json'],
    timeoutMs: 30000,
    change: false,
  });
});

test('fix 7: an idle or busy dsh tab with undelivered mail gets the resume send with --mail, never a wait or the dsh wait', () => {
  const idle = { state: 'idle', detail: [] };
  const busy = { state: 'busy', detail: ['Orca: worker ready, liveness live, activity working.'] };
  const child = { active: true, detail: ['dsh: 1 subagent session of the tab wrote in the last 10 minutes, the newest 30 s ago.'] };
  const record = recordWith({ agent: 'dsh' });
  // Without the mail fact these wait: a worker_done wake for another tab, no wake, an escalation with an active subagent, a busy tab.
  const cases = [
    { flags: { wake: 'worker_done', dispatch: 'other' }, worker: idle },
    { flags: {}, worker: idle },
    { flags: { wake: 'escalation', dispatch: 'disp-1' }, worker: { ...idle, child } },
    { flags: {}, worker: busy },
    { flags: { wake: 'escalation', dispatch: 'disp-1' }, worker: busy },
  ];
  for (const { flags, worker } of cases) {
    const label = JSON.stringify({ flags, state: worker.state });
    assertAction(decideFeature(facts({ flags, record, worker })), 'wait');
    const send = assertAction(decideFeature(facts({ flags, record, worker: { ...worker, mail: STUCK_MAIL } })), 'send');
    assert.equal(send.reason, 'escalation', label);
    assert.equal(send.mail, 1, label);
    assert.deepEqual(send.run.slice(-3), ['--reason', 'escalation', '--mail'], label);
    assert.match(send.say, /^1 message to the Phase 1 tab of demo is undelivered\./, label);
  }
  // The done proof holds: the report send names the mail.
  const report = assertAction(decideFeature(facts({ docs: phaseOneComplete(), record, worker: { ...idle, mail: STUCK_MAIL } })), 'send');
  assert.deepEqual([report.reason, report.run.at(-1)], ['report', '--mail']);
  // Still bound by the escalation cap.
  const capped = assertAction(decideFeature(facts({ record: recordWith({ agent: 'dsh', escalations: 1 }), worker: { ...idle, mail: STUCK_MAIL } })), 'ask');
  assert.equal(capped.reason, 'escalation-cap');
  // No mail, or an empty fact, decides as before.
  assertAction(decideFeature(facts({ record, worker: { ...idle, mail: { messages: [], detail: [] } } })), 'wait');

  // Only a dsh tab that is idle or busy reads the mail, and never on a stop request.
  const active = record.record.active;
  const base = { fresh: false, wake: null, dispatch: null, stop: false };
  assert.equal(wantsPendingMail(base, active, idle), true);
  assert.equal(wantsPendingMail(base, active, busy), true);
  assert.equal(wantsPendingMail({ ...base, stop: true }, active, idle), false);
  assert.equal(wantsPendingMail(base, active, { state: 'done', detail: [] }), false);
  assert.equal(wantsPendingMail(base, { ...active, agent: 'claude' }, idle), false);
});

test('fix 7: next reads the inbox of an idle dsh tab, send --mail names the mail and records it, and the next call waits again', () => {
  const root = makeProject({ config: { ...DSH_WRAPPER_CONFIG, orchestration: { ...DSH_WRAPPER_CONFIG.orchestration, backstopSeconds: 120 } } });
  try {
    gitIn(root, ['switch', '-q', '-c', 'feat/demo']);
    writeRecord(root, 'demo', recordWith({ startedAt: ago(60 * MINUTE).toISOString() }).record);
    const inbox = envelope({ messages: [mailRow()], count: 1 });
    const fake = fakeRunner({ status: RUNNING, 'worker-show': idleShow(root), inbox, send: envelope({ message: { id: 'msg_1' } }) });
    const next = (/** @type {string[]} */ flags) => orcaStep(root, ['next', '--feature', 'demo', ...flags], { runner: fake.runner }).json;

    // The report of the helper went to the lead, which is idle: no escalation wake comes.
    const json = assertAction(next(['--wake', 'worker_done', '--dispatch', 'helper-1']), 'send');
    assert.equal(json.run, lineOf(root, ['send', '--feature', 'demo', '--reason', 'escalation', '--mail']));
    assert.ok(fake.orca().some((args) => args[1] === 'inbox'));
    assert.ok(!fake.orca().some((args) => args[1] === 'check'), 'the mail stays for the tab');

    const sent = orcaStep(root, ['send', '--feature', 'demo', '--reason', 'escalation', '--mail'], { runner: fake.runner }).json;
    assert.deepEqual([sent.ok, sent.mail], [true, ['msg_a']]);
    const body = fake.orca().at(-1).join('\n');
    assert.match(body, /You have unread orchestration mail: 1 message that Orca has not delivered to you\./);
    assert.match(body, /the `check` command of your worker preamble/);
    assert.match(body, /`dispatch:disp-1`/);
    assert.deepEqual(readRecord(root, 'demo').record.active.mailNamed, ['msg_a']);

    // The named message makes no second send: the idle tab waits for its wake, with the timer of orca.json.
    const waited = assertAction(next(['--wake', 'worker_done', '--dispatch', 'helper-1']), 'wait');
    assert.equal(waited.timer.seconds, 120);
    assert.equal(waited.timer.statusEveryMinutes, 30);
    assert.equal(waited.timer.run, lineOf(root, ['next', '--feature', 'demo', '--wake', 'timer']));
    // A send without --mail names no mail.
    fake.answers.inbox = envelope({ messages: [mailRow({ id: 'msg_b' })], count: 1 });
    writeRecord(root, 'demo', recordWith({ startedAt: ago(60 * MINUTE).toISOString() }).record);
    orcaStep(root, ['send', '--feature', 'demo', '--reason', 'escalation'], { runner: fake.runner });
    assert.doesNotMatch(fake.orca().at(-1).join('\n'), /orchestration mail/);
  } finally {
    removeFixture(root);
  }
});

test('fix 7: every wait names the backstop timer, and --wake timer judges an idle dsh tab as a fresh call does', () => {
  const idle = { state: 'idle', detail: [] };
  const busy = { state: 'busy', detail: [] };
  const dsh = recordWith({ agent: 'dsh' });
  const claude = recordWith({ agent: 'claude' });
  assert.equal(DSH_TIMER_SECONDS, 600);

  const wait = assertAction(decideFeature(facts({ record: dsh, worker: busy })), 'wait');
  assert.deepEqual(wait.timer, { seconds: 600, statusEveryMinutes: 30, run: ['next', '--feature', 'demo', '--wake', 'timer'] });
  // The timer carries the configured seconds and status cadence of orca.json.
  const tuned = parseOrcaConfig(JSON.stringify({ ...DEFAULT_CONFIG, orchestration: { ...DEFAULT_CONFIG.orchestration, backstopSeconds: 900, statusEveryMinutes: 45 } }));
  const tunedWait = assertAction(decideFeature(facts({ config: tuned, record: dsh, worker: busy })), 'wait');
  assert.deepEqual([tunedWait.timer.seconds, tunedWait.timer.statusEveryMinutes], [900, 45]);
  // Every wait names the timer, a claude tab too: Orca can fail to deliver wakes to the coordinator itself,
  // and it sends no wake for a claude turn that ended with no Stop hook (fix 8).
  assert.deepEqual(assertAction(decideFeature(facts({ record: claude, worker: busy })), 'wait').timer, wait.timer, 'a claude tab names the timer');
  const child = { active: true, detail: [] };
  const dshWait = assertAction(decideFeature(facts({ flags: { wake: 'escalation' }, record: dsh, worker: { ...idle, child } })), 'wait');
  assert.equal(dshWait.say, DSH_WAIT_SAY);
  assert.equal(dshWait.timer.seconds, 600);
  assert.match(renderAction(dshWait, { node: '/n', bin: '/b.js', project: '/p' }).timer.run, / orca next --feature demo --wake timer --project /);

  const timer = { wake: 'timer' };
  // An idle dsh tab with no report: the timer wake sends the resume text, as a fresh call does.
  assert.equal(assertAction(decideFeature(facts({ record: dsh, worker: idle })), 'wait').action, 'wait');
  assert.equal(assertAction(decideFeature(facts({ flags: timer, record: dsh, worker: idle })), 'send').reason, 'escalation');
  // It reads the subagent fact, so a dsh tab whose subagent still writes keeps the dsh wait and its timer.
  assert.equal(wantsDshChild({ fresh: false, wake: 'timer', dispatch: null, stop: false }, dsh.record.active, idle), true);
  assert.equal(assertAction(decideFeature(facts({ flags: timer, record: dsh, worker: { ...idle, child } })), 'wait').say, DSH_WAIT_SAY);
  // A busy tab waits again, with no stop, and an idle claude tab is judged by the timer as a fresh call does.
  assertAction(decideFeature(facts({ flags: timer, record: dsh, worker: busy })), 'wait');
  assertAction(decideFeature(facts({ flags: timer, record: claude, worker: busy })), 'wait');
  assert.equal(assertAction(decideFeature(facts({ flags: timer, record: claude, worker: idle })), 'send').reason, 'escalation');
  // With undelivered mail, the timer wake sends with --mail.
  assert.equal(assertAction(decideFeature(facts({ flags: timer, record: dsh, worker: { ...busy, mail: STUCK_MAIL } })), 'send').run.at(-1), '--mail');
  // A stop request holds on the timer call too.
  assert.deepEqual(assertAction(decideFeature(facts({ flags: { stop: true }, record: dsh, worker: busy })), 'wait').timer.run.slice(-3), ['--wake', 'timer', '--stop']);
});

test('fix 7: both coordinator skills follow the timer of a wait quietly, keep it the one background command, and /orca-setup asks for its settings', () => {
  for (const [name, target] of [['orca-feature', '--feature <path>'], ['orca-epic', '--epic <epic>']]) {
    const skill = fs.readFileSync(path.join(PLUGIN_ROOT, 'templates', 'skills', name, 'SKILL.md'), 'utf8');
    assert.ok(skill.includes('### The backstop timer'), name);
    assert.ok(skill.includes('When the action holds a `timer`, start it by The backstop timer.'), name);
    assert.ok(skill.includes(`\`beast-mode orca next ${target} --wake timer\``), name);
    assert.ok(skill.includes('`sleep <seconds>`'), name);
    assert.ok(skill.includes('Start no watch script and no background command, apart from the one timer of The backstop timer.'), name);
    assert.ok(skill.includes('The one exception is the timer of The backstop timer'), name);
    assert.ok(skill.includes('The timer reads no mail and runs no Orca command.'), name);
    assert.ok(skill.includes('`orchestration.backstopSeconds`, default 600, and `orchestration.statusEveryMinutes`, default 30'), name);
    assert.ok(skill.includes('So every `wait` holds a `timer`, for every tab and every agent'), name);
    assert.ok(skill.includes('Orca can fail to deliver wakes to this tab itself'), name);
    assert.ok(!skill.includes('a `wait` on a dsh tab holds a `timer`'), name);
    assert.ok(skill.includes('**A timer wake is a quiet check.** Run the check on every timer, and keep the chat quiet:'), name);
    assert.ok(skill.includes('post no message to the user'), name);
    assert.ok(skill.includes('only when no such line went out in the last `statusEveryMinutes` minutes of the timer'), name);
    assert.ok(skill.includes('Speak only when something goes wrong or a stage finishes.'), name);
  }
  const setup = fs.readFileSync(path.join(PLUGIN_ROOT, 'templates', 'skills', 'orca-setup', 'SKILL.md'), 'utf8');
  for (const part of ['### Call 3: the backstop timer', '"backstopSeconds": 600,', '"statusEveryMinutes": 30,', 'Backstop timer: <n> s    Status line at most every: <n> min']) {
    assert.ok(setup.includes(part), `orca-setup lacks: ${part}`);
  }
});

// ---------------------------------------------------------------------------
// Fix 8: a turn that ended with no Stop hook (an interrupted claude turn)
// ---------------------------------------------------------------------------

/** The default `worker-show --json` view of a live tab whose last status said `working`. */
function workingView(lastActivity, extra = {}) {
  return { dispatchId: 'disp-1', state: 'ready', stage: 'input_accepted', liveness: 'live', activity: 'working', lastActivity, terminal: 'term-7', ...extra };
}

test('fix 8: turnQuietMs reads the quiet time of a working turn from both worker-show views, and nothing else', () => {
  const ok = (/** @type {any} */ result) => ({ kind: 'ok', result, detail: [] });
  assert.equal(turnQuietMs(ok(workingView('45m ago')), NOW), 45 * MINUTE);
  assert.equal(turnQuietMs(ok(workingView('30s ago')), NOW), 30 * 1000);
  assert.equal(turnQuietMs(ok(workingView('2h ago')), NOW), 120 * MINUTE);
  assert.equal(turnQuietMs(ok(workingView('1 min ago')), NOW), MINUTE);
  assert.equal(turnQuietMs(ok(workingView('just now')), NOW), 0);
  // Not a running turn, a person to answer, or no time: null.
  assert.equal(turnQuietMs(ok(workingView('45m ago', { activity: 'idle' })), NOW), null);
  assert.equal(turnQuietMs(ok(workingView('45m ago', { liveness: 'exited' })), NOW), null);
  assert.equal(turnQuietMs(ok(workingView('45m ago', { waitingOnHuman: 'AskUserQuestion' })), NOW), null);
  assert.equal(turnQuietMs(ok(workingView('a while back')), NOW), null);
  assert.equal(turnQuietMs(ok(workingView(undefined)), NOW), null);
  assert.equal(turnQuietMs(/** @type {any} */ ({ kind: 'failed', code: 'x', detail: [] }), NOW), null);
  // The --full view: projection.liveness.observedAt of the agent status.
  const full = (/** @type {string} */ activity, /** @type {string} */ source = 'agent_status') =>
    ok({
      dispatch: { status: 'dispatched' },
      projection: { stage: { activity }, liveness: { verdict: 'live', source, observedAt: ago(45 * MINUTE).getTime() } },
    });
  assert.equal(turnQuietMs(full('working'), NOW), 45 * MINUTE);
  assert.equal(turnQuietMs(full('done'), NOW), null);
  assert.equal(turnQuietMs(full('working', 'terminal'), NOW), null);
});

test('fix 8: a busy tab whose agent sent no status for 15 minutes is idle with no report: one resume send, then the cap asks', () => {
  assert.equal(STALE_TURN_MS, 15 * MINUTE);
  assert.equal(RESUME_QUIET_MS, 2 * MINUTE);
  const record = recordWith({ agent: 'claude' });
  const busy = (/** @type {number | undefined} */ quietMs) => ({ state: 'busy', detail: ['Orca: worker ready, liveness live, activity working.'], ...(quietMs === undefined ? {} : { quietMs }) });

  // The stall of the report: no wake, an escalation wake from Orca, and a timer wake all sent `wait`.
  for (const flags of [{}, { wake: 'escalation', dispatch: 'disp-1' }, { wake: 'timer' }]) {
    const label = JSON.stringify(flags);
    assertAction(decideFeature(facts({ flags, record, worker: busy() })), 'wait');
    assertAction(decideFeature(facts({ flags, record, worker: busy(14 * MINUTE) })), 'wait');
    const send = assertAction(decideFeature(facts({ flags, record, worker: busy(45 * MINUTE) })), 'send');
    assert.equal(send.reason, 'escalation', label);
    assert.deepEqual(send.run, ['send', '--feature', 'demo', '--reason', 'escalation'], label);
    assert.match(send.say, /sent no status for 45 min, so the turn ended with no report\. Send it the resume text\./, label);
    assert.ok(send.detail.some((line) => /no Stop hook on an interrupted turn/.test(line)), label);
  }
  // A fresh call sends too, in place of the tab-still-runs stop.
  assertAction(decideFeature(facts({ flags: { fresh: true }, record, worker: busy(5 * MINUTE) })), 'stop');
  assertAction(decideFeature(facts({ flags: { fresh: true }, record, worker: busy(45 * MINUTE) })), 'send');
  // The user said "resume": an escalation wake that names no dispatch sends after 2 quiet minutes.
  assertAction(decideFeature(facts({ flags: { wake: 'escalation' }, record, worker: busy(MINUTE) })), 'wait');
  assertAction(decideFeature(facts({ flags: { wake: 'escalation' }, record, worker: busy(3 * MINUTE) })), 'send');
  assertAction(decideFeature(facts({ flags: { wake: 'escalation', dispatch: 'disp-1' }, record, worker: busy(3 * MINUTE) })), 'wait');
  // Any agent: a dsh tab too.
  assertAction(decideFeature(facts({ record: recordWith({ agent: 'dsh' }), worker: busy(45 * MINUTE) })), 'send');
  // The done proof holds: the report request.
  const report = assertAction(decideFeature(facts({ docs: phaseOneComplete(), record: recordWith({ agent: 'claude' }), worker: busy(45 * MINUTE) })), 'send');
  assert.equal(report.reason, 'report');
  // After its one send, the cap asks the user.
  const capped = assertAction(decideFeature(facts({ record: recordWith({ agent: 'claude', escalations: ESCALATION_CAP }), worker: busy(45 * MINUTE) })), 'ask');
  assert.equal(capped.reason, 'escalation-cap');
  assert.ok(capped.detail.some((line) => /sent no status for 45 min/.test(line)));
});

test('fix 8: next reads the quiet time of a busy claude tab from worker-show, and sends the resume text', () => {
  const root = makeProject({ config: { version: 1, orchestration: { stages: { implement: 'claude' } } } });
  try {
    gitIn(root, ['switch', '-q', '-c', 'feat/demo']);
    writeRecord(root, 'demo', recordWith({ agent: 'claude', startedAt: ago(60 * MINUTE).toISOString() }).record);
    const fake = fakeRunner({ status: RUNNING, 'worker-show': envelope(workingView('45m ago')) });
    const next = (/** @type {string[]} */ flags) => orcaStep(root, ['next', '--feature', 'demo', ...flags], { runner: fake.runner }).json;
    const json = assertAction(next(['--wake', 'escalation', '--dispatch', 'disp-1']), 'send');
    assert.equal(json.run, lineOf(root, ['send', '--feature', 'demo', '--reason', 'escalation']));
    assert.ok(!fake.orca().some((args) => args[1] === 'inbox' && args[2] === '--terminal'), 'a claude tab reads no mail');
    // A turn that still sends status waits, and its wait names the timer.
    fake.answers['worker-show'] = envelope(workingView('1m ago'));
    const wait = assertAction(next([]), 'wait');
    assert.match(wait.timer.run, / orca next --feature demo --wake timer /);
  } finally {
    removeFixture(root);
  }
});

// ---------------------------------------------------------------------------
// Fix 9: a tab that asked a question waits on the coordinator, not on itself
// ---------------------------------------------------------------------------

/** One row of `inbox --run <id> --full --json`, as Orca names its fields. */
function runMailRow(/** @type {Record<string, any>} */ fields) {
  return {
    id: 'msg_x',
    run_id: 'run-1',
    from_handle: 'term-7',
    to_handle: 'run:run-1',
    subject: 'Question',
    body: '',
    type: 'status',
    thread_id: null,
    payload: null,
    read: 1,
    created_at: ago(12 * MINUTE).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    delivered_at: null,
    ...fields,
  };
}

/** The question of the report: from the dispatch of the tab to the run, with a JSON payload. */
const QUESTION_ROW = runMailRow({
  id: 'msg_q1',
  from_handle: 'dispatch:disp-1',
  type: 'question',
  thread_id: 'msg_q1',
  body: 'The plan stop check waits for the owner. All hold?',
  payload: JSON.stringify({ taskId: 'task-1', dispatchId: 'disp-1', question: 'The plan stop check waits for the owner. All hold?', options: ['All hold', 'Change one'] }),
});

test('fix 9: openQuestions finds the question of a dispatch that no reply answers, and nothing else', () => {
  const ok = (/** @type {any[]} */ messages) => /** @type {any} */ ({ kind: 'ok', result: { messages, count: messages.length }, detail: [] });
  const open = openQuestions(ok([QUESTION_ROW]), { dispatchId: 'disp-1' });
  assert.deepEqual(open.questions, [
    { id: 'msg_q1', question: 'The plan stop check waits for the owner. All hold?', options: ['All hold', 'Change one'], createdAt: ago(12 * MINUTE).toISOString() },
  ]);
  assert.match(open.detail[0], /the question msg_q1 of dispatch:disp-1 has no answer yet/);
  // The answer of `reply`: a message to the tab whose thread_id names the question.
  const answer = runMailRow({ id: 'msg_a1', from_handle: 'run:run-1', to_handle: 'dispatch:disp-1', thread_id: 'msg_q1', subject: 'Re: Question' });
  assert.deepEqual(openQuestions(ok([answer, QUESTION_ROW]), { dispatchId: 'disp-1' }).questions, []);
  // Read and delivered_at do not tell: a question that a coordinator `check` read, with delivered_at null, is open.
  assert.equal(openQuestions(ok([{ ...QUESTION_ROW, read: 1, delivered_at: null }]), { dispatchId: 'disp-1' }).questions.length, 1);
  // A question of another tab, an escalation, and a worker_done are not questions of this tab.
  assert.deepEqual(openQuestions(ok([QUESTION_ROW]), { dispatchId: 'disp-2' }).questions, []);
  const escalation = runMailRow({ id: 'msg_stop_1', type: 'escalation', payload: JSON.stringify({ dispatchId: 'disp-1', stopReason: 'finished' }) });
  assert.deepEqual(openQuestions(ok([escalation]), { dispatchId: 'disp-1' }).questions, []);
  // The payload names the dispatch when the sender is the terminal; the body stands in for a payload with no text; CSV options.
  const byTerminal = runMailRow({ id: 'msg_q2', type: 'question', body: 'Which?', payload: JSON.stringify({ dispatchId: 'disp-1', options: 'a, b' }) });
  assert.deepEqual(openQuestions(ok([byTerminal]), { dispatchId: 'disp-1' }).questions.map((q) => [q.id, q.question, q.options]), [['msg_q2', 'Which?', ['a', 'b']]]);
  // Every fault is no question.
  for (const bad of [null, { kind: 'failed', code: 'x', detail: [] }, { kind: 'ok', result: {}, detail: [] }, ok([{ ...QUESTION_ROW, payload: '{', body: '' }]), ok(['x'])]) {
    assert.deepEqual(openQuestions(/** @type {any} */ (bad), { dispatchId: 'disp-1' }).questions, []);
  }
});

test('fix 9: an idle tab with an open question gets the question action, not the resume send or the escalation cap', () => {
  const record = recordWith({ agent: 'claude' });
  const questions = openQuestions(/** @type {any} */ ({ kind: 'ok', result: { messages: [QUESTION_ROW] }, detail: [] }), { dispatchId: 'disp-1' });
  const idle = { state: 'idle', detail: ['Orca: worker ready, liveness live, activity idle.'], questions };
  // The report: the timer wake after one send, with the escalation cap reached.
  const capped = recordWith({ agent: 'claude', escalations: ESCALATION_CAP });
  for (const [flags, rec] of /** @type {[Record<string, any>, any][]} */ ([[{ wake: 'timer' }, capped], [{ wake: 'timer' }, record], [{ fresh: true }, record], [{}, record], [{ wake: 'escalation', dispatch: 'disp-1' }, capped]])) {
    const label = JSON.stringify(flags);
    const action = assertAction(decideFeature(facts({ flags, record: rec, worker: idle })), 'question');
    assert.deepEqual(action.questions, [{ id: 'msg_q1', question: 'The plan stop check waits for the owner. All hold?', options: ['All hold', 'Change one'] }], label);
    assert.match(action.say, /asked a question, and it waits for the answer/, label);
    assert.equal(action.dispatchId, 'disp-1');
    assert.ok(action.detail.some((line) => /msg_q1/.test(line)), label);
    assert.equal(action.run, undefined, 'the coordinator answers with reply, so the action names no run line');
  }
  // With no open question, the same facts keep the old answers: the cap asks, and a first judge sends.
  const { questions: _drop, ...bare } = idle;
  assert.equal(assertAction(decideFeature(facts({ flags: { wake: 'timer' }, record: capped, worker: bare })), 'ask').reason, 'escalation-cap');
  assertAction(decideFeature(facts({ flags: { wake: 'timer' }, record, worker: bare })), 'send');
  // A busy tab with a stale turn and an open question: the question too (fix 8 would send the resume text).
  const stale = { state: 'busy', detail: [], quietMs: 45 * MINUTE, questions };
  assertAction(decideFeature(facts({ record, worker: stale })), 'question');
  // A dsh tab with undelivered mail and an open question: the question comes first.
  const dsh = { ...idle, mail: { messages: [{ id: 'msg_m' }], detail: [] } };
  assertAction(decideFeature(facts({ record: recordWith({ agent: 'dsh' }), worker: dsh })), 'question');
  // A stop request still stops first.
  assert.notEqual(decideFeature(facts({ flags: { stop: true }, record, worker: idle })).action, 'question');
});

test('fix 9: wantsOpenQuestions reads the run mail only for a tab that rule A4 would judge', () => {
  const active = recordWith({ agent: 'claude' }).record.active;
  assert.equal(wantsOpenQuestions({}, active, { state: 'idle', detail: [] }), true);
  assert.equal(wantsOpenQuestions({}, active, { state: 'busy', detail: [], quietMs: 45 * MINUTE }), true);
  assert.equal(wantsOpenQuestions({}, active, { state: 'busy', detail: [], quietMs: MINUTE }), false);
  assert.equal(wantsOpenQuestions({}, active, { state: 'busy', detail: [] }), false);
  assert.equal(wantsOpenQuestions({}, active, { state: 'done', detail: [] }), false);
  assert.equal(wantsOpenQuestions({ stop: true }, active, { state: 'idle', detail: [] }), false);
  assert.equal(wantsOpenQuestions({}, { ...active, runId: null }, { state: 'idle', detail: [] }), false);
  assert.equal(wantsOpenQuestions({}, null, { state: 'idle', detail: [] }), false);
  // Fix 7 comes first: a lost worker_done of the tab makes it done, so the read is of no use. A lost escalation,
  // or a lost worker_done of another tab, does not stop the read.
  const lost = (/** @type {string} */ kind, dispatch = 'disp-1') => ({ mailWakes: [{ id: 'msg_lost', kind, dispatch, stopReason: null, createdAt: ago(5 * MINUTE).toISOString() }] });
  assert.equal(wantsOpenQuestions(lost('worker_done'), active, { state: 'idle', detail: [] }), false);
  assert.equal(wantsOpenQuestions(lost('worker_done'), active, { state: 'busy', detail: [], quietMs: 45 * MINUTE }), false);
  assert.equal(wantsOpenQuestions(lost('escalation'), active, { state: 'idle', detail: [] }), true);
  assert.equal(wantsOpenQuestions(lost('worker_done', 'disp-2'), active, { state: 'idle', detail: [] }), true);
});

test('fix 7 with fix 9: a lost worker_done comes before an open question, and a lost escalation does not', () => {
  const record = recordWith({ agent: 'claude' });
  const questions = openQuestions(/** @type {any} */ ({ kind: 'ok', result: { messages: [QUESTION_ROW] }, detail: [] }), { dispatchId: 'disp-1' });
  const idle = { state: 'idle', detail: [], questions };
  const lost = (/** @type {string} */ kind) => ({ wake: 'timer', mailWakes: [{ id: 'msg_lost', kind, dispatch: 'disp-1', stopReason: null, createdAt: ago(5 * MINUTE).toISOString() }] });
  // The worker_done reached the Run: the tab reported, so rule A3 judges it, and its done proof closes it.
  const closed = assertAction(decideFeature(facts({ flags: lost('worker_done'), docs: phaseOneComplete(), record, worker: idle })), 'close');
  assert.equal(closed.stage, 'phase');
  // A lost escalation is an escalation wake, and the tab still waits on its question: no resume send.
  assertAction(decideFeature(facts({ flags: lost('escalation'), record, worker: idle })), 'question');
  // A busy tab with a stale turn and an open question: the question too, also with a lost escalation.
  assertAction(decideFeature(facts({ flags: lost('escalation'), record, worker: { state: 'busy', detail: [], quietMs: 45 * MINUTE, questions } })), 'question');
});

test('fix 9: next reads the run mail of an idle tab, and shows its open question in place of the escalation cap', () => {
  const root = makeProject({ config: { version: 1, orchestration: { stages: { implement: 'claude' } } } });
  try {
    gitIn(root, ['switch', '-q', '-c', 'feat/demo']);
    writeRecord(root, 'demo', recordWith({ agent: 'claude', escalations: ESCALATION_CAP }).record);
    const idleView = { dispatchId: 'disp-1', state: 'ready', stage: 'input_accepted', liveness: 'live', activity: 'idle', terminal: 'term-7' };
    const fake = fakeRunner({ status: RUNNING, 'worker-show': envelope(idleView), inbox: envelope({ messages: [QUESTION_ROW], count: 1 }) });
    const next = () => orcaStep(root, ['next', '--feature', 'demo', '--wake', 'timer'], { runner: fake.runner }).json;
    const json = assertAction(next(), 'question');
    assert.equal(json.questions[0].id, 'msg_q1');
    assert.deepEqual(fake.orca().at(-1), ['orchestration', 'inbox', '--run', 'run-1', '--limit', '50', '--full', '--json']);
    // Once the reply is in the run mail, the old answer comes back: the cap asks.
    fake.answers.inbox = envelope({ messages: [runMailRow({ id: 'msg_a1', from_handle: 'run:run-1', to_handle: 'dispatch:disp-1', thread_id: 'msg_q1' }), QUESTION_ROW], count: 2 });
    assert.equal(assertAction(next(), 'ask').reason, 'escalation-cap');
    // A failed read is no question.
    fake.answers.inbox = envelope({}, { ok: false, status: 1, stderr: 'boom' });
    assert.equal(assertAction(next(), 'ask').reason, 'escalation-cap');
  } finally {
    removeFixture(root);
  }
});

test('fix 9: both coordinator skills act on the question action, and answer it with reply', () => {
  for (const name of ['orca-feature', 'orca-epic']) {
    const skill = fs.readFileSync(path.join(PLUGIN_ROOT, 'templates', 'skills', name, 'SKILL.md'), 'utf8');
    assert.ok(skill.includes('| `question` | A tab asked a question that has no answer yet'), name);
    assert.ok(skill.includes('with the `id` of the entry as the message id'), name);
    assert.ok(skill.includes('When the user answers a question wake, or a question of a `question` action:'), name);
    assert.ok(skill.includes('so `next` answers `question` for it'), name);
    // The quiet check of a timer wake (fix 7) still shows a question.
    assert.ok(skill.includes('or it gives `stop`, `ask`, `question`, or a failed command'), name);
  }
});

test('fix 7 (WSL): the host of the Orca CLI decides the spec path form, and a wrong guess adds one say sentence with no retry', () => {
  /** @param {'linux' | 'windows'} host @param {string} stderr */
  const startOn = (host, stderr) => {
    const root = makeProject();
    try {
      gitIn(root, ['switch', '-q', '-c', 'feat/demo']);
      const answer = { status: 1, signal: null, stdout: '', stderr, error: null };
      const fake = fakeRunner({ 'worker-start': answer, 'worker-release': envelope({ state: 'released' }) });
      let out = '';
      const stdout = /** @type {any} */ ({ write: (chunk) => ((out += chunk), true) });
      runOrca(['start', '--feature', 'demo', '--stage', 'phase', '--phase', '1', '--project', root], {
        stdout,
        cwd: root,
        pluginRoot: PLUGIN_ROOT,
        env: testEnv({ WSL_DISTRO_NAME: 'Ubuntu' }),
        runner: fake.runner,
        sleep: () => {},
        platform: 'linux',
        execPath: NODE,
        now: () => NOW,
        orcaHost: host,
      });
      const starts = fake.orca().filter((args) => args[1] === 'worker-start');
      return { starts, json: JSON.parse(out.trim()), root };
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  };
  const specOf = (args) => args[args.indexOf('--spec-file') + 1];

  const linux = startOn('linux', 'error: invalid_argument: Could not read C:\\home\\u\\p\\orca-phase-1.md: ENOENT\n');
  assert.equal(linux.starts.length, 1, 'no automatic retry');
  assert.ok(specOf(linux.starts[0]).startsWith('/'), 'a linux host keeps the Linux spec path');
  assert.match(linux.json.say, /ORCA_CLI_COMMAND/);
  assert.match(linux.json.say, /detected host: linux/);

  const windows = startOn('windows', 'error: start_failed: boom\n');
  assert.equal(windows.starts.length, 1);
  assert.ok(specOf(windows.starts[0]).startsWith('\\\\wsl.localhost\\Ubuntu\\'), 'a windows host converts');
  assert.doesNotMatch(windows.json.say, /ORCA_CLI_COMMAND/, 'another fault adds no host sentence');

  const guess = startOn('windows', 'error: invalid_argument: Could not read /w/\\\\wsl.localhost\\Ubuntu\\x.md: ENOENT\n');
  assert.equal(guess.starts.length, 1);
  assert.match(guess.json.say, /runs on linux/);
  assert.match(guess.json.say, /detected host: windows/);
});
