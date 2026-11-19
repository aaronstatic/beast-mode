// installer/readers/index.js
//
// The token reader registry, keyed by CLI harness id. It mirrors
// installer/adapters/index.js: one registry object, one lookup function, and
// the whole interface in the JSDoc above them. A harness owner adds a reader
// with one import and one registry line, and changes no file under
// installer/lib/.
//
// The registry holds both readers, "claude" and "dsh". "beast-mode tokens"
// reports "missing" for every other installed harness, and it exits 0.
// "beast-mode transcript" asks every reader that holds the optional
// transcript() member, and it skips a reader that holds none.

import claude from './claude.js';
import dsh from './dsh.js';

/**
 * One session of one harness, as a reader returns it. The nine required
 * fields carry every number of the report. The two optional fields carry a
 * value that one harness holds and another harness does not.
 *
 * lib/tokens.js refuses a session with a missing field, and it names the
 * field. The core adds "flags", "cacheShare", and "harness". A reader adds
 * none of the three, a reader does no format work, and a reader prints
 * nothing.
 *
 * @typedef {Object} Session
 * @property {string} id The session id, or the subagent id.
 * @property {'parent' | 'subagent'} kind The session kind.
 * @property {string | null} parent The parent session id of a subagent, or null.
 * @property {string} model The model of most steps.
 * @property {number} steps The count of assistant requests.
 * @property {number} finalPromptTokens The prompt size of the last step.
 * @property {number} promptTokens The sum of the prompt size over every step.
 * @property {number} cacheReadTokens The cached part of promptTokens.
 * @property {number} outputTokens The sum of the output tokens.
 * @property {string | null} [created] An ISO 8601 timestamp. Optional.
 * @property {number | null} [costUsd] The cost in US dollars, or null. Optional.
 */

/**
 * The answer of the availability check of one reader. A reader reports
 * "ok: false" when it cannot read its session log, for example when the log
 * directory is absent. The report then prints the reason and the fix on one
 * warning line, and it still exits 0.
 *
 * @typedef {{ ok: true } | { ok: false, reason: string, fix: string }} Availability
 */

/**
 * One step of one agent, and one session with the steps of its agents, as
 * the transcript() member of a reader returns them. A reader returns each
 * step list in log order. installer/lib/transcript.js checks every field,
 * merges the lists in time order, numbers the steps, cuts each text and each
 * error, and makes a file path relative to the project root. A reader does
 * none of the four.
 *
 * The text of each kind follows the kinds table of
 * docs/features/deterministic-loop/review-session/implementation.md. A
 * "delegate" step holds "<agent type>: <description>", and Claude Code adds
 * " -> <agentId>" when the result record holds one. An "other" step holds the
 * tool input as JSON, cut to 120 characters. A step holds no assistant text.
 *
 * When an id names no session, the answer holds no transcript. When an id
 * prefix names two or more sessions, the answer holds no transcript and one
 * note of the exact form 'The id "<id>" matches more than one session: <id>,
 * <id>.', with up to five ids. The core prints the line of a run with no
 * match itself, so a reader adds no note of its own for that state.
 *
 * With no id, a reader picks the session that the current-session variable
 * of its harness names, and else its newest parent log. Only a pick through
 * that variable sets "current: true" on the answer. With no id, the core
 * prefers such an answer to every answer without it, because a live window
 * of another harness keeps the modification time of its own log new.
 *
 * @typedef {Object} RawStep
 * @property {string | null} at The time of the step, ISO 8601, or null.
 * @property {'user' | 'ask' | 'read' | 'write' | 'edit' | 'shell' | 'search' | 'delegate' | 'other'} kind
 * @property {string | null} tool The harness tool name, or null for a user message.
 * @property {string | null} file The file of a read, a write, or an edit, as the log names it, or null.
 * @property {string} text
 * @property {string | null} error The text of a failed tool result, or null.
 *
 * @typedef {Object} RawTranscript
 * @property {string} id The session id, in the form that the token report prints.
 * @property {'parent' | 'subagent'} kind
 * @property {string | null} parent The parent session id of a subagent, or null.
 * @property {string | null} created ISO 8601, or null.
 * @property {string | null} writtenAt The modification time of the log, ISO 8601, or null.
 * @property {{ id: string, steps: RawStep[] }[]} agents The named session first, then each subagent. Each list is in log order.
 * @property {boolean} [current] Optional. True only when the reader picked the session through the current-session variable of its harness, with no id. A newest-log pick and an id pick leave the field out, or set it to false.
 */

/**
 * The whole reader interface of implementation.md section 3.6. A reader
 * reads a session log and it returns plain data. It writes no file, it adds
 * no flag, and it prints nothing.
 *
 * @typedef {Object} Reader
 * @property {string} id The CLI harness id. It equals the id of the adapter of the same harness.
 * @property {(ctx: { env: Record<string, string | undefined> }) => Availability} available
 *   Report whether this reader can run in this environment. Read a path. Write nothing.
 * @property {(ctx: { projectRoot: string, days: number | null, env: Record<string, string | undefined> }) => { sessions: Session[], notes: string[] }} read
 *   Return the sessions of the project at projectRoot only. The match rule
 *   belongs to the harness. "days" holds the window in days, or null for
 *   every session. Every note prints as one information line.
 * @property {(ctx: { projectRoot: string, sessionId: string | null, env: Record<string, string | undefined> }) => { transcript: RawTranscript | null, notes: string[] }} [transcript]
 *   Optional. Return the steps of one session of the project at projectRoot,
 *   with the steps of its subagents. "sessionId" holds an id, a unique id
 *   prefix, or null for the current session (the id that the harness gives, else the newest parent log).
 *   A pick through the id that the harness gives sets "current: true". Read logs. Write nothing.
 *   Never throw for a missing or a broken log. Every note prints as one
 *   information line. A reader with no transcript member still serves
 *   "beast-mode tokens", and "beast-mode transcript" skips it.
 */

/** @type {Record<string, Reader>} */
export const readers = {
  claude,
  dsh,
};

/**
 * Look one reader up by harness id.
 *
 * getAdapter() throws for an unknown id, because a run with no adapter
 * writes nothing at all. This lookup returns null instead. The token report
 * describes the state of every installed harness and it always exits 0, so a
 * harness with no reader is a normal state of the report, not an error.
 *
 * @param {string} id The CLI harness id.
 * @returns {Reader | null} Null when this plugin version ships no reader for the id.
 */
export function getReader(id) {
  return readers[id] ?? null;
}
