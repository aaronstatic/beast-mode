// The line model of the four dashboard views (section 3.10), the text of a
// line, and the text answer. Pure: no file here calls `$`. Never throws.

import type {
  DashboardPaneEpicView,
  DashboardPaneFeatureView,
  DashboardPaneBugView,
  DashboardPaneProjectView,
  DashboardPaneRoute,
  DashboardPaneRow,
  DashboardPaneState,
} from '../../types/index'
import type { BarModel } from './bar'
import { bar, barText } from './bar'
import { openCount } from './dashboard'
import type { DashboardCommand } from './moves'
import { currentPhase } from './tasks'

/** The answer of a `/dashboard` run that has no state to show. */
export const IDLE_LINE = 'No dashboard loaded. Run /dashboard to load one.'

export type LineTone = 'heading' | 'body' | 'dim'

/** How a `Text` shortens: the name and the path keep both ends, the rest keeps the start. */
export type LineWrap = 'truncate-end' | 'truncate-middle'

/** What a press does. Back and toggle load nothing from a file, an open loads a view. */
export type LineAction =
  | { kind: 'open'; route: DashboardPaneRoute }
  | { kind: 'back' }
  | { kind: 'fill'; command: DashboardCommand; text: string }
  | { kind: 'toggle'; phase: number }

export type TextPart = { kind: 'text'; text: string; tone: LineTone; wrap: LineWrap }
export type BarPart = { kind: 'bar'; model: BarModel; label: string }
export type ButtonPart = {
  kind: 'button'
  /** The key of section 3.9. */
  key: string
  label: string
  /** The hotkey of a plain button, or null. */
  hotkey: string | null
  /** True for a plain button (the actions, Back, and the phase toggle). */
  isPlain: boolean
  action: LineAction
}
export type MarkdownPart = { kind: 'markdown'; text: string }

export type LinePart = TextPart | BarPart | ButtonPart | MarkdownPart

/** One line: an indent in cells, then the parts. A gap has no part and `isGap` true. */
export type DashboardLine = { indent: number; parts: LinePart[]; isGap: boolean }

const PART_JOIN = '  '
const SOURCE_NO_FILE = 'No docs/overview.md. Run /update-master to make one.'
const SOURCE_NO_TABLE = 'No Feature Status table in docs/overview.md. Run /update-master.'
const NOT_LISTED_PROJECT = 'not in docs/overview.md'
const NOT_LISTED_EPIC = 'not in the Features table'

/**
 * The text of a fill: the command with a slash, then the argument when there is one.
 *
 * @example fillText('autorun-feature', 'shop/cart') // '/autorun-feature shop/cart'
 */
export function fillText(command: DashboardCommand, argument?: string): string {
  return argument === undefined || argument === '' ? `/${command}` : `/${command} ${argument}`
}

function text(words: string, tone: LineTone = 'body', wrap: LineWrap = 'truncate-end'): TextPart {
  return { kind: 'text', text: words, tone, wrap }
}

function barPart(done: number, total: number, label: string): BarPart {
  return { kind: 'bar', model: bar(done, total), label }
}

function plainButton(key: string, label: string, hotkey: string | null, action: LineAction): ButtonPart {
  return { kind: 'button', key, label, hotkey, isPlain: true, action }
}

function backButton(): ButtonPart {
  return plainButton('back', 'Back', 'b', { kind: 'back' })
}

function fillButton(key: string, label: string, hotkey: string, command: DashboardCommand, argument?: string): ButtonPart {
  return plainButton(key, label, hotkey, { kind: 'fill', command, text: fillText(command, argument) })
}

function line(parts: LinePart[], indent: number = 0): DashboardLine {
  return { indent, parts, isGap: false }
}

function gap(): DashboardLine {
  return { indent: 0, parts: [], isGap: true }
}

function openRoute(row: DashboardPaneRow): DashboardPaneRoute {
  return row.kind === 'epic' ? { kind: 'epic', epic: row.path } : { kind: 'feature', path: row.path }
}

function bugCount(count: number): string {
  return count === 1 ? '1 open bug' : `${count} open bugs`
}

/** The two lines of one row (section 3.10, project lines 4 and 5). */
function rowLines(row: DashboardPaneRow, bugs: DashboardPaneProjectView['bugs'], unlisted: string): DashboardLine[] {
  const name: LinePart[] = []

  if (row.kind === 'missing') {
    name.push(text(row.name, 'dim'), text('no folder', 'dim'))
  } else {
    name.push({
      kind: 'button',
      key: `open:${row.path}`,
      label: row.name,
      hotkey: null,
      isPlain: false,
      action: { kind: 'open', route: openRoute(row) },
    })

    if (row.kind === 'epic') {
      name.push(text('epic', 'dim'))
    } else {
      name.push({
        kind: 'button',
        key: `run:${row.path}`,
        label: 'Autorun',
        hotkey: null,
        isPlain: false,
        action: { kind: 'fill', command: 'autorun-feature', text: fillText('autorun-feature', row.path) },
      })
    }
  }

  const detail: LinePart[] = []

  if (row.progress !== null) {
    const model = bar(row.progress.done, row.progress.total)

    detail.push({ kind: 'bar', model, label: `${model.pct}%` })
  }

  const open = openCount(bugs, row.path)

  if (open > 0) {
    detail.push(text(bugCount(open)))
  }

  if (!row.isListed) {
    detail.push(text(unlisted, 'dim'))
  } else if (row.status !== null) {
    detail.push(text(row.status))
  }

  if (detail.length === 0) {
    detail.push(text('no status', 'dim'))
  }

  return [line(name), line(detail, 2)]
}

function sourceLine(source: string): DashboardLine {
  return line([text(source, 'dim')])
}

function projectLines(view: DashboardPaneProjectView): DashboardLine[] {
  const stamp = view.updated === null ? '' : `, updated ${view.updated}`
  const source =
    view.source === 'table'
      ? `From docs/overview.md${stamp}`
      : view.source === 'noTable'
        ? SOURCE_NO_TABLE
        : SOURCE_NO_FILE
  const out: DashboardLine[] = [line([text(view.project, 'heading', 'truncate-middle')]), sourceLine(source), gap()]

  if (view.rows.length === 0) {
    out.push(line([text('No feature folder in docs/features/. Run /plan-feature <name> to start one.', 'dim')]))
  }

  for (const row of view.rows) {
    out.push(...rowLines(row, view.bugs, NOT_LISTED_PROJECT))
  }

  return out
}

function epicLines(view: DashboardPaneEpicView): DashboardLine[] {
  const stamp = view.updated === null ? '' : `, updated ${view.updated}`
  const source =
    view.source === 'table' ? `From epic-overview.md${stamp}` : `No Features table in epic-overview.md. Run /update-epic ${view.epic}.`
  const out: DashboardLine[] = [
    line([backButton(), text(view.epic, 'heading', 'truncate-middle')]),
    line([text(`Status: ${view.status ?? 'not set'}`)]),
    sourceLine(source),
    line([
      fillButton('act:autorun-epic', 'Autorun', 'a', 'autorun-epic', view.epic),
      fillButton('act:update-epic', 'Update', 'u', 'update-epic', view.epic),
    ]),
    gap(),
  ]

  if (view.rows.length === 0) {
    out.push(line([text(`No feature folder in this epic yet. Run /plan-feature ${view.epic}/<feature>.`, 'dim')]))
  }

  for (const row of view.rows) {
    out.push(...rowLines(row, view.bugs, NOT_LISTED_EPIC))
  }

  return out
}

function featureLines(view: DashboardPaneFeatureView): DashboardLine[] {
  const feature = view.feature
  const out: DashboardLine[] = [
    line([backButton(), text(feature.path, 'heading', 'truncate-middle')]),
    line([text(`Status: ${feature.status ?? 'not set'}`)]),
  ]

  if (feature.progress !== null) {
    const done = view.phases.reduce((sum, phase) => sum + phase.done, 0)
    const total = view.phases.reduce((sum, phase) => sum + phase.total, 0)

    out.push(line([text('Progress:'), barPart(done, total, feature.progress)]))
  }

  out.push(
    line([
      fillButton('act:autorun-feature', 'Autorun', 'a', 'autorun-feature', feature.path),
      fillButton('act:proceed', 'Proceed', 'p', 'proceed'),
      fillButton('act:continue-feature', 'Continue', 'c', 'continue-feature', feature.path),
      fillButton('act:update-feature', 'Update', 'u', 'update-feature', feature.path),
    ]),
  )

  const block: DashboardLine[] = []
  const current = currentPhase(view.phases)

  if (view.phases.length > 0) {
    block.push(line([text(`Phases (${view.phases.length})`, 'heading')]))
  } else if (feature.note !== null) {
    block.push(line([text(feature.note, 'dim')]))
  }

  view.phases.forEach((phase, index) => {
    const isOpen = view.expanded.includes(index)

    block.push(
      line([
        plainButton(`phase:${index}`, isOpen ? '-' : '+', null, { kind: 'toggle', phase: index }),
        barPart(phase.done, phase.total, ''),
        text(`${phase.title} (${phase.done}/${phase.total})`, phase === current ? 'heading' : 'body'),
      ]),
    )

    if (isOpen) {
      for (const task of phase.tasks) {
        block.push(line([task.isDone ? text(`[x] ${task.title}`, 'dim') : text(`[ ] ${task.title}`)], 4))
      }
    }
  })

  if (block.length > 0) {
    out.push(gap(), ...block)
  }

  out.push(gap())

  if (feature.bugs.length === 0) {
    out.push(line([text('Open bugs: none', 'dim')]))
  } else {
    out.push(line([text(`Open bugs (${feature.bugs.length})`, 'heading')]))

    for (const bug of feature.bugs) {
      out.push(
        line([
          {
            kind: 'button',
            key: `bug:${bug.file}`,
            label: bug.id,
            hotkey: null,
            isPlain: false,
            action: { kind: 'open', route: { kind: 'bug', file: bug.file } },
          },
          text(bug.title),
        ]),
      )
    }
  }

  return out
}

function bugLines(view: DashboardPaneBugView): DashboardLine[] {
  const out: DashboardLine[] = [
    line([backButton(), text(view.id, 'heading')]),
    line([text(view.title, 'heading')]),
    line([fillButton('act:fix-bug', 'Fix', 'f', 'fix-bug', view.id)]),
    gap(),
  ]
  const block: DashboardLine[] = view.fields.map(field => line([text(`${field.key}: ${field.value}`)]))

  if (block.length === 0 && view.note !== null) {
    block.push(line([text(view.note, 'dim')]))
  }

  if (block.length > 0) {
    out.push(...block, gap())
  }

  out.push(
    view.body.trim() === '' ? line([text('No description.', 'dim')]) : line([{ kind: 'markdown', text: view.body }]),
  )

  return out
}

/**
 * The lines of the shown view, top to bottom (section 3.10).
 *
 * @example dashboardLines(state)[0].parts[0] // { kind: 'text', text: 'project', tone: 'heading', wrap: 'truncate-middle' }
 */
export function dashboardLines(state: DashboardPaneState): DashboardLine[] {
  const view = state.view

  switch (view.kind) {
    case 'project':
      return projectLines(view)
    case 'epic':
      return epicLines(view)
    case 'feature':
      return featureLines(view)
    case 'bug':
      return bugLines(view)
  }
}

/** The text of one part, or an empty string. */
function partText(part: LinePart): string {
  switch (part.kind) {
    case 'text':
    case 'markdown':
      return part.text
    case 'bar': {
      const cells = barText(part.model)

      return part.label === '' ? cells : `${cells} ${part.label}`
    }
    case 'button':
      return part.isPlain && part.hotkey !== null ? `${part.hotkey}: ${part.label}` : part.label
  }
}

function joined(parts: LinePart[]): string {
  return parts
    .map(partText)
    .filter(item => item !== '')
    .join(PART_JOIN)
}

/**
 * The text of a line: the indent, then the texts of the parts joined with
 * two spaces. A gap gives an empty string.
 *
 * @example lineText(line) // 'b: Back  shop'
 */
export function lineText(item: DashboardLine): string {
  return `${' '.repeat(Math.max(0, item.indent))}${joined(item.parts)}`
}

/**
 * The text answer: the same rule as `lineText()`, but a button counts only
 * when its action is open. A line that keeps no text is dropped, and a gap
 * stays as an empty line. The lines join with `\n`, with no `beast-mode: ` prefix.
 */
export function answerText(lines: DashboardLine[]): string {
  const out: string[] = []

  for (const item of lines) {
    if (item.isGap) {
      out.push('')
      continue
    }

    const kept = joined(item.parts.filter(part => part.kind !== 'button' || part.action.kind === 'open'))

    if (kept !== '') {
      out.push(`${' '.repeat(Math.max(0, item.indent))}${kept}`)
    }
  }

  return out.join('\n')
}
