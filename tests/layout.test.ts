import { describe, expect, test } from 'claude-code/testing'
import type { DashboardPaneRow, DashboardPaneState } from '../types/index'
import { barText } from '../hooks/lib/bar'
import { buildBugView, buildEpic, buildFeature, buildProject } from '../hooks/lib/dashboard'
import {
  IDLE_LINE,
  answerText,
  dashboardLines,
  fillText,
  lineText,
  type ButtonPart,
  type DashboardLine,
  type LinePart,
  type TextPart,
} from '../hooks/lib/layout'
import { DASHBOARD_COMMAND, DASHBOARD_COMMANDS, openKey } from '../hooks/lib/moves'
import { NO_PHASE_NOTE, buildView } from '../hooks/lib/view'
import {
  BUG_001,
  DASH_CART_TASKS,
  DASH_EPIC_OVERVIEW,
  DASH_FEATURE_TREE,
  DASH_LINES_BUG,
  DASH_LINES_EMPTY,
  DASH_LINES_EPIC,
  DASH_LINES_FEATURE,
  DASH_LINES_NO_OVERVIEW,
  DASH_LINES_PROJECT,
  DASH_OVERVIEW,
  DASH_TREE,
  ROOT,
} from './fixtures'

const BUG_PREFIX = `${ROOT}/docs/bugs/`
const BUGS = Object.entries(DASH_TREE)
  .filter(([path]) => path.startsWith(BUG_PREFIX))
  .map(([path, text]) => ({ file: path.slice(BUG_PREFIX.length), text }))

const PROJECT = buildProject({ root: ROOT, tree: DASH_FEATURE_TREE, overview: DASH_OVERVIEW, bugs: BUGS })
const EPIC = buildEpic({ tree: DASH_FEATURE_TREE, epic: 'shop', text: DASH_EPIC_OVERVIEW, bugs: BUGS })

function featureView(tasks: string | null) {
  return buildView({
    root: ROOT,
    path: 'shop/cart',
    linkKeys: ['shop/cart', 'cart'],
    files: ['context.md', 'tasks.md'],
    tasks,
    context: DASH_TREE[`${ROOT}/docs/features/shop/cart/context.md`] ?? null,
    implementation: null,
    bugs: BUGS,
  })
}

const FEATURE = buildFeature(featureView(DASH_CART_TASKS), DASH_CART_TASKS)
const BUG = buildBugView('BUG-001.md', BUG_001)

function stateOf(view: DashboardPaneState['view']): DashboardPaneState {
  const route: DashboardPaneState['route'] =
    view.kind === 'project'
      ? { kind: 'project' }
      : view.kind === 'epic'
        ? { kind: 'epic', epic: view.epic }
        : view.kind === 'feature'
          ? { kind: 'feature', path: view.feature.path }
          : { kind: 'bug', file: view.file }

  return { root: ROOT, route, back: [], view }
}

/** The item at an index. A missing item throws, so the test fails where it reads it. */
function at<T>(items: readonly T[], index: number): T {
  const item = items[index]

  if (item === undefined) {
    throw new Error(`No item at index ${index}`)
  }

  return item
}

function linesOf(view: DashboardPaneState['view']): DashboardLine[] {
  return dashboardLines(stateOf(view))
}

function textsOf(view: DashboardPaneState['view']): string[] {
  return linesOf(view).map(lineText)
}

function row(name: string, patch: Partial<DashboardPaneRow> = {}): DashboardPaneRow {
  return { name, path: name, kind: 'feature', status: null, progress: null, isListed: true, ...patch }
}

function projectOf(rows: DashboardPaneRow[], patch: Partial<typeof PROJECT> = {}) {
  return { ...PROJECT, rows, bugs: [], ...patch }
}

function textParts(item: DashboardLine): TextPart[] {
  return item.parts.filter((part): part is TextPart => part.kind === 'text')
}

function buttons(item: DashboardLine): ButtonPart[] {
  return item.parts.filter((part): part is ButtonPart => part.kind === 'button')
}

function allParts(view: DashboardPaneState['view']): LinePart[] {
  return linesOf(view).flatMap(item => item.parts)
}

describe('layout: the idle line', () => {
  test('names the command that loads a dashboard', () => {
    expect(IDLE_LINE).toBe('No dashboard loaded. Run /dashboard to load one.')
  })
})

describe('layout: the project view (section 3.10)', () => {
  test('line 1 is the project name, a heading that truncates in the middle', () => {
    const first = at(linesOf(PROJECT), 0)

    expect(first.parts).toEqual([{ kind: 'text', text: 'project', tone: 'heading', wrap: 'truncate-middle' }])
  })

  test('line 2 gives the source and the stamp, dim', () => {
    const second = at(linesOf(PROJECT), 1)

    expect(lineText(second)).toBe('From docs/overview.md, updated 2026-10-05')
    expect(at(textParts(second), 0).tone).toBe('dim')
  })

  test('line 2 gives the source with no stamp', () => {
    expect(textsOf({ ...PROJECT, updated: null })[1]).toBe('From docs/overview.md')
  })

  test('line 2 gives the no-table text', () => {
    expect(textsOf({ ...PROJECT, source: 'noTable' })[1]).toBe(
      'No Feature Status table in docs/overview.md. Run /update-master.',
    )
  })

  test('line 2 gives the no-file text', () => {
    expect(textsOf({ ...PROJECT, source: 'noFile' })[1]).toBe('No docs/overview.md. Run /update-master to make one.')
  })

  test('line 3 is a gap', () => {
    const third = at(linesOf(PROJECT), 2)

    expect(third.isGap).toBe(true)
    expect(third.parts).toEqual([])
    expect(lineText(third)).toBe('')
  })

  test('a feature row has the open button and the Autorun button', () => {
    const name = at(linesOf(PROJECT), 5)

    expect(buttons(name).map(item => item.key)).toEqual(['open:demo', 'run:demo'])
    expect(buttons(name).map(item => item.label)).toEqual(['demo', 'Autorun'])
    expect(buttons(name).every(item => !item.isPlain && item.hotkey === null)).toBe(true)
    expect(at(buttons(name), 0).action).toEqual({ kind: 'open', route: { kind: 'feature', path: 'demo' } })
    expect(at(buttons(name), 1).action).toEqual({
      kind: 'fill',
      command: 'autorun-feature',
      text: '/autorun-feature demo',
    })
  })

  test('an epic row has the open button and a dim `epic`, no Autorun', () => {
    const name = at(linesOf(PROJECT), 3)

    expect(buttons(name).map(item => item.key)).toEqual(['open:shop'])
    expect(at(buttons(name), 0).action).toEqual({ kind: 'open', route: { kind: 'epic', epic: 'shop' } })
    expect(textParts(name)).toEqual([{ kind: 'text', text: 'epic', tone: 'dim', wrap: 'truncate-end' }])
  })

  test('a missing row has the name and `no folder`, both dim, and no button', () => {
    const name = at(linesOf(PROJECT), 7)

    expect(buttons(name)).toEqual([])
    expect(textParts(name).map(item => [item.text, item.tone])).toEqual([
      ['ghost', 'dim'],
      ['no folder', 'dim'],
    ])
  })

  test('the detail line has indent 2, and a bar labeled with the percent', () => {
    const detail = at(linesOf(PROJECT), 4)
    const part = at(detail.parts, 0)

    expect(detail.indent).toBe(2)
    expect(part.kind).toBe('bar')
    expect(part.kind === 'bar' && part.label).toBe('25%')
    expect(part.kind === 'bar' && barText(part.model)).toBe('███░░░░░░░')
  })

  test('the detail line counts one open bug and many open bugs', () => {
    const one = textsOf(projectOf([row('demo', { status: 'Done' })], { bugs: [{ file: 'a.md', row: 'demo' }] }))
    const many = textsOf(
      projectOf([row('demo', { status: 'Done' })], {
        bugs: [
          { file: 'a.md', row: 'demo' },
          { file: 'b.md', row: 'demo' },
          { file: 'c.md', row: 'other' },
        ],
      }),
    )

    expect(one[4]).toBe('  1 open bug  Done')
    expect(many[4]).toBe('  2 open bugs  Done')
  })

  test('the detail line shows no bug part for no bug', () => {
    expect(textsOf(projectOf([row('demo', { status: 'Done' })]))[4]).toBe('  Done')
  })

  test('an unlisted row shows `not in docs/overview.md` in place of the status', () => {
    const detail = at(linesOf(projectOf([row('notes', { status: 'Stale', isListed: false })])), 4)

    expect(lineText(detail)).toBe('  not in docs/overview.md')
    expect(at(textParts(detail), 0).tone).toBe('dim')
  })

  test('a row with no part shows `no status`, dim', () => {
    const detail = at(linesOf(projectOf([row('demo')])), 4)

    expect(lineText(detail)).toBe('  no status')
    expect(at(textParts(detail), 0).tone).toBe('dim')
  })

  test('the detail text is body tone', () => {
    expect(textParts(at(linesOf(PROJECT), 4)).every(item => item.tone === 'body')).toBe(true)
  })

  test('no folder: the empty line comes in place of the rows, dim', () => {
    const lines = linesOf(projectOf([]))

    expect(lines.length).toBe(4)
    expect(lineText(at(lines, 3))).toBe('No feature folder in docs/features/. Run /plan-feature <name> to start one.')
    expect(at(textParts(at(lines, 3)), 0).tone).toBe('dim')
  })

  test('the lineText of the project view equals section 3.12, except the Autorun buttons', () => {
    const texts = textsOf(PROJECT).map(item => item.replace('  Autorun', ''))

    expect(texts).toEqual([...DASH_LINES_PROJECT])
  })

  test('answerText equals the eleven lines of section 3.12', () => {
    const answer = answerText(linesOf(PROJECT))

    expect(answer.split('\n')).toEqual([...DASH_LINES_PROJECT])
    expect(answer.split('\n').length).toBe(11)
  })
})

describe('layout: the project view with no overview or no folder', () => {
  const NO_OVERVIEW = buildProject({
    root: ROOT,
    tree: DASH_FEATURE_TREE,
    overview: null,
    bugs: BUGS,
  })
  const EMPTY = buildProject({ root: ROOT, tree: { exists: false, top: [] }, overview: null, bugs: [] })

  test('no overview: every folder is unlisted, A to Z', () => {
    expect(answerText(linesOf(NO_OVERVIEW)).split('\n')).toEqual([...DASH_LINES_NO_OVERVIEW])
  })

  test('an empty folder answers the section 3.12 lines', () => {
    expect(answerText(linesOf(EMPTY)).split('\n')).toEqual([...DASH_LINES_EMPTY])
  })

  test('the lineText of the empty folder equals section 3.12 too', () => {
    expect(textsOf(EMPTY)).toEqual([...DASH_LINES_EMPTY])
  })
})

describe('layout: the epic view (section 3.10)', () => {
  test('line 1 is the Back button, then the epic name, a heading that truncates in the middle', () => {
    const header = at(linesOf(EPIC), 0)
    const back = at(buttons(header), 0)

    expect(back).toEqual({
      kind: 'button',
      key: 'back',
      label: 'Back',
      hotkey: 'b',
      isPlain: true,
      action: { kind: 'back' },
    })
    expect(textParts(header)).toEqual([{ kind: 'text', text: 'shop', tone: 'heading', wrap: 'truncate-middle' }])
    expect(lineText(header)).toBe('b: Back  shop')
  })

  test('line 2 gives the status, or `not set`', () => {
    expect(textsOf(EPIC)[1]).toBe('Status: 🟡 In Progress')
    expect(textsOf({ ...EPIC, status: null })[1]).toBe('Status: not set')
    expect(at(textParts(at(linesOf(EPIC), 1)), 0).tone).toBe('body')
  })

  test('line 3 gives the source and the stamp, dim', () => {
    expect(textsOf(EPIC)[2]).toBe('From epic-overview.md, updated 2026-10-05 07:57')
    expect(at(textParts(at(linesOf(EPIC), 2)), 0).tone).toBe('dim')
  })

  test('line 3 gives the source with no stamp', () => {
    expect(textsOf({ ...EPIC, updated: null })[2]).toBe('From epic-overview.md')
  })

  test('line 3 gives the no-table text with the epic name', () => {
    expect(textsOf({ ...EPIC, source: 'noTable' })[2]).toBe(
      'No Features table in epic-overview.md. Run /update-epic shop.',
    )
  })

  test('line 4 holds Autorun and Update, each a plain button with a hotkey and a fill', () => {
    const actions = buttons(at(linesOf(EPIC), 3))

    expect(actions.map(item => [item.key, item.label, item.hotkey, item.isPlain])).toEqual([
      ['act:autorun-epic', 'Autorun', 'a', true],
      ['act:update-epic', 'Update', 'u', true],
    ])
    expect(actions.map(item => item.action)).toEqual([
      { kind: 'fill', command: 'autorun-epic', text: '/autorun-epic shop' },
      { kind: 'fill', command: 'update-epic', text: '/update-epic shop' },
    ])
    expect(textsOf(EPIC)[3]).toBe('a: Autorun  u: Update')
  })

  test('line 5 is a gap', () => {
    expect(at(linesOf(EPIC), 4).isGap).toBe(true)
  })

  test('a child row has the open button and the Autorun button, a missing row has no button', () => {
    const lines = linesOf(EPIC)

    expect(buttons(at(lines, 5)).map(item => item.key)).toEqual(['open:shop/cart', 'run:shop/cart'])
    expect(at(buttons(at(lines, 5)), 0).label).toBe('cart')
    expect(at(buttons(at(lines, 5)), 1).action).toEqual({
      kind: 'fill',
      command: 'autorun-feature',
      text: '/autorun-feature shop/cart',
    })
    expect(buttons(at(lines, 7))).toEqual([])
  })

  test('the unlisted note reads `not in the Features table`', () => {
    const view = { ...EPIC, rows: [row('shop/lone', { isListed: false })], bugs: [] }

    expect(textsOf(view)[6]).toBe('  not in the Features table')
  })

  test('no child folder: the empty line comes in place of the rows, dim', () => {
    const lines = linesOf({ ...EPIC, rows: [] })

    expect(lines.length).toBe(6)
    expect(lineText(at(lines, 5))).toBe('No feature folder in this epic yet. Run /plan-feature shop/<feature>.')
    expect(at(textParts(at(lines, 5)), 0).tone).toBe('dim')
  })

  test('the lineText of the epic view equals section 3.12', () => {
    expect(textsOf(EPIC)).toEqual([...DASH_LINES_EPIC])
  })

  test('answerText drops the Back button and the fill buttons, and it keeps the open buttons', () => {
    expect(answerText(linesOf(EPIC)).split('\n')).toEqual([
      'shop',
      'Status: 🟡 In Progress',
      'From epic-overview.md, updated 2026-10-05 07:57',
      '',
      'cart',
      '  ███░░░░░░░ 25%  1 open bug  In Progress',
      'checkout  no folder',
      '  Planned',
    ])
  })
})

describe('layout: the feature view (section 3.10)', () => {
  test('line 1 is the Back button, then the path, a heading that truncates in the middle', () => {
    const header = at(linesOf(FEATURE), 0)

    expect(at(buttons(header), 0).key).toBe('back')
    expect(textParts(header)).toEqual([{ kind: 'text', text: 'shop/cart', tone: 'heading', wrap: 'truncate-middle' }])
  })

  test('line 2 gives the status, or `not set`', () => {
    const none = { ...FEATURE, feature: { ...FEATURE.feature, status: null } }

    expect(textsOf(FEATURE)[1]).toBe('Status: 🟡 In Progress')
    expect(textsOf(none)[1]).toBe('Status: not set')
  })

  test('line 3 gives `Progress:` and a bar labeled with the progress text', () => {
    const progress = at(linesOf(FEATURE), 2)
    const part = at(progress.parts, 1)

    expect(at(textParts(progress), 0).text).toBe('Progress:')
    expect(part.kind === 'bar' && part.label).toBe('1/4 tasks complete (25%)')
    expect(part.kind === 'bar' && barText(part.model)).toBe('███░░░░░░░')
  })

  test('line 3 is left out when tasks.md does not exist', () => {
    const view = buildFeature(featureView(null), null)

    expect(textsOf(view).some(item => item.startsWith('Progress:'))).toBe(false)
    expect(textsOf(view)[2]).toBe('a: Autorun  p: Proceed  c: Continue  u: Update')
  })

  test('line 4 holds the four action buttons, plain with a hotkey, and the fills', () => {
    const actions = buttons(at(linesOf(FEATURE), 3))

    expect(actions.map(item => [item.key, item.label, item.hotkey, item.isPlain])).toEqual([
      ['act:autorun-feature', 'Autorun', 'a', true],
      ['act:proceed', 'Proceed', 'p', true],
      ['act:continue-feature', 'Continue', 'c', true],
      ['act:update-feature', 'Update', 'u', true],
    ])
    expect(actions.map(item => item.action)).toEqual([
      { kind: 'fill', command: 'autorun-feature', text: '/autorun-feature shop/cart' },
      { kind: 'fill', command: 'proceed', text: '/proceed' },
      { kind: 'fill', command: 'continue-feature', text: '/continue-feature shop/cart' },
      { kind: 'fill', command: 'update-feature', text: '/update-feature shop/cart' },
    ])
  })

  test('line 5 is a gap', () => {
    expect(at(linesOf(FEATURE), 4).isGap).toBe(true)
  })

  test('line 6 gives `Phases (<n>)`, a heading', () => {
    const phases = at(linesOf(FEATURE), 5)

    expect(lineText(phases)).toBe('Phases (2)')
    expect(at(textParts(phases), 0).tone).toBe('heading')
  })

  test('line 6: the note replaces lines 6 to 8 when tasks.md holds no phase', () => {
    const view = buildFeature(featureView('# Tasks\n'), '# Tasks\n')
    const texts = textsOf(view)

    expect(texts).toContain(NO_PHASE_NOTE)
    expect(texts.some(item => item.startsWith('Phases'))).toBe(false)
    expect(at(textParts(at(linesOf(view), 5)), 0).tone).toBe('dim')
  })

  test('line 6: the note of a missing tasks.md shows, dim', () => {
    const view = buildFeature(featureView(null), null)
    const note = view.feature.note ?? ''

    expect(note).not.toBe('')
    expect(textsOf(view)[4]).toBe(note)
    expect(at(textParts(at(linesOf(view), 4)), 0).tone).toBe('dim')
  })

  test('line 7 has the toggle, a bar with no label, and the title with the count', () => {
    const phase = at(linesOf(FEATURE), 7)
    const toggle = at(buttons(phase), 0)

    expect(toggle).toEqual({
      kind: 'button',
      key: 'phase:1',
      label: '-',
      hotkey: null,
      isPlain: true,
      action: { kind: 'toggle', phase: 1 },
    })
    const bare = at(phase.parts, 1)

    expect(bare.kind === 'bar' && bare.label).toBe('')
    expect(lineText(phase)).toBe('-  ░░░░░░░░░░  Phase 2: The view (0/3)')
  })

  test('line 7: the toggle is `+` for a closed phase', () => {
    const phase = at(linesOf(FEATURE), 6)

    expect(at(buttons(phase), 0).label).toBe('+')
    expect(at(buttons(phase), 0).key).toBe('phase:0')
    expect(lineText(phase)).toBe('+  ██████████  Phase 1: The model (1/1)')
  })

  test('line 7: the current phase is a heading, the other phases are body', () => {
    const lines = linesOf(FEATURE)

    expect(at(textParts(at(lines, 7)), 0).tone).toBe('heading')
    expect(at(textParts(at(lines, 6)), 0).tone).toBe('body')
  })

  test('line 8: a task of an open phase has indent 4, body for open and dim for done', () => {
    const open = { ...FEATURE, expanded: [0, 1] }
    const lines = linesOf(open)
    const done = at(lines, 7)
    const todo = at(lines, 9)

    expect(done.indent).toBe(4)
    expect(lineText(done).startsWith('    [x] ')).toBe(true)
    expect(at(textParts(done), 0).tone).toBe('dim')
    expect(lineText(todo)).toBe('    [ ] 2.1 Draw the cart row')
    expect(at(textParts(todo), 0).tone).toBe('body')
  })

  test('line 8: a closed phase shows no task', () => {
    const closed = textsOf({ ...FEATURE, expanded: [] })

    expect(closed.some(item => item.startsWith('    '))).toBe(false)
  })

  test('line 9 is a gap before the bugs', () => {
    const lines = linesOf(FEATURE)

    expect(at(lines, lines.length - 3).isGap).toBe(true)
  })

  test('line 10 gives `Open bugs (<n>)`, a heading', () => {
    const lines = linesOf(FEATURE)
    const heading = at(lines, lines.length - 2)

    expect(lineText(heading)).toBe('Open bugs (1)')
    expect(at(textParts(heading), 0).tone).toBe('heading')
  })

  test('line 10 gives `Open bugs: none`, dim', () => {
    const view = { ...FEATURE, feature: { ...FEATURE.feature, bugs: [] } }
    const lines = linesOf(view)
    const last = at(lines, lines.length - 1)

    expect(lineText(last)).toBe('Open bugs: none')
    expect(at(textParts(last), 0).tone).toBe('dim')
  })

  test('line 11 has the bug button with the id, then the title in body tone', () => {
    const lines = linesOf(FEATURE)
    const bug = at(lines, lines.length - 1)

    expect(buttons(bug)).toEqual([
      {
        kind: 'button',
        key: 'bug:BUG-001.md',
        label: 'BUG-001',
        hotkey: null,
        isPlain: false,
        action: { kind: 'open', route: { kind: 'bug', file: 'BUG-001.md' } },
      },
    ])
    expect(at(textParts(bug), 0)).toEqual({
      kind: 'text',
      text: 'The "Total" row overflows',
      tone: 'body',
      wrap: 'truncate-end',
    })
  })

  test('the lineText of the feature view equals section 3.12', () => {
    expect(textsOf(FEATURE)).toEqual([...DASH_LINES_FEATURE])
  })

  test('the open key of the bug route matches the key of the bug button', () => {
    expect(openKey({ kind: 'bug', file: 'BUG-001.md' })).toBe('bug:BUG-001.md')
  })
})

describe('layout: the bug view (section 3.10)', () => {
  test('line 1 is the Back button, then the id, a heading', () => {
    const header = at(linesOf(BUG), 0)

    expect(at(buttons(header), 0).key).toBe('back')
    expect(at(textParts(header), 0)).toEqual({ kind: 'text', text: 'BUG-001', tone: 'heading', wrap: 'truncate-end' })
  })

  test('line 2 is the title, a heading', () => {
    const title = at(linesOf(BUG), 1)

    expect(lineText(title)).toBe('The "Total" row overflows')
    expect(at(textParts(title), 0).tone).toBe('heading')
  })

  test('line 3 holds the Fix button with the fix-bug fill', () => {
    const fix = buttons(at(linesOf(BUG), 2))

    expect(fix).toEqual([
      {
        kind: 'button',
        key: 'act:fix-bug',
        label: 'Fix',
        hotkey: 'f',
        isPlain: true,
        action: { kind: 'fill', command: 'fix-bug', text: '/fix-bug BUG-001' },
      },
    ])
  })

  test('line 4 is a gap', () => {
    expect(at(linesOf(BUG), 3).isGap).toBe(true)
  })

  test('line 5 gives `<key>: <value>` per shown field, body tone', () => {
    const fields = linesOf(BUG).slice(4, 7)

    expect(fields.map(lineText)).toEqual(['status: open', 'priority: high', 'linkedFeature: cart'])
    expect(fields.every(item => at(textParts(item), 0).tone === 'body')).toBe(true)
  })

  test('line 5 gives the note, dim, for a bug with no frontmatter', () => {
    const view = buildBugView('BUG-009.md', 'no frontmatter here')
    const lines = linesOf(view)

    expect(lineText(at(lines, 4))).toBe('No frontmatter in docs/bugs/BUG-009.md.')
    expect(at(textParts(at(lines, 4)), 0).tone).toBe('dim')
  })

  test('line 6 is a gap', () => {
    expect(at(linesOf(BUG), 7).isGap).toBe(true)
  })

  test('line 7 is one Markdown part with the body', () => {
    const body = at(linesOf(BUG), 8)

    expect(body.parts).toEqual([{ kind: 'markdown', text: 'The total row is too wide.' }])
  })

  test('line 7 gives `No description.`, dim, for an empty body', () => {
    const view = buildBugView('BUG-009.md', 'no frontmatter here')
    const lines = linesOf(view)
    const last = at(lines, lines.length - 1)

    expect(lineText(last)).toBe('No description.')
    expect(at(textParts(last), 0).tone).toBe('dim')
  })

  test('the lineText of the bug view equals section 3.12', () => {
    expect(textsOf(BUG)).toEqual([...DASH_LINES_BUG])
  })
})

describe('layout: lineText and answerText', () => {
  test('lineText joins the parts with two spaces, after the indent', () => {
    const item: DashboardLine = {
      indent: 3,
      isGap: false,
      parts: [
        { kind: 'text', text: 'a', tone: 'body', wrap: 'truncate-end' },
        { kind: 'markdown', text: 'b' },
      ],
    }

    expect(lineText(item)).toBe('   a  b')
  })

  test('a bar part gives the cells, then a space and the label', () => {
    const model = { filled: 5, ratio: 0.5, pct: 50 }
    const labeled: DashboardLine = { indent: 0, isGap: false, parts: [{ kind: 'bar', model, label: '50%' }] }
    const bare: DashboardLine = { indent: 0, isGap: false, parts: [{ kind: 'bar', model, label: '' }] }

    expect(lineText(labeled)).toBe('█████░░░░░ 50%')
    expect(lineText(bare)).toBe('█████░░░░░')
  })

  test('a plain button with a hotkey gives `<hotkey>: <label>`, other buttons give the label', () => {
    const plain: ButtonPart = {
      kind: 'button',
      key: 'back',
      label: 'Back',
      hotkey: 'b',
      isPlain: true,
      action: { kind: 'back' },
    }

    expect(lineText({ indent: 0, isGap: false, parts: [plain] })).toBe('b: Back')
    expect(lineText({ indent: 0, isGap: false, parts: [{ ...plain, hotkey: null }] })).toBe('Back')
    expect(lineText({ indent: 0, isGap: false, parts: [{ ...plain, isPlain: false }] })).toBe('Back')
  })

  test('a gap gives an empty string, and an empty line gives only the indent', () => {
    expect(lineText({ indent: 0, isGap: true, parts: [] })).toBe('')
    expect(lineText({ indent: 2, isGap: false, parts: [] })).toBe('  ')
  })

  test('answerText counts a button only when its action is open', () => {
    const lines = linesOf(FEATURE)
    const answer = answerText(lines).split('\n')

    expect(answer[0]).toBe('shop/cart')
    expect(answer.some(item => item.includes('Proceed'))).toBe(false)
    expect(answer.some(item => item.includes('Autorun'))).toBe(false)
    expect(answer[answer.length - 1]).toBe('BUG-001  The "Total" row overflows')
  })

  test('answerText drops a line that keeps no text, and it keeps a gap', () => {
    const lines = linesOf(FEATURE)
    const actions = at(lines, 3)

    expect(lineText(actions)).not.toBe('')
    expect(answerText([actions])).toBe('')
    expect(answerText([at(lines, 0), { indent: 0, isGap: true, parts: [] }, at(lines, 1)])).toBe('shop/cart\n\nStatus: 🟡 In Progress')
  })

  test('answerText of no line is an empty string', () => {
    expect(answerText([])).toBe('')
  })
})

describe('layout: the fill texts', () => {
  test('fillText gives the command with a slash, then the argument', () => {
    expect(fillText('proceed')).toBe('/proceed')
    expect(fillText('fix-bug', 'BUG-001')).toBe('/fix-bug BUG-001')
    expect(fillText('proceed', '')).toBe('/proceed')
  })

  test('every fill of every view is a dashboard command that canReplace accepts', () => {
    const views = [PROJECT, EPIC, FEATURE, BUG]
    const fills = views.flatMap(view =>
      allParts(view).flatMap(part => (part.kind === 'button' && part.action.kind === 'fill' ? [part.action] : [])),
    )

    expect(fills.length).toBeGreaterThan(0)

    for (const fill of fills) {
      expect(DASHBOARD_COMMAND.test(fill.text)).toBe(true)
      expect(fill.text.startsWith(`/${fill.command}`)).toBe(true)
    }
  })

  test('the views together use all seven dashboard commands', () => {
    const used = new Set(
      [PROJECT, EPIC, FEATURE, BUG].flatMap(view =>
        allParts(view).flatMap(part => (part.kind === 'button' && part.action.kind === 'fill' ? [part.action.command] : [])),
      ),
    )

    expect([...used].sort()).toEqual([...DASHBOARD_COMMANDS].sort())
  })
})

describe('layout: keys and shapes', () => {
  test('a button key never repeats within a view', () => {
    for (const view of [PROJECT, EPIC, FEATURE, BUG]) {
      const keys = allParts(view).flatMap(part => (part.kind === 'button' ? [part.key] : []))

      expect(new Set(keys).size).toBe(keys.length)
    }
  })

  test('the open key of a row route matches the key of its open button', () => {
    expect(openKey({ kind: 'epic', epic: 'shop' })).toBe('open:shop')
    expect(at(buttons(at(linesOf(PROJECT), 3)), 0).key).toBe('open:shop')
    expect(openKey({ kind: 'feature', path: 'shop/cart' })).toBe('open:shop/cart')
    expect(at(buttons(at(linesOf(EPIC), 5)), 0).key).toBe('open:shop/cart')
  })

  test('a gap has no part, and no other line is a gap', () => {
    for (const view of [PROJECT, EPIC, FEATURE, BUG]) {
      for (const item of linesOf(view)) {
        expect(item.isGap).toBe(item.parts.length === 0)
      }
    }
  })

  test('only the project name, the epic name, and the path truncate in the middle', () => {
    const middle = (view: DashboardPaneState['view']) =>
      allParts(view).flatMap(part => (part.kind === 'text' && part.wrap === 'truncate-middle' ? [part.text] : []))

    expect(middle(PROJECT)).toEqual(['project'])
    expect(middle(EPIC)).toEqual(['shop'])
    expect(middle(FEATURE)).toEqual(['shop/cart'])
    expect(middle(BUG)).toEqual([])
  })

  test('a view never throws, also with empty strings and no rows', () => {
    const empty = {
      ...PROJECT,
      project: '',
      rows: [],
      folders: [],
      bugs: [],
    }
    const bug = buildBugView('', '')

    expect(() => answerText(linesOf(empty))).not.toThrow()
    expect(() => linesOf(bug).map(lineText)).not.toThrow()
    expect(() => linesOf(buildFeature(featureView(''), ''))).not.toThrow()
    expect(() => linesOf({ ...EPIC, epic: '', rows: [] })).not.toThrow()
  })
})
