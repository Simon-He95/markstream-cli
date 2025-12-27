export interface TerminalPos {
  /**
   * 1-based line number within the anchored region.
   */
  line: number
  /**
   * 1-based column number within the line.
   *
   * Note: this counts JavaScript string code units, not terminal cell width.
   */
  column: number
}

export interface TerminalRange {
  /**
   * Inclusive start.
   */
  start: TerminalPos
  /**
   * Inclusive end.
   */
  end: TerminalPos
}

const ESC = '\u001B'

export const ansi = {
  // Some terminals (notably macOS Terminal) prefer DEC save/restore (ESC 7/8),
  // while others support CSI s/u. Emit both for compatibility.
  saveCursor: `${ESC}7${ESC}[s`,
  restoreCursor: `${ESC}8${ESC}[u`,
  eraseToEnd: `${ESC}[J`,
  eraseLineToEnd: `${ESC}[K`,
  clearScreen: `${ESC}[2J`,
  eraseScrollback: `${ESC}[3J`,
  cursorHome: `${ESC}[H`,
  cursorNextLine: (n = 1) => `${ESC}[${Math.max(1, n)}E`,
  cursorDown: (n = 1) => `${ESC}[${Math.max(1, n)}B`,
  cursorForward: (n = 1) => `${ESC}[${Math.max(1, n)}C`,
  carriageReturn: '\r',
  hideCursor: `${ESC}[?25l`,
  showCursor: `${ESC}[?25h`,
  // Alternate screen buffer (common terminal feature used by tools like `less`).
  // When enabled, most terminals do not add output to the normal scrollback.
  altScreenEnter: `${ESC}[?1049h`,
  altScreenExit: `${ESC}[?1049l`,
  // Synchronized updates (supported by iTerm2, kitty, wezterm; ignored elsewhere).
  syncStart: `${ESC}[?2026h`,
  syncEnd: `${ESC}[?2026l`,
}

export interface AnchoredTextSurfaceOptions {
  initialText?: string
  /**
   * Anchor mode for cursor movements:
   * - `cursor`: anchor at current cursor using save/restore (default)
   * - `home`: anchor at (1,1) using cursor home + relative movements
   */
  anchor?: 'cursor' | 'home'
}

function skipAnsi(text: string, start: number) {
  if (text.charCodeAt(start) !== 0x1B)
    return null

  const next = text[start + 1]
  // CSI: ESC [ ... <final>
  if (next === '[') {
    let i = start + 2
    while (i < text.length) {
      const code = text.charCodeAt(i)
      // Final byte is in range 0x40 ('@') to 0x7E ('~')
      if (code >= 0x40 && code <= 0x7E)
        return i + 1
      i++
    }
    return text.length
  }

  // 2-byte escapes like ESC 7 / ESC 8
  if (next != null)
    return start + 2

  return null
}

export function stripAnsi(text: string) {
  let out = ''
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code === 13) // \r
      continue

    const skipped = skipAnsi(text, i)
    if (skipped != null) {
      i = skipped - 1
      continue
    }

    out += text[i]
  }
  return out
}

export function visibleLength(text: string) {
  let n = 0
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code === 13) // \r
      continue

    const skipped = skipAnsi(text, i)
    if (skipped != null) {
      i = skipped - 1
      continue
    }

    n++
  }
  return n
}

function isCombiningMark(codePoint: number) {
  return (
    (codePoint >= 0x0300 && codePoint <= 0x036F)
    || (codePoint >= 0x1AB0 && codePoint <= 0x1AFF)
    || (codePoint >= 0x1DC0 && codePoint <= 0x1DFF)
    || (codePoint >= 0x20D0 && codePoint <= 0x20FF)
    || (codePoint >= 0xFE20 && codePoint <= 0xFE2F)
  )
}

function isWide(codePoint: number) {
  // Best-effort wcwidth for terminals; covers common CJK and emoji ranges.
  return (
    (codePoint >= 0x1100 && codePoint <= 0x115F)
    || codePoint === 0x2329
    || codePoint === 0x232A
    || (codePoint >= 0x2E80 && codePoint <= 0xA4CF && codePoint !== 0x303F)
    || (codePoint >= 0xAC00 && codePoint <= 0xD7A3)
    || (codePoint >= 0xF900 && codePoint <= 0xFAFF)
    || (codePoint >= 0xFE10 && codePoint <= 0xFE19)
    || (codePoint >= 0xFE30 && codePoint <= 0xFE6F)
    || (codePoint >= 0xFF00 && codePoint <= 0xFF60)
    || (codePoint >= 0xFFE0 && codePoint <= 0xFFE6)
    || (codePoint >= 0x1F300 && codePoint <= 0x1FAFF)
  )
}

function cellWidthOfCodePoint(codePoint: number) {
  // control chars + zero-width joiner
  if (codePoint === 0x200D)
    return 0
  if (codePoint <= 0x1F || (codePoint >= 0x7F && codePoint <= 0x9F))
    return 0
  if (codePoint === 10) // \n
    return 0
  if (isCombiningMark(codePoint))
    return 0
  return isWide(codePoint) ? 2 : 1
}

/**
 * Approximate terminal cell width for a string:
 * - skips ANSI escape sequences
 * - ignores `\r`
 * - treats common CJK and emoji as width 2
 */
export function visibleCellWidth(text: string) {
  let width = 0
  for (let i = 0; i < text.length; i++) {
    const codeUnit = text.charCodeAt(i)
    if (codeUnit === 13) // \r
      continue

    const skipped = skipAnsi(text, i)
    if (skipped != null) {
      i = skipped - 1
      continue
    }

    const cp = text.codePointAt(i)!
    width += cellWidthOfCodePoint(cp)
    // Surrogate pair consumes two code units.
    if (cp > 0xFFFF)
      i++
  }
  return width
}

export function indexToPos(text: string, index: number): TerminalPos {
  const clamped = Math.max(0, Math.min(index, text.length))
  let line = 1
  let lastNl = -1
  for (let i = 0; i < clamped; i++) {
    const skipped = skipAnsi(text, i)
    if (skipped != null) {
      i = skipped - 1
      continue
    }
    if (text.charCodeAt(i) === 10) {
      line++
      lastNl = i
    }
  }
  // Column counts only visible characters since last newline; ANSI sequences are zero-width.
  let column = 1
  for (let i = lastNl + 1; i < clamped; i++) {
    const skipped = skipAnsi(text, i)
    if (skipped != null) {
      i = skipped - 1
      continue
    }
    column++
  }
  return { line, column }
}

export function posToIndex(text: string, pos: TerminalPos): number {
  const line = Math.max(1, pos.line)
  const column = Math.max(1, pos.column)

  let currentLine = 1
  let visibleCol = 1
  let i = 0

  while (i < text.length) {
    if (currentLine === line && visibleCol >= column)
      return i

    const skipped = skipAnsi(text, i)
    if (skipped != null) {
      i = skipped
      continue
    }

    const code = text.charCodeAt(i)
    if (code === 10) {
      currentLine++
      visibleCol = 1
      i++
      if (currentLine > line)
        return i
      continue
    }

    if (currentLine === line)
      visibleCol++
    i++
  }
  return text.length
}

function normalizeRange(text: string, range: TerminalRange) {
  const startIndex = posToIndex(text, range.start)
  const endIndexInclusive = posToIndex(text, range.end)
  const start = Math.min(startIndex, endIndexInclusive)
  const endInclusive = Math.max(startIndex, endIndexInclusive)
  const endExclusive = Math.min(text.length, endInclusive + 1)
  return { start, endExclusive }
}

function withEraseLineToEnd(rendered: string) {
  if (!rendered)
    return rendered
  // Ensure shorter updated lines don't leave trailing characters behind.
  // Insert EL (erase to end of line) before each newline.
  return rendered.replace(/\n/g, `${ansi.eraseLineToEnd}\n`)
}

export function createAnchoredTextSurface(initialText?: string): ReturnType<typeof _createAnchoredTextSurface>
export function createAnchoredTextSurface(options?: AnchoredTextSurfaceOptions): ReturnType<typeof _createAnchoredTextSurface>
export function createAnchoredTextSurface(arg: string | AnchoredTextSurfaceOptions = '') {
  const options: AnchoredTextSurfaceOptions = typeof arg === 'string' ? { initialText: arg } : (arg ?? {})
  return _createAnchoredTextSurface(options)
}

function _createAnchoredTextSurface(options: AnchoredTextSurfaceOptions = {}) {
  let text = options.initialText ?? ''
  let anchored = false
  const anchor = options.anchor ?? 'cursor'

  function moveTo(pos: TerminalPos) {
    const line = Math.max(1, pos.line)
    const column = Math.max(1, pos.column)
    const down = line - 1
    const right = column - 1
    const base = anchor === 'home' ? ansi.cursorHome : ansi.restoreCursor
    return `${base}${down > 0 ? `${ansi.cursorDown(down)}${ansi.carriageReturn}` : ''}${right > 0 ? ansi.cursorForward(right) : ''}`
  }

  const surface = {
    begin() {
      anchored = true
      if (anchor === 'home')
        return ansi.cursorHome
      return `${ansi.carriageReturn}${ansi.saveCursor}`
    },
    getText() {
      return text
    },
    setText(nextText: string) {
      text = nextText
      if (!anchored) {
        anchored = true
        if (anchor === 'home')
          return `${ansi.cursorHome}${withEraseLineToEnd(nextText)}${ansi.eraseToEnd}`
        return `${ansi.carriageReturn}${ansi.saveCursor}${withEraseLineToEnd(nextText)}`
      }
      return `${anchor === 'home' ? ansi.cursorHome : ansi.restoreCursor}${withEraseLineToEnd(nextText)}${ansi.eraseToEnd}`
    },
    append(delta: string) {
      if (!delta)
        return ''
      if (!anchored) {
        anchored = true
        text += delta
        if (anchor === 'home')
          return `${ansi.cursorHome}${delta}`
        return `${ansi.carriageReturn}${ansi.saveCursor}${delta}`
      }
      text += delta
      return delta
    },
    setTextFrom(nextText: string, from: TerminalPos) {
      const next = nextText
      if (!anchored) {
        anchored = true
        text = next
        if (anchor === 'home')
          return `${ansi.cursorHome}${withEraseLineToEnd(next)}${ansi.eraseToEnd}`
        return `${ansi.carriageReturn}${ansi.saveCursor}${withEraseLineToEnd(next)}`
      }

      const fromIndex = posToIndex(text, from)
      text = next
      const tail = next.slice(fromIndex)
      return `${moveTo(from)}${withEraseLineToEnd(tail)}${ansi.eraseToEnd}`
    },
    insert(at: TerminalPos, insertion: string) {
      if (!insertion)
        return ''
      if (!anchored) {
        anchored = true
        text = applyInsert(text, at, insertion)
        return `${ansi.carriageReturn}${ansi.saveCursor}${withEraseLineToEnd(text)}`
      }

      const index = posToIndex(text, at)
      text = applyInsert(text, at, insertion)
      const tail = text.slice(index)
      return `${moveTo(at)}${withEraseLineToEnd(tail)}${ansi.eraseToEnd}`
    },
    replace(range: TerminalRange, replacement: string) {
      if (!anchored)
        return surface.setText(applyReplace(text, range, replacement))

      const { start } = normalizeRange(text, range)
      text = applyReplace(text, range, replacement)
      const tail = text.slice(start)
      const startPos = indexToPos(text, start)
      return `${moveTo(startPos)}${withEraseLineToEnd(tail)}${ansi.eraseToEnd}`
    },
    delete(range: TerminalRange) {
      return surface.replace(range, '')
    },
  }
  return surface
}

export function applyReplace(text: string, range: TerminalRange, replacement: string) {
  const { start, endExclusive } = normalizeRange(text, range)
  return `${text.slice(0, start)}${replacement}${text.slice(endExclusive)}`
}

export function applyInsert(text: string, at: TerminalPos, insertion: string) {
  const index = posToIndex(text, at)
  return `${text.slice(0, index)}${insertion}${text.slice(index)}`
}
