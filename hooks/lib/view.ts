// The view of one feature: build it, patch it, compare it, draw it as lines,
// and classify the edits that redraw it. Pure: no file here calls `$`. Never
// throws.

import type { FeaturePaneBug, FeaturePanePhase, FeaturePaneView } from '../../types/index'
import { isBugFile, isOpenFor, openBugs, parseBug } from './bugs'
import type { ParsedBug } from './bugs'
import { headerValue } from './docs'
import type { Resolution } from './features'
import { currentPhase, parseTasks, progressText } from './tasks'

/** The pane text when the state is null. */
export const IDLE_LINE = 'No feature loaded. Run /feature to load one.'

export const NO_PHASE_NOTE = 'No "## Phase" heading in tasks.md.'

/** The tone of one line. The render hook styles each tone. Line 0 is the path. */
export type ViewTone = 'heading' | 'body' | 'dim' | 'gap'

export type ViewLine = { text: string; tone: ViewTone }

/** What `loadFeature` passes to `buildView()`. A text is null when its file is missing or unreadable. */
export type BuildInput = {
  root: string
  path: string
  linkKeys: string[]
  /** The file names in the feature folder. */
  files: string[]
  tasks: string | null
  context: string | null
  implementation: string | null
  /** Each `docs/bugs/BUG-*.md`: the file name and its text. */
  bugs: { file: string; text: string }[]
}

/** The kind of an edit that redraws the pane. */
export type EditKind = 'tasks' | 'status' | 'bug'

function statusOf(text: string | null): string | null {
  return text === null ? null : headerValue(text, 'Status') || null
}

function noTasksNote(path: string, files: string[]): string {
  return files.includes('implementation.md')
    ? `No tasks.md yet. Run /start-feature ${path}.`
    : `No tasks.md yet. Run /plan-feature ${path}.`
}

/**
 * The view of one feature folder (section 3.2, step 6). The status comes from
 * `context.md`, else from `implementation.md`. A null `tasks` text gives a null
 * progress, no phase, and a note.
 *
 * @example buildView({ root, path: 'demo', linkKeys: ['demo'], files, tasks, context: null, implementation: null, bugs: [] })
 */
export function buildView(input: BuildInput): FeaturePaneView {
  const base: FeaturePaneView = {
    root: input.root,
    path: input.path,
    linkKeys: [...input.linkKeys],
    status: statusOf(input.context) ?? statusOf(input.implementation),
    progress: null,
    phase: null,
    note: null,
    bugs: [],
  }
  const parsed: ParsedBug[] = []

  for (const item of input.bugs) {
    const bug = isBugFile(item.file) ? parseBug(item.file, item.text) : null

    if (bug !== null) {
      parsed.push(bug)
    }
  }

  base.bugs = openBugs(parsed, input.linkKeys)

  return input.tasks === null
    ? { ...base, note: noTasksNote(input.path, input.files) }
    : withTasks(base, input.tasks)
}

/** The view with the phase, the progress, and the note of a `tasks.md` text. */
export function withTasks(view: FeaturePaneView, text: string): FeaturePaneView {
  const parsed = parseTasks(text)

  return {
    ...view,
    progress: progressText(parsed.progress, parsed.phases),
    phase: currentPhase(parsed.phases),
    note: parsed.phases.length === 0 ? NO_PHASE_NOTE : null,
  }
}

/** The view with a new status. */
export function withStatus(view: FeaturePaneView, status: string | null): FeaturePaneView {
  return { ...view, status: status === null || status === '' ? null : status }
}

/**
 * The view with one bug file added, replaced, or removed. The bug stays only
 * when its file parses, it is open, and it links to the feature.
 */
export function withBug(view: FeaturePaneView, file: string, text: string): FeaturePaneView {
  const marker = 'x'
  const rest: ParsedBug[] = view.bugs
    .filter(bug => bug.file !== file)
    .map(bug => ({ id: bug.id, title: bug.title, status: null, linkedFeature: marker, file: bug.file }))
  const parsed = isBugFile(file) ? parseBug(file, text) : null

  if (parsed !== null && isOpenFor(parsed, view.linkKeys)) {
    rest.push({ ...parsed, status: null, linkedFeature: marker })
  }

  return { ...view, bugs: openBugs(rest, [marker]) }
}

function sameList<T>(a: T[], b: T[], same: (x: T, y: T) => boolean): boolean {
  return a.length === b.length && a.every((item, index) => same(item, b[index] as T))
}

function samePhase(a: FeaturePanePhase | null, b: FeaturePanePhase | null): boolean {
  if (a === null || b === null) {
    return a === b
  }

  return (
    a.title === b.title &&
    a.done === b.done &&
    a.total === b.total &&
    sameList(a.tasks, b.tasks, (x, y) => x.title === y.title && x.isDone === y.isDone)
  )
}

function sameBug(a: FeaturePaneBug, b: FeaturePaneBug): boolean {
  return a.id === b.id && a.title === b.title && a.file === b.file
}

/** True when two views hold every field equal. */
export function sameView(a: FeaturePaneView, b: FeaturePaneView): boolean {
  return (
    a.root === b.root &&
    a.path === b.path &&
    a.status === b.status &&
    a.progress === b.progress &&
    a.note === b.note &&
    sameList(a.linkKeys, b.linkKeys, (x, y) => x === y) &&
    samePhase(a.phase, b.phase) &&
    sameList(a.bugs, b.bugs, sameBug)
  )
}

/**
 * The lines of the pane, top to bottom (section 3.7). Line 0 is the path.
 *
 * @example viewLines(view)[0] // { text: 'shop/cart', tone: 'heading' }
 */
export function viewLines(view: FeaturePaneView): ViewLine[] {
  const out: ViewLine[] = [
    { text: view.path, tone: 'heading' },
    { text: `Status: ${view.status ?? 'not set'}`, tone: 'body' },
  ]

  if (view.progress !== null) {
    out.push({ text: `Progress: ${view.progress}`, tone: 'body' })
  }

  const block: ViewLine[] = []

  if (view.phase !== null) {
    block.push({ text: `${view.phase.title} (${view.phase.done}/${view.phase.total})`, tone: 'heading' })

    for (const task of view.phase.tasks) {
      block.push(
        task.isDone ? { text: `[x] ${task.title}`, tone: 'dim' } : { text: `[ ] ${task.title}`, tone: 'body' },
      )
    }
  } else if (view.note !== null) {
    block.push({ text: view.note, tone: 'dim' })
  }

  if (block.length > 0) {
    out.push({ text: '', tone: 'gap' }, ...block)
  }

  out.push({ text: '', tone: 'gap' })

  if (view.bugs.length === 0) {
    out.push({ text: 'Open bugs: none', tone: 'dim' })
  } else {
    out.push({ text: `Open bugs (${view.bugs.length})`, tone: 'heading' })

    for (const bug of view.bugs) {
      out.push({ text: `${bug.id}  ${bug.title}`, tone: 'body' })
    }
  }

  return out
}

/** The lines of `viewLines()` joined with `\n`. A gap gives an empty line. No `beast-mode: ` prefix. */
export function answerText(view: FeaturePaneView): string {
  return viewLines(view)
    .map(line => line.text)
    .join('\n')
}

function listOf(names: string[]): string {
  return names.join(', ')
}

/**
 * The answer of an outcome that is no feature: the strings of section 3.6,
 * word for word. A feature gives an empty string. An epic with no child `b` and no child at all gives the
 * empty-epic answer, since the list of choices would be empty.
 */
export function messageFor(outcome: Resolution): string {
  switch (outcome.kind) {
    case 'feature':
      return ''
    case 'notFound':
      return `No feature "${outcome.name}" in docs/features/. Run /feature with no name to show the active feature.`
    case 'noEpic':
      return `"${outcome.epic}" has no epic-overview.md, so "${outcome.name}" is no feature path. Run /feature ${outcome.epic}.`
    case 'noChild':
      return outcome.children.length === 0
        ? messageFor({ kind: 'emptyEpic', epic: outcome.epic })
        : `Epic "${outcome.epic}" has no feature "${outcome.child}". Run /feature ${outcome.epic}/<feature> with one of: ${listOf(outcome.children)}.`
    case 'wholeEpic':
      return `"${outcome.epic}" is an epic. Run /feature ${outcome.epic}/<feature> with one of: ${listOf(outcome.children)}.`
    case 'emptyEpic':
      return `"${outcome.epic}" is an epic with no feature folder yet. Run /plan-feature ${outcome.epic}/<feature>.`
    case 'ambiguous':
      return `"${outcome.name}" is in more than one epic: ${listOf(outcome.paths)}. Run /feature <epic>/${outcome.name}.`
    case 'noFolder':
      return 'No feature folder in docs/features/. Run /plan-feature <name> to start one.'
    case 'noCandidate':
      return 'No tasks.md in any feature folder. Run /start-feature <name>, or /feature <name>.'
  }
}

/** A path with `\` as `/`, `.` and `..` segments folded, and no trailing `/`. */
function normalize(path: string): string {
  const slashed = path.replace(/\\/g, '/')
  const drive = /^[A-Za-z]:(?=\/|$)/.exec(slashed)?.[0] ?? ''
  const rooted = slashed.startsWith('/')
  const kept: string[] = []

  for (const part of slashed.slice(drive.length).split('/')) {
    if (part === '' || part === '.') {
      continue
    }

    if (part === '..') {
      kept.pop()
      continue
    }

    kept.push(part)
  }

  return `${drive}${rooted || drive !== '' ? '/' : ''}${kept.join('/')}`
}

function isAbsolute(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:\//.test(path)
}

/** The normalized absolute path of an edit, joined to the root when relative. */
export function editPath(filePath: string, root: string): string {
  const slashed = filePath.replace(/\\/g, '/')

  return normalize(isAbsolute(slashed) ? slashed : `${normalize(root)}/${slashed}`)
}

/**
 * The kind of an edit that redraws the pane, or null (section 3.8). It changes
 * each `\` to `/` and joins a relative path to `view.root`.
 *
 * @example classifyEdit('/work/project/docs/features/demo/tasks.md', view) // 'tasks'
 */
export function classifyEdit(filePath: string, view: FeaturePaneView): EditKind | null {
  const file = editPath(filePath, view.root)
  const root = normalize(view.root)
  const folder = `${root}/docs/features/${view.path}/`
  const bugs = `${root}/docs/bugs/`

  if (file.startsWith(folder)) {
    const name = file.slice(folder.length)

    if (name === 'tasks.md') {
      return 'tasks'
    }

    return name === 'context.md' || name === 'implementation.md' ? 'status' : null
  }

  if (file.startsWith(bugs)) {
    const name = file.slice(bugs.length)

    return !name.includes('/') && isBugFile(name) ? 'bug' : null
  }

  return null
}
