// installer/lib/transcript.js
//
// The transcript core of "beast-mode transcript": the step check, the merge
// and the step numbers, the cut, the relative file path, the collect pass,
// the file renderer, and the summary renderer. Each rule lives in this file
// alone, so one step number names the same moment on every harness.
//
// collectTranscript() is the one function that reaches a session log, and it
// reaches it through the injected reader registry. A test therefore passes a
// fixture reader, and this file needs no real harness. The renderers return
// lines, and no function here writes a file: bin/beast-mode.js writes the
// transcript file.
//
// This file names no harness and no harness path. A harness id always
// arrives as data, from the "id" field of a reader.

import fs from 'node:fs';
import path from 'node:path';

import { SourceInvalidError } from './errors.js';

/** The nine step kinds of the transcript contract, in the order of the kinds table. */
export const STEP_KINDS = Object.freeze([
  'user',
  'ask',
  'read',
  'write',
  'edit',
  'shell',
  'search',
  'delegate',
  'other',
]);

/** The longest text and the longest error of one step, in characters. */
export const CUT_LIMIT = 300;

/** The banner of the summary lines. */
export const SUMMARY_TITLE = '📜 BEAST MODE SESSION TRANSCRIPT';

/** The agent label of a step of the named session. */
export const MAIN_LABEL = 'main';

/** The length of the agent label of a subagent. */
const LABEL_LENGTH = 8;

/** The mark at the end of a cut text. */
const CUT_MARK = '...';

/**
 * Every character that a step line must not hold: CR LF, each C0 control
 * character except the tab (LF, CR, VT, FF, and NUL among them), DEL, NEL,
 * LS, and PS. A NUL makes grep read the file as binary. The pattern names
 * each code point with an escape.
 */
const LINE_BREAKS = /\r\n|[\u0000-\u0008\u000A-\u001F\u007F\u0085\u{2028}\u{2029}]/gu;

/** A character of a session id that a file name keeps. Every other character becomes "-". */
const FILE_NAME_UNSAFE = /[^A-Za-z0-9._-]/g;

/**
 * The note of a reader for an id prefix that names two or more sessions. The
 * reader writes the exact text, and the core then prints no no-match line.
 */
const AMBIGUOUS_NOTE = /^The id ".*" matches more than one session: /;

/** The line of a run with no id and no transcript. */
export const NO_SESSION_NOTE = 'No session log of this project was found.';

/**
 * @typedef {import('../readers/index.js').Reader} Reader
 * @typedef {import('../readers/index.js').RawStep} RawStep
 * @typedef {import('../readers/index.js').RawTranscript} RawTranscript
 */

/**
 * One line of the message set. The caller chooses the stream and the mark.
 *
 * @typedef {{ level: 'info' | 'warn', text: string }} Note
 */

/**
 * One numbered step of the merged list.
 *
 * @typedef {Object} TranscriptStep
 * @property {number} n The step number, from 1.
 * @property {string | null} at ISO 8601, or null.
 * @property {string} agent The id of the agent of the step.
 * @property {string} label "main" for the named session, or the first 8 characters of the agent id.
 * @property {RawStep['kind']} kind
 * @property {string | null} tool
 * @property {string | null} file Relative to the project root when the file sits inside it.
 * @property {string} text Cut to CUT_LIMIT characters, with no line break.
 * @property {string | null} error Cut to CUT_LIMIT characters, with no line break, or null.
 */

/**
 * One agent of the transcript, with its step count and the number of its
 * first step.
 *
 * @typedef {{ id: string, label: string, steps: number, firstStep: number | null }} TranscriptAgent
 */

/**
 * The transcript of one session, as the renderers read it.
 *
 * @typedef {Object} Transcript
 * @property {string} harness The id of the reader that answered.
 * @property {string} id
 * @property {'parent' | 'subagent'} kind
 * @property {string | null} parent
 * @property {string | null} created
 * @property {string | null} writtenAt
 * @property {TranscriptAgent[]} agents The named session first, then each subagent of the answer.
 * @property {TranscriptStep[]} steps The merged steps, in step number order.
 * @property {string[]} features The feature paths that featurePaths() names for the steps.
 * @property {{ steps: number, users: number, errors: number, subagents: number }} counts
 */

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// The step check
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Build the refusal of one bad step field. The message names the field,
 * because the field name is the one fact the author of the reader needs.
 *
 * @param {string} field
 * @param {{ harness: string, agent: string, position: number }} where
 * @param {string} detail What the field holds now.
 * @returns {SourceInvalidError}
 */
function refuseStep(field, where, detail) {
  return new SourceInvalidError(
    `A transcript reader returned a step with a bad "${field}" field.`,
    `The reader of the harness "${where.harness}" returned step ${where.position} of the agent "${where.agent}", and the "${field}" field ${detail}.`,
    'A transcript reader must return every field of the RawStep shape of installer/readers/index.js. ' +
      'Report the defect to the author of the reader.'
  );
}

/**
 * Build the refusal of one bad field of the answer of transcript().
 *
 * @param {string} field
 * @param {string} harness
 * @param {string} detail What the field holds now.
 * @returns {SourceInvalidError}
 */
function refuseAnswer(field, harness, detail) {
  return new SourceInvalidError(
    `A transcript reader returned an answer with a bad "${field}" field.`,
    `The reader of the harness "${harness}" returned an answer, and the "${field}" field ${detail}.`,
    'A transcript reader must return the RawTranscript shape of installer/readers/index.js, or null. ' +
      'Report the defect to the author of the reader.'
  );
}

/**
 * Whether one value is a time that the core can read: ISO 8601 text that
 * Date.parse() accepts.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
function isTime(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

/**
 * Check one raw step, and return it in the canonical shape.
 *
 * The check refuses a bad "kind", a "text" that is not a string, and a bad
 * "at", "tool", "file", or "error", in that order, and it names the field.
 * "at" holds a time that Date.parse() reads, or null.
 *
 * @param {unknown} step The raw step of a reader.
 * @param {{ harness: string, agent: string, position: number }} where The harness id, the agent id, and the one-based position in the agent list.
 * @returns {RawStep} A new object with the six fields.
 */
export function validateStep(step, where) {
  if (!step || typeof step !== 'object' || Array.isArray(step)) {
    throw refuseStep('step', where, 'holds no object');
  }

  const raw = /** @type {Record<string, unknown>} */ (step);

  if (!STEP_KINDS.includes(/** @type {any} */ (raw.kind))) {
    throw refuseStep('kind', where, `holds none of the kinds ${STEP_KINDS.join(', ')}`);
  }
  if (typeof raw.text !== 'string') {
    throw refuseStep('text', where, 'holds no text');
  }
  if (raw.at !== null && !isTime(raw.at)) {
    throw refuseStep('at', where, 'holds no ISO 8601 text and no null');
  }
  if (raw.tool !== null && typeof raw.tool !== 'string') {
    throw refuseStep('tool', where, 'holds no text and no null');
  }
  if (raw.file !== null && typeof raw.file !== 'string') {
    throw refuseStep('file', where, 'holds no text and no null');
  }
  if (raw.error !== null && typeof raw.error !== 'string') {
    throw refuseStep('error', where, 'holds no text and no null');
  }

  return {
    at: /** @type {string | null} */ (raw.at),
    kind: /** @type {RawStep['kind']} */ (raw.kind),
    tool: /** @type {string | null} */ (raw.tool),
    file: /** @type {string | null} */ (raw.file),
    text: raw.text,
    error: /** @type {string | null} */ (raw.error),
  };
}

/**
 * Check one raw transcript of one reader, and every step of it.
 *
 * The optional "current" field holds a boolean, or it is absent. A field
 * that holds undefined counts as absent. The canonical shape always holds
 * the field, and an absent field becomes false.
 *
 * @param {unknown} value
 * @param {string} harness
 * @returns {RawTranscript} A new object in the canonical shape.
 */
export function validateTranscript(value, harness) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw refuseAnswer('transcript', harness, 'holds no object and no null');
  }

  const raw = /** @type {Record<string, unknown>} */ (value);

  if (typeof raw.id !== 'string' || raw.id === '') {
    throw refuseAnswer('id', harness, 'holds no text');
  }
  if (raw.kind !== 'parent' && raw.kind !== 'subagent') {
    throw refuseAnswer('kind', harness, 'holds no "parent" value and no "subagent" value');
  }
  if (raw.parent !== null && typeof raw.parent !== 'string') {
    throw refuseAnswer('parent', harness, 'holds no text and no null');
  }
  if (raw.created !== null && typeof raw.created !== 'string') {
    throw refuseAnswer('created', harness, 'holds no ISO 8601 text and no null');
  }
  if (raw.writtenAt !== null && typeof raw.writtenAt !== 'string') {
    throw refuseAnswer('writtenAt', harness, 'holds no ISO 8601 text and no null');
  }
  if (raw.current !== undefined && typeof raw.current !== 'boolean') {
    throw refuseAnswer('current', harness, 'holds no boolean');
  }
  if (!Array.isArray(raw.agents) || raw.agents.length === 0) {
    throw refuseAnswer('agents', harness, 'holds no list that starts with the named session');
  }

  const agents = raw.agents.map((agent, index) => {
    if (!agent || typeof agent !== 'object' || typeof agent.id !== 'string' || agent.id === '') {
      throw refuseAnswer('agents', harness, `holds agent ${index + 1} with no id`);
    }
    if (!Array.isArray(agent.steps)) {
      throw refuseAnswer('agents', harness, `holds the agent "${agent.id}" with no step list`);
    }
    return {
      id: /** @type {string} */ (agent.id),
      steps: agent.steps.map((step, position) =>
        validateStep(step, { harness, agent: agent.id, position: position + 1 })
      ),
    };
  });

  return {
    id: raw.id,
    kind: raw.kind,
    parent: /** @type {string | null} */ (raw.parent),
    created: /** @type {string | null} */ (raw.created),
    writtenAt: /** @type {string | null} */ (raw.writtenAt),
    agents,
    current: raw.current === true,
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// The merge, the cut, and the file path
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Merge the step lists of every agent in time order.
 *
 * Each list keeps its own log order. The sort key of a step is the latest
 * time of the steps up to it in its own list, so a step with no time, and a
 * step with a time earlier than the step before it, both stay after the step
 * before it. A first step with no time takes the time of the next step of its
 * list, and a list with no time at all sorts after every timed step. A tie
 * keeps the named session first, then the agent order of the answer.
 *
 * @param {{ id: string, steps: RawStep[] }[]} agents The named session first.
 * @returns {{ agentIndex: number, step: RawStep }[]} The merged steps, in step order.
 */
export function mergeSteps(agents) {
  /** @type {{ key: number, agentIndex: number, position: number, step: RawStep }[]} */
  const entries = [];

  agents.forEach((agent, agentIndex) => {
    const times = agent.steps.map((step) => {
      const at = step.at === null ? Number.NaN : Date.parse(step.at);
      return Number.isNaN(at) ? null : at;
    });
    const firstTime = times.find((time) => time !== null);
    let key = firstTime === undefined || firstTime === null ? Infinity : firstTime;

    agent.steps.forEach((step, position) => {
      const time = times[position];
      if (time !== null && time > key) key = time;
      entries.push({ key, agentIndex, position, step });
    });
  });

  entries.sort((a, b) => {
    if (a.key !== b.key) return a.key < b.key ? -1 : 1;
    if (a.agentIndex !== b.agentIndex) return a.agentIndex - b.agentIndex;
    return a.position - b.position;
  });

  return entries.map(({ agentIndex, step }) => ({ agentIndex, step }));
}

/**
 * Cut one text or one error to a limit. Each line break becomes a space, the
 * text loses its outer white space, and a cut ends with "...". A cut keeps a
 * surrogate pair whole.
 *
 * @param {string} value
 * @param {number} [limit] Defaults to CUT_LIMIT.
 * @returns {string}
 */
export function cutText(value, limit = CUT_LIMIT) {
  const flat = String(value).replace(LINE_BREAKS, ' ').trim();
  if (flat.length <= limit) return flat;
  let end = limit - CUT_MARK.length;
  const code = flat.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end -= 1;
  return `${flat.slice(0, end)}${CUT_MARK}`;
}

/**
 * The roots of one project: the resolved path, and the real path when it
 * differs. A file inside either root becomes a relative path.
 *
 * @param {string} projectRoot
 * @returns {string[]}
 */
export function projectRoots(projectRoot) {
  const roots = [path.resolve(projectRoot)];
  try {
    const real = fs.realpathSync(roots[0]);
    if (!roots.includes(real)) roots.push(real);
  } catch {
    // The project root does not exist here. The resolved root stays alone.
  }
  return roots;
}

/**
 * The file of one step: a path relative to the project root for a file
 * inside it, and the path of the log for every other file.
 *
 * @param {string} file The file as the log names it.
 * @param {string[]} roots The roots of projectRoots().
 * @returns {string}
 */
export function relativeFile(file, roots) {
  if (!path.isAbsolute(file)) return file;
  for (const root of roots) {
    const relative = path.relative(root, file);
    if (relative === '') return '.';
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      continue;
    }
    return relative;
  }
  return file;
}

/**
 * The agent label of one agent: "main" for the named session, and the first
 * 8 characters of the id for a subagent.
 *
 * @param {number} agentIndex
 * @param {string} id
 * @returns {string}
 */
function agentLabel(agentIndex, id) {
  return agentIndex === 0 ? MAIN_LABEL : id.slice(0, LABEL_LENGTH);
}

/**
 * Build the transcript of one checked answer: merge the step lists, number
 * the steps from 1, cut each text and each error, and make each file path
 * relative to the project root.
 *
 * @param {RawTranscript} raw A transcript that validateTranscript() returned.
 * @param {{ harness: string, projectRoot: string }} where
 * @returns {Transcript}
 */
export function buildTranscript(raw, { harness, projectRoot }) {
  const roots = projectRoots(projectRoot);
  /** @type {(number | null)[]} */
  const firstSteps = raw.agents.map(() => null);
  const stepCounts = raw.agents.map(() => 0);
  // Only the typed messages of the named session count. A subagent prompt stays a step.
  let users = 0;
  let errors = 0;

  const steps = mergeSteps(raw.agents).map(({ agentIndex, step }, index) => {
    const n = index + 1;
    if (agentIndex === 0 && step.kind === 'user') users += 1;
    if (step.error !== null) errors += 1;
    const agent = raw.agents[agentIndex];
    if (firstSteps[agentIndex] === null) firstSteps[agentIndex] = n;
    stepCounts[agentIndex] += 1;

    return {
      n,
      at: step.at,
      agent: agent.id,
      label: agentLabel(agentIndex, agent.id),
      kind: step.kind,
      tool: step.tool,
      file: step.file === null ? null : relativeFile(step.file, roots),
      text: cutText(step.text),
      error: step.error === null ? null : cutText(step.error),
    };
  });

  return {
    harness,
    id: raw.id,
    kind: raw.kind,
    parent: raw.parent,
    created: raw.created,
    writtenAt: raw.writtenAt,
    agents: raw.agents.map((agent, index) => ({
      id: agent.id,
      label: agentLabel(index, agent.id),
      steps: stepCounts[index],
      firstStep: firstSteps[index],
    })),
    steps,
    features: featurePaths(steps),
    counts: {
      steps: steps.length,
      users,
      errors,
      subagents: raw.agents.length - 1,
    },
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// The collect pass
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * The line of a run with an id and no transcript.
 *
 * @param {string} id
 * @returns {string}
 */
export function noMatchNote(id) {
  return `No session log of this project matches "${id}". Run "beast-mode tokens" to list the session ids.`;
}

/**
 * The time of one "writtenAt" value in milliseconds. A null value and a
 * value that does not parse sort before every time.
 *
 * @param {string | null} value
 * @returns {number}
 */
function writtenMs(value) {
  if (value === null) return -Infinity;
  const at = Date.parse(value);
  return Number.isNaN(at) ? -Infinity : at;
}

/**
 * Ask every reader of the registry that holds transcript() for one session,
 * and return the transcript and the message set.
 *
 * A reader with no transcript member is skipped. A reader whose available()
 * reports "ok: false" adds an information note only when no reader returns
 * a transcript. A reader that throws becomes one warning note, because a
 * report must never fail its caller. The shape check runs outside that
 * guard, so a reader that breaks the shape still raises a named error.
 *
 * With an id, the first answer in registry order wins, a note names each
 * later answer, and the "current" field changes nothing. With no id, an
 * answer with "current: true" wins over every answer without it, because a
 * live window of another harness keeps the modification time of its own log
 * new. Inside the answers with "current: true", or inside all answers when
 * none holds it, the latest "writtenAt" wins, and the first answer wins a tie.
 *
 * @param {{
 *   readers: Record<string, Reader>,
 *   projectRoot: string,
 *   sessionId?: string | null,
 *   env?: Record<string, string | undefined>,
 * }} args
 * @returns {{ transcript: Transcript | null, notes: Note[] }}
 */
export function collectTranscript({ readers, projectRoot, sessionId = null, env = process.env }) {
  const id = typeof sessionId === 'string' && sessionId.trim() !== '' ? sessionId.trim() : null;
  /** @type {Note[]} */
  const notes = [];
  /** @type {Note[]} The notes of the readers that cannot run. */
  const idle = [];
  /** @type {{ harness: string, raw: RawTranscript }[]} */
  const answers = [];

  for (const [key, reader] of Object.entries(readers ?? {})) {
    if (!reader || typeof reader.transcript !== 'function') continue;
    const harness = typeof reader.id === 'string' && reader.id !== '' ? reader.id : key;

    /** @type {unknown} */
    let result;
    try {
      const availability = reader.available({ env });
      if (!availability || !availability.ok) {
        const reason = availability && !availability.ok ? availability.reason : '';
        const fix = availability && !availability.ok ? availability.fix : '';
        idle.push({
          level: 'info',
          text: `The reader of the harness "${harness}" cannot run. ${reason} ${fix}`.trim(),
        });
        continue;
      }
      result = reader.transcript({ projectRoot, sessionId: id, env });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      notes.push({
        level: 'warn',
        text: `The transcript reader of the harness "${harness}" cannot run. ${reason} Report the defect to the author of the reader.`,
      });
      continue;
    }

    if (!result || typeof result !== 'object' || !('transcript' in result)) {
      throw refuseAnswer('transcript', harness, 'is missing from the answer of transcript()');
    }
    const answer = /** @type {{ transcript: unknown, notes?: unknown }} */ (result);

    if (Array.isArray(answer.notes)) {
      for (const note of answer.notes) notes.push({ level: 'info', text: String(note) });
    }
    if (answer.transcript !== null) {
      answers.push({ harness, raw: validateTranscript(answer.transcript, harness) });
    }
  }

  /** @type {{ harness: string, raw: RawTranscript } | null} */
  let winner = null;
  if (id !== null) {
    winner = answers[0] ?? null;
    for (const other of answers.slice(1)) {
      notes.push({
        level: 'info',
        text:
          `The harness "${other.harness}" also holds a session that matches "${id}": ${other.raw.id}. ` +
          `This transcript reads the session of the harness "${winner?.harness}".`,
      });
    }
  } else {
    // The current session of a harness wins over every answer without that
    // mark. The latest writtenAt decides inside the group.
    const current = answers.filter((answer) => answer.raw.current === true);
    for (const answer of current.length > 0 ? current : answers) {
      if (winner === null || writtenMs(answer.raw.writtenAt) > writtenMs(winner.raw.writtenAt)) {
        winner = answer;
      }
    }
  }

  if (winner === null) {
    notes.push(...idle);
    if (id === null) {
      notes.push({ level: 'info', text: NO_SESSION_NOTE });
    } else if (!notes.some((note) => AMBIGUOUS_NOTE.test(note.text))) {
      notes.push({ level: 'info', text: noMatchNote(id) });
    }
    return { transcript: null, notes };
  }

  return {
    transcript: buildTranscript(winner.raw, { harness: winner.harness, projectRoot }),
    notes,
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// The file and the summary
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Print one time as "YYYY-MM-DD HH:MM UTC", or "unknown".
 *
 * @param {string | null | undefined} value
 * @returns {string}
 */
export function formatStamp(value) {
  const at = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  if (Number.isNaN(at)) return 'unknown';
  return `${new Date(at).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

/**
 * Print the time of one step as "HH:MM" in UTC, or "--:--".
 *
 * @param {string | null | undefined} value
 * @returns {string}
 */
export function formatTime(value) {
  const at = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  if (Number.isNaN(at)) return '--:--';
  return new Date(at).toISOString().slice(11, 16);
}

/**
 * The file name of the transcript of one session: "<id>.txt". A character
 * of the id outside A-Z, a-z, 0-9, ".", "_", and "-" becomes "-".
 *
 * @param {string} id
 * @returns {string}
 */
export function transcriptFileName(id) {
  return `${String(id).replace(FILE_NAME_UNSAFE, '-')}.txt`;
}

/**
 * One field of a step line with no line break. An empty field prints "-".
 *
 * @param {string | null} value
 * @returns {string}
 */
function field(value) {
  if (value === null) return '-';
  const flat = value.replace(LINE_BREAKS, ' ');
  return flat === '' ? '-' : flat;
}

/**
 * One step line: "<n> <HH:MM> <agent> <kind> <tool> <file> | <text>", then
 * " | error: <error>" for a failed step. The tool, the file, and an empty
 * text print "-". A step with no time prints "--:--".
 *
 * @param {TranscriptStep} step
 * @returns {string}
 */
export function renderStep(step) {
  const head = `${step.n} ${formatTime(step.at)} ${step.label} ${step.kind} ${field(step.tool)} ${field(step.file)}`;
  const error = step.error === null ? '' : ` | error: ${field(step.error)}`;
  return `${head} | ${field(step.text)}${error}`;
}

/** The most feature paths that a transcript names. */
export const FEATURE_LIMIT = 3;

const FEATURE_DOC = /^docs\/features\/(.+)\/(?:implementation|context|tasks|inbox|requirements)\.md$/;
const BRIEF_DOC = /^\.beast-mode\/briefs\/(.+)\/[^/]+\.md$/;
const REVIEW_SESSION_BRIEFS = 'review-session';
const BACKSLASH = /\\/g;

/**
 * The feature path that one file names, or null. A file that matches
 * "docs/features/<path>/<name>.md" names <path> when <name> is
 * implementation, context, tasks, inbox, or requirements. A file that
 * matches ".beast-mode/briefs/<path>/<name>.md" names <path>, apart from
 * the folder ".beast-mode/briefs/review-session/".
 *
 * @param {string} file A path relative to the project root.
 * @returns {string | null}
 */
export function featurePathOf(file) {
  const flat = file.replace(BACKSLASH, '/');
  const doc = FEATURE_DOC.exec(flat);
  if (doc) return doc[1];
  const brief = BRIEF_DOC.exec(flat);
  if (brief) {
    const dir = brief[1];
    if (dir === REVIEW_SESSION_BRIEFS || dir.startsWith(`${REVIEW_SESSION_BRIEFS}/`)) return null;
    return dir;
  }
  return null;
}

/**
 * The feature paths that the read, write, and edit steps of a transcript
 * name. At most three, by the count of steps that name each path, then by
 * the first step that names it.
 *
 * @param {TranscriptStep[]} steps
 * @returns {string[]}
 */
export function featurePaths(steps) {
  /** @type {Map<string, { count: number, first: number }>} */
  const found = new Map();
  steps.forEach((step, index) => {
    if (step.kind !== 'read' && step.kind !== 'write' && step.kind !== 'edit') return;
    if (step.file === null) return;
    const featurePath = featurePathOf(step.file);
    if (featurePath === null) return;
    const entry = found.get(featurePath);
    if (entry) entry.count += 1;
    else found.set(featurePath, { count: 1, first: index });
  });
  return [...found.entries()]
    .sort((a, b) => b[1].count - a[1].count || a[1].first - b[1].first)
    .slice(0, FEATURE_LIMIT)
    .map(([featurePath]) => featurePath);
}

/**
 * The subagents of a transcript, in the order of their first step. A
 * subagent with no step comes last, in the agent order of the answer.
 *
 * @param {Transcript} transcript
 * @returns {TranscriptAgent[]}
 */
function subagentsByFirstStep(transcript) {
  return transcript.agents.slice(1).sort((a, b) => {
    const left = a.firstStep ?? Infinity;
    const right = b.firstStep ?? Infinity;
    return left === right ? 0 : left < right ? -1 : 1;
  });
}

/**
 * Render the transcript file. Returns lines, so a test asserts the text with
 * no file. The caller joins the lines with a line break.
 *
 * @param {Transcript} transcript
 * @returns {string[]}
 */
export function renderFile(transcript) {
  const counts = transcript.counts;
  const lines = [
    `# Transcript of session ${transcript.id}`,
    `Harness: ${transcript.harness}. Kind: ${transcript.kind}. ` +
      `Started: ${formatStamp(transcript.created)}. Last write: ${formatStamp(transcript.writtenAt)}.`,
    `Steps: ${counts.steps}. User messages: ${counts.users}. Errors: ${counts.errors}. Subagents: ${counts.subagents}.`,
  ];

  for (const agent of subagentsByFirstStep(transcript)) {
    lines.push(
      `Agent ${agent.label}: ${agent.id}, ${agent.steps} steps, first step ${agent.firstStep ?? '-'}.`
    );
  }

  const features = transcript.features;
  if (features.length > 0) lines.push(`Features: ${features.join(', ')}.`);

  lines.push(
    'Times are UTC. One line for each step: the number, the time, the agent, the kind, the tool, the file, the text, and the error.'
  );
  lines.push('');
  for (const step of transcript.steps) lines.push(renderStep(step));

  return lines;
}

/**
 * Render the summary lines that follow the banner. A run with no transcript
 * gives the plugin version and the project alone. "Transcript:" appears only
 * when the caller wrote the file.
 *
 * @param {{ version: string, projectRoot: string, transcript: Transcript | null, file?: string | null }} args
 * @returns {string[]}
 */
export function renderSummary({ version, projectRoot, transcript, file = null }) {
  const lines = [`Plugin version:  ${version}`, `Project:         ${projectRoot}`];
  if (!transcript) return lines;

  const counts = transcript.counts;
  lines.push(
    `Session:         ${transcript.id} (${transcript.harness}, ${transcript.kind}, started ${formatStamp(transcript.created)})`
  );
  lines.push(
    `Steps:           ${counts.steps} (${counts.users} user messages, ${counts.errors} errors, ${counts.subagents} subagents)`
  );

  const features = transcript.features;
  if (features.length > 0) lines.push(`Features:        ${features.join(', ')}`);

  if (file) lines.push(`Transcript:      ${file}`);
  return lines;
}
