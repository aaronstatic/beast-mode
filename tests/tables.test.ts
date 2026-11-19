import { describe, expect, test } from 'claude-code/testing'
import { cellText, parseStatusTable, progressOf, rowName } from '../hooks/lib/tables'

const HEAD = '| Feature | Status | Tasks | Notes |\n|---------|--------|-------|-------|\n'

describe('status table: header', () => {
  test('the header of docs/overview.md parses', () => {
    const table = parseStatusTable(`${HEAD}| a | Done | 1/1 | n |\n`)

    expect(table.hasTable).toBe(true)
    expect(table.rows).toEqual([{ name: 'a', status: 'Done', tasks: '1/1' }])
  })

  test('the epic header with a number column parses', () => {
    const text = '| # | Feature | Status | Tasks | Description |\n|---|---|---|---|---|\n| 1 | base | Done | 3/3 | x |\n'

    expect(parseStatusTable(text).rows).toEqual([{ name: 'base', status: 'Done', tasks: '3/3' }])
  })

  test('the Feature and Status cells match with no case match', () => {
    const table = parseStatusTable('| FEATURE | status |\n|---|---|\n| a | Done |\n')

    expect(table.rows).toEqual([{ name: 'a', status: 'Done', tasks: null }])
  })

  test('a pipe line with no separator row next is no header', () => {
    expect(parseStatusTable('| Feature | Status |\n| a | Done |\n').hasTable).toBe(false)
  })

  test('a separator row holds cells of dash, colon, and space only', () => {
    expect(parseStatusTable('| Feature | Status |\n|:---|---:|\n| a | Done |\n').hasTable).toBe(true)
    expect(parseStatusTable('| Feature | Status |\n| x | y |\n| a | Done |\n').hasTable).toBe(false)
  })

  test('an earlier table with no Feature cell is passed over', () => {
    const text = `| Decision | Choice |\n|---|---|\n| Runtime | Bun |\n\n${HEAD}| a | Done | 1/1 | n |\n`

    expect(parseStatusTable(text).rows.map(row => row.name)).toEqual(['a'])
  })
})

describe('status table: cells and columns', () => {
  test('an empty first piece and an empty last piece drop', () => {
    expect(parseStatusTable('| Feature | Status |\n|---|---|\n| a | Done |\n').rows[0]).toEqual({
      name: 'a',
      status: 'Done',
      tasks: null,
    })
  })

  test('an empty cell in the middle keeps its column', () => {
    const table = parseStatusTable(`${HEAD}| a | | 2/3 | n |\n`)

    expect(table.rows[0]).toEqual({ name: 'a', status: '', tasks: '2/3' })
  })

  test('a pipe with a backslash before it stays inside the cell', () => {
    const table = parseStatusTable(`${HEAD}| a | Done \\| Ready | 1/1 | n |\n`)

    expect(table.rows[0]?.status).toBe('Done | Ready')
  })

  test('columns follow the header, in any order', () => {
    const table = parseStatusTable('| Tasks | Status | Feature |\n|---|---|---|\n| 1/2 | Open | a |\n')

    expect(table.rows).toEqual([{ name: 'a', status: 'Open', tasks: '1/2' }])
  })

  test('a table with no Tasks cell gives a null tasks', () => {
    expect(parseStatusTable('| Feature | Status |\n|---|---|\n| a | Done |\n').rows[0]?.tasks).toBeNull()
  })

  test('a row with fewer cells gives a null status and a null tasks', () => {
    expect(parseStatusTable(`${HEAD}| a |\n`).rows[0]).toEqual({ name: 'a', status: null, tasks: null })
  })
})

describe('status table: rows', () => {
  test('the first line that is no pipe line ends the table', () => {
    const table = parseStatusTable(`${HEAD}| a | Done | 1/1 | n |\n\n| b | Done | 1/1 | n |\n`)

    expect(table.rows.map(row => row.name)).toEqual(['a'])
  })

  test('only the first table counts', () => {
    const text = `${HEAD}| a | Done | 1/1 | n |\n\n${HEAD}| b | Done | 1/1 | n |\n`

    expect(parseStatusTable(text).rows.map(row => row.name)).toEqual(['a'])
  })

  test('a table inside a fence does not count', () => {
    expect(parseStatusTable(`\`\`\`\n${HEAD}| a | Done | 1/1 | n |\n\`\`\`\n`).hasTable).toBe(false)
  })

  test('a row with an empty name is skipped', () => {
    const table = parseStatusTable(`${HEAD}|  | Done | 1/1 | n |\n| a | Done | 1/1 | n |\n`)

    expect(table.rows.map(row => row.name)).toEqual(['a'])
  })

  test('a repeated name is skipped, and the first row wins', () => {
    const table = parseStatusTable(`${HEAD}| a | Open | 1/2 | n |\n| a | Done | 2/2 | n |\n`)

    expect(table.rows).toEqual([{ name: 'a', status: 'Open', tasks: '1/2' }])
  })

  test('the emoji of a status stays', () => {
    expect(parseStatusTable(`${HEAD}| a | 🟡 In Progress | 1/2 | n |\n`).rows[0]?.status).toBe('🟡 In Progress')
  })

  test('a control character of a cell is removed', () => {
    expect(parseStatusTable(`${HEAD}| a | Do\u0000ne | 1/2 | n |\n`).rows[0]?.status).toBe('Done')
  })

  test('the name `claude-code (epic)` gives `claude-code`', () => {
    expect(parseStatusTable(`${HEAD}| claude-code (epic) | In Progress | 1/2 | n |\n`).rows[0]?.name).toBe('claude-code')
  })

  test('an epic table removes the leading `<epic>/` of a name', () => {
    const text = '| Feature | Status |\n|---|---|\n| editor/base | Done |\n| ux | Open |\n'

    expect(parseStatusTable(text, 'editor').rows.map(row => row.name)).toEqual(['base', 'ux'])
    expect(parseStatusTable(text).rows.map(row => row.name)).toEqual(['editor/base', 'ux'])
  })
})

describe('status table: no table', () => {
  test('a file with no Feature header gives hasTable false and no row', () => {
    expect(parseStatusTable('# Title\n\nSome text.\n')).toEqual({ hasTable: false, rows: [] })
  })

  test('an empty string gives hasTable false and never throws', () => {
    expect(parseStatusTable('')).toEqual({ hasTable: false, rows: [] })
  })

  test('a header with no Status cell gives hasTable false', () => {
    expect(parseStatusTable('| Feature | Notes |\n|---|---|\n| a | x |\n').hasTable).toBe(false)
  })
})

describe('cellText and rowName', () => {
  test('removes the bold marks and the backticks', () => {
    expect(cellText('**Epic** `x`')).toBe('Epic x')
  })

  test('a link becomes its text', () => {
    expect(cellText('[docs](https://example.com/a)')).toBe('docs')
  })

  test('removes the backslash of a markdown escape and trims', () => {
    expect(cellText('  a\\_b \\*c  ')).toBe('a_b *c')
  })

  test('keeps an emoji and removes the control characters', () => {
    expect(cellText('🟡 In\u0007 Progress')).toBe('🟡 In Progress')
  })

  test('an empty string gives an empty string', () => {
    expect(cellText('')).toBe('')
  })

  test('rowName removes a trailing epic mark with no case match, then one slash', () => {
    expect(rowName('`web-app` (EPIC)')).toBe('web-app')
    expect(rowName('web-app/')).toBe('web-app')
    expect(rowName('web-app//')).toBe('web-app/')
  })

  test('rowName removes the leading epic name only when it is given', () => {
    expect(rowName('editor/base', 'editor')).toBe('base')
    expect(rowName('editor/base')).toBe('editor/base')
  })
})

describe('progress rule', () => {
  test('rule 1: no digit gives null', () => {
    expect(progressOf('—')).toBeNull()
    expect(progressOf('')).toBeNull()
  })

  test('rule 2: the last pair right after an open parenthesis', () => {
    expect(
      progressOf('neutral-core 67/67 + installer-cli 99/99 + dsh-optimization 25/27 (348/357, 97%)'),
    ).toEqual({ done: 348, total: 357 })
  })

  test('rule 2: the last of two such pairs wins', () => {
    expect(progressOf('a (1/2) b (3/4)')).toEqual({ done: 3, total: 4 })
  })

  test('rule 3: one pair and a percent', () => {
    expect(progressOf('130/133 (98%)')).toEqual({ done: 130, total: 133 })
  })

  test('rule 3: the sum of every pair', () => {
    expect(
      progressOf('core 39/39 + webapp-integration 39/39 + autorun-epic 37/42 + 1 planning'),
    ).toEqual({ done: 115, total: 120 })
  })

  test('rule 3: a pair and a count of planning', () => {
    expect(progressOf('75/75 + 3 planning')).toEqual({ done: 75, total: 75 })
  })

  test('rule 4: the last percent', () => {
    expect(progressOf('98%')).toEqual({ done: 98, total: 100 })
    expect(progressOf('10% then 40%')).toEqual({ done: 40, total: 100 })
  })

  test('rule 5: a digit with no pair and no percent gives null', () => {
    expect(progressOf('3 planning')).toBeNull()
  })
})

describe('progress rule: the ten real Tasks cells of docs/overview.md', () => {
  const CELLS: Array<[string, { done: number; total: number } | null]> = [
    ['130/133 (98%)', { done: 130, total: 133 }],
    ['75/75 + 3 planning', { done: 75, total: 75 }],
    ['229/230 (99%)', { done: 229, total: 230 }],
    ['15/15 (100%)', { done: 15, total: 15 }],
    ['46/60 (77%)', { done: 46, total: 60 }],
    ['35/35 (100%)', { done: 35, total: 35 }],
    [
      'core 39/39 + webapp-integration 39/39 + autorun-epic 37/42 + 1 planning',
      { done: 115, total: 120 },
    ],
    [
      'neutral-core 67/67 + installer-cli 99/99 + dsh-plugin 54/54 + multi-harness-project 46/46 + dsh-web-panel 57/64 + dsh-optimization 25/27 (348/357, 97%)',
      { done: 348, total: 357 },
    ],
    ['62/66 (94%)', { done: 62, total: 66 }],
    ['24/25 (96%)', { done: 24, total: 25 }],
  ]

  test('there are ten cells', () => {
    expect(CELLS).toHaveLength(10)
  })

  for (const [cell, expected] of CELLS) {
    test(`${cell.slice(0, 40)} gives ${expected === null ? 'null' : `${expected.done}/${expected.total}`}`, () => {
      expect(progressOf(cell)).toEqual(expected)
    })
  }

  test('parseStatusTable then progressOf reads a real row', () => {
    const text = `${HEAD}| claude-code (epic) | In Progress (1/4 features complete) | 130/133 (98%) | **Epic** |\n`
    const row = parseStatusTable(text).rows[0]

    expect(row?.name).toBe('claude-code')
    expect(progressOf(row?.tasks ?? '')).toEqual({ done: 130, total: 133 })
  })
})
