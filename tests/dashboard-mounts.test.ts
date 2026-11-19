import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { RenderSurface } from 'claude-code'

import { DASH_LINES_BUG, DASH_LINES_EPIC, DASH_LINES_FEATURE, DASH_LINES_PROJECT, DASH_TREE } from './fixtures'
import { world } from './world'

// The mounts of the dashboard pane (section 3.10): each of the four views on
// the terminal and on the desktop, at 78, 36, and 20 body columns, and the
// project view on vscode and on mobile. Each tree validates: `drawn()`
// rejects a tree that the surface refuses. The root is one column `Box` as
// wide as `bodyColumns`. Each `Text` carries `wrap` and no `key`. A bar is
// spans on the terminal and one `Svg` on each other surface. Each `Button`
// carries the key, the label, and the look of section 3.9. The kit checks the
// tree that a surface gets, not its paint, so a narrow width changes no text:
// the surface truncates it.

const DASHBOARD = 'dashboard'
const SURFACES = ['terminal', 'desktop'] as const
const WIDTHS = [78, 36, 20] as const

/** The project view as the terminal pane draws it: the text answer, and the `Autorun` button of each feature row. */
const PANE_LINES_PROJECT = DASH_LINES_PROJECT.map(line => (line === 'demo' || line === 'notes' ? `${line}  Autorun` : line))

/** One button: its key, its label, `plain`, and `hotkey` (section 3.9). */
type Look = readonly [key: string, label: string, plain: true | undefined, hotkey: string | undefined]

/** The views, the presses that open each one from the project view, its lines, the `alt` of each bar, and its buttons. */
const VIEWS: readonly {
  name: string
  keys: readonly string[]
  lines: readonly string[]
  alts: readonly string[]
  buttons: readonly Look[]
}[] = [
  {
    name: 'project',
    keys: [],
    lines: PANE_LINES_PROJECT,
    alts: ['25% done', '100% done'],
    buttons: [
      ['open:shop', 'shop', undefined, undefined],
      ['open:demo', 'demo', undefined, undefined],
      ['run:demo', 'Autorun', undefined, undefined],
      ['open:notes', 'notes', undefined, undefined],
      ['run:notes', 'Autorun', undefined, undefined],
    ],
  },
  {
    name: 'epic',
    keys: ['open:shop'],
    lines: DASH_LINES_EPIC,
    alts: ['25% done'],
    buttons: [
      ['back', 'Back', true, 'b'],
      ['act:autorun-epic', 'Autorun', true, 'a'],
      ['act:update-epic', 'Update', true, 'u'],
      ['open:shop/cart', 'cart', undefined, undefined],
      ['run:shop/cart', 'Autorun', undefined, undefined],
    ],
  },
  {
    name: 'feature',
    keys: ['open:shop', 'open:shop/cart'],
    lines: DASH_LINES_FEATURE,
    alts: ['25% done', '100% done', '0% done'],
    buttons: [
      ['back', 'Back', true, 'b'],
      ['act:autorun-feature', 'Autorun', true, 'a'],
      ['act:proceed', 'Proceed', true, 'p'],
      ['act:continue-feature', 'Continue', true, 'c'],
      ['act:update-feature', 'Update', true, 'u'],
      ['phase:0', '+', true, undefined],
      ['phase:1', '-', true, undefined],
      ['bug:BUG-001.md', 'BUG-001', undefined, undefined],
    ],
  },
  {
    name: 'bug',
    keys: ['open:shop', 'open:shop/cart', 'bug:BUG-001.md'],
    lines: DASH_LINES_BUG,
    alts: [],
    buttons: [
      ['back', 'Back', true, 'b'],
      ['act:fix-bug', 'Fix', true, 'f'],
    ],
  },
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

/** Draws the dashboard pane on a surface, `width` body columns wide. */
function mountDashboard($: Engine, surface: RenderSurface, width: number) {
  return $.ui.mount({
    plugin: 'beast-mode',
    surface,
    component: 'Pane',
    requestId: DASHBOARD,
    props: {
      title: 'Dashboard',
      isFocused: true,
      bodyColumns: width,
      placement: 'inline',
      scroll: { offset: 0, bodyRows: DASH_LINES_PROJECT.length },
      view: {},
    },
  })
}

/** The tree as last drawn, as plain data. It rejects when the surface refused the tree. */
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

/** A line as a surface with `Svg` draws it: the ten cells of a bar leave, and its label stays. */
function withoutCells(line: string): string {
  return line.replace(/[█░]{10}( {2}| )/, '')
}

/** Draws the view on a surface: a /dashboard run, a mount, then the presses that open the view. */
async function mountView($: Engine, surface: RenderSurface, width: number, keys: readonly string[]) {
  const ui = await mountDashboard($, surface, width)

  for (const key of keys) {
    await ui.press({ key })
  }

  return ui
}

describe('the mounts: each view on the terminal and the desktop, at 78, 36, and 20 columns', () => {
  for (const surface of SURFACES) {
    for (const width of WIDTHS) {
      for (const view of VIEWS) {
        test(`${surface}, ${width} columns, the ${view.name} view: the tree validates, with its width, wraps, bars, and button keys`, async ($, on) => {
          world(on, { files: DASH_TREE })

          expect(await run($)).toEqual({})
          const ui = await mountView($, surface, width, view.keys)
          const tree = await drawnOf(ui)

          // Rule 1: one column Box, as wide as bodyColumns.
          expect(tree.type).toBe('Box')
          expect(tree.props).toMatchObject({ flexDirection: 'column', width })

          // Rules 6 and 7: each Text carries wrap, and no Text carries a key.
          const texts = await ui.findAll({ type: 'Text' })

          expect(texts.length).toBeGreaterThan(0)
          expect(texts.filter(text => text.props.wrap !== 'truncate-end' && text.props.wrap !== 'truncate-middle')).toEqual([])
          expect(texts.filter(text => text.key !== undefined)).toEqual([])

          // Rule 3: a line with a button or a bar is a row Box. A line with a button wraps.
          for (const row of (tree.children ?? []).filter(isDrawn).filter(child => child.type === 'Box')) {
            const hasButton = (row.children ?? []).some(child => isDrawn(child) && child.type === 'Button')

            expect(row.props).toMatchObject({ flexDirection: 'row', columnGap: 1 })
            expect(row.props?.flexWrap).toBe(hasButton ? 'wrap' : undefined)
          }

          // Rule 4: no Svg on the terminal, and one Svg per bar on the desktop.
          const svgs = await ui.findAll({ type: 'Svg' })

          expect(svgs.map(svg => [svg.props.alt, svg.props.width, svg.props.height])).toEqual(
            surface === 'terminal' ? [] : view.alts.map(alt => [alt, 80, 8]),
          )

          // Section 3.9: each Button with its key, its label, and its look.
          const buttons = await ui.findAll({ type: 'Button' })

          expect(buttons.map(button => [button.key, button.props.label, button.props.plain, button.props.hotkey])).toEqual(
            view.buttons.map(look => [...look]),
          )
          expect(linesOf(tree)).toEqual(surface === 'terminal' ? [...view.lines] : view.lines.map(withoutCells))
        })
      }
    }
  }

  test('on the terminal, a bar is one Text: a green span of the done cells, a dim span of the rest, then the label', async ($, on) => {
    world(on, { files: DASH_TREE })

    await run($)
    const ui = await mountDashboard($, 'terminal', 56)
    const texts = await ui.findAll({ type: 'Text' })

    expect(texts.filter(text => text.props.color === 'green').map(text => text.text)).toEqual(['███', '██████████'])
    expect(texts.filter(text => text.props.dimColor === true && /^░+$/.test(text.text)).map(text => text.text)).toEqual([
      '░░░░░░░',
    ])
    expect(texts.filter(text => /^[█░]{10} /.test(text.text)).map(text => text.text)).toEqual([
      '███░░░░░░░ 25%',
      '██████████ 100%',
    ])
  })

  test('on the bug view, the body is one Markdown with the text of the bug', async ($, on) => {
    world(on, { files: DASH_TREE })

    await run($)
    const ui = await mountView($, 'desktop', 56, VIEWS[3]?.keys ?? [])
    const markdowns = await ui.findAll({ type: 'Markdown' })

    expect(markdowns.map(markdown => markdown.props.text)).toEqual(['The total row is too wide.'])
  })
})

describe('the mounts: the project view on vscode and on mobile', () => {
  for (const surface of ['vscode', 'mobile'] as const) {
    test(`${surface}, 56 columns: the project view validates, with one Svg per bar and the open and run keys`, async ($, on) => {
      // The world surfaces stay ['terminal'], so the run writes the state that the mount draws.
      world(on, { files: DASH_TREE })

      expect(await run($)).toEqual({})
      const ui = await mountDashboard($, surface, 56)
      const tree = await drawnOf(ui)
      const texts = await ui.findAll({ type: 'Text' })
      const svgs = await ui.findAll({ type: 'Svg' })
      const buttons = await ui.findAll({ type: 'Button' })

      expect(tree.props).toMatchObject({ flexDirection: 'column', width: 56 })
      expect(texts.filter(text => text.props.wrap !== 'truncate-end' && text.props.wrap !== 'truncate-middle')).toEqual([])
      expect(svgs.map(svg => svg.props.alt)).toEqual(['25% done', '100% done'])
      expect(buttons.map(button => button.key)).toEqual(['open:shop', 'open:demo', 'run:demo', 'open:notes', 'run:notes'])
      expect(linesOf(tree)).toEqual(PANE_LINES_PROJECT.map(withoutCells))
    })
  }
})
