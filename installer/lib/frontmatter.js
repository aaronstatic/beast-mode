// installer/lib/frontmatter.js
//
// A scalar-only frontmatter parser (decision 8 of implementation.md). The
// current Beast Mode source needs top-level scalar keys only, so this file
// adds no YAML dependency.
//
// Parser limit: this parser reads a top-level scalar key only. It does not
// handle a nested map (an indented "key: value" line), a block scalar
// (a value that starts with "|" or ">"), or a flow list (a value that
// starts with "["). A file that needs one of those raises SourceInvalidError
// rather than guessing a wrong parse.

import { SourceInvalidError } from './errors.js';

const DELIMITER = '---';

/**
 * Split a frontmatter document into a data object, a body, and the raw
 * frontmatter text. Each line splits on the first ": " (a colon a space
 * follows), or on a trailing colon with no value. One pair of outer double
 * or single quotes strips from the value.
 *
 * @param {string} text
 * @returns {{ data: Record<string, string>, body: string, raw: string } | null}
 *   null when the text carries no frontmatter block.
 */
export function split(text) {
  const lines = text.split('\n');
  if (lines[0] !== DELIMITER) return null;

  let endIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === DELIMITER) {
      endIndex = i;
      break;
    }
  }
  if (endIndex === -1) return null;

  const rawLines = lines.slice(1, endIndex);
  const raw = rawLines.join('\n');
  const body = lines.slice(endIndex + 1).join('\n');

  const data = {};
  for (const line of rawLines) {
    if (line.trim() === '') continue;
    parseLine(line, data);
  }

  return { data, body, raw };
}

/**
 * @param {string} line
 * @param {Record<string, string>} data
 * @returns {void}
 */
function parseLine(line, data) {
  if (/^[ \t]/.test(line)) {
    throw new SourceInvalidError(
      `A frontmatter line is indented: "${line}"`,
      'This parser reads a top-level scalar key only, and an indented line means a nested map.',
      'Flatten the frontmatter to top-level scalar keys, then run the command again.'
    );
  }

  const colonSpace = line.indexOf(': ');
  const trailingColon = line.endsWith(':') ? line.length - 1 : -1;

  let sepIndex;
  if (colonSpace !== -1 && (trailingColon === -1 || colonSpace <= trailingColon)) {
    sepIndex = colonSpace;
  } else if (trailingColon !== -1) {
    sepIndex = trailingColon;
  } else {
    throw new SourceInvalidError(
      `A frontmatter line holds no "key: value" shape: "${line}"`,
      'Every top-level line needs a "key: value" pair or a bare "key:" with no value.',
      'Fix the frontmatter line, then run the command again.'
    );
  }

  const key = line.slice(0, sepIndex).trim();
  let value = line.slice(sepIndex + 1).trim();

  if (value.startsWith('|') || value.startsWith('>')) {
    throw new SourceInvalidError(
      `The frontmatter key "${key}" holds a block scalar value.`,
      'This parser handles no block scalar ("|" or ">") value.',
      'Rewrite the value as a plain scalar, then run the command again.'
    );
  }

  if (value.startsWith('[')) {
    throw new SourceInvalidError(
      `The frontmatter key "${key}" holds a flow list value.`,
      'This parser handles no flow list ("[") value.',
      'Rewrite the value as a plain scalar, then run the command again.'
    );
  }

  data[key] = stripQuotes(value);
}

/**
 * Strip one pair of outer double or single quotes from a value.
 *
 * @param {string} value
 * @returns {string}
 */
function stripQuotes(value) {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}

/**
 * True when a value needs quotes to round-trip through join(), because it
 * holds a colon, a "#" comment marker, leading or trailing whitespace, or
 * because it is empty.
 *
 * @param {string} value
 * @returns {boolean}
 */
function needsQuotes(value) {
  return (
    value === '' ||
    value.includes(':') ||
    value.includes('#') ||
    value.trim() !== value
  );
}

/**
 * @param {string} value
 * @returns {string}
 */
function formatValue(value) {
  if (needsQuotes(value)) {
    return `"${value.replace(/"/g, '\\"')}"`;
  }
  return value;
}

/**
 * Join a data object and a body back into a frontmatter document.
 *
 * @param {Record<string, string>} data
 * @param {string} body
 * @returns {string}
 */
export function join(data, body) {
  const lines = [DELIMITER];
  for (const [key, value] of Object.entries(data)) {
    lines.push(`${key}: ${formatValue(value)}`);
  }
  lines.push(DELIMITER);
  return `${lines.join('\n')}\n${body}`;
}
