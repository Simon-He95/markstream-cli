import type { TerminalPos, TerminalRange } from './terminal'
import process from 'node:process'
import { ansi, createAnchoredTextSurface } from './terminal'

export interface WritableLike {
  write: (chunk: string) => unknown
  isTTY?: boolean
}

export interface TerminalSessionOptions {
  stream?: WritableLike
  /**
   * Wrap writes with terminal synchronized updates when supported.
   * @default true
   */
  sync?: boolean
  /**
   * Hide cursor during session; restored on `stop()`.
   * @default true
   */
  hideCursor?: boolean
  /**
   * Clear screen + home cursor on `start()`.
   * @default false
   */
  clear?: boolean
  /**
   * Use the terminal alternate screen buffer for the session.
   * Typically avoids polluting the normal scrollback with intermediate renders.
   * @default false
   */
  altScreen?: boolean
}

export function pos(line: number, column: number): TerminalPos {
  return { line, column }
}

export function range(startLine: number, startColumn: number, endLine: number, endColumn: number): TerminalRange {
  return { start: pos(startLine, startColumn), end: pos(endLine, endColumn) }
}

export interface TerminalSession {
  start: () => void
  stop: () => void
  writeRaw: (chunk: string) => void

  setText: (text: string) => void
  append: (text: string) => void
  replace: (r: TerminalRange, replacement: string) => void
  delete: (r: TerminalRange) => void
  insert: (p: TerminalPos, insertion: string) => void
}

export function createTerminalSession(options: TerminalSessionOptions = {}): TerminalSession {
  const stream = options.stream ?? (process.stdout as unknown as WritableLike)
  const sync = options.sync ?? true
  const hideCursor = options.hideCursor ?? true
  const clear = options.clear ?? false
  const altScreen = options.altScreen ?? false

  const surface = createAnchoredTextSurface()

  function writeRaw(chunk: string) {
    if (!chunk)
      return
    stream.write(chunk)
  }

  function write(chunk: string) {
    if (!chunk)
      return
    if (sync)
      writeRaw(`${ansi.syncStart}${chunk}${ansi.syncEnd}`)
    else
      writeRaw(chunk)
  }

  return {
    start() {
      if (altScreen)
        writeRaw(ansi.altScreenEnter)
      if (clear)
        writeRaw(`${ansi.clearScreen}${ansi.cursorHome}`)
      if (hideCursor)
        writeRaw(ansi.hideCursor)
    },
    stop() {
      writeRaw(`${ansi.syncEnd}${ansi.showCursor}`)
      if (altScreen)
        writeRaw(ansi.altScreenExit)
    },
    writeRaw,
    setText(text: string) {
      write(surface.setText(text))
    },
    append(text: string) {
      write(surface.append(text))
    },
    replace(r: TerminalRange, replacement: string) {
      write(surface.replace(r, replacement))
    },
    delete(r: TerminalRange) {
      write(surface.delete(r))
    },
    insert(p: TerminalPos, insertion: string) {
      write(surface.insert(p, insertion))
    },
  }
}
