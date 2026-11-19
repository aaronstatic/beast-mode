import { describe, expect, test } from 'claude-code/testing'
import { BAR_CELLS, bar, barSvg, barText } from '../hooks/lib/bar'

const SVG_QUARTER =
  '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="8" viewBox="0 0 80 8"><rect width="80" height="8" rx="2" fill="#8b949e" fill-opacity="0.35"/><rect width="20" height="8" rx="2" fill="#2ea043"/></svg>'

describe('bar model', () => {
  test('BAR_CELLS is 10', () => {
    expect(BAR_CELLS).toBe(10)
  })

  test('a total of 0 or less, or a done of 0 or less, gives an empty bar', () => {
    expect(bar(0, 3)).toEqual({ filled: 0, ratio: 0, pct: 0 })
    expect(bar(3, 0)).toEqual({ filled: 0, ratio: 0, pct: 0 })
    expect(bar(2, -1)).toEqual({ filled: 0, ratio: 0, pct: 0 })
    expect(bar(-2, 5)).toEqual({ filled: 0, ratio: 0, pct: 0 })
  })

  test('a done of the total or more gives a full bar', () => {
    expect(bar(3, 3)).toEqual({ filled: 10, ratio: 1, pct: 100 })
    expect(bar(5, 3)).toEqual({ filled: 10, ratio: 1, pct: 100 })
  })

  test('the cells argument sets the width of a full bar', () => {
    expect(bar(3, 3, 20).filled).toBe(20)
    expect(bar(1, 2, 20).filled).toBe(10)
  })

  test('a started item shows at least one cell, at least 0.01, and at least 1 percent', () => {
    expect(bar(1, 200)).toEqual({ filled: 1, ratio: 0.01, pct: 1 })
  })

  test('an open item shows at most nine cells, at most 0.99, and at most 99 percent', () => {
    expect(bar(199, 200)).toEqual({ filled: 9, ratio: 0.99, pct: 99 })
  })

  test('NaN gives an empty bar and never throws', () => {
    expect(bar(Number.NaN, Number.NaN)).toEqual({ filled: 0, ratio: 0, pct: 0 })
  })
})

describe('bar model: the table of section 3.5', () => {
  const ROWS: Array<[number, number, number, number]> = [
    [1, 4, 3, 25],
    [3, 3, 10, 100],
    [0, 3, 0, 0],
    [1, 200, 1, 1],
    [199, 200, 9, 99],
    [130, 133, 9, 98],
    [37, 40, 9, 93],
    [5, 3, 10, 100],
    [3, 0, 0, 0],
  ]

  for (const [done, total, filled, pct] of ROWS) {
    test(`${done}/${total} gives ${filled} cells and ${pct} percent`, () => {
      const model = bar(done, total)

      expect(model.filled).toBe(filled)
      expect(model.pct).toBe(pct)
    })
  }
})

describe('bar render', () => {
  test('barText draws the filled run, then the rest', () => {
    expect(barText(bar(1, 4))).toBe('███░░░░░░░')
    expect(barText(bar(3, 3))).toBe('██████████')
    expect(barText(bar(0, 3))).toBe('░░░░░░░░░░')
  })

  test('barText always holds BAR_CELLS characters', () => {
    for (const [done, total] of [[1, 4], [1, 200], [199, 200], [5, 3], [0, 0]] as const) {
      expect([...barText(bar(done, total))]).toHaveLength(BAR_CELLS)
    }
  })

  test('barSvg of 1/4 equals the markup of the plan', () => {
    expect(barSvg(bar(1, 4))).toBe(SVG_QUARTER)
  })

  test('barSvg of an empty bar leaves out the second rect', () => {
    const svg = barSvg(bar(0, 3))

    expect(svg.match(/<rect /g)).toHaveLength(1)
  })

  test('barSvg of a full bar draws a second rect of width 80', () => {
    expect(barSvg(bar(3, 3))).toContain('<rect width="80" height="8" rx="2" fill="#2ea043"/>')
  })

  test('the second rect is round(ratio x 80) wide', () => {
    expect(barSvg(bar(1, 200))).toContain('<rect width="1" height="8" rx="2" fill="#2ea043"/>')
    expect(barSvg(bar(199, 200))).toContain('<rect width="79" height="8" rx="2" fill="#2ea043"/>')
  })

  test('every svg stays under 400 characters', () => {
    for (const [done, total] of [[1, 4], [3, 3], [0, 3], [1, 200], [199, 200], [130, 133], [37, 40], [5, 3], [3, 0]] as const) {
      expect(barSvg(bar(done, total)).length < 400).toBe(true)
    }
  })
})
