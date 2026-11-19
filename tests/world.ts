import type { CommandSpec, FsEntry, FsStat, On, PaneOpenArgs, RenderSurface, UiPane } from 'claude-code'

import { ROOT } from './fixtures'

// The world beneath the plugin: it answers from memory each engine call that
// the mod makes, as the engine would. The test kit loads the plugin at the
// first call on `$`, so a test builds its world before that call.

export type WorldOptions = {
  /** Absolute path to text. Each folder on a path exists. */
  files?: Readonly<Record<string, string>>
  /** Folders that hold no file. */
  dirs?: readonly string[]
  /** Symbolic links: the path of the link to its target. A missing target leads nowhere. */
  links?: Readonly<Record<string, string>>
  /** What `$.session.root()` answers. `ROOT` when not given. */
  root?: string
  /** What `$.session.surfaces()` answers. `['terminal']` when not given. */
  surfaces?: readonly RenderSurface[]
  /** False: `$.ui.open` answers `isPlaced: false`, as an older desktop app does. */
  isPlaced?: boolean
  /** A reason: `$.command.register` rejects with it. */
  refuseRegister?: string
  /** The draft in the prompt box: what `$.prompt.read()` answers until a fill takes. `''` when not given. */
  draft?: string
  /** A refusal: each `$.prompt.fill` answers `{ isFilled: false, refusal }` with it, and the draft stays. */
  fillRefusal?: 'no_composer' | 'dialog'
}

export type World = {
  /** The files: absolute path to text. A tool call changes them. */
  files: Map<string, string>
  /** The mtime of each file. A tool call that writes a file moves its mtime on. */
  mtimes: Map<string, number>
  /** The `$.fs.read` calls per path, a rejected read included. */
  reads: Map<string, number>
  /** The `$.fs.stat` calls per path. */
  stats: Map<string, number>
  /** The paths whose read rejects, though the file exists. */
  rejects: Set<string>
  /** The open panes, by id. */
  panes: Map<string, UiPane>
  /** Each `$.ui.open` argument. */
  opens: PaneOpenArgs[]
  /** Each `$.ui.log` line. */
  logs: string[]
  /** Each `$.command.register` argument. */
  registered: CommandSpec[]
  /** The tool calls that reached the bottom. */
  toolCalls: number
  /** The writes of `beast-mode.featurePane`. */
  stateWrites: number
  /** The writes of `beast-mode.dashboardPane`. */
  dashboardWrites: number
  /** Each `$.prompt.fill` text, a refused one included. */
  fills: string[]
  /** Each `$.ui.focus` key: the `element` of the event. */
  focuses: string[]
  /** Each `$.ui.toast` text. */
  toasts: string[]
  /** Every `$.fs.read` call. */
  readCount: () => number
  /** Sets the reads, the stats, the opens, the tool calls, and the state writes back to none. */
  resetCounts: () => void
  /** Closes a pane, as the person closing it does. */
  close: (id: string) => void
  /** Holds the next read of a path: `reached` resolves when it starts, and `release` lets it end. */
  hold: (path: string) => { reached: Promise<void>; release: () => void }
}

const HOPS = 8

function clean(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, '') : path
}

function bump(counts: Map<string, number>, path: string): void {
  counts.set(path, (counts.get(path) ?? 0) + 1)
}

function count(haystack: string, needle: string): number {
  return needle === '' ? 0 : haystack.split(needle).length - 1
}

/**
 * Registers the hooks of the world on the test's `on` and returns it. Each
 * hook answers one engine call: `fs.list`, `fs.read`, `fs.stat`,
 * `session.root`, `session.surfaces`, `session.start`, `ui.open`, `ui.panes`,
 * `ui.log`, and `command.register`. A pass-through `state.set` hook counts
 * the writes, and a bottom `tool.call` hook applies an Edit or a Write.
 */
export function world(on: On, options: WorldOptions = {}): World {
  const dirs = new Set((options.dirs ?? []).map(clean))
  const links = new Map(Object.entries(options.links ?? {}).map(([from, to]) => [clean(from), clean(to)]))
  const root = options.root ?? ROOT
  const surfaces = options.surfaces ?? ['terminal']
  const held = new Map<string, { reach: () => void; gate: Promise<void> }>()
  let clock = 0
  const tick = (): number => (clock += 1000)
  let draft = options.draft ?? ''

  const w: World = {
    files: new Map(Object.entries(options.files ?? {})),
    mtimes: new Map(),
    reads: new Map(),
    stats: new Map(),
    rejects: new Set(),
    panes: new Map(),
    opens: [],
    logs: [],
    registered: [],
    toolCalls: 0,
    stateWrites: 0,
    dashboardWrites: 0,
    fills: [],
    focuses: [],
    toasts: [],
    readCount: () => [...w.reads.values()].reduce((sum, n) => sum + n, 0),
    resetCounts: () => {
      w.reads.clear()
      w.stats.clear()
      w.opens.length = 0
      w.toolCalls = 0
      w.stateWrites = 0
      // And the dashboard writes, the fills, the focuses, and the toasts.
      w.dashboardWrites = 0
      w.fills.length = 0
      w.focuses.length = 0
      w.toasts.length = 0
    },
    close: id => {
      w.panes.delete(id)
    },
    hold: path => {
      let reach = (): void => undefined
      let release = (): void => undefined
      const reached = new Promise<void>(resolve => (reach = resolve))
      const gate = new Promise<void>(resolve => (release = resolve))

      held.set(clean(path), { reach, gate })

      return { reached, release }
    },
  }

  for (const path of w.files.keys()) {
    w.mtimes.set(path, tick())
  }

  /** The path with each link on it followed. */
  function resolve(path: string): string {
    let current = clean(path)

    for (let hop = 0; hop < HOPS; hop += 1) {
      const link = [...links.keys()].find(from => current === from || current.startsWith(`${from}/`))

      if (link === undefined) {
        return current
      }

      current = `${links.get(link) ?? ''}${current.slice(link.length)}`
    }

    return current
  }

  function isDir(path: string): boolean {
    const prefix = `${path}/`

    return dirs.has(path) || [...w.files.keys(), ...dirs, ...links.keys()].some(item => item.startsWith(prefix))
  }

  /** The entries of a folder, Z to A: the engine lists in no set order, so the mod must sort. */
  function entries(dir: string): FsEntry[] {
    const prefix = `${dir}/`
    const names = new Set<string>()

    for (const item of [...w.files.keys(), ...dirs, ...links.keys()]) {
      if (item.startsWith(prefix)) {
        names.add(item.slice(prefix.length).split('/')[0] ?? '')
      }
    }

    return [...names]
      .sort()
      .reverse()
      .map((name): FsEntry => {
        const path = `${prefix}${name}`
        const text = w.files.get(path)

        if (links.has(path)) {
          return { name, kind: 'other', size: 0, mtimeMs: 0, isLink: true }
        }

        return text === undefined
          ? { name, kind: 'dir', size: 0, mtimeMs: 0, isLink: false }
          : { name, kind: 'file', size: text.length, mtimeMs: w.mtimes.get(path) ?? 0, isLink: false }
      })
  }

  on('fs.read', async ($, e) => {
    const path = clean(e.path)
    const wait = held.get(path)

    bump(w.reads, path)

    if (wait !== undefined) {
      held.delete(path)
      wait.reach()
      await wait.gate
    }

    const real = resolve(path)
    const text = w.files.get(real)

    if (w.rejects.has(path) || w.rejects.has(real)) {
      return { deny: `EACCES: permission denied, open '${e.path}'` }
    }

    if (text === undefined) {
      return { deny: `ENOENT: no such file or directory, open '${e.path}'` }
    }

    return e.as === 'bytes' ? { deny: 'the world holds text only' } : { value: text }
  })

  on('fs.list', ($, e) => {
    const real = resolve(e.path)

    return isDir(real) ? { value: entries(real) } : { deny: `ENOENT: no such file or directory, scandir '${e.path}'` }
  })

  on('fs.stat', ($, e) => {
    const path = clean(e.path)
    const real = resolve(path)
    const text = w.files.get(real)
    const isLink = links.has(path)
    const where = e.resolve ? { realPath: real } : {}

    bump(w.stats, path)

    if (text !== undefined) {
      const stat: FsStat = { kind: 'file', size: text.length, mtimeMs: w.mtimes.get(real) ?? 0, isLink, ...where }

      return { value: stat }
    }

    if (isDir(real)) {
      return { value: { kind: 'dir', size: 0, mtimeMs: 0, isLink, ...where } satisfies FsStat }
    }

    return isLink
      ? { value: { kind: 'other', size: 0, mtimeMs: 0, isLink } satisfies FsStat }
      : { deny: `ENOENT: no such file or directory, stat '${e.path}'` }
  })

  on('session.root', () => ({ value: root }))

  on('session.surfaces', () => ({ value: surfaces }))

  on('session.start', ($, e) => ({ cwd: e.cwd }))

  on('command.register', ($, e) => {
    if (options.refuseRegister !== undefined) {
      return { deny: options.refuseRegister }
    }

    w.registered.push({ ...e })

    return { value: { command: e.name } }
  })

  on('ui.open', ($, e) => {
    const isPlaced = options.isPlaced ?? true

    w.opens.push({ ...e })
    w.panes.set(e.id, { id: e.id, title: e.title ?? e.id, isShown: true, isFocused: false, isPlaced })

    return isPlaced
      ? { value: { isPlaced: true } }
      : { value: { isPlaced: false, reason: 'the attached surfaces place no panes' } }
  })

  on('ui.panes', () => ({ value: [...w.panes.values()] }))

  on('ui.log', ($, e) => {
    w.logs.push(e.text)

    return { value: undefined }
  })

  // The prompt box, the focus ring, and the toasts of the dashboard.
  // prompt.read and ui.toast are engine calls: they answer `{ value }`.
  // prompt.fill and ui.focus are events: the bottom answers their result.
  on('prompt.read', () => ({ value: { text: draft, cursor: draft.length } }))

  on('prompt.fill', ($, e) => {
    w.fills.push(e.text)

    if (options.fillRefusal !== undefined) {
      return { isFilled: false, refusal: options.fillRefusal }
    }

    // The cursor stays at the end of the draft, so `insert` lands as `append` does.
    draft = e.mode === 'replace' ? e.text : `${draft}${e.text}`

    return { isFilled: true }
  })

  on('ui.focus', ($, e) => {
    w.focuses.push(e.element ?? '')

    return {}
  })

  on('ui.toast', ($, e) => {
    w.toasts.push(e.text)

    return { value: undefined }
  })

  on('state.set', { plugin: 'beast-mode', key: 'featurePane' }, ($, e, next) => {
    w.stateWrites += 1

    return next(e)
  })

  on('state.set', { plugin: 'beast-mode', key: 'dashboardPane' }, ($, e, next) => {
    w.dashboardWrites += 1

    return next(e)
  })

  on('tool.call', { tool: ['Edit', 'Write'] }, ($, e) => {
    const path = clean(e.file_path)
    const before = w.files.get(path)

    w.toolCalls += 1

    if (e.tool === 'Write') {
      w.files.set(path, e.content)
      w.mtimes.set(path, tick())

      return {
        result: {
          type: before === undefined ? 'create' : 'update',
          filePath: e.file_path,
          content: e.content,
          structuredPatch: [],
          originalFile: before ?? null,
        },
        text: `File written: ${e.file_path}`,
      }
    }

    const found = before === undefined ? 0 : count(before, e.old_string)

    if (before === undefined || found === 0 || (found > 1 && e.replace_all !== true)) {
      const reason = before === undefined ? 'File does not exist.' : `Found ${found} matches of the string to replace.`

      return { isError: true, result: reason, text: reason }
    }

    const after =
      e.replace_all === true
        ? before.split(e.old_string).join(e.new_string)
        : before.replace(e.old_string, () => e.new_string)

    w.files.set(path, after)
    w.mtimes.set(path, tick())

    return {
      result: {
        filePath: e.file_path,
        oldString: e.old_string,
        newString: e.new_string,
        originalFile: before,
        structuredPatch: [],
        userModified: false,
        replaceAll: e.replace_all === true,
      },
      text: `The file ${e.file_path} has been updated.`,
    }
  })

  return w
}
