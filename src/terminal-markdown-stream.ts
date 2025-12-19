import type { TerminalSession, TerminalSessionOptions } from 'markstream-terminal'
import type { RenderOptions } from './render'
import type { MarkdownStreamRenderer, MarkdownStreamRendererOptions } from './stream'
import process from 'node:process'
import { ansi, createTerminalSession } from 'markstream-terminal'
import { createMarkdownStreamRenderer } from './stream'

function isTerminalSession(x: any): x is TerminalSession {
  return Boolean(x && typeof x === 'object' && typeof x.start === 'function' && typeof x.stop === 'function' && typeof x.writeRaw === 'function')
}

function defaultWidthFromColumns(columns: number) {
  const c = Number.isFinite(columns) ? columns : 80
  // Keep rendering stable and avoid super-wide output by default.
  return Math.max(20, Math.min(80, c - 2))
}

function defaultHeightFromRows(rows: number) {
  const r = Number.isFinite(rows) ? rows : 24
  // Reserve a couple lines for prompt/spacing; clamp to avoid huge redraws.
  return Math.max(6, Math.min(40, r - 2))
}

function resolveNumberOption(value: number | ((n: number) => number) | undefined, measured: number, fallback: number) {
  if (typeof value === 'number')
    return value
  if (typeof value === 'function')
    return value(measured)
  return fallback
}

interface TerminalStreamingPolicy {
  isTTY: boolean
  useAltScreenForStreaming: boolean
  noScrollDuringStreaming: boolean
  viewportHeight?: number
  anchor: 'cursor' | 'home'
  strategy: 'smart' | 'redraw'
}

export interface TerminalMarkdownStreamOptions extends Omit<MarkdownStreamRendererOptions, 'onPatch' | 'render'> {
  terminal?: TerminalSession | TerminalSessionOptions
  /**
   * Render in an alternate screen during streaming, then print only the final
   * result back to the normal screen on stop.
   *
   * This avoids leaving intermediate streaming frames in the user's scrollback.
   * @default true
   */
  finalOnly?: boolean
  /**
   * Wrap patch writes in terminal synchronized updates.
   * @default true
   */
  sync?: boolean
  /**
   * Start the session on a fresh line so the initial `\r` doesn't overwrite prompts.
   * @default true
   */
  startOnNewLine?: boolean
  /**
   * If true, throw when the target stream is not a TTY.
   * @default true
   */
  requireTTY?: boolean
  /**
   * Auto width used to update `render.width` before each push.
   * If omitted, uses any provided `render.width`.
   */
  width?: number | ((columns: number) => number)
  /**
   * Auto height used to set streaming viewport (`viewportHeight`) when `finalOnly`
   * is enabled. If omitted, uses `process.stdout.rows - 2` with a sane clamp.
   */
  height?: number | ((rows: number) => number)
  /**
   * Debug instrumentation for patch behavior (logs to stderr by default).
   * Prefer controlling this via options (avoid env-coupling in library code).
   */
  debug?: boolean | { patches?: boolean, logger?: (msg: string) => void }
  render?: RenderOptions
}

export interface TerminalMarkdownStream {
  term: TerminalSession
  renderer: MarkdownStreamRenderer
  start: () => void
  stop: () => void
  push: (chunk: string) => void
  flush: () => Promise<void>
  reset: () => void
  getContent: () => string
}

export function createTerminalMarkdownStream(options: TerminalMarkdownStreamOptions = {}): TerminalMarkdownStream {
  const sync = options.sync ?? true
  const startOnNewLine = options.startOnNewLine ?? true
  const requireTTY = options.requireTTY ?? true
  const finalOnly = options.finalOnly ?? true

  let term: TerminalSession
  let streamIsTTY: boolean | undefined
  let policy: TerminalStreamingPolicy = {
    isTTY: true,
    useAltScreenForStreaming: false,
    noScrollDuringStreaming: false,
    viewportHeight: options.viewportHeight,
    anchor: options.anchor ?? 'cursor',
    strategy: options.strategy ?? 'smart',
  }

  if (isTerminalSession(options.terminal)) {
    term = options.terminal
    // If a session is provided, assume it's a real TTY unless the caller
    // explicitly disables `finalOnly`.
    streamIsTTY = true
  }
  else {
    const termOptions = options.terminal ?? {}
    streamIsTTY = termOptions.stream?.isTTY ?? (process.stdout as any)?.isTTY
    const isTTY = streamIsTTY !== false

    const rows = Math.max(0, Number((process.stdout as any)?.rows ?? 0))

    const resolvedHeight = resolveNumberOption(options.height, rows, defaultHeightFromRows(rows || 24))
    const resolvedViewportHeight = (options.viewportHeight == null && finalOnly && isTTY) ? resolvedHeight : options.viewportHeight

    // Avoid emitting TTY-only control sequences into non-TTY streams (pipes/files).
    //
    // In `finalOnly` mode, the only robust way to prevent intermediate frames
    // from polluting scrollback is to stream inside the alternate screen buffer.
    // Some terminals optionally "dump" the alternate buffer into scrollback on
    // exit; we handle that by clearing it before leaving.
    const useAltScreenForStreaming = Boolean(finalOnly) && isTTY
    // Some terminals can still save alternate-screen output to scrollback.
    // Avoid emitting real linefeeds during streaming to prevent repeated frames
    // from appearing as duplicated history.
    const noScrollDuringStreaming = Boolean(finalOnly) && isTTY

    const strategy = options.strategy ?? ((finalOnly && isTTY) ? 'redraw' : 'smart')
    const anchor = (finalOnly && isTTY) ? 'home' : (options.anchor ?? 'cursor')

    policy = {
      isTTY,
      useAltScreenForStreaming,
      noScrollDuringStreaming,
      viewportHeight: resolvedViewportHeight,
      anchor,
      strategy,
    }

    term = createTerminalSession({ ...termOptions, altScreen: useAltScreenForStreaming || termOptions.altScreen })
  }

  if (requireTTY && streamIsTTY === false)
    throw new Error('Terminal markdown streaming requires a TTY stream.')

  const debugOpt = options.debug
  const debugEnabled = Boolean(typeof debugOpt === 'boolean' ? debugOpt : debugOpt != null)
  const debugPatches = Boolean(typeof debugOpt === 'object' ? debugOpt.patches : false)
  const debugLog = (typeof debugOpt === 'object' && debugOpt.logger)
    ? debugOpt.logger
    : (msg: string) => process.stderr.write(`${msg}\n`)

  let patchCount = 0
  let patchBytes = 0
  let patchLfBefore = 0
  let patchLfAfter = 0

  function countChar(s: string, ch: string) {
    let n = 0
    for (let i = 0; i < s.length; i++) {
      if (s[i] === ch)
        n++
    }
    return n
  }

  function writePatch(patch: string) {
    if (!patch)
      return
    patchCount += 1
    patchBytes += patch.length
    const lfBefore = countChar(patch, '\n')
    patchLfBefore += lfBefore

    // If we stream by repeatedly rewriting multi-line content with `\n`, some
    // terminals will accumulate those frames in scrollback. Convert linefeeds
    // into cursor movements so intermediate frames don't scroll.
    if (policy.noScrollDuringStreaming) {
      patch = patch.replaceAll('\n', `${ansi.carriageReturn}${ansi.cursorDown(1)}`)
    }
    const lfAfter = countChar(patch, '\n')
    patchLfAfter += lfAfter

    if (debugPatches) {
      // Avoid overwhelming the terminal; sample patch logs.
      const shouldLog = patchCount <= 10 || patchCount % 200 === 0
      if (shouldLog)
        debugLog(`[markstream] patch#${patchCount} bytes=${patch.length} lf(before=${lfBefore},after=${lfAfter})`)
    }
    if (sync)
      term.writeRaw(`${ansi.syncStart}${patch}${ansi.syncEnd}`)
    else
      term.writeRaw(patch)
  }

  const render = { ...(options.render ?? {}) }

  function resolveWidth() {
    const columns = Math.max(0, Number((process.stdout as any)?.columns ?? 0))
    const resolved = resolveNumberOption(options.width, columns, render.width ?? defaultWidthFromColumns(columns || 80))
    return resolved
  }

  const renderer = createMarkdownStreamRenderer({
    ...options,
    strategy: policy.strategy,
    viewportHeight: policy.viewportHeight,
    anchor: policy.anchor,
    render,
    onPatch: writePatch,
  })

  return {
    term,
    renderer,
    start() {
      term.start()
      if (debugEnabled) {
        debugLog(`[markstream] start finalOnly=${finalOnly} tty=${policy.isTTY} altScreen=${policy.useAltScreenForStreaming} noScroll=${policy.noScrollDuringStreaming} viewportHeight=${policy.viewportHeight ?? 'none'} anchor=${policy.anchor} strategy=${policy.strategy}`)
      }
      // `startOnNewLine` is meant to avoid overwriting prompts. When using the
      // alternate screen buffer, it isn't necessary and just wastes a line.
      if (startOnNewLine && !policy.useAltScreenForStreaming)
        term.writeRaw('\n')
    },
    stop() {
      const finalRendered = finalOnly ? renderer.getFullRenderedText() : ''

      // In final-only mode, rewrite the anchored region with the final render
      // and *then* stop the session. This prevents intermediate frames from
      // being left in scrollback (when combined with no-scroll patches).
      if (finalRendered && !policy.useAltScreenForStreaming) {
        const normalized = finalRendered.endsWith('\n') ? finalRendered : `${finalRendered}\n`
        term.writeRaw(`${ansi.restoreCursor}${ansi.eraseToEnd}${normalized}`)
        term.stop()
        return
      }

      // If streaming inside the alternate screen buffer, clear it right before
      // exiting. This prevents terminals that "dump" the alternate buffer into
      // scrollback from preserving intermediate frames.
      if (finalOnly && policy.useAltScreenForStreaming)
        term.writeRaw(`${ansi.clearScreen}${ansi.cursorHome}${ansi.eraseScrollback ?? ''}`)

      term.stop()
      // If the caller explicitly enabled alternate screen, print the final
      // result back on the normal screen after exiting.
      if (finalRendered && policy.useAltScreenForStreaming) {
        if (startOnNewLine)
          term.writeRaw('\n')
        term.writeRaw(finalRendered.endsWith('\n') ? finalRendered : `${finalRendered}\n`)
      }

      if (debugEnabled) {
        debugLog(`[markstream] stop patches=${patchCount} bytes=${patchBytes} lf(before=${patchLfBefore},after=${patchLfAfter}) finalBytes=${finalRendered.length}`)
      }
    },
    push(chunk: string) {
      const width = resolveWidth()
      if (typeof width === 'number')
        render.width = width

      writePatch(renderer.push(chunk))
    },
    async flush() {
      const patches = await renderer.flush()
      for (const p of patches)
        writePatch(p)
    },
    reset() {
      renderer.reset()
    },
    getContent() {
      return renderer.getContent()
    },
  }
}
