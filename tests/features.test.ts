import { describe, expect, test } from 'claude-code/testing'
import { candidates, linkKeys, pickActive, resolveRef } from '../hooks/lib/features'
import type { FeatureTree, TopEntry } from '../hooks/lib/features'
import { messageFor } from '../hooks/lib/view'
import { SCRATCH_FEATURE_TREE, SCRATCH_TASKS_TEXTS, doc } from './fixtures'

function top(name: string, files: string[], children: string[] = [], tasksMtime = 0): TopEntry {
  return {
    name,
    files,
    tasksMtime,
    children: children.map(child => ({ name: child, files: ['tasks.md'], tasksMtime: 0 })),
  }
}

function epic(name: string, children: string[]): TopEntry {
  return top(name, ['epic-overview.md'], children)
}

const TREE: FeatureTree = {
  exists: true,
  top: [epic('a', ['c', 'd', 'x']), epic('b', ['x']), epic('hollow', []), top('plain', ['tasks.md']), top('shadow', [])],
}

const NO_EPIC_TREE: FeatureTree = { exists: true, top: [...TREE.top, epic('shadowed', ['shadow'])] }

describe('resolution rows', () => {
  test('a/b with no top folder a: not found', () => {
    const out = resolveRef('nope/b', TREE)

    expect(out).toEqual({ kind: 'notFound', name: 'nope/b' })
    expect(messageFor(out)).toBe(
      'No feature "nope/b" in docs/features/. Run /feature with no name to show the active feature.',
    )
  })

  test('a name with two slashes: not found', () => {
    const out = resolveRef('a/c/d', TREE)

    expect(out).toEqual({ kind: 'notFound', name: 'a/c/d' })
    expect(messageFor(out)).toBe(
      'No feature "a/c/d" in docs/features/. Run /feature with no name to show the active feature.',
    )
  })

  test('an empty segment or an empty name: not found', () => {
    expect(resolveRef('a/', TREE).kind).toBe('notFound')
    expect(resolveRef('/c', TREE).kind).toBe('notFound')
    expect(resolveRef('', TREE).kind).toBe('notFound')
  })

  test('a/b where a holds no epic-overview.md: no epic', () => {
    const out = resolveRef('plain/b', TREE)

    expect(out).toEqual({ kind: 'noEpic', epic: 'plain', name: 'plain/b' })
    expect(messageFor(out)).toBe(
      '"plain" has no epic-overview.md, so "plain/b" is no feature path. Run /feature plain.',
    )
  })

  test('a/b where epic a has no child b: no child', () => {
    const out = resolveRef('a/zzz', TREE)

    expect(out).toEqual({ kind: 'noChild', epic: 'a', child: 'zzz', children: ['c', 'd', 'x'] })
    expect(messageFor(out)).toBe(
      'Epic "a" has no feature "zzz". Run /feature a/<feature> with one of: c, d, x.',
    )
  })

  test('a/b where epic a has no child at all gives the empty-epic answer', () => {
    expect(messageFor(resolveRef('hollow/q', TREE))).toBe(
      '"hollow" is an epic with no feature folder yet. Run /plan-feature hollow/<feature>.',
    )
  })

  test('a/b where epic a has a child b: feature a/b', () => {
    expect(resolveRef('a/c', TREE)).toEqual({ kind: 'feature', path: 'a/c' })
  })

  test('a where a is a top epic: whole epic', () => {
    const out = resolveRef('a', TREE)

    expect(out).toEqual({ kind: 'wholeEpic', epic: 'a', children: ['c', 'd', 'x'] })
    expect(messageFor(out)).toBe('"a" is an epic. Run /feature a/<feature> with one of: c, d, x.')
  })

  test('a where a is a top epic with no child: empty epic', () => {
    const out = resolveRef('hollow', TREE)

    expect(out).toEqual({ kind: 'emptyEpic', epic: 'hollow' })
    expect(messageFor(out)).toBe(
      '"hollow" is an epic with no feature folder yet. Run /plan-feature hollow/<feature>.',
    )
  })

  test('a where a is a top folder and no epic: feature a', () => {
    expect(resolveRef('plain', TREE)).toEqual({ kind: 'feature', path: 'plain' })
  })

  test('a where a is a child of one epic: feature e/a', () => {
    expect(resolveRef('c', TREE)).toEqual({ kind: 'feature', path: 'a/c' })
    expect(resolveRef('cart', SCRATCH_FEATURE_TREE)).toEqual({ kind: 'feature', path: 'shop/cart' })
  })

  test('a where a is a child of two or more epics: ambiguous', () => {
    const out = resolveRef('x', TREE)

    expect(out).toEqual({ kind: 'ambiguous', name: 'x', paths: ['a/x', 'b/x'] })
    expect(messageFor(out)).toBe('"x" is in more than one epic: a/x, b/x. Run /feature <epic>/x.')
  })

  test('a where a is in no place: not found', () => {
    const out = resolveRef('ghost', TREE)

    expect(out).toEqual({ kind: 'notFound', name: 'ghost' })
    expect(messageFor(out)).toBe(
      'No feature "ghost" in docs/features/. Run /feature with no name to show the active feature.',
    )
  })

  test('a top folder wins over a child of the same name', () => {
    expect(resolveRef('shadow', NO_EPIC_TREE)).toEqual({ kind: 'feature', path: 'shadow' })
  })

  test('a missing docs/features/ folder: not found', () => {
    expect(resolveRef('demo', { exists: false, top: [] }).kind).toBe('notFound')
  })

  test('a child that holds an epic-overview.md is no epic: epics do not nest', () => {
    const tree: FeatureTree = { exists: true, top: [epic('e', ['inner'])] }

    expect(resolveRef('e/inner', tree)).toEqual({ kind: 'feature', path: 'e/inner' })
    expect(resolveRef('e/inner/deeper', tree).kind).toBe('notFound')
  })
})

describe('active pick rows', () => {
  test('no docs/features/ folder: the no-folder answer', () => {
    const out = pickActive({ exists: false, top: [] }, new Map())

    expect(out).toEqual({ kind: 'noFolder' })
    expect(messageFor(out)).toBe('No feature folder in docs/features/. Run /plan-feature <name> to start one.')
  })

  test('a docs/features/ folder with no folder in it: the no-folder answer', () => {
    expect(pickActive({ exists: true, top: [] }, new Map())).toEqual({ kind: 'noFolder' })
  })

  test('folders and no candidate: the no-candidate answer', () => {
    const tree: FeatureTree = { exists: true, top: [top('a', ['implementation.md']), epic('e', [])] }
    const out = pickActive(tree, new Map())

    expect(out).toEqual({ kind: 'noCandidate' })
    expect(messageFor(out)).toBe(
      'No tasks.md in any feature folder. Run /start-feature <name>, or /feature <name>.',
    )
  })

  test('the candidates are the plain top folders and the epic children with a tasks.md', () => {
    expect(candidates(TREE).map(item => item.path)).toEqual(['a/c', 'a/d', 'a/x', 'b/x', 'plain'])
    expect(candidates(SCRATCH_FEATURE_TREE).map(item => item.path)).toEqual(['demo', 'shop/cart'])
  })

  test('the newest stamp key wins: the scratch tree gives shop/cart', () => {
    expect(pickActive(SCRATCH_FEATURE_TREE, SCRATCH_TASKS_TEXTS)).toEqual({ kind: 'feature', path: 'shop/cart' })
  })

  test('a null key sorts last', () => {
    const texts = new Map<string, string | null>([
      ['a/c', doc('# no stamp')],
      ['plain', doc('**Last Updated:** 2020-01-01')],
    ])

    expect(pickActive(TREE, texts)).toEqual({ kind: 'feature', path: 'plain' })
  })

  test('a tie goes to the newer tasksMtime', () => {
    const tree: FeatureTree = {
      exists: true,
      top: [top('a', ['tasks.md'], [], 10), top('b', ['tasks.md'], [], 20)],
    }
    const stamp = doc('**Last Updated:** 2026-10-01 09:00')

    expect(pickActive(tree, new Map([['a', stamp], ['b', stamp]]))).toEqual({ kind: 'feature', path: 'b' })
  })

  test('a second tie goes to the path in A-to-Z order', () => {
    const tree: FeatureTree = {
      exists: true,
      top: [top('b', ['tasks.md'], [], 10), top('a', ['tasks.md'], [], 10)],
    }

    expect(pickActive(tree, new Map())).toEqual({ kind: 'feature', path: 'a' })
  })

  test('two null keys with no mtime fall to the path order', () => {
    expect(pickActive(TREE, new Map())).toEqual({ kind: 'feature', path: 'a/c' })
  })

  test('a date with no time counts as 00:00', () => {
    const tree: FeatureTree = { exists: true, top: [top('a', ['tasks.md']), top('b', ['tasks.md'])] }
    const texts = new Map<string, string | null>([
      ['a', doc('**Last Updated:** 2026-10-01')],
      ['b', doc('**Last Updated:** 2026-10-01 00:01')],
    ])

    expect(pickActive(tree, texts)).toEqual({ kind: 'feature', path: 'b' })
  })
})

describe('link key rows', () => {
  test('a top feature holds its path only', () => {
    expect(linkKeys('demo', SCRATCH_FEATURE_TREE)).toEqual(['demo'])
  })

  test('an epic child adds the bare name when it resolves to the same path', () => {
    expect(linkKeys('shop/cart', SCRATCH_FEATURE_TREE)).toEqual(['shop/cart', 'cart'])
  })

  test('a bare name in two epics adds nothing', () => {
    expect(linkKeys('a/x', TREE)).toEqual(['a/x'])
    expect(linkKeys('b/x', TREE)).toEqual(['b/x'])
  })

  test('a bare name that a top folder shadows adds nothing', () => {
    expect(linkKeys('shadowed/shadow', NO_EPIC_TREE)).toEqual(['shadowed/shadow'])
  })

  test('a bare name that is an epic adds nothing', () => {
    const tree: FeatureTree = { exists: true, top: [epic('e', ['core']), epic('core', ['q'])] }

    expect(linkKeys('e/core', tree)).toEqual(['e/core'])
  })
})
