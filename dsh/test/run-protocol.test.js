// dsh/test/run-protocol.test.js
//
// Covers the run protocol of implementation.md section 3.6
// (harness-support/dsh-web-panel, Phase 4): the two trust checks, the three
// envelope checks, the command allow list, the reference pattern, and the
// prompt text of each of the ten commands.
//
// The reject branches carry the test mass, because a passed message reaches
// an agent as user input (Decision 9).
//
// Every test runs with plain Node. No test starts dsh, no test opens a
// socket, and no test touches a DOM. The last test reads
// `web/src/frontend/runner.ts` as text and skips when that file is absent.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  ALLOWED_COMMANDS,
  EPIC_COMMANDS,
  FEATURE_COMMANDS,
  MESSAGE_SOURCE,
  MESSAGE_TYPE,
  MESSAGE_VERSION,
  REF_PATTERN,
  isRunMessageShape,
  isTrustedEvent,
  parseRunMessage,
} from '../lib/run-protocol.js';

const RUNNER_SOURCE = fileURLToPath(new URL('../../web/src/frontend/runner.ts', import.meta.url));

/** Build one well-formed message body, with the named fields replaced. */
function message(overrides = {}) {
  return {
    source: MESSAGE_SOURCE,
    type: MESSAGE_TYPE,
    version: MESSAGE_VERSION,
    command: 'continue-feature',
    ref: 'harness-support/dsh-web-panel',
    project: 'beast-mode',
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// The command lists
// ─────────────────────────────────────────────────────────────────────────

test('the allow list holds the seven feature commands and the three epic commands', () => {
  assert.equal(FEATURE_COMMANDS.length, 7);
  assert.equal(EPIC_COMMANDS.length, 3);
  assert.deepEqual(ALLOWED_COMMANDS, [...FEATURE_COMMANDS, ...EPIC_COMMANDS]);
  assert.equal(ALLOWED_COMMANDS.length, 10);
});

test('every command name is bare, with no leading slash', () => {
  for (const command of ALLOWED_COMMANDS) {
    assert.ok(!command.startsWith('/'), `"${command}" must carry no leading slash`);
  }
});

test('the command lists are frozen, so no caller can widen the allow list', () => {
  assert.ok(Object.isFrozen(FEATURE_COMMANDS));
  assert.ok(Object.isFrozen(EPIC_COMMANDS));
  assert.ok(Object.isFrozen(ALLOWED_COMMANDS));
});

// ─────────────────────────────────────────────────────────────────────────
// isTrustedEvent: check 1 (the origin) and check 2 (the source frame)
// ─────────────────────────────────────────────────────────────────────────

test('isTrustedEvent accepts the panel frame on the page origin', () => {
  const frame = { name: 'panel' };
  const event = { origin: 'https://host.example', source: frame };
  assert.equal(isTrustedEvent(event, { origin: 'https://host.example', frame }), true);
});

test('isTrustedEvent rejects a foreign origin', () => {
  const frame = { name: 'panel' };
  const event = { origin: 'https://evil.example', source: frame };
  assert.equal(isTrustedEvent(event, { origin: 'https://host.example', frame }), false);
});

test('isTrustedEvent rejects a second frame on the page origin', () => {
  const frame = { name: 'panel' };
  const other = { name: 'other' };
  const event = { origin: 'https://host.example', source: other };
  assert.equal(isTrustedEvent(event, { origin: 'https://host.example', frame }), false);
});

test('isTrustedEvent rejects an absent frame, an absent origin, and an absent event', () => {
  const frame = { name: 'panel' };
  const event = { origin: 'https://host.example', source: frame };
  assert.equal(isTrustedEvent(event, { origin: 'https://host.example', frame: null }), false);
  assert.equal(isTrustedEvent(event, { origin: '', frame }), false);
  assert.equal(isTrustedEvent(event, { frame }), false);
  assert.equal(isTrustedEvent(event, null), false);
  assert.equal(isTrustedEvent(null, { origin: 'https://host.example', frame }), false);
});

test('isTrustedEvent rejects an event whose source is absent', () => {
  const frame = { name: 'panel' };
  assert.equal(
    isTrustedEvent({ origin: 'https://host.example' }, { origin: 'https://host.example', frame }),
    false,
  );
});

// ─────────────────────────────────────────────────────────────────────────
// isRunMessageShape: check 3 (the envelope)
// ─────────────────────────────────────────────────────────────────────────

test('isRunMessageShape accepts the envelope of section 3.6', () => {
  assert.equal(isRunMessageShape(message()), true);
});

test('isRunMessageShape rejects a wrong source, type, or version', () => {
  assert.equal(isRunMessageShape(message({ source: 'other-panel' })), false);
  assert.equal(isRunMessageShape(message({ type: 'beast-mode:other' })), false);
  assert.equal(isRunMessageShape(message({ version: 2 })), false);
  assert.equal(isRunMessageShape(message({ version: '1' })), false);
});

test('isRunMessageShape rejects a non-object body', () => {
  assert.equal(isRunMessageShape(null), false);
  assert.equal(isRunMessageShape(undefined), false);
  assert.equal(isRunMessageShape('beast-mode:run'), false);
  assert.equal(isRunMessageShape(7), false);
});

// ─────────────────────────────────────────────────────────────────────────
// parseRunMessage: the envelope, the allow list, and the reference pattern
// ─────────────────────────────────────────────────────────────────────────

test('parseRunMessage accepts a well-formed message and builds the prompt text', () => {
  assert.deepEqual(parseRunMessage(message()), {
    command: 'continue-feature',
    ref: 'harness-support/dsh-web-panel',
    text: '/continue-feature harness-support/dsh-web-panel',
  });
});

test('parseRunMessage builds "/<command> <ref>" for each of the ten commands', () => {
  for (const command of ALLOWED_COMMANDS) {
    const parsed = parseRunMessage(message({ command, ref: 'demo' }));
    assert.ok(parsed !== null, `"${command}" must pass the allow list`);
    assert.equal(parsed.text, `/${command} demo`);
    assert.equal(parsed.command, command);
    assert.equal(parsed.ref, 'demo');
  }
});

test('parseRunMessage rejects every envelope failure with no text', () => {
  assert.equal(parseRunMessage(message({ source: 'other-panel' })), null);
  assert.equal(parseRunMessage(message({ type: 'beast-mode:other' })), null);
  assert.equal(parseRunMessage(message({ version: 2 })), null);
  assert.equal(parseRunMessage(null), null);
  assert.equal(parseRunMessage('/continue-feature demo'), null);
});

test('parseRunMessage rejects a command outside the allow list', () => {
  for (const command of ['proceed', 'plan-feature', 'rm', '', 'continue-feature ', '/continue-feature']) {
    assert.equal(parseRunMessage(message({ command })), null, `"${command}" must produce no text`);
  }
});

test('parseRunMessage rejects a non-string command', () => {
  assert.equal(parseRunMessage(message({ command: 7 })), null);
  assert.equal(parseRunMessage(message({ command: undefined })), null);
  assert.equal(parseRunMessage(message({ command: ['continue-feature'] })), null);
});

test('parseRunMessage rejects a reference that holds a dot segment', () => {
  assert.equal(parseRunMessage(message({ ref: '..' })), null);
  assert.equal(parseRunMessage(message({ ref: '../secrets' })), null);
  assert.equal(parseRunMessage(message({ ref: 'epic/..' })), null);
  assert.equal(parseRunMessage(message({ ref: '.' })), null);
  assert.equal(parseRunMessage(message({ ref: './demo' })), null);
});

test('parseRunMessage keeps a dot inside a segment, which is not a dot segment', () => {
  const parsed = parseRunMessage(message({ ref: 'v1.2.3' }));
  assert.ok(parsed !== null);
  assert.equal(parsed.text, '/continue-feature v1.2.3');
});

test('parseRunMessage rejects a reference that holds a space', () => {
  assert.equal(parseRunMessage(message({ ref: 'my feature' })), null);
  assert.equal(parseRunMessage(message({ ref: ' demo' })), null);
  assert.equal(parseRunMessage(message({ ref: 'demo ' })), null);
  assert.equal(parseRunMessage(message({ ref: 'demo; rm -rf /' })), null);
});

test('parseRunMessage rejects a reference that holds two slashes', () => {
  assert.equal(parseRunMessage(message({ ref: 'epic/feature/extra' })), null);
  assert.equal(parseRunMessage(message({ ref: '/leading' })), null);
  assert.equal(parseRunMessage(message({ ref: 'trailing/' })), null);
  assert.equal(parseRunMessage(message({ ref: 'a//b' })), null);
});

test('parseRunMessage rejects an empty, a long, and a non-string reference', () => {
  assert.equal(parseRunMessage(message({ ref: '' })), null);
  assert.equal(parseRunMessage(message({ ref: 'a'.repeat(65) })), null);
  assert.equal(parseRunMessage(message({ ref: `${'a'.repeat(65)}/b` })), null);
  assert.equal(parseRunMessage(message({ ref: 7 })), null);
  assert.equal(parseRunMessage(message({ ref: undefined })), null);
});

test('parseRunMessage rejects a reference that holds a newline', () => {
  assert.equal(parseRunMessage(message({ ref: 'demo\nrm -rf /' })), null);
  assert.equal(parseRunMessage(message({ ref: 'demo\n' })), null);
});

test('parseRunMessage accepts the longest allowed reference', () => {
  const ref = `${'a'.repeat(64)}/${'b'.repeat(64)}`;
  const parsed = parseRunMessage(message({ ref }));
  assert.ok(parsed !== null);
  assert.equal(parsed.text, `/continue-feature ${ref}`);
});

test('parseRunMessage carries no field of the message other than the command and the reference', () => {
  const parsed = parseRunMessage(message({ project: 'other', extra: 'ignored' }));
  assert.deepEqual(Object.keys(parsed).sort(), ['command', 'ref', 'text']);
});

test('REF_PATTERN holds no global flag, so a repeated test stays stable', () => {
  assert.equal(REF_PATTERN.global, false);
  assert.equal(REF_PATTERN.test('demo'), true);
  assert.equal(REF_PATTERN.test('demo'), true);
});

// ─────────────────────────────────────────────────────────────────────────
// The drift test: this module against web/src/frontend/runner.ts
// ─────────────────────────────────────────────────────────────────────────

/**
 * The web package owns the button side of the protocol, and this module owns
 * the client side. The two lists must stay equal. The test reads the web
 * source as text, so it needs no TypeScript toolchain and no build output.
 */
const DRIFT_SKIP = fs.existsSync(RUNNER_SOURCE)
  ? false
  : 'web/src/frontend/runner.ts is absent. The drift test needs the web package source, '
    + 'which Phase 1 of the dsh-web-panel feature wrote.';

/** Read the string members of one exported array literal of `runner.ts`. */
function readCommandList(source, exportName) {
  const start = source.indexOf(`${exportName} = [`);
  assert.notEqual(start, -1, `web/src/frontend/runner.ts must export ${exportName}`);
  const open = source.indexOf('[', start);
  const close = source.indexOf(']', open);
  assert.notEqual(close, -1, `${exportName} must be one array literal`);
  return [...source.slice(open, close).matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

/** Read one exported string constant of `runner.ts`. */
function readStringConstant(source, exportName) {
  const match = new RegExp(`${exportName}\\s*=\\s*"([^"]+)"`).exec(source);
  assert.notEqual(match, null, `web/src/frontend/runner.ts must export ${exportName}`);
  return match[1];
}

test('the message constants match web/src/frontend/runner.ts', { skip: DRIFT_SKIP }, () => {
  const source = fs.readFileSync(RUNNER_SOURCE, 'utf8');
  assert.equal(
    readStringConstant(source, 'BEAST_RUN_MESSAGE_TYPE'),
    MESSAGE_TYPE,
    'the message type drifted. Change dsh/lib/run-protocol.js and web/src/frontend/runner.ts together.',
  );
  assert.equal(
    readStringConstant(source, 'BEAST_RUN_MESSAGE_SOURCE'),
    MESSAGE_SOURCE,
    'the message source drifted. Change dsh/lib/run-protocol.js and web/src/frontend/runner.ts together.',
  );
});

test('the ten command names match web/src/frontend/runner.ts', { skip: DRIFT_SKIP }, () => {
  const source = fs.readFileSync(RUNNER_SOURCE, 'utf8');
  assert.deepEqual(
    readCommandList(source, 'BEAST_FEATURE_COMMANDS'),
    [...FEATURE_COMMANDS],
    'the feature command list drifted. Change dsh/lib/run-protocol.js and web/src/frontend/runner.ts together.',
  );
  assert.deepEqual(
    readCommandList(source, 'BEAST_EPIC_COMMANDS'),
    [...EPIC_COMMANDS],
    'the epic command list drifted. Change dsh/lib/run-protocol.js and web/src/frontend/runner.ts together.',
  );
});
