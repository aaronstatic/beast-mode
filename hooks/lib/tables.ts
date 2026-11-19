// The status table parse and the progress rule. Pure: no file here calls `$`. Never throws.

import type { DashboardPaneProgress } from '../../types/index'
import { lines, printable } from './docs'

export type StatusRow = {
  name: string
  /** The cell text of `Status`, or null when the row has no such cell. */
  status: string | null
  /** The cell text of `Tasks`, or null when the table has no `Tasks` column or the row has no such cell. */
  tasks: string | null
}

export type StatusTable = {
  hasTable: boolean
  rows: StatusRow[]
}

const SEPARATOR_CELL = /^[-:\s]+$/

/**
 * The text of one table cell: every `**` and backtick removed, `[text](url)`
 * turned into `text`, the backslash of each markdown escape removed, trimmed,
 * and passed through `printable()`. Each emoji stays.
 *
 * @example cellText('**`a`** [b](https://x.y)') // 'a b'
 */
export function cellText(cell: string): string {
  return printable(
    cell
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\*\*/g, '')
      .replace(/`/g, '')
      .replace(/\\([\\`*_{}[\]()#+\-.!|<>~"'])/g, '$1')
      .trim(),
  )
}

/**
 * The name of a table row from its `Feature` cell: the cell text with a
 * trailing `(epic)` removed (no case match), then one trailing `/` removed,
 * then trimmed. With `epic`, a leading `<epic>/` is removed too.
 *
 * @example rowName('`claude-code` (epic)') // 'claude-code'
 */
export function rowName(cell: string, epic?: string): string {
  let name = cellText(cell)
    .replace(/\s*\(epic\)\s*$/i, '')
    .trim()

  if (name.endsWith('/')) {
    name = name.slice(0, -1)
  }

  name = name.trim()

  if (epic !== undefined && epic !== '' && name.startsWith(`${epic}/`)) {
    name = name.slice(epic.length + 1).trim()
  }

  return name
}

function cells(line: string): string[] {
  const pieces = line.trim().split(/(?<!\\)\|/)

  if (pieces.length > 0 && (pieces[0] ?? '').trim() === '') {
    pieces.shift()
  }

  if (pieces.length > 0 && (pieces[pieces.length - 1] ?? '').trim() === '') {
    pieces.pop()
  }

  return pieces.map(piece => piece.trim().replace(/\\\|/g, '|'))
}

function isPipeLine(line: string): boolean {
  return line.trimStart().startsWith('|')
}

function isSeparator(line: string | undefined): boolean {
  if (line === undefined || !isPipeLine(line)) {
    return false
  }

  const parts = cells(line)

  return parts.length > 0 && parts.every(part => SEPARATOR_CELL.test(part))
}

/**
 * The first status table of a doc: the Feature Status table of
 * `docs/overview.md` or the Features table of an epic. The header is the
 * first pipe line that holds a `Feature` cell and a `Status` cell (no case
 * match) with a separator row next. A row with no name or a repeated name is
 * skipped, and the first row of a name wins. Pass `epic` for an epic table.
 *
 * @example parseStatusTable('| Feature | Status |\n|---|---|\n| a | Done |\n').rows // [{ name: 'a', status: 'Done', tasks: null }]
 */
export function parseStatusTable(text: string, epic?: string): StatusTable {
  const all = lines(text)

  for (let at = 0; at < all.length; at++) {
    const line = all[at] ?? ''

    if (!isPipeLine(line) || !isSeparator(all[at + 1])) {
      continue
    }

    const head = cells(line).map(cell => cellText(cell).toLowerCase())
    const feature = head.indexOf('feature')
    const status = head.indexOf('status')

    if (feature === -1 || status === -1) {
      continue
    }

    const tasks = head.indexOf('tasks')
    const seen = new Set<string>()
    const rows: StatusRow[] = []

    for (let next = at + 2; next < all.length && isPipeLine(all[next] ?? ''); next++) {
      const parts = cells(all[next] ?? '')
      const name = rowName(parts[feature] ?? '', epic)

      if (name === '' || seen.has(name)) {
        continue
      }

      seen.add(name)

      const statusCell = parts[status]
      const tasksCell = tasks === -1 ? undefined : parts[tasks]

      rows.push({
        name,
        status: statusCell === undefined ? null : cellText(statusCell),
        tasks: tasksCell === undefined ? null : cellText(tasksCell),
      })
    }

    return { hasTable: true, rows }
  }

  return { hasTable: false, rows: [] }
}

/**
 * The progress of one `Tasks` cell, by the first rule that matches: no digit
 * gives null. The last `(<n>/<m>` pair is the total. Else the sum of every
 * `<n>/<m>` pair. Else the last `<n>%` over 100. Else null.
 *
 * @example progressOf('core 39/39 + autorun-epic 37/42 + 1 planning') // { done: 76, total: 81 }
 */
export function progressOf(cell: string): DashboardPaneProgress | null {
  if (!/\d/.test(cell)) {
    return null
  }

  const after = [...cell.matchAll(/\((\d+)\/(\d+)/g)].pop()

  if (after !== undefined) {
    return { done: Number(after[1]), total: Number(after[2]) }
  }

  const pairs = [...cell.matchAll(/(\d+)\/(\d+)/g)]

  if (pairs.length > 0) {
    return {
      done: pairs.reduce((sum, pair) => sum + Number(pair[1]), 0),
      total: pairs.reduce((sum, pair) => sum + Number(pair[2]), 0),
    }
  }

  const percent = [...cell.matchAll(/(\d+)%/g)].pop()

  return percent === undefined ? null : { done: Number(percent[1]), total: 100 }
}
