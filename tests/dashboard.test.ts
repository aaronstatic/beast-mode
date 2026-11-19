import { describe, expect, test } from 'claude-code/testing'
import type { DashboardPaneState } from '../types/index'
import {
  buildBugView,
  buildEpic,
  buildFeature,
  buildProject,
  classifyDashboardEdit,
  openCount,
  sameData,
  withBugDoc,
  withBugRef,
  withEpicOverview,
  withFeatureTasks,
  withOverview,
} from '../hooks/lib/dashboard'
import { buildView } from '../hooks/lib/view'
import { rowName } from '../hooks/lib/tables'
import type { FeatureTree } from '../hooks/lib/features'
import {
  BUG_001,
  DASH_CART_TASKS,
  DASH_EPIC_OVERVIEW,
  DASH_FEATURE_TREE,
  DASH_OVERVIEW,
  DASH_TREE,
  NAME_CASES,
  ROOT,
  doc,
} from './fixtures'

const BUG_PREFIX = `${ROOT}/docs/bugs/`
const BUGS = Object.entries(DASH_TREE)
  .filter(([path]) => path.startsWith(BUG_PREFIX))
  .map(([path, text]) => ({ file: path.slice(BUG_PREFIX.length), text }))

const PROJECT = buildProject({ root: ROOT, tree: DASH_FEATURE_TREE, overview: DASH_OVERVIEW, bugs: BUGS })
const EPIC = buildEpic({ tree: DASH_FEATURE_TREE, epic: 'shop', text: DASH_EPIC_OVERVIEW, bugs: BUGS })

function featureView() {
  return buildView({
    root: ROOT,
    path: 'shop/cart',
    linkKeys: ['shop/cart', 'cart'],
    files: ['context.md', 'tasks.md'],
    tasks: DASH_CART_TASKS,
    context: DASH_TREE[`${ROOT}/docs/features/shop/cart/context.md`] ?? null,
    implementation: null,
    bugs: BUGS,
  })
}

const FEATURE = buildFeature(featureView(), DASH_CART_TASKS)
const BUG = buildBugView('BUG-001.md', BUG_001)

function stateOf(view: DashboardPaneState['view'], route: DashboardPaneState['route']): DashboardPaneState {
  return { root: ROOT, route, back: [], view }
}

const PROJECT_STATE = stateOf(PROJECT, { kind: 'project' })
const EPIC_STATE = stateOf(EPIC, { kind: 'epic', epic: 'shop' })
const FEATURE_STATE = stateOf(FEATURE, { kind: 'feature', path: 'shop/cart' })
const BUG_STATE = stateOf(BUG, { kind: 'bug', file: 'BUG-001.md' })

describe('project view: name, source, and stamp', () => {
  test('the name is the last segment of the root', () => {
    expect(PROJECT.project).toBe('project')
    expect(buildProject({ root: 'C:\\work\\app\\', tree: DASH_FEATURE_TREE, overview: null, bugs: [] }).project).toBe('app')
  })

  test('no overview gives noFile, no stamp, and no listed row', () => {
    const view = buildProject({ root: ROOT, tree: DASH_FEATURE_TREE, overview: null, bugs: [] })

    expect(view.source).toBe('noFile')
    expect(view.updated).toBeNull()
    expect(view.rows.every(row => !row.isListed)).toBe(true)
  })

  test('an overview with no table gives noTable', () => {
    const view = buildProject({ root: ROOT, tree: DASH_FEATURE_TREE, overview: '# Overview\n', bugs: [] })

    expect(view.source).toBe('noTable')
    expect(view.rows.map(row => row.name)).toEqual(['demo', 'notes', 'shop'])
  })

  test('an overview with a table gives table and the Last Updated value', () => {
    expect(PROJECT.source).toBe('table')
    expect(PROJECT.updated).toBe('2026-10-05')
  })
})

describe('project view: folders and rows', () => {
  test('the folders are the top folders A to Z, with isEpic', () => {
    expect(PROJECT.folders).toEqual([
      { name: 'demo', isEpic: false },
      { name: 'notes', isEpic: false },
      { name: 'shop', isEpic: true },
    ])
  })

  test('the folders sort A to Z when the tree does not', () => {
    const tree: FeatureTree = { exists: true, top: [...DASH_FEATURE_TREE.top].reverse() }

    expect(buildProject({ root: ROOT, tree, overview: null, bugs: [] }).folders.map(folder => folder.name)).toEqual([
      'demo',
      'notes',
      'shop',
    ])
  })

  test('a listed row follows the table order, with the kind, status, and progress', () => {
    expect(PROJECT.rows.slice(0, 3)).toEqual([
      {
        name: 'shop',
        path: 'shop',
        kind: 'epic',
        status: 'In Progress',
        progress: { done: 1, total: 4 },
        isListed: true,
      },
      { name: 'demo', path: 'demo', kind: 'feature', status: 'Complete', progress: { done: 3, total: 3 }, isListed: true },
      { name: 'ghost', path: 'ghost', kind: 'missing', status: 'Planned', progress: null, isListed: true },
    ])
  })

  test('a top folder that the table does not name gives an unlisted row at the end', () => {
    expect(PROJECT.rows[3]).toEqual({
      name: 'notes',
      path: 'notes',
      kind: 'feature',
      status: null,
      progress: null,
      isListed: false,
    })
    expect(PROJECT.rows.length).toBe(4)
  })

  test('the unlisted rows are A to Z, and an unlisted epic keeps its kind', () => {
    const view = buildProject({ root: ROOT, tree: DASH_FEATURE_TREE, overview: null, bugs: [] })

    expect(view.rows.map(row => `${row.name}:${row.kind}`)).toEqual(['demo:feature', 'notes:feature', 'shop:epic'])
  })

  test('a table row with an empty status cell gives a null status', () => {
    const overview = '| Feature | Status | Tasks |\n|---|---|---|\n| demo |  | 1/2 |\n'
    const view = buildProject({ root: ROOT, tree: DASH_FEATURE_TREE, overview, bugs: [] })

    expect(view.rows[0]?.status).toBeNull()
    expect(view.rows[0]?.progress).toEqual({ done: 1, total: 2 })
  })
})

describe('project view: links, bugs, and counts', () => {
  test('a plain folder links to itself, and an epic to itself', () => {
    expect(PROJECT.links.demo).toBe('demo')
    expect(PROJECT.links.notes).toBe('notes')
    expect(PROJECT.links.shop).toBe('shop')
  })

  test('a child links by its path to the epic, and by its bare name when it resolves', () => {
    expect(PROJECT.links['shop/cart']).toBe('shop')
    expect(PROJECT.links.cart).toBe('shop')
  })

  test('a bare child name that a top folder shadows gives no link', () => {
    const tree: FeatureTree = {
      exists: true,
      top: [
        { name: 'cart', files: [], tasksMtime: 0, children: [] },
        {
          name: 'shop',
          files: ['epic-overview.md'],
          tasksMtime: 0,
          children: [{ name: 'cart', files: [], tasksMtime: 0 }],
        },
      ],
    }
    const view = buildProject({ root: ROOT, tree, overview: null, bugs: [] })

    expect(view.links.cart).toBe('cart')
    expect(view.links['shop/cart']).toBe('shop')
  })

  test('a bare child name in two epics gives no link', () => {
    const child = { name: 'base', files: [], tasksMtime: 0 }
    const tree: FeatureTree = {
      exists: true,
      top: [
        { name: 'a', files: ['epic-overview.md'], tasksMtime: 0, children: [child] },
        { name: 'b', files: ['epic-overview.md'], tasksMtime: 0, children: [child] },
      ],
    }
    const view = buildProject({ root: ROOT, tree, overview: null, bugs: [] })

    expect(view.links).toEqual({ a: 'a', 'a/base': 'a', b: 'b', 'b/base': 'b' })
  })

  test('an open bug with a linked feature gives a ref, A to Z by file', () => {
    expect(PROJECT.bugs).toEqual([
      { file: 'BUG-001.md', row: 'shop' },
      { file: 'BUG-003.md', row: 'demo' },
    ])
  })

  test('a closed bug gives no ref', () => {
    expect(PROJECT.bugs.some(ref => ref.file === 'BUG-002.md')).toBe(false)
  })

  test('a bug whose link is no key of links gives no ref', () => {
    const bug = { file: 'BUG-009.md', text: '---\nlinkedFeature: ghost\nstatus: open\n---\n' }
    const view = buildProject({ root: ROOT, tree: DASH_FEATURE_TREE, overview: DASH_OVERVIEW, bugs: [bug] })

    expect(view.bugs).toEqual([])
  })

  test('a link such as constructor is no key of links', () => {
    const bug = { file: 'BUG-009.md', text: '---\nlinkedFeature: constructor\n---\n' }

    expect(buildProject({ root: ROOT, tree: DASH_FEATURE_TREE, overview: null, bugs: [bug] }).bugs).toEqual([])
  })

  test('a file that is no bug file or has no frontmatter gives no ref', () => {
    const bugs = [
      { file: 'notes.md', text: '---\nlinkedFeature: demo\n---\n' },
      { file: 'BUG-010.md', text: 'no frontmatter' },
    ]

    expect(buildProject({ root: ROOT, tree: DASH_FEATURE_TREE, overview: null, bugs }).bugs).toEqual([])
  })

  test('the count of a row is the number of refs on its path', () => {
    expect(openCount(PROJECT.bugs, 'shop')).toBe(1)
    expect(openCount(PROJECT.bugs, 'demo')).toBe(1)
    expect(openCount(PROJECT.bugs, 'notes')).toBe(0)
    expect(openCount(PROJECT.bugs, 'ghost')).toBe(0)
  })
})

describe('epic view', () => {
  test('the children are the child folders A to Z, with no moodboard', () => {
    const tree: FeatureTree = {
      exists: true,
      top: [
        {
          name: 'web',
          files: ['epic-overview.md'],
          tasksMtime: 0,
          children: [
            { name: 'ux', files: [], tasksMtime: 0 },
            { name: 'moodboard', files: [], tasksMtime: 0 },
            { name: 'base', files: [], tasksMtime: 0 },
          ],
        },
      ],
    }

    expect(buildEpic({ tree, epic: 'web', text: null, bugs: [] }).children).toEqual(['base', 'ux'])
  })

  test('the status comes from epic-overview.md, or is null', () => {
    expect(EPIC.status).toBe('🟡 In Progress')
    expect(buildEpic({ tree: DASH_FEATURE_TREE, epic: 'shop', text: '# Shop\n', bugs: [] }).status).toBeNull()
  })

  test('the source and the stamp come from the Features table', () => {
    expect(EPIC.source).toBe('table')
    expect(EPIC.updated).toBe('2026-10-05 07:57')
    expect(buildEpic({ tree: DASH_FEATURE_TREE, epic: 'shop', text: '# Shop\n', bugs: [] }).source).toBe('noTable')
    expect(buildEpic({ tree: DASH_FEATURE_TREE, epic: 'shop', text: null, bugs: [] }).source).toBe('noTable')
  })

  test('a listed row follows the table order, with a path of epic and name', () => {
    expect(EPIC.rows).toEqual([
      {
        name: 'cart',
        path: 'shop/cart',
        kind: 'feature',
        status: 'In Progress',
        progress: { done: 1, total: 4 },
        isListed: true,
      },
      { name: 'checkout', path: 'shop/checkout', kind: 'missing', status: 'Planned', progress: null, isListed: true },
    ])
  })

  test('a child folder that no table row names gives an unlisted row at the end', () => {
    const view = buildEpic({ tree: DASH_FEATURE_TREE, epic: 'shop', text: '# Shop\n', bugs: [] })

    expect(view.rows).toEqual([
      { name: 'cart', path: 'shop/cart', kind: 'feature', status: null, progress: null, isListed: false },
    ])
  })

  test('a leading epic prefix in a Feature cell is removed', () => {
    const text = '| Feature | Status |\n|---|---|\n| shop/cart | Done |\n'

    expect(buildEpic({ tree: DASH_FEATURE_TREE, epic: 'shop', text, bugs: [] }).rows[0]?.path).toBe('shop/cart')
  })

  test('the links hold each child by its path and by its bare name', () => {
    expect(EPIC.links).toEqual({ 'shop/cart': 'shop/cart', cart: 'shop/cart' })
  })

  test('a bug of a child counts on the child row, and a bug of the whole epic counts on no row', () => {
    const whole = { file: 'BUG-007.md', text: '---\nlinkedFeature: shop\n---\n' }
    const view = buildEpic({ tree: DASH_FEATURE_TREE, epic: 'shop', text: DASH_EPIC_OVERVIEW, bugs: [...BUGS, whole] })

    expect(view.bugs).toEqual([{ file: 'BUG-001.md', row: 'shop/cart' }])
    expect(openCount(view.bugs, 'shop/cart')).toBe(1)
    expect(openCount(view.bugs, 'shop/checkout')).toBe(0)
  })

  test('an epic that the tree does not hold gives no child', () => {
    expect(buildEpic({ tree: DASH_FEATURE_TREE, epic: 'gone', text: null, bugs: [] }).children).toEqual([])
  })
})

describe('feature view', () => {
  test('the feature is the view with the tasks applied', () => {
    expect(FEATURE.feature.progress).toBe('1/4 tasks complete (25%)')
    expect(FEATURE.feature.phase?.title).toBe('Phase 2: The view')
  })

  test('a null tasks text gives the view as it is, no phase, and none open', () => {
    const view = featureView()
    const built = buildFeature(view, null)

    expect(built).toEqual({ kind: 'feature', feature: view, phases: [], expanded: [] })
  })

  test('the phases are the parsed phases', () => {
    expect(FEATURE.phases.map(phase => phase.title)).toEqual(['Phase 1: The model', 'Phase 2: The view'])
    expect(FEATURE.phases[1]).toEqual({
      title: 'Phase 2: The view',
      done: 0,
      total: 3,
      tasks: [
        { title: '2.1 Draw the cart row', isDone: false },
        { title: '⏸️ 2.2 Draw the total (waits for a person)', isDone: false },
        { title: '2.3 Draw the empty state', isDone: false },
      ],
    })
  })

  test('the current phase is the first one with an open task', () => {
    expect(FEATURE.expanded).toEqual([1])
  })

  test('with every task done the last phase is open', () => {
    const text = doc('## Phase 1: A', '- [x] one', '', '## Phase 2: B', '- [x] two')

    expect(buildFeature(featureView(), text).expanded).toEqual([1])
  })

  test('a tasks text with no phase opens none', () => {
    expect(buildFeature(featureView(), '# Tasks\n').expanded).toEqual([])
    expect(buildFeature(featureView(), '').expanded).toEqual([])
  })
})

describe('bug view', () => {
  test('a document gives its id, title, shown fields, and body', () => {
    expect(BUG).toEqual({
      kind: 'bug',
      file: 'BUG-001.md',
      id: 'BUG-001',
      title: 'The "Total" row overflows',
      fields: [
        { key: 'status', value: 'open' },
        { key: 'priority', value: 'high' },
        { key: 'linkedFeature', value: 'cart' },
      ],
      body: 'The total row is too wide.',
      note: null,
    })
  })

  test('a text with no frontmatter gives the file name and a note', () => {
    expect(buildBugView('BUG-009.md', 'Plain text.')).toEqual({
      kind: 'bug',
      file: 'BUG-009.md',
      id: 'BUG-009',
      title: 'BUG-009',
      fields: [],
      body: '',
      note: 'No frontmatter in docs/bugs/BUG-009.md.',
    })
  })

  test('an empty text gives the same note', () => {
    expect(buildBugView('BUG-009.md', '').note).toBe('No frontmatter in docs/bugs/BUG-009.md.')
  })
})

describe('patches', () => {
  test('withOverview replaces the rows, the source, and the stamp, and it keeps the folders and the links', () => {
    const text = '**Last Updated:** 2026-10-06\n\n| Feature | Status | Tasks |\n|---|---|---|\n| notes | Done | 2/2 |\n'
    const next = withOverview(PROJECT, text)

    expect(next.updated).toBe('2026-10-06')
    expect(next.rows.map(row => `${row.name}:${row.isListed}`)).toEqual(['notes:true', 'demo:false', 'shop:false'])
    expect(next.rows[0]?.progress).toEqual({ done: 2, total: 2 })
    expect(next.folders).toBe(PROJECT.folders)
    expect(next.links).toBe(PROJECT.links)
    expect(next.bugs).toBe(PROJECT.bugs)
  })

  test('withOverview with a null text gives noFile', () => {
    const next = withOverview(PROJECT, null)

    expect(next.source).toBe('noFile')
    expect(next.updated).toBeNull()
    expect(next.rows.every(row => !row.isListed)).toBe(true)
  })

  test('withOverview with a text that holds no table gives noTable', () => {
    expect(withOverview(PROJECT, '# Overview\n').source).toBe('noTable')
  })

  test('withOverview with the same text changes no data', () => {
    expect(sameData(withOverview(PROJECT, DASH_OVERVIEW), PROJECT)).toBe(true)
  })

  test('withEpicOverview replaces the status, the stamp, and the rows, and it keeps the children', () => {
    const text = [
      '**Status:** Complete',
      '**Last Updated:** 2026-10-06 09:00',
      '',
      '| Feature | Status | Tasks |',
      '|---|---|---|',
      '| cart | Complete | 4/4 |',
    ].join('\n')
    const next = withEpicOverview(EPIC, text)

    expect(next.status).toBe('Complete')
    expect(next.updated).toBe('2026-10-06 09:00')
    expect(next.rows).toEqual([
      {
        name: 'cart',
        path: 'shop/cart',
        kind: 'feature',
        status: 'Complete',
        progress: { done: 4, total: 4 },
        isListed: true,
      },
    ])
    expect(next.children).toBe(EPIC.children)
    expect(next.links).toBe(EPIC.links)
  })

  test('withEpicOverview with a null text gives no status and noTable', () => {
    const next = withEpicOverview(EPIC, null)

    expect(next.status).toBeNull()
    expect(next.source).toBe('noTable')
  })

  test('withEpicOverview with the same text changes no data', () => {
    expect(sameData(withEpicOverview(EPIC, DASH_EPIC_OVERVIEW), EPIC)).toBe(true)
  })

  test('withBugRef adds the ref of a new open bug with a stored link', () => {
    const next = withBugRef(PROJECT, 'BUG-004.md', '---\nlinkedFeature: notes\nstatus: open\n---\n')

    expect(next.bugs).toEqual([
      { file: 'BUG-001.md', row: 'shop' },
      { file: 'BUG-003.md', row: 'demo' },
      { file: 'BUG-004.md', row: 'notes' },
    ])
  })

  test('withBugRef removes the ref when the bug closes', () => {
    const next = withBugRef(PROJECT, 'BUG-001.md', BUG_001.replace('status: open', 'status: closed'))

    expect(next.bugs).toEqual([{ file: 'BUG-003.md', row: 'demo' }])
  })

  test('withBugRef moves the ref when the link changes', () => {
    const next = withBugRef(PROJECT, 'BUG-001.md', BUG_001.replace('linkedFeature: cart', 'linkedFeature: notes'))

    expect(next.bugs[0]).toEqual({ file: 'BUG-001.md', row: 'notes' })
  })

  test('withBugRef removes the ref when the new link is no key', () => {
    const next = withBugRef(PROJECT, 'BUG-001.md', BUG_001.replace('linkedFeature: cart', 'linkedFeature: ghost'))

    expect(next.bugs).toEqual([{ file: 'BUG-003.md', row: 'demo' }])
  })

  test('withBugRef removes the ref when the file is gone, or holds no frontmatter', () => {
    expect(withBugRef(PROJECT, 'BUG-001.md', null).bugs).toEqual([{ file: 'BUG-003.md', row: 'demo' }])
    expect(withBugRef(PROJECT, 'BUG-001.md', 'plain').bugs).toEqual([{ file: 'BUG-003.md', row: 'demo' }])
  })

  test('withBugRef on the epic view uses the stored links of the epic', () => {
    const next = withBugRef(EPIC, 'BUG-004.md', '---\nlinkedFeature: shop/cart\n---\n')

    expect(next.bugs).toEqual([
      { file: 'BUG-001.md', row: 'shop/cart' },
      { file: 'BUG-004.md', row: 'shop/cart' },
    ])
  })

  test('withBugRef with the same text changes no data', () => {
    expect(sameData(withBugRef(PROJECT, 'BUG-001.md', BUG_001), PROJECT)).toBe(true)
  })

  test('withBugRef ignores a file that is no bug file', () => {
    expect(sameData(withBugRef(PROJECT, 'notes.md', '---\nlinkedFeature: demo\n---\n'), PROJECT)).toBe(true)
  })

  const TWO = (first: string, second: string) =>
    doc('## Phase 1: A', `- [${first}] one`, '', '## Phase 2: B', `- [${second}] two`, '', '## Phase 3: C', '- [ ] three')

  test('withFeatureTasks applies the new text and keeps the open phases that still exist', () => {
    const start = { ...buildFeature(featureView(), TWO(' ', ' ')), expanded: [0, 2] }
    const next = withFeatureTasks(start, TWO(' ', 'x'))

    expect(next.feature.progress).toBe('1/3 tasks complete (33%)')
    expect(next.expanded).toEqual([0, 2])
  })

  test('withFeatureTasks opens the next phase when the last task of a phase gets ticked', () => {
    const start = buildFeature(featureView(), TWO(' ', ' '))

    expect(start.expanded).toEqual([0])
    expect(withFeatureTasks(start, TWO('x', ' ')).expanded).toEqual([0, 1])
  })

  test('withFeatureTasks adds nothing when the current phase did not change', () => {
    const start = buildFeature(featureView(), TWO(' ', ' '))

    expect(withFeatureTasks(start, TWO(' ', 'x')).expanded).toEqual([0])
  })

  test('withFeatureTasks drops an index that no phase holds', () => {
    const start = { ...buildFeature(featureView(), TWO(' ', ' ')), expanded: [0, 2] }
    const next = withFeatureTasks(start, doc('## Phase 1: A', '- [ ] one'))

    expect(next.expanded).toEqual([0])
    expect(next.phases.length).toBe(1)
  })

  test('withFeatureTasks with no phase opens none', () => {
    expect(withFeatureTasks(FEATURE, '# Tasks\n').expanded).toEqual([])
  })

  test('withFeatureTasks with the same text changes no data', () => {
    expect(sameData(withFeatureTasks(FEATURE, DASH_CART_TASKS), FEATURE)).toBe(true)
  })

  test('withBugDoc rebuilds the bug view from the new text', () => {
    const next = withBugDoc(BUG, BUG_001.replace('status: open', 'status: closed'))

    expect(next.fields[0]).toEqual({ key: 'status', value: 'closed' })
    expect(next.file).toBe('BUG-001.md')
  })

  test('withBugDoc with a text that holds no frontmatter gives the note', () => {
    expect(withBugDoc(BUG, 'gone').note).toBe('No frontmatter in docs/bugs/BUG-001.md.')
  })

  test('withBugDoc with the same text changes no data', () => {
    expect(sameData(withBugDoc(BUG, BUG_001), BUG)).toBe(true)
  })
})

describe('sameData', () => {
  test('two primitives compare by value', () => {
    expect(sameData(1, 1)).toBe(true)
    expect(sameData('a', 'a')).toBe(true)
    expect(sameData(null, null)).toBe(true)
    expect(sameData(1, 2)).toBe(false)
    expect(sameData(null, undefined)).toBe(false)
    expect(sameData(1, '1')).toBe(false)
  })

  test('two objects compare with no regard to the order of keys', () => {
    expect(sameData({ a: 1, b: { c: [1, 2] } }, { b: { c: [1, 2] }, a: 1 })).toBe(true)
  })

  test('an array compares in order', () => {
    expect(sameData([1, 2], [2, 1])).toBe(false)
    expect(sameData([1], [1, 2])).toBe(false)
  })

  test('a different key set is a different value', () => {
    expect(sameData({ a: 1 }, { a: 1, b: 2 })).toBe(false)
    expect(sameData({ a: 1, b: undefined }, { a: 1, c: undefined })).toBe(false)
  })

  test('an array is no object', () => {
    expect(sameData([], {})).toBe(false)
    expect(sameData({}, [])).toBe(false)
  })

  test('a changed depth value is a different value', () => {
    expect(sameData(PROJECT, { ...PROJECT, rows: [] })).toBe(false)
  })
})

describe('classifyDashboardEdit', () => {
  const GOOD = `${ROOT}/docs/features/shop/cart`

  test('project: docs/overview.md gives overview', () => {
    expect(classifyDashboardEdit(`${ROOT}/docs/overview.md`, PROJECT_STATE)).toBe('overview')
  })

  test('project: a bug file gives bugRef', () => {
    expect(classifyDashboardEdit(`${ROOT}/docs/bugs/BUG-009.md`, PROJECT_STATE)).toBe('bugRef')
  })

  test('epic: a bug file gives bugRef', () => {
    expect(classifyDashboardEdit(`${ROOT}/docs/bugs/BUG-009.md`, EPIC_STATE)).toBe('bugRef')
  })

  test('epic: the epic-overview.md of the shown epic gives epicOverview', () => {
    expect(classifyDashboardEdit(`${ROOT}/docs/features/shop/epic-overview.md`, EPIC_STATE)).toBe('epicOverview')
  })

  test('feature: tasks.md gives tasks', () => {
    expect(classifyDashboardEdit(`${GOOD}/tasks.md`, FEATURE_STATE)).toBe('tasks')
  })

  test('feature: context.md and implementation.md give status', () => {
    expect(classifyDashboardEdit(`${GOOD}/context.md`, FEATURE_STATE)).toBe('status')
    expect(classifyDashboardEdit(`${GOOD}/implementation.md`, FEATURE_STATE)).toBe('status')
  })

  test('feature: a bug file gives featureBug', () => {
    expect(classifyDashboardEdit(`${ROOT}/docs/bugs/BUG-001.md`, FEATURE_STATE)).toBe('featureBug')
  })

  test('bug: the shown bug file gives bugDoc', () => {
    expect(classifyDashboardEdit(`${ROOT}/docs/bugs/BUG-001.md`, BUG_STATE)).toBe('bugDoc')
  })

  test('any other path gives null', () => {
    for (const state of [PROJECT_STATE, EPIC_STATE, FEATURE_STATE, BUG_STATE]) {
      expect(classifyDashboardEdit(`${ROOT}/src/index.ts`, state)).toBeNull()
    }
  })

  test('project and epic: an edit of tasks.md moves nothing', () => {
    expect(classifyDashboardEdit(`${GOOD}/tasks.md`, PROJECT_STATE)).toBeNull()
    expect(classifyDashboardEdit(`${GOOD}/tasks.md`, EPIC_STATE)).toBeNull()
  })

  test('project: an epic-overview.md gives null, and epic: docs/overview.md gives null', () => {
    expect(classifyDashboardEdit(`${ROOT}/docs/features/shop/epic-overview.md`, PROJECT_STATE)).toBeNull()
    expect(classifyDashboardEdit(`${ROOT}/docs/overview.md`, EPIC_STATE)).toBeNull()
  })

  test('epic: the epic-overview.md of another epic gives null', () => {
    expect(classifyDashboardEdit(`${ROOT}/docs/features/other/epic-overview.md`, EPIC_STATE)).toBeNull()
  })

  test('bug: another bug file gives null', () => {
    expect(classifyDashboardEdit(`${ROOT}/docs/bugs/BUG-003.md`, BUG_STATE)).toBeNull()
  })

  test('a name that is no bug file, or a nested path, gives null', () => {
    expect(classifyDashboardEdit(`${ROOT}/docs/bugs/notes.md`, PROJECT_STATE)).toBeNull()
    expect(classifyDashboardEdit(`${ROOT}/docs/bugs/old/BUG-001.md`, PROJECT_STATE)).toBeNull()
  })

  test('the path is normalized: a backslash, a relative path, and a dot segment', () => {
    expect(classifyDashboardEdit('docs/overview.md', PROJECT_STATE)).toBe('overview')
    expect(classifyDashboardEdit(`${ROOT}/docs/./features/../overview.md`, PROJECT_STATE)).toBe('overview')
    expect(classifyDashboardEdit(`${ROOT}\\docs\\overview.md`, PROJECT_STATE)).toBe('overview')
  })

  test('an empty path gives null', () => {
    expect(classifyDashboardEdit('', PROJECT_STATE)).toBeNull()
  })
})

describe('the name cases of the status table', () => {
  for (const [cell, epic, name] of NAME_CASES) {
    test(`rowName(${JSON.stringify(cell)}, ${JSON.stringify(epic)})`, () => {
      expect(rowName(cell, epic)).toBe(name)
    })
  }
})

describe('no throw on an empty string', () => {
  test('every builder and patch takes an empty text', () => {
    expect(buildProject({ root: '', tree: { exists: false, top: [] }, overview: '', bugs: [{ file: '', text: '' }] }).rows).toEqual([])
    expect(buildEpic({ tree: { exists: false, top: [] }, epic: '', text: '', bugs: [] }).children).toEqual([])
    expect(withOverview(PROJECT, '').source).toBe('noTable')
    expect(withEpicOverview(EPIC, '').source).toBe('noTable')
    expect(withBugRef(PROJECT, '', '').bugs.length).toBe(2)
    expect(withFeatureTasks(FEATURE, '').phases).toEqual([])
    expect(withBugDoc(BUG, '').note).not.toBeNull()
  })
})
