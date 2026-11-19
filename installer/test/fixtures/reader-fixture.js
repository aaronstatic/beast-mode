// installer/test/fixtures/reader-fixture.js
//
// A test double for the token reader contract of installer/readers/index.js.
// It returns the sessions of reader-sessions.json, and it records every call,
// so a test asserts the values the core passed to a reader.
//
// The fixture carries the neutral harness id "zeta". No shipped file names
// it, and installer/readers/ registers it in no run. A test injects it into
// tokens.collect() through the getReader parameter.
//
// The seven fixture sessions cover the whole flag surface: a parent with no
// flag, a subagent with 101 steps, a subagent with 100 steps, a subagent
// with 320k final prompt tokens, a parent with 300001 final prompt tokens, a
// parent with exactly 300000 final prompt tokens, and a session with zero
// prompt tokens.

import fs from 'node:fs';
import path from 'node:path';

const SESSION_FILE = path.join(import.meta.dirname, 'reader-sessions.json');

/** The env value that makes available() report "ok: false". */
export const UNAVAILABLE_ENV = 'FIXTURE_READER_UNAVAILABLE';

/** The reason line of the unavailable answer. */
export const UNAVAILABLE_REASON = 'The fixture harness wrote no session log.';

/** The fix line of the unavailable answer. */
export const UNAVAILABLE_FIX = 'Run the fixture harness one time, then run the report again.';

/** The harness id of this reader. */
export const id = 'zeta';

/** The context object of every read() call, in call order. */
export const calls = [];

/** Forget every recorded call. A test calls this before it collects. */
export function reset() {
  calls.length = 0;
}

/**
 * The parsed fixture sessions. A test builds its expected values from the
 * same file the reader returns.
 *
 * @returns {Record<string, any>[]}
 */
export function loadSessions() {
  return JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
}

/**
 * The availability check of the contract. The env value UNAVAILABLE_ENV
 * turns the answer into "ok: false", so one test drives the unavailable
 * branch through the real contract shape.
 *
 * @param {{ env?: Record<string, string | undefined> }} [ctx]
 * @returns {{ ok: true } | { ok: false, reason: string, fix: string }}
 */
export function available({ env = {} } = {}) {
  if (env[UNAVAILABLE_ENV] === '1') {
    return { ok: false, reason: UNAVAILABLE_REASON, fix: UNAVAILABLE_FIX };
  }
  return { ok: true };
}

/**
 * The read step of the contract. It returns every fixture session and one
 * note. It adds no flag, it does no format work, and it prints nothing.
 *
 * @param {{ projectRoot?: string, days?: number | null, env?: Record<string, string | undefined> }} [ctx]
 * @returns {{ sessions: Record<string, any>[], notes: string[] }}
 */
export function read(ctx = {}) {
  calls.push(ctx);
  const sessions = loadSessions();
  return { sessions, notes: [`The fixture reader read ${sessions.length} sessions.`] };
}

export default { id, available, read };
