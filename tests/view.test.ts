import { describe, expect, test } from 'claude-code/testing'
import { linkKeys, pickActive, resolveRef } from '../hooks/lib/features'
import {
  IDLE_LINE,
  answerText,
  buildView,
  classifyEdit,
  sameView,
  viewLines,
  withBug,
  withStatus,
  withTasks,
} from '../hooks/lib/view'
import type { BuildInput } from '../hooks/lib/view'
import { BUG_001, BUG_002, BUG_003, ROOT, SCRATCH_FEATURE_TREE, SCRATCH_TASKS_TEXTS, SCRATCH_TREE, doc } from './fixtures'

const CART = SCRATCH_TREE[`${ROOT}/docs/features/shop/cart/tasks.md`] ?? ''
const DEMO = SCRATCH_TREE[`${ROOT}/docs/features/demo/tasks.md`] ?? ''
const BUGS = [
  { file: 'BUG-001.md', text: BUG_001 },
  { file: 'BUG-002.md', text: BUG_002 },
  { file: 'BUG-003.md', text: BUG_003 },
]

function input(fields: Partial<BuildInput> = {}): BuildInput {
  return {
    root: ROOT,
    path: 'demo',
    linkKeys: ['demo'],
    files: ['tasks.md'],
    tasks: DEMO,
    context: null,
    implementation: null,
    bugs: BUGS,
    ...fields,
  }
}

function cartInput(fields: Partial<BuildInput> = {}): BuildInput {
  return input({
    path: 'shop/cart',
    linkKeys: ['shop/cart', 'cart'],
    files: ['context.md', 'tasks.md'],
    tasks: CART,
    context: SCRATCH_TREE[`${ROOT}/docs/features/shop/cart/context.md`] ?? null,
    ...fields,
  })
}

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

describe('the two expected outputs of section 3.7', () => {
  test('/feature with no name shows the eleven lines of the scratch view', () => {
    const pick = pickActive(SCRATCH_FEATURE_TREE, SCRATCH_TASKS_TEXTS)
    const path = pick.kind === 'feature' ? pick.path : ''
    const view = buildView(cartInput({ path, linkKeys: linkKeys(path, SCRATCH_FEATURE_TREE) }))

    expect(path).toBe('shop/cart')
    expect(answerText(view).split('\n')).toEqual(CART_LINES)
    expect(answerText(view).split('\n')).toHaveLength(11)
  })

  test('/feature demo shows the demo lines', () => {
    const hit = resolveRef('demo', SCRATCH_FEATURE_TREE)

    expect(hit).toEqual({ kind: 'feature', path: 'demo' })
    expect(answerText(buildView(input())).split('\n')).toEqual(DEMO_LINES)
  })

  test('/feature cart announces shop/cart on its first line', () => {
    const hit = resolveRef('cart', SCRATCH_FEATURE_TREE)
    const path = hit.kind === 'feature' ? hit.path : ''

    expect(answerText(buildView(cartInput({ path }))).split('\n')[0]).toBe('shop/cart')
  })

  test('answerText holds no beast-mode prefix', () => {
    expect(answerText(buildView(input())).startsWith('beast-mode')).toBe(false)
  })
})

describe('line rows of section 3.7', () => {
  test('row 1: the path line is the first line, a heading', () => {
    expect(viewLines(buildView(cartInput()))[0]).toEqual({ text: 'shop/cart', tone: 'heading' })
  })

  test('row 2: the status line, a body, with not set for a null status', () => {
    expect(viewLines(buildView(cartInput()))[1]).toEqual({ text: 'Status: 🟡 In Progress', tone: 'body' })
    expect(viewLines(buildView(input()))[1]).toEqual({ text: 'Status: not set', tone: 'body' })
  })

  test('row 3: the progress line, a body, only when tasks.md exists', () => {
    expect(viewLines(buildView(input()))[2]).toEqual({
      text: 'Progress: 3/3 tasks complete (100%)',
      tone: 'body',
    })
    expect(viewLines(buildView(input({ tasks: null }))).some(line => line.text.startsWith('Progress'))).toBe(false)
  })

  test('row 4: a gap line follows the header lines', () => {
    expect(viewLines(buildView(input()))[3]).toEqual({ text: '', tone: 'gap' })
  })

  test('row 5: the phase line, a heading, with the count', () => {
    expect(viewLines(buildView(cartInput()))[4]).toEqual({ text: 'Phase 2: The view (0/3)', tone: 'heading' })
  })

  test('row 6: a done task is dim, an open task is body', () => {
    const done = viewLines(buildView(input()))[5]
    const open = viewLines(buildView(cartInput()))[5]

    expect(done).toEqual({ text: '[x] 1.1 Make the folder', tone: 'dim' })
    expect(open).toEqual({ text: '[ ] 2.1 Draw the cart row', tone: 'body' })
  })

  test('row 7: a note is one dim line in place of lines 5 and 6', () => {
    const lines = viewLines(buildView(input({ tasks: null })))

    expect(lines.slice(2, 4)).toEqual([
      { text: '', tone: 'gap' },
      { text: 'No tasks.md yet. Run /plan-feature demo.', tone: 'dim' },
    ])
  })

  test('row 8: a gap line sits before the bugs', () => {
    const lines = viewLines(buildView(input()))

    expect(lines[lines.length - 3]).toEqual({ text: '', tone: 'gap' })
  })

  test('row 9: the bugs heading with the count, or a dim none line', () => {
    const lines = viewLines(buildView(input()))

    expect(lines[lines.length - 2]).toEqual({ text: 'Open bugs (1)', tone: 'heading' })
    expect(viewLines(buildView(input({ bugs: [] }))).slice(-1)).toEqual([{ text: 'Open bugs: none', tone: 'dim' }])
  })

  test('row 10: a bug line holds the id, two spaces, and the title', () => {
    expect(viewLines(buildView(input())).slice(-1)).toEqual([{ text: 'BUG-003  A demo bug', tone: 'body' }])
  })

  test('the bugs of a view hold id order', () => {
    const view = buildView(
      input({
        path: 'f',
        linkKeys: ['f'],
        bugs: [
          { file: 'BUG-010.md', text: doc('---', 'title: ten', 'linkedFeature: f', '---') },
          { file: 'BUG-002.md', text: doc('---', 'title: two', 'linkedFeature: f', '---') },
        ],
      }),
    )

    expect(view.bugs.map(bug => bug.id)).toEqual(['BUG-002', 'BUG-010'])
  })
})

describe('note rows of section 3.7', () => {
  test('implementation.md and no tasks.md: the start-feature note', () => {
    const view = buildView(input({ path: 'a/b', linkKeys: ['a/b'], files: ['implementation.md'], tasks: null }))

    expect(view.note).toBe('No tasks.md yet. Run /start-feature a/b.')
    expect(view.progress).toBeNull()
    expect(view.phase).toBeNull()
  })

  test('neither file: the plan-feature note', () => {
    const view = buildView(input({ files: [], tasks: null }))

    expect(view.note).toBe('No tasks.md yet. Run /plan-feature demo.')
  })

  test('a tasks.md with no phase: the no-phase note', () => {
    const view = buildView(input({ tasks: doc('# Title', '', '- [ ] loose') }))

    expect(view.note).toBe('No "## Phase" heading in tasks.md.')
    expect(view.phase).toBeNull()
    expect(viewLines(view).map(line => line.text)).toContain('No "## Phase" heading in tasks.md.')
  })

  test('an empty tasks.md gives the no-phase note and a computed progress', () => {
    const view = buildView(input({ tasks: '' }))

    expect(view.note).toBe('No "## Phase" heading in tasks.md.')
    expect(view.progress).toBe('0/0 tasks complete (0%)')
  })

  test('a phase gives no note', () => {
    expect(buildView(input()).note).toBeNull()
  })

  test('IDLE_LINE is the idle text', () => {
    expect(IDLE_LINE).toBe('No feature loaded. Run /feature to load one.')
  })
})

describe('the fields of section 3.3', () => {
  test('root, path, and link keys come from the input', () => {
    const view = buildView(cartInput())

    expect(view.root).toBe(ROOT)
    expect(view.path).toBe('shop/cart')
    expect(view.linkKeys).toEqual(['shop/cart', 'cart'])
  })

  test('the status comes from context.md', () => {
    expect(buildView(input({ context: doc('**Status:** Done'), implementation: doc('**Status:** Plan') })).status).toBe(
      'Done',
    )
  })

  test('the status falls back to implementation.md when context.md holds none', () => {
    expect(buildView(input({ context: doc('# notes'), implementation: doc('**Status:** Plan') })).status).toBe('Plan')
  })

  test('the status is null when neither file holds one', () => {
    expect(buildView(input({ context: doc('# notes'), implementation: null })).status).toBeNull()
    expect(buildView(input({ context: doc('**Status:**') })).status).toBeNull()
  })

  test('the progress is the Progress value, else the computed line', () => {
    expect(buildView(input()).progress).toBe('3/3 tasks complete (100%)')
    expect(buildView(input({ tasks: doc('## Phase 1: A', '- [x] **a**', '- [ ] **b**') })).progress).toBe(
      '1/2 tasks complete (50%)',
    )
  })

  test('the phase is the first phase with an open task, else the last', () => {
    expect(buildView(cartInput()).phase?.title).toBe('Phase 2: The view')
    expect(buildView(input()).phase?.title).toBe('Phase 1: Setup')
  })

  test('only the open bugs that link to the feature show', () => {
    expect(buildView(cartInput()).bugs.map(bug => bug.id)).toEqual(['BUG-001'])
    expect(buildView(input()).bugs.map(bug => bug.id)).toEqual(['BUG-003'])
  })

  test('a file that is no bug file, or that holds no frontmatter, adds nothing', () => {
    const view = buildView(
      input({ bugs: [{ file: 'notes.md', text: BUG_003 }, { file: 'BUG-009.md', text: '# no block' }] }),
    )

    expect(view.bugs).toEqual([])
  })

  test('no lib function throws on an empty string', () => {
    const view = buildView(input({ tasks: '', context: '', implementation: '', bugs: [{ file: 'BUG-1.md', text: '' }] }))

    expect(() => viewLines(view)).not.toThrow()
    expect(() => withTasks(view, '')).not.toThrow()
    expect(() => withBug(view, 'BUG-1.md', '')).not.toThrow()
    expect(() => classifyEdit('', view)).not.toThrow()
  })
})

describe('the patches', () => {
  test('withTasks sets the phase, the progress, and the note', () => {
    const view = buildView(input({ tasks: null, files: [] }))
    const next = withTasks(view, CART)

    expect(next.progress).toBe('1/4 tasks complete (25%)')
    expect(next.phase?.title).toBe('Phase 2: The view')
    expect(next.note).toBeNull()
    expect(next.path).toBe('demo')
    expect(withTasks(next, doc('# empty')).note).toBe('No "## Phase" heading in tasks.md.')
    expect(withTasks(next, doc('# empty')).phase).toBeNull()
  })

  test('withTasks of a checked task moves the count', () => {
    const view = buildView(cartInput())
    const next = withTasks(view, CART.replace('- \\[ \\] **2.1 Draw the cart row**', '- \\[x\\] **2.1 Draw the cart row**'))

    expect(next.phase?.done).toBe(1)
    expect(viewLines(next)[5]).toEqual({ text: '[x] 2.1 Draw the cart row', tone: 'dim' })
  })

  test('withStatus sets the status, and an empty value gives null', () => {
    const view = buildView(input())

    expect(withStatus(view, 'Done').status).toBe('Done')
    expect(withStatus(view, null).status).toBeNull()
    expect(withStatus(withStatus(view, 'Done'), '').status).toBeNull()
  })

  test('withBug adds a new linked open bug in id order', () => {
    const view = buildView(input())
    const next = withBug(view, 'BUG-001.md', doc('---', 'id: BUG-001', 'title: one', 'linkedFeature: demo', '---'))

    expect(next.bugs.map(bug => bug.id)).toEqual(['BUG-001', 'BUG-003'])
  })

  test('withBug replaces a bug by file name', () => {
    const view = buildView(input())
    const next = withBug(view, 'BUG-003.md', doc('---', 'id: BUG-003', 'title: renamed', 'linkedFeature: demo', '---'))

    expect(next.bugs).toEqual([{ id: 'BUG-003', title: 'renamed', file: 'BUG-003.md' }])
  })

  test('withBug removes a bug that closes', () => {
    const view = buildView(input())
    const next = withBug(view, 'BUG-003.md', doc('---', 'title: x', 'status: closed', 'linkedFeature: demo', '---'))

    expect(next.bugs).toEqual([])
  })

  test('withBug removes a bug whose link moved, and ignores a bug of another feature', () => {
    const view = buildView(input())

    expect(withBug(view, 'BUG-003.md', doc('---', 'linkedFeature: other', '---')).bugs).toEqual([])
    expect(sameView(withBug(view, 'BUG-004.md', doc('---', 'linkedFeature: other', '---')), view)).toBe(true)
  })

  test('withBug removes a bug whose frontmatter is gone', () => {
    expect(withBug(buildView(input()), 'BUG-003.md', '# gone').bugs).toEqual([])
  })

  test('withBug matches the bare child name of an epic child', () => {
    const view = buildView(cartInput())
    const next = withBug(view, 'BUG-004.md', doc('---', 'title: bare', 'linkedFeature: cart', '---'))

    expect(next.bugs.map(bug => bug.id)).toEqual(['BUG-001', 'BUG-004'])
  })

  test('a patch returns a new view and leaves the old one unchanged', () => {
    const view = buildView(input())
    const copy = JSON.parse(JSON.stringify(view))

    withStatus(view, 'x')
    withTasks(view, CART)
    withBug(view, 'BUG-003.md', '')

    expect(view).toEqual(copy)
  })
})

describe('sameView', () => {
  test('two builds of one input are the same', () => {
    expect(sameView(buildView(input()), buildView(input()))).toBe(true)
  })

  test('a change in each field makes a difference', () => {
    const view = buildView(input())

    expect(sameView(view, { ...view, root: '/other' })).toBe(false)
    expect(sameView(view, { ...view, path: 'x' })).toBe(false)
    expect(sameView(view, { ...view, linkKeys: ['demo', 'd'] })).toBe(false)
    expect(sameView(view, { ...view, status: 'x' })).toBe(false)
    expect(sameView(view, { ...view, progress: 'x' })).toBe(false)
    expect(sameView(view, { ...view, note: 'x' })).toBe(false)
    expect(sameView(view, { ...view, phase: null })).toBe(false)
    expect(sameView(view, { ...view, bugs: [] })).toBe(false)
  })

  test('a change inside the phase makes a difference', () => {
    const view = buildView(input())
    const phase = view.phase

    expect(phase).not.toBeNull()
    if (phase !== null) {
      expect(sameView(view, { ...view, phase: { ...phase, done: 0 } })).toBe(false)
      expect(sameView(view, { ...view, phase: { ...phase, tasks: [] } })).toBe(false)
      expect(sameView(view, { ...view, phase: { ...phase, tasks: phase.tasks.map(t => ({ ...t, isDone: false })) } })).toBe(
        false,
      )
      expect(sameView(view, { ...view, phase: { ...phase, tasks: phase.tasks.map(t => ({ ...t })) } })).toBe(true)
    }
  })

  test('a patch that changes no shown field is the same view', () => {
    const view = buildView(cartInput())

    expect(sameView(withTasks(view, CART), view)).toBe(true)
    expect(sameView(withStatus(view, view.status), view)).toBe(true)
  })

  test('a patch that changes a shown line is a different view', () => {
    const view = buildView(cartInput())

    expect(sameView(withStatus(view, 'Done'), view)).toBe(false)
  })
})

describe('classifyEdit rows of section 3.8', () => {
  const view = buildView(cartInput())
  const F = `${ROOT}/docs/features/shop/cart/`

  test('F + tasks.md is a tasks edit', () => {
    expect(classifyEdit(`${F}tasks.md`, view)).toBe('tasks')
  })

  test('F + context.md and F + implementation.md are status edits', () => {
    expect(classifyEdit(`${F}context.md`, view)).toBe('status')
    expect(classifyEdit(`${F}implementation.md`, view)).toBe('status')
  })

  test('docs/bugs/BUG-*.md is a bug edit', () => {
    expect(classifyEdit(`${ROOT}/docs/bugs/BUG-001.md`, view)).toBe('bug')
    expect(classifyEdit(`${ROOT}/docs/bugs/BUG-new-one.md`, view)).toBe('bug')
  })

  test('any other path gives null', () => {
    expect(classifyEdit(`${ROOT}/src/index.ts`, view)).toBeNull()
    expect(classifyEdit(`${F}notes.md`, view)).toBeNull()
    expect(classifyEdit(`${ROOT}/docs/features/demo/tasks.md`, view)).toBeNull()
    expect(classifyEdit(`${ROOT}/docs/features/shop/tasks.md`, view)).toBeNull()
    expect(classifyEdit(`${F}sub/tasks.md`, view)).toBeNull()
    expect(classifyEdit(`${ROOT}/docs/bugs/README.md`, view)).toBeNull()
    expect(classifyEdit(`${ROOT}/docs/bugs/old/BUG-001.md`, view)).toBeNull()
    expect(classifyEdit(`${ROOT}/docs/features/shop/cart2/tasks.md`, view)).toBeNull()
    expect(classifyEdit('', view)).toBeNull()
  })

  test('a backslash path counts as a slash path', () => {
    expect(classifyEdit('\\work\\project\\docs\\features\\shop\\cart\\tasks.md', view)).toBe('tasks')
    expect(classifyEdit(`${ROOT}/docs\\bugs\\BUG-001.md`, view)).toBe('bug')
  })

  test('a relative path joins the root', () => {
    expect(classifyEdit('docs/features/shop/cart/tasks.md', view)).toBe('tasks')
    expect(classifyEdit('./docs/features/shop/cart/context.md', view)).toBe('status')
    expect(classifyEdit('docs\\bugs\\BUG-004.md', view)).toBe('bug')
    expect(classifyEdit('docs/features/demo/tasks.md', view)).toBeNull()
  })

  test('a root with backslashes or a drive letter works', () => {
    const win = { ...view, root: 'C:\\work\\project' }

    expect(classifyEdit('C:\\work\\project\\docs\\features\\shop\\cart\\tasks.md', win)).toBe('tasks')
    expect(classifyEdit('docs\\features\\shop\\cart\\tasks.md', win)).toBe('tasks')
    expect(classifyEdit('C:\\other\\docs\\features\\shop\\cart\\tasks.md', win)).toBeNull()
  })

  test('the view of a top feature classifies its own folder', () => {
    const demo = buildView(input())

    expect(classifyEdit(`${ROOT}/docs/features/demo/tasks.md`, demo)).toBe('tasks')
    expect(classifyEdit(`${F}tasks.md`, demo)).toBeNull()
  })
})
