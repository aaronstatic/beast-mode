// installer/lib/errors.js
//
// One error class per exit code of implementation.md section 3.6. Every
// class carries three lines: the message (what failed), the cause (why it
// failed), and the fix (what the user does next). bin/beast-mode.js catches
// a BeastModeError, prints the three lines through lib/report.js, and exits
// with the class exitCode.

/**
 * The base class for every Beast Mode CLI error.
 */
export class BeastModeError extends Error {
  /**
   * @param {string} message What failed.
   * @param {string} [cause] Why it failed.
   * @param {string} [fix] What the user does next.
   */
  constructor(message, cause, fix) {
    super(message);
    this.name = new.target.name;
    this.causeText = cause;
    this.fix = fix;
  }

  /** @returns {number} The process exit code for this error class. */
  get exitCode() {
    return /** @type {typeof BeastModeError} */ (this.constructor).exitCode;
  }
}

/** Exit 1. A missing source directory, a bad glossary, or a bad skill header. */
export class SourceInvalidError extends BeastModeError {}
SourceInvalidError.exitCode = 1;

/** Exit 2. An unknown flag, a missing argument, or a missing `--out`. */
export class UsageError extends BeastModeError {}
UsageError.exitCode = 2;

/** Exit 3. No adapter, or no `templates/harness/<id>.md`. */
export class UnknownHarnessError extends BeastModeError {}
UnknownHarnessError.exitCode = 3;

/** Exit 4. A symlink layout, or the Beast Mode repo itself. */
export class GuardRefusalError extends BeastModeError {}
GuardRefusalError.exitCode = 4;

/** Exit 5. Unreadable manifest JSON, a harness mismatch, or an unknown schema. */
export class ManifestConflictError extends BeastModeError {}
ManifestConflictError.exitCode = 5;

/** Exit 6. `EACCES`, `ENOSPC`, or a destination that is a directory. */
export class WriteFailureError extends BeastModeError {}
WriteFailureError.exitCode = 6;

/** Exit 7. A manifest already exists. Run `upgrade` instead of `install`. */
export class InstallRefusedError extends BeastModeError {}
InstallRefusedError.exitCode = 7;

/**
 * Format a BeastModeError as the three lines the CLI prints: what failed,
 * why it failed, and what the user does next. A line that the error did not
 * set is dropped.
 *
 * @param {BeastModeError} err
 * @returns {string[]}
 */
export function formatError(err) {
  const lines = [err.message];
  if (err.causeText) lines.push(err.causeText);
  if (err.fix) lines.push(err.fix);
  return lines;
}
