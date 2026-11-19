/**
 * The run protocol of the dsh web panel.
 *
 * A button in the Beast Mode dashboard posts one message to the parent
 * frame. The client plugin turns that message into one new dsh session with
 * one queued prompt. This module holds every rule of that conversion, and it
 * holds nothing else.
 *
 * Two properties make the rules safe.
 *
 * 1. The message carries no free text. The client builds the prompt text
 *    from a validated command name and a validated reference, so no frame
 *    content ever reaches an agent as raw text.
 * 2. This module names no DOM global and imports no module. `node --test`
 *    imports it directly, and every branch has a test in
 *    `dsh/test/run-protocol.test.js`.
 *
 * See implementation.md section 3.6 and Decision 9 of the dsh-web-panel
 * feature.
 *
 * @module beast-mode/dsh/run-protocol
 */

/**
 * The seven feature commands, in the button order of section 3.6. Each name
 * is bare, with no leading slash. The list matches `BEAST_FEATURE_COMMANDS`
 * in `web/src/frontend/runner.ts`, and one drift test binds the pair.
 */
export const FEATURE_COMMANDS = Object.freeze([
  'continue-feature',
  'autorun-feature',
  'update-feature',
  'review-feature',
  'evaluate-feature',
  'fix-feature',
  'document-feature',
]);

/**
 * The three epic commands, in the button order of section 3.6. The list
 * matches `BEAST_EPIC_COMMANDS` in `web/src/frontend/runner.ts`.
 */
export const EPIC_COMMANDS = Object.freeze([
  'autorun-epic',
  'update-epic',
  'review-epic',
]);

/** The whole allow list. A command outside this list never reaches a session. */
export const ALLOWED_COMMANDS = Object.freeze([...FEATURE_COMMANDS, ...EPIC_COMMANDS]);

/** The `source` field of a run message. */
export const MESSAGE_SOURCE = 'beast-mode-panel';

/** The `type` field of a run message. */
export const MESSAGE_TYPE = 'beast-mode:run';

/** The `version` field of a run message. */
export const MESSAGE_VERSION = 1;

/**
 * The accepted shape of one reference: a feature name, or an
 * `<epic>/<feature>` pair. Each segment holds 1 to 64 characters of
 * `A-Z a-z 0-9 . _ -`, and the reference holds at most one slash.
 */
export const REF_PATTERN = /^[A-Za-z0-9._-]{1,64}(\/[A-Za-z0-9._-]{1,64})?$/;

/**
 * Report whether a reference holds a dot segment.
 *
 * `REF_PATTERN` admits a `.` character inside a segment, so the segment `..`
 * passes the pattern on its own. A dot segment carries no meaning for a
 * feature reference, and it reads as a path traversal further down the
 * chain, so `parseRunMessage` rejects it with one extra check.
 * @param {string} ref - a reference that already passed `REF_PATTERN`.
 * @returns {boolean} true when any segment reads `.` or `..`.
 */
function hasDotSegment(ref) {
  return ref.split('/').some((segment) => segment === '.' || segment === '..');
}

/**
 * Report whether one message body carries the run-message envelope.
 *
 * The envelope is the `source`, the `type`, and the `version` of section
 * 3.6. A body that fails this test comes from another sender, so the client
 * ignores it with no log line. A body that passes this test but fails
 * `parseRunMessage` names a bad command or a bad reference, so the client
 * logs one warning.
 * @param {unknown} data - the `data` field of a message event.
 * @returns {boolean} true when the envelope matches.
 */
export function isRunMessageShape(data) {
  if (data === null || typeof data !== 'object') return false;
  const body = /** @type {Record<string, unknown>} */ (data);
  return body.source === MESSAGE_SOURCE
    && body.type === MESSAGE_TYPE
    && body.version === MESSAGE_VERSION;
}

/**
 * Validate one run message and build its prompt text.
 *
 * The function runs checks 3, 4, and 5 of section 3.6. The caller runs
 * checks 1 and 2 first with `isTrustedEvent`.
 * @param {unknown} data - the `data` field of a message event.
 * @returns {{command: string, ref: string, text: string} | null} the
 *   validated parts plus the prompt text, or null for a rejected message.
 */
export function parseRunMessage(data) {
  if (!isRunMessageShape(data)) return null;
  const body = /** @type {Record<string, unknown>} */ (data);

  const command = body.command;
  if (typeof command !== 'string' || !ALLOWED_COMMANDS.includes(command)) return null;

  const ref = body.ref;
  if (typeof ref !== 'string' || !REF_PATTERN.test(ref)) return null;
  if (hasDotSegment(ref)) return null;

  return { command, ref, text: `/${command} ${ref}` };
}

/**
 * Report whether one message event comes from the panel frame.
 *
 * The function runs checks 1 and 2 of section 3.6. The origin test blocks a
 * foreign page, and the source test blocks a second frame on the same
 * origin. Both values come from the caller, so this module stays free of
 * every DOM global.
 * @param {{origin?: unknown, source?: unknown} | null | undefined} event - a message event.
 * @param {{origin?: unknown, frame?: unknown} | null | undefined} expected - the
 *   page origin and the `contentWindow` of the panel frame.
 * @returns {boolean} true when both checks pass.
 */
export function isTrustedEvent(event, expected) {
  if (event === null || typeof event !== 'object') return false;
  if (expected === null || expected === undefined) return false;

  const { origin, frame } = expected;
  if (typeof origin !== 'string' || origin.length === 0) return false;
  if (frame === null || frame === undefined) return false;

  if (event.origin !== origin) return false;
  return event.source === frame;
}
