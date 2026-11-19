// The reads of the mod: the feature tree, the feature docs, and the bug files.
// The host follows `$` into no imported file, so the hooks module hands this
// file the three file system reads as plain functions (`Fs`). Reads only. A
// rejected read gives null, never a throw.

import type { FsEntry, FsStat } from 'claude-code'

import type { FeaturePaneView } from '../types/index'
import type {
  DashboardPaneBugView,
  DashboardPaneEpicView,
  DashboardPaneFeatureView,
  DashboardPaneProjectView,
  DashboardPaneRoute,
  DashboardPaneState,
  DashboardPaneView,
} from '../types/index'
import { isBugFile } from './lib/bugs'
import {
  buildBugView,
  buildEpic,
  buildFeature,
  buildProject,
  withBugDoc,
  withBugRef,
  withEpicOverview,
  withFeatureTasks,
  withOverview,
} from './lib/dashboard'
import type { DashboardEdit } from './lib/dashboard'
import { headerValue } from './lib/docs'
import { candidates, isEpic, linkKeys, pickActive, resolveRef } from './lib/features'
import type { FeatureTree, FolderEntry, Resolution, TopEntry } from './lib/features'
import { goneMessage } from './lib/moves'
import { buildView, editPath, messageFor, withBug, withStatus, withTasks } from './lib/view'
import type { EditKind } from './lib/view'

/** The three file system reads of the mod, as the hooks module builds them from `$`. No write. */
export type Fs = {
  read: (path: string) => Promise<string>
  list: (path: string) => Promise<readonly FsEntry[]>
  stat: (path: string) => Promise<FsStat>
}

/** A change to the shown view, built from the text that a redraw read. */
export type Patch = (view: FeaturePaneView) => FeaturePaneView

/** One listed folder: its folder names and file names, A to Z, and the mtime of its `tasks.md` (0 for none). */
type Listing = { dirs: string[]; files: string[]; tasksMtime: number }

/** What an entry leads to: its kind, and the mtime of a file. */
type Target = { kind: FsEntry['kind']; mtimeMs: number }

function byName(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function featuresDir(root: string): string {
  return `${root.replace(/[\\/]+$/, '')}/docs/features`
}

function bugsDir(root: string): string {
  return `${root.replace(/[\\/]+$/, '')}/docs/bugs`
}

function statusOf(text: string | null): string | null {
  return text === null ? null : headerValue(text, 'Status') || null
}

/**
 * The text of a file, or null when the read rejects: a missing file, a file
 * over 4 MiB, or an unreadable one.
 */
export async function readText(fs: Fs, path: string): Promise<string | null> {
  try {
    return await fs.read(path)
  } catch {
    return null
  }
}

/** What an entry leads to. A link costs one stat, so a link that leads to a folder counts as a folder. */
async function leadsTo(fs: Fs, path: string, entry: FsEntry): Promise<Target> {
  if (!entry.isLink) {
    return { kind: entry.kind, mtimeMs: entry.mtimeMs }
  }

  try {
    const stat = await fs.stat(path)

    return { kind: stat.kind, mtimeMs: stat.mtimeMs }
  } catch {
    return { kind: 'other', mtimeMs: 0 }
  }
}

/** The folders and the files of one folder, or null when the list rejects. */
async function readListing(fs: Fs, path: string): Promise<Listing | null> {
  let entries: readonly FsEntry[]

  try {
    entries = await fs.list(path)
  } catch {
    return null
  }

  const targets = await Promise.all(entries.map(entry => leadsTo(fs, `${path}/${entry.name}`, entry)))
  const listing: Listing = { dirs: [], files: [], tasksMtime: 0 }

  entries.forEach((entry, index) => {
    const target = targets[index]

    if (target?.kind === 'dir') {
      listing.dirs.push(entry.name)
    } else if (target?.kind === 'file') {
      listing.files.push(entry.name)
      listing.tasksMtime = entry.name === 'tasks.md' ? target.mtimeMs : listing.tasksMtime
    }
  })

  listing.dirs.sort(byName)
  listing.files.sort(byName)

  return listing
}

/** One top folder. Only an epic gets its children listed, because epics do not nest. */
async function readTop(fs: Fs, path: string, name: string): Promise<TopEntry> {
  const own = await readListing(fs, path)
  const entry: TopEntry = { name, files: own?.files ?? [], tasksMtime: own?.tasksMtime ?? 0, children: [] }

  if (own === null || !isEpic(entry)) {
    return entry
  }

  const children = await Promise.all(
    own.dirs.map(async (child): Promise<FolderEntry> => {
      const sub = await readListing(fs, `${path}/${child}`)

      return { name: child, files: sub?.files ?? [], tasksMtime: sub?.tasksMtime ?? 0 }
    }),
  )

  return { ...entry, children }
}

/**
 * The feature tree under `<root>/docs/features/` (section 3.6): each top
 * folder, and each child folder of an epic. The top folders and the children
 * sort A to Z. No `docs/features/` folder gives `exists: false`.
 */
export async function readTree(fs: Fs, root: string): Promise<FeatureTree> {
  const dir = featuresDir(root)
  const listing = await readListing(fs, dir)

  if (listing === null) {
    return { exists: false, top: [] }
  }

  const top = await Promise.all(listing.dirs.map(name => readTop(fs, `${dir}/${name}`, name)))

  return { exists: true, top }
}

/**
 * Each `docs/bugs/BUG-*.md` file name and its text, read in parallel. No
 * `docs/bugs/` folder gives none, and a rejected read leaves that bug out.
 */
export async function readBugs(fs: Fs, root: string): Promise<{ file: string; text: string }[]> {
  const dir = bugsDir(root)
  const listing = await readListing(fs, dir)
  const names = listing === null ? [] : listing.files.filter(isBugFile)
  const texts = await Promise.all(names.map(name => readText(fs, `${dir}/${name}`)))
  const bugs: { file: string; text: string }[] = []

  names.forEach((file, index) => {
    const text = texts[index]

    if (typeof text === 'string') {
      bugs.push({ file, text })
    }
  })

  return bugs
}

/** A `/feature` argument as a name: trimmed, with one trailing `/` removed. */
function featureName(args: string): string {
  const name = args.trim()

  return name.endsWith('/') ? name.slice(0, -1) : name
}

/** The file names of a feature folder: a top folder, or the child of an epic. */
function filesOf(tree: FeatureTree, path: string): string[] {
  const [name, child] = path.split('/')
  const top = tree.top.find(entry => entry.name === name)

  return (child === undefined ? top?.files : top?.children.find(entry => entry.name === child)?.files) ?? []
}

/** One doc of a feature folder. Null when the folder lists no such file, so a missing doc costs no read. */
async function readDoc(fs: Fs, folder: string, files: string[], name: string): Promise<string | null> {
  return files.includes(name) ? readText(fs, `${folder}/${name}`) : null
}

/**
 * The outcome of `/feature <args>` (section 3.2): the view of one feature,
 * or the one message line of an outcome that is no feature. With no name, it
 * runs the active pick and reads each candidate `tasks.md` once, in parallel.
 */
export async function loadFeature(fs: Fs, root: string, args: string): Promise<FeaturePaneView | string> {
  const tree = await readTree(fs, root)
  const name = featureName(args)
  const dir = featuresDir(root)
  const texts = new Map<string, string | null>()
  let outcome: Resolution

  if (name === '') {
    const paths = candidates(tree).map(item => item.path)
    const read = await Promise.all(paths.map(path => readText(fs, `${dir}/${path}/tasks.md`)))

    paths.forEach((path, index) => texts.set(path, read[index] ?? null))
    outcome = pickActive(tree, texts)
  } else {
    outcome = resolveRef(name, tree)
  }

  if (outcome.kind !== 'feature') {
    return messageFor(outcome)
  }

  const path = outcome.path
  const folder = `${dir}/${path}`
  const files = filesOf(tree, path)
  const [tasks, context, bugs] = await Promise.all([
    texts.has(path) ? (texts.get(path) ?? null) : readDoc(fs, folder, files, 'tasks.md'),
    readDoc(fs, folder, files, 'context.md'),
    readBugs(fs, root),
  ])
  const implementation = statusOf(context) === null ? await readDoc(fs, folder, files, 'implementation.md') : null

  return buildView({ root, path, linkKeys: linkKeys(path, tree), files, tasks, context, implementation, bugs })
}

/**
 * The patch of one edit that redraws the pane (section 3.8), from the doc it
 * reads: `tasks.md` for `tasks`, `context.md` then `implementation.md` for
 * `status`, and the edited bug file for `bug`. Null when the read rejects.
 */
export async function readPatch(
  fs: Fs,
  view: FeaturePaneView,
  kind: EditKind,
  filePath: string,
): Promise<Patch | null> {
  const folder = `${featuresDir(view.root)}/${view.path}`

  if (kind === 'tasks') {
    const text = await readText(fs, `${folder}/tasks.md`)

    return text === null ? null : current => withTasks(current, text)
  }

  if (kind === 'status') {
    const context = statusOf(await readText(fs, `${folder}/context.md`))
    const status = context ?? statusOf(await readText(fs, `${folder}/implementation.md`))

    return current => withStatus(current, status)
  }

  const file = editPath(filePath, view.root).split('/').pop() ?? ''
  const text = await readText(fs, `${bugsDir(view.root)}/${file}`)

  return text === null ? null : current => withBug(current, file, text)
}

// ── The dashboard reads (5.8.0) ──────────────────
// Each load gives a view, or the gone message of section 3.9 when its target
// is gone. The project view always loads. A rejected read gives null.

/** A change to the shown dashboard, built from the text that a redraw read. */
export type DashboardPatch = (state: DashboardPaneState) => DashboardPaneState

function overviewPath(root: string): string {
  return `${root.replace(/[\\/]+$/, '')}/docs/overview.md`
}

/** The state with a new view. A patch keeps the root, the route, and the stack. */
function withView(state: DashboardPaneState, view: DashboardPaneView): DashboardPaneState {
  return { ...state, view }
}

/**
 * The project view of `/dashboard` (section 3.2): the feature tree,
 * `docs/overview.md`, and the bug files, read in parallel. It always loads: a
 * missing folder or file gives an empty part, never a message.
 */
export async function loadProject(fs: Fs, root: string): Promise<DashboardPaneProjectView> {
  const [tree, overview, bugs] = await Promise.all([readTree(fs, root), readText(fs, overviewPath(root)), readBugs(fs, root)])

  return buildProject({ root, tree, overview, bugs })
}

/**
 * The epic view of `epic` (section 3.8): the tree, then its
 * `epic-overview.md` and the bug files. A folder that is gone, or that holds no
 * `epic-overview.md` now, gives the gone message and costs no other read.
 */
export async function loadEpic(fs: Fs, root: string, epic: string): Promise<DashboardPaneEpicView | string> {
  const tree = await readTree(fs, root)
  const entry = tree.top.find(item => item.name === epic)

  if (entry === undefined || !isEpic(entry)) {
    return goneMessage(epic)
  }

  const [text, bugs] = await Promise.all([
    readText(fs, `${featuresDir(root)}/${epic}/epic-overview.md`),
    readBugs(fs, root),
  ])

  return buildEpic({ tree, epic, text, bugs })
}

/**
 * The feature view of `path` (section 3.8): the view of `loadFeature()`, then
 * its `tasks.md` once more for the phases, because `loadFeature()` keeps that
 * text to itself. A path that resolves to no feature, or to another feature,
 * gives the gone message.
 */
export async function loadDashboardFeature(fs: Fs, root: string, path: string): Promise<DashboardPaneFeatureView | string> {
  const view = featureName(path) === '' ? '' : await loadFeature(fs, root, path)

  if (typeof view === 'string' || view.path !== path) {
    return goneMessage(path)
  }

  // A null progress means that loadFeature() found no tasks.md, so the folder lists none.
  const tasks = view.progress === null ? null : await readText(fs, `${featuresDir(root)}/${path}/tasks.md`)

  return buildFeature(view, tasks)
}

/**
 * The bug view of `docs/bugs/<file>` (section 3.8). A file that is gone, or a
 * name that is no `BUG-*.md` entry of that folder, gives the gone message.
 */
export async function loadBug(fs: Fs, root: string, file: string): Promise<DashboardPaneBugView | string> {
  const text = isBugFile(file) && !/[\\/]/.test(file) ? await readText(fs, `${bugsDir(root)}/${file}`) : null

  return text === null ? goneMessage(file) : buildBugView(file, text)
}

/** The view of a route, or the gone message when its target is gone (section 3.8). The project view always loads. */
export async function loadRoute(fs: Fs, root: string, route: DashboardPaneRoute): Promise<DashboardPaneView | string> {
  switch (route.kind) {
    case 'project':
      return loadProject(fs, root)
    case 'epic':
      return loadEpic(fs, root, route.epic)
    case 'feature':
      return loadDashboardFeature(fs, root, route.path)
    case 'bug':
      return loadBug(fs, root, route.file)
  }
}

/**
 * The patch of one edit that redraws the dashboard (section 3.11), from the
 * file that it reads. The feature view reads its `tasks.md`, and it reuses
 * `readPatch()` for the status and for a bug. Null when the read rejects. A
 * patch changes a view of the kind that it was read for, and no other.
 */
export async function readDashboardPatch(
  fs: Fs,
  state: DashboardPaneState,
  edit: DashboardEdit,
  filePath: string,
): Promise<DashboardPatch | null> {
  const view = state.view

  if (view.kind === 'feature') {
    if (edit === 'tasks') {
      const text = await readText(fs, `${featuresDir(state.root)}/${view.feature.path}/tasks.md`)

      return text === null
        ? null
        : current => (current.view.kind === 'feature' ? withView(current, withFeatureTasks(current.view, text)) : current)
    }

    const kind = edit === 'status' ? 'status' : edit === 'featureBug' ? 'bug' : null
    const patch = kind === null ? null : await readPatch(fs, view.feature, kind, filePath)

    return patch === null
      ? null
      : current =>
          current.view.kind === 'feature'
            ? withView(current, { ...current.view, feature: patch(current.view.feature) })
            : current
  }

  if (view.kind === 'bug') {
    const text = edit === 'bugDoc' ? await readText(fs, `${bugsDir(state.root)}/${view.file}`) : null

    return text === null ? null : current => (current.view.kind === 'bug' ? withView(current, withBugDoc(current.view, text)) : current)
  }

  if (edit === 'bugRef') {
    const file = editPath(filePath, state.root).split('/').pop() ?? ''
    const text = await readText(fs, `${bugsDir(state.root)}/${file}`)

    return text === null
      ? null
      : current =>
          current.view.kind === 'project' || current.view.kind === 'epic'
            ? withView(current, withBugRef(current.view, file, text))
            : current
  }

  if (view.kind === 'project') {
    const text = edit === 'overview' ? await readText(fs, overviewPath(state.root)) : null

    return text === null
      ? null
      : current => (current.view.kind === 'project' ? withView(current, withOverview(current.view, text)) : current)
  }

  const text = edit === 'epicOverview' ? await readText(fs, `${featuresDir(state.root)}/${view.epic}/epic-overview.md`) : null

  return text === null
    ? null
    : current => (current.view.kind === 'epic' ? withView(current, withEpicOverview(current.view, text)) : current)
}
