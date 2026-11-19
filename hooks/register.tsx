// The hooks module of Beast Mode: the hooks only, one section per feature.
// The pure functions live in ./lib, and no file there calls `$`. The reads
// live in ./read. The host follows `$` into no imported file, so each call on
// `$` is spelled here.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, Register, RenderSurface } from 'claude-code'
import type { BoxProps, ButtonProps, ElementConstructor, MarkdownProps, RenderChildren, RenderElement, SvgProps, TextProps } from 'claude-code'

import type { DashboardPaneRoute, DashboardPaneState } from '../types/index'
import { barSvg, barText } from './lib/bar'
import { classifyDashboardEdit, sameData } from './lib/dashboard'
import type { BarPart, ButtonPart, DashboardLine, LineAction, LinePart, LineTone, TextPart } from './lib/layout'
import { IDLE_LINE as DASHBOARD_IDLE_LINE, answerText as dashboardAnswerText, dashboardLines } from './lib/layout'
import {
  DRAFT_MESSAGE,
  backMove,
  backRoute,
  canReplace,
  firstKey,
  notTakenMessage,
  openKey,
  openMove,
  resetMove,
  sameRoute,
  toggled,
} from './lib/moves'
import type { ViewLine } from './lib/view'
import { IDLE_LINE, answerText, classifyEdit, sameView, viewLines } from './lib/view'
import { loadFeature, readPatch } from './read'
import { loadProject, loadRoute, readDashboardPatch } from './read'
import type { Fs } from './read'

export const register: Register = on => {
  featurePane(on)
  dashboardPane(on)
}

// ── feature-pane (5.7.0) ─────────────────────────
const PANE_ID = 'feature-pane'

// The shown view (decision 3). The section function holds the name
// `featurePane`, so the atom is `featurePaneState`.
const featurePaneState = atom({ plugin: 'beast-mode', key: 'featurePane' } as const, null, { shape: 'feature-pane/1' })

/** The three file system reads that ./read takes. The mod reads, and it writes no file. */
function readsOf($: EngineInterface): Fs {
  return {
    read: path => $.fs.read(path),
    list: path => $.fs.list(path),
    stat: path => $.fs.stat(path),
  }
}

/** True when the session draws on a surface that places a pane: `terminal` or `desktop` (decision 8). */
function drawsPane(surfaces: readonly RenderSurface[]): boolean {
  return surfaces.includes('terminal') || surfaces.includes('desktop')
}

/** The style of one line: a heading is bold, and a done task and a note are dim. */
function toneProps(line: ViewLine): { bold?: true; dimColor?: true } {
  return line.tone === 'heading' ? { bold: true } : line.tone === 'dim' ? { dimColor: true } : {}
}

function featurePane(on: On): void {
  // The engine raises session.start again after a hot reload, so the
  // command stays registered.
  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({
        name: 'feature',
        description: 'Show the active feature, its phase, its tasks, and its open bugs',
        argumentHint: '[name]',
        immediate: true,
      })
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      $.ui.log(`beast-mode: /feature is not registered: ${reason}`)
    }

    return next(e)
  })

  // The pane on a surface that places one, else the lines as text.
  on('command.run', { command: 'feature' }, async ($, e) => {
    const root = await $.session.root()
    const outcome = await loadFeature(readsOf($), root, e.args)

    if (typeof outcome === 'string') {
      return { text: outcome }
    }

    if (!drawsPane(await $.session.surfaces())) {
      return { text: answerText(outcome) }
    }

    // The state comes before the open, so the first render reads the new view.
    await update($, featurePaneState, () => outcome)
    const opened = await $.ui
      .open({ id: PANE_ID, title: outcome.path, rows: viewLines(outcome).length })
      .catch(() => null)

    return opened?.isPlaced === true ? {} : { text: answerText(outcome) }
  })

  // The tool runs first. The hook never denies, never rewrites `e`, and never
  // throws after `next`: it returns the result unchanged (decision 14).
  on('tool.call', { tool: ['Edit', 'Write'] }, async ($, e, next) => {
    const ran = await next(e)

    try {
      if (ran.deny !== undefined || ran.isError === true) {
        return ran
      }

      const view = await read($, featurePaneState)
      const kind = view === null ? null : classifyEdit(e.file_path, view)

      if (view === null || kind === null || !(await $.ui.panes()).some(pane => pane.id === PANE_ID)) {
        return ran
      }

      const patch = await readPatch(readsOf($), view, kind, e.file_path)

      if (patch !== null && !sameView(patch(view), view)) {
        await update($, featurePaneState, current => (current?.path === view.path ? patch(current) : current))
      }
    } catch {
      // A failed redraw leaves the pane as it was.
    }

    return ran
  })

  // The read subscribes the pane, so a later write draws it again. The hook writes nothing.
  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const view = await read($, featurePaneState)
    const lines: ViewLine[] = view === null ? [{ text: IDLE_LINE, tone: 'body' }] : viewLines(view)

    return (
      <Box flexDirection="column" width={e.props.bodyColumns}>
        {lines.map((line, index) => (
          <Text wrap={index === 0 && view !== null ? 'truncate-middle' : 'truncate-end'} {...toneProps(line)}>
            {line.tone === 'gap' ? ' ' : line.text}
          </Text>
        ))}
      </Box>
    )
  })
}

// ── dashboard-pane (5.8.0) ───────────────────────
// The project view, the epic view, the feature view, and the bug view, with a
// back stack (section 3.8). The pure parts live in ./lib and the loads in
// ./read. Each call on `$` is spelled here: in the hooks, in the press
// functions, and in the focus.
const DASHBOARD_ID = 'dashboard'

// The shown route, the back stack, and the view (section 3.3). The section
// function holds the name `dashboardPane`, so the atom is `dashboardPaneState`.
const dashboardPaneState = atom({ plugin: 'beast-mode', key: 'dashboardPane' } as const, null, { shape: 'dashboard-pane/1' })

/** The body columns that the open asks for: the dock request (section 3.10). */
const DASHBOARD_COLUMNS = 56

/** The size of an `Svg` bar, in CSS pixels (section 3.5). */
const BAR_WIDTH = 80
const BAR_HEIGHT = 8

/** The one line of the pane while no dashboard is loaded (section 3.2). */
const DASHBOARD_IDLE: DashboardLine = {
  indent: 0,
  parts: [{ kind: 'text', text: DASHBOARD_IDLE_LINE, tone: 'body', wrap: 'truncate-end' }],
  isGap: false,
}

/** The elements that the dashboard draws with. `Svg` is null on the terminal, which draws no `Svg` (F4). */
type DashboardTable = {
  Box: ElementConstructor<BoxProps>
  Button: ElementConstructor<ButtonProps>
  Markdown: ElementConstructor<MarkdownProps>
  Svg: ElementConstructor<SvgProps> | null
  Text: ElementConstructor<TextProps>
}

/** The handler of one button: the press of its action, bound to `$` and to the drawn route. */
type PressOf = (action: LineAction) => () => Promise<void>

/** The move of a press, or null when the state no longer fits it. */
type Move = (current: DashboardPaneState) => DashboardPaneState | null

/**
 * Writes a move under the route guard (section 3.2): only while the state holds
 * the root and the route that the press started from. A newer move wins, and
 * the press then writes nothing. The state is read first, because `update`
 * writes even a value that it does not change. True when it wrote.
 */
async function writeMove($: EngineInterface, root: string, route: DashboardPaneRoute, move: Move): Promise<boolean> {
  const fits = (state: DashboardPaneState | null): DashboardPaneState | null =>
    state !== null && state.root === root && sameRoute(state.route, route) ? move(state) : null

  if (fits(await read($, dashboardPaneState)) === null) {
    return false
  }

  await update($, dashboardPaneState, current => fits(current) ?? current)

  return true
}

/** Puts the focus ring on `key`. A deny, or a host with no focus (the test kit, F6), leaves the ring where it is. */
async function focusOn($: EngineInterface, key: string | null): Promise<void> {
  if (key !== null) {
    await $.ui.focus({ requestId: DASHBOARD_ID, key }).catch(() => null)
  }
}

/** Open: load the route, then write openMove() and focus `back`. A target that is gone gives a toast and no write. */
async function pressOpen($: EngineInterface, route: DashboardPaneRoute, drawnRoute: DashboardPaneRoute): Promise<void> {
  const start = await read($, dashboardPaneState)

  if (start === null || !sameRoute(start.route, drawnRoute)) {
    return
  }

  const outcome = await loadRoute(readsOf($), start.root, route)

  if (typeof outcome === 'string') {
    $.ui.toast(outcome)
    return
  }

  if (await writeMove($, start.root, drawnRoute, current => openMove(current, route, outcome))) {
    await focusOn($, 'back')
  }
}

/**
 * Back: load the last route of the stack, then write backMove() and focus the
 * button that opens the route that the person left. A target that is gone
 * gives the project view with an empty stack (section 3.8).
 */
async function pressBack($: EngineInterface, drawnRoute: DashboardPaneRoute): Promise<void> {
  const start = await read($, dashboardPaneState)

  if (start === null || !sameRoute(start.route, drawnRoute)) {
    return
  }

  const target = backRoute(start)
  const outcome = await loadRoute(readsOf($), start.root, target)

  if (typeof outcome === 'string') {
    const project = await loadProject(readsOf($), start.root)

    if (await writeMove($, start.root, drawnRoute, () => resetMove(start.root, project))) {
      await focusOn($, firstKey(project))
    }

    return
  }

  const moved = await writeMove($, start.root, drawnRoute, current =>
    sameRoute(backRoute(current), target) ? backMove(current, outcome) : null,
  )

  if (moved) {
    await focusOn($, openKey(drawnRoute))
  }
}

/** Fill: put `text` in the prompt box over an empty draft or an earlier fill, never over typed text (section 3.9). */
async function pressFill($: EngineInterface, text: string): Promise<void> {
  const box = await $.prompt.read()

  if (!canReplace(box.text)) {
    $.ui.toast(DRAFT_MESSAGE)
    return
  }

  // `mode` is left out, so the fill replaces the draft.
  const filled = await $.prompt.fill({ text })

  if (!filled.isFilled) {
    $.ui.toast(notTakenMessage(text))
  }
}

/** Toggle: open or close phase `phase` of the feature view. No file read. */
async function pressToggle($: EngineInterface, phase: number, drawnRoute: DashboardPaneRoute): Promise<void> {
  const start = await read($, dashboardPaneState)

  if (start === null) {
    return
  }

  await writeMove($, start.root, drawnRoute, current =>
    current.view.kind === 'feature'
      ? { ...current, view: { ...current.view, expanded: toggled(current.view.expanded, phase) } }
      : null,
  )
}

/** The press of one button. Each press reads the state when it runs, and the drawn route serves only as the guard. */
async function pressed($: EngineInterface, action: LineAction, drawnRoute: DashboardPaneRoute): Promise<void> {
  switch (action.kind) {
    case 'open':
      return pressOpen($, action.route, drawnRoute)
    case 'back':
      return pressBack($, drawnRoute)
    case 'fill':
      return pressFill($, action.text)
    case 'toggle':
      return pressToggle($, action.phase, drawnRoute)
  }
}

/** The style of a text part: a heading is bold, and a dim part is dim. */
function partTone(tone: LineTone): { bold?: true; dimColor?: true } {
  return tone === 'heading' ? { bold: true } : tone === 'dim' ? { dimColor: true } : {}
}

/** The look of a button: plain, with its hotkey when it has one, or the default look (section 3.9). */
function buttonLook(part: ButtonPart): { plain?: true; hotkey?: string } {
  return { ...(part.isPlain ? { plain: true as const } : {}), ...(part.hotkey === null ? {} : { hotkey: part.hotkey }) }
}

/** The parts of a line, with each run of text parts gathered into one list. */
function runsOf(parts: LinePart[]): (Exclude<LinePart, TextPart> | TextPart[])[] {
  const out: (Exclude<LinePart, TextPart> | TextPart[])[] = []

  for (const part of parts) {
    const last = out[out.length - 1]

    if (part.kind !== 'text') {
      out.push(part)
    } else if (Array.isArray(last)) {
      last.push(part)
    } else {
      out.push([part])
    }
  }

  return out
}

/** A run of text parts as one `Text`: a span per part, joined with two spaces as lineText() joins them (rules 2 and 6). */
function drawTexts(table: DashboardTable, parts: TextPart[], indent: number): RenderElement {
  const { Text } = table
  const children: RenderChildren[] = indent > 0 ? [' '.repeat(indent)] : []

  parts.forEach((part, index) => {
    if (index > 0) {
      children.push('  ')
    }

    children.push(
      <Text wrap={part.wrap} {...partTone(part.tone)}>
        {part.text}
      </Text>,
    )
  })

  return <Text wrap={parts.some(part => part.wrap === 'truncate-middle') ? 'truncate-middle' : 'truncate-end'}>{children}</Text>
}

/** A bar (rule 4): on the terminal one `Text` of a green span and a dim span, then the label. Else one `Svg`, then a `Text` of the label. */
function drawBar(table: DashboardTable, part: BarPart): RenderChildren {
  const { Svg, Text } = table

  if (Svg === null) {
    const cells = barText(part.model)
    const done = cells.replace(/░/g, '')
    const rest = cells.replace(/█/g, '')

    return (
      <Text wrap="truncate-end">
        {done === '' ? null : <Text wrap="truncate-end" color="green">{done}</Text>}
        {rest === '' ? null : <Text wrap="truncate-end" dimColor>{rest}</Text>}
        {part.label === '' ? null : ` ${part.label}`}
      </Text>
    )
  }

  return [
    <Svg source={barSvg(part.model)} alt={`${part.model.pct}% done`} width={BAR_WIDTH} height={BAR_HEIGHT} />,
    part.label === '' ? null : <Text wrap="truncate-end">{part.label}</Text>,
  ]
}

/** A line with a button or a bar (rule 3): one row `Box`. A line with a button wraps, so a button that does not fit moves down. */
function drawRow(table: DashboardTable, item: DashboardLine, pressOf: PressOf): RenderElement {
  const { Box, Button, Markdown } = table
  const hasButton = item.parts.some(part => part.kind === 'button')
  const children = runsOf(item.parts).map((part): RenderChildren => {
    if (Array.isArray(part)) {
      return drawTexts(table, part, 0)
    }

    switch (part.kind) {
      case 'bar':
        return drawBar(table, part)
      case 'button':
        return <Button key={part.key} label={part.label} {...buttonLook(part)} onPress={pressOf(part.action)} />
      case 'markdown':
        return <Markdown text={part.text} />
    }
  })

  return (
    <Box flexDirection="row" columnGap={1} paddingLeft={item.indent} {...(hasButton ? { flexWrap: 'wrap' as const } : {})}>
      {children}
    </Box>
  )
}

/** One line of the pane, by the element rules of section 3.10. */
function drawLine(table: DashboardTable, item: DashboardLine, pressOf: PressOf): RenderChildren {
  const { Markdown, Text } = table
  const texts = item.parts.filter((part): part is TextPart => part.kind === 'text')
  const only = item.parts.length === 1 ? item.parts[0] : undefined

  if (item.isGap || item.parts.length === 0) {
    return <Text wrap="truncate-end">{' '}</Text>
  }

  if (texts.length === item.parts.length) {
    return drawTexts(table, texts, item.indent)
  }

  if (only?.kind === 'markdown') {
    return <Markdown text={only.text} />
  }

  return drawRow(table, item, pressOf)
}

/** The renderer: one column `Box`, `width` columns wide, with one child per line (rule 1). */
function drawDashboard(table: DashboardTable, lines: DashboardLine[], width: number, pressOf: PressOf): RenderElement {
  const { Box } = table

  return (
    <Box flexDirection="column" width={width}>
      {lines.map(item => drawLine(table, item, pressOf))}
    </Box>
  )
}

function dashboardPane(on: On): void {
  // A second session.start hook beside the feature-pane hook. The
  // registrations of one plugin nest in order (section 3.2). The host refuses
  // a second session.start hook with no matcher (F1), so this hook matches
  // each value of `isInteractive`, and it runs on every session start.
  on('session.start', { isInteractive: [true, false] }, async ($, e, next) => {
    try {
      await $.command.register({
        name: 'dashboard',
        description: 'Show every feature and epic, with progress, bugs, and actions',
        immediate: true,
      })
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      $.ui.log(`beast-mode: /dashboard is not registered: ${reason}`)
    }

    return next(e)
  })

  // The project view always loads. A second run resets the pane to the project
  // view and empties the stack. The command ignores `e.args`.
  on('command.run', { command: 'dashboard' }, async $ => {
    const root = await $.session.root()
    const view = await loadProject(readsOf($), root)
    const state = resetMove(root, view)
    const lines = dashboardLines(state)

    if (!drawsPane(await $.session.surfaces())) {
      return { text: dashboardAnswerText(lines) }
    }

    // The state comes before the open, so the first render reads it.
    await update($, dashboardPaneState, () => state)
    const opened = await $.ui
      .open({ id: DASHBOARD_ID, title: 'Dashboard', focus: true, rows: lines.length, columns: DASHBOARD_COLUMNS })
      .catch(() => null)

    if (opened?.isPlaced !== true) {
      return { text: dashboardAnswerText(lines) }
    }

    // The ring starts on the open key of the first row.
    await focusOn($, firstKey(view))

    return {}
  })

  // A second hook on the matcher of the feature-pane hook (decision 4). The
  // tool runs first, once for both hooks. The hook never denies, never
  // rewrites `e`, and never throws after `next`: it returns the result unchanged.
  on('tool.call', { tool: ['Edit', 'Write'] }, async ($, e, next) => {
    const ran = await next(e)

    try {
      if (ran.deny !== undefined || ran.isError === true) {
        return ran
      }

      const state = await read($, dashboardPaneState)
      const edit = state === null ? null : classifyDashboardEdit(e.file_path, state)

      if (state === null || edit === null || !(await $.ui.panes()).some(pane => pane.id === DASHBOARD_ID)) {
        return ran
      }

      const patch = await readDashboardPatch(readsOf($), state, edit, e.file_path)

      if (patch !== null && !sameData(patch(state), state)) {
        await writeMove($, state.root, state.route, current => patch(current))
      }
    } catch {
      // A failed redraw leaves the pane as it was.
    }

    return ran
  })

  // The read subscribes the pane, so a later write draws it again. The hook
  // writes nothing: each press writes when it runs.
  on('ui.render', { component: 'Pane', requestId: DASHBOARD_ID }, async ($, e) => {
    const { Box, Button, Markdown, Text } = $.ui.resolve(e)
    // A check of e.surface narrows the table: the terminal draws no Svg (F4).
    const Svg = e.surface === 'terminal' ? null : $.ui.resolve(e).Svg
    const state = await read($, dashboardPaneState)
    const lines = state === null ? [DASHBOARD_IDLE] : dashboardLines(state)
    // The route of the drawing. Each press checks it before it writes.
    const drawnRoute: DashboardPaneRoute = state === null ? { kind: 'project' } : state.route
    const pressOf: PressOf = action => () => pressed($, action, drawnRoute)

    return drawDashboard({ Box, Button, Markdown, Svg, Text }, lines, e.props.bodyColumns, pressOf)
  })
}
