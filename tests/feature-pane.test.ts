import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { IDLE_LINE } from '../hooks/lib/view'
import { ROOT, SCRATCH_TREE, doc } from './fixtures'
import { world } from './world'
import type { World, WorldOptions } from './world'

// The four hooks through the engine of the test kit, over the world of
// tests/world.ts, and the mount tests of the pane on each surface.

const PANE = 'feature-pane'
const FEATURES = `${ROOT}/docs/features`
const BUGS = `${ROOT}/docs/bugs`
const CART = `${FEATURES}/shop/cart`

const CART_LINES = [
  'shop/cart',
  'Status: 🟡 In Progress',
  'Progress: 1/4 tasks complete (25%)',
  '',
  'Phase 2: The view (0/3)',
  '[ ] 2.1 Draw the cart row',
  '[ ] ⏸️ 2.2 Draw the total (waits for a person)',
  '[ ] 2.3 Draw the empty state',
  '',
  'Open bugs (1)',
  'BUG-001  The "Total" row overflows',
]

const DEMO_LINES = [
  'demo',
  'Status: not set',
  'Progress: 3/3 tasks complete (100%)',
  '',
  'Phase 1: Setup (3/3)',
  '[x] 1.1 Make the folder',
  '[x] 1.2 Add the readme',
  '[x] 1.3 Add the notes',
  '',
  'Open bugs (1)',
  'BUG-003  A demo bug',
]

const DESCRIPTION = 'Show the active feature, its phase, its tasks, and its open bugs'
const NOT_FOUND = (name: string): string =>
  `No feature "${name}" in docs/features/. Run /feature with no name to show the active feature.`

/** The box of 2.1 in the cart tasks.md, open and ticked. */
const OPEN_2_1 = '- \\[ \\] **2.1 Draw the cart row**'
const DONE_2_1 = '- \\[x\\] ✅ **2.1 Draw the cart row**'

const BUG_004 = doc(
  '---',
  'id: BUG-004',
  'title: "The cart forgets items"',
  'status: open',
  'linkedFeature: shop/cart',
  '---',
)

type Drawn = { type: string; props?: Record<string, unknown>; children?: (Drawn | string)[] }
type Surface = 'terminal' | 'desktop'

/** Runs `/feature <args>` as the person typing it in the composer does. */
function feature($: Engine, args = '') {
  return $.command.run({
    command: 'feature',
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 80 },
  })
}

/** Draws the pane on a surface, `bodyColumns` wide. */
function mountPane($: Engine, surface: Surface = 'terminal', width = 78) {
  return $.ui.mount({
    plugin: 'beast-mode',
    surface,
    component: 'Pane',
    requestId: PANE,
    props: {
      title: 'shop/cart',
      isFocused: false,
      bodyColumns: width,
      placement: 'inline',
      scroll: { offset: 0, bodyRows: 11 },
      view: {},
    },
  })
}

/** The tree as last drawn, as plain data. */
async function drawnOf(ui: { drawn: () => Promise<unknown> }): Promise<Drawn> {
  return (await ui.drawn()) as Drawn
}

/** The `Text` rows of the root `Box`. */
function rowsOf(tree: Drawn): Drawn[] {
  return (tree.children ?? []).filter((child): child is Drawn => typeof child !== 'string')
}

/** The text of each line. A gap line draws one space, and it reads as ''. */
function linesOf(tree: Drawn): string[] {
  return rowsOf(tree).map(row => {
    const text = (row.children ?? []).join('')

    return text === ' ' ? '' : text
  })
}

/** The `$.fs.read` calls of the world, by path. */
function readsOf(w: World): Record<string, number> {
  return Object.fromEntries(w.reads)
}

/** Loads the scratch tree on a terminal, draws the pane, and sets the counts back to none. */
async function shown($: Engine, on: On, options: WorldOptions = {}) {
  const w = world(on, { files: SCRATCH_TREE, ...options })

  await feature($)
  const ui = await mountPane($)
  w.resetCounts()

  return { w, ui }
}

describe('/feature, the command', () => {
  test('session.start registers /feature with argumentHint and immediate', async ($, on) => {
    const w = world(on, { files: SCRATCH_TREE })

    expect(await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })).toEqual({ cwd: ROOT })
    expect(w.registered.filter(spec => spec.name === 'feature')).toEqual([{ name: 'feature', description: DESCRIPTION, argumentHint: '[name]', immediate: true }])
    expect(w.logs).toEqual([])
  })

  test('a refused registration logs one line, and session.start still answers', async ($, on) => {
    const w = world(on, { refuseRegister: 'the name is taken' })

    expect(await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })).toEqual({ cwd: ROOT })
    expect(w.registered).toEqual([])
    expect(w.logs.filter(line => line.includes('/feature'))).toHaveLength(1)
    expect(w.logs.filter(line => line.includes('/feature'))[0]).toContain('/feature is not registered')
    expect(w.logs.filter(line => line.includes('/feature'))[0]).toContain('the name is taken')
  })

  test('a terminal run answers {}, opens one pane, and the pane draws the view', async ($, on) => {
    const w = world(on, { files: SCRATCH_TREE })

    expect(await feature($)).toEqual({})
    expect(w.opens).toEqual([{ id: PANE, title: 'shop/cart', rows: 11 }])
    expect(w.stateWrites).toBe(1)
    expect(linesOf(await drawnOf(await mountPane($)))).toEqual(CART_LINES)
  })

  test('a desktop run answers {} and opens one pane', async ($, on) => {
    const w = world(on, { files: SCRATCH_TREE, surfaces: ['desktop'] })

    expect(await feature($)).toEqual({})
    expect(w.opens).toHaveLength(1)
  })

  test('a run with no surface answers the eleven lines as text, and it writes no state', async ($, on) => {
    const w = world(on, { files: SCRATCH_TREE, surfaces: [] })

    expect(await feature($)).toEqual({ text: CART_LINES.join('\n') })
    expect(w.opens).toEqual([])
    expect(w.stateWrites).toBe(0)
  })

  test('a vscode run answers the lines as text, and it opens no pane', async ($, on) => {
    const w = world(on, { files: SCRATCH_TREE, surfaces: ['vscode'] })

    expect(await feature($)).toEqual({ text: CART_LINES.join('\n') })
    expect(w.opens).toEqual([])
    expect(w.stateWrites).toBe(0)
  })

  test('an open that answers isPlaced: false gives the lines as text', async ($, on) => {
    const w = world(on, { files: SCRATCH_TREE, isPlaced: false })

    expect(await feature($)).toEqual({ text: CART_LINES.join('\n') })
    expect(w.opens).toHaveLength(1)
    expect(w.stateWrites).toBe(1)
  })

  test('/feature demo answers the demo lines', async ($, on) => {
    world(on, { files: SCRATCH_TREE, surfaces: [] })

    expect(await feature($, 'demo')).toEqual({ text: DEMO_LINES.join('\n') })
  })

  test('/feature cart answers the view of shop/cart, and a name loses its spaces and one trailing slash', async ($, on) => {
    world(on, { files: SCRATCH_TREE, surfaces: [] })

    expect(await feature($, 'cart')).toEqual({ text: CART_LINES.join('\n') })
    expect(await feature($, '  demo/  ')).toEqual({ text: DEMO_LINES.join('\n') })
  })

  test('the active pick reads each candidate tasks.md once, and implementation.md not at all', async ($, on) => {
    const w = world(on, { files: SCRATCH_TREE })

    await feature($)
    expect(readsOf(w)).toEqual({
      [`${FEATURES}/demo/tasks.md`]: 1,
      [`${CART}/tasks.md`]: 1,
      [`${CART}/context.md`]: 1,
      [`${BUGS}/BUG-001.md`]: 1,
      [`${BUGS}/BUG-002.md`]: 1,
      [`${BUGS}/BUG-003.md`]: 1,
    })
  })

  test('each note answers through the command, and the status comes from implementation.md', async ($, on) => {
    const w = world(on, {
      files: {
        [`${FEATURES}/planned/implementation.md`]: doc('# Planned', '', '**Status:** 📋 Planned'),
        [`${FEATURES}/flat/tasks.md`]: doc('# Flat - Task Checklist', '', '- [ ] **A loose task**'),
      },
      dirs: [`${FEATURES}/bare`],
      surfaces: [],
    })

    expect(await feature($, 'planned')).toEqual({
      text: ['planned', 'Status: 📋 Planned', '', 'No tasks.md yet. Run /start-feature planned.', '', 'Open bugs: none'].join('\n'),
    })
    expect(await feature($, 'bare')).toEqual({
      text: ['bare', 'Status: not set', '', 'No tasks.md yet. Run /plan-feature bare.', '', 'Open bugs: none'].join('\n'),
    })
    expect(await feature($, 'flat')).toEqual({
      text: ['flat', 'Status: not set', 'Progress: 0/0 tasks complete (0%)', '', 'No "## Phase" heading in tasks.md.', '', 'Open bugs: none'].join('\n'),
    })
    expect(w.reads.get(`${FEATURES}/planned/implementation.md`)).toBe(1)
    expect(w.reads.has(`${FEATURES}/planned/context.md`)).toBe(false)
  })

  test('a link that leads to a folder counts as a folder after one stat, and a link to a file does not', async ($, on) => {
    const w = world(on, {
      files: {
        ...SCRATCH_TREE,
        '/work/elsewhere/linked/tasks.md': doc('# Linked', '', '## Phase 1: Only (0/1 complete)', '', '- [ ] **1.1 Follow the link**'),
        '/work/elsewhere/notes.md': doc('# Notes'),
      },
      links: { [`${FEATURES}/linked`]: '/work/elsewhere/linked', [`${FEATURES}/notes`]: '/work/elsewhere/notes.md' },
      surfaces: [],
    })

    expect((await feature($, 'linked')).text?.split('\n')[0]).toBe('linked')
    expect(w.stats.get(`${FEATURES}/linked`)).toBe(1)
    expect(w.stats.get(`${FEATURES}/notes`)).toBe(1)
    expect(await feature($, 'notes')).toEqual({ text: NOT_FOUND('notes') })
  })
})

describe('/feature, the message rows of section 3.6', () => {
  const EPICS = {
    ...SCRATCH_TREE,
    [`${FEATURES}/hollow/epic-overview.md`]: doc('# Hollow - Epic Overview'),
    [`${FEATURES}/beta/epic-overview.md`]: doc('# Beta - Epic Overview'),
    [`${FEATURES}/beta/core/tasks.md`]: doc('# Core'),
    [`${FEATURES}/alpha/epic-overview.md`]: doc('# Alpha - Epic Overview'),
    [`${FEATURES}/alpha/core/tasks.md`]: doc('# Core'),
    [`${FEATURES}/alpha/api/tasks.md`]: doc('# Api'),
  }
  const ROWS: ReadonlyArray<readonly [string, WorldOptions, string, string]> = [
    ['no child', { files: SCRATCH_TREE }, 'shop/x', 'Epic "shop" has no feature "x". Run /feature shop/<feature> with one of: cart.'],
    ['no epic', { files: SCRATCH_TREE }, 'demo/x', '"demo" has no epic-overview.md, so "demo/x" is no feature path. Run /feature demo.'],
    ['no top folder', { files: SCRATCH_TREE }, 'nope/x', NOT_FOUND('nope/x')],
    ['two slashes', { files: SCRATCH_TREE }, 'shop/cart/x', NOT_FOUND('shop/cart/x')],
    ['a whole epic', { files: SCRATCH_TREE }, 'shop', '"shop" is an epic. Run /feature shop/<feature> with one of: cart.'],
    ['a whole epic, children A to Z', { files: EPICS }, 'alpha', '"alpha" is an epic. Run /feature alpha/<feature> with one of: api, core.'],
    ['an empty epic', { files: EPICS }, 'hollow', '"hollow" is an epic with no feature folder yet. Run /plan-feature hollow/<feature>.'],
    ['a child of two epics, A to Z', { files: EPICS }, 'core', '"core" is in more than one epic: alpha/core, beta/core. Run /feature <epic>/core.'],
    ['in no place', { files: SCRATCH_TREE }, 'nonesuch', NOT_FOUND('nonesuch')],
    ['no docs/features/ folder', {}, '', 'No feature folder in docs/features/. Run /plan-feature <name> to start one.'],
    ['no folder in docs/features/', { dirs: [FEATURES] }, '', 'No feature folder in docs/features/. Run /plan-feature <name> to start one.'],
    [
      'folders and no candidate',
      { files: { [`${FEATURES}/planned/implementation.md`]: doc('# Planned') } },
      '',
      'No tasks.md in any feature folder. Run /start-feature <name>, or /feature <name>.',
    ],
  ]

  for (const [label, options, args, answer] of ROWS) {
    test(`${label}: /feature ${args} answers one line and opens no pane`, async ($, on) => {
      const w = world(on, options)

      expect(await feature($, args)).toEqual({ text: answer })
      expect(w.opens).toEqual([])
      expect(w.stateWrites).toBe(0)
    })
  }
})

describe('the redraw after an Edit or a Write', () => {
  test('an Edit of the shown tasks.md reads that file and redraws the phase', async ($, on) => {
    const { w, ui } = await shown($, on)
    const ran = await $.tool.call({ tool: 'Edit', file_path: `${CART}/tasks.md`, old_string: OPEN_2_1, new_string: DONE_2_1 })

    expect(ran.isError).toBeUndefined()
    expect(w.toolCalls).toBe(1)
    expect(readsOf(w)).toEqual({ [`${CART}/tasks.md`]: 1 })
    expect(w.stateWrites).toBe(1)
    expect(linesOf(await drawnOf(ui)).slice(4, 6)).toEqual(['Phase 2: The view (1/3)', '[x] 2.1 Draw the cart row'])
  })

  test('a Write of a new linked bug adds it, and an Edit that closes it removes it', async ($, on) => {
    const { w, ui } = await shown($, on)

    await $.tool.call({ tool: 'Write', file_path: `${BUGS}/BUG-004.md`, content: BUG_004 })
    expect(readsOf(w)).toEqual({ [`${BUGS}/BUG-004.md`]: 1 })
    expect(linesOf(await drawnOf(ui)).slice(9)).toEqual([
      'Open bugs (2)',
      'BUG-001  The "Total" row overflows',
      'BUG-004  The cart forgets items',
    ])

    await $.tool.call({ tool: 'Edit', file_path: `${BUGS}/BUG-004.md`, old_string: 'status: open', new_string: 'status: closed' })
    expect(readsOf(w)).toEqual({ [`${BUGS}/BUG-004.md`]: 2 })
    expect(w.stateWrites).toBe(2)
    expect(linesOf(await drawnOf(ui))).toEqual(CART_LINES)
  })

  test('an Edit of context.md reads it and redraws the status', async ($, on) => {
    const { w, ui } = await shown($, on)

    await $.tool.call({ tool: 'Edit', file_path: `${CART}/context.md`, old_string: '🟡 In Progress', new_string: '✅ Complete' })
    expect(readsOf(w)).toEqual({ [`${CART}/context.md`]: 1 })
    expect(linesOf(await drawnOf(ui))[1]).toBe('Status: ✅ Complete')
  })

  test('an Edit of another file reads no file and writes no state', async ($, on) => {
    const { w, ui } = await shown($, on)

    await $.tool.call({ tool: 'Edit', file_path: `${FEATURES}/demo/tasks.md`, old_string: 'Add the notes', new_string: 'Add a note' })
    await $.tool.call({ tool: 'Write', file_path: `${ROOT}/README.md`, content: doc('# Project') })
    expect(w.toolCalls).toBe(2)
    expect(readsOf(w)).toEqual({})
    expect(w.stateWrites).toBe(0)
    expect(linesOf(await drawnOf(ui))).toEqual(CART_LINES)
  })

  test('with the pane closed, an Edit of the shown tasks.md reads no file', async ($, on) => {
    const { w } = await shown($, on)

    w.close(PANE)
    await $.tool.call({ tool: 'Edit', file_path: `${CART}/tasks.md`, old_string: OPEN_2_1, new_string: DONE_2_1 })
    expect(w.toolCalls).toBe(1)
    expect(readsOf(w)).toEqual({})
    expect(w.stateWrites).toBe(0)
  })

  test('a tool call that fails reads no file and passes its result on', async ($, on) => {
    const { w } = await shown($, on)
    const ran = await $.tool.call({ tool: 'Edit', file_path: `${CART}/tasks.md`, old_string: 'no such text', new_string: 'x' })

    expect(ran.isError).toBe(true)
    expect(readsOf(w)).toEqual({})
    expect(w.stateWrites).toBe(0)
  })

  test('a read that rejects passes the result unchanged, and the tool runs once', async ($, on) => {
    const { w, ui } = await shown($, on)

    w.rejects.add(`${CART}/tasks.md`)
    const ran = await $.tool.call({ tool: 'Edit', file_path: `${CART}/tasks.md`, old_string: OPEN_2_1, new_string: DONE_2_1 })

    expect(ran).toEqual({
      result: {
        filePath: `${CART}/tasks.md`,
        oldString: OPEN_2_1,
        newString: DONE_2_1,
        originalFile: SCRATCH_TREE[`${CART}/tasks.md`],
        structuredPatch: [],
        userModified: false,
        replaceAll: false,
      },
      text: `The file ${CART}/tasks.md has been updated.`,
    })
    expect(w.toolCalls).toBe(1)
    expect(readsOf(w)).toEqual({ [`${CART}/tasks.md`]: 1 })
    expect(w.stateWrites).toBe(0)
    expect(linesOf(await drawnOf(ui))).toEqual(CART_LINES)
  })

  test('a redraw that ends after another /feature run leaves the new view alone', async ($, on) => {
    const { w, ui } = await shown($, on)
    const read = w.hold(`${CART}/tasks.md`)
    const call = $.tool.call({ tool: 'Edit', file_path: `${CART}/tasks.md`, old_string: OPEN_2_1, new_string: DONE_2_1 })

    await read.reached
    expect(await feature($, 'demo')).toEqual({})
    read.release()
    await call
    expect(linesOf(await drawnOf(ui))).toEqual(DEMO_LINES)
  })

  test('an Edit that changes no shown line reads the file and writes no state', async ($, on) => {
    const { w, ui } = await shown($, on)

    await $.tool.call({
      tool: 'Edit',
      file_path: `${CART}/tasks.md`,
      old_string: 'Description: One row per item',
      new_string: 'Description: One row for each item',
    })
    expect(readsOf(w)).toEqual({ [`${CART}/tasks.md`]: 1 })
    expect(w.stateWrites).toBe(0)
    expect(linesOf(await drawnOf(ui))).toEqual(CART_LINES)
  })
})

describe('the pane on each surface', () => {
  for (const surface of ['terminal', 'desktop'] as const) {
    for (const width of [78, 36, 20]) {
      test(`the ${surface} pane at ${width} columns validates and draws the lines of section 3.7`, async ($, on) => {
        world(on, { files: SCRATCH_TREE })
        await feature($)

        const tree = await drawnOf(await mountPane($, surface, width))
        const rows = rowsOf(tree)

        expect(tree.type).toBe('Box')
        expect(tree.props).toEqual({ flexDirection: 'column', width })
        expect(rows.map(row => row.type)).toEqual(CART_LINES.map(() => 'Text'))
        expect(rows.map(row => row.props?.wrap)).toEqual(CART_LINES.map((_, index) => (index === 0 ? 'truncate-middle' : 'truncate-end')))
        expect(rows.map(row => row.props?.bold === true)).toEqual(CART_LINES.map((_, index) => [0, 4, 9].includes(index)))
        expect(linesOf(tree)).toEqual(CART_LINES)
      })
    }

    test(`the ${surface} pane draws a done task and a note dim, and a second run draws the new view`, async ($, on) => {
      const w = world(on, {
        files: { ...SCRATCH_TREE, [`${FEATURES}/planned/implementation.md`]: doc('**Status:** 📋 Planned') },
        surfaces: [surface],
      })

      await feature($, 'demo')
      const ui = await mountPane($, surface)
      const demo = rowsOf(await drawnOf(ui))

      expect(demo.map(row => row.props?.dimColor === true)).toEqual(DEMO_LINES.map((_, index) => [5, 6, 7].includes(index)))

      await feature($, 'planned')
      const planned = await drawnOf(ui)

      expect(linesOf(planned)[0]).toBe('planned')
      expect(rowsOf(planned).map(row => row.props?.dimColor === true)).toEqual([false, false, false, true, false, true])
      expect(w.opens.map(open => open.title)).toEqual(['demo', 'planned'])
    })

    test(`the ${surface} pane draws the idle line while no feature is loaded`, async ($, on) => {
      world(on, { files: SCRATCH_TREE })

      const tree = await drawnOf(await mountPane($, surface, 36))

      expect(tree.props).toEqual({ flexDirection: 'column', width: 36 })
      expect(rowsOf(tree).map(row => row.props?.wrap)).toEqual(['truncate-end'])
      expect(linesOf(tree)).toEqual([IDLE_LINE])
    })
  }
})
