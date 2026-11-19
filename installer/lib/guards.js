// installer/lib/guards.js
//
// The three guards of implementation.md section 3.7 and decision 10:
//   1. The symlink guard: refuse when a Beast Mode layout path is a symlink.
//   2. The plugin-repo guard: refuse when the project holds the Beast Mode
//      plugin manifest.
//   3. The same-root guard: refuse when the project root equals the plugin
//      root.
//
// This module names no harness path. The caller passes the harness root
// (the Claude Code adapter passes its own root) as a parameter, so the
// symlink list becomes "<harnessRoot>/skills", "<harnessRoot>/agents",
// ".beast-mode", ".beast-mode/templates", and ".beast-mode/harness.md".
// Only the plugin manifest path, ".claude-plugin/plugin.json", is a fixed
// literal here, because it names the plugin manifest, not a harness path.

import fs from 'node:fs';
import path from 'node:path';

import { GuardRefusalError } from './errors.js';

const DEV_LINK_FIX =
  'Run `bash scripts/dev-link.sh` to keep the dogfood links. ' +
  'The installer CLI must not run inside the Beast Mode repo.';

const REPLACE_LINK_FIX =
  'Replace each linked path with a real directory, then run the command again.';

/**
 * The project-relative paths the symlink guard checks, given a harness root.
 *
 * @param {string} harnessRoot Project-relative harness root, one adapter's own root path.
 * @returns {string[]}
 */
export function symlinkGuardPaths(harnessRoot) {
  return [
    path.posix.join(harnessRoot, 'skills'),
    path.posix.join(harnessRoot, 'agents'),
    '.beast-mode',
    '.beast-mode/templates',
    '.beast-mode/harness.md',
  ];
}

/**
 * Find every Beast Mode layout path that is a symlink.
 *
 * @param {string} projectRoot
 * @param {string} harnessRoot
 * @returns {{ relPath: string, target: string }[]}
 */
export function findSymlinks(projectRoot, harnessRoot) {
  const found = [];
  for (const relPath of symlinkGuardPaths(harnessRoot)) {
    const fullPath = path.join(projectRoot, ...relPath.split('/'));
    let stat;
    try {
      stat = fs.lstatSync(fullPath);
    } catch {
      continue;
    }
    if (stat.isSymbolicLink()) {
      found.push({ relPath, target: fs.readlinkSync(fullPath) });
    }
  }
  return found;
}

/**
 * True when the project root holds the Beast Mode plugin manifest.
 *
 * @param {string} projectRoot
 * @returns {boolean}
 */
export function isPluginRepo(projectRoot) {
  const manifestPath = path.join(projectRoot, '.claude-plugin', 'plugin.json');
  if (!fs.existsSync(manifestPath)) return false;
  let data;
  try {
    data = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch {
    return false;
  }
  return data && data.name === 'beast-mode';
}

/**
 * True when the project root and the plugin root are the same directory.
 *
 * @param {string} projectRoot
 * @param {string} pluginRoot
 * @returns {boolean}
 */
export function isSameRoot(projectRoot, pluginRoot) {
  return path.resolve(projectRoot) === path.resolve(pluginRoot);
}

/**
 * Run every guard. Throw GuardRefusalError (exit 4) on the first failing
 * check, or on any combination of failing checks, and name every offending
 * path in the cause line. Write nothing.
 *
 * @param {{ projectRoot: string, pluginRoot: string, harnessRoot: string }} ctx
 * @returns {void}
 */
export function runGuards({ projectRoot, pluginRoot, harnessRoot }) {
  const symlinks = findSymlinks(projectRoot, harnessRoot);
  const sameRoot = isSameRoot(projectRoot, pluginRoot);
  const pluginRepo = isPluginRepo(projectRoot);

  if (symlinks.length === 0 && !sameRoot && !pluginRepo) {
    return;
  }

  const causeLines = [];

  if (symlinks.length > 0) {
    causeLines.push('A Beast Mode layout path in this project is a symlink:');
    for (const { relPath, target } of symlinks) {
      causeLines.push(`  ${relPath} -> ${target}`);
    }
  }

  if (sameRoot) {
    causeLines.push('The project root is the plugin root.');
  }

  if (pluginRepo) {
    causeLines.push('The project root holds the Beast Mode plugin manifest.');
  }

  const insideBeastModeRepo = sameRoot || pluginRepo;
  const fix = insideBeastModeRepo ? DEV_LINK_FIX : REPLACE_LINK_FIX;

  throw new GuardRefusalError(
    'The installer CLI refuses to run against this project.',
    causeLines.join('\n'),
    fix
  );
}
