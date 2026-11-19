import { describe, expect, test } from 'claude-code/testing'
import type { DashboardPaneRoute, DashboardPaneState } from '../types/index'
import { buildBugView, buildEpic, buildFeature, buildProject } from '../hooks/lib/dashboard'
import {
  DASHBOARD_COMMAND,
  DASHBOARD_COMMANDS,
  DRAFT_MESSAGE,
  MAX_BACK,
  backMove,
  backRoute,
  canReplace,
  firstKey,
  goneMessage,
  notTakenMessage,
  openKey,
  openMove,
  resetMove,
  sameRoute,
  toggled,
} from '../hooks/lib/moves'
import { buildView } from '../hooks/lib/view'
import { BUG_001, DASH_CART_TASKS, DASH_EPIC_OVERVIEW, DASH_FEATURE_TREE, DASH_OVERVIEW, ROOT } from './fixtures'

const PROJECT_VIEW = buildProject({ root: ROOT, tree: DASH_FEATURE_TREE, overview: DASH_OVERVIEW, bugs: [] })
const EPIC_VIEW = buildEpic({ tree: DASH_FEATURE_TREE, epic: 'shop', text: DASH_EPIC_OVERVIEW, bugs: [] })
const FEATURE_VIEW = buildFeature(
  buildView({
    root: ROOT,
    path: 'shop/cart',
    linkKeys: ['shop/cart', 'cart'],
    files: ['tasks.md'],
    tasks: DASH_CART_TASKS,
    context: null,
    implementation: null,
    bugs: [],
  }),
  DASH_CART_TASKS,
)
const BUG_VIEW = buildBugView('BUG-001.md', BUG_001)

const PROJECT: DashboardPaneRoute = { kind: 'project' }
const EPIC: DashboardPaneRoute = { kind: 'epic', epic: 'shop' }
const FEATURE: DashboardPaneRoute = { kind: 'feature', path: 'shop/cart' }
const BUG: DashboardPaneRoute = { kind: 'bug', file: 'BUG-001.md' }

const START: DashboardPaneState = { root: ROOT, route: PROJECT, back: [], view: PROJECT_VIEW }

describe('routes: sameRoute', () => {
  test('two project routes are the same', () => {
    expect(sameRoute(PROJECT, { kind: 'project' })).toBe(true)
  })

  test('two epic routes are the same only for one epic', () => {
    expect(sameRoute(EPIC, { kind: 'epic', epic: 'shop' })).toBe(true)
    expect(sameRoute(EPIC, { kind: 'epic', epic: 'web' })).toBe(false)
  })

  test('two feature routes are the same only for one path', () => {
    expect(sameRoute(FEATURE, { kind: 'feature', path: 'shop/cart' })).toBe(true)
    expect(sameRoute(FEATURE, { kind: 'feature', path: 'demo' })).toBe(false)
  })

  test('two bug routes are the same only for one file', () => {
    expect(sameRoute(BUG, { kind: 'bug', file: 'BUG-001.md' })).toBe(true)
    expect(sameRoute(BUG, { kind: 'bug', file: 'BUG-002.md' })).toBe(false)
  })

  test('routes of two kinds are never the same', () => {
    const all = [PROJECT, EPIC, FEATURE, BUG]

    for (const a of all) {
      for (const b of all) {
        expect(sameRoute(a, b)).toBe(a === b)
      }
    }
  })
})

describe('routes: the moves', () => {
  test('/dashboard: resetMove gives the project route, an empty stack, and the project view', () => {
    expect(resetMove(ROOT, PROJECT_VIEW)).toEqual(START)
  })

  test('open R from S: the stack gains the route of S, and the route and view become R', () => {
    const next = openMove(START, EPIC, EPIC_VIEW)

    expect(next).toEqual({ root: ROOT, route: EPIC, back: [PROJECT], view: EPIC_VIEW })
  })

  test('open R from S: the old state stays as it was', () => {
    openMove(START, EPIC, EPIC_VIEW)

    expect(START.back).toEqual([])
    expect(START.route).toEqual(PROJECT)
  })

  test('open R when R is the shown route: the view reloads and the stack stays', () => {
    const inEpic = openMove(START, EPIC, EPIC_VIEW)
    const again = openMove(inEpic, EPIC, { ...EPIC_VIEW, status: 'Complete' })

    expect(again.back).toEqual([PROJECT])
    expect(again.route).toEqual(EPIC)
    expect(again.view).toEqual({ ...EPIC_VIEW, status: 'Complete' })
  })

  test('depth: project, epic, feature, bug holds three routes', () => {
    const feature = openMove(openMove(START, EPIC, EPIC_VIEW), FEATURE, FEATURE_VIEW)
    const bug = openMove(feature, BUG, BUG_VIEW)

    expect(bug.back).toEqual([PROJECT, EPIC, FEATURE])
    expect(bug.back.length).toBe(MAX_BACK)
  })

  test('depth: a fourth route in the stack drops the oldest', () => {
    const full: DashboardPaneState = { root: ROOT, route: BUG, back: [PROJECT, EPIC, FEATURE], view: BUG_VIEW }
    const next = openMove(full, EPIC, EPIC_VIEW)

    expect(next.back).toEqual([EPIC, FEATURE, BUG])
  })

  test('back from S: the route becomes the last route of the stack, and it leaves the stack', () => {
    const inFeature: DashboardPaneState = { root: ROOT, route: FEATURE, back: [PROJECT, EPIC], view: FEATURE_VIEW }
    const next = backMove(inFeature, EPIC_VIEW)

    expect(next).toEqual({ root: ROOT, route: EPIC, back: [PROJECT], view: EPIC_VIEW })
  })

  test('back one level at a time reaches the project', () => {
    const inEpic: DashboardPaneState = { root: ROOT, route: EPIC, back: [PROJECT], view: EPIC_VIEW }

    expect(backRoute(inEpic)).toEqual(PROJECT)
    expect(backMove(inEpic, PROJECT_VIEW)).toEqual(START)
  })

  test('back with an empty stack gives the project route and an empty stack', () => {
    const lost: DashboardPaneState = { root: ROOT, route: EPIC, back: [], view: EPIC_VIEW }

    expect(backRoute(lost)).toEqual(PROJECT)
    expect(backMove(lost, PROJECT_VIEW)).toEqual(START)
  })

  test('back that loads nothing: resetMove gives the project view and an empty stack', () => {
    expect(resetMove(ROOT, PROJECT_VIEW).back).toEqual([])
  })

  test('the stack holds routes only', () => {
    const next = openMove(START, EPIC, EPIC_VIEW)

    expect(JSON.stringify(next.back)).not.toContain('rows')
  })
})

describe('the toggles', () => {
  test('a closed phase opens', () => {
    expect(toggled([1], 0)).toEqual([0, 1])
  })

  test('an open phase closes', () => {
    expect(toggled([0, 1], 0)).toEqual([1])
  })

  test('the list stays ascending', () => {
    expect(toggled([0, 4], 2)).toEqual([0, 2, 4])
  })

  test('the list holds no repeat', () => {
    expect(toggled([1, 1, 2], 3)).toEqual([1, 2, 3])
  })

  test('the old list stays as it was', () => {
    const open = [1]

    toggled(open, 2)

    expect(open).toEqual([1])
  })

  test('a value that is no index changes nothing', () => {
    expect(toggled([1], -1)).toEqual([1])
    expect(toggled([1], 1.5)).toEqual([1])
    expect(toggled([1], Number.NaN)).toEqual([1])
  })

  test('an empty list opens the phase', () => {
    expect(toggled([], 0)).toEqual([0])
  })
})

describe('the fill guard', () => {
  test('an empty draft is replaced', () => {
    expect(canReplace('')).toBe(true)
  })

  test('a draft of spaces only is replaced', () => {
    expect(canReplace('  \n\t ')).toBe(true)
  })

  test('each dashboard command alone is replaced', () => {
    for (const name of DASHBOARD_COMMANDS) {
      expect(canReplace(`/${name}`)).toBe(true)
      expect(canReplace(`/${name} shop/cart`)).toBe(true)
    }
  })

  test('a command with a trim around it is replaced', () => {
    expect(canReplace('  /proceed  ')).toBe(true)
  })

  test('a command with two arguments is typed text', () => {
    expect(canReplace('/autorun-feature a b')).toBe(false)
  })

  test('a command that is no dashboard command is typed text', () => {
    expect(canReplace('/feature')).toBe(false)
    expect(canReplace('/autorun-feature-now')).toBe(false)
  })

  test('typed text is kept', () => {
    expect(canReplace('fix the cart')).toBe(false)
    expect(canReplace('/proceed and then more')).toBe(false)
    expect(canReplace('please /proceed')).toBe(false)
  })

  test('the command list holds the seven commands once', () => {
    expect([...DASHBOARD_COMMANDS]).toEqual([
      'autorun-feature',
      'proceed',
      'continue-feature',
      'update-feature',
      'autorun-epic',
      'update-epic',
      'fix-bug',
    ])
    expect(DASHBOARD_COMMAND.test('/fix-bug BUG-001')).toBe(true)
  })
})

describe('the keys', () => {
  test('openKey of an epic is open:<epic>', () => {
    expect(openKey(EPIC)).toBe('open:shop')
  })

  test('openKey of a feature is open:<path>', () => {
    expect(openKey(FEATURE)).toBe('open:shop/cart')
  })

  test('openKey of a bug is bug:<file>', () => {
    expect(openKey(BUG)).toBe('bug:BUG-001.md')
  })

  test('openKey of the project is null', () => {
    expect(openKey(PROJECT)).toBeNull()
  })

  test('firstKey of the project view is the open key of the first row with a folder', () => {
    expect(firstKey(PROJECT_VIEW)).toBe('open:shop')
  })

  test('firstKey passes over a missing row', () => {
    const ghost = PROJECT_VIEW.rows.filter(row => row.kind === 'missing')
    const rows = [...ghost, ...PROJECT_VIEW.rows.filter(row => row.kind !== 'missing')]

    expect(rows[0]?.kind).toBe('missing')
    expect(firstKey({ ...PROJECT_VIEW, rows })).toBe('open:shop')
  })

  test('firstKey of a project view with no row is null', () => {
    expect(firstKey({ ...PROJECT_VIEW, rows: [] })).toBeNull()
  })

  test('firstKey of the epic view is the open key of its first row', () => {
    expect(firstKey(EPIC_VIEW)).toBe('open:shop/cart')
  })

  test('firstKey of an epic view with no row is back', () => {
    expect(firstKey({ ...EPIC_VIEW, rows: [] })).toBe('back')
  })

  test('firstKey of the feature view and the bug view is back', () => {
    expect(firstKey(FEATURE_VIEW)).toBe('back')
    expect(firstKey(BUG_VIEW)).toBe('back')
  })
})

describe('the toast texts', () => {
  test('the draft toast', () => {
    expect(DRAFT_MESSAGE).toBe('The prompt holds a draft. Send it or clear it, then press again.')
  })

  test('the toast of a fill that did not take', () => {
    expect(notTakenMessage('/proceed')).toBe('The prompt did not take "/proceed". Type it there.')
  })

  test('the toast of an open that loads nothing', () => {
    expect(goneMessage('shop/cart')).toBe('"shop/cart" is gone. Run /dashboard to load the project again.')
  })
})
