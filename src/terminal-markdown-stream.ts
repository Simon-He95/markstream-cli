import type { TerminalSession, TerminalSessionOptions } from 'markstream-terminal'
import type { RenderOptions } from './render'
import type { MarkdownStreamRenderer, MarkdownStreamRendererOptions } from './stream'
import process from 'node:process'
import { ansi, createTerminalSession, visibleCellWidth } from 'markstream-terminal'
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

export interface LoadingIndicatorOptions {
  /**
   * Spinner frames (rotated in order).
   * @default ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏']
   */
  frames?: string[]
  /**
   * Interval between frames.
   * @default 80
   */
  intervalMs?: number
  /**
   * Text shown next to the spinner.
   * @default 'Loading...'
   */
  text?: string
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
   * Streaming policy for `finalOnly` when output is a TTY:
   * - `inPlace`: stream on the normal screen using cursor movements (avoids alt-screen dump gaps)
   * - `altScreen`: stream inside the alternate screen buffer (full-screen experience)
   * @default 'inPlace'
   */
  finalOnlyMode?: 'inPlace' | 'altScreen'
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
  /**
   * Show a bottom loading spinner while streaming (TTY + finalOnly recommended).
   * The spinner is not included in the final rendered output.
   *
   * When enabled with `finalOnly` + TTY and a streaming viewport height, one row
   * is reserved for the indicator.
   */
  loadingIndicator?: boolean | LoadingIndicatorOptions
  /**
   * How to print the final render back to the normal screen when `finalOnly`
   * is enabled and we streamed inside the alternate screen buffer.
   *
   * - `append`: keep the previous screen visible; print below the prompt
   * - `clearScreen`: clear the visible screen (does not clear scrollback) and print from top
   * - `auto`: choose `clearScreen` when output likely exceeds viewport
   * @default 'clearScreen'
   */
  finalOutput?: 'append' | 'clearScreen' | 'auto'
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
    // Some terminals "dump" alternate-screen output into scrollback, which can
    // create a huge blank gap after the command. Default to in-place streaming
    // on the normal screen to avoid that class of issues.
    const finalOnlyMode = options.finalOnlyMode ?? 'inPlace'
    const useAltScreenForStreaming = Boolean(finalOnly) && isTTY && finalOnlyMode === 'altScreen'

    // Avoid emitting real linefeeds during streaming so intermediate frames don't
    // scroll and pollute history (works for both in-place and alt-screen modes).
    const noScrollDuringStreaming = Boolean(finalOnly) && isTTY

    const strategy = options.strategy ?? ((finalOnly && isTTY) ? 'redraw' : 'smart')
    const anchor = options.anchor ?? (useAltScreenForStreaming ? 'home' : 'cursor')

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
      // Prevent the terminal from auto-scrolling to a cursor position that
      // drifts downward across frames (can look like huge blank gaps).
      patch += (policy.anchor === 'home' ? ansi.cursorHome : ansi.restoreCursor)
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

  const loadingOpt = options.loadingIndicator
  const defaultLoadingEnabled = finalOnly && policy.isTTY
  const loadingEnabledRequested = (typeof loadingOpt === 'boolean')
    ? loadingOpt
    : (loadingOpt != null || defaultLoadingEnabled)

  // Only enable the spinner when we can reliably position it without clobbering
  // cursor save/restore state (home anchor avoids conflicts).
  let loadingEnabled = Boolean(loadingEnabledRequested)
    && finalOnly
    && policy.isTTY
    && typeof policy.viewportHeight === 'number'
    && policy.viewportHeight >= 2

  const loadingFrames = (typeof loadingOpt === 'object' && loadingOpt.frames?.length)
    ? loadingOpt.frames
    : ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
  const loadingIntervalMs = (typeof loadingOpt === 'object' && typeof loadingOpt.intervalMs === 'number')
    ? Math.max(16, loadingOpt.intervalMs)
    : 80
  const loadingText = (typeof loadingOpt === 'object' && typeof loadingOpt.text === 'string')
    ? loadingOpt.text
    : 'Loading...'

  const totalViewportHeight = policy.viewportHeight
  const contentViewportHeight = (loadingEnabled && typeof totalViewportHeight === 'number')
    ? Math.max(1, totalViewportHeight - 1)
    : totalViewportHeight

  // If we can't reserve a line, disable the indicator.
  if (loadingEnabled && typeof contentViewportHeight === 'number' && contentViewportHeight < 1)
    loadingEnabled = false

  const loadingLine = (loadingEnabled && typeof totalViewportHeight === 'number')
    ? totalViewportHeight
    : null

  let loadingFrameIndex = 0
  let loadingTimer: any | undefined
  let hasAnchoredOutput = false

  function truncateToCells(text: string, maxCells: number) {
    if (!Number.isFinite(maxCells) || maxCells <= 0)
      return ''
    if (visibleCellWidth(text) <= maxCells)
      return text

    let out = ''
    let width = 0
    for (let i = 0; i < text.length; i++) {
      const cp = text.codePointAt(i)!
      // Best-effort: treat common wide ranges as 2 (reuse terminal's util by measuring progressively).
      // This keeps us dependency-free here while still avoiding wraps.
      const next = out + String.fromCodePoint(cp)
      const nextWidth = visibleCellWidth(next)
      if (nextWidth > maxCells)
        break
      out = next
      width = nextWidth
      if (cp > 0xFFFF)
        i++
    }
    return out
  }

  function renderLoadingPatch() {
    if (!loadingEnabled || !loadingLine)
      return ''

    const width = resolveWidth()
    const frame = loadingFrames[loadingFrameIndex % loadingFrames.length] ?? ''
    const raw = `${frame} ${loadingText}`
    const lineText = typeof width === 'number' ? truncateToCells(raw, Math.max(1, width)) : raw

    const down = Math.max(0, loadingLine - 1)
    const base = policy.anchor === 'home' ? ansi.cursorHome : ansi.restoreCursor
    return `${base}${down > 0 ? ansi.cursorDown(down) : ''}${ansi.carriageReturn}${lineText}${ansi.eraseLineToEnd}`
  }

  function writeLoadingFrame() {
    if (!loadingEnabled)
      return
    if (policy.anchor === 'cursor' && !hasAnchoredOutput)
      return
    writePatch(renderLoadingPatch())
  }

  function startLoading() {
    if (!loadingEnabled || loadingTimer)
      return

    // Show immediately.
    writeLoadingFrame()

    loadingTimer = setInterval(() => {
      loadingFrameIndex += 1
      writeLoadingFrame()
    }, loadingIntervalMs)

    // Don't keep the process alive just for the animation (important for tests).
    loadingTimer?.unref?.()
  }

  function stopLoading() {
    if (!loadingTimer)
      return
    clearInterval(loadingTimer)
    loadingTimer = undefined
  }

  // The loading indicator paints outside the markdown surface, so we must avoid
  // append-only patches that depend on the current cursor position.
  const rendererStrategy = (policy.noScrollDuringStreaming || loadingEnabled) ? 'redraw' : policy.strategy

  const renderer = createMarkdownStreamRenderer({
    ...options,
    strategy: rendererStrategy,
    viewportHeight: contentViewportHeight,
    anchor: policy.anchor,
    render,
    onPatch: (p) => {
      if (p)
        hasAnchoredOutput = true
      writePatch(p)
      // `setText()` ends with erase-to-end, which can wipe the indicator region.
      // Repaint after each renderer patch.
      writeLoadingFrame()
    },
  })

  return {
    term,
    renderer,
    start() {
      term.start()
      if (debugEnabled) {
        debugLog(`[markstream] start finalOnly=${finalOnly} tty=${policy.isTTY} altScreen=${policy.useAltScreenForStreaming} noScroll=${policy.noScrollDuringStreaming} viewportHeight=${policy.viewportHeight ?? 'none'} contentViewportHeight=${contentViewportHeight ?? 'none'} anchor=${policy.anchor} strategy=${rendererStrategy} loading=${loadingEnabled}`)
      }
      // `startOnNewLine` is meant to avoid overwriting prompts. When using the
      // alternate screen buffer, it isn't necessary and just wastes a line.
      if (startOnNewLine && !policy.useAltScreenForStreaming)
        term.writeRaw('\n')

      startLoading()
    },
    stop() {
      stopLoading()
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

      // Note: do not clear the alternate screen right before exit.
      // Some terminals may snapshot the alternate buffer into scrollback on exit;
      // clearing here would result in a huge blank gap in the normal screen.

      term.stop()
      // If the caller explicitly enabled alternate screen, print the final
      // result back on the normal screen after exiting.
      if (finalRendered && policy.useAltScreenForStreaming) {
        const normalized = finalRendered.endsWith('\n') ? finalRendered : `${finalRendered}\n`
        const rows = Math.max(0, Number((process.stdout as any)?.rows ?? 0)) || 24
        const lines = countChar(normalized, '\n')
        const configured = options.finalOutput ?? 'auto'
        const mode = configured === 'auto'
          ? 'clearScreen'
          : configured

        if (mode === 'clearScreen') {
          term.writeRaw(`${ansi.clearScreen}${ansi.cursorHome}${normalized}`)
        }
        else {
          if (startOnNewLine)
            term.writeRaw('\n')
          term.writeRaw(normalized)
        }
      }

      if (debugEnabled) {
        debugLog(`[markstream] stop patches=${patchCount} bytes=${patchBytes} lf(before=${patchLfBefore},after=${patchLfAfter}) finalBytes=${finalRendered.length}`)
      }
    },
    push(chunk: string) {
      const width = resolveWidth()
      if (typeof width === 'number')
        render.width = width

      const patch = renderer.push(chunk)
      if (patch)
        hasAnchoredOutput = true
      writePatch(patch)
      writeLoadingFrame()
    },
    async flush() {
      const patches = await renderer.flush()
      for (const p of patches)
        writePatch(p)
      writeLoadingFrame()
    },
    reset() {
      renderer.reset()
    },
    getContent() {
      return renderer.getContent()
    },
  }
}
