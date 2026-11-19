// The tasks.md parse. Pure: no file here calls `$`. Never throws.

import type { FeaturePanePhase, FeaturePaneTask } from '../../types/index'
import { headerValue, lines, plainText } from './docs'

export type ParsedTasks = {
  /** `YYYY-MM-DD HH:MM` from the `Last Updated` value, or null. */
  stampKey: string | null
  /** The `**Progress:**` value, or null. */
  progress: string | null
  phases: FeaturePanePhase[]
}

const STAMP = /^(\d{4}-\d{2}-\d{2})(?:[ T]+(\d{1,2}):(\d{2}))?/
const PHASE = /^##\s+phase\s+\S/i
const TASK = /^[-*]\s+\\?\[([ xX])\\?\]\s*(.*)$/
const COUNT_GROUP = /\(\d+\/\d+/

/**
 * The sort key of a `Last Updated` value: `YYYY-MM-DD HH:MM`, with a padded
 * hour and `00:00` for a date with no time. Text after the match does not
 * count. Null for no match or a null value.
 *
 * @example stampKey('2026-09-18 15:44 UTC') // '2026-09-18 15:44'
 */
export function stampKey(value: string | null): string | null {
  const match = value === null ? null : STAMP.exec(value.trim())

  if (match === null) {
    return null
  }

  const hour = (match[2] ?? '0').padStart(2, '0')
  const minute = match[3] ?? '00'

  return `${match[1]} ${hour}:${minute}`
}

/**
 * The stamp key, the progress value, and the phases of a tasks.md text. Only
 * a `## Phase <x>` heading opens a phase, and the next `# ` or `## ` line
 * closes it, so the legend and bug sections count nowhere.
 */
export function parseTasks(text: string): ParsedTasks {
  const phases: FeaturePanePhase[] = []
  let open: FeaturePanePhase | null = null

  for (const line of lines(text)) {
    if (line.startsWith('# ') || line.startsWith('## ')) {
      open = null

      if (PHASE.test(line)) {
        const heading = line.replace(/^##\s+/, '')
        const cut = COUNT_GROUP.exec(heading)
        const title = (cut === null ? heading : heading.slice(0, cut.index)).trim()

        open = { title, done: 0, total: 0, tasks: [] }
        phases.push(open)
      }
      continue
    }

    if (open === null) {
      continue
    }

    const match = TASK.exec(line)

    if (match === null) {
      continue
    }

    const task: FeaturePaneTask = { title: plainText(match[2] ?? ''), isDone: match[1] !== ' ' }

    open.tasks.push(task)
    open.total += 1
    open.done += task.isDone ? 1 : 0
  }

  return {
    stampKey: stampKey(headerValue(text, 'Last Updated')),
    progress: headerValue(text, 'Progress') || null,
    phases,
  }
}

/**
 * The first phase with an open task, else the last phase, else null.
 */
export function currentPhase(phases: FeaturePanePhase[]): FeaturePanePhase | null {
  return phases.find(phase => phase.done < phase.total) ?? phases[phases.length - 1] ?? null
}

/**
 * The progress line: the `**Progress:**` value when it holds text, else
 * `<done>/<total> tasks complete (<pct>%)` over every task of every phase.
 *
 * @example progressText(null, phases) // '69/73 tasks complete (95%)'
 */
export function progressText(progress: string | null, phases: FeaturePanePhase[]): string {
  if (progress !== null && progress.trim() !== '') {
    return progress.trim()
  }

  let done = 0
  let total = 0

  for (const phase of phases) {
    done += phase.done
    total += phase.total
  }

  const pct = total === 0 ? 0 : Math.round((done / total) * 100)

  return `${done}/${total} tasks complete (${pct}%)`
}
