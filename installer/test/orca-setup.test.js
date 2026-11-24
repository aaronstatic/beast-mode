// installer/test/orca-setup.test.js
//
// The suite of `/orca-setup` (Phase 4, group A): `detect` over temporary
// projects with a fake runner and a fake PATH, the PATH search, the merge
// writer table, and the `detect` and `config` steps. No test starts a real
// Orca CLI: the one Orca call of `detect` (`status --json`) reaches the fake
// runner. No test touches this repo or the PATH of the machine.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { adapters } from '../adapters/index.js';
import { UsageError } from '../lib/errors.js';
import { findPluginRoot } from '../lib/source.js';
import { ORCA_JSON_MAX_BYTES, parseOrcaConfig } from '../lib/orca/read.js';
import { detect, findOnPath, suggestStages, writeOrchestration } from '../lib/orca/setup.js';
import { runOrca } from '../lib/orca/steps.js';
import { createTempProjectRoot, removeFixture, snapshotTree } from './helpers.js';

const PLUGIN_ROOT = findPluginRoot(import.meta.dirname);
const FAKE_ORCA = 'fake-orca';
const ORCHESTRATION = { stages: { plan: 'claude', implement: 'dsh' }, commit: 'phase', concurrent: true };

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

/**
 * @param {unknown} result
 * @returns {import('../lib/orca/exec.js').RunResult}
 */
function envelope(result) {
  return { status: 0, signal: null, stdout: `${JSON.stringify({ ok: true, result })}\n`, stderr: '', error: null };
}

const RUNNING = envelope({ app: { running: true, pid: 1 }, runtime: { state: 'ready', reachable: true }, graph: {} });
const NOT_RUNNING = envelope({ app: { running: false }, runtime: { state: 'stopped', reachable: false }, graph: {} });
const NOT_FOUND = {
  status: null,
  signal: null,
  stdout: '',
  stderr: '',
  error: { code: 'ENOENT', message: 'spawn fake-orca ENOENT' },
};

/**
 * A runner for `detect`: it answers `status --json` and nothing else, and it
 * records every call. Any other call fails the test.
 *
 * @param {import('../lib/orca/exec.js').RunResult} answer
 */
function fakeRunner(answer) {
  /** @type {{ command: string, args: string[] }[]} */
  const calls = [];
  /** @type {import('../lib/orca/exec.js').Runner} */
  const runner = (command, args) => {
    calls.push({ command, args: [...args] });
    assert.equal(command, FAKE_ORCA, `the runner got the unexpected command ${command}`);
    assert.deepEqual(args, ['status', '--json'], 'detect makes one Orca call: status --json');
    return answer;
  };
  return { runner, calls };
}

/**
 * A project with the given harnesses installed (a manifest file marks each
 * one) and an optional `.beast-mode/orca.json`.
 *
 * @param {{ harnesses?: string[], config?: unknown }} [opts] A string `config` is written as it is.
 * @returns {string}
 */
function makeProject({ harnesses = [], config = null } = {}) {
  const root = createTempProjectRoot();
  for (const id of harnesses) {
    const dir = path.join(root, ...adapters[id].harnessRoot.split('/'));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '.beast-mode-manifest.json'), '{}\n');
  }
  if (config !== null) {
    fs.mkdirSync(path.join(root, '.beast-mode'), { recursive: true });
    fs.writeFileSync(path.join(root, '.beast-mode', 'orca.json'), typeof config === 'string' ? config : `${JSON.stringify(config, null, 2)}\n`);
  }
  return root;
}

/**
 * A folder of fake agent commands, to serve as PATH.
 *
 * @param {string[]} names
 * @returns {string}
 */
function makeBin(names) {
  const dir = createTempProjectRoot();
  for (const name of names) {
    const file = path.join(dir, name);
    fs.writeFileSync(file, '#!/bin/sh\nexit 0\n');
    fs.chmodSync(file, 0o755);
  }
  return dir;
}

/**
 * @param {string} bin The fake PATH.
 * @returns {Record<string, string>}
 */
function testEnv(bin) {
  return { PATH: bin, ORCA_CLI_COMMAND: FAKE_ORCA, ORCA_TERMINAL_HANDLE: 'term-test' };
}

/**
 * Run one step and parse its one JSON object.
 *
 * @param {string} root
 * @param {string[]} args
 * @param {{ runner?: import('../lib/orca/exec.js').Runner, env?: Record<string, string>, cwd?: string }} [opts]
 * @returns {{ code: number, json: Record<string, any> }}
 */
function step(root, args, { runner = fakeRunner(RUNNING).runner, env = testEnv(''), cwd = root } = {}) {
  let out = '';
  const stdout = /** @type {any} */ ({ write: (chunk) => ((out += chunk), true) });
  const code = runOrca([...args, '--project', root], {
    stdout,
    cwd,
    pluginRoot: PLUGIN_ROOT,
    env,
    runner,
    platform: 'linux',
    execPath: process.execPath,
  });
  const lines = out.split('\n').filter((line) => line.length > 0);
  assert.equal(lines.length, 1, `one JSON object per call, got: ${out}`);
  const json = JSON.parse(lines[0]);
  assert.equal(json.schema, 1);
  return { code, json };
}

/**
 * Run `detect` through the library, with a fake runner and a fake PATH.
 *
 * @param {string} root
 * @param {{ bin: string, answer?: import('../lib/orca/exec.js').RunResult }} opts
 */
function detectIn(root, { bin, answer = RUNNING }) {
  const fake = fakeRunner(answer);
  const facts = detect({ runner: fake.runner, orca: FAKE_ORCA, projectRoot: root, env: testEnv(bin), platform: 'linux' });
  return { facts, calls: fake.calls };
}

/**
 * @param {string} root
 * @returns {string}
 */
function orcaJson(root) {
  return path.join(root, '.beast-mode', 'orca.json');
}

/**
 * @param {string} root
 * @returns {string[]} The entries of `.beast-mode`.
 */
function beastModeEntries(root) {
  return fs.readdirSync(path.join(root, '.beast-mode')).sort();
}

/**
 * @param {string[]} dirs
 * @param {() => void} body
 */
function withCleanup(dirs, body) {
  try {
    body();
  } finally {
    for (const dir of dirs) removeFixture(dir);
  }
}

// ---------------------------------------------------------------------------
// detect: the harnesses
// ---------------------------------------------------------------------------

test('detect: a project with no harness finds none, and suggests no agent', () => {
  const root = makeProject();
  const bin = makeBin(['claude', 'dsh']);
  withCleanup([root, bin], () => {
    const { facts } = detectIn(root, { bin });
    assert.deepEqual(facts.harnesses, []);
    assert.deepEqual(facts.usable, []);
    assert.deepEqual(facts.suggested, {
      stages: { plan: null, implement: null, verify: null, review: null, docs: null },
      source: 'defaults',
    });
  });
});

test('detect: one installed harness with its command on PATH is usable and takes every stage', () => {
  const root = makeProject({ harnesses: ['claude'] });
  const bin = makeBin(['claude']);
  withCleanup([root, bin], () => {
    const { facts } = detectIn(root, { bin });
    assert.equal(facts.harnesses.length, 1);
    assert.deepEqual(
      { id: facts.harnesses[0].id, command: facts.harnesses[0].command, onPath: facts.harnesses[0].onPath, usable: facts.harnesses[0].usable },
      { id: 'claude', command: 'claude', onPath: true, usable: true }
    );
    assert.equal(facts.harnesses[0].path, path.join(bin, 'claude'));
    assert.deepEqual(facts.usable, ['claude']);
    assert.deepEqual(facts.suggested.stages, { plan: 'claude', implement: 'claude', verify: 'claude', review: 'claude', docs: 'claude' });
  });
});

test('detect: two harnesses with both commands on PATH suggest the A3 defaults', () => {
  const root = makeProject({ harnesses: ['claude', 'dsh'] });
  const bin = makeBin(['claude', 'dsh']);
  withCleanup([root, bin], () => {
    const { facts } = detectIn(root, { bin });
    assert.deepEqual(facts.harnesses.map((harness) => harness.id), ['claude', 'dsh']);
    assert.deepEqual(facts.usable, ['claude', 'dsh']);
    assert.deepEqual(facts.suggested, {
      stages: { plan: 'claude', implement: 'dsh', verify: 'dsh', review: 'claude', docs: 'dsh' },
      source: 'defaults',
    });
  });
});

test('detect: an installed harness whose command is not on PATH is listed and not usable', () => {
  const root = makeProject({ harnesses: ['claude', 'dsh'] });
  const bin = makeBin(['claude']);
  withCleanup([root, bin], () => {
    const { facts } = detectIn(root, { bin });
    const dsh = facts.harnesses.find((harness) => harness.id === 'dsh');
    assert.deepEqual([dsh.onPath, dsh.path, dsh.usable], [false, null, false]);
    assert.deepEqual(facts.usable, ['claude']);
    // The A3 build agent dsh gives way to the one usable id.
    assert.deepEqual(facts.suggested.stages, { plan: 'claude', implement: 'claude', verify: 'claude', review: 'claude', docs: 'claude' });
  });
});

test('detect: the command is the first word of agents.<id>.command, else the id', () => {
  const root = makeProject({
    harnesses: ['claude', 'dsh'],
    config: { version: 1, agents: { dsh: { command: 'dsh-personal --profile x' } } },
  });
  withCleanup([root], () => {
    const found = makeBin(['claude', 'dsh-personal']);
    const missing = makeBin(['claude', 'dsh']);
    try {
      let { facts } = detectIn(root, { bin: found });
      assert.deepEqual(facts.harnesses.map((harness) => [harness.id, harness.command, harness.usable]), [
        ['claude', 'claude', true],
        ['dsh', 'dsh-personal', true],
      ]);
      // The plain id "dsh" on PATH does not make the custom command usable.
      ({ facts } = detectIn(root, { bin: missing }));
      assert.deepEqual(facts.harnesses.map((harness) => [harness.id, harness.command, harness.usable]), [
        ['claude', 'claude', true],
        ['dsh', 'dsh-personal', false],
      ]);
    } finally {
      removeFixture(found);
      removeFixture(missing);
    }
  });
});

// ---------------------------------------------------------------------------
// The PATH search
// ---------------------------------------------------------------------------

test('findOnPath: a runnable file is found, a plain file with no execute bit and a missing name are not', () => {
  const bin = makeBin(['tool']);
  withCleanup([bin], () => {
    fs.writeFileSync(path.join(bin, 'plain'), 'x');
    fs.chmodSync(path.join(bin, 'plain'), 0o644);
    fs.mkdirSync(path.join(bin, 'folder'));
    const env = { PATH: `/nonexistent-bm-dir:${bin}` };
    assert.equal(findOnPath('tool', env, 'linux'), path.join(bin, 'tool'));
    assert.equal(findOnPath('absent', env, 'linux'), null);
    assert.equal(findOnPath('folder', env, 'linux'), null);
    assert.equal(findOnPath('', env, 'linux'), null);
    assert.equal(findOnPath('tool', {}, 'linux'), null);
    // A command with a path separator is checked where it stands.
    assert.equal(findOnPath(path.join(bin, 'tool'), {}, 'linux'), path.join(bin, 'tool'));
    if (process.getuid && process.getuid() !== 0) assert.equal(findOnPath('plain', env, 'linux'), null);
  });
});

test('findOnPath: on Windows PATHEXT adds the extension, and the PATH name is not case sensitive', () => {
  const bin = createTempProjectRoot();
  withCleanup([bin], () => {
    fs.writeFileSync(path.join(bin, 'dsh.CMD'), 'x');
    fs.writeFileSync(path.join(bin, 'plain.EXE'), 'x');
    assert.equal(findOnPath('dsh', { Path: bin, PathExt: '.EXE;.CMD' }, 'win32'), path.join(bin, 'dsh.CMD'));
    assert.equal(findOnPath('plain.EXE', { PATH: bin, PATHEXT: '.EXE' }, 'win32'), path.join(bin, 'plain.EXE'));
    // With PATHEXT unset the default list applies.
    assert.equal(findOnPath('dsh', { PATH: bin }, 'win32'), path.join(bin, 'dsh.CMD'));
    assert.equal(findOnPath('absent', { PATH: bin }, 'win32'), null);
  });
});

// ---------------------------------------------------------------------------
// detect: the Orca CLI, the launch table, and the offer
// ---------------------------------------------------------------------------

test('detect: the Orca CLI is found and running, found and stopped, or not found', () => {
  const root = makeProject();
  const bin = makeBin([]);
  withCleanup([root, bin], () => {
    let { facts, calls } = detectIn(root, { bin, answer: RUNNING });
    assert.deepEqual([facts.orca.executable, facts.orca.found, facts.orca.running], [FAKE_ORCA, true, true]);
    assert.deepEqual(calls, [{ command: FAKE_ORCA, args: ['status', '--json'] }]);

    ({ facts } = detectIn(root, { bin, answer: NOT_RUNNING }));
    assert.deepEqual([facts.orca.found, facts.orca.running], [true, false]);
    assert.ok(facts.orca.detail.length > 0);

    ({ facts } = detectIn(root, { bin, answer: NOT_FOUND }));
    assert.deepEqual([facts.orca.found, facts.orca.running], [false, false]);
    assert.ok(facts.orca.detail.length > 0);
  });
});

test('detect: the launch table maps plan-feature and autorun-feature, and usable ids only reach the suggestion', () => {
  const both = makeProject({ harnesses: ['claude', 'dsh'], config: { version: 1, commands: { 'plan-feature': 'dsh', 'autorun-feature': 'claude' } } });
  const one = makeProject({ harnesses: ['claude'], config: { version: 1, commands: { 'plan-feature': 'dsh', 'autorun-feature': 'dsh' } } });
  const bad = makeProject({ harnesses: ['claude', 'dsh'], config: { version: 1, commands: { 'plan-feature': 'gemini', 'autorun-feature': 7 } } });
  const bin = makeBin(['claude', 'dsh']);
  withCleanup([both, one, bad, bin], () => {
    let { facts } = detectIn(both, { bin });
    assert.deepEqual(facts.config.launchTable, { plan: 'dsh', implement: 'claude' });
    assert.deepEqual(facts.suggested, {
      stages: { plan: 'dsh', implement: 'claude', verify: 'claude', review: 'claude', docs: 'claude' },
      source: 'launch-table',
    });

    // dsh is installed in none of the two roles that the table names, so claude takes both.
    ({ facts } = detectIn(one, { bin }));
    assert.deepEqual(facts.config.launchTable, { plan: 'dsh', implement: 'dsh' });
    assert.deepEqual(facts.suggested.stages, { plan: 'claude', implement: 'claude', verify: 'claude', review: 'claude', docs: 'claude' });

    // A value that names no known agent is ignored.
    ({ facts } = detectIn(bad, { bin }));
    assert.deepEqual(facts.config.launchTable, { plan: null, implement: null });
    assert.equal(facts.suggested.source, 'defaults');
  });
});

test('suggestStages: verify and docs follow the build agent, review stays on claude', () => {
  assert.deepEqual(suggestStages({ plan: null, implement: 'claude' }, ['claude', 'dsh']).stages, {
    plan: 'claude',
    implement: 'claude',
    verify: 'claude',
    review: 'claude',
    docs: 'claude',
  });
  assert.deepEqual(suggestStages({ plan: null, implement: null }, ['dsh']).stages, {
    plan: 'dsh',
    implement: 'dsh',
    verify: 'dsh',
    review: 'dsh',
    docs: 'dsh',
  });
});

test('detect: offer is setup when the CLI is found and the orchestration object is missing or invalid, else none', () => {
  const cases = [
    { name: 'no file', config: null, answer: RUNNING, state: 'missing', offer: 'setup' },
    { name: 'a file with no orchestration key', config: { version: 1 }, answer: RUNNING, state: 'valid', offer: 'setup' },
    { name: 'an invalid orchestration object', config: { version: 1, orchestration: { comit: 'phase' } }, answer: RUNNING, state: 'invalid', offer: 'setup' },
    { name: 'a file that is not JSON', config: '{ nope', answer: RUNNING, state: 'invalid', offer: 'setup' },
    { name: 'a valid orchestration object', config: { version: 1, orchestration: ORCHESTRATION }, answer: RUNNING, state: 'valid', offer: 'none' },
    { name: 'a valid object with the app stopped', config: { version: 1, orchestration: {} }, answer: NOT_RUNNING, state: 'valid', offer: 'none' },
    { name: 'no CLI and no file', config: null, answer: NOT_FOUND, state: 'missing', offer: 'none' },
    { name: 'no CLI and an invalid file', config: '{ nope', answer: NOT_FOUND, state: 'invalid', offer: 'none' },
  ];
  const bin = makeBin([]);
  const roots = [bin];
  try {
    for (const item of cases) {
      const root = makeProject({ config: item.config });
      roots.push(root);
      const { facts } = detectIn(root, { bin, answer: item.answer });
      assert.equal(facts.config.state, item.state, item.name);
      assert.equal(facts.offer, item.offer, item.name);
    }
  } finally {
    for (const dir of roots) removeFixture(dir);
  }
});

test('detect: an invalid file lists its problems, and a valid object shows the resolved settings', () => {
  const invalid = makeProject({ config: { version: 1, orchestration: { stages: { plan: 'gemini' } } } });
  const valid = makeProject({ config: { version: 1, orchestration: { stages: { implement: 'claude' } } } });
  const bin = makeBin([]);
  withCleanup([invalid, valid, bin], () => {
    let { facts } = detectIn(invalid, { bin });
    assert.deepEqual(facts.config.problems, [{ code: 'stage-agent', at: '$.orchestration.stages.plan' }]);
    assert.equal(facts.config.hasOrchestration, false);

    ({ facts } = detectIn(valid, { bin }));
    assert.equal(facts.config.hasOrchestration, true);
    assert.deepEqual(facts.config.orchestration, { stages: { implement: 'claude' } });
    assert.deepEqual(facts.config.resolved.stages, { plan: 'claude', implement: 'claude', verify: 'claude', review: 'claude', docs: 'claude' });
    assert.deepEqual([facts.config.resolved.backstopSeconds, facts.config.resolved.statusEveryMinutes], [600, 30]);
  });
});

test('writer: backstopSeconds and statusEveryMinutes are written as given, and read back resolved (fix 7)', () => {
  const root = makeProject();
  withCleanup([root], () => {
    const answer = writeOrchestration(root, { commit: 'phase', backstopSeconds: 900, statusEveryMinutes: 60, steps: [] });
    assert.equal(answer.ok, true);
    const after = JSON.parse(fs.readFileSync(orcaJson(root), 'utf8'));
    assert.deepEqual([after.orchestration.backstopSeconds, after.orchestration.statusEveryMinutes], [900, 60]);
    const read = parseOrcaConfig(fs.readFileSync(orcaJson(root), 'utf8'));
    assert.deepEqual([read.orchestration.backstopSeconds, read.orchestration.statusEveryMinutes], [900, 60]);
  });
});

// ---------------------------------------------------------------------------
// The detect and config steps
// ---------------------------------------------------------------------------

test('step detect: one JSON object, one Orca call, no git call, and no file written', () => {
  const root = makeProject({ harnesses: ['claude'], config: { version: 1 } });
  const bin = makeBin(['claude']);
  withCleanup([root, bin], () => {
    const before = snapshotTree(root);
    const fake = fakeRunner(RUNNING);
    const { code, json } = step(root, ['detect'], { runner: fake.runner, env: testEnv(bin) });
    assert.equal(code, 0);
    assert.deepEqual([json.step, json.ok, json.offer], ['detect', true, 'setup']);
    assert.deepEqual(Object.keys(json).sort(), ['config', 'editedAutoruns', 'harnesses', 'numberSettings', 'offer', 'ok', 'orca', 'projectSkills', 'say', 'schema', 'step', 'suggested', 'usable']);
    // Fix 7: the backstop timer and the status cadence, with their defaults and bounds.
    assert.deepEqual(json.numberSettings, {
      backstopSeconds: { default: 600, min: 60, max: 86400, unit: 'seconds' },
      statusEveryMinutes: { default: 30, min: 1, max: 1440, unit: 'minutes' },
      stepRoundCap: { default: 3, min: 1, max: 20, unit: 'rounds' },
    });
    assert.deepEqual(fake.calls, [{ command: FAKE_ORCA, args: ['status', '--json'] }]);
    assert.deepEqual(snapshotTree(root), before);
  });
});

test('step detect and config: an unknown flag is a usage error', () => {
  const root = makeProject();
  withCleanup([root], () => {
    const ctx = { stdout: /** @type {any} */ ({ write: () => true }), cwd: root, pluginRoot: PLUGIN_ROOT, env: testEnv(''), runner: fakeRunner(RUNNING).runner };
    for (const args of [['detect', '--feature', 'x'], ['detect', 'extra'], ['config', '--feature', 'x'], ['config', '--write']]) {
      assert.throws(() => runOrca([...args, '--project', root], ctx), UsageError, args.join(' '));
    }
  });
});

test('step config: with no --write it prints the file state and writes nothing', () => {
  const missing = makeProject();
  const valid = makeProject({ config: { version: 1, agents: { dsh: { command: 'dsh-personal' } }, orchestration: ORCHESTRATION } });
  const invalid = makeProject({ config: { version: 2 } });
  withCleanup([missing, valid, invalid], () => {
    let { code, json } = step(missing, ['config']);
    assert.equal(code, 0);
    assert.deepEqual([json.step, json.ok, json.state, json.written, json.hasOrchestration], ['config', true, 'missing', false, false]);
    assert.ok(!fs.existsSync(path.join(missing, '.beast-mode')));

    ({ json } = step(valid, ['config']));
    assert.deepEqual([json.state, json.hasOrchestration, json.written], ['valid', true, false]);
    assert.deepEqual(json.orchestration, ORCHESTRATION);
    assert.equal(json.resolved.stages.verify, 'dsh');

    ({ code, json } = step(invalid, ['config']));
    assert.equal(code, 0);
    assert.deepEqual([json.state, json.problems], ['invalid', [{ code: 'version', at: '$.version' }]]);
  });
});

test('step config --write: a missing file, bad JSON, and a non-object are refusals with exit 0', () => {
  const root = makeProject();
  withCleanup([root], () => {
    const body = path.join(root, 'body.json');
    let { code, json } = step(root, ['config', '--write', path.join(root, 'absent.json')]);
    assert.deepEqual([code, json.ok, json.code, json.written], [0, false, 'write-file-missing', false]);

    fs.writeFileSync(body, '{ nope');
    ({ code, json } = step(root, ['config', '--write', body]));
    assert.deepEqual([code, json.ok, json.code], [0, false, 'write-file-not-json']);

    fs.writeFileSync(body, '[1]');
    ({ code, json } = step(root, ['config', '--write', body]));
    assert.deepEqual([code, json.ok, json.code], [0, false, 'write-file-not-object']);
    assert.ok(!fs.existsSync(path.join(root, '.beast-mode')), 'a refusal writes no settings file');
  });
});

test('step config --write: a new file, then a second write over a hand-added key keeps the key and its place', () => {
  const root = makeProject();
  withCleanup([root], () => {
    const body = path.join(root, 'body.json');
    fs.writeFileSync(body, JSON.stringify(ORCHESTRATION));

    let { code, json } = step(root, ['config', '--write', body], { cwd: root });
    assert.deepEqual([code, json.ok, json.written, json.created, json.replaced], [0, true, true, true, false]);
    assert.deepEqual(json.orchestration, ORCHESTRATION);
    assert.equal(
      fs.readFileSync(orcaJson(root), 'utf8'),
      `${JSON.stringify({ version: 1, orchestration: ORCHESTRATION }, null, 2)}\n`
    );

    // The user adds a key before and a key after the orchestration object.
    const hand = { version: 1, mine: { note: 'keep me' }, orchestration: ORCHESTRATION, zzz: [1, 2] };
    fs.writeFileSync(orcaJson(root), `${JSON.stringify(hand, null, 2)}\n`);
    const changed = { stages: { plan: 'dsh', implement: 'claude' }, commit: 'feature', concurrent: false };
    fs.writeFileSync(body, JSON.stringify(changed));

    ({ code, json } = step(root, ['config', '--write', body]));
    assert.deepEqual([code, json.ok, json.created, json.replaced], [0, true, false, true]);
    const after = JSON.parse(fs.readFileSync(orcaJson(root), 'utf8'));
    assert.deepEqual(Object.keys(after), ['version', 'mine', 'orchestration', 'zzz']);
    assert.deepEqual(after.mine, { note: 'keep me' });
    assert.deepEqual(after.zzz, [1, 2]);
    assert.deepEqual(after.orchestration, changed);
    assert.deepEqual(beastModeEntries(root), ['orca.json']);
  });
});

test('step config --write: a relative file name resolves against the working directory', () => {
  const root = makeProject();
  withCleanup([root], () => {
    fs.writeFileSync(path.join(root, 'rel.json'), JSON.stringify(ORCHESTRATION));
    const { json } = step(root, ['config', '--write', 'rel.json'], { cwd: root });
    assert.equal(json.written, true);
  });
});

// ---------------------------------------------------------------------------
// The writer table
// ---------------------------------------------------------------------------

test('writer: a new file is { version: 1, orchestration } in 2-space JSON with a final newline', () => {
  const root = makeProject();
  withCleanup([root], () => {
    const answer = writeOrchestration(root, ORCHESTRATION);
    assert.equal(answer.ok, true);
    assert.deepEqual([answer.created, answer.replaced, answer.file], [true, false, '.beast-mode/orca.json']);
    const text = fs.readFileSync(orcaJson(root), 'utf8');
    assert.equal(text, `${JSON.stringify({ version: 1, orchestration: ORCHESTRATION }, null, 2)}\n`);
    assert.ok(text.endsWith('}\n') && !text.endsWith('\n\n'));
    assert.match(text, /\n {2}"version": 1,\n/);
    assert.deepEqual(beastModeEntries(root), ['orca.json']);
  });
});

test('writer: an extend appends orchestration last and keeps agents, commands, and unknown keys', () => {
  const start = {
    version: 1,
    agents: { dsh: { command: 'dsh-personal' } },
    commands: { 'plan-feature': 'claude' },
    future: { x: [1, { y: 2 }] },
  };
  const root = makeProject({ config: start });
  withCleanup([root], () => {
    const answer = writeOrchestration(root, ORCHESTRATION);
    assert.deepEqual([answer.ok, answer.created, answer.replaced], [true, false, false]);
    const after = JSON.parse(fs.readFileSync(orcaJson(root), 'utf8'));
    assert.deepEqual(Object.keys(after), ['version', 'agents', 'commands', 'future', 'orchestration']);
    assert.deepEqual({ ...after, orchestration: undefined }, { ...start, orchestration: undefined });
    assert.deepEqual(after.orchestration, ORCHESTRATION);
  });
});

test('writer: an existing orchestration value is replaced in place, and every key order holds', () => {
  const start = { zeta: 1, version: 1, orchestration: { commit: 'feature' }, agents: { claude: { command: 'claude' } }, alpha: { b: 1, a: 2 } };
  const root = makeProject({ config: start });
  withCleanup([root], () => {
    const answer = writeOrchestration(root, ORCHESTRATION);
    assert.deepEqual([answer.ok, answer.replaced], [true, true]);
    const after = JSON.parse(fs.readFileSync(orcaJson(root), 'utf8'));
    assert.deepEqual(Object.keys(after), ['zeta', 'version', 'orchestration', 'agents', 'alpha']);
    assert.deepEqual(Object.keys(after.alpha), ['b', 'a']);
    assert.deepEqual(after.orchestration, ORCHESTRATION);
  });
});

test('writer: a second write of the same value changes no byte', () => {
  const root = makeProject({ config: { version: 1, hand: true } });
  withCleanup([root], () => {
    assert.equal(writeOrchestration(root, ORCHESTRATION).ok, true);
    const first = fs.readFileSync(orcaJson(root), 'utf8');
    assert.equal(writeOrchestration(root, ORCHESTRATION).ok, true);
    assert.equal(fs.readFileSync(orcaJson(root), 'utf8'), first);
  });
});

test('writer: an invalid current file is refused with its bytes unchanged', () => {
  const bodies = [
    ['not json', '{ nope\n', 'config-invalid'],
    ['not an object', '[1, 2]\n', 'config-invalid'],
    ['a wrong version', '{ "version": 2 }\n', 'config-invalid'],
    ['a bad agent command', '{ "version": 1, "agents": { "dsh": { "command": "rm -rf; x" } } }\n', 'config-invalid'],
    ['a bad orchestration object', '{ "version": 1, "orchestration": { "comit": "phase" } }\n', 'config-invalid'],
  ];
  for (const [name, text, code] of bodies) {
    const root = makeProject({ config: text });
    try {
      const answer = writeOrchestration(root, ORCHESTRATION);
      assert.equal(answer.ok, false, name);
      assert.equal(answer.code, code, name);
      assert.ok(answer.ok === false && answer.detail.length > 0 || name === 'not json', name);
      assert.equal(fs.readFileSync(orcaJson(root), 'utf8'), text, `${name}: bytes unchanged`);
      assert.deepEqual(beastModeEntries(root), ['orca.json'], `${name}: no temporary file`);
    } finally {
      removeFixture(root);
    }
  }
});

test('writer: the problems of an invalid file come back with their JSON paths', () => {
  const root = makeProject({ config: { version: 1, orchestration: { stages: { plan: 'gemini' }, commit: 'never' } } });
  withCleanup([root], () => {
    const answer = writeOrchestration(root, ORCHESTRATION);
    assert.equal(answer.ok, false);
    assert.deepEqual(answer.problems, [
      { code: 'stage-agent', at: '$.orchestration.stages.plan' },
      { code: 'commit-value', at: '$.orchestration.commit' },
    ]);
  });
});

test('writer: a value that fails the schema is refused, and nothing is written', () => {
  const fresh = makeProject();
  const existing = makeProject({ config: { version: 1, keep: true } });
  withCleanup([fresh, existing], () => {
    const before = fs.readFileSync(orcaJson(existing), 'utf8');
    for (const bad of [{ comit: 'phase' }, { stages: { plan: 'gemini' } }, { stages: { review: 'maybe' } }, { commit: 'week' }, { concurrent: 'yes' }, { backstopSeconds: 30 }, { statusEveryMinutes: 0 }]) {
      let answer = writeOrchestration(fresh, bad);
      assert.deepEqual([answer.ok, answer.code], [false, 'config-invalid'], JSON.stringify(bad));
      assert.ok(answer.problems.length > 0);
      answer = writeOrchestration(existing, bad);
      assert.deepEqual([answer.ok, answer.code], [false, 'config-invalid'], JSON.stringify(bad));
    }
    assert.ok(!fs.existsSync(path.join(fresh, '.beast-mode')), 'no file and no folder for a refused new file');
    assert.equal(fs.readFileSync(orcaJson(existing), 'utf8'), before);
    for (const bad of [null, [], 'text', 4]) {
      assert.equal(writeOrchestration(existing, bad).code, 'bad-input');
    }
  });
});

test('writer: the 64 KiB cap refuses a result that grows over it and a file that is over it', () => {
  const nearly = `${JSON.stringify({ version: 1, pad: 'x'.repeat(ORCA_JSON_MAX_BYTES - 120) }, null, 2)}\n`;
  const over = `${JSON.stringify({ version: 1, pad: 'x'.repeat(ORCA_JSON_MAX_BYTES + 10) }, null, 2)}\n`;
  assert.ok(Buffer.byteLength(nearly) < ORCA_JSON_MAX_BYTES);
  const growing = makeProject({ config: nearly });
  const huge = makeProject({ config: over });
  withCleanup([growing, huge], () => {
    let answer = writeOrchestration(growing, ORCHESTRATION);
    assert.deepEqual([answer.ok, answer.code], [false, 'config-too-large']);
    assert.equal(fs.readFileSync(orcaJson(growing), 'utf8'), nearly);
    assert.deepEqual(beastModeEntries(growing), ['orca.json']);

    answer = writeOrchestration(huge, ORCHESTRATION);
    assert.deepEqual([answer.ok, answer.code], [false, 'config-too-large']);
    assert.equal(fs.readFileSync(orcaJson(huge), 'utf8'), over);
  });
});

test('writer: a link in place of orca.json or .beast-mode is refused, and the target is untouched', { skip: process.platform === 'win32' }, () => {
  const fileLink = makeProject();
  const dirLink = makeProject();
  const elsewhere = createTempProjectRoot();
  withCleanup([fileLink, dirLink, elsewhere], () => {
    const target = path.join(elsewhere, 'real.json');
    const text = `${JSON.stringify({ version: 1 })}\n`;
    fs.writeFileSync(target, text);
    fs.mkdirSync(path.join(fileLink, '.beast-mode'));
    fs.symlinkSync(target, orcaJson(fileLink));
    let answer = writeOrchestration(fileLink, ORCHESTRATION);
    assert.deepEqual([answer.ok, answer.code], [false, 'config-not-file']);
    assert.equal(fs.readFileSync(target, 'utf8'), text);
    assert.ok(fs.lstatSync(orcaJson(fileLink)).isSymbolicLink());

    const realDir = path.join(elsewhere, 'dir');
    fs.mkdirSync(realDir);
    fs.writeFileSync(path.join(realDir, 'orca.json'), text);
    fs.symlinkSync(realDir, path.join(dirLink, '.beast-mode'));
    answer = writeOrchestration(dirLink, ORCHESTRATION);
    assert.deepEqual([answer.ok, answer.code], [false, 'config-not-file']);
    assert.equal(fs.readFileSync(path.join(realDir, 'orca.json'), 'utf8'), text);
    assert.deepEqual(fs.readdirSync(realDir), ['orca.json']);
  });
});

test('writer: a folder in place of orca.json or of .beast-mode is refused', () => {
  const folder = makeProject();
  const dotFile = makeProject();
  withCleanup([folder, dotFile], () => {
    fs.mkdirSync(orcaJson(folder), { recursive: true });
    let answer = writeOrchestration(folder, ORCHESTRATION);
    assert.deepEqual([answer.ok, answer.code], [false, 'config-not-file']);
    assert.ok(fs.statSync(orcaJson(folder)).isDirectory());
    assert.deepEqual(fs.readdirSync(orcaJson(folder)), []);

    fs.writeFileSync(path.join(dotFile, '.beast-mode'), 'a file, not a folder');
    answer = writeOrchestration(dotFile, ORCHESTRATION);
    assert.deepEqual([answer.ok, answer.code], [false, 'config-not-file']);
    assert.equal(fs.readFileSync(path.join(dotFile, '.beast-mode'), 'utf8'), 'a file, not a folder');
  });
});

test('writer: no temporary file stays after a write, a refusal, or a write fault', () => {
  const ok = makeProject({ config: { version: 1 } });
  const refusal = makeProject({ config: '{ nope' });
  const fault = makeProject({ config: { version: 1 } });
  withCleanup([ok, refusal, fault], () => {
    assert.equal(writeOrchestration(ok, ORCHESTRATION).ok, true);
    assert.deepEqual(beastModeEntries(ok), ['orca.json']);

    assert.equal(writeOrchestration(refusal, ORCHESTRATION).ok, false);
    assert.deepEqual(beastModeEntries(refusal), ['orca.json']);

    // A read-only folder stops the temporary file. The run as root cannot make that fault.
    if (process.platform !== 'win32' && process.getuid && process.getuid() !== 0) {
      const dir = path.join(fault, '.beast-mode');
      const before = fs.readFileSync(orcaJson(fault), 'utf8');
      fs.chmodSync(dir, 0o555);
      try {
        const answer = writeOrchestration(fault, ORCHESTRATION);
        assert.deepEqual([answer.ok, answer.code], [false, 'write-failed']);
      } finally {
        fs.chmodSync(dir, 0o755);
      }
      assert.deepEqual(beastModeEntries(fault), ['orca.json']);
      assert.equal(fs.readFileSync(orcaJson(fault), 'utf8'), before);
    }
  });
});
