import { describe, expect, test } from 'claude-code/testing'
import { headerValue, lines, plainText } from '../hooks/lib/docs'
import { currentPhase, parseTasks, progressText, stampKey } from '../hooks/lib/tasks'
import {
  HEADING_CASES,
  REAL_SHAPES_TASKS,
  ROOT,
  SCRATCH_TREE,
  STAMP_CASES,
  TEMPLATE_TASKS,
  doc,
} from './fixtures'

const CART = SCRATCH_TREE[`${ROOT}/docs/features/shop/cart/tasks.md`] ?? ''
const DEMO = SCRATCH_TREE[`${ROOT}/docs/features/demo/tasks.md`] ?? ''

describe('tasks.md rows: lines', () => {
  test('splits on LF and CRLF', () => {
    expect(lines('a\r\nb\nc')).toEqual(['a', 'b', 'c'])
  })

  test('removes one trailing backslash and the trailing spaces', () => {
    expect(lines('**Progress:** 69/73 tasks complete (95%)\\')).toEqual(['**Progress:** 69/73 tasks complete (95%)'])
    expect(lines('a   \nb \\  \nc\\\\')).toEqual(['a', 'b', 'c\\'])
  })

  test('skips every line inside a backtick fence and a tilde fence', () => {
    expect(lines('a\n```ts\n## Phase 1: x\n```\nb\n~~~\n- [ ] y\n~~~\nc')).toEqual(['a', 'b', 'c'])
  })

  test('a tilde line does not close a backtick fence', () => {
    expect(lines('```\n~~~\nhidden\n```\nshown')).toEqual(['shown'])
  })

  test('an unclosed fence hides the rest', () => {
    expect(lines('a\n```\nb\nc')).toEqual(['a'])
  })

  test('an empty string gives one empty line', () => {
    expect(lines('')).toEqual([''])
  })
})

describe('tasks.md rows: header value', () => {
  test('reads the rest of the first matching line, trimmed', () => {
    expect(headerValue('**Status:** 🟡 In Progress', 'Status')).toBe('🟡 In Progress')
  })

  test('the first line wins', () => {
    expect(headerValue('**Status:** one\n**Status:** two', 'Status')).toBe('one')
  })

  test('reads a value with a trailing backslash through lines()', () => {
    expect(headerValue(CART, 'Progress')).toBe('1/4 tasks complete (25%)')
  })

  test('ignores a header inside a fence', () => {
    expect(headerValue('```\n**Status:** hidden\n```', 'Status')).toBeNull()
  })

  test('gives null for a missing label and for an empty string', () => {
    expect(headerValue('# Title', 'Status')).toBeNull()
    expect(headerValue('', 'Status')).toBeNull()
  })
})

describe('tasks.md rows: stamp key', () => {
  for (const [value, key] of STAMP_CASES) {
    test(`stampKey(${JSON.stringify(value)})`, () => {
      expect(stampKey(value)).toBe(key)
    })
  }

  test('a null value gives null', () => {
    expect(stampKey(null)).toBeNull()
  })

  test('parseTasks reads the stamp from the Last Updated value', () => {
    expect(parseTasks(CART).stampKey).toBe('2026-10-02 10:30')
    expect(parseTasks(DEMO).stampKey).toBe('2026-10-01 09:00')
    expect(parseTasks('# none').stampKey).toBeNull()
  })

  test('keys sort as text, newest last', () => {
    const keys = ['2026-09-23 00:20', '2026-09-18 15:44', '2026-09-18 09:05'].map(k => stampKey(k) ?? '')

    expect([...keys].sort()).toEqual(['2026-09-18 09:05', '2026-09-18 15:44', '2026-09-23 00:20'])
  })
})

describe('tasks.md rows: phase and phase title', () => {
  for (const [heading, title] of HEADING_CASES) {
    test(`heading ${JSON.stringify(heading)}`, () => {
      const phases = parseTasks(doc(heading, '- [ ] **x**')).phases

      expect(phases.map(p => p.title)).toEqual(title === null ? [] : [title])
    })
  }

  test('a phase ends at the next "# " or "## " line', () => {
    const { phases } = parseTasks(
      doc('## Phase 1: A', '- [ ] a', '## Notes', '- [ ] stray', '## Phase 2: B', '- [x] b', '# Top', '- [ ] stray'),
    )

    expect(phases.map(p => [p.title, p.total])).toEqual([['Phase 1: A', 1], ['Phase 2: B', 1]])
  })

  test('a "###" heading does not end a phase', () => {
    const { phases } = parseTasks(doc('## Phase 1: A', '### Sub', '- [ ] a'))

    expect(phases[0]?.total).toBe(1)
  })

  test('a phase heading inside a fence opens no phase', () => {
    expect(parseTasks(doc('```', '## Phase 1: A', '```')).phases).toEqual([])
  })
})

describe('tasks.md rows: task, state, title', () => {
  test('parses a plain box and an escaped box', () => {
    const { phases } = parseTasks(doc('## Phase 1: A', '- [ ] **Task 1 Title**', '- \\[x\\] ✅ **1.1 Write the tool rules file**'))

    expect(phases[0]?.tasks).toEqual([
      { title: 'Task 1 Title', isDone: false },
      { title: '1.1 Write the tool rules file', isDone: true },
    ])
  })

  test('an indented checkbox is no task', () => {
    expect(parseTasks(doc('## Phase 1: A', '- [ ] a', '  - [ ] b', '    - [x] c')).phases[0]?.total).toBe(1)
  })

  test('x and X are done, a space is open, and a cancelled task counts as done', () => {
    const { phases } = parseTasks(doc('## Phase 1: A', '- [x] a', '- [X] b', '- [ ] c', '- [x] ❌ d'))

    expect(phases[0]?.tasks.map(t => t.isDone)).toEqual([true, true, false, true])
    expect(phases[0]).toMatchObject({ done: 3, total: 4 })
  })

  test('a star bullet is a task', () => {
    expect(parseTasks(doc('## Phase 1: A', '* [ ] a')).phases[0]?.total).toBe(1)
  })

  test('the title loses one leading check, the bold marks, the code marks, and the escapes', () => {
    expect(plainText('✅ **8.1 Write the runbook into** `context.md`')).toBe('8.1 Write the runbook into context.md')
    expect(plainText('\\[x\\] done \\*star\\*')).toBe('[x] done *star*')
    expect(plainText('✅ ✅ twice')).toBe('✅ twice')
  })

  test('the title keeps the other marks', () => {
    const { phases } = parseTasks(
      doc(
        '## Phase 8: A',
        '- \\[ \\] ⏸️ **8.3 Run the before measurement on each harness (live, a person)**',
        '- [ ] 🔄 **8.4 Go**',
        '- [x] ❌ **8.5 Drop**',
      ),
    )

    expect(phases[0]?.tasks.map(t => t.title)).toEqual([
      '⏸️ 8.3 Run the before measurement on each harness (live, a person)',
      '🔄 8.4 Go',
      '❌ 8.5 Drop',
    ])
  })

  test('the Task Status Legend and the Bugs & Issues section count in no phase', () => {
    const { phases } = parseTasks(TEMPLATE_TASKS)

    expect(phases.map(p => [p.title, p.done, p.total])).toEqual([['Phase 1: [Phase Name]', 0, 2], ['Phase 2: [Phase Name]', 0, 1]])
  })

  test('the real shapes parse', () => {
    const { phases } = parseTasks(REAL_SHAPES_TASKS)

    expect(phases.map(p => [p.title, p.done, p.total])).toEqual([['Phase 5b: Escaped boxes', 2, 4], ['Phase A: Plain boxes', 0, 1]])
    expect(phases[0]?.tasks[2]?.title).toBe('⏸️ 5b.3 Run the before measurement on each harness (live, a person)')
    expect(phases[1]?.tasks[0]?.title).toBe('A.1 Star bullet with code')
  })

  test('the scratch cart file parses', () => {
    const { phases } = parseTasks(CART)

    expect(phases.map(p => [p.title, p.done, p.total])).toEqual([['Phase 1: The model', 1, 1], ['Phase 2: The view', 0, 3]])
    expect(phases[1]?.tasks[1]).toEqual({ title: '⏸️ 2.2 Draw the total (waits for a person)', isDone: false })
  })
})

describe('tasks.md rows: current phase', () => {
  test('the first phase with an open task', () => {
    expect(currentPhase(parseTasks(CART).phases)?.title).toBe('Phase 2: The view')
    expect(currentPhase(parseTasks(REAL_SHAPES_TASKS).phases)?.title).toBe('Phase 5b: Escaped boxes')
  })

  test('the last phase when every task is done', () => {
    const phases = parseTasks(doc('## Phase 1: A', '- [x] a', '## Phase 2: B', '- [x] b')).phases

    expect(currentPhase(phases)?.title).toBe('Phase 2: B')
    expect(currentPhase(parseTasks(DEMO).phases)?.title).toBe('Phase 1: Setup')
  })

  test('a phase with no task is skipped for one with an open task', () => {
    const phases = parseTasks(doc('## Phase 1: A', '## Phase 2: B', '- [ ] b')).phases

    expect(currentPhase(phases)?.title).toBe('Phase 2: B')
  })

  test('no phase gives null', () => {
    expect(currentPhase([])).toBeNull()
    expect(currentPhase(parseTasks('').phases)).toBeNull()
  })
})

describe('tasks.md rows: progress', () => {
  test('the Progress value wins', () => {
    const parsed = parseTasks(CART)

    expect(parsed.progress).toBe('1/4 tasks complete (25%)')
    expect(progressText(parsed.progress, parsed.phases)).toBe('1/4 tasks complete (25%)')
  })

  test('the computed line, rounded, over every phase', () => {
    const phases = parseTasks(doc('## Phase 1: A', '- [x] a', '- [x] b', '## Phase 2: B', '- [ ] c')).phases

    expect(progressText(null, phases)).toBe('2/3 tasks complete (67%)')
  })

  test('an empty Progress value falls back to the computed line', () => {
    const parsed = parseTasks(doc('**Progress:**', '## Phase 1: A', '- [x] a'))

    expect(parsed.progress).toBeNull()
    expect(progressText(parsed.progress, parsed.phases)).toBe('1/1 tasks complete (100%)')
  })

  test('no task gives 0/0 and 0 percent', () => {
    expect(progressText(null, [])).toBe('0/0 tasks complete (0%)')
  })

  test('the template Progress value reads as is', () => {
    expect(parseTasks(TEMPLATE_TASKS).progress).toBe('0/20 tasks complete (0%)')
  })
})

describe('tasks.md rows: never throws', () => {
  test('an empty string', () => {
    expect(parseTasks('')).toEqual({ stampKey: null, progress: null, phases: [] })
  })

  test('an unknown shape gives no phase', () => {
    const parsed = parseTasks('just some prose\n- [ ] a loose box\n#### odd\n\u0000\r\r')

    expect(parsed.phases).toEqual([])
    expect(currentPhase(parsed.phases)).toBeNull()
  })

  test('every fixture parses', () => {
    for (const text of [...Object.values(SCRATCH_TREE), TEMPLATE_TASKS, REAL_SHAPES_TASKS, CART, DEMO]) {
      expect(parseTasks(text).phases).toBeDefined()
    }
  })
})
