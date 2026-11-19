// installer/lib/apply.js
//
// Runs an install plan: creates the directories, writes the files, edits
// .gitignore, runs the adapter's post-install check, and writes the
// manifest last, so a crash never leaves a manifest that claims a file the
// CLI did not write. "--dry-run" stops before any of that and only prints
// the plan (see lib/plan.js printPlan()).
//
// The upgrade path runs a fixed order too: back up, write, prune, run the
// adapter check, write the manifest. It creates the backup directory only
// when the plan holds a destructive action, and it re-reads every file it
// is about to destroy, so it never deletes or overwrites a file whose hash
// it did not read first.

import fs from 'node:fs';
import path from 'node:path';

import { manifestPath as buildManifestPath, sha256, write as writeManifest } from './manifest.js';
import {
  LABELS,
  REASON_EDITED,
  REASON_EXISTED,
  addGitignoreLines,
  countUpgradeActions,
  needsBackup,
  printPlan,
  printSkipList,
  printUpgradeCounts,
  printUpgradeGroups,
  printUpgradeHints,
  writesContent,
} from './plan.js';

/** @typedef {import('../adapters/index.js').Adapter} Adapter */

/**
 * @param {string} projectRoot
 * @param {string} relDir Project-relative, forward slashes.
 * @returns {void}
 */
function ensureDir(projectRoot, relDir) {
  fs.mkdirSync(path.join(projectRoot, ...relDir.split('/')), { recursive: true });
}

/**
 * @param {string} projectRoot
 * @param {import('./plan.js').PlanAction} item
 * @returns {void}
 */
function writeAction(projectRoot, item) {
  const full = path.join(projectRoot, ...item.destination.split('/'));
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, item.content);
}

/**
 * @param {string} projectRoot
 * @param {import('./plan.js').PlanAction[]} items
 * @param {ReturnType<typeof import('./report.js').createReporter>} reporter
 * @param {{ folderPerSkill?: boolean }} [opts]
 * @returns {void}
 */
function writeGroup(projectRoot, items, reporter, opts = {}) {
  const printedSkills = new Set();
  for (const item of items) {
    if (item.action === 'skip') {
      reporter.warn(`Skipped (already exists): ${item.destination}`);
      continue;
    }
    writeAction(projectRoot, item);
    if (opts.folderPerSkill) {
      if (printedSkills.has(item.name)) continue;
      printedSkills.add(item.name);
      reporter.ok(`Copied: ${path.posix.dirname(item.destination)}/`);
    } else {
      reporter.ok(`Copied: ${item.destination}`);
    }
  }
}

/**
 * @param {import('./plan.js').PlanAction[]} actions
 * @param {string} kind
 * @returns {import('./plan.js').PlanAction[]}
 */
function byKind(actions, kind) {
  return actions.filter((a) => a.kind === kind);
}

/**
 * Build the manifest file list from the applied plan. Only source-backed
 * kinds (skill, agent, dev-doc, format) get a manifest entry. ".gitignore",
 * the synthesized extra files (for example the version marker), and the
 * shared harness glossary all carry no entry: an upgrade always overwrites
 * an extra file, and the core composes the shared glossary from the whole
 * harness set, so no single harness manifest may own it.
 *
 * @param {import('./plan.js').PlanAction[]} actions
 * @returns {import('./manifest.js').ManifestFileEntry[]}
 */
function buildManifestFiles(actions) {
  const files = [];
  for (const item of actions) {
    if (item.kind === 'extra' || item.kind === 'shared') continue;

    if (item.action === 'skip') {
      files.push({
        destination: item.destination,
        source: item.source ?? undefined,
        owned: false,
        reason: item.reason ?? 'the file already existed at install time',
      });
    } else {
      files.push({
        destination: item.destination,
        source: item.source ?? undefined,
        sha256: sha256(item.content),
        owned: true,
      });
    }
  }
  return files;
}

/**
 * @param {import('./plan.js').PlanAction[]} actions
 * @returns {string[]}
 */
function skillNamesFromActions(actions) {
  return [...new Set(byKind(actions, 'skill').map((a) => a.name))].sort();
}

/**
 * Apply a plan. Dispatches on the plan mode: planInstall() produces an
 * install (or render) plan, planUpgrade() produces an upgrade plan.
 *
 * @param {ReturnType<typeof import('./plan.js').planInstall> | ReturnType<typeof import('./plan.js').planUpgrade>} plan
 * @param {ApplyContext} ctx
 * @returns {ApplyResult}
 */
export function apply(plan, ctx) {
  if (plan.mode === 'upgrade') {
    return applyUpgrade(/** @type {any} */ (plan), ctx);
  }
  return applyInstall(/** @type {any} */ (plan), ctx);
}

/**
 * @typedef {Object} ApplyContext
 * @property {string} projectRoot
 * @property {string} pluginRoot
 * @property {Adapter} adapter
 * @property {{ version: string }} source
 * @property {ReturnType<typeof import('./report.js').createReporter>} reporter
 * @property {boolean} [dryRun]
 * @property {'install' | 'render' | 'upgrade'} [mode]
 */

/**
 * @typedef {Object} ApplyResult
 * @property {string | null} manifestPath
 * @property {{ ok: boolean, notes: string[] } | null} checkResult
 * @property {string | null} [backupDir]
 * @property {Record<string, number>} [counts]
 * @property {import('./plan.js').UpgradeAction[]} [applied]
 */

/**
 * Apply an install (or render) plan.
 *
 * @param {ReturnType<typeof import('./plan.js').planInstall>} plan
 * @param {ApplyContext} ctx
 * @returns {ApplyResult}
 */
function applyInstall(plan, { projectRoot, pluginRoot, adapter, source, reporter, dryRun = false, mode = 'install' }) {
  if (dryRun) {
    printPlan(plan, reporter);
    return { manifestPath: null, checkResult: null };
  }

  for (const dir of plan.dirs) {
    ensureDir(projectRoot, dir);
  }

  reporter.section('📋 Installing command skills...');
  writeGroup(projectRoot, byKind(plan.actions, 'skill'), reporter, { folderPerSkill: true });
  reporter.ok(`Installed ${plan.summary.skillsWritten} command skills`);

  reporter.section('🤖 Installing agent templates...');
  writeGroup(projectRoot, byKind(plan.actions, 'agent'), reporter);
  const { agentsWritten } = plan.summary;
  reporter.ok(`Installed ${agentsWritten} agent templates`);

  reporter.section('📝 Installing feature doc templates...');
  writeGroup(projectRoot, byKind(plan.actions, 'dev-doc'), reporter);
  reporter.ok(`Installed ${plan.summary.devDocsWritten} feature doc templates`);

  reporter.section('📚 Installing format references...');
  writeGroup(projectRoot, byKind(plan.actions, 'format'), reporter);
  reporter.ok(`Installed ${plan.summary.formatsWritten} format references`);

  reporter.section('🧭 Composing the harness glossary...');
  writeGroup(projectRoot, byKind(plan.actions, 'shared'), reporter);

  applyGitignore(plan.gitignore, { projectRoot, reporter });

  reporter.section('📝 Writing version file...');
  writeGroup(projectRoot, byKind(plan.actions, 'extra'), reporter);

  let checkResult = null;
  if (mode === 'install' && typeof adapter.check === 'function') {
    checkResult = adapter.check({
      projectRoot,
      skillNames: skillNamesFromActions(plan.actions),
      pluginRoot,
    });
    if (checkResult && checkResult.ok === false) {
      reporter.line();
      for (const note of checkResult.notes) {
        reporter.warn(note);
      }
    }
  }

  const manifestData = {
    schema: 1,
    beastModeVersion: source.version,
    harness: adapter.id,
    harnessRoot: adapter.harnessRoot,
    generated: new Date().toISOString(),
    files: buildManifestFiles(plan.actions),
  };
  const mPath = buildManifestPath(projectRoot, adapter.harnessRoot);
  writeManifest(mPath, manifestData);

  reporter.section('✅ TEMPLATES INSTALLED!');
  reporter.line('Installed:');
  reporter.line(`  ✓ ${plan.summary.skillsWritten} command skills (${adapter.harnessRoot}/skills/)`);
  // The agent destination differs by harness, so read it from the plan.
  const agentAction = plan.actions.find((item) => item.kind === 'agent');
  const agentDir = agentAction
    ? `${path.posix.dirname(agentAction.destination)}/`
    : `${adapter.harnessRoot}/agents/`;
  reporter.line(`  ✓ ${agentsWritten} agent templates (${agentDir})`);
  reporter.line(`  ✓ ${plan.summary.devDocsWritten} feature doc templates (.beast-mode/templates/)`);
  reporter.line(`  ✓ ${plan.summary.formatsWritten} format references (.beast-mode/)`);
  reporter.line('  ✓ Harness glossary (.beast-mode/harness.md)');
  if (plan.gitignore) {
    reporter.line('  ✓ Directory structure (docs/features/)');
    reporter.line('  ✓ Updated .gitignore');
  }
  reporter.line(`  ✓ Version file (v${source.version})`);
  reporter.line(`  ✓ Manifest (${path.posix.join(adapter.harnessRoot, '.beast-mode-manifest.json')})`);
  reporter.line();
  if (mode === 'install') {
    reporter.line('Commit .beast-mode/ with the project. Every harness reads it.');
    reporter.line();
    reporter.rule();
  }

  return { manifestPath: mPath, checkResult };
}

/**
 * Run the .gitignore step of a plan. Creates the file when it is missing,
 * then adds every owned line that the file misses today. The planner tests
 * one line at a time and puts the missing lines in "state.lines", so a
 * second pass adds nothing, and a project that holds the backup line of an
 * earlier version gains the briefs line only.
 *
 * The writer adds the block header only for a file that holds no header
 * yet, so a project of an earlier version keeps one header. A file that
 * already holds the header gains the new line inside the block. The pure
 * function addGitignoreLines() holds the whole text rule, and lib/plan.js
 * owns it beside the line rules it reads.
 *
 * Both planners produce the same state object, so an install and an upgrade
 * write the same block.
 *
 * @param {import('./plan.js').GitignoreState | null} state
 * @param {{ projectRoot: string, reporter: ReturnType<typeof import('./report.js').createReporter> }} ctx
 * @returns {void}
 */
function applyGitignore(state, { projectRoot, reporter }) {
  if (!state) return;

  reporter.section('📄 Updating .gitignore...');
  const gitignoreFile = path.join(projectRoot, '.gitignore');
  if (state.create) {
    fs.writeFileSync(gitignoreFile, '');
    reporter.ok('Created .gitignore');
  }
  if (state.appendAction === 'append') {
    // The planner read the file, but the writer reads it again, because the
    // text names the one true place of the block. A file that went away
    // between the two steps reads as an empty text, so the writer builds the
    // whole block again and the run still ends with a good file.
    const text = fs.existsSync(gitignoreFile) ? fs.readFileSync(gitignoreFile, 'utf8') : '';
    fs.writeFileSync(gitignoreFile, addGitignoreLines(text, state));
    reporter.ok('Added Beast Mode entries to .gitignore');
  } else {
    reporter.info('Beast Mode entries already in .gitignore');
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// The backup directory
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Format one local timestamp as YYYYMMDD-HHMMSS, the format that
 * scripts/migrate-v4-to-v5.sh produces with `date +%Y%m%d-%H%M%S`.
 *
 * @param {Date} now
 * @returns {string}
 */
function timestamp(now) {
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  );
}

/**
 * Choose the backup directory: "<harnessRoot>/.beast-mode-backup-<stamp>".
 * Two runs inside the same second would share one directory, so the second
 * run appends "-2", the third "-3", and so on. This is the naming rule of
 * scripts/migrate-v4-to-v5.sh. The function creates no directory.
 *
 * @param {string} projectRoot
 * @param {string} harnessRoot Project-relative harness root, from the adapter.
 * @param {Date} [now]
 * @returns {string} An absolute path.
 */
export function chooseBackupDir(projectRoot, harnessRoot, now = new Date()) {
  const base = path.join(
    projectRoot,
    ...harnessRoot.split('/'),
    `.beast-mode-backup-${timestamp(now)}`
  );
  if (!fs.existsSync(base)) return base;

  let suffix = 2;
  while (fs.existsSync(`${base}-${suffix}`)) {
    suffix += 1;
  }
  return `${base}-${suffix}`;
}

/**
 * Copy one file into the backup directory, keeping the destination shape:
 * ".beast-mode/epic-resolution.md" lands at
 * "<backup>/.beast-mode/epic-resolution.md", and
 * "<harnessRoot>/skills/x/SKILL.md" lands at
 * "<backup>/<harnessRoot>/skills/x/SKILL.md". The path comes from the
 * project-relative destination alone, so this module names no harness path.
 *
 * @param {string} backupDir
 * @param {string} relDestination Project-relative, forward slashes.
 * @param {Buffer} bytes The exact bytes read from disk.
 * @returns {string} The absolute backup path.
 */
function writeBackup(backupDir, relDestination, bytes) {
  const target = path.join(backupDir, ...relDestination.split('/'));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes);
  return target;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// The upgrade path
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Turn a destructive action into a safe one, because the file on disk no
 * longer holds the content the plan hashed. Something changed the file
 * between the plan and the apply step. The CLI never destroys a file whose
 * current hash it did not read, so the action becomes a skip or a keep and
 * the run reports it.
 *
 * @param {import('./plan.js').UpgradeAction} item Mutated in place.
 * @param {'changed' | 'missing'} why
 * @param {ReturnType<typeof import('./report.js').createReporter>} reporter
 * @returns {void}
 */
function downgrade(item, why, reporter) {
  if (item.action === 'prune') {
    if (why === 'missing') {
      item.action = 'drop';
      item.label = null;
      item.bucket = 'dropped';
      return;
    }
    item.action = 'keep';
    item.label = LABELS.kept;
    item.bucket = 'kept';
    reporter.warn(`Changed since the plan, so the file stays: ${item.destination}`);
    return;
  }

  // An overwrite or a forced write whose target vanished is a plain write
  // now. Nothing can be lost, so the write goes ahead with no backup.
  if (why === 'missing') {
    item.action = 'write';
    item.label = item.manifestHash ? LABELS.restored : LABELS.added;
    item.bucket = item.manifestHash ? 'restored' : 'added';
    return;
  }

  // The skip that replaces the write must match the ownership the manifest
  // records. A conflict carries the old owned hash forward, so a file with
  // no owned hash becomes a plain "skip (yours)" instead.
  if (item.manifestHash) {
    item.action = 'conflict';
    item.label = LABELS.conflict;
    item.reason = REASON_EDITED;
  } else {
    item.action = 'skip';
    item.label = LABELS.skipped;
    item.reason = REASON_EXISTED;
  }
  item.bucket = 'skipped';
  reporter.warn(`Changed since the plan, so Beast Mode skipped it: ${item.destination}`);
}

/**
 * Back up every file the run is about to overwrite or delete. Reads the
 * bytes once, hashes those exact bytes, and compares the hash against the
 * value the plan read. A mismatch downgrades the action, so the run never
 * destroys a file whose current content it did not read.
 *
 * Creates the backup directory lazily, on the first copy. A plan that holds
 * only safe actions therefore leaves no empty backup directory behind.
 *
 * @param {import('./plan.js').UpgradeAction[]} applied
 * @param {{ projectRoot: string, backupDir: string, reporter: ReturnType<typeof import('./report.js').createReporter> }} ctx
 * @returns {boolean} True when the run wrote at least one backup file.
 */
function backupTargets(applied, { projectRoot, backupDir, reporter }) {
  let used = false;

  for (const item of applied) {
    if (!needsBackup(item)) continue;

    const full = path.join(projectRoot, ...item.destination.split('/'));
    let bytes = null;
    try {
      bytes = fs.readFileSync(full);
    } catch {
      bytes = null;
    }

    if (bytes === null) {
      downgrade(item, 'missing', reporter);
      continue;
    }

    const expected = item.action === 'prune' ? item.manifestHash : item.diskHash;
    if (sha256(bytes) !== expected) {
      downgrade(item, 'changed', reporter);
      continue;
    }

    if (!used) {
      fs.mkdirSync(backupDir, { recursive: true });
      used = true;
    }
    writeBackup(backupDir, item.destination, bytes);
    item.backedUp = true;
  }

  return used;
}

/**
 * Delete every pruned file, then remove a parent directory that the prune
 * left empty. The directory check is deliberately narrow: the directory
 * must exist, must be a real directory, must hold no entry at all, and must
 * sit at least one level below the project root, so a prune never removes a
 * harness root or the shared root.
 *
 * @param {import('./plan.js').UpgradeAction[]} applied
 * @param {{ projectRoot: string, reporter: ReturnType<typeof import('./report.js').createReporter> }} ctx
 * @returns {void}
 */
function prunePaths(applied, { projectRoot, reporter }) {
  const parents = new Set();

  for (const item of applied) {
    if (item.action !== 'prune') continue;
    const full = path.join(projectRoot, ...item.destination.split('/'));
    fs.unlinkSync(full);
    reporter.line(`  ${item.label}: ${item.destination}`);
    const parent = path.posix.dirname(item.destination);
    if (parent && parent !== '.' && parent.split('/').length >= 2) {
      parents.add(parent);
    }
  }

  for (const parent of parents) {
    const full = path.join(projectRoot, ...parent.split('/'));
    let stat = null;
    try {
      stat = fs.lstatSync(full);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;
    if (fs.readdirSync(full).length > 0) continue;
    fs.rmdirSync(full);
    reporter.line(`  ${LABELS.pruned}: ${parent}/`);
  }
}

/**
 * Build the manifest file list from the applied upgrade actions.
 *
 *   write, overwrite, force, adopt, none  ->  owned, sha256 of the content
 *                                             that sits on disk now (S).
 *   conflict                              ->  the old owned entry, unchanged.
 *   skip                                  ->  owned false, with a reason.
 *   keep                                  ->  the old entry, unchanged.
 *   prune, drop                           ->  no entry.
 *   an extra file                         ->  no entry.
 *   the shared glossary                   ->  no entry.
 *
 * The shared glossary skip is also the 5.3.0 migration step of section 3.4.
 * A manifest written before 5.4.0 holds one owned entry for
 * ".beast-mode/harness.md". The rendered loop of planUpgrade() marks that
 * destination handled, so the stale pass never sees it, and this builder
 * writes no entry for it. The old entry therefore disappears with no prune,
 * no keep, and no drop, and the file stays on disk.
 *
 * A conflict keeps the old owned entry on purpose. The entry records what
 * Beast Mode wrote, and that fact stays true after the user edits the file.
 * Keeping it means a later "upgrade --force" can still take the plugin
 * version, and a later plain upgrade can still update the file cleanly once
 * the user reverts the edit. Demoting the entry to "owned": false would
 * close both doors after one upgrade run.
 *
 * @param {import('./plan.js').UpgradeAction[]} applied
 * @returns {import('./manifest.js').ManifestFileEntry[]}
 */
function buildUpgradeManifestFiles(applied) {
  /** @type {import('./manifest.js').ManifestFileEntry[]} */
  const files = [];

  for (const item of applied) {
    if (item.kind === 'extra' || item.kind === 'shared') continue;

    switch (item.action) {
      case 'write':
      case 'overwrite':
      case 'force':
      case 'adopt':
      case 'none':
        files.push({
          destination: item.destination,
          source: item.source ?? undefined,
          sha256: item.contentHash,
          owned: true,
        });
        break;

      case 'conflict':
        // A conflict always comes from an owned row, so manifestHash holds
        // a value. The guard keeps the rule absolute: an entry never claims
        // ownership with no hash behind it.
        if (item.manifestHash) {
          files.push({
            destination: item.destination,
            source: item.source ?? item.manifestEntry?.source ?? undefined,
            sha256: item.manifestHash,
            owned: true,
          });
        } else {
          files.push({
            destination: item.destination,
            source: item.source ?? undefined,
            owned: false,
            reason: item.reason ?? 'the file already existed',
          });
        }
        break;

      case 'skip':
        files.push({
          destination: item.destination,
          source: item.source ?? undefined,
          owned: false,
          reason: item.reason ?? 'the file already existed',
        });
        break;

      case 'keep':
        if (item.manifestEntry) files.push({ ...item.manifestEntry });
        break;

      case 'prune':
      case 'drop':
      default:
        break;
    }
  }

  return files;
}

/**
 * Write every upgrade action that puts bytes on disk. The backup step ran
 * already, so every file this step replaces has a copy in the backup
 * directory.
 *
 * @param {import('./plan.js').UpgradeAction[]} applied
 * @param {string} projectRoot
 * @returns {void}
 */
function writeUpgradeActions(applied, projectRoot) {
  for (const item of applied) {
    if (!writesContent(item)) continue;
    writeAction(projectRoot, item);
  }
}

/**
 * Apply an upgrade plan.
 *
 * The order is fixed: back up, write, prune, run the adapter check, write
 * the manifest last. A crash therefore never leaves a manifest that claims
 * a file the CLI did not write, and never leaves a deleted file with no
 * backup copy.
 *
 * @param {ReturnType<typeof import('./plan.js').planUpgrade>} plan
 * @param {ApplyContext} ctx
 * @returns {ApplyResult}
 */
function applyUpgrade(plan, { projectRoot, pluginRoot, adapter, source, reporter, dryRun = false }) {
  // The name of the directory the run would use. chooseBackupDir() creates
  // nothing, so a dry run can print the same path a real run would take.
  const backupDir = plan.backupNeeded ? chooseBackupDir(projectRoot, adapter.harnessRoot) : null;

  if (dryRun) {
    printPlan(plan, reporter, { backupDir, harnessId: adapter.id, projectRoot });
    return {
      manifestPath: null,
      checkResult: null,
      backupDir: null,
      counts: plan.counts,
      applied: plan.actions,
    };
  }

  // Work on copies, so a downgrade never edits the caller's plan.
  const applied = plan.actions.map((item) => ({ ...item }));

  // Step 1. Back up every file the run is about to destroy.
  let backupUsed = false;
  if (backupDir) {
    reporter.section('📦 Backing up the files this upgrade replaces...');
    backupUsed = backupTargets(applied, { projectRoot, backupDir, reporter });
    if (backupUsed) {
      reporter.ok(`Backup: ${path.relative(projectRoot, backupDir)}/`);
    } else {
      reporter.info('No file needed a backup.');
    }
  }

  // Step 2. Create the directories, then write.
  for (const dir of plan.dirs) {
    ensureDir(projectRoot, dir);
  }
  writeUpgradeActions(applied, projectRoot);
  printUpgradeGroups(
    applied.filter((item) => item.action !== 'prune'),
    reporter
  );

  // Step 3. Prune.
  const pruned = applied.filter((item) => item.action === 'prune');
  if (pruned.length > 0) {
    reporter.section('🗑️ Removing files the plugin no longer ships...');
    prunePaths(applied, { projectRoot, reporter });
  }

  applyGitignore(plan.gitignore, { projectRoot, reporter });

  // Step 4. The adapter check. It reports. It never changes a file.
  let checkResult = null;
  if (typeof adapter.check === 'function') {
    checkResult = adapter.check({
      projectRoot,
      skillNames: skillNamesFromActions(applied),
      pluginRoot,
    });
    if (checkResult && checkResult.ok === false) {
      reporter.line();
      for (const note of checkResult.notes) {
        reporter.warn(note);
      }
    }
  }

  // Step 5. The manifest, last.
  const manifestData = {
    schema: 1,
    beastModeVersion: source.version,
    harness: adapter.id,
    harnessRoot: adapter.harnessRoot,
    generated: new Date().toISOString(),
    files: buildUpgradeManifestFiles(applied),
  };
  const mPath = buildManifestPath(projectRoot, adapter.harnessRoot);
  writeManifest(mPath, manifestData);

  // Step 6. The skip list, then the summary.
  const counts = countUpgradeActions(applied);
  const skips = applied
    .filter((item) => item.action === 'conflict' || item.action === 'skip')
    .map((item) => ({ destination: item.destination, label: item.label ?? LABELS.skipped }));

  printSkipList(skips, reporter);

  reporter.section('✅ UPGRADE COMPLETE!');
  printUpgradeCounts(counts, reporter);
  reporter.line();
  reporter.line(`  ✓ Version file (v${source.version})`);
  if (backupUsed) {
    reporter.line(`  📦 Backup: ${path.relative(projectRoot, backupDir)}/`);
  } else {
    reporter.line('  📦 Backup: none needed');
  }
  reporter.line(`  📄 Manifest: ${path.posix.join(adapter.harnessRoot, '.beast-mode-manifest.json')}`);
  reporter.line();
  printUpgradeHints(
    { actions: applied, counts, noManifest: plan.noManifest, harnessId: adapter.id },
    reporter
  );

  return { manifestPath: mPath, checkResult, backupDir: backupUsed ? backupDir : null, counts, applied };
}
