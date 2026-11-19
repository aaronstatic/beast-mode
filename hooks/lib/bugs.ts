// The bug rules. Pure: no file here calls `$`. Never throws.

import type { FeaturePaneBug } from '../../types/index'
import type { DashboardPaneField } from '../../types/index'
import { printable } from './docs'

export type ParsedBug = {
  id: string
  title: string
  status: string | null
  linkedFeature: string | null
  file: string
}

const BUG_FILE = /^BUG-.+\.md$/
const FIELD = /^([A-Za-z_][\w-]*):(.*)$/

/**
 * True for a `docs/bugs/` entry name that holds a bug: `^BUG-.+\.md$`.
 */
export function isBugFile(name: string): boolean {
  return BUG_FILE.test(name)
}

function scalar(raw: string): string {
  const value = raw.trim()

  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\(["\\])/g, '$1')
  }

  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'")
  }

  return value
}

/**
 * The bug of one `BUG-*.md` text, or null when the text holds no frontmatter
 * block. Reads `key: value` lines between the first `---` line and the next.
 * The first line of a key wins, and an indented or list line is no field.
 *
 * @example parseBug('BUG-007.md', '---\ntitle: Boom\n---\n') // { id: 'BUG-007', title: 'Boom', ... }
 */
export function parseBug(file: string, text: string): ParsedBug | null {
  const all = text.replace(/^\uFEFF/, '').split(/\r?\n/)

  if (all[0]?.trimEnd() !== '---') {
    return null
  }

  const end = all.findIndex((line, index) => index > 0 && line.trimEnd() === '---')

  if (end === -1) {
    return null
  }

  const fields = new Map<string, string>()

  for (const line of all.slice(1, end)) {
    const match = FIELD.exec(line)

    if (match !== null && !fields.has(match[1] ?? '')) {
      fields.set(match[1] ?? '', scalar(match[2] ?? ''))
    }
  }

  const id = fields.get('id') || file.replace(/\.md$/, '')

  return {
    id,
    title: fields.get('title') || id,
    status: fields.get('status') ?? null,
    linkedFeature: fields.get('linkedFeature') ?? null,
    file,
  }
}

/**
 * True when the bug is open and its `linkedFeature` names the feature: the
 * trimmed value, with one trailing `/` removed, is one of the link keys. A
 * bug with no `linkedFeature` matches no feature. A bug with no `status` is
 * open.
 */
export function isOpenFor(bug: ParsedBug, linkKeys: string[]): boolean {
  if ((bug.status ?? '').trim().toLowerCase() === 'closed') {
    return false
  }

  let link = (bug.linkedFeature ?? '').trim()

  if (link.endsWith('/')) {
    link = link.slice(0, -1)
  }

  return link !== '' && linkKeys.includes(link)
}

function firstNumber(id: string): number {
  const digits = /\d+/.exec(id)?.[0]

  return digits === undefined ? Number.POSITIVE_INFINITY : Number(digits)
}

/**
 * The open bugs of one feature, in id order: ascending by the first number
 * of the id (an id with no number last), then by the id text.
 */
export function openBugs(bugs: ParsedBug[], linkKeys: string[]): FeaturePaneBug[] {
  return bugs
    .filter(bug => isOpenFor(bug, linkKeys))
    .sort((a, b) => {
      const na = firstNumber(a.id)
      const nb = firstNumber(b.id)

      if (na !== nb) {
        return na < nb ? -1 : 1
      }

      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    })
    .map(bug => ({ id: bug.id, title: bug.title, file: bug.file }))
}

export type ParsedBugDoc = {
  id: string
  title: string
  /** Every field but `id` and `title`, in file order. */
  fields: DashboardPaneField[]
  body: string
}

const BODY_LIMIT = 10000
const BODY_CUT = 9900

/**
 * The whole bug document of one `BUG-*.md` text, or null when the text holds
 * no frontmatter block. The fields are every `key: value` line of the block
 * but `id` and `title`, in file order. The body is the text after the block,
 * trimmed, and cut to 9900 characters when it holds over 10000. Each value
 * and the body pass `printable()`.
 *
 * @example parseBugDoc('BUG-7.md', '---\ntitle: Boom\nstatus: open\n---\nText') // { id: 'BUG-7', title: 'Boom', fields: [{ key: 'status', value: 'open' }], body: 'Text' }
 */
export function parseBugDoc(file: string, text: string): ParsedBugDoc | null {
  const all = text.replace(/^﻿/, '').split(/\r?\n/)

  if (all[0]?.trimEnd() !== '---') {
    return null
  }

  const end = all.findIndex((line, index) => index > 0 && line.trimEnd() === '---')

  if (end === -1) {
    return null
  }

  const found = new Map<string, string>()

  for (const line of all.slice(1, end)) {
    const match = FIELD.exec(line)

    if (match !== null && !found.has(match[1] ?? '')) {
      found.set(match[1] ?? '', printable(scalar(match[2] ?? '')))
    }
  }

  const id = found.get('id') || printable(file.replace(/\.md$/, ''))
  const fields: DashboardPaneField[] = []

  for (const [key, value] of found) {
    if (key !== 'id' && key !== 'title') {
      fields.push({ key, value })
    }
  }

  let body = printable(all.slice(end + 1).join('\n').trim())

  if (body.length > BODY_LIMIT) {
    let cut = BODY_CUT
    const last = body.charCodeAt(cut - 1)

    if (last >= 0xd800 && last <= 0xdbff) {
      cut -= 1
    }

    body = `${body.slice(0, cut)}\n\n(The description is cut. Read docs/bugs/${file} for the rest.)`
  }

  return { id, title: found.get('title') || id, fields, body }
}

/**
 * The `linkedFeature` of a bug: trimmed, with one trailing `/` removed. Null
 * when that is empty or the bug has none.
 */
export function bugLink(bug: Pick<ParsedBug, 'linkedFeature'>): string | null {
  let link = (bug.linkedFeature ?? '').trim()

  if (link.endsWith('/')) {
    link = link.slice(0, -1)
  }

  return link === '' ? null : link
}

/**
 * True when the `status` of the bug, trimmed and in lower case, is not
 * `closed`. A bug with no `status` is open.
 */
export function isOpenBug(bug: Pick<ParsedBug, 'status'>): boolean {
  return (bug.status ?? '').trim().toLowerCase() !== 'closed'
}
