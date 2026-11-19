// Pure functions over the text of a feature doc. No file here calls `$`.

/**
 * The lines of a doc, ready to parse. Splits on `\r?\n`, removes the trailing
 * spaces and one trailing `\` of each line, and drops every line inside a
 * fence that opens with three backticks or three tildes (the fence lines too).
 * An unclosed fence hides the rest of the text.
 *
 * @example lines('**Progress:** 1/2\\\n') // ['**Progress:** 1/2', '']
 */
export function lines(text: string): string[] {
  const out: string[] = []
  let fence: string | null = null

  for (const raw of text.split(/\r?\n/)) {
    const mark = /^\s*(```|~~~)/.exec(raw)?.[1] ?? null

    if (fence !== null) {
      if (mark === fence) {
        fence = null
      }
      continue
    }

    if (mark !== null) {
      fence = mark
      continue
    }

    let line = raw.trimEnd()

    if (line.endsWith('\\')) {
      line = line.slice(0, -1).trimEnd()
    }

    out.push(line)
  }

  return out
}

/**
 * The value of the first line that starts with `**<label>:**`: the rest of
 * that line, trimmed. Null when no line starts so. Reads `lines(text)`.
 *
 * @example headerValue('**Status:** 🟡 In Progress', 'Status') // '🟡 In Progress'
 */
export function headerValue(text: string, label: string): string | null {
  const prefix = `**${label}:**`

  for (const line of lines(text)) {
    if (line.startsWith(prefix)) {
      return line.slice(prefix.length).trim()
    }
  }

  return null
}

/**
 * A title with the markdown marks removed: one leading `✅` and the space
 * after it, every `**`, every backtick, and the backslash of each markdown
 * escape. Every other mark stays (`⏸️`, `🔄`).
 *
 * @example plainText('✅ **1.1 Write the file**') // '1.1 Write the file'
 */
export function plainText(text: string): string {
  return text
    .trim()
    .replace(/^✅ ?/, '')
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/\\([\\`*_{}[\]()#+\-.!|<>~"'])/g, '$1')
    .trim()
}

/**
 * The text with every control character removed that the surface refuses:
 * U+0000 to U+0008, U+000B to U+001F, U+007F, and U+0080 to U+009F. Tab and
 * newline stay. Every doc string that the dashboard draws passes it.
 *
 * @example printable('a\u0000b\tc') // 'ab\tc'
 */
export function printable(text: string): string {
  return text.replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g, '')
}
