// The feature tree, the reference resolution, the active pick, and the link
// keys. Pure: no file here calls `$`. Never throws.

import { headerValue } from './docs'
import { stampKey } from './tasks'

/** One folder: its name, its file names, and the mtime of its `tasks.md` (0 for none). */
export type FolderEntry = { name: string; files: string[]; tasksMtime: number }

/** A top folder of `docs/features/`. Only an epic gets `children`. */
export type TopEntry = FolderEntry & { children: FolderEntry[] }

export type FeatureTree = { exists: boolean; top: TopEntry[] }

/** An outcome that is no feature: `messageFor()` turns each into its answer. */
export type Refusal =
  | { kind: 'notFound'; name: string }
  | { kind: 'noEpic'; epic: string; name: string }
  | { kind: 'noChild'; epic: string; child: string; children: string[] }
  | { kind: 'wholeEpic'; epic: string; children: string[] }
  | { kind: 'emptyEpic'; epic: string }
  | { kind: 'ambiguous'; name: string; paths: string[] }
  | { kind: 'noFolder' }
  | { kind: 'noCandidate' }

export type Resolution = { kind: 'feature'; path: string } | Refusal

const EPIC_MARKER = 'epic-overview.md'

/** True when the top folder holds `epic-overview.md`. */
export function isEpic(entry: TopEntry): boolean {
  return entry.files.includes(EPIC_MARKER)
}

/**
 * Resolves a name of `/feature` as sections 2.2 and 3 of `epic-resolution.md`
 * do. The name is already trimmed, with no trailing `/`.
 *
 * @example resolveRef('cart', tree) // { kind: 'feature', path: 'shop/cart' }
 */
export function resolveRef(name: string, tree: FeatureTree): Resolution {
  const notFound: Resolution = { kind: 'notFound', name }
  const parts = name.split('/')

  if (parts.length > 2 || parts.some(part => part === '')) {
    return notFound
  }

  if (parts.length === 2) {
    const epic = tree.top.find(entry => entry.name === parts[0])
    const child = parts[1] ?? ''

    if (epic === undefined) {
      return notFound
    }

    if (!isEpic(epic)) {
      return { kind: 'noEpic', epic: epic.name, name }
    }

    if (!epic.children.some(entry => entry.name === child)) {
      return { kind: 'noChild', epic: epic.name, child, children: epic.children.map(entry => entry.name) }
    }

    return { kind: 'feature', path: name }
  }

  const top = tree.top.find(entry => entry.name === name)

  if (top !== undefined) {
    if (!isEpic(top)) {
      return { kind: 'feature', path: name }
    }

    return top.children.length === 0
      ? { kind: 'emptyEpic', epic: name }
      : { kind: 'wholeEpic', epic: name, children: top.children.map(entry => entry.name) }
  }

  const paths = tree.top
    .filter(entry => isEpic(entry) && entry.children.some(child => child.name === name))
    .map(entry => `${entry.name}/${name}`)

  if (paths.length === 1) {
    return { kind: 'feature', path: paths[0] ?? name }
  }

  return paths.length === 0 ? notFound : { kind: 'ambiguous', name, paths }
}

/**
 * The candidates of the active pick, as path and folder entry: each top
 * folder that is no epic, and each child of an epic, when its `files` hold
 * `tasks.md`. Tree order. Phase 3 reads the `tasks.md` of each path once.
 */
export function candidates(tree: FeatureTree): { path: string; entry: FolderEntry }[] {
  const out: { path: string; entry: FolderEntry }[] = []

  for (const top of tree.top) {
    if (!isEpic(top)) {
      out.push({ path: top.name, entry: top })
      continue
    }

    for (const child of top.children) {
      out.push({ path: `${top.name}/${child.name}`, entry: child })
    }
  }

  return out.filter(item => item.entry.files.includes('tasks.md'))
}

/**
 * The active pick. Sorts the candidates by the stamp key of their `tasks.md`
 * text, newest first, with a null key last. A tie goes to the newer
 * `tasksMtime`, and a second tie to the path in A-to-Z order. A path with no
 * entry in `texts`, or a null text, holds a null key.
 *
 * @example pickActive(tree, new Map([['demo', demoTasks]])) // { kind: 'feature', path: 'demo' }
 */
export function pickActive(tree: FeatureTree, texts: ReadonlyMap<string, string | null>): Resolution {
  if (!tree.exists || tree.top.length === 0) {
    return { kind: 'noFolder' }
  }

  const ranked = candidates(tree).map(item => {
    const text = texts.get(item.path) ?? null

    return {
      path: item.path,
      key: text === null ? null : stampKey(headerValue(text, 'Last Updated')),
      mtime: item.entry.tasksMtime,
    }
  })

  ranked.sort((a, b) => {
    if (a.key !== b.key) {
      if (a.key === null) {
        return 1
      }

      if (b.key === null) {
        return -1
      }

      return a.key < b.key ? 1 : -1
    }

    if (a.mtime !== b.mtime) {
      return a.mtime < b.mtime ? 1 : -1
    }

    return a.path < b.path ? -1 : a.path > b.path ? 1 : 0
  })

  const first = ranked[0]

  return first === undefined ? { kind: 'noCandidate' } : { kind: 'feature', path: first.path }
}

/**
 * The `linkedFeature` values that name a feature: the path, plus the bare
 * child name of an epic child when `resolveRef(child, tree)` resolves to the
 * same path. A bare name in two epics, or one that a top folder shadows, adds
 * nothing.
 *
 * @example linkKeys('shop/cart', tree) // ['shop/cart', 'cart']
 */
export function linkKeys(path: string, tree: FeatureTree): string[] {
  const slash = path.indexOf('/')

  if (slash === -1) {
    return [path]
  }

  const child = path.slice(slash + 1)
  const hit = resolveRef(child, tree)

  return hit.kind === 'feature' && hit.path === path ? [path, child] : [path]
}
