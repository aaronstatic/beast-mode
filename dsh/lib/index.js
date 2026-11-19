/**
 * The Beast Mode bundle entry for DeepSeek Harness (dsh).
 *
 * The bundle holds two plugins, and this module mounts both as children.
 *
 * 1. The skill provider. It registers two bundled skills,
 *    install-beast-mode and upgrade-beast-mode, on the dsh skill registry.
 *    Both skills call the installer CLI at installer/bin/beast-mode.js,
 *    resolved through the package root.
 * 2. The web panel host, `./panel.js`. It registers the `/beast/api/` and
 *    the `/beast/ui/` routes on `webServer`.
 *
 * The bundle keeps ONE cordis insert row on purpose. The root package.json
 * declares a `dsh.client` bundle, and the dsh client module registry allows
 * one active loader row per package. Two rows of one package make
 * `reconcilePackage` throw "resolves from multiple active Loader sources",
 * and that error fails the whole plugin tree and the dsh boot
 * (`packages/client/modules/src/index.ts`). Each child below carries its own
 * `inject` list, so the panel never waits for the skills service, and the
 * skill provider never waits for the web server.
 *
 * @module beast-mode/dsh
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { apply as applyPanel, name as panelName } from './panel.js';

const RANK_BUNDLED = 600;
const PACKAGE_ROOT = new URL('../../', import.meta.url);
const SKILLS_DIR = new URL('../skills/', import.meta.url);
const SKILLS = [
  {
    name: 'install-beast-mode',
    description: 'Install the Beast Mode workflow system in this project. Usage: /install-beast-mode',
  },
  {
    name: 'upgrade-beast-mode',
    description: 'Upgrade the Beast Mode installation in this project. Usage: /upgrade-beast-mode',
  },
];

function candidateFor(skill) {
  const folderUrl = new URL(`${skill.name}/`, SKILLS_DIR);
  return {
    name: skill.name,
    description: skill.description,
    invocation: { modelInvocable: true, userInvocable: true },
    provider: 'beast-mode',
    source: 'bundled',
    rank: RANK_BUNDLED,
    resourceBase: { kind: 'directory', path: fileURLToPath(folderUrl) },
    locator: new URL('SKILL.md', folderUrl),
  };
}

const CANDIDATES = SKILLS.map(candidateFor);

/** Strip the leading frontmatter fence from a skill body. */
function stripFrontmatter(text) {
  const match = text.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
  return match ? text.slice(match[0].length) : text;
}

/** Replace every {{BEAST_MODE_ROOT}} token with the absolute package root. */
function substituteRoot(text) {
  const root = fileURLToPath(PACKAGE_ROOT).replace(/[/\\]+$/, '');
  return text.split('{{BEAST_MODE_ROOT}}').join(root);
}

export const provider = {
  name: 'beast-mode',
  list: () => Promise.resolve(CANDIDATES),
  async get(candidate) {
    const found = CANDIDATES.find((entry) => entry.name === candidate.name) ?? candidate;
    const raw = await readFile(found.locator, 'utf8');
    const content = substituteRoot(stripFrontmatter(raw));
    return {
      name: found.name,
      description: found.description,
      invocation: found.invocation,
      provider: found.provider,
      source: found.source,
      resourceBase: found.resourceBase,
      content,
    };
  },
};

/**
 * The skill provider half of the bundle. It needs the skills service, so it
 * carries the `inject` list that this module itself carried before v5.5.0.
 */
const skillProviderPlugin = {
  name: 'beast-mode-skills',
  inject: ['skills'],
  apply(ctx) {
    ctx.skills.registerProvider(() => provider);
  },
};

/** The web panel host half of the bundle. It declares no `inject`. */
const panelPlugin = { name: panelName, apply: applyPanel };

/** Cordis plugin name. */
export const name = 'beast-mode';

/**
 * Mount both halves of the bundle. cordis gives each child its own fiber, so
 * one child never blocks the other.
 * @param {object} ctx
 */
export function apply(ctx) {
  ctx.plugin(skillProviderPlugin);
  ctx.plugin(panelPlugin);
}

/**
 * An internal export for the test suite only. `dsh/test/panel.test.js`
 * asserts that the entry mounts both children with the right `inject` list.
 */
export const __testing = { skillProviderPlugin, panelPlugin };
