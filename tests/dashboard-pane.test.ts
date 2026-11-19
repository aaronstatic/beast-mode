import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, Shaped } from 'claude-code'

import type { DashboardPaneState } from '../types/index'
import {
  DASH_LINES_BUG,
  DASH_LINES_EMPTY,
  DASH_LINES_EPIC,
  DASH_LINES_FEATURE,
  DASH_LINES_PROJECT,
  DASH_OVERVIEW,
  DASH_TREE,
  ROOT,
  SCRATCH_TREE,
  doc,
} from './fixtures'
import { world } from './world'
import type { World, WorldOptions } from './world'

// The /dashboard command through the engine of the test kit, over the world
// of tests/world.ts: the registration, a run on each surface, an empty
// project, a second run, the two registrations beside /feature (F1), and the
// redraw after an Edit or a Write (section 3.11). The moves and the buttons
// live in tests/dashboard-moves.test.ts, and the mounts in
// tests/dashboard-mounts.test.ts. F6: the kit has no implementation of a plugin's
// $.ui.focus. The call rejects before it reaches the world hook, and the hook
// ignores the rejection. So these tests assert that `w.focuses` stays `[]`,
// and they assert no focus key.

const DASHBOARD = 'dashboard'
const DESCRIPTION = 'Show every feature and epic, with progress, bugs, and actions'

/** The open of a run on a surface that places a pane. `rows` is the line count of the project view. */
const OPEN = { id: DASHBOARD, title: 'Dashboard', focus: true, rows: DASH_LINES_PROJECT.length, columns: 56 }

/** The project view as the terminal pane draws it: the text answer, and the `Autorun` button of each feature row. */
const PANE_LINES_PROJECT = DASH_LINES_PROJECT.map(line => (line === 'demo' || line === 'notes' ? `${line}  Autorun` : line))

type Drawn = { type: string; props?: Record<string, unknown>; children?: (Drawn | string)[] }
type Surface = 'terminal' | 'desktop'

/** Runs `/dashboard <args>` as the person typing it in the composer does. */
function run($: Engine, args = '') {
  return $.command.run({
    command: DASHBOARD,
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 80 },
  })
}

/** Draws the dashboard pane on a surface, at the 56 columns that the open asks for. */
function mountDashboard($: Engine, surface: Surface = 'terminal') {
  return $.ui.mount({
    plugin: 'beast-mode',
    surface,
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
 * holds no `state` noun, so a test reads the stack here. The atom names a
 * shape, so each write holds the state as `value` beside the `shape` tag.
 */
function writesOf(on: On): DashboardPaneState[] {
  const written: DashboardPaneState[] = []

  on('state.set', { plugin: 'beast-mode', key: 'dashboardPane' }, ($, e, next) => {
    written.push((e.value as unknown as Shaped<DashboardPaneState>).value)

    return next(e)
  })

  return written
}

describe('/dashboard, the registration', () => {
  test('session.start registers /dashboard after /feature, with immediate and no argumentHint', async ($, on) => {
    const w = world(on, { files: DASH_TREE })

    expect(await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })).toEqual({ cwd: ROOT })
    expect(w.registered.map(spec => spec.name)).toEqual(['feature', 'dashboard'])
    expect(w.registered[1]).toEqual({ name: 'dashboard', description: DESCRIPTION, immediate: true })
    expect(w.logs).toEqual([])
  })

  test('a start that is not interactive registers /dashboard too, because the matcher takes both values', async ($, on) => {
    const w = world(on, { files: DASH_TREE })

    expect(await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: false })).toEqual({ cwd: ROOT })
    expect(w.registered.map(spec => spec.name)).toEqual(['feature', 'dashboard'])
  })

  test('a refused registration logs one /dashboard line with the reason, and session.start still answers', async ($, on) => {
    const w = world(on, { refuseRegister: 'the name is taken' })

    expect(await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })).toEqual({ cwd: ROOT })
    const lines = w.logs.filter(line => line.includes('/dashboard'))

    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('beast-mode: /dashboard is not registered: ')
    expect(lines[0]).toContain('the name is taken')
  })
})

describe('/dashboard on each surface', () => {
  test('a terminal run answers {}, opens one pane with focus, rows, and columns 56, and draws the project view', async ($, on) => {
    const w = world(on, { files: DASH_TREE })

    expect(await run($)).toEqual({})
    expect(w.opens).toEqual([OPEN])
    expect(w.dashboardWrites).toBe(1)
    // F6: the focus on open:shop never reaches the world.
    expect(w.focuses).toEqual([])

    const ui = await mountDashboard($)
    const buttons = await ui.findAll({ type: 'Button' })

    expect(linesOf(await drawnOf(ui))).toEqual(PANE_LINES_PROJECT)
    expect(buttons.map(button => button.key)).toEqual(['open:shop', 'open:demo', 'run:demo', 'open:notes', 'run:notes'])
    expect(buttons.map(button => [button.props.label, button.props.plain, button.props.hotkey])).toEqual([
      ['shop', undefined, undefined],
      ['demo', undefined, undefined],
      ['Autorun', undefined, undefined],
      ['notes', undefined, undefined],
      ['Autorun', undefined, undefined],
    ])
    expect(await ui.findAll({ type: 'Svg' })).toEqual([])
  })

  test('a desktop run answers {}, opens the same pane, and draws one Svg per bar with its label beside it', async ($, on) => {
    const w = world(on, { files: DASH_TREE, surfaces: ['desktop'] })

    expect(await run($)).toEqual({})
    expect(w.opens).toEqual([OPEN])
    expect(w.dashboardWrites).toBe(1)
    expect(w.focuses).toEqual([])

    const ui = await mountDashboard($, 'desktop')
    const svgs = await ui.findAll({ type: 'Svg' })

    expect(svgs.map(svg => [svg.props.alt, svg.props.width, svg.props.height])).toEqual([
      ['25% done', 80, 8],
      ['100% done', 80, 8],
    ])
    expect(linesOf(await drawnOf(ui)).slice(3, 7)).toEqual([
      'shop  epic',
      '  25%  1 open bug  In Progress',
      'demo  Autorun',
      '  100%  1 open bug  Complete',
    ])
  })

  test('a run with no surface answers the project view as text, opens nothing, and writes nothing', async ($, on) => {
    const w = world(on, { files: DASH_TREE, surfaces: [] })

    expect(await run($)).toEqual({ text: DASH_LINES_PROJECT.join('\n') })
    expect(w.opens).toEqual([])
    expect(w.dashboardWrites).toBe(0)
  })

  test('a vscode run answers the text, because the VS Code chat panel places no pane', async ($, on) => {
    const w = world(on, { files: DASH_TREE, surfaces: ['vscode'] })

    expect(await run($)).toEqual({ text: DASH_LINES_PROJECT.join('\n') })
    expect(w.opens).toEqual([])
    expect(w.dashboardWrites).toBe(0)
  })

  test('an open that answers isPlaced: false gives the text, after one open and one write', async ($, on) => {
    const w = world(on, { files: DASH_TREE, isPlaced: false })

    expect(await run($)).toEqual({ text: DASH_LINES_PROJECT.join('\n') })
    expect(w.opens).toEqual([OPEN])
    expect(w.dashboardWrites).toBe(1)
    expect(w.focuses).toEqual([])
  })

  test('the command ignores its args: /dashboard shop gives the project view', async ($, on) => {
    world(on, { files: DASH_TREE, surfaces: [] })

    expect(await run($, 'shop')).toEqual({ text: DASH_LINES_PROJECT.join('\n') })
  })

  test('a mount before any run draws the idle line', async ($, on) => {
    world(on, { files: DASH_TREE })

    const ui = await mountDashboard($)

    expect(linesOf(await drawnOf(ui))).toEqual(['No dashboard loaded. Run /dashboard to load one.'])
  })
})

describe('/dashboard in an empty project', () => {
  test('a terminal run opens one row per line, draws the empty view, and draws no button', async ($, on) => {
    const w = world(on)

    expect(await run($)).toEqual({})
    expect(w.opens).toEqual([{ ...OPEN, rows: DASH_LINES_EMPTY.length }])
    expect(w.focuses).toEqual([])

    const ui = await mountDashboard($)

    expect(linesOf(await drawnOf(ui))).toEqual([...DASH_LINES_EMPTY])
    expect(await ui.findAll({ type: 'Button' })).toEqual([])
  })

  test('a run with no surface answers the empty view as text', async ($, on) => {
    world(on, { surfaces: [] })

    expect(await run($)).toEqual({ text: DASH_LINES_EMPTY.join('\n') })
  })
})

describe('/dashboard, a second run', () => {
  test('a second run resets the pane to the project view and empties the back stack', async ($, on) => {
    const w = world(on, { files: DASH_TREE })
    const written = writesOf(on)

    await run($)
    const ui = await mountDashboard($)
    await ui.press({ key: 'open:shop' })
    await ui.press({ key: 'open:shop/cart' })

    expect(written.map(state => [state.route, state.back])).toEqual([
      [{ kind: 'project' }, []],
      [{ kind: 'epic', epic: 'shop' }, [{ kind: 'project' }]],
      [{ kind: 'feature', path: 'shop/cart' }, [{ kind: 'project' }, { kind: 'epic', epic: 'shop' }]],
    ])
    expect(linesOf(await drawnOf(ui))[0]).toBe('b: Back  shop/cart')

    w.resetCounts()

    expect(await run($)).toEqual({})
    expect(w.opens).toEqual([OPEN])
    expect(w.dashboardWrites).toBe(1)
    expect(written.slice(3).map(state => [state.route, state.back])).toEqual([[{ kind: 'project' }, []]])
    expect(linesOf(await drawnOf(ui))).toEqual(PANE_LINES_PROJECT)
  })
})

// ── Beside /feature, and the redraw (section 3.11) ───────────────────────

const FEATURE_PANE = 'feature-pane'
const FEATURES = `${ROOT}/docs/features`
const BUGS = `${ROOT}/docs/bugs`
const CART_DIR = `${FEATURES}/shop/cart`
const OVERVIEW = `${ROOT}/docs/overview.md`
const EPIC_OVERVIEW = `${FEATURES}/shop/epic-overview.md`

/** The presses that open each view from the project view. */
const TO_EPIC = ['open:shop']
const TO_FEATURE = ['open:shop', 'open:shop/cart']
const TO_BUG = ['open:shop', 'open:shop/cart', 'bug:BUG-001.md']

/** The box of 2.1 in the cart tasks.md, open and ticked. */
const OPEN_2_1 = '- \\[ \\] **2.1 Draw the cart row**'
const DONE_2_1 = '- \\[x\\] ✅ **2.1 Draw the cart row**'

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

/** A new open bug that links the cart by its path. */
const BUG_004 = doc('---', 'id: BUG-004', 'title: "The cart forgets items"', 'status: open', 'linkedFeature: shop/cart', '---')

/** A new open bug that links demo. */
const BUG_006 = doc('---', 'id: BUG-006', 'title: "The demo readme is short"', 'status: open', 'linkedFeature: demo', '---')

/** A new docs/overview.md: a new stamp, a new shop row, no ghost row, and a notes row. */
const OVERVIEW_NEXT = doc(
  '# Scratch - Overview',
  '',
  '**Last Updated:** 2026-10-06',
  '',
  '## Feature Status',
  '',
  '| Feature | Status | Tasks | Notes |',
  '|---------|--------|-------|-------|',
  '| shop (epic) | In Progress | 2/4 (50%) | The shop epic |',
  '| demo | Complete | 3/3 (100%) | The demo feature |',
  '| notes | Planned | — | The notes |',
)

/** A new epic-overview.md of shop: a new status, a new stamp, and a new table. */
const EPIC_OVERVIEW_NEXT = doc(
  '# Shop - Epic Overview',
  '',
  '**Epic:** shop',
  '**Status:** ✅ Complete',
  '**Last Updated:** 2026-10-06 08:00',
  '',
  '## Features',
  '',
  '| # | Feature | Status | Tasks | Description |',
  '|---|---------|--------|-------|-------------|',
  '| 1 | cart | Complete | 4/4 (100%) | The cart |',
  '| 2 | checkout | In Progress | — | The checkout |',
)

/** Runs `/feature` with no name, as the person typing it in the composer does. */
function feature($: Engine) {
  return $.command.run({
    command: 'feature',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 80 },
  })
}

/** Draws the feature pane on the terminal, 78 columns wide. */
function mountFeature($: Engine) {
  return $.ui.mount({
    plugin: 'beast-mode',
    surface: 'terminal',
    component: 'Pane',
    requestId: FEATURE_PANE,
    props: {
      title: 'shop/cart',
      isFocused: false,
      bodyColumns: 78,
      placement: 'inline',
      scroll: { offset: 0, bodyRows: 11 },
      view: {},
    },
  })
}

/** The `$.fs.read` calls of the world, by path. */
function readsOf(w: World): Record<string, number> {
  return Object.fromEntries(w.reads)
}

/**
 * Records each dashboard state that lands. A write that misses its
 * `ifVersion` does not land. The hook sits beneath the plugin beside the world.
 */
function landedOf(on: On): DashboardPaneState[] {
  const landed: DashboardPaneState[] = []

  on('state.set', { plugin: 'beast-mode', key: 'dashboardPane' }, async ($, e, next) => {
    const out = await next(e)

    if ((out as { value?: { isSet?: boolean } }).value?.isSet === true) {
      landed.push((e.value as unknown as Shaped<DashboardPaneState>).value)
    }

    return out
  })

  return landed
}

/** The lines, with the line `from` written as `to`. */
function swapped(lines: readonly string[], from: string, to: string): string[] {
  return lines.map(line => (line === from ? to : line))
}

/** Runs /dashboard on a terminal over DASH_TREE, draws the pane, presses each key in turn, and sets the counts back to none. */
async function shownAt($: Engine, on: On, keys: readonly string[] = [], options: WorldOptions = {}) {
  const w = world(on, { files: DASH_TREE, ...options })

  await run($)
  const ui = await mountDashboard($)

  for (const key of keys) {
    await ui.press({ key })
  }

  w.resetCounts()

  return { w, ui }
}

describe('/dashboard beside /feature, the two registrations (F1)', () => {
  test('session.start registers /feature and then /dashboard, and it answers once', async ($, on) => {
    const w = world(on, { files: SCRATCH_TREE })

    expect(await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })).toEqual({ cwd: ROOT })
    expect(w.registered.map(spec => spec.name)).toEqual(['feature', 'dashboard'])
    expect(w.registered[1]).toEqual({ name: 'dashboard', description: DESCRIPTION, immediate: true })
    expect(w.logs).toEqual([])
  })

  test('a refused registration logs one line per command, and session.start still answers', async ($, on) => {
    const w = world(on, { refuseRegister: 'the name is taken' })

    expect(await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })).toEqual({ cwd: ROOT })
    expect(w.registered).toEqual([])
    expect(w.logs).toHaveLength(2)
    expect(w.logs[0]).toContain('/feature is not registered')
    expect(w.logs[1]).toContain('/dashboard is not registered')
    expect(w.logs[1]).toContain('the name is taken')
  })

  test('an Edit of the shown tasks.md runs the tool once, and the feature pane redraws', async ($, on) => {
    const w = world(on, { files: SCRATCH_TREE })

    await feature($)
    const pane = await mountFeature($)
    await run($)
    await mountDashboard($)
    w.resetCounts()

    const ran = await $.tool.call({ tool: 'Edit', file_path: `${CART_DIR}/tasks.md`, old_string: OPEN_2_1, new_string: DONE_2_1 })

    expect(ran.isError).toBeUndefined()
    expect(w.toolCalls).toBe(1)
    expect(w.stateWrites).toBe(1)
    expect(w.dashboardWrites).toBe(0)
    expect(linesOf(await drawnOf(pane)).slice(4, 6)).toEqual(['Phase 2: The view (1/3)', '[x] 2.1 Draw the cart row'])
  })
})

describe('the redraw after an Edit or a Write, one row of section 3.11 at a time', () => {
  test('project view, docs/overview.md: an Edit reads that file once and redraws the row', async ($, on) => {
    const { w, ui } = await shownAt($, on)
    const ran = await $.tool.call({ tool: 'Edit', file_path: OVERVIEW, old_string: '| demo | Complete |', new_string: '| demo | Shipped |' })

    expect(ran.isError).toBeUndefined()
    expect(w.toolCalls).toBe(1)
    expect(readsOf(w)).toEqual({ [OVERVIEW]: 1 })
    expect(w.dashboardWrites).toBe(1)
    expect(linesOf(await drawnOf(ui))).toEqual(
      swapped(PANE_LINES_PROJECT, '  ██████████ 100%  1 open bug  Complete', '  ██████████ 100%  1 open bug  Shipped'),
    )
  })

  test('project view, docs/overview.md: a Write reads that file once and redraws the stamp and the rows', async ($, on) => {
    const { w, ui } = await shownAt($, on)

    await $.tool.call({ tool: 'Write', file_path: OVERVIEW, content: OVERVIEW_NEXT })
    expect(readsOf(w)).toEqual({ [OVERVIEW]: 1 })
    expect(w.dashboardWrites).toBe(1)
    expect(linesOf(await drawnOf(ui))).toEqual([
      'project',
      'From docs/overview.md, updated 2026-10-06',
      '',
      'shop  epic',
      '  █████░░░░░ 50%  1 open bug  In Progress',
      'demo  Autorun',
      '  ██████████ 100%  1 open bug  Complete',
      'notes  Autorun',
      '  Planned',
    ])
  })

  test('project view, docs/bugs/BUG-*.md: a Write of a new open bug reads that file once and counts it on its row', async ($, on) => {
    const { w, ui } = await shownAt($, on)

    await $.tool.call({ tool: 'Write', file_path: `${BUGS}/BUG-006.md`, content: BUG_006 })
    expect(readsOf(w)).toEqual({ [`${BUGS}/BUG-006.md`]: 1 })
    expect(w.dashboardWrites).toBe(1)
    expect(linesOf(await drawnOf(ui))).toEqual(
      swapped(PANE_LINES_PROJECT, '  ██████████ 100%  1 open bug  Complete', '  ██████████ 100%  2 open bugs  Complete'),
    )
  })

  test('project view, docs/bugs/BUG-*.md: an Edit that closes a bug reads that file once and drops its count', async ($, on) => {
    const { w, ui } = await shownAt($, on)

    await $.tool.call({ tool: 'Edit', file_path: `${BUGS}/BUG-003.md`, old_string: 'status: in-progress', new_string: 'status: closed' })
    expect(readsOf(w)).toEqual({ [`${BUGS}/BUG-003.md`]: 1 })
    expect(w.dashboardWrites).toBe(1)
    expect(linesOf(await drawnOf(ui))).toEqual(
      swapped(PANE_LINES_PROJECT, '  ██████████ 100%  1 open bug  Complete', '  ██████████ 100%  Complete'),
    )
  })

  test('epic view, docs/bugs/BUG-*.md: a Write of a new open bug reads that file once and counts it on the cart row', async ($, on) => {
    const { w, ui } = await shownAt($, on, TO_EPIC)

    await $.tool.call({ tool: 'Write', file_path: `${BUGS}/BUG-004.md`, content: BUG_004 })
    expect(readsOf(w)).toEqual({ [`${BUGS}/BUG-004.md`]: 1 })
    expect(w.dashboardWrites).toBe(1)
    expect(linesOf(await drawnOf(ui))).toEqual(
      swapped(DASH_LINES_EPIC, '  ███░░░░░░░ 25%  1 open bug  In Progress', '  ███░░░░░░░ 25%  2 open bugs  In Progress'),
    )
  })

  test('epic view, its epic-overview.md: a Write reads that file once and redraws the status, the stamp, and the table', async ($, on) => {
    const { w, ui } = await shownAt($, on, TO_EPIC)

    await $.tool.call({ tool: 'Write', file_path: EPIC_OVERVIEW, content: EPIC_OVERVIEW_NEXT })
    expect(readsOf(w)).toEqual({ [EPIC_OVERVIEW]: 1 })
    expect(w.dashboardWrites).toBe(1)
    expect(linesOf(await drawnOf(ui))).toEqual([
      'b: Back  shop',
      'Status: ✅ Complete',
      'From epic-overview.md, updated 2026-10-06 08:00',
      'a: Autorun  u: Update',
      '',
      'cart  Autorun',
      '  ██████████ 100%  1 open bug  Complete',
      'checkout  no folder',
      '  In Progress',
    ])
  })

  test('feature view, its tasks.md: an Edit reads that file once and redraws the progress bar, the phase, and the task', async ($, on) => {
    const { w, ui } = await shownAt($, on, TO_FEATURE)

    await $.tool.call({ tool: 'Edit', file_path: `${CART_DIR}/tasks.md`, old_string: OPEN_2_1, new_string: DONE_2_1 })
    expect(readsOf(w)).toEqual({ [`${CART_DIR}/tasks.md`]: 1 })
    expect(w.dashboardWrites).toBe(1)
    // The bar counts the boxes: 2 of 4. Its label is the Progress line of
    // tasks.md, and this Edit leaves that line as it was.
    expect(linesOf(await drawnOf(ui))).toEqual(
      swapped(
        swapped(
          swapped(DASH_LINES_FEATURE, 'Progress:  ███░░░░░░░ 1/4 tasks complete (25%)', 'Progress:  █████░░░░░ 1/4 tasks complete (25%)'),
          '-  ░░░░░░░░░░  Phase 2: The view (0/3)',
          '-  ███░░░░░░░  Phase 2: The view (1/3)',
        ),
        '    [ ] 2.1 Draw the cart row',
        '    [x] 2.1 Draw the cart row',
      ),
    )
  })

  test('feature view, its context.md: an Edit reads that file once and redraws the status', async ($, on) => {
    const { w, ui } = await shownAt($, on, TO_FEATURE)

    await $.tool.call({ tool: 'Edit', file_path: `${CART_DIR}/context.md`, old_string: '🟡 In Progress', new_string: '✅ Complete' })
    expect(readsOf(w)).toEqual({ [`${CART_DIR}/context.md`]: 1 })
    expect(w.dashboardWrites).toBe(1)
    expect(linesOf(await drawnOf(ui))).toEqual(swapped(DASH_LINES_FEATURE, 'Status: 🟡 In Progress', 'Status: ✅ Complete'))
  })

  test('feature view, its implementation.md: a Write reads context.md, then implementation.md, and redraws the status', async ($, on) => {
    const { w, ui } = await shownAt($, on, ['open:demo'])

    await $.tool.call({ tool: 'Write', file_path: `${FEATURES}/demo/implementation.md`, content: doc('**Status:** ✅ Complete') })
    // demo has no context.md, so the read of it finds no status (section 3.11: up to two files).
    expect(readsOf(w)).toEqual({ [`${FEATURES}/demo/context.md`]: 1, [`${FEATURES}/demo/implementation.md`]: 1 })
    expect(w.dashboardWrites).toBe(1)
    expect(linesOf(await drawnOf(ui)).slice(0, 2)).toEqual(['b: Back  demo', 'Status: ✅ Complete'])
  })

  test('feature view, docs/bugs/BUG-*.md: a Write of a new linked bug reads that file once and adds it', async ($, on) => {
    const { w, ui } = await shownAt($, on, TO_FEATURE)

    await $.tool.call({ tool: 'Write', file_path: `${BUGS}/BUG-004.md`, content: BUG_004 })
    expect(readsOf(w)).toEqual({ [`${BUGS}/BUG-004.md`]: 1 })
    expect(w.dashboardWrites).toBe(1)
    expect(linesOf(await drawnOf(ui))).toEqual([
      ...swapped(DASH_LINES_FEATURE, 'Open bugs (1)', 'Open bugs (2)'),
      'BUG-004  The cart forgets items',
    ])
  })

  test('bug view, its own file: an Edit reads that file once and redraws the fields', async ($, on) => {
    const { w, ui } = await shownAt($, on, TO_BUG)

    await $.tool.call({ tool: 'Edit', file_path: `${BUGS}/BUG-001.md`, old_string: 'priority: high', new_string: 'priority: low' })
    expect(readsOf(w)).toEqual({ [`${BUGS}/BUG-001.md`]: 1 })
    expect(w.dashboardWrites).toBe(1)
    expect(linesOf(await drawnOf(ui))).toEqual(swapped(DASH_LINES_BUG, 'priority: high', 'priority: low'))
  })
})

describe('the redraw: the edits that read nothing or write nothing', () => {
  const OTHER = [
    {
      view: 'project',
      keys: [],
      lines: PANE_LINES_PROJECT,
      edit: { file_path: `${FEATURES}/demo/tasks.md`, old_string: 'Add the notes', new_string: 'Add a note' },
    },
    {
      view: 'epic',
      keys: TO_EPIC,
      lines: DASH_LINES_EPIC,
      edit: { file_path: OVERVIEW, old_string: '| demo | Complete |', new_string: '| demo | Shipped |' },
    },
    {
      view: 'feature',
      keys: TO_FEATURE,
      lines: DASH_LINES_FEATURE,
      edit: { file_path: EPIC_OVERVIEW, old_string: '🟡 In Progress', new_string: '✅ Complete' },
    },
    {
      view: 'bug',
      keys: TO_BUG,
      lines: DASH_LINES_BUG,
      edit: { file_path: `${BUGS}/BUG-003.md`, old_string: 'status: in-progress', new_string: 'status: closed' },
    },
  ] as const

  for (const item of OTHER) {
    test(`${item.view} view: an Edit and a Write of other files read no file and write nothing`, async ($, on) => {
      const { w, ui } = await shownAt($, on, item.keys)

      await $.tool.call({ tool: 'Edit', ...item.edit })
      await $.tool.call({ tool: 'Write', file_path: `${ROOT}/README.md`, content: doc('# Project') })
      expect(w.toolCalls).toBe(2)
      expect(readsOf(w)).toEqual({})
      expect(w.dashboardWrites).toBe(0)
      expect(linesOf(await drawnOf(ui))).toEqual([...item.lines])
    })
  }

  test('with the pane closed, an Edit of docs/overview.md reads no file and writes nothing', async ($, on) => {
    const { w } = await shownAt($, on)

    w.close(DASHBOARD)
    await $.tool.call({ tool: 'Edit', file_path: OVERVIEW, old_string: '| demo | Complete |', new_string: '| demo | Shipped |' })
    expect(w.toolCalls).toBe(1)
    expect(readsOf(w)).toEqual({})
    expect(w.dashboardWrites).toBe(0)
  })

  test('a tool call that fails reads no file and passes its result on', async ($, on) => {
    const { w } = await shownAt($, on)
    const ran = await $.tool.call({ tool: 'Edit', file_path: OVERVIEW, old_string: 'no such text', new_string: 'x' })

    expect(ran.isError).toBe(true)
    expect(w.toolCalls).toBe(1)
    expect(readsOf(w)).toEqual({})
    expect(w.dashboardWrites).toBe(0)
  })

  test('a read that rejects passes the result unchanged, and the tool runs once', async ($, on) => {
    const { w, ui } = await shownAt($, on)

    w.rejects.add(OVERVIEW)
    const ran = await $.tool.call({ tool: 'Edit', file_path: OVERVIEW, old_string: '| demo | Complete |', new_string: '| demo | Shipped |' })

    expect(ran).toEqual({
      result: {
        filePath: OVERVIEW,
        oldString: '| demo | Complete |',
        newString: '| demo | Shipped |',
        originalFile: DASH_OVERVIEW,
        structuredPatch: [],
        userModified: false,
        replaceAll: false,
      },
      text: `The file ${OVERVIEW} has been updated.`,
    })
    expect(w.toolCalls).toBe(1)
    expect(readsOf(w)).toEqual({ [OVERVIEW]: 1 })
    expect(w.dashboardWrites).toBe(0)
    expect(linesOf(await drawnOf(ui))).toEqual(PANE_LINES_PROJECT)
  })

  test('an Edit of a Notes cell in docs/overview.md changes nothing shown: one read, and no write', async ($, on) => {
    const { w, ui } = await shownAt($, on)

    await $.tool.call({ tool: 'Edit', file_path: OVERVIEW, old_string: '| The demo feature |', new_string: '| The demo app |' })
    expect(readsOf(w)).toEqual({ [OVERVIEW]: 1 })
    expect(w.dashboardWrites).toBe(0)
    expect(linesOf(await drawnOf(ui))).toEqual(PANE_LINES_PROJECT)
  })

  test('an Edit of a task description in tasks.md changes nothing shown: one read, and no write', async ($, on) => {
    const { w, ui } = await shownAt($, on, TO_FEATURE)

    await $.tool.call({
      tool: 'Edit',
      file_path: `${CART_DIR}/tasks.md`,
      old_string: 'Description: One row per item',
      new_string: 'Description: One row for each item',
    })
    expect(readsOf(w)).toEqual({ [`${CART_DIR}/tasks.md`]: 1 })
    expect(w.dashboardWrites).toBe(0)
    expect(linesOf(await drawnOf(ui))).toEqual([...DASH_LINES_FEATURE])
  })

  // Every get of one dispatch reads one moment (the declaration of
  // $.state.get). So inside the tool.call hook, the read before the write sees
  // the state from the start of the redraw. After a newer move, the first write
  // of `update` misses its `ifVersion`, and `update` tries again with the new
  // state. The guard then keeps that state as it is. So these tests assert the
  // states that land and the drawing, not the count of writes.
  test('the route guard: a redraw whose read ends after a Back leaves the project view alone', async ($, on) => {
    const w = world(on, { files: DASH_TREE })
    const landed = landedOf(on)

    await run($)
    const ui = await mountDashboard($)

    await ui.press({ key: 'open:shop' })
    w.resetCounts()

    const read = w.hold(EPIC_OVERVIEW)
    const call = $.tool.call({ tool: 'Edit', file_path: EPIC_OVERVIEW, old_string: '🟡 In Progress', new_string: '✅ Complete' })

    await read.reached
    await ui.press({ key: 'back' })
    const moved = landed[landed.length - 1]

    expect(moved?.route).toEqual({ kind: 'project' })
    landed.length = 0
    read.release()
    const ran = await call

    expect(ran.isError).toBeUndefined()
    expect(w.toolCalls).toBe(1)
    // The epic patch lands on no state: each later write holds the project view as the Back loaded it.
    expect(landed).toEqual(landed.map(() => moved))
    expect(linesOf(await drawnOf(ui))).toEqual(PANE_LINES_PROJECT)
  })

  test('the route guard: a redraw whose read ends after a /dashboard run and an open of demo leaves demo alone', async ($, on) => {
    const w = world(on, { files: DASH_TREE })
    const landed = landedOf(on)

    await run($)
    const ui = await mountDashboard($)

    for (const key of TO_FEATURE) {
      await ui.press({ key })
    }

    w.resetCounts()
    const read = w.hold(`${CART_DIR}/tasks.md`)
    const call = $.tool.call({ tool: 'Edit', file_path: `${CART_DIR}/tasks.md`, old_string: OPEN_2_1, new_string: DONE_2_1 })

    await read.reached
    expect(await run($)).toEqual({})
    await ui.press({ key: 'open:demo' })
    const moved = landed[landed.length - 1]

    expect(moved?.route).toEqual({ kind: 'feature', path: 'demo' })
    landed.length = 0
    read.release()
    await call
    expect(w.toolCalls).toBe(1)
    // The patch holds the phases of the cart. It lands on no state, so the demo view keeps its own phase.
    expect(landed).toEqual(landed.map(() => moved))
    expect(linesOf(await drawnOf(ui))).toEqual(DEMO_LINES)
  })

  test('with both panes on shop/cart, one Edit of its tasks.md runs the tool once and reads that file once per pane', async ($, on) => {
    const w = world(on, { files: DASH_TREE })

    await feature($)
    const pane = await mountFeature($)
    await run($)
    const ui = await mountDashboard($)

    for (const key of TO_FEATURE) {
      await ui.press({ key })
    }

    w.resetCounts()
    const ran = await $.tool.call({ tool: 'Edit', file_path: `${CART_DIR}/tasks.md`, old_string: OPEN_2_1, new_string: DONE_2_1 })

    expect(ran.isError).toBeUndefined()
    expect(w.toolCalls).toBe(1)
    expect(readsOf(w)).toEqual({ [`${CART_DIR}/tasks.md`]: 2 })
    expect(w.stateWrites).toBe(1)
    expect(w.dashboardWrites).toBe(1)
    expect(linesOf(await drawnOf(pane)).slice(4, 6)).toEqual(['Phase 2: The view (1/3)', '[x] 2.1 Draw the cart row'])
    expect(linesOf(await drawnOf(ui)).slice(7, 9)).toEqual(['-  ███░░░░░░░  Phase 2: The view (1/3)', '    [x] 2.1 Draw the cart row'])
  })
})
