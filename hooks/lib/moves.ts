// The routes, the back stack, the phase toggles, the fill guard, the focus
// keys, and the toast texts of the dashboard. Pure: no file here calls `$`.
// Never throws.

import type {
  DashboardPaneProjectView,
  DashboardPaneRoute,
  DashboardPaneState,
  DashboardPaneView,
} from '../../types/index'

/** The most routes that the back stack holds (section 3.8). */
export const MAX_BACK = 3

/** The commands that a button fills. `layout.ts` builds the fill texts from this list. */
export const DASHBOARD_COMMANDS = [
  'autorun-feature',
  'proceed',
  'continue-feature',
  'update-feature',
  'autorun-epic',
  'update-epic',
  'fix-bug',
] as const

export type DashboardCommand = (typeof DASHBOARD_COMMANDS)[number]

/** One dashboard command alone, with at most one argument (section 3.9). */
export const DASHBOARD_COMMAND = new RegExp(`^/(${DASHBOARD_COMMANDS.join('|')})( \\S+)?$`)

/** The toast of a fill over typed text. */
export const DRAFT_MESSAGE = 'The prompt holds a draft. Send it or clear it, then press again.'

/** The toast of a fill that the prompt did not take. */
export function notTakenMessage(text: string): string {
  return `The prompt did not take "${text}". Type it there.`
}

/** The toast of an open that loads nothing. */
export function goneMessage(target: string): string {
  return `"${target}" is gone. Run /dashboard to load the project again.`
}

/**
 * True when two routes name the same view: the same kind and the same epic,
 * path, or file.
 *
 * @example sameRoute({ kind: 'epic', epic: 'shop' }, { kind: 'epic', epic: 'shop' }) // true
 */
export function sameRoute(a: DashboardPaneRoute, b: DashboardPaneRoute): boolean {
  switch (a.kind) {
    case 'project':
      return b.kind === 'project'
    case 'epic':
      return b.kind === 'epic' && a.epic === b.epic
    case 'feature':
      return b.kind === 'feature' && a.path === b.path
    case 'bug':
      return b.kind === 'bug' && a.file === b.file
  }
}

/**
 * The state after an open of `route` that loaded `view`. The stack gains the
 * route that the person leaves, and it keeps the newest three. An open of the
 * shown route reloads the view and keeps the stack.
 */
export function openMove(state: DashboardPaneState, route: DashboardPaneRoute, view: DashboardPaneView): DashboardPaneState {
  if (sameRoute(route, state.route)) {
    return { ...state, view }
  }

  return { root: state.root, route, back: [...state.back, state.route].slice(-MAX_BACK), view }
}

/** The route that Back leaves for: the last route of the stack, else the project. */
export function backRoute(state: DashboardPaneState): DashboardPaneRoute {
  return state.back[state.back.length - 1] ?? { kind: 'project' }
}

/** The state after a Back that loaded `view` for `backRoute(state)`. The route leaves the stack. */
export function backMove(state: DashboardPaneState, view: DashboardPaneView): DashboardPaneState {
  return { root: state.root, route: backRoute(state), back: state.back.slice(0, -1), view }
}

/** The state of the project view with an empty stack: the `/dashboard` run, and a Back that loads nothing. */
export function resetMove(root: string, view: DashboardPaneProjectView): DashboardPaneState {
  return { root, route: { kind: 'project' }, back: [], view }
}

/**
 * The open phases after a toggle of phase `index`: the index leaves when it
 * is in the list, else it joins. The result is ascending with no repeat. A
 * value that is no index of a phase changes nothing.
 *
 * @example toggled([0], 2) // [0, 2]
 */
export function toggled(expanded: number[], index: number): number[] {
  const valid = Number.isInteger(index) && index >= 0
  const kept = [...new Set(expanded)]
  const next = !valid ? kept : kept.includes(index) ? kept.filter(item => item !== index) : [...kept, index]

  return next.sort((a, b) => a - b)
}

/**
 * True when a fill may replace the draft: empty, spaces only, or one
 * dashboard command alone (section 3.9). It never allows the removal of text
 * that the person typed.
 *
 * @example canReplace('/proceed') // true
 */
export function canReplace(draft: string): boolean {
  const text = draft.trim()

  return text === '' || DASHBOARD_COMMAND.test(text)
}

/**
 * The key of the button that opens a route, or null for the project route,
 * which no button opens. Back puts the focus ring here.
 *
 * @example openKey({ kind: 'bug', file: 'BUG-001.md' }) // 'bug:BUG-001.md'
 */
export function openKey(route: DashboardPaneRoute): string | null {
  switch (route.kind) {
    case 'project':
      return null
    case 'epic':
      return `open:${route.epic}`
    case 'feature':
      return `open:${route.path}`
    case 'bug':
      return `bug:${route.file}`
  }
}

/**
 * The key where the focus ring starts on a view: the open key of the first
 * row with a folder, else `back`, else null (a project view with no row).
 */
export function firstKey(view: DashboardPaneView): string | null {
  if (view.kind === 'project' || view.kind === 'epic') {
    const row = view.rows.find(item => item.kind !== 'missing')

    if (row !== undefined) {
      return `open:${row.path}`
    }
  }

  return view.kind === 'project' ? null : 'back'
}
