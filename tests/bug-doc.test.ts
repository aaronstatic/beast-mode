import { describe, expect, test } from 'claude-code/testing'
import { printable } from '../hooks/lib/docs'
import { bugLink, isOpenBug, parseBug, parseBugDoc } from '../hooks/lib/bugs'

const DOC = '---\nid: BUG-007\ntitle: "Boom"\nstatus: open\nlinkedFeature: shop/cart/\npriority: high\n---\n\n## Steps\n\nClick it.\n\n'

describe('printable', () => {
  test('removes U+0000 to U+0008', () => {
    expect(printable('a\u0000b\u0001c\u0008d')).toBe('abcd')
  })

  test('keeps tab and newline', () => {
    expect(printable('a\tb\nc')).toBe('a\tb\nc')
  })

  test('removes U+000B to U+001F', () => {
    expect(printable('a\u000Bb\u000Cc\rd\u001Fe')).toBe('abcde')
  })

  test('removes U+007F', () => {
    expect(printable('a\u007Fb')).toBe('ab')
  })

  test('removes U+0080 to U+009F', () => {
    expect(printable('a\u0080b\u009Fc')).toBe('abc')
  })

  test('keeps U+00A0, the emoji, and the text of other scripts', () => {
    expect(printable('a b 🟡 é 日本')).toBe('a b 🟡 é 日本')
  })

  test('an empty string gives an empty string', () => {
    expect(printable('')).toBe('')
  })
})

describe('parseBugDoc: frontmatter', () => {
  test('a text with no frontmatter gives null', () => {
    expect(parseBugDoc('BUG-001.md', '# Title\n')).toBeNull()
    expect(parseBugDoc('BUG-001.md', '')).toBeNull()
  })

  test('a text with no closing line gives null', () => {
    expect(parseBugDoc('BUG-001.md', '---\ntitle: x\n')).toBeNull()
  })

  test('a leading BOM and CRLF lines parse', () => {
    const doc = parseBugDoc('BUG-001.md', '﻿---\r\ntitle: x\r\nstatus: open\r\n---\r\nText\r\n')

    expect(doc).toEqual({ id: 'BUG-001', title: 'x', fields: [{ key: 'status', value: 'open' }], body: 'Text' })
  })
})

describe('parseBugDoc: fields', () => {
  test('every field is a field, in file order, with the scalar rule of parseBug', () => {
    const doc = parseBugDoc('BUG-007.md', DOC)

    expect(doc?.fields).toEqual([
      { key: 'status', value: 'open' },
      { key: 'linkedFeature', value: 'shop/cart/' },
      { key: 'priority', value: 'high' },
    ])
  })

  test('the first line of a key wins', () => {
    const doc = parseBugDoc('BUG-1.md', '---\nstatus: open\nstatus: closed\n---\n')

    expect(doc?.fields).toEqual([{ key: 'status', value: 'open' }])
  })

  test('an indented line or a list line is no field', () => {
    const doc = parseBugDoc('BUG-1.md', '---\nstatus: open\n  nested: x\n- item\ntags:\n---\n')

    expect(doc?.fields).toEqual([
      { key: 'status', value: 'open' },
      { key: 'tags', value: '' },
    ])
  })

  test('a quoted value loses its quotes', () => {
    const doc = parseBugDoc('BUG-1.md', "---\nnote: 'it''s'\nname: \"a\\\"b\"\n---\n")

    expect(doc?.fields).toEqual([
      { key: 'note', value: "it's" },
      { key: 'name', value: 'a"b' },
    ])
  })

  test('the id and the title are no shown field', () => {
    const keys = parseBugDoc('BUG-007.md', DOC)?.fields.map(field => field.key)

    expect(keys).not.toContain('id')
    expect(keys).not.toContain('title')
  })

  test('a value passes printable()', () => {
    expect(parseBugDoc('BUG-1.md', '---\nstatus: op\u0000en\n---\n')?.fields).toEqual([{ key: 'status', value: 'open' }])
  })
})

describe('parseBugDoc: id, title, body', () => {
  test('the id and the title are as parseBug gives them', () => {
    const doc = parseBugDoc('BUG-007.md', DOC)
    const bug = parseBug('BUG-007.md', DOC)

    expect(doc?.id).toBe(bug?.id)
    expect(doc?.title).toBe(bug?.title)
    expect(doc?.title).toBe('Boom')
  })

  test('no id gives the file name, and no title gives the id', () => {
    const doc = parseBugDoc('BUG-042.md', '---\nstatus: open\n---\n')

    expect(doc?.id).toBe('BUG-042')
    expect(doc?.title).toBe('BUG-042')
  })

  test('the body is the lines after the second line, trimmed', () => {
    expect(parseBugDoc('BUG-007.md', DOC)?.body).toBe('## Steps\n\nClick it.')
  })

  test('a text with no body gives an empty body', () => {
    expect(parseBugDoc('BUG-1.md', '---\ntitle: x\n---')?.body).toBe('')
  })

  test('a horizontal rule in the body stays in the body', () => {
    expect(parseBugDoc('BUG-1.md', '---\ntitle: x\n---\na\n---\nb\n')?.body).toBe('a\n---\nb')
  })

  test('the body passes printable()', () => {
    expect(parseBugDoc('BUG-1.md', '---\ntitle: x\n---\nA\u0000B\tC\n')?.body).toBe('AB\tC')
  })
})

describe('parseBugDoc: the bound', () => {
  const NOTE = '\n\n(The description is cut. Read docs/bugs/BUG-1.md for the rest.)'

  test('a body of 10000 characters stays whole', () => {
    const body = 'a'.repeat(10000)

    expect(parseBugDoc('BUG-1.md', `---\ntitle: x\n---\n${body}`)?.body).toBe(body)
  })

  test('a body over 10000 characters is cut to 9900 characters and the note', () => {
    const doc = parseBugDoc('BUG-1.md', `---\ntitle: x\n---\n${'a'.repeat(10001)}`)

    expect(doc?.body).toBe(`${'a'.repeat(9900)}${NOTE}`)
  })

  test('the cut falls at no surrogate pair', () => {
    const body = `${'a'.repeat(9899)}🟡${'a'.repeat(200)}`
    const doc = parseBugDoc('BUG-1.md', `---\ntitle: x\n---\n${body}`)

    expect(doc?.body).toBe(`${'a'.repeat(9899)}${NOTE}`)
  })
})

describe('bugLink and isOpenBug', () => {
  test('bugLink gives the trimmed value with one trailing slash removed', () => {
    expect(bugLink({ linkedFeature: ' shop/cart/ ' })).toBe('shop/cart')
    expect(bugLink({ linkedFeature: 'shop//' })).toBe('shop/')
  })

  test('bugLink gives null for an empty value or none', () => {
    expect(bugLink({ linkedFeature: '' })).toBeNull()
    expect(bugLink({ linkedFeature: '  /' })).toBeNull()
    expect(bugLink({ linkedFeature: null })).toBeNull()
  })

  test('isOpenBug is false for closed, with trim and no case match', () => {
    expect(isOpenBug({ status: 'closed' })).toBe(false)
    expect(isOpenBug({ status: ' Closed ' })).toBe(false)
  })

  test('isOpenBug is true for any other status and for none', () => {
    expect(isOpenBug({ status: 'open' })).toBe(true)
    expect(isOpenBug({ status: 'in-progress' })).toBe(true)
    expect(isOpenBug({ status: '' })).toBe(true)
    expect(isOpenBug({ status: null })).toBe(true)
  })
})
