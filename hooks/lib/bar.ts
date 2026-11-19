// The bar model and its two renders. Pure: no file here calls `$`. Never throws.

export const BAR_CELLS = 10

export type BarModel = {
  /** Filled cells, from 0 to `cells`. */
  filled: number
  /** The share done, from 0 to 1. */
  ratio: number
  /** The percent done, from 0 to 100. */
  pct: number
}

const SVG_WIDTH = 80
const SVG_HEIGHT = 8

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

/**
 * The bar model of `done` of `total`. A started item never shows an empty
 * bar, and an open item never shows a full bar or `100%`.
 *
 * @example bar(1, 4) // { filled: 3, ratio: 0.25, pct: 25 }
 */
export function bar(done: number, total: number, cells: number = BAR_CELLS): BarModel {
  if (!(total > 0) || !(done > 0)) {
    return { filled: 0, ratio: 0, pct: 0 }
  }

  if (done >= total) {
    return { filled: cells, ratio: 1, pct: 100 }
  }

  const share = done / total

  return {
    filled: clamp(Math.round(share * cells), 1, cells - 1),
    ratio: clamp(share, 0.01, 0.99),
    pct: clamp(Math.round(share * 100), 1, 99),
  }
}

/**
 * The text bar: `filled` times `█`, then the rest of the cells as `░`.
 *
 * @example barText(bar(1, 4)) // '███░░░░░░░'
 */
export function barText(model: BarModel, cells: number = BAR_CELLS): string {
  const filled = clamp(Math.round(model.filled), 0, cells)

  return '█'.repeat(filled) + '░'.repeat(cells - filled)
}

/**
 * The SVG bar of 80 by 8 CSS pixels. The second rect is `round(ratio × 80)`
 * wide and is left out when `ratio` is 0. Always under 400 characters.
 */
export function barSvg(model: BarModel): string {
  const width = clamp(Math.round(model.ratio * SVG_WIDTH), 0, SVG_WIDTH)
  const track = `<rect width="${SVG_WIDTH}" height="${SVG_HEIGHT}" rx="2" fill="#8b949e" fill-opacity="0.35"/>`
  const fill = model.ratio > 0 ? `<rect width="${width}" height="${SVG_HEIGHT}" rx="2" fill="#2ea043"/>` : ''

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SVG_WIDTH}" height="${SVG_HEIGHT}" viewBox="0 0 ${SVG_WIDTH} ${SVG_HEIGHT}">${track}${fill}</svg>`
}
