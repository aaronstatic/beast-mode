// installer/lib/tokens.js
//
// The token report core of implementation.md section 3.6: the session shape
// check, the flag logic, the derived values, the totals, the table renderer,
// and the JSON builder. Every function returns a value, and no function
// writes a file.
//
// collect() is the one function that reaches a session log, and it reaches
// it through an injected reader lookup. A test therefore passes a fixture
// reader and this file needs no real harness.
//
// This file names no harness and no harness path. A harness id always
// arrives as data, from the resolved harness set of the caller.

import { SourceInvalidError } from './errors.js';

/** A subagent over this step count carries the flag "steps-over-100". */
export const STEP_LIMIT = 100;

/** A session over this final prompt size carries the flag "final-prompt-over-300k". */
export const FINAL_PROMPT_LIMIT = 300000;

/** The schema number of the "--json" document. */
export const JSON_SCHEMA = 1;

/** The two flags of the report, in the order the core adds them. */
export const FLAG_STEPS = 'steps-over-100';
export const FLAG_FINAL_PROMPT = 'final-prompt-over-300k';

/** The five required number fields of one session, in check order. */
const NUMBER_FIELDS = [
  'steps',
  'finalPromptTokens',
  'promptTokens',
  'cacheReadTokens',
  'outputTokens',
];

/**
 * @typedef {import('../readers/index.js').Session} Session
 * @typedef {import('../readers/index.js').Reader} Reader
 */

/**
 * One session of the report: the reader session, plus the three values the
 * core adds.
 *
 * @typedef {Session & { harness: string, flags: string[], cacheShare: number | null }} ReportSession
 */

/**
 * The reader state of one installed harness. "missing" means that this
 * plugin version ships no reader for the harness. "unavailable" means that
 * the reader of the harness cannot run here, and the entry then carries the
 * reason.
 *
 * @typedef {{ id: string, reader: 'present' | 'missing' | 'unavailable', reason?: string }} HarnessState
 */

/**
 * One line of the message set. The caller chooses the stream and the mark.
 *
 * @typedef {{ level: 'info' | 'warn', text: string }} Note
 */

/**
 * The five totals of implementation.md section 3.6.
 *
 * @typedef {{ sessions: number, steps: number, promptTokens: number, outputTokens: number, subagentShare: number | null }} Totals
 */

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// The session shape check
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Build the refusal of one bad session field. The message names the field,
 * because the field name is the one fact the author of the reader needs.
 *
 * @param {string} field The name of the bad field.
 * @param {{ harness: string, position: number }} where
 * @param {string} detail What the field holds now.
 * @returns {SourceInvalidError}
 */
function refuseField(field, where, detail) {
  return new SourceInvalidError(
    `A token reader returned a session with a bad "${field}" field.`,
    `The reader of the harness "${where.harness}" returned session ${where.position}, and the "${field}" field ${detail}.`,
    'A token reader must return every field of the session shape of installer/readers/index.js. ' +
      'Report the defect to the author of the reader.'
  );
}

/**
 * Check one session of one reader, and return it in the canonical shape.
 *
 * The check refuses a missing field and a field of the wrong type, and it
 * names the field. A token count must be a finite number of zero or more. An
 * absent optional field becomes null, so every session of the report holds
 * the same keys.
 *
 * @param {unknown} session The raw session of a reader.
 * @param {{ harness: string, position: number }} where The harness id and the one-based position.
 * @returns {Session} A new object with the nine required fields and the two optional fields.
 */
export function validateSession(session, where) {
  if (!session || typeof session !== 'object' || Array.isArray(session)) {
    throw refuseField('session', where, 'holds no object');
  }

  const raw = /** @type {Record<string, unknown>} */ (session);

  if (typeof raw.id !== 'string' || raw.id.length === 0) {
    throw refuseField('id', where, 'holds no text');
  }
  if (raw.kind !== 'parent' && raw.kind !== 'subagent') {
    throw refuseField('kind', where, 'holds no "parent" value and no "subagent" value');
  }
  if (raw.parent !== null && typeof raw.parent !== 'string') {
    throw refuseField('parent', where, 'holds no text and no null');
  }
  if (typeof raw.model !== 'string' || raw.model.length === 0) {
    throw refuseField('model', where, 'holds no text');
  }
  for (const field of NUMBER_FIELDS) {
    const value = raw[field];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw refuseField(field, where, 'holds no number of zero or more');
    }
  }
  if (raw.created !== undefined && raw.created !== null && typeof raw.created !== 'string') {
    throw refuseField('created', where, 'holds no ISO 8601 text and no null');
  }
  if (raw.costUsd !== undefined && raw.costUsd !== null && typeof raw.costUsd !== 'number') {
    throw refuseField('costUsd', where, 'holds no number and no null');
  }

  return {
    id: raw.id,
    kind: raw.kind,
    parent: raw.parent,
    model: raw.model,
    steps: /** @type {number} */ (raw.steps),
    finalPromptTokens: /** @type {number} */ (raw.finalPromptTokens),
    promptTokens: /** @type {number} */ (raw.promptTokens),
    cacheReadTokens: /** @type {number} */ (raw.cacheReadTokens),
    outputTokens: /** @type {number} */ (raw.outputTokens),
    created: raw.created === undefined ? null : /** @type {string | null} */ (raw.created),
    costUsd: raw.costUsd === undefined ? null : /** @type {number | null} */ (raw.costUsd),
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// The flags and the derived values
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * The ratio of a part to a whole, rounded to four decimals. Returns null for
 * a zero denominator, and the renderer then prints "-". The two thresholds
 * of the report live in this file only, and so does this rule.
 *
 * @param {number} part
 * @param {number} whole
 * @returns {number | null}
 */
export function share(part, whole) {
  if (!whole) return null;
  return Math.round((part / whole) * 10000) / 10000;
}

/**
 * Add the "flags" array and the "cacheShare" value to one session. The core
 * owns both, and a reader adds neither.
 *
 * A subagent over STEP_LIMIT steps carries "steps-over-100". A session over
 * FINAL_PROMPT_LIMIT final prompt tokens carries "final-prompt-over-300k",
 * and the rule holds for a parent and for a subagent. Both rules compare
 * with "greater than", so a session at the limit carries no flag.
 *
 * @template {Session} T
 * @param {T} session
 * @returns {T & { flags: string[], cacheShare: number | null }}
 */
export function addFlags(session) {
  const flags = [];
  if (session.kind === 'subagent' && session.steps > STEP_LIMIT) flags.push(FLAG_STEPS);
  if (session.finalPromptTokens > FINAL_PROMPT_LIMIT) flags.push(FLAG_FINAL_PROMPT);

  return {
    ...session,
    flags,
    cacheShare: share(session.cacheReadTokens, session.promptTokens),
  };
}

/**
 * The five totals of the report: the session count, the step sum, the prompt
 * token sum, the output token sum, and the subagent share of the prompt
 * tokens. The share is null for a project with zero prompt tokens.
 *
 * @param {ReportSession[] | Session[]} sessions
 * @returns {Totals}
 */
export function totals(sessions) {
  let steps = 0;
  let promptTokens = 0;
  let outputTokens = 0;
  let subagentPromptTokens = 0;

  for (const session of sessions) {
    steps += session.steps;
    promptTokens += session.promptTokens;
    outputTokens += session.outputTokens;
    if (session.kind === 'subagent') subagentPromptTokens += session.promptTokens;
  }

  return {
    sessions: sessions.length,
    steps,
    promptTokens,
    outputTokens,
    subagentShare: share(subagentPromptTokens, promptTokens),
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// The number format and the table
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * The number format of the two reference analyzers: one million and over
 * prints as "2.40M", one thousand and over prints as "12.3k", and every
 * smaller number prints as a whole number.
 *
 * @param {number} value
 * @returns {string}
 */
export function fmt(value) {
  if (!Number.isFinite(value)) return '-';
  if (value >= 1000000) return `${(value / 1000000).toFixed(2)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return value.toFixed(0);
}

/**
 * Print a share as a whole percent. A null share prints as "-", which is the
 * zero-denominator rule of the two reference analyzers.
 *
 * @param {number | null | undefined} value
 * @returns {string}
 */
export function formatShare(value) {
  if (value === null || value === undefined) return '-';
  return `${Math.round(value * 100)}%`;
}

/**
 * Print the "created" value as the date and the minute of the ISO string.
 * The renderer runs no time zone conversion, so it stays pure and one test
 * asserts one stable line.
 *
 * @param {string | null | undefined} created
 * @returns {string}
 */
function formatCreated(created) {
  if (!created) return '-';
  return created.slice(0, 16).replace('T', ' ');
}

/**
 * The eleven columns of the table, in the order of implementation.md section
 * 3.6. A width of zero keeps the whole value and adds no padding, which the
 * last column uses.
 *
 * @type {{ head: string, width: number, align: 'left' | 'right', cell: (session: ReportSession) => string }[]}
 */
const COLUMNS = [
  { head: 'created', width: 16, align: 'left', cell: (s) => formatCreated(s.created) },
  { head: 'id', width: 14, align: 'left', cell: (s) => s.id },
  { head: 'harness', width: 8, align: 'left', cell: (s) => s.harness ?? '-' },
  { head: 'kind', width: 8, align: 'left', cell: (s) => s.kind },
  { head: 'model', width: 22, align: 'left', cell: (s) => s.model },
  { head: 'steps', width: 6, align: 'right', cell: (s) => String(s.steps) },
  { head: 'prompt', width: 9, align: 'right', cell: (s) => fmt(s.promptTokens) },
  { head: 'cached', width: 6, align: 'right', cell: (s) => formatShare(s.cacheShare) },
  { head: 'final', width: 9, align: 'right', cell: (s) => fmt(s.finalPromptTokens) },
  { head: 'output', width: 9, align: 'right', cell: (s) => fmt(s.outputTokens) },
  { head: 'flag', width: 0, align: 'left', cell: (s) => (s.flags?.length ? s.flags.join(',') : '') },
];

/**
 * Pad or clip one cell to the column width.
 *
 * @param {string} text
 * @param {number} width Zero keeps the whole text.
 * @param {'left' | 'right'} align
 * @returns {string}
 */
function padCell(text, width, align) {
  const value = String(text ?? '');
  if (width <= 0) return value;
  const clipped = value.length > width ? value.slice(0, width) : value;
  return align === 'right' ? clipped.padStart(width) : clipped.padEnd(width);
}

/**
 * Sort a copy of the sessions by "created", oldest first. A session with no
 * "created" value sorts last, and the session id breaks a tie, so two runs
 * over the same input always return the same order. The input array never
 * changes.
 *
 * @template {{ id: string, created?: string | null }} T
 * @param {T[]} sessions
 * @returns {T[]}
 */
export function sortSessions(sessions) {
  return [...sessions].sort((a, b) => {
    const left = a.created ?? '';
    const right = b.created ?? '';
    if (left !== right) {
      if (!left) return 1;
      if (!right) return -1;
      return left < right ? -1 : 1;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * Render the session table. Returns lines, so a test asserts the output with
 * no stream. The renderer sorts a copy of the input, and it appends the
 * total line when the caller passes the totals.
 *
 * @param {ReportSession[]} sessions
 * @param {Totals | null} [totalsValue] The totals. Omit it to render the table alone.
 * @returns {string[]}
 */
export function renderTable(sessions, totalsValue = null) {
  const ordered = sortSessions(sessions);
  const lines = [
    COLUMNS.map((column) => padCell(column.head, column.width, column.align))
      .join(' ')
      .trimEnd(),
  ];

  for (const session of ordered) {
    lines.push(
      COLUMNS.map((column) => padCell(column.cell(session), column.width, column.align))
        .join(' ')
        .trimEnd()
    );
  }

  if (totalsValue) {
    lines.push('');
    lines.push(
      `total sessions=${totalsValue.sessions} steps=${totalsValue.steps} ` +
        `prompt=${fmt(totalsValue.promptTokens)} output=${fmt(totalsValue.outputTokens)} ` +
        `subagents=${formatShare(totalsValue.subagentShare)} of the prompt tokens`
    );
  }

  return lines;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// The JSON document
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * One session of the JSON document, in a fixed key order. A stable key order
 * keeps a diff of two reports small.
 *
 * @param {ReportSession} session
 * @returns {Record<string, unknown>}
 */
function jsonSession(session) {
  return {
    harness: session.harness,
    id: session.id,
    kind: session.kind,
    parent: session.parent,
    model: session.model,
    created: session.created ?? null,
    steps: session.steps,
    promptTokens: session.promptTokens,
    cacheReadTokens: session.cacheReadTokens,
    cacheShare: session.cacheShare,
    finalPromptTokens: session.finalPromptTokens,
    outputTokens: session.outputTokens,
    costUsd: session.costUsd ?? null,
    flags: session.flags,
  };
}

/**
 * Build the "--json" document of implementation.md section 3.6. The caller
 * prints it and nothing else on the output stream.
 *
 * The caller passes "generated", so a test asserts one stable document.
 *
 * @param {{
 *   version: string,
 *   projectRoot: string,
 *   harnesses: HarnessState[],
 *   sessions: ReportSession[],
 *   generated?: string,
 * }} args
 * @returns {Record<string, unknown>}
 */
export function buildJson({
  version,
  projectRoot,
  harnesses,
  sessions,
  generated = new Date().toISOString(),
}) {
  const ordered = sortSessions(sessions);

  return {
    schema: JSON_SCHEMA,
    beastModeVersion: version,
    generated,
    project: projectRoot,
    harnesses: harnesses.map((harness) =>
      harness.reason
        ? { id: harness.id, reader: harness.reader, reason: harness.reason }
        : { id: harness.id, reader: harness.reader }
    ),
    sessions: ordered.map(jsonSession),
    totals: totals(ordered),
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// The collect pass
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Run one reader for every installed harness, and return the harness states,
 * the sessions, and the message set.
 *
 * The reader lookup arrives as a parameter, so a test passes a fixture
 * reader and this function needs no real harness and no environment
 * variable. The shipped caller passes the lookup of the reader registry.
 *
 * A reader that throws becomes one "unavailable" harness, because a report
 * must never fail its caller. The session check runs outside that guard, so
 * a reader that breaks the session shape still raises a named error.
 *
 * @param {{
 *   harnesses: { id: string }[],
 *   getReader: (id: string) => Reader | null,
 *   projectRoot: string,
 *   days?: number | null,
 *   env?: Record<string, string | undefined>,
 * }} args
 * @returns {{ harnesses: HarnessState[], sessions: ReportSession[], notes: Note[] }}
 */
export function collect({ harnesses, getReader, projectRoot, days = null, env = process.env }) {
  /** @type {HarnessState[]} */
  const states = [];
  /** @type {ReportSession[]} */
  const sessions = [];
  /** @type {Note[]} */
  const notes = [];
  let ran = 0;

  for (const harness of harnesses) {
    const reader = getReader(harness.id);

    if (!reader) {
      states.push({ id: harness.id, reader: 'missing' });
      notes.push({
        level: 'info',
        text: `The plugin ships no token reader for the harness "${harness.id}" yet.`,
      });
      continue;
    }

    /** @type {{ sessions: unknown, notes?: unknown } | null} */
    let result = null;
    try {
      const availability = reader.available({ env });
      if (!availability.ok) {
        states.push({ id: harness.id, reader: 'unavailable', reason: availability.reason });
        notes.push({
          level: 'warn',
          text: `The token reader of the harness "${harness.id}" cannot run. ${availability.reason} ${availability.fix}`,
        });
        continue;
      }
      result = reader.read({ projectRoot, days, env });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      states.push({ id: harness.id, reader: 'unavailable', reason });
      notes.push({
        level: 'warn',
        text: `The token reader of the harness "${harness.id}" cannot run. ${reason} Report the defect to the author of the reader.`,
      });
      continue;
    }

    if (!result || !Array.isArray(result.sessions)) {
      throw refuseField(
        'sessions',
        { harness: harness.id, position: 0 },
        'holds no array on the answer of read()'
      );
    }

    states.push({ id: harness.id, reader: 'present' });
    ran += 1;

    result.sessions.forEach((session, index) => {
      const checked = validateSession(session, { harness: harness.id, position: index + 1 });
      sessions.push(addFlags({ ...checked, harness: harness.id }));
    });

    if (Array.isArray(result.notes)) {
      for (const note of result.notes) notes.push({ level: 'info', text: String(note) });
    }
  }

  if (ran > 0 && sessions.length === 0) {
    notes.push({ level: 'info', text: 'No session log matched this project.' });
  }

  return { harnesses: states, sessions: sortSessions(sessions), notes };
}
