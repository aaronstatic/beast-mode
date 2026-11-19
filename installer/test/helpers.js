// installer/test/helpers.js
//
// Shared fixture builders for the installer test suite. Every fixture
// plugin root and every fixture project root lives under a fresh
// fs.mkdtempSync(path.join(os.tmpdir(), 'bm-')) directory, so no test
// writes into this repo. Phase 2 and Phase 3 reuse these helpers.

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { CANONICAL_TERMS } from '../lib/source.js';

/**
 * The install footprint of the shipped plugin: the command skills, the
 * source-backed manifest entries per harness, and the skills that hold
 * $ARGUMENTS (each gains one dsh arguments note). A footprint change (a new
 * skill, a new template, a new format) edits these three values on purpose,
 * here and nowhere else.
 */
export const FOOTPRINT = { skills: 31, manifestEntries: 48, argumentNotes: 27 };

const DEFAULT_SKILL_NAME = 'one-skill';
const DEFAULT_AGENT_NAME = 'one';

/**
 * A glossary body that passes every rule of validateGlossary().
 *
 * @param {string} [harnessId] The value the "**Harness:**" line holds.
 * @returns {string}
 */
export function goodGlossaryText(harnessId = 'claude-code') {
  const rows = CANONICAL_TERMS.map((term) => `| ${term} | Do the fixture thing. |`).join('\n');
  return `# Harness Glossary - Fixture

**Harness:** ${harnessId}
**Targets:** Fixture harness 1.0 and later

## Term map

| Neutral term | This harness |
| --- | --- |
${rows}

## Notes

- A fixture note.
`;
}

/**
 * A SKILL.md body that passes every rule of validateSkill().
 *
 * @param {string} [name]
 * @returns {string}
 */
export function goodSkillText(name = DEFAULT_SKILL_NAME) {
  return `---
name: ${name}
description: "A fixture skill. Usage: /${name} [arg]"
argument-hint: "[arg]"
user-invocable: true
---

Fixture skill body.
`;
}

/**
 * An agent body that passes every rule of validateAgent().
 *
 * @param {string} [name]
 * @returns {string}
 */
export function goodAgentText(name = DEFAULT_AGENT_NAME) {
  return `---
name: ${name}
description: A fixture agent.
tools: Read
---

Fixture agent body.
`;
}

/**
 * Build a minimal, valid fixture plugin root under a fresh temp directory.
 * Holds .claude-plugin/plugin.json, one skill, one agent, one dev-doc, one
 * format reference, and the claude glossary.
 *
 * @param {{
 *   version?: string,
 *   skillName?: string,
 *   agentName?: string,
 *   glossaryText?: string,
 *   glossaryHarnessId?: string,
 * }} [opts]
 * @returns {string} The absolute path to the fixture plugin root.
 */
export function createFixturePluginRoot(opts = {}) {
  const {
    version = '5.1.0-fixture',
    skillName = DEFAULT_SKILL_NAME,
    agentName = DEFAULT_AGENT_NAME,
    glossaryText,
    glossaryHarnessId = 'claude-code',
  } = opts;

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bm-'));

  fs.mkdirSync(path.join(root, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.claude-plugin', 'plugin.json'),
    JSON.stringify({ name: 'beast-mode-fixture', version }, null, 2)
  );

  const skillDir = path.join(root, 'templates', 'skills', skillName);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), goodSkillText(skillName));

  const agentsDir = path.join(root, 'templates', 'agents');
  fs.mkdirSync(agentsDir, { recursive: true });
  fs.writeFileSync(path.join(agentsDir, `${agentName}.md`), goodAgentText(agentName));

  fs.mkdirSync(path.join(root, 'templates', 'dev-docs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'templates', 'dev-docs', 'context.md'), '# Context fixture\n');

  fs.mkdirSync(path.join(root, 'templates', 'formats'), { recursive: true });
  fs.writeFileSync(path.join(root, 'templates', 'formats', 'example.md'), '# Format fixture\n');

  const harnessDir = path.join(root, 'templates', 'harness');
  fs.mkdirSync(harnessDir, { recursive: true });
  fs.writeFileSync(
    path.join(harnessDir, 'claude.md'),
    glossaryText ?? goodGlossaryText(glossaryHarnessId)
  );

  return root;
}

/**
 * Build a fresh, empty temp directory to use as a project root.
 *
 * @returns {string}
 */
export function createTempProjectRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'bm-project-'));
}

/**
 * Remove a fixture directory tree. Swallows a missing-path error, so a
 * cleanup call is always safe to run in an after() hook.
 *
 * @param {string} dir
 * @returns {void}
 */
export function removeFixture(dir) {
  if (!dir) return;
  fs.rmSync(dir, { recursive: true, force: true });
}

/**
 * Copy the real plugin source into a fresh temp plugin root. A test that
 * needs a "source changed" or a "source gone" case installs from the copy,
 * then edits or deletes a file inside the copy, then upgrades against it.
 * The real repo stays read-only.
 *
 * @param {string} realPluginRoot
 * @returns {string} The absolute path to the temp plugin root.
 */
export function copyPluginRoot(realPluginRoot) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bm-plugin-'));
  fs.mkdirSync(path.join(root, '.claude-plugin'), { recursive: true });
  fs.copyFileSync(
    path.join(realPluginRoot, '.claude-plugin', 'plugin.json'),
    path.join(root, '.claude-plugin', 'plugin.json')
  );
  fs.cpSync(path.join(realPluginRoot, 'templates'), path.join(root, 'templates'), {
    recursive: true,
  });
  return root;
}

/**
 * A recursive snapshot of every file under root: relative posix path ->
 * sha256 of its content. A test snapshots a tree, runs a command, and
 * compares, to prove that the command changed nothing.
 *
 * @param {string} root
 * @returns {Record<string, string>}
 */
export function snapshotTree(root) {
  /** @type {Record<string, string>} */
  const files = {};

  function walk(dir, rel) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absPath = path.join(dir, entry.name);
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(absPath, relPath);
      } else if (entry.isFile()) {
        files[relPath] = crypto.createHash('sha256').update(fs.readFileSync(absPath)).digest('hex');
      }
    }
  }

  if (fs.existsSync(root)) walk(root, '');
  return files;
}
