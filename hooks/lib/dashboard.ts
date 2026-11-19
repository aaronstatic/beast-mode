// The four views of the dashboard, the five patches, the deep compare, and the
// edit classifier. Pure: no file here calls `$`. Never throws.

import type {
  DashboardPaneBugRef,
  DashboardPaneBugView,
  DashboardPaneEpicView,
  DashboardPaneFeatureView,
  DashboardPaneFolder,
  DashboardPaneProjectView,
  DashboardPaneRow,
  DashboardPaneState,
  FeaturePanePhase,
  FeaturePaneView,
} from '../../types/index'
import { bugLink, isBugFile, isOpenBug, parseBug, parseBugDoc } from './bugs'
import { headerValue, printable } from './docs'
import { isEpic, resolveRef } from './features'
import type { FeatureTree, TopEntry } from './features'
import { parseStatusTable, progressOf } from './tables'
import type { StatusTable } from './tables'
import { parseTasks } from './tasks'
import { classifyEdit, editPath, withTasks } from './view'

/** The epic folder that the web app fills with reference images. It is no feature. */
export const MOODBOARD = 'moodboard'

/** One bug file: its name and its text. */
export type BugFile = { file: string; text: string }

export type ProjectInput = {
  root: string
  tree: FeatureTree
  /** The text of `docs/overview.md`, or null when the file is missing. */
  overview: string | null
  bugs: BugFile[]
}

export type EpicInput = {
  tree: FeatureTree
  epic: string
  /** The text of `epic-overview.md`, or null when it cannot be read. */
  text: string | null
  bugs: BugFile[]
}

/**
 * The kind of an edit that redraws the dashboard (section 3.11). `tasks`,
 * `status`, and `featureBug` redraw the feature view.
 */
export type DashboardEdit = 'overview' | 'epicOverview' | 'bugRef' | 'tasks' | 'status' | 'featureBug' | 'bugDoc'

function byName(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function lastSegment(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/').filter(part => part !== '')

  return printable(parts[parts.length - 1] ?? '')
}

function valueOf(text: string | null, label: string): string | null {
  return text === null ? null : printable(headerValue(text, label) ?? '') || null
}

function rowOf(
  name: string,
  path: string,
  kind: DashboardPaneRow['kind'],
  fromTable: StatusTable['rows'][number] | null,
): DashboardPaneRow {
  return {
    name,
    path,
    kind,
    status: fromTable === null ? null : fromTable.status || null,
    progress: fromTable === null || fromTable.tasks === null ? null : progressOf(fromTable.tasks),
    isListed: fromTable !== null,
  }
}

function foldersOf(tree: FeatureTree): DashboardPaneFolder[] {
  return tree.top
    .map(entry => ({ name: entry.name, isEpic: isEpic(entry) }))
    .sort((a, b) => byName(a.name, b.name))
}

/** The rows of a project view, from the stored folders and the table. */
function projectRows(folders: DashboardPaneFolder[], table: StatusTable): DashboardPaneRow[] {
  const named = new Set(table.rows.map(row => row.name))
  const rows: DashboardPaneRow[] = []

  for (const row of table.rows) {
    const folder = folders.find(item => item.name === row.name)

    rows.push(rowOf(row.name, row.name, folder === undefined ? 'missing' : folder.isEpic ? 'epic' : 'feature', row))
  }

  for (const folder of folders) {
    if (!named.has(folder.name)) {
      rows.push(rowOf(folder.name, folder.name, folder.isEpic ? 'epic' : 'feature', null))
    }
  }

  return rows
}

function childNames(entry: TopEntry | undefined): string[] {
  return (entry?.children ?? [])
    .map(child => child.name)
    .filter(name => name !== MOODBOARD)
    .sort(byName)
}

/** The rows of an epic view, from the stored children and the table. */
function epicRows(epic: string, children: string[], table: StatusTable): DashboardPaneRow[] {
  const named = new Set(table.rows.map(row => row.name))
  const rows: DashboardPaneRow[] = []

  for (const row of table.rows) {
    rows.push(rowOf(row.name, `${epic}/${row.name}`, children.includes(row.name) ? 'feature' : 'missing', row))
  }

  for (const child of children) {
    if (!named.has(child)) {
      rows.push(rowOf(child, `${epic}/${child}`, 'feature', null))
    }
  }

  return rows
}

/** The ref of each open bug whose link is a key of `links`, one per file, A to Z by file. */
function bugRefs(bugs: BugFile[], links: Record<string, string>): DashboardPaneBugRef[] {
  const refs = new Map<string, DashboardPaneBugRef>()

  for (const item of bugs) {
    const ref = refOf(item.file, item.text, links)

    if (ref !== null && !refs.has(item.file)) {
      refs.set(item.file, ref)
    }
  }

  return [...refs.values()].sort((a, b) => byName(a.file, b.file))
}

function refOf(file: string, text: string, links: Record<string, string>): DashboardPaneBugRef | null {
  const bug = isBugFile(file) ? parseBug(file, text) : null

  if (bug === null || !isOpenBug(bug)) {
    return null
  }

  const link = bugLink(bug)

  return link !== null && Object.prototype.hasOwnProperty.call(links, link)
    ? { file, row: links[link] ?? '' }
    : null
}

/**
 * The open bugs that count on a row: the refs whose `row` is the row path.
 *
 * @example openCount(view.bugs, 'shop') // 1
 */
export function openCount(bugs: DashboardPaneBugRef[], path: string): number {
  return bugs.filter(ref => ref.row === path).length
}

/**
 * The project view (section 3.7). One row per table row, in table order, then
 * one unlisted row per top folder that no table row names, A to Z.
 *
 * @example buildProject({ root: '/work/project', tree, overview, bugs }).rows[0] // { name: 'shop', kind: 'epic', ... }
 */
export function buildProject(input: ProjectInput): DashboardPaneProjectView {
  const { root, tree, overview, bugs } = input
  const table = overview === null ? { hasTable: false, rows: [] } : parseStatusTable(overview)
  const folders = foldersOf(tree)
  const links = new Map<string, string>()

  for (const entry of [...tree.top].sort((a, b) => byName(a.name, b.name))) {
    links.set(entry.name, entry.name)

    if (!isEpic(entry)) {
      continue
    }

    for (const child of entry.children) {
      links.set(`${entry.name}/${child.name}`, entry.name)

      const hit = resolveRef(child.name, tree)

      if (hit.kind === 'feature' && hit.path === `${entry.name}/${child.name}`) {
        links.set(child.name, entry.name)
      }
    }
  }

  const stored = Object.fromEntries(links)

  return {
    kind: 'project',
    project: lastSegment(root),
    source: overview === null ? 'noFile' : table.hasTable ? 'table' : 'noTable',
    updated: valueOf(overview, 'Last Updated'),
    folders,
    rows: projectRows(folders, table),
    links: stored,
    bugs: bugRefs(bugs, stored),
  }
}

/**
 * The epic view (section 3.7). The children are the child folders of the epic
 * with no `moodboard`. A bug that links the epic as a whole counts on the
 * project row only.
 *
 * @example buildEpic({ tree, epic: 'shop', text, bugs }).rows.map(row => row.path) // ['shop/cart', 'shop/checkout']
 */
export function buildEpic(input: EpicInput): DashboardPaneEpicView {
  const { tree, epic, text, bugs } = input
  const table = text === null ? { hasTable: false, rows: [] } : parseStatusTable(text, epic)
  const children = childNames(tree.top.find(entry => entry.name === epic))
  const links = new Map<string, string>()

  for (const child of children) {
    links.set(`${epic}/${child}`, `${epic}/${child}`)

    const hit = resolveRef(child, tree)

    if (hit.kind === 'feature' && hit.path === `${epic}/${child}`) {
      links.set(child, `${epic}/${child}`)
    }
  }

  const stored = Object.fromEntries(links)

  return {
    kind: 'epic',
    epic,
    status: valueOf(text, 'Status'),
    source: table.hasTable ? 'table' : 'noTable',
    updated: valueOf(text, 'Last Updated'),
    children,
    rows: epicRows(epic, children, table),
    links: stored,
    bugs: bugRefs(bugs, stored),
  }
}

/** The index of the current phase: the first phase with an open task, else the last, else -1. */
function currentIndex(phases: FeaturePanePhase[]): number {
  const open = phases.findIndex(phase => phase.done < phase.total)

  return open === -1 ? phases.length - 1 : open
}

/**
 * The feature view (section 3.7). `view` is the view of `loadFeature()` and
 * `tasks` is the `tasks.md` text, or null. The current phase is open.
 *
 * @example buildFeature(view, tasks).expanded // [1]
 */
export function buildFeature(view: FeaturePaneView, tasks: string | null): DashboardPaneFeatureView {
  if (tasks === null) {
    return { kind: 'feature', feature: view, phases: [], expanded: [] }
  }

  const phases = parseTasks(tasks).phases
  const current = currentIndex(phases)

  return { kind: 'feature', feature: withTasks(view, tasks), phases, expanded: current === -1 ? [] : [current] }
}

/**
 * The bug view (section 3.7). A text with no frontmatter gives the file name
 * as id and title, no field, no body, and a note.
 *
 * @example buildBugView('BUG-001.md', text).title // 'The "Total" row overflows'
 */
export function buildBugView(file: string, text: string): DashboardPaneBugView {
  const doc = parseBugDoc(file, text)

  if (doc !== null) {
    return { kind: 'bug', file, id: doc.id, title: doc.title, fields: doc.fields, body: doc.body, note: null }
  }

  const name = printable(file.replace(/\.md$/, ''))

  return {
    kind: 'bug',
    file,
    id: name,
    title: name,
    fields: [],
    body: '',
    note: `No frontmatter in docs/bugs/${printable(file)}.`,
  }
}

/** The project view with the rows, the source, and the stamp of a new `docs/overview.md`. Null means the file is gone. */
export function withOverview(view: DashboardPaneProjectView, text: string | null): DashboardPaneProjectView {
  const table = text === null ? { hasTable: false, rows: [] } : parseStatusTable(text)

  return {
    ...view,
    source: text === null ? 'noFile' : table.hasTable ? 'table' : 'noTable',
    updated: valueOf(text, 'Last Updated'),
    rows: projectRows(view.folders, table),
  }
}

/** The epic view with the status, the stamp, and the rows of a new `epic-overview.md`. */
export function withEpicOverview(view: DashboardPaneEpicView, text: string | null): DashboardPaneEpicView {
  const table = text === null ? { hasTable: false, rows: [] } : parseStatusTable(text, view.epic)

  return {
    ...view,
    status: valueOf(text, 'Status'),
    source: table.hasTable ? 'table' : 'noTable',
    updated: valueOf(text, 'Last Updated'),
    rows: epicRows(view.epic, view.children, table),
  }
}

/**
 * The project view or the epic view with one bug file applied. The ref of the
 * file leaves, and it returns when the bug is open and its link is a key of
 * the stored `links`. A null text means the file is gone.
 */
export function withBugRef<V extends DashboardPaneProjectView | DashboardPaneEpicView>(
  view: V,
  file: string,
  text: string | null,
): V {
  const rest = view.bugs.filter(ref => ref.file !== file)
  const ref = text === null ? null : refOf(file, text, view.links)

  return { ...view, bugs: (ref === null ? rest : [...rest, ref]).sort((a, b) => byName(a.file, b.file)) }
}

/**
 * The feature view with a new `tasks.md`. It keeps each open phase that still
 * exists, and it opens the current phase when that phase changed, so the next
 * phase opens when the last task of a phase gets ticked.
 */
export function withFeatureTasks(view: DashboardPaneFeatureView, text: string): DashboardPaneFeatureView {
  const phases = parseTasks(text).phases
  const before = currentIndex(view.phases)
  const after = currentIndex(phases)
  const kept = view.expanded.filter(index => index < phases.length)

  if (after !== -1 && after !== before && !kept.includes(after)) {
    kept.push(after)
  }

  return {
    ...view,
    feature: withTasks(view.feature, text),
    phases,
    expanded: [...new Set(kept)].sort((a, b) => a - b),
  }
}

/** The bug view with a new text of its file. */
export function withBugDoc(view: DashboardPaneBugView, text: string): DashboardPaneBugView {
  return buildBugView(view.file, text)
}

/**
 * True when two plain values hold the same data, in depth, with no regard to
 * the order of object keys.
 *
 * @example sameData({ a: 1, b: [2] }, { b: [2], a: 1 }) // true
 */
export function sameData(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) {
    return true
  }

  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    return false
  }

  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, index) => sameData(item, b[index]))
    )
  }

  const left = a as Record<string, unknown>
  const right = b as Record<string, unknown>
  const keys = Object.keys(left)

  return (
    keys.length === Object.keys(right).length &&
    keys.every(key => Object.prototype.hasOwnProperty.call(right, key) && sameData(left[key], right[key]))
  )
}

/**
 * The kind of an edit that redraws the shown view, or null (section 3.11). It
 * normalizes the path as `classifyEdit()` does. A feature view reuses
 * `classifyEdit()` on its feature.
 *
 * @example classifyDashboardEdit('/work/project/docs/overview.md', state) // 'overview'
 */
export function classifyDashboardEdit(filePath: string, state: DashboardPaneState): DashboardEdit | null {
  const view = state.view

  if (view.kind === 'feature') {
    const kind = classifyEdit(filePath, view.feature)

    return kind === null ? null : kind === 'bug' ? 'featureBug' : kind
  }

  const root = editPath(state.root, state.root)
  const file = editPath(filePath, state.root)
  const bugs = `${root}/docs/bugs/`

  if (view.kind === 'bug') {
    return file === `${bugs}${view.file}` ? 'bugDoc' : null
  }

  if (file.startsWith(bugs)) {
    const name = file.slice(bugs.length)

    return !name.includes('/') && isBugFile(name) ? 'bugRef' : null
  }

  if (view.kind === 'project') {
    return file === `${root}/docs/overview.md` ? 'overview' : null
  }

  return file === `${root}/docs/features/${view.epic}/epic-overview.md` ? 'epicOverview' : null
}
