// installer/lib/report.js
//
// The house output style comes from the Beast Mode 5.0.0 bash installer,
// which this CLI replaced: a ━━━ rule line 39 characters wide, a section
// banner between two rule lines, and the ✓, ⚠, ℹ, and ✗ marks. The CLI
// emits ANSI color only when the output stream is a TTY and NO_COLOR is
// unset. A caller injects its own stream (or a collector) so a test can
// capture the output.

const RULE_WIDTH = 39;
const RULE = '━'.repeat(RULE_WIDTH);

const COLOR = {
  red: '\x1b[0;31m',
  green: '\x1b[0;32m',
  yellow: '\x1b[1;33m',
  blue: '\x1b[0;34m',
  reset: '\x1b[0m',
};

/**
 * @param {NodeJS.WritableStream} stream
 * @returns {boolean}
 */
function shouldColor(stream) {
  return Boolean(stream && stream.isTTY) && !process.env.NO_COLOR;
}

/**
 * Build a reporter bound to one output stream.
 *
 * @param {NodeJS.WritableStream} [stream] Defaults to process.stdout.
 * @returns {{
 *   rule(): void,
 *   section(title: string): void,
 *   ok(msg: string): void,
 *   warn(msg: string): void,
 *   info(msg: string): void,
 *   fail(msg: string): void,
 *   line(msg?: string): void,
 * }}
 */
export function createReporter(stream = process.stdout) {
  const color = shouldColor(stream);

  const wrap = (code, text) => (color ? `${code}${text}${COLOR.reset}` : text);
  const write = (text) => stream.write(`${text}\n`);

  return {
    rule() {
      write(RULE);
    },
    section(title) {
      write('');
      this.rule();
      write(title);
      this.rule();
      write('');
    },
    ok(msg) {
      write(`${wrap(COLOR.green, '✓')} ${msg}`);
    },
    warn(msg) {
      write(`${wrap(COLOR.yellow, '⚠')} ${msg}`);
    },
    info(msg) {
      write(`${wrap(COLOR.blue, 'ℹ')} ${msg}`);
    },
    fail(msg) {
      write(`${wrap(COLOR.red, '✗')} ${msg}`);
    },
    line(msg = '') {
      write(msg);
    },
  };
}
