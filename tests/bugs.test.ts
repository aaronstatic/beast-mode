import { describe, expect, test } from 'claude-code/testing'
import { isBugFile, isOpenFor, openBugs, parseBug } from '../hooks/lib/bugs'
import type { ParsedBug } from '../hooks/lib/bugs'
import { BUG_001, BUG_002, BUG_003, BUG_005, ROOT, SCRATCH_TREE, doc } from './fixtures'

function bug(fields: Partial<ParsedBug> = {}): ParsedBug {
  return { id: 'BUG-001', title: 't', status: 'open', linkedFeature: 'cart', file: 'BUG-001.md', ...fields }
}

describe('bug rows: files', () => {
  test('matches BUG-*.md only', () => {
    expect(isBugFile('BUG-001.md')).toBe(true)
    expect(isBugFile('BUG-fix-me.md')).toBe(true)
    expect(isBugFile('BUG-.md')).toBe(false)
    expect(isBugFile('bug-001.md')).toBe(false)
    expect(isBugFile('BUG-001.txt')).toBe(false)
    expect(isBugFile('README.md')).toBe(false)
  })
})

describe('bug rows: frontmatter and fields', () => {
  test('reads the fields between the two --- lines', () => {
    expect(parseBug('BUG-001.md', BUG_001)).toEqual({
      id: 'BUG-001',
      title: 'The "Total" row overflows',
      status: 'open',
      linkedFeature: 'cart',
      file: 'BUG-001.md',
    })
  })

  test('no frontmatter block gives null', () => {
    expect(parseBug('BUG-009.md', '# A title\n\nBody')).toBeNull()
    expect(parseBug('BUG-009.md', '\n---\ntitle: x\n---\n')).toBeNull()
  })

  test('a block with no closing line gives null', () => {
    expect(parseBug('BUG-009.md', '---\ntitle: x\n')).toBeNull()
  })

  test('reads CRLF text', () => {
    expect(parseBug('BUG-009.md', '---\r\nid: BUG-009\r\ntitle: Boom\r\n---\r\n')).toMatchObject({ id: 'BUG-009', title: 'Boom' })
  })

  test('other keys, nested lines, and list lines do not count', () => {
    const parsed = parseBug(
      'BUG-009.md',
      doc('---', 'priority: high', 'meta:', '  title: nested', '  - item', '- title: listed', 'title: Real', '---'),
    )

    expect(parsed).toMatchObject({ title: 'Real' })
    expect(parsed).not.toHaveProperty('priority')
  })

  test('the first line of a key wins, and a key that only starts so is not the key', () => {
    expect(parseBug('BUG-009.md', doc('---', 'title: one', 'title: two', 'titleX: three', '---'))?.title).toBe('one')
  })

  test('a timestamp value keeps its colons', () => {
    expect(parseBug('BUG-005.md', BUG_005)?.linkedFeature).toBe('web-app/core')
  })
})

describe('bug rows: scalars', () => {
  test('a double-quoted value loses the quotes, and \\" and \\\\ unescape', () => {
    expect(parseBug('BUG-005.md', BUG_005)?.title).toBe('"New Bug" doesnt pre-fill epic + feature')
    expect(parseBug('BUG-009.md', doc('---', 'title: "a \\\\ b"', '---'))?.title).toBe('a \\ b')
  })

  test('a single-quoted value loses the quotes, and the doubled quote becomes one', () => {
    expect(parseBug('BUG-009.md', doc('---', "title: 'It''s open'", '---'))?.title).toBe("It's open")
  })

  test('a plain value is trimmed', () => {
    expect(parseBug('BUG-009.md', doc('---', 'title:    padded   ', '---'))?.title).toBe('padded')
  })

  test('a lone quote stays as text', () => {
    expect(parseBug('BUG-009.md', doc('---', 'title: "open', '---'))?.title).toBe('"open')
  })
})

describe('bug rows: id and title', () => {
  test('the id is the id field, else the file name with no .md', () => {
    expect(parseBug('BUG-007.md', doc('---', 'id: BUG-070', '---'))?.id).toBe('BUG-070')
    expect(parseBug('BUG-007.md', doc('---', 'title: x', '---'))?.id).toBe('BUG-007')
    expect(parseBug('BUG-007.md', doc('---', 'id:', '---'))?.id).toBe('BUG-007')
  })

  test('the title is the title field, else the id', () => {
    expect(parseBug('BUG-007.md', doc('---', 'id: BUG-070', '---'))?.title).toBe('BUG-070')
    expect(parseBug('BUG-007.md', doc('---', 'title: ""', '---'))?.title).toBe('BUG-007')
  })

  test('status and linkedFeature are null when absent', () => {
    expect(parseBug('BUG-007.md', doc('---', 'id: x', '---'))).toMatchObject({ status: null, linkedFeature: null })
  })
})

describe('bug rows: open', () => {
  test('closed is not open, in any case and with spaces', () => {
    expect(isOpenFor(bug({ status: 'closed' }), ['cart'])).toBe(false)
    expect(isOpenFor(bug({ status: '  Closed ' }), ['cart'])).toBe(false)
    expect(isOpenFor(bug({ status: 'CLOSED' }), ['cart'])).toBe(false)
  })

  test('open, in-progress, and any other status are open', () => {
    expect(isOpenFor(bug({ status: 'open' }), ['cart'])).toBe(true)
    expect(isOpenFor(bug({ status: 'in-progress' }), ['cart'])).toBe(true)
    expect(isOpenFor(bug({ status: 'wontfix' }), ['cart'])).toBe(true)
  })

  test('a bug with no status is open', () => {
    expect(isOpenFor(bug({ status: null }), ['cart'])).toBe(true)
  })
})

describe('bug rows: match', () => {
  test('linkedFeature is one of the link keys', () => {
    expect(isOpenFor(bug({ linkedFeature: 'shop/cart' }), ['shop/cart', 'cart'])).toBe(true)
    expect(isOpenFor(bug({ linkedFeature: 'cart' }), ['shop/cart', 'cart'])).toBe(true)
    expect(isOpenFor(bug({ linkedFeature: 'demo' }), ['shop/cart', 'cart'])).toBe(false)
  })

  test('the value is trimmed and loses one trailing slash', () => {
    expect(isOpenFor(bug({ linkedFeature: '  shop/cart/ ' }), ['shop/cart'])).toBe(true)
    expect(isOpenFor(bug({ linkedFeature: 'shop/cart//' }), ['shop/cart'])).toBe(false)
  })

  test('a bug with no linkedFeature matches no feature', () => {
    expect(isOpenFor(bug({ linkedFeature: null }), ['cart', ''])).toBe(false)
    expect(isOpenFor(bug({ linkedFeature: '' }), ['cart', ''])).toBe(false)
    expect(isOpenFor(bug({ linkedFeature: '/' }), ['cart', ''])).toBe(false)
  })

  test('an empty key list matches nothing', () => {
    expect(isOpenFor(bug(), [])).toBe(false)
  })
})

describe('bug rows: order', () => {
  test('ascending by the first number, then by the id text', () => {
    const ids = ['BUG-10', 'BUG-2', 'BUG-002', 'BUG-1', 'X-2b', 'NOPE']
    const result = openBugs(ids.map(id => bug({ id, file: `${id}.md` })), ['cart'])

    expect(result.map(b => b.id)).toEqual(['BUG-1', 'BUG-002', 'BUG-2', 'X-2b', 'BUG-10', 'NOPE'])
  })

  test('openBugs returns id, title, and file only, and does not change its input', () => {
    const input = [bug({ id: 'BUG-3', file: 'BUG-3.md' }), bug({ id: 'BUG-1', file: 'BUG-1.md' })]
    const result = openBugs(input, ['cart'])

    expect(result).toEqual([
      { id: 'BUG-1', title: 't', file: 'BUG-1.md' },
      { id: 'BUG-3', title: 't', file: 'BUG-3.md' },
    ])
    expect(input.map(b => b.id)).toEqual(['BUG-3', 'BUG-1'])
  })

  test('the scratch tree: cart shows BUG-001 only, demo shows BUG-003 only', () => {
    const parsed = Object.entries(SCRATCH_TREE)
      .filter(([path]) => path.startsWith(`${ROOT}/docs/bugs/`))
      .map(([path, text]) => parseBug(path.split('/').pop() ?? '', text))
      .filter((b): b is ParsedBug => b !== null)

    expect(parsed).toHaveLength(3)
    expect(openBugs(parsed, ['shop/cart', 'cart']).map(b => b.id)).toEqual(['BUG-001'])
    expect(openBugs(parsed, ['demo']).map(b => b.id)).toEqual(['BUG-003'])
    expect(openBugs(parsed, ['shop']).map(b => b.id)).toEqual([])
    expect(parseBug('BUG-002.md', BUG_002)?.status).toBe('closed')
    expect(parseBug('BUG-003.md', BUG_003)?.status).toBe('in-progress')
  })
})

describe('bug rows: never throws', () => {
  test('an empty string and an unknown shape', () => {
    expect(parseBug('BUG-001.md', '')).toBeNull()
    expect(parseBug('', '---\n---\n')).toEqual({ id: '', title: '', status: null, linkedFeature: null, file: '' })
    expect(parseBug('BUG-001.md', '\u0000\r\r---')).toBeNull()
    expect(parseBug('BUG-001.md', '---\n: no key\nkey no colon\n"\n---')).toMatchObject({ id: 'BUG-001' })
  })

  test('empty lists', () => {
    expect(openBugs([], [])).toEqual([])
    expect(openBugs([bug()], [])).toEqual([])
  })
})
