#!/usr/bin/env node
// installer/bin/beast-mode.js
//
// The installer CLI entry point. Parses the command line, dispatches to a
// command, and maps every error to its exit code. Every command runs the
// same pipeline: adapter, guards, source, manifest, render, plan, apply.
// A skip and a conflict both exit 0, because the calling command must keep
// running and read the summary.

import fs from 'node:fs';
import { parseArgs } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { BeastModeError, UsageError, WriteFailureError } from '../lib/errors.js';
import { createReporter } from '../lib/report.js';
import { runGuards } from '../lib/guards.js';
import { readSource, readVersion, findPluginRoot } from '../lib/source.js';
import { adapters, getAdapter } from '../adapters/index.js';
import { GLOSSARY_DESTINATION, planInstall, planUpgrade, render } from '../lib/plan.js';
import { apply } from '../lib/apply.js';
import { manifestPath as buildManifestPath, read as readManifest } from '../lib/manifest.js';
import { compose, readSections } from '../lib/glossary.js';
import * as marker from '../lib/marker.js';
import * as tokens from '../lib/tokens.js';
import * as transcript from '../lib/transcript.js';
import { runOrca } from '../lib/orca/steps.js';
import { getReader, readers } from '../readers/index.js';

const COMMANDS = ['install', 'upgrade', 'render', 'status', 'tokens', 'transcript', 'orca'];

/** The flags of the token report. Every other command refuses them. */
const REPORT_ONLY_FLAGS = ['json', 'days'];

const WRITE_ERROR_CODES = new Set(['EACCES', 'ENOSPC', 'EISDIR', 'ENOTDIR']);

const HELP_TEXT = `
beast-mode install <harness>  [--dry-run] [--project <dir>] [--plugin-root <dir>]
beast-mode upgrade [<harness>] [--dry-run] [--force] [--project <dir>] [--plugin-root <dir>]
beast-mode render  <harness>  --out <dir> [--plugin-root <dir>]
beast-mode status             [--project <dir>] [--plugin-root <dir>]
beast-mode tokens             [--json] [--days <n>] [--project <dir>] [--plugin-root <dir>]
beast-mode transcript [<session-id>] [--out <dir>] [--project <dir>] [--plugin-root <dir>]
beast-mode orca <next|branch|start|close|commit|merge|reply|detect|config> --feature <path> [<step flags>] [--project <dir>] [--plugin-root <dir>]
beast-mode --help
beast-mode --version

  "upgrade" with no harness upgrades every installed harness in this project.
  "transcript" with no session id reads the current session, else the newest parent session.

  --dry-run             install, upgrade          Print the full write plan. Change nothing.
  --force               upgrade                   Overwrite a conflicted file. Back it up first.
  --out <dir>           render                    The output directory. Required.
                        transcript                Write <session-id>.txt here. Print the summary only.
  --json                tokens                    Print one JSON object. Print nothing else.
  --days <n>            tokens                    Report the last <n> days only. Defaults to every session.
  --project <dir>       all but render            The project root. Defaults to the working directory.
  --plugin-root <dir>   all                       The plugin root. Defaults to the parent of installer/.

Exit codes:
  0  success            1  source invalid      2  usage error       3  unknown harness
  4  guard refusal       5  manifest conflict   6  write failure     7  install refused
`.trim();

/**
 * The CLI entry point. Exported so a test can call it directly with an
 * injected argv and an injected stdout, stderr, and cwd.
 *
 * `env` and `runner` reach only the "orca" sub-CLI: the environment that
 * it reads, and the child process runner that it calls.
 *
 * @param {string[]} argv
 * @param {{
 *   stdout?: NodeJS.WritableStream,
 *   stderr?: NodeJS.WritableStream,
 *   cwd?: string,
 *   env?: Record<string, string | undefined>,
 *   runner?: import('../lib/orca/steps.js').Runner,
 * }} [ctx]
 * @returns {number} The process exit code.
 */
export function main(argv, ctx = {}) {
  const stdout = ctx.stdout ?? process.stdout;
  const stderr = ctx.stderr ?? process.stderr;
  const cwd = ctx.cwd ?? process.cwd();
  const report = createReporter(stdout);
  const errorReport = createReporter(stderr);

  try {
    return run(argv, { stdout, cwd, report, errorReport, env: ctx.env, runner: ctx.runner });
  } catch (err) {
    if (err instanceof BeastModeError) {
      printError(errorReport, err);
      return err.exitCode;
    }
    if (err && typeof err === 'object' && WRITE_ERROR_CODES.has(/** @type {any} */ (err).code)) {
      const writeErr = new WriteFailureError(
        'The installer CLI could not write a file.',
        /** @type {Error} */ (err).message,
        'Check the file permission and the available disk space, then run the command again.'
      );
      printError(errorReport, writeErr);
      return writeErr.exitCode;
    }
    throw err;
  }
}

/**
 * @param {ReturnType<typeof createReporter>} errorReport
 * @param {BeastModeError} err
 * @returns {void}
 */
function printError(errorReport, err) {
  errorReport.fail(err.message);
  if (err.causeText) errorReport.line(err.causeText);
  if (err.fix) errorReport.line(err.fix);
}

/**
 * Refuse a Node.js version below the documented floor. `parseArgs` and every
 * `node:` import this CLI uses run on an older Node, so the presence check
 * the calling command already runs would pass and mask the real problem.
 * This is the one place that compares the running version with 20.
 *
 * @param {string} versionString `process.versions.node`, for example "18.19.0".
 * @returns {void}
 */
export function checkNodeVersion(versionString) {
  const major = Number.parseInt(versionString.split('.')[0], 10);
  if (major < 20) {
    throw new UsageError(
      `Node.js ${versionString} is too old.`,
      'The installer CLI runs on Node.js 20 or later.',
      'Install Node.js 20 or later from https://nodejs.org, then run the command again.'
    );
  }
}

/**
 * Parse the "--days" value of the token report: a whole number of days over
 * zero, or null when the flag is absent. A bad value raises a UsageError,
 * because a silent fallback would report a window the user did not ask for.
 * The test refuses a fraction, for example "--days 7.5", because the web
 * route refuses the same value.
 *
 * @param {string | undefined} value The raw flag value.
 * @returns {number | null}
 */
function parseDays(value) {
  if (value === undefined) return null;
  const days = Number(value);
  if (!Number.isFinite(days) || !Number.isInteger(days) || days <= 0) {
    throw new UsageError(
      `"--days ${value}" names no number of days.`,
      'The "--days" flag takes a whole number that is greater than zero, for example "--days 7".',
      'Run "beast-mode tokens --days 7", or run "beast-mode tokens" with no "--days" flag.'
    );
  }
  return days;
}

/**
 * @param {string[]} argv
 * @param {{
 *   stdout: NodeJS.WritableStream,
 *   cwd: string,
 *   report: ReturnType<typeof createReporter>,
 *   errorReport: ReturnType<typeof createReporter>,
 *   env?: Record<string, string | undefined>,
 *   runner?: import('../lib/orca/steps.js').Runner,
 * }} args
 * @returns {number}
 */
function run(argv, { stdout, cwd, report, errorReport, env, runner }) {
  checkNodeVersion(process.versions.node);

  // "orca" parses the flags of each step itself, so it takes the argument
  // list before the main parse, and the six other commands keep their
  // strict flag checks. lib/orca/steps.js sits three levels below the
  // plugin root, so this file passes the default plugin root to it.
  if (argv[0] === 'orca') {
    return runOrca(argv.slice(1), {
      stdout,
      cwd,
      env,
      runner,
      pluginRoot: findPluginRoot(path.dirname(fileURLToPath(import.meta.url))),
    });
  }

  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        'dry-run': { type: 'boolean' },
        force: { type: 'boolean' },
        out: { type: 'string' },
        json: { type: 'boolean' },
        days: { type: 'string' },
        project: { type: 'string' },
        'plugin-root': { type: 'string' },
        help: { type: 'boolean' },
        version: { type: 'boolean' },
      },
    });
  } catch (err) {
    throw new UsageError(
      'The command line holds an unknown flag or a missing option value.',
      err instanceof Error ? err.message : String(err),
      'Run "beast-mode --help" to see the flags, then run the command again.'
    );
  }

  const { values, positionals } = parsed;

  if (values.help) {
    stdout.write(`${HELP_TEXT}\n`);
    return 0;
  }

  const pluginRoot = values['plugin-root']
    ? path.resolve(values['plugin-root'])
    : findPluginRoot(path.dirname(fileURLToPath(import.meta.url)));

  if (values.version) {
    stdout.write(`${readVersion(pluginRoot)}\n`);
    return 0;
  }

  const [command, harness] = positionals;

  if (!command || !COMMANDS.includes(command)) {
    throw new UsageError(
      command ? `"${command}" is not a Beast Mode command.` : 'No command given.',
      `The CLI runs one of: ${COMMANDS.join(', ')}.`,
      'Run "beast-mode --help" to see the command surface.'
    );
  }

  // A flag before "orca" sends the arguments through the main parse, which
  // knows no step flag. "orca" must lead the argument list.
  if (command === 'orca') {
    throw new UsageError(
      'The "orca" command must come first on the command line.',
      'A flag came before "orca", so the step flags did not reach the orca command.',
      'Run "beast-mode orca <step> --feature <path> --project <dir>".'
    );
  }

  // "status" and "tokens" take no harness argument: each one reports every
  // installed harness in one pass. "install" and "render" always need one.
  // "upgrade" alone upgrades every installed harness (runUpgradeAll(), plan
  // section 3.5). "transcript" takes one optional session id in the place of
  // the harness argument, and a second positional after the id is a usage
  // error.
  if (command === 'transcript') {
    if (positionals.length > 2) {
      throw new UsageError(
        'The "transcript" command takes one session id at most.',
        `"${positionals[2]}" followed the session id "${harness}" on the command line.`,
        'Run "beast-mode transcript <session-id>", or run "beast-mode transcript" for the current session.'
      );
    }
  } else if (command === 'status' || command === 'tokens') {
    if (harness) {
      throw new UsageError(
        `The "${command}" command takes no harness argument.`,
        `"${harness}" followed "${command}" on the command line.`,
        `Run "beast-mode ${command}" with no harness argument.`
      );
    }
  } else if ((command === 'install' || command === 'render') && !harness) {
    throw new UsageError(
      `The "${command}" command needs a harness argument.`,
      'No harness id followed the command name.',
      `Run "beast-mode --help" to see an example, then run "beast-mode ${command} <harness>".`
    );
  }

  // "--force" overwrites a file the user edited or a file the user already
  // had. It backs the old copy up first, and only "upgrade" takes it.
  if (values.force && command !== 'upgrade') {
    throw new UsageError(
      `The "${command}" command takes no "--force" flag.`,
      'Only "beast-mode upgrade" takes "--force".',
      `Run "beast-mode ${command}${harness ? ` ${harness}` : ''}" with no "--force".`
    );
  }

  // "--json" and "--days" belong to the token report alone. Another command
  // prints the house format, and it reads no time window.
  if (command !== 'tokens') {
    for (const flag of REPORT_ONLY_FLAGS) {
      if (values[flag] === undefined) continue;
      throw new UsageError(
        `The "${command}" command takes no "--${flag}" flag.`,
        `Only "beast-mode tokens" takes "--${flag}".`,
        `Run "beast-mode ${command}${harness ? ` ${harness}` : ''}" with no "--${flag}".`
      );
    }
  }

  if (command === 'status') {
    const projectRoot = values.project ? path.resolve(values.project) : cwd;
    return runStatus({ pluginRoot, projectRoot, report });
  }

  if (command === 'tokens') {
    const projectRoot = values.project ? path.resolve(values.project) : cwd;
    return runTokens({
      pluginRoot,
      projectRoot,
      report,
      errorReport,
      stdout,
      json: Boolean(values.json),
      days: parseDays(values.days),
    });
  }

  if (command === 'transcript') {
    const projectRoot = values.project ? path.resolve(values.project) : cwd;
    return runTranscript({
      pluginRoot,
      projectRoot,
      report,
      stdout,
      sessionId: harness ?? null,
      outDir: values.out ? path.resolve(values.out) : null,
    });
  }

  if (command === 'upgrade' && !harness) {
    const projectRoot = values.project ? path.resolve(values.project) : cwd;
    return runUpgradeAll({
      pluginRoot,
      projectRoot,
      report,
      dryRun: Boolean(values['dry-run']),
      force: Boolean(values.force),
    });
  }

  const adapter = getAdapter(harness);

  if (command === 'render') {
    if (!values.out) {
      throw new UsageError(
        'The "render" command needs an output directory.',
        'No "--out <dir>" flag was given.',
        `Run "beast-mode render ${harness} --out <dir>".`
      );
    }
    return runRender({ adapter, pluginRoot, outDir: path.resolve(values.out), report });
  }

  const projectRoot = values.project ? path.resolve(values.project) : cwd;

  runGuards({ projectRoot, pluginRoot, harnessRoot: adapter.harnessRoot });

  if (command === 'upgrade') {
    return runUpgrade({
      adapter,
      pluginRoot,
      projectRoot,
      report,
      dryRun: Boolean(values['dry-run']),
      force: Boolean(values.force),
    });
  }

  return runInstall({
    adapter,
    pluginRoot,
    projectRoot,
    report,
    dryRun: Boolean(values['dry-run']),
  });
}

/**
 * Resolve the harness set of this project, then compose the shared glossary
 * from the source glossary of every harness in that set.
 *
 * The set is the marker entries, plus every harness that already holds a
 * manifest, plus "include" when a caller names one harness that this run
 * must serve even before its own manifest exists. The composition therefore
 * depends on the harness set, never on one running harness alone, so every
 * harness in one project always reads the same bytes from
 * ".beast-mode/harness.md" (Decision 6). A project with one harness gets
 * the source glossary bytes, unchanged. runUpgradeAll() passes "include:
 * null", because every harness it serves already belongs to the set.
 *
 * Every note of the marker read and of the section read prints as one
 * warning line. A note never stops the run: the marker is derived data
 * (Decision 4), and a second harness with a bad glossary must never block
 * the harness the user asked for.
 *
 * @param {{ include: string | null, pluginRoot: string, projectRoot: string, report: ReturnType<typeof createReporter> }} args
 * @returns {{ marker: import('../lib/marker.js').Marker | null, harnesses: import('../lib/marker.js').Harness[], sections: { id: string | null }[], glossaryText: string }}
 */
function composeGlossary({ include, pluginRoot, projectRoot, report }) {
  const { marker: current, notes } = marker.read(projectRoot);
  for (const note of notes) report.warn(note);

  const harnesses = marker.resolve({
    projectRoot,
    marker: current,
    adapters,
    include,
  });

  const { sections, notes: sectionNotes } = readSections({ pluginRoot, harnesses });
  for (const note of sectionNotes) report.warn(note);

  return { marker: current, harnesses, sections, glossaryText: compose(sections) };
}

/**
 * Record this run in the shared version marker, then name the composed
 * glossary. Runs after apply() returns, so the marker never claims a
 * harness whose files the run did not write. A dry run calls neither.
 *
 * The entry of the running harness takes the plugin version this run wrote.
 * Every other entry keeps its own values, and a harness this run detected
 * for the first time takes the version of its own version file, which is
 * the authority for that harness (Decision 5).
 *
 * @param {{
 *   adapter: import('../adapters/index.js').Adapter,
 *   projectRoot: string,
 *   report: ReturnType<typeof createReporter>,
 *   current: import('../lib/marker.js').Marker | null,
 *   harnesses: import('../lib/marker.js').Harness[],
 *   sections: { id: string | null }[],
 *   version: string,
 * }} args
 * @returns {void}
 */
function recordRun({ adapter, projectRoot, report, current, harnesses, sections, version }) {
  const now = new Date().toISOString();
  let next = current;

  for (const harness of harnesses) {
    const touched = harness.id === adapter.id;
    const cached = current?.harnesses?.[harness.id]?.version;
    const harnessVersion = touched
      ? version
      : marker.readHarnessVersion(projectRoot, harness.harnessRoot) ??
        cached ??
        marker.UNKNOWN_VERSION;

    next = marker.upsert(next, {
      id: harness.id,
      harnessRoot: harness.harnessRoot,
      version: harnessVersion,
      beastModeVersion: version,
      now,
      touched,
    });
  }

  marker.write(projectRoot, next);

  const ids = sections.length > 0 ? sections.map((section) => section.id) : [adapter.id];
  const noun = ids.length === 1 ? 'harness' : 'harnesses';
  report.info(
    `Harness glossary: ${GLOSSARY_DESTINATION}, composed from ${ids.length} ${noun} (${ids.join(', ')}).`
  );
}

/**
 * Resolve the display version of one harness: the version file first
 * (Decision 5, that file is the authority), then the marker cache, then the
 * literal "unknown". Shared by "status" and the stale warning, so the two
 * never disagree about the version of the same harness.
 *
 * @param {{ projectRoot: string, harnessRoot: string, cached: string | undefined }} args
 * @returns {string}
 */
function resolveHarnessVersion({ projectRoot, harnessRoot, cached }) {
  return marker.readHarnessVersion(projectRoot, harnessRoot) ?? cached ?? marker.UNKNOWN_VERSION;
}

/**
 * Format a harness version for display. The literal "unknown" carries no
 * "v" prefix, so the reader never reads "vunknown".
 *
 * @param {string} version
 * @returns {string}
 */
function formatVersion(version) {
  return version === marker.UNKNOWN_VERSION ? marker.UNKNOWN_VERSION : `v${version}`;
}

/**
 * Print the three lines of a BeastModeError inside the all-harness batch.
 * Uses "report" (stdout), the stream that already carries the batch banner
 * and the roll-up, so one captured stream holds the whole story of a run
 * that spans more than one harness.
 *
 * @param {ReturnType<typeof createReporter>} report
 * @param {BeastModeError} err
 * @returns {void}
 */
function printBatchError(report, err) {
  report.fail(err.message);
  if (err.causeText) report.line(err.causeText);
  if (err.fix) report.line(err.fix);
}

/**
 * Print the stale-install warning of plan section 3.7, after a real install
 * or a real upgrade of one harness. Compares every other harness of the
 * marker with the plugin version this run just wrote, and warns about every
 * harness that falls behind. Never runs on a dry run and never runs inside
 * the all-harness batch, whose roll-up already names every harness. The
 * warning never changes the exit code.
 *
 * @param {{
 *   adapter: import('../adapters/index.js').Adapter,
 *   projectRoot: string,
 *   report: ReturnType<typeof createReporter>,
 *   harnesses: import('../lib/marker.js').Harness[],
 *   version: string,
 *   current: import('../lib/marker.js').Marker | null,
 * }} args
 * @returns {void}
 */
function printStaleWarning({ adapter, projectRoot, report, harnesses, version, current }) {
  const behind = [];
  for (const harness of harnesses) {
    if (harness.id === adapter.id) continue;
    const cached = current?.harnesses?.[harness.id]?.version;
    const harnessVersion = resolveHarnessVersion({ projectRoot, harnessRoot: harness.harnessRoot, cached });
    if (harnessVersion !== version) {
      behind.push({ id: harness.id, harnessRoot: harness.harnessRoot, version: harnessVersion });
    }
  }

  if (behind.length === 0) return;

  const noun = behind.length === 1 ? 'harness' : 'harnesses';
  const verb = behind.length === 1 ? 'is' : 'are';
  report.warn(`${behind.length} other ${noun} in this project ${verb} behind the plugin version:`);
  for (const entry of behind) {
    report.line(
      `    ${entry.id} (${entry.harnessRoot}/) holds ${formatVersion(entry.version)}. The plugin ships v${version}.`
    );
  }
  report.info('Run `beast-mode upgrade` to upgrade every installed harness in this project.');
}

/**
 * @param {{ adapter: import('../adapters/index.js').Adapter, pluginRoot: string, projectRoot: string, report: ReturnType<typeof createReporter>, dryRun: boolean }} args
 * @returns {number}
 */
function runInstall({ adapter, pluginRoot, projectRoot, report, dryRun }) {
  const source = readSource({
    pluginRoot,
    harnessId: adapter.id,
    glossaryHarnessId: adapter.glossaryHarnessId,
  });

  const manifestFile = buildManifestPath(projectRoot, adapter.harnessRoot);
  const manifest = readManifest({ path: manifestFile, harnessId: adapter.id });

  const composed = composeGlossary({ include: adapter.id, pluginRoot, projectRoot, report });

  const { rendered } = render({ source, adapter, glossaryText: composed.glossaryText });
  const plan = planInstall({
    rendered,
    projectRoot,
    harnessRoot: adapter.harnessRoot,
    manifest,
    includeGitignoreAndDocs: true,
  });

  apply(plan, { projectRoot, pluginRoot, adapter, source, reporter: report, dryRun, mode: 'install' });

  if (!dryRun) {
    recordRun({
      adapter,
      projectRoot,
      report,
      current: composed.marker,
      harnesses: composed.harnesses,
      sections: composed.sections,
      version: source.version,
    });
    printStaleWarning({
      adapter,
      projectRoot,
      report,
      harnesses: composed.harnesses,
      version: source.version,
      current: composed.marker,
    });
  }

  return 0;
}

/**
 * Run "upgrade": read the source, read the manifest (a missing manifest
 * reads as null and takes the fallback rows of the decision table), render,
 * plan, and apply. A skip and a conflict both exit 0, so the calling
 * command keeps running and reads the skip list.
 *
 * @param {{ adapter: import('../adapters/index.js').Adapter, pluginRoot: string, projectRoot: string, report: ReturnType<typeof createReporter>, dryRun: boolean, force: boolean }} args
 * @returns {number}
 */
function runUpgrade({ adapter, pluginRoot, projectRoot, report, dryRun, force }) {
  const source = readSource({
    pluginRoot,
    harnessId: adapter.id,
    glossaryHarnessId: adapter.glossaryHarnessId,
  });

  const manifestFile = buildManifestPath(projectRoot, adapter.harnessRoot);
  const manifest = readManifest({ path: manifestFile, harnessId: adapter.id });

  const composed = composeGlossary({ include: adapter.id, pluginRoot, projectRoot, report });

  const { rendered } = render({ source, adapter, glossaryText: composed.glossaryText });
  const plan = planUpgrade({
    rendered,
    projectRoot,
    harnessRoot: adapter.harnessRoot,
    manifest,
    force,
    includeGitignoreAndDocs: true,
  });

  apply(plan, { projectRoot, pluginRoot, adapter, source, reporter: report, dryRun, mode: 'upgrade' });

  if (!dryRun) {
    recordRun({
      adapter,
      projectRoot,
      report,
      current: composed.marker,
      harnesses: composed.harnesses,
      sections: composed.sections,
      version: source.version,
    });
    printStaleWarning({
      adapter,
      projectRoot,
      report,
      harnesses: composed.harnesses,
      version: source.version,
      current: composed.marker,
    });
  }

  return 0;
}

/**
 * The exit-2 error of an all-harness upgrade that finds no harness to run.
 * One call site fires it before the batch starts, when the marker names no
 * harness and no known harness holds a manifest. A second call site fires
 * the same error after the batch, when the marker names only a harness id
 * this plugin version ships no adapter for: the loop then skips every
 * member, so the batch must refuse rather than print an empty roll-up and
 * exit 0.
 *
 * @returns {UsageError}
 */
function noInstalledHarnessError() {
  return new UsageError(
    'This project holds no installed harness to upgrade.',
    `The marker at "${marker.MARKER_PATH}" names no harness, and no known harness holds a manifest.`,
    'Run "beast-mode install <harness>" for a first install, or run "beast-mode upgrade <harness>" ' +
      'once for a harness that already lived in this project before the shared marker.'
  );
}

/**
 * Run "upgrade" with no harness argument: upgrade every installed harness of
 * this project in one batch (plan section 3.5).
 *
 * The set is resolved once, before the first per-harness run, and every run
 * in the batch composes the same glossary bytes from it (Decision 6). Each
 * harness then runs its own guards, its own read, its own plan, and its own
 * apply, in adapter id sort order. A BeastModeError from one harness (a
 * guard refusal, a manifest conflict, a bad source) is caught, printed, and
 * recorded; the batch moves on to the next harness (Decision 7). Any other
 * error is a defect, and it propagates to main(), which maps a write
 * failure to exit 6. The roll-up prints one line per harness, and the batch
 * exits with the highest per-harness exit code.
 *
 * @param {{ pluginRoot: string, projectRoot: string, report: ReturnType<typeof createReporter>, dryRun: boolean, force: boolean }} args
 * @returns {number}
 */
function runUpgradeAll({ pluginRoot, projectRoot, report, dryRun, force }) {
  const composed = composeGlossary({ include: null, pluginRoot, projectRoot, report });

  if (composed.harnesses.length === 0) {
    throw noInstalledHarnessError();
  }

  const version = readVersion(pluginRoot);

  // recordRun() rebuilds the whole harness set from "current" on every
  // call, so "current" must move forward after each harness's write. A
  // stale snapshot would make harness 2's recordRun() call undo harness 1's
  // just-written entry.
  let current = composed.marker;

  /** @type {{ id: string, harnessRoot: string, exitCode: number }[]} */
  const results = [];

  for (const harness of composed.harnesses) {
    const adapter = adapters[harness.id];
    if (!adapter) {
      report.warn(
        `This plugin version ships no adapter for the harness "${harness.id}", so this batch skips it.`
      );
      continue;
    }

    report.section(`⚙️  UPGRADING ${adapter.id} (${adapter.harnessRoot})`);

    let exitCode = 0;
    try {
      runGuards({ projectRoot, pluginRoot, harnessRoot: adapter.harnessRoot });

      const source = readSource({
        pluginRoot,
        harnessId: adapter.id,
        glossaryHarnessId: adapter.glossaryHarnessId,
      });

      const manifestFile = buildManifestPath(projectRoot, adapter.harnessRoot);
      const manifest = readManifest({ path: manifestFile, harnessId: adapter.id });

      const { rendered } = render({ source, adapter, glossaryText: composed.glossaryText });
      const plan = planUpgrade({
        rendered,
        projectRoot,
        harnessRoot: adapter.harnessRoot,
        manifest,
        force,
        includeGitignoreAndDocs: true,
      });

      apply(plan, {
        projectRoot,
        pluginRoot,
        adapter,
        source,
        reporter: report,
        dryRun,
        mode: 'upgrade',
      });

      if (!dryRun) {
        recordRun({
          adapter,
          projectRoot,
          report,
          current,
          harnesses: composed.harnesses,
          sections: composed.sections,
          version: source.version,
        });
        current = marker.read(projectRoot).marker;
      }
    } catch (err) {
      if (!(err instanceof BeastModeError)) throw err;
      printBatchError(report, err);
      exitCode = err.exitCode;
    }

    results.push({ id: adapter.id, harnessRoot: adapter.harnessRoot, exitCode });
  }

  // The marker named at least one harness, but this plugin version ships no
  // adapter for any of them, so the loop above skipped every member. An
  // empty roll-up would print nothing and exit 0, which hides the refusal.
  if (results.length === 0) {
    throw noInstalledHarnessError();
  }

  report.section('📋 UPGRADE SUMMARY (ALL HARNESSES)');
  for (const result of results) {
    const line = `${result.id} (${result.harnessRoot}): exit ${result.exitCode}`;
    if (result.exitCode === 0) report.ok(line);
    else report.fail(line);
  }

  return results.reduce((max, result) => Math.max(max, result.exitCode), 0);
}

/**
 * Run "status": report the install state of this project. Writes nothing.
 *
 * "status" runs no guard, the same reason "render --out" runs none
 * (installer-cli Decision 10): a command that only reads, and that writes
 * no file, cannot reach the write path the guards protect. That is also why
 * a read-only report can run safely inside this repository.
 *
 * The version of one harness comes from "<harnessRoot>/.beast-mode-version"
 * first (Decision 5, that file is the authority), then the marker cache,
 * then the literal "unknown". A harness whose version differs from the
 * plugin version carries the flag "stale".
 *
 * @param {{ pluginRoot: string, projectRoot: string, report: ReturnType<typeof createReporter> }} args
 * @returns {number}
 */
function runStatus({ pluginRoot, projectRoot, report }) {
  const version = readVersion(pluginRoot);
  const { marker: current, notes } = marker.read(projectRoot);
  for (const note of notes) report.warn(note);

  const harnesses = marker.resolve({ projectRoot, marker: current, adapters, include: null });

  report.section('📊 BEAST MODE STATUS');
  report.line(`Plugin version:  ${version}`);
  report.line(`Project:         ${projectRoot}`);
  report.line(
    `Marker:          ${current ? marker.MARKER_PATH : 'none (detected from the harness manifests)'}`
  );
  report.line();

  if (harnesses.length === 0) {
    report.line('No installed harness found in this project.');
    report.info(
      `Run "beast-mode install <harness>" to install one. Known harnesses: ${Object.keys(adapters).sort().join(', ')}.`
    );
    return 0;
  }

  report.line('Installed harnesses:');
  let staleCount = 0;
  for (const harness of harnesses) {
    const cached = current?.harnesses?.[harness.id]?.version;
    const harnessVersion = resolveHarnessVersion({ projectRoot, harnessRoot: harness.harnessRoot, cached });
    const stale = harnessVersion !== version;
    const line = `${harness.id.padEnd(8)} ${harness.harnessRoot.padEnd(10)} ${formatVersion(harnessVersion).padEnd(8)} ${
      stale ? 'stale' : 'up to date'
    }`;
    if (stale) {
      staleCount += 1;
      report.warn(line);
    } else {
      report.ok(line);
    }
  }

  report.line();
  if (staleCount > 0) {
    const noun = staleCount === 1 ? 'harness' : 'harnesses';
    const verb = staleCount === 1 ? 'is' : 'are';
    report.warn(`${staleCount} ${noun} ${verb} behind the plugin version.`);
    report.info('Run `beast-mode upgrade` to upgrade every installed harness.');
  }

  return 0;
}

/**
 * Run "tokens": report the session token use of this project. Writes
 * nothing, and exits 0 for every empty state and every missing state.
 *
 * "tokens" runs no guard, the same reason "status" runs none: a command
 * that only reads cannot reach the write path the guards protect. A report
 * therefore runs safely inside this repository.
 *
 * The harness set comes from the shared marker, the same set "status"
 * reports. One reader of the reader registry then serves one harness. A
 * harness with no reader, a reader that cannot run, and a project with no
 * session log each print one line and hold the exit code at 0, because a
 * report must never fail its caller.
 *
 * "--json" prints one object on the output stream and nothing else, so every
 * note of a JSON run goes to the error stream. A caller that pipes the
 * output into a parser still reads every warning on the terminal.
 *
 * @param {{
 *   pluginRoot: string,
 *   projectRoot: string,
 *   report: ReturnType<typeof createReporter>,
 *   errorReport: ReturnType<typeof createReporter>,
 *   stdout: NodeJS.WritableStream,
 *   json: boolean,
 *   days: number | null,
 * }} args
 * @returns {number}
 */
function runTokens({ pluginRoot, projectRoot, report, errorReport, stdout, json, days }) {
  const version = readVersion(pluginRoot);
  const notesReport = json ? errorReport : report;

  const { marker: current, notes } = marker.read(projectRoot);
  for (const note of notes) notesReport.warn(note);

  const harnesses = marker.resolve({ projectRoot, marker: current, adapters, include: null });

  const collected = tokens.collect({
    harnesses,
    getReader,
    projectRoot,
    days,
    env: process.env,
  });

  if (json) {
    for (const note of collected.notes) notesReport[note.level](note.text);
    const document = tokens.buildJson({
      version,
      projectRoot,
      harnesses: collected.harnesses,
      sessions: collected.sessions,
    });
    stdout.write(`${JSON.stringify(document, null, 2)}\n`);
    return 0;
  }

  report.section('📊 BEAST MODE TOKEN REPORT');
  report.line(`Plugin version:  ${version}`);
  report.line(`Project:         ${projectRoot}`);
  report.line(`Window:          ${days === null ? 'every session' : `the last ${days} days`}`);
  report.line();

  if (harnesses.length === 0) {
    report.line('No installed harness found in this project.');
    report.info(
      `Run "beast-mode install <harness>" to install one. Known harnesses: ${Object.keys(adapters).sort().join(', ')}.`
    );
    return 0;
  }

  for (const note of collected.notes) report[note.level](note.text);

  if (collected.sessions.length === 0) return 0;

  report.line();
  for (const line of tokens.renderTable(collected.sessions, tokens.totals(collected.sessions))) {
    report.line(line);
  }

  return 0;
}

/**
 * Run "transcript": print or write the numbered steps of one session of this
 * project, with the steps of its subagents.
 *
 * "transcript" reads no marker and runs no guard, for the reason that
 * "status" and "tokens" run none: it reads logs, and its one write is the
 * transcript file under "--out". It asks every reader of the registry that
 * holds transcript(), so it runs in a project with no marker, this
 * repository included.
 *
 * With "--out <dir>", it creates the directory, writes "<session-id>.txt",
 * and prints the summary lines with the "Transcript:" line. With no
 * "--out", it prints the summary lines, one blank line, and the file text.
 * A run with no transcript creates no directory. Every state but a write
 * failure exits 0.
 *
 * @param {{
 *   pluginRoot: string,
 *   projectRoot: string,
 *   report: ReturnType<typeof createReporter>,
 *   stdout: NodeJS.WritableStream,
 *   sessionId: string | null,
 *   outDir: string | null,
 * }} args
 * @returns {number}
 */
function runTranscript({ pluginRoot, projectRoot, report, stdout, sessionId, outDir }) {
  const version = readVersion(pluginRoot);

  const collected = transcript.collectTranscript({
    readers,
    projectRoot,
    sessionId,
    env: process.env,
  });
  const found = collected.transcript;
  const text = found ? `${transcript.renderFile(found).join('\n')}\n` : null;

  /** @type {string | null} */
  let file = null;
  if (found && text !== null && outDir) {
    file = path.join(outDir, transcript.transcriptFileName(found.id));
    try {
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(file, text);
    } catch (err) {
      throw new WriteFailureError(
        'The installer CLI could not write the transcript file.',
        err instanceof Error ? err.message : String(err),
        'Check the file permission and the available disk space, or name another directory with "--out".'
      );
    }
  }

  report.section(transcript.SUMMARY_TITLE);
  for (const line of transcript.renderSummary({ version, projectRoot, transcript: found, file })) {
    report.line(line);
  }

  if (collected.notes.length > 0) {
    report.line();
    for (const note of collected.notes) report[note.level](note.text);
  }

  if (found && text !== null && !outDir) {
    report.line();
    stdout.write(text);
  }

  return 0;
}

/**
 * Run "render": write the tree of one harness into an empty directory.
 *
 * The render path reads no marker and it writes none. It renders one
 * harness into a directory that holds no project, so there is no harness
 * set to resolve and no install to record. render() therefore falls back to
 * the source glossary bytes, and the output holds the one-harness base case
 * of section 3.2, byte for byte.
 *
 * @param {{ adapter: import('../adapters/index.js').Adapter, pluginRoot: string, outDir: string, report: ReturnType<typeof createReporter> }} args
 * @returns {number}
 */
function runRender({ adapter, pluginRoot, outDir, report }) {
  if (fs.existsSync(outDir)) {
    const entries = fs.readdirSync(outDir);
    if (entries.length > 0) {
      throw new UsageError(
        `The output directory "${outDir}" is not empty.`,
        '"render" refuses to write into a directory that already holds an entry.',
        'Name an empty or a new directory with "--out", then run the command again.'
      );
    }
  } else {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const source = readSource({
    pluginRoot,
    harnessId: adapter.id,
    glossaryHarnessId: adapter.glossaryHarnessId,
  });

  const { rendered } = render({ source, adapter });
  const plan = planInstall({
    rendered,
    projectRoot: outDir,
    harnessRoot: adapter.harnessRoot,
    manifest: null,
    includeGitignoreAndDocs: false,
  });

  apply(plan, {
    projectRoot: outDir,
    pluginRoot,
    adapter,
    source,
    reporter: report,
    dryRun: false,
    mode: 'render',
  });

  return 0;
}

const isMainModule =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMainModule) {
  process.exitCode = main(process.argv.slice(2));
}
