// installer/lib/orca/setup.js
//
// The facts and the write of `/orca-setup` (Decision 15). `detect()` reads
// the machine and the project: the Orca CLI, the installed harnesses and
// their commands on PATH, the state of `.beast-mode/orca.json`, the launch
// table, and a suggestion per stage. It writes nothing. `writeOrchestration()`
// sets the `orchestration` key of that file and keeps every other key in its
// place. It copies the rules of `orca/src/launch/config-file.ts` (copied, not
// shared: the installer has no dependency). Every Orca call goes through
// exec.js, so this file imports no child process module. The PATH search
// uses `fs` only.

import fs from 'node:fs';
import path from 'node:path';

import { adapters } from '../../adapters/index.js';
import { split as splitFrontmatter } from '../frontmatter.js';
import * as manifestLib from '../manifest.js';
import * as marker from '../marker.js';
import { render } from '../plan.js';
import { readSource } from '../source.js';
import { AGENT_IDS, ORCA_JSON_MAX_BYTES, ORCA_JSON_REL, parseOrcaConfig, readOrcaConfig, writeFileAtomic } from './read.js';
import { call, orcaCalls } from './exec.js';

/** The `.beast-mode` folder, relative to the project root. */
const BEAST_MODE_DIR = '.beast-mode';

/** The Windows default of PATHEXT, used when the variable is unset. */
const DEFAULT_PATHEXT = '.COM;.EXE;.BAT;.CMD';

/** The A3 defaults: plan and review on claude, the rest on dsh. */
const A3_PLAN = 'claude';
const A3_IMPLEMENT = 'dsh';
const A3_REVIEW = 'claude';

/**
 * @param {unknown} value
 * @returns {value is Record<string, any>}
 */
function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// The PATH search
// ---------------------------------------------------------------------------

/**
 * @param {Record<string, string | undefined>} env
 * @param {string} name
 * @param {string} platform
 * @returns {string} The value of one variable. Windows names are not case sensitive.
 */
function envValue(env, name, platform) {
  if (typeof env[name] === 'string') return /** @type {string} */ (env[name]);
  if (platform !== 'win32') return '';
  const key = Object.keys(env).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key !== undefined && typeof env[key] === 'string' ? /** @type {string} */ (env[key]) : '';
}

/**
 * @param {string} file
 * @param {string} platform
 * @returns {boolean} True for a regular file that the user can run.
 */
function isRunnable(file, platform) {
  try {
    if (!fs.statSync(file).isFile()) return false;
    if (platform !== 'win32') fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Search PATH for a command with `fs` only. A command with a path separator
 * is checked where it stands. On Windows each extension of PATHEXT is tried,
 * and the bare name counts when it already ends in one of them. Never throws.
 *
 * @param {string} command
 * @param {Record<string, string | undefined>} env
 * @param {string} platform
 * @returns {string | null} The path of the command, else null.
 */
export function findOnPath(command, env, platform) {
  if (typeof command !== 'string' || command.length === 0) return null;
  const win = platform === 'win32';
  const extensions = win
    ? (envValue(env, 'PATHEXT', platform) || DEFAULT_PATHEXT).split(';').filter((ext) => ext.length > 0)
    : [''];
  const names = win
    ? [
        ...(extensions.some((ext) => command.toLowerCase().endsWith(ext.toLowerCase())) ? [command] : []),
        ...extensions.map((ext) => `${command}${ext}`),
      ]
    : [command];
  const hasSeparator = command.includes('/') || (win && command.includes('\\'));
  const directories = hasSeparator ? [''] : envValue(env, 'PATH', platform).split(win ? ';' : ':').filter((dir) => dir.length > 0);
  for (const directory of directories) {
    for (const name of names) {
      const file = directory === '' ? name : path.join(directory, name);
      if (isRunnable(file, platform)) return file;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// The facts of the settings file
// ---------------------------------------------------------------------------

/**
 * @param {Record<string, any> | undefined} commands The `commands` object of the file.
 * @param {string} name A launch command, for example "plan-feature".
 * @returns {string | null} The mapped agent id when it is a known one, else null.
 */
function launchAgent(commands, name) {
  if (!isPlainObject(commands)) return null;
  const value = commands[name];
  return typeof value === 'string' && AGENT_IDS.includes(value) ? value : null;
}

/**
 * The state of `.beast-mode/orca.json` as the setup skill reads it.
 *
 * @param {string} projectRoot
 * @returns {{
 *   file: string,
 *   state: 'missing' | 'invalid' | 'valid',
 *   problems: { code: string, at: string }[],
 *   hasOrchestration: boolean,
 *   orchestration: Record<string, any> | null,
 *   resolved: Record<string, any> | null,
 *   launchTable: { plan: string | null, implement: string | null },
 *   agents: Record<string, any>,
 * }}
 */
export function readConfigFacts(projectRoot) {
  const read = readOrcaConfig(projectRoot);
  if (read.state !== 'valid') {
    return {
      file: ORCA_JSON_REL,
      state: read.state,
      problems: read.state === 'invalid' ? read.problems : [],
      hasOrchestration: false,
      orchestration: null,
      resolved: null,
      launchTable: { plan: null, implement: null },
      agents: {},
    };
  }
  const raw = read.config.orchestration;
  return {
    file: ORCA_JSON_REL,
    state: 'valid',
    problems: [],
    hasOrchestration: read.orchestration !== null,
    orchestration: isPlainObject(raw) ? raw : null,
    resolved: read.orchestration,
    launchTable: {
      plan: launchAgent(read.config.commands, 'plan-feature'),
      implement: launchAgent(read.config.commands, 'autorun-feature'),
    },
    agents: isPlainObject(read.config.agents) ? read.config.agents : {},
  };
}

/**
 * @param {Record<string, any>} agents The `agents` object of the file.
 * @param {string} id
 * @returns {string} The first word of `agents.<id>.command`, else the id.
 */
function agentCommand(agents, id) {
  const entry = agents[id];
  const text = isPlainObject(entry) && typeof entry.command === 'string' ? entry.command.trim() : '';
  const word = text.split(' ')[0];
  return word.length > 0 ? word : id;
}

/**
 * @param {string[]} usable
 * @param {string} preferred
 * @returns {string | null} The preferred id when it is usable, else the first usable id, else null.
 */
function pickUsable(usable, preferred) {
  if (usable.includes(preferred)) return preferred;
  return usable.length > 0 ? usable[0] : null;
}

/**
 * The suggested stages: plan and implement from the launch table when it
 * maps `plan-feature` and `autorun-feature`, else the A3 defaults. `verify`
 * and `docs` follow `implement`, and `review` is the A3 default. An id that
 * is not usable gives way to the first usable id, and a machine with no
 * usable id suggests null.
 *
 * @param {{ plan: string | null, implement: string | null }} table
 * @param {string[]} usable
 * @returns {{ stages: Record<string, string | null>, source: 'launch-table' | 'defaults' }}
 */
export function suggestStages(table, usable) {
  const implement = pickUsable(usable, table.implement ?? A3_IMPLEMENT);
  const stages = {
    plan: pickUsable(usable, table.plan ?? A3_PLAN),
    implement,
    verify: implement,
    review: pickUsable(usable, A3_REVIEW),
    docs: implement,
  };
  return { stages, source: table.plan !== null || table.implement !== null ? 'launch-table' : 'defaults' };
}

// ---------------------------------------------------------------------------
// detect
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} DetectContext What detect() needs. A StepRun of steps.js is one.
 * @property {import('./exec.js').Runner} runner
 * @property {string} orca The Orca executable, chosen once.
 * @property {string} projectRoot
 * @property {string} [pluginRoot] The plugin root. With none, an edited autorun skill lists no added line.
 * @property {Record<string, string | undefined>} env
 * @property {string} [platform] Default: process.platform.
 * @property {(ms: number) => void} [sleep]
 */

/**
 * The Orca CLI from `status --json`. A spawn that finds no executable means
 * "not found". Any other answer proves the executable runs, and `running`
 * needs the app and its runtime up.
 *
 * @param {DetectContext} ctx
 * @returns {{ executable: string, found: boolean, running: boolean, detail: string[] }}
 */
function readOrca(ctx) {
  const answer = /** @type {import('./exec.js').OrcaAnswer} */ (call(/** @type {any} */ (ctx), orcaCalls.status()));
  const executable = ctx.orca;
  if (answer.kind === 'spawn-error') {
    return { executable, found: answer.code !== 'not-found', running: false, detail: answer.detail };
  }
  if (answer.kind !== 'ok') return { executable, found: true, running: false, detail: answer.detail };
  const result = isPlainObject(answer.result) ? answer.result : {};
  const app = isPlainObject(result.app) ? result.app : {};
  const runtime = isPlainObject(result.runtime) ? result.runtime : {};
  const running = app.running === true && runtime.reachable === true;
  return {
    executable,
    found: true,
    running,
    detail: running
      ? []
      : [`${executable} status: app.running is ${String(app.running)}, runtime.reachable is ${String(runtime.reachable)}.`],
  };
}

// ---------------------------------------------------------------------------
// The step suggestions (Decision 17): project skills and edited autorun skills
// ---------------------------------------------------------------------------

/** The autorun skills whose added lines can name a step (Decision 17). */
const AUTORUN_SKILLS = ['autorun-feature', 'autorun-epic'];

/** The most added lines that one edited autorun skill lists. */
const MAX_ADDED_LINES = 60;

/** The longest description that a project skill lists. */
const MAX_DESCRIPTION = 300;

/** The largest SKILL.md that `detect` reads. */
const MAX_SKILL_BYTES = 262144;

/**
 * @param {import('../../adapters/index.js').Adapter} adapter
 * @returns {string | null} The skills directory of the harness, project-relative, for example ".claude/skills".
 */
function skillsDirOf(adapter) {
  const destination = adapter.destination({ kind: 'skill', name: 'x', relPath: 'SKILL.md', sourcePath: '' });
  return typeof destination === 'string' ? path.posix.dirname(path.posix.dirname(destination)) : null;
}

/**
 * @param {string} file
 * @returns {string | null} The text of a regular file under the size cap, else null.
 */
function readSmallFile(file) {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > MAX_SKILL_BYTES) return null;
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

/**
 * The `description` of a SKILL.md: the frontmatter reader of the
 * installer, else the first `description:` line (a frontmatter that the
 * scalar parser refuses still has one). Null with none. Never throws.
 *
 * @param {string} text
 * @returns {string | null}
 */
function descriptionOf(text) {
  let value = null;
  try {
    value = splitFrontmatter(text)?.data.description ?? null;
  } catch {
    value = null;
  }
  if (value === null) {
    const line = /^description:[ \t]*(.+)$/m.exec(text);
    value = line ? line[1].trim().replace(/^(["'])(.*)\1$/, '$2') : null;
  }
  if (value === null || value.length === 0) return null;
  return value.length > MAX_DESCRIPTION ? `${value.slice(0, MAX_DESCRIPTION)}...` : value;
}

/**
 * @param {string} projectRoot
 * @param {{ id: string, harnessRoot: string }} harness
 * @returns {import('../manifest.js').Manifest | null} The manifest of the harness, null when it is missing or unusable.
 */
function manifestOf(projectRoot, harness) {
  try {
    return manifestLib.read({ path: manifestLib.manifestPath(projectRoot, harness.harnessRoot), harnessId: harness.id });
  } catch {
    return null;
  }
}

/**
 * @param {string | undefined} pluginRoot
 * @param {import('../../adapters/index.js').Adapter} adapter
 * @returns {{ skills: Set<string>, rendered: Map<string, string> } | null}
 *   The skill names that the plugin ships, and the rendered text of each skill file for the harness. Null with no readable source.
 */
function sourceOf(pluginRoot, adapter) {
  if (!pluginRoot) return null;
  try {
    const source = readSource({ pluginRoot, harnessId: adapter.id, glossaryHarnessId: adapter.glossaryHarnessId });
    const { rendered } = render({ source, adapter });
    return {
      skills: new Set(source.entries.filter((entry) => entry.kind === 'skill').map((entry) => entry.name)),
      rendered: new Map(
        rendered
          .filter((item) => item.kind === 'skill')
          .map((item) => [item.destination, Buffer.isBuffer(item.content) ? item.content.toString('utf8') : String(item.content)])
      ),
    };
  } catch {
    return null;
  }
}

/**
 * The lines of a file that a source text does not hold: exact text, with
 * the trailing space ignored and the blank lines dropped, in file order.
 *
 * @param {string} disk
 * @param {string} source
 * @returns {string[]}
 */
function addedLines(disk, source) {
  const held = new Set(source.split(/\r?\n/).map((line) => line.trimEnd()));
  return disk
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0 && !held.has(line));
}

/**
 * The step suggestions of one harness (Decision 17). `projectSkills`: each
 * skill folder in the harness skills directory that the plugin does not
 * ship, with its `description`. `editedAutoruns`: an `autorun-feature` or
 * `autorun-epic` file whose disk hash differs from its manifest hash, with
 * the lines that the plugin source does not hold. A harness with no
 * manifest has no hash to compare, so it lists no edited autorun. Reads
 * only. Never throws.
 *
 * @param {string} projectRoot
 * @param {string | undefined} pluginRoot
 * @param {{ id: string, harnessRoot: string }} harness
 * @returns {{ projectSkills: Record<string, any>[], editedAutoruns: Record<string, any>[] }}
 */
function stepSuggestions(projectRoot, pluginRoot, harness) {
  const adapter = adapters[harness.id];
  const dir = adapter ? skillsDirOf(adapter) : null;
  if (!adapter || dir === null) return { projectSkills: [], editedAutoruns: [] };
  const manifestData = manifestOf(projectRoot, harness);
  const source = sourceOf(pluginRoot, adapter);

  // Each skill folder of the manifest is the plugin's, also one that a later version stopped shipping.
  const owned = new Set();
  for (const file of manifestData?.files ?? []) {
    const rest = file.destination.startsWith(`${dir}/`) ? file.destination.slice(dir.length + 1) : '';
    if (rest.includes('/')) owned.add(rest.split('/')[0]);
  }

  /** @type {Record<string, any>[]} */
  const projectSkills = [];
  let names = [];
  try {
    names = fs.readdirSync(path.join(projectRoot, ...dir.split('/'))).sort();
  } catch {
    names = [];
  }
  for (const name of names) {
    if (owned.has(name) || source?.skills.has(name)) continue;
    const text = readSmallFile(path.join(projectRoot, ...dir.split('/'), name, 'SKILL.md'));
    if (text === null) continue;
    projectSkills.push({ harness: harness.id, name, description: descriptionOf(text), path: `${dir}/${name}/SKILL.md` });
  }

  /** @type {Record<string, any>[]} */
  const editedAutoruns = [];
  for (const skill of AUTORUN_SKILLS) {
    const destination = `${dir}/${skill}/SKILL.md`;
    const entry = manifestData?.files.find((file) => file.destination === destination && file.owned && file.sha256);
    if (!entry) continue;
    const disk = readSmallFile(path.join(projectRoot, ...destination.split('/')));
    if (disk === null || manifestLib.sha256(disk) === entry.sha256) continue;
    const text = source?.rendered.get(destination);
    const lines = typeof text === 'string' ? addedLines(disk, text) : [];
    editedAutoruns.push({
      harness: harness.id,
      skill,
      path: destination,
      sourceFound: typeof text === 'string',
      added: lines.slice(0, MAX_ADDED_LINES),
      more: Math.max(0, lines.length - MAX_ADDED_LINES),
    });
  }
  return { projectSkills, editedAutoruns };
}

/**
 * Read the facts that `/orca-setup` needs. Writes nothing. One Orca call
 * (`status --json`), no git call. `projectSkills` and `editedAutoruns` feed
 * the step suggestions (Decision 17).
 *
 * @param {DetectContext} ctx
 * @returns {Record<string, any>}
 */
export function detect(ctx) {
  const platform = ctx.platform ?? process.platform;
  const orca = readOrca(ctx);
  const config = readConfigFacts(ctx.projectRoot);

  const { marker: current } = marker.read(ctx.projectRoot);
  const resolved = marker.resolve({ projectRoot: ctx.projectRoot, marker: current, adapters });
  const projectSkills = [];
  const editedAutoruns = [];
  for (const harness of resolved) {
    const found = stepSuggestions(ctx.projectRoot, ctx.pluginRoot, harness);
    projectSkills.push(...found.projectSkills);
    editedAutoruns.push(...found.editedAutoruns);
  }
  const harnesses = resolved.map((harness) => {
    const command = agentCommand(config.agents, harness.id);
    const found = findOnPath(command, ctx.env, platform);
    return { id: harness.id, command, onPath: found !== null, path: found, usable: found !== null };
  });
  const usable = harnesses.filter((harness) => harness.usable).map((harness) => harness.id);

  const suggested = suggestStages(config.launchTable, usable);
  const offer = orca.found && !(config.state === 'valid' && config.hasOrchestration) ? 'setup' : 'none';

  return {
    orca,
    harnesses,
    usable,
    config,
    suggested,
    projectSkills,
    editedAutoruns,
    offer,
  };
}

// ---------------------------------------------------------------------------
// writeOrchestration
// ---------------------------------------------------------------------------

/**
 * The lstat guard of one path (the rule of `guardPath` in config-file.ts). A
 * missing path passes, because a create follows. A link never passes. The
 * kind must match: a real folder for `.beast-mode`, a regular file for
 * `orca.json`. A stat fault other than ENOENT does not pass.
 *
 * @param {string} target
 * @param {'dir' | 'file'} kind
 * @returns {boolean}
 */
function guardPath(target, kind) {
  let stat;
  try {
    stat = fs.lstatSync(target);
  } catch (err) {
    return /** @type {NodeJS.ErrnoException} */ (err)?.code === 'ENOENT';
  }
  if (stat.isSymbolicLink()) return false;
  return kind === 'dir' ? stat.isDirectory() : stat.isFile();
}

/**
 * @typedef {{ ok: true, created: boolean, replaced: boolean, file: string, text: string }
 *   | { ok: false, code: string, say: string, detail: string[], problems: { code: string, at: string }[] }} WriteAnswer
 */

/**
 * @param {string} code
 * @param {string} say
 * @param {string[]} [detail]
 * @param {{ code: string, at: string }[]} [problems]
 * @returns {WriteAnswer}
 */
function refused(code, say, detail = [], problems = []) {
  return { ok: false, code, say, detail, problems };
}

/**
 * Set the `orchestration` key of `.beast-mode/orca.json`, by the rules of
 * `config-file.ts`:
 *
 * - The lstat guards run first. A link, or a folder where a file belongs,
 *   is refused and nothing changes.
 * - An invalid current file is refused with its bytes unchanged.
 * - The `orchestration` value is replaced in place. When the key is absent,
 *   it goes last. Every other key stays, in its place. A new file is
 *   `{ "version": 1, "orchestration": ... }`.
 * - The result must pass the schema and the 64 KiB cap, else nothing is
 *   written.
 * - The text is 2-space JSON with a final newline, written to a temporary
 *   file that is renamed over the target.
 *
 * Never throws.
 *
 * @param {string} projectRoot
 * @param {unknown} orchestration The value of the `orchestration` key.
 * @returns {WriteAnswer}
 */
export function writeOrchestration(projectRoot, orchestration) {
  try {
    return writeOf(projectRoot, orchestration);
  } catch (err) {
    return refused('write-failed', 'The settings file could not be written.', [err instanceof Error ? err.message : String(err)]);
  }
}

/**
 * @param {string} projectRoot
 * @param {unknown} orchestration
 * @returns {WriteAnswer}
 */
function writeOf(projectRoot, orchestration) {
  if (!isPlainObject(orchestration)) {
    return refused('bad-input', 'The orchestration settings must be one JSON object.', [
      `The value is ${Array.isArray(orchestration) ? 'an array' : orchestration === null ? 'null' : typeof orchestration}.`,
    ]);
  }

  const dirPath = path.join(projectRoot, BEAST_MODE_DIR);
  const filePath = path.join(projectRoot, ...ORCA_JSON_REL.split('/'));
  if (!guardPath(dirPath, 'dir') || !guardPath(filePath, 'file')) {
    return refused('config-not-file', `${BEAST_MODE_DIR} or ${ORCA_JSON_REL} is a link or the wrong kind of path.`, [
      `${ORCA_JSON_REL} must be a regular file in a real folder. Nothing was written.`,
    ]);
  }

  /** @type {string | null} */
  let before = null;
  try {
    before = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err)?.code !== 'ENOENT') {
      return refused('config-unreadable', `${ORCA_JSON_REL} cannot be read.`, [err instanceof Error ? err.message : String(err)]);
    }
  }

  /** @type {Record<string, unknown>} */
  let merged;
  let replaced = false;
  if (before === null) {
    merged = { version: 1, orchestration };
  } else {
    const parsed = parseOrcaConfig(before);
    if (parsed.state === 'invalid') {
      const code = parsed.problems.some((problem) => problem.code === 'config-too-large') ? 'config-too-large' : 'config-invalid';
      return refused(code, `${ORCA_JSON_REL} fails the schema, so it was left as it is.`, parsed.problems.map((problem) => `${problem.code} at ${problem.at}`), parsed.problems);
    }
    if (parsed.state !== 'valid') return refused('config-invalid', `${ORCA_JSON_REL} holds no usable settings.`);
    merged = parsed.config;
    replaced = Object.prototype.hasOwnProperty.call(merged, 'orchestration');
    // An assignment keeps the place of an existing key, and appends a new one.
    merged.orchestration = orchestration;
  }

  const text = `${JSON.stringify(merged, null, 2)}\n`;
  const after = parseOrcaConfig(text);
  if (after.state === 'invalid') {
    const code = after.problems.some((problem) => problem.code === 'config-too-large') ? 'config-too-large' : 'config-invalid';
    return refused(
      code,
      `The merged settings fail the schema, so nothing was written.`,
      after.problems.map((problem) => `${problem.code} at ${problem.at}`),
      after.problems
    );
  }
  if (Buffer.byteLength(text, 'utf8') > ORCA_JSON_MAX_BYTES) {
    return refused('config-too-large', `The merged settings hold more than ${ORCA_JSON_MAX_BYTES} bytes.`);
  }

  try {
    fs.mkdirSync(dirPath, { recursive: true });
  } catch (err) {
    return refused('write-failed', `${BEAST_MODE_DIR} cannot be created.`, [err instanceof Error ? err.message : String(err)]);
  }

  try {
    writeFileAtomic(filePath, text);
  } catch (err) {
    return refused('write-failed', `${ORCA_JSON_REL} cannot be written.`, [err instanceof Error ? err.message : String(err)]);
  }
  return { ok: true, created: before === null, replaced, file: ORCA_JSON_REL, text };
}
