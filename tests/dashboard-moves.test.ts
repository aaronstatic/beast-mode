import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, Shaped } from 'claude-code'

import type { DashboardPaneRoute, DashboardPaneState } from '../types/index'
import { DASH_LINES_BUG, DASH_LINES_EPIC, DASH_LINES_FEATURE, DASH_LINES_PROJECT, DASH_TREE, ROOT } from './fixtures'
import { world } from './world'
import type { World, WorldOptions } from './world'

// The moves and the buttons of the dashboard through the engine of the test
// kit, over the world of tests/world.ts: each open, each Back, the open of the
// shown route, a target that is gone, the route guard, the stack depth, the
// phase toggles, and the fill of each action button (sections 3.8 and 3.9).
//
// F3: a press runs the closure, `update` writes, and the mount draws again
// before `press` resolves, so a test reads the drawing right after the await.
// F6: the kit has no implementation of a plugin's $.ui.focus. The call rejects
// before it reaches the world hook, and the hook ignores the rejection. So each
// move test asserts that `w.focuses` stays `[]` and that the move still writes.
// No test asserts a focus key.

const DASHBOARD = 'dashboard'
const FEATURES = `${ROOT}/docs/features`
const BUGS = `${ROOT}/docs/bugs`

const PROJECT: DashboardPaneRoute = { kind: 'project' }
const SHOP: DashboardPaneRoute = { kind: 'epic', epic: 'shop' }
const CART: DashboardPaneRoute = { kind: 'feature', path: 'shop/cart' }
const DEMO: DashboardPaneRoute = { kind: 'feature', path: 'demo' }
const BUG: DashboardPaneRoute = { kind: 'bug', file: 'BUG-001.md' }

/** The presses that open each view from the project view: one level down per press. */
const TO_EPIC = ['open:shop']
const TO_FEATURE = ['open:shop', 'open:shop/cart']
const TO_BUG = ['open:shop', 'open:shop/cart', 'bug:BUG-001.md']

/** The project view as the terminal pane draws it: the text answer, and the `Autorun` button of each feature row. */
const PANE_LINES_PROJECT = DASH_LINES_PROJECT.map(line => (line === 'demo' || line === 'notes' ? `${line}  Autorun` : line))

/** The feature view of the top feature `demo`. Its one phase is the current phase, so it is open. */
const DEMO_LINES = [
  'b: Back  demo',
  'Status: not set',
  'Progress:  ██████████ 3/3 tasks complete (100%)',
  'a: Autorun  p: Proceed  c: Continue  u: Update',
  '',
  'Phases (1)',
  '-  ██████████  Phase 1: Setup (3/3)',
  '    [x] 1.1 Make the folder',
  '    [x] 1.2 Add the readme',
  '    [x] 1.3 Add the notes',
  '',
  'Open bugs (1)',
  'BUG-003  A demo bug',
]

type Drawn = { type: string; props?: Record<string, unknown>; children?: (Drawn | string)[] }

/** Runs `/dashboard` as the person typing it in the composer does. */
function run($: Engine) {
  return $.command.run({
    command: DASHBOARD,
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 80 },
  })
}

/** Draws the dashboard pane on the terminal, at the 56 columns that the open asks for. */
function mountDashboard($: Engine) {
  return $.ui.mount({
    plugin: 'beast-mode',
    surface: 'terminal',
    component: 'Pane',
    requestId: DASHBOARD,
    props: {
      title: 'Dashboard',
      isFocused: true,
      bodyColumns: 56,
      placement: 'inline',
      scroll: { offset: 0, bodyRows: DASH_LINES_PROJECT.length },
      view: {},
    },
  })
}

/** The tree as last drawn, as plain data. */
async function drawnOf(ui: { drawn: () => Promise<unknown> }): Promise<Drawn> {
  return (await ui.drawn()) as Drawn
}

function isDrawn(child: Drawn | string): child is Drawn {
  return typeof child !== 'string'
}

/** The text that an element shows: its strings, the strings of each span included. */
function textOf(node: Drawn | string): string {
  return typeof node === 'string' ? node : (node.children ?? []).map(textOf).join('')
}

/** The text of one element of a row: a button as `lineText()` writes it, and no text for an `Svg`. */
function partOf(node: Drawn): string {
  const props = node.props ?? {}

  if (node.type === 'Button') {
    const label = String(props.label ?? '')

    return props.plain === true && typeof props.hotkey === 'string' ? `${props.hotkey}: ${label}` : label
  }

  return node.type === 'Svg' ? '' : textOf(node)
}

/** The text of each line of the root `Box`. A row joins its parts with two spaces after its padding. A gap reads as ''. */
function linesOf(tree: Drawn): string[] {
  return (tree.children ?? []).filter(isDrawn).map(row => {
    if (row.type === 'Box') {
      const parts = (row.children ?? []).filter(isDrawn).map(partOf).filter(text => text !== '')

      return `${' '.repeat(Number(row.props?.paddingLeft ?? 0))}${parts.join('  ')}`
    }

    const text = row.type === 'Markdown' ? String(row.props?.text ?? '') : textOf(row)

    return text === ' ' ? '' : text
  })
}

/**
 * Records each dashboard state that the plugin writes. The hook sits beneath
 * the plugin beside the world, and it passes each write on. The test `Engine`
 * holds no `state` noun, so a test reads the stack here.
 */
function writesOf(on: On): DashboardPaneState[] {
  const written: DashboardPaneState[] = []

  on('state.set', { plugin: 'beast-mode', key: 'dashboardPane' }, ($, e, next) => {
    written.push((e.value as unknown as Shaped<DashboardPaneState>).value)

    return next(e)
  })

  return written
}

/** The route and the stack of each write. */
function movesOf(written: DashboardPaneState[]): [DashboardPaneRoute, DashboardPaneRoute[]][] {
  return written.map(state => [state.route, state.back])
}

/** The open phases of each write of a feature view. */
function expandedOf(written: DashboardPaneState[]): (number[] | null)[] {
  return written.map(state => (state.view.kind === 'feature' ? state.view.expanded : null))
}

/** Removes each file of the world at `path` or under it, as a person who deletes a file or a folder does. */
function remove(w: World, path: string): void {
  for (const file of [...w.files.keys()]) {
    if (file === path || file.startsWith(`${path}/`)) {
      w.files.delete(file)
    }
  }
}

/**
 * Runs /dashboard on a terminal over DASH_TREE, draws the pane, and presses
 * each key in turn. Then it sets the counts and the record of writes back to none.
 */
async function shown($: Engine, on: On, keys: readonly string[] = [], options: WorldOptions = {}) {
  const w = world(on, { files: DASH_TREE, ...options })
  const written = writesOf(on)

  await run($)
  const ui = await mountDashboard($)

  for (const key of keys) {
    await ui.press({ key })
  }

  w.resetCounts()
  written.length = 0

  return { w, ui, written }
}

describe('the moves: open', () => {
  test('open:shop on the project view opens the epic view, and the stack gains the project route', async ($, on) => {
    const { w, ui, written } = await shown($, on)

    await ui.press({ key: 'open:shop' })
    expect(movesOf(written)).toEqual([[SHOP, [PROJECT]]])
    expect(w.dashboardWrites).toBe(1)
    expect(w.toasts).toEqual([])
    // F6: the focus on back never reaches the world, and the move still writes.
    expect(w.focuses).toEqual([])
    expect(linesOf(await drawnOf(ui))).toEqual([...DASH_LINES_EPIC])
  })

  test('open:demo on the project view opens the feature view of a top feature', async ($, on) => {
    const { w, ui, written } = await shown($, on)

    await ui.press({ key: 'open:demo' })
    expect(movesOf(written)).toEqual([[DEMO, [PROJECT]]])
    expect(w.focuses).toEqual([])
    expect(linesOf(await drawnOf(ui))).toEqual(DEMO_LINES)
  })

  test('open:shop/cart on the epic view opens the feature view, and the stack gains the epic route', async ($, on) => {
    const { w, ui, written } = await shown($, on, TO_EPIC)

    await ui.press({ key: 'open:shop/cart' })
    expect(movesOf(written)).toEqual([[CART, [PROJECT, SHOP]]])
    expect(expandedOf(written)).toEqual([[1]])
    expect(w.focuses).toEqual([])
    expect(linesOf(await drawnOf(ui))).toEqual([...DASH_LINES_FEATURE])
  })

  test('bug:BUG-001.md on the feature view opens the bug view, and the stack gains the feature route', async ($, on) => {
    const { w, ui, written } = await shown($, on, TO_FEATURE)

    await ui.press({ key: 'bug:BUG-001.md' })
    expect(movesOf(written)).toEqual([[BUG, [PROJECT, SHOP, CART]]])
    expect(w.focuses).toEqual([])
    expect(linesOf(await drawnOf(ui))).toEqual([...DASH_LINES_BUG])
  })

  test('a feature move reads the whole view: tasks.md two times, and context.md once', async ($, on) => {
    const { w, ui } = await shown($, on, TO_EPIC)

    await ui.press({ key: 'open:shop/cart' })
    expect(w.reads.get(`${FEATURES}/shop/cart/tasks.md`)).toBe(2)
    expect(w.reads.get(`${FEATURES}/shop/cart/context.md`)).toBe(1)
    expect(linesOf(await drawnOf(ui))[0]).toBe('b: Back  shop/cart')
  })
})

describe('the moves: Back', () => {
  test('Back on the bug view opens the feature view, and the feature route leaves the stack', async ($, on) => {
    const { w, ui, written } = await shown($, on, TO_BUG)

    await ui.press({ key: 'back' })
    expect(movesOf(written)).toEqual([[CART, [PROJECT, SHOP]]])
    // F6: the focus on bug:BUG-001.md never reaches the world, and the move still writes.
    expect(w.focuses).toEqual([])
    expect(linesOf(await drawnOf(ui))).toEqual([...DASH_LINES_FEATURE])
  })

  test('Back on the feature view reads the epic again and opens the epic view', async ($, on) => {
    const { w, ui, written } = await shown($, on, TO_FEATURE)

    await ui.press({ key: 'back' })
    expect(movesOf(written)).toEqual([[SHOP, [PROJECT]]])
    expect(w.reads.get(`${FEATURES}/shop/epic-overview.md`)).toBe(1)
    expect(w.focuses).toEqual([])
    expect(linesOf(await drawnOf(ui))).toEqual([...DASH_LINES_EPIC])
  })

  test('Back on the epic view opens the project view with an empty stack', async ($, on) => {
    const { w, ui, written } = await shown($, on, TO_EPIC)

    await ui.press({ key: 'back' })
    expect(movesOf(written)).toEqual([[PROJECT, []]])
    expect(w.focuses).toEqual([])
    expect(linesOf(await drawnOf(ui))).toEqual(PANE_LINES_PROJECT)
  })

  test('Back on a top feature opens the project view with an empty stack', async ($, on) => {
    const { w, ui, written } = await shown($, on, ['open:demo'])

    await ui.press({ key: 'back' })
    expect(movesOf(written)).toEqual([[PROJECT, []]])
    expect(w.focuses).toEqual([])
    expect(linesOf(await drawnOf(ui))).toEqual(PANE_LINES_PROJECT)
  })

  test('the stack holds routes only: Back loads the feature again with its current phase open', async ($, on) => {
    const { ui, written } = await shown($, on, TO_FEATURE)

    await ui.press({ key: 'phase:0' })
    await ui.press({ key: 'bug:BUG-001.md' })
    await ui.press({ key: 'back' })
    expect(movesOf(written)).toEqual([
      [CART, [PROJECT, SHOP]],
      [BUG, [PROJECT, SHOP, CART]],
      [CART, [PROJECT, SHOP]],
    ])
    expect(expandedOf(written)).toEqual([[0, 1], null, [1]])
    expect(linesOf(await drawnOf(ui))).toEqual([...DASH_LINES_FEATURE])
  })
})

describe('the moves: the open of the shown route', () => {
  // No view draws a button that opens its own route, and each press needs the
  // state route to equal the drawn route. So no true state reaches this move.
  // A test hook rewrites the first write: the state holds the epic route of
  // `shop` over the project view, so the drawn `open:shop` opens the shown route.
  test('an open of the shown route loads the view again and keeps the stack', async ($, on) => {
    const w = world(on, { files: DASH_TREE })
    const written = writesOf(on)
    let isRouted = false

    on('state.set', { plugin: 'beast-mode', key: 'dashboardPane' }, ($, e, next) => {
      if (isRouted) {
        return next(e)
      }

      isRouted = true
      const shaped = e.value as unknown as Shaped<DashboardPaneState>

      return next({ ...e, value: { ...shaped, value: { ...shaped.value, route: SHOP } } } as unknown as typeof e)
    })

    await run($)
    const ui = await mountDashboard($)

    expect(linesOf(await drawnOf(ui))).toEqual(PANE_LINES_PROJECT)
    w.resetCounts()
    written.length = 0

    await ui.press({ key: 'open:shop' })
    expect(movesOf(written)).toEqual([[SHOP, []]])
    expect(written[0]?.view.kind).toBe('epic')
    expect(w.focuses).toEqual([])
    expect(linesOf(await drawnOf(ui))).toEqual([...DASH_LINES_EPIC])
  })
})

describe('the moves: a target that is gone', () => {
  const GONE = [
    { what: 'an epic folder', keys: [], path: `${FEATURES}/shop`, key: 'open:shop', target: 'shop', lines: PANE_LINES_PROJECT },
    {
      what: 'the epic-overview.md of an epic',
      keys: [],
      path: `${FEATURES}/shop/epic-overview.md`,
      key: 'open:shop',
      target: 'shop',
      lines: PANE_LINES_PROJECT,
    },
    {
      what: 'a feature folder',
      keys: TO_EPIC,
      path: `${FEATURES}/shop/cart`,
      key: 'open:shop/cart',
      target: 'shop/cart',
      lines: DASH_LINES_EPIC,
    },
    { what: 'a bug file', keys: TO_FEATURE, path: `${BUGS}/BUG-001.md`, key: 'bug:BUG-001.md', target: 'BUG-001.md', lines: DASH_LINES_FEATURE },
  ] as const

  for (const item of GONE) {
    test(`an open after a person deletes ${item.what} shows one toast and writes nothing`, async ($, on) => {
      const { w, ui, written } = await shown($, on, item.keys)

      remove(w, item.path)
      await ui.press({ key: item.key })
      expect(w.toasts).toEqual([`"${item.target}" is gone. Run /dashboard to load the project again.`])
      expect(written).toEqual([])
      expect(w.dashboardWrites).toBe(0)
      expect(w.focuses).toEqual([])
      expect(linesOf(await drawnOf(ui))).toEqual([...item.lines])
    })
  }

  test('a Back whose target is gone shows the project view with an empty stack, and no toast', async ($, on) => {
    const { w, ui, written } = await shown($, on, TO_BUG)

    remove(w, `${FEATURES}/shop/cart`)
    await ui.press({ key: 'back' })
    expect(movesOf(written)).toEqual([[PROJECT, []]])
    expect(w.toasts).toEqual([])
    // F6: the focus on the first row never reaches the world, and the reset still writes.
    expect(w.focuses).toEqual([])
    expect(linesOf(await drawnOf(ui))).toEqual([
      'project',
      'From docs/overview.md, updated 2026-10-05',
      '',
      'shop  epic',
      '  ███░░░░░░░ 25%  In Progress',
      'demo  Autorun',
      '  ██████████ 100%  1 open bug  Complete',
      'ghost  no folder',
      '  Planned',
      'notes  Autorun',
      '  not in docs/overview.md',
    ])
  })
})

describe('the moves: the route guard', () => {
  test('an open whose load ends after a /dashboard run writes nothing, and the pane keeps the project view', async ($, on) => {
    const { w, ui, written } = await shown($, on, TO_EPIC)
    const read = w.hold(`${FEATURES}/shop/cart/context.md`)
    const press = ui.press({ key: 'open:shop/cart' })

    await read.reached
    expect(await run($)).toEqual({})
    read.release()
    await press
    expect(movesOf(written)).toEqual([[PROJECT, []]])
    expect(w.dashboardWrites).toBe(1)
    expect(w.toasts).toEqual([])
    expect(linesOf(await drawnOf(ui))).toEqual(PANE_LINES_PROJECT)
  })

  test('a Back whose load ends after a /dashboard run writes nothing, and the pane keeps the project view', async ($, on) => {
    const { w, ui, written } = await shown($, on, TO_FEATURE)
    const read = w.hold(`${FEATURES}/shop/epic-overview.md`)
    const press = ui.press({ key: 'back' })

    await read.reached
    expect(await run($)).toEqual({})
    read.release()
    await press
    expect(movesOf(written)).toEqual([[PROJECT, []]])
    expect(w.dashboardWrites).toBe(1)
    expect(linesOf(await drawnOf(ui))).toEqual(PANE_LINES_PROJECT)
  })

  test('an open whose load ends after a newer open writes nothing: the newer move wins', async ($, on) => {
    const { w, ui, written } = await shown($, on)
    const read = w.hold(`${FEATURES}/shop/epic-overview.md`)
    const first = ui.press({ key: 'open:shop' })

    await read.reached
    await ui.press({ key: 'open:demo' })
    read.release()
    await first
    expect(movesOf(written)).toEqual([[DEMO, [PROJECT]]])
    expect(w.dashboardWrites).toBe(1)
    expect(linesOf(await drawnOf(ui))).toEqual(DEMO_LINES)
  })
})

describe('the moves: the stack depth', () => {
  test('each open goes one level down, and the stack holds at most three routes: project, epic, feature', async ($, on) => {
    const { ui, written } = await shown($, on)

    for (const key of TO_BUG) {
      await ui.press({ key })
    }

    expect(written.map(state => state.back.length)).toEqual([1, 2, 3])
    expect(movesOf(written)[2]).toEqual([BUG, [PROJECT, SHOP, CART]])
    // The bug view draws no open button, so no move goes deeper than three routes.
    expect((await ui.findAll({ type: 'Button' })).map(button => button.key)).toEqual(['back', 'act:fix-bug'])
  })

  test('Back three times from the bug view empties the stack one route at a time', async ($, on) => {
    const { w, ui, written } = await shown($, on, TO_BUG)

    for (let step = 0; step < 3; step += 1) {
      await ui.press({ key: 'back' })
    }

    expect(movesOf(written)).toEqual([
      [CART, [PROJECT, SHOP]],
      [SHOP, [PROJECT]],
      [PROJECT, []],
    ])
    expect(w.dashboardWrites).toBe(3)
    expect(w.focuses).toEqual([])
    expect(linesOf(await drawnOf(ui))).toEqual(PANE_LINES_PROJECT)
  })
})

describe('the moves: the phase toggles', () => {
  test('phase:0 opens the first phase, keeps the route and the stack, and reads no file', async ($, on) => {
    const { w, ui, written } = await shown($, on, TO_FEATURE)

    await ui.press({ key: 'phase:0' })
    expect(movesOf(written)).toEqual([[CART, [PROJECT, SHOP]]])
    expect(expandedOf(written)).toEqual([[0, 1]])
    expect(w.readCount()).toBe(0)
    expect(linesOf(await drawnOf(ui)).slice(5, 12)).toEqual([
      'Phases (2)',
      '-  ██████████  Phase 1: The model (1/1)',
      '    [x] 1.1 Write the cart type',
      '-  ░░░░░░░░░░  Phase 2: The view (0/3)',
      '    [ ] 2.1 Draw the cart row',
      '    [ ] ⏸️ 2.2 Draw the total (waits for a person)',
      '    [ ] 2.3 Draw the empty state',
    ])
  })

  test('phase:1 closes the current phase, and a second press opens it again', async ($, on) => {
    const { w, ui, written } = await shown($, on, TO_FEATURE)

    await ui.press({ key: 'phase:1' })
    expect(linesOf(await drawnOf(ui)).slice(5, 10)).toEqual([
      'Phases (2)',
      '+  ██████████  Phase 1: The model (1/1)',
      '+  ░░░░░░░░░░  Phase 2: The view (0/3)',
      '',
      'Open bugs (1)',
    ])

    await ui.press({ key: 'phase:1' })
    expect(expandedOf(written)).toEqual([[], [1]])
    expect(w.readCount()).toBe(0)
    expect(w.dashboardWrites).toBe(2)
    expect(linesOf(await drawnOf(ui))).toEqual([...DASH_LINES_FEATURE])
  })
})

describe('the moves: the focus after a move (F6)', () => {
  // The kit has no implementation of a plugin's $.ui.focus, so the call
  // rejects, and the hook ignores the rejection. The walk shows that each move
  // still writes and draws, and that no focus reaches the world.
  test('each open and each Back still writes, and w.focuses stays [] because the kit rejects the focus call', async ($, on) => {
    const { w, ui, written } = await shown($, on)

    for (const key of [...TO_BUG, 'back', 'back', 'back']) {
      await ui.press({ key })
    }

    expect(written.map(state => state.route)).toEqual([SHOP, CART, BUG, CART, SHOP, PROJECT])
    expect(w.dashboardWrites).toBe(6)
    expect(w.focuses).toEqual([])
    expect(linesOf(await drawnOf(ui))).toEqual(PANE_LINES_PROJECT)
  })
})

describe('the buttons: the fill of each action', () => {
  const FILLS = [
    { view: 'project', keys: [], key: 'run:demo', text: '/autorun-feature demo' },
    { view: 'project', keys: [], key: 'run:notes', text: '/autorun-feature notes' },
    { view: 'epic', keys: TO_EPIC, key: 'act:autorun-epic', text: '/autorun-epic shop' },
    { view: 'epic', keys: TO_EPIC, key: 'act:update-epic', text: '/update-epic shop' },
    { view: 'epic', keys: TO_EPIC, key: 'run:shop/cart', text: '/autorun-feature shop/cart' },
    { view: 'feature', keys: TO_FEATURE, key: 'act:autorun-feature', text: '/autorun-feature shop/cart' },
    { view: 'feature', keys: TO_FEATURE, key: 'act:proceed', text: '/proceed' },
    { view: 'feature', keys: TO_FEATURE, key: 'act:continue-feature', text: '/continue-feature shop/cart' },
    { view: 'feature', keys: TO_FEATURE, key: 'act:update-feature', text: '/update-feature shop/cart' },
    { view: 'bug', keys: TO_BUG, key: 'act:fix-bug', text: '/fix-bug BUG-001' },
  ] as const

  for (const item of FILLS) {
    test(`${item.key} on the ${item.view} view fills "${item.text}" over an empty draft, and it writes no state`, async ($, on) => {
      const { w, ui, written } = await shown($, on, item.keys)
      const before = linesOf(await drawnOf(ui))

      await ui.press({ key: item.key })
      expect(w.fills).toEqual([item.text])
      expect(w.toasts).toEqual([])
      expect(written).toEqual([])
      expect(w.readCount()).toBe(0)
      expect(linesOf(await drawnOf(ui))).toEqual(before)
    })
  }
})

describe('the buttons: the draft in the prompt box', () => {
  test('a draft of spaces only takes the fill', async ($, on) => {
    const { w, ui } = await shown($, on, TO_FEATURE, { draft: '   ' })

    await ui.press({ key: 'act:proceed' })
    expect(w.fills).toEqual(['/proceed'])
    expect(w.toasts).toEqual([])
  })

  test('a draft that holds an earlier fill takes the next fill', async ($, on) => {
    const { w, ui } = await shown($, on, TO_FEATURE)

    await ui.press({ key: 'act:proceed' })
    await ui.press({ key: 'act:update-feature' })
    await ui.press({ key: 'act:autorun-feature' })
    expect(w.fills).toEqual(['/proceed', '/update-feature shop/cart', '/autorun-feature shop/cart'])
    expect(w.toasts).toEqual([])
  })

  test('a draft that holds the fill of another view, with spaces around it, takes the fill', async ($, on) => {
    const { w, ui } = await shown($, on, TO_BUG, { draft: '  /autorun-epic shop ' })

    await ui.press({ key: 'act:fix-bug' })
    expect(w.fills).toEqual(['/fix-bug BUG-001'])
    expect(w.toasts).toEqual([])
  })

  test('a typed draft keeps its text: the press fills nothing and shows one toast', async ($, on) => {
    const { w, ui } = await shown($, on, TO_FEATURE, { draft: 'Check the cart total first' })

    await ui.press({ key: 'act:proceed' })
    expect(w.fills).toEqual([])
    expect(w.toasts).toEqual(['The prompt holds a draft. Send it or clear it, then press again.'])
  })

  test('a draft of a dashboard command with typed text after it is typed text too', async ($, on) => {
    const { w, ui } = await shown($, on, TO_EPIC, { draft: '/update-epic shop and the cart' })

    await ui.press({ key: 'act:autorun-epic' })
    expect(w.fills).toEqual([])
    expect(w.toasts).toEqual(['The prompt holds a draft. Send it or clear it, then press again.'])
  })

  for (const refusal of ['dialog', 'no_composer'] as const) {
    test(`a fill that the prompt does not take (${refusal}) shows one toast`, async ($, on) => {
      const { w, ui } = await shown($, on, TO_FEATURE, { fillRefusal: refusal })

      await ui.press({ key: 'act:proceed' })
      expect(w.fills).toEqual(['/proceed'])
      expect(w.toasts).toEqual(['The prompt did not take "/proceed". Type it there.'])
    })
  }
})
