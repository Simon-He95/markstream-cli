import type { TerminalPos } from 'markstream-terminal'
import type { MarkdownIt, ParsedNode, ParseOptions } from 'stream-markdown-parser'
import type { RenderOptions } from './render'
import { createAnchoredTextSurface, indexToPos, posToIndex } from 'markstream-terminal'
import { getMarkdown, parseMarkdownToStructure } from 'stream-markdown-parser'
import { findStreamingLoadingCodeBlock } from './markdown-node-utils'
import { normalizeMarkdownInput } from './normalize-markdown-input'
import { renderNodesToAnsi } from './render'
import { sanitizeTerminalText } from './sanitize'

export interface MarkdownStreamRendererOptions {
  md?: MarkdownIt
  parse?: ParseOptions
  render?: RenderOptions
  /**
   * How to anchor cursor movements in generated patches:
   * - `cursor`: use save/restore cursor (best for inline updates after a prompt)
   * - `home`: use cursor home as the anchor (best inside alternate screen)
   * @default 'cursor'
   */
  anchor?: 'cursor' | 'home'
  /**
   * Optional streaming viewport height (in terminal rows). When provided, the
   * renderer only outputs the last N lines to avoid scrolling during redraws.
   *
   * The full render is still available via `getFullRenderedText()`.
   */
  viewportHeight?: number
  /**
   * Rendering strategy:
   * - `smart`: append when possible; rewrite only when a code block completes
   * - `redraw`: always rewrite the whole output from the anchored start ("line 0")
   * @default 'smart'
   */
  strategy?: 'smart' | 'redraw'
  /**
   * When output cannot be expressed as an append or a supported in-place rewrite,
   * fall back to a full redraw (clear screen + print full render).
   * @default true
   */
  fullRedrawOnMismatch?: boolean
  /**
   * Called when an async highlight finishes and a patch is ready to be written.
   * Useful for real TTY demos where you want to immediately apply the rewrite.
   */
  onPatch?: (patch: string) => void
}

export interface MarkdownStreamRenderer {
  push: (chunk: string) => string
  /**
   * Wait for any pending async highlights and return the generated patches
   * (also emitted via `onPatch`).
   */
  flush: () => Promise<string[]>
  reset: () => void
  getContent: () => string
  /**
   * Returns the latest fully-rendered output (what the terminal should display),
   * without any cursor movement / erase control sequences.
   */
  getRenderedText: () => string
  /**
   * Returns the latest full rendered output (unclipped), even when
   * `viewportHeight` is enabled.
   */
  getFullRenderedText: () => string
}

function findLineStart(s: string, index: number) {
  const nl = s.lastIndexOf('\n', Math.max(0, index - 1))
  return nl === -1 ? 0 : nl + 1
}

function findLastFenceLineStart(rendered: string) {
  const idx = rendered.lastIndexOf('```')
  if (idx === -1)
    return null
  return findLineStart(rendered, idx)
}

export function createMarkdownStreamRenderer(options: MarkdownStreamRendererOptions = {}): MarkdownStreamRenderer {
  const md = options.md ?? getMarkdown()
  const parseOptions = options.parse
  const renderOptions = options.render
  const viewportHeight = options.viewportHeight
  const anchor = options.anchor ?? 'cursor'
  const strategy = options.strategy ?? 'smart'
  const fullRedrawOnMismatch = options.fullRedrawOnMismatch ?? true
  const highlightFn = renderOptions?.highlightCode
  const rewriteOnCodeComplete = Boolean(highlightFn)
  const allowControlSequences = Boolean(renderOptions?.allowControlSequences)

  let content = ''
  let lastCodeWasLoading = false
  let codeStartPos: TerminalPos | null = null
  const surface = createAnchoredTextSurface({ anchor })
  let lastFullRendered = ''
  let generation = 0

  const highlightCache = new Map<string, string>()
  const inflightHighlights = new Map<string, Promise<void>>()
  const pending = new Set<Promise<void>>()
  let patchQueue: string[] = []

  function highlightKeyFromInput(code: string, language: string) {
    return `${language}\u0000${code.replace(/\n$/, '')}`
  }

  function highlightSource(code: string) {
    return allowControlSequences ? code : sanitizeTerminalText(code)
  }

  function emitPatch(patch: string) {
    if (!patch)
      return
    patchQueue.push(patch)
    options.onPatch?.(patch)
  }

  function tailLines(text: string, maxLines: number) {
    if (!Number.isFinite(maxLines) || maxLines <= 0)
      return ''
    const rawLines = text.split('\n')
    if (rawLines.length > 0 && rawLines[rawLines.length - 1] === '')
      rawLines.pop()
    const tail = rawLines.slice(Math.max(0, rawLines.length - maxLines))
    return `${tail.join('\n')}\n`
  }

  function renderAll(nodes: ParsedNode[]) {
    const cachedHighlight = highlightFn
      ? (code: string, language: string) => highlightCache.get(highlightKeyFromInput(code, language))
      : undefined
    const full = renderNodesToAnsi(nodes, { ...renderOptions, streaming: true, highlightCode: cachedHighlight as any })
    lastFullRendered = full
    return typeof viewportHeight === 'number' ? tailLines(full, viewportHeight) : full
  }

  function runHighlightOnce(key: string, code: string, language: string, onHighlighted?: () => void) {
    if (!highlightFn)
      return undefined

    if (highlightCache.has(key))
      return highlightCache.get(key)

    const existing = inflightHighlights.get(key)
    if (existing)
      return existing

    const highlight = highlightFn!
    const gen = generation
    const res = highlight(code, language)

    if (typeof res === 'string') {
      highlightCache.set(key, res)
      return res
    }

    if (res instanceof Promise) {
      const task = res.then((highlighted) => {
        if (gen !== generation)
          return

        highlightCache.set(key, highlighted)
        onHighlighted?.()
      }).catch(() => {
        // ignore highlight failures
      }).finally(() => {
        if (inflightHighlights.get(key) === task)
          inflightHighlights.delete(key)
      })

      inflightHighlights.set(key, task)
      pending.add(task)
      void task.finally(() => pending.delete(task))
      return task
    }

    return undefined
  }

  function scheduleHighlights(nodes: ParsedNode[], skipKey?: string) {
    if (!highlightFn)
      return

    const streamingLoading = findStreamingLoadingCodeBlock(nodes)

    function visit(node: any) {
      if (!node || typeof node !== 'object')
        return

      if (node.type === 'code_block') {
        // Treat non-tail loading blocks as complete (parser quirk in some nested cases)
        const isTrulyLoading = Boolean(node.loading) && node === streamingLoading
        if (isTrulyLoading)
          return

        const code = String(node.code ?? '').replace(/\n$/, '')
        const language = String(node.language ?? '')
        const input = highlightSource(code)
        const key = highlightKeyFromInput(input, language)

        if (skipKey && key === skipKey)
          return

        runHighlightOnce(key, input, language, () => {
          const nodesNow = parseMarkdownToStructure(normalizeMarkdownInput(content), md, parseOptions)
          const nextRendered = renderAll(nodesNow)
          emitPatch(surface.setText(nextRendered))
        })
        return
      }

      const children = node.children
      if (Array.isArray(children)) {
        for (const child of children)
          visit(child)
      }

      const items = node.items
      if (Array.isArray(items)) {
        for (const item of items)
          visit(item)
      }
    }

    for (const n of nodes)
      visit(n)
  }

  function fullRedraw(nextRendered: string) {
    lastCodeWasLoading = false
    codeStartPos = null
    return surface.setText(nextRendered)
  }

  return {
    push(chunk: string) {
      content += chunk

      const nodes = parseMarkdownToStructure(normalizeMarkdownInput(content), md, parseOptions)
      const prevRendered = surface.getText()

      const lastNode = nodes[nodes.length - 1]
      const isCode = lastNode?.type === 'code_block'
      const isLoading = isCode ? Boolean((lastNode as any).loading) : false
      const prevCodeWasLoading = lastCodeWasLoading

      // If the stream-tail code block just completed, let the existing in-place
      // rewrite logic handle its highlight scheduling to preserve patch shapes.
      let skipHighlightKey: string | undefined
      if (highlightFn && isCode && !isLoading && prevCodeWasLoading) {
        const node = lastNode as any
        const code = String(node.code ?? '').replace(/\n$/, '')
        const language = String(node.language ?? '')
        const input = highlightSource(code)
        skipHighlightKey = highlightKeyFromInput(input, language)
      }

      scheduleHighlights(nodes, skipHighlightKey)

      // If the last node is a code block that just completed, precompute highlight:
      // - sync highlight => cache now and do an in-place rewrite immediately
      // - async highlight => render without highlight now (append-only), then rewrite later
      let completedCodeHighlight: string | Promise<void> | undefined
      if (rewriteOnCodeComplete && isCode && !isLoading && prevCodeWasLoading) {
        const node = lastNode as any
        const code = String(node.code ?? '').replace(/\n$/, '')
        const language = String(node.language ?? '')
        const startPos = codeStartPos
        const input = highlightSource(code)
        const completedCodeKey = highlightKeyFromInput(input, language)
        completedCodeHighlight = runHighlightOnce(completedCodeKey, input, language, () => {
          const nodesNow = parseMarkdownToStructure(normalizeMarkdownInput(content), md, parseOptions)
          const nextRendered = renderAll(nodesNow)

          if (strategy === 'redraw') {
            emitPatch(surface.setText(nextRendered))
            return
          }

          if (!startPos) {
            emitPatch(surface.setText(nextRendered))
            return
          }

          const currentRendered = surface.getText()
          const startIndexPrev = posToIndex(currentRendered, startPos)
          if (nextRendered.slice(0, startIndexPrev) !== currentRendered.slice(0, startIndexPrev)) {
            emitPatch(surface.setText(nextRendered))
            return
          }

          emitPatch(surface.setTextFrom(nextRendered, startPos))
        })
      }

      const rendered = renderAll(nodes)

      if (isCode && isLoading) {
        lastCodeWasLoading = true
        if (!prevCodeWasLoading) {
          const startIndex = findLastFenceLineStart(rendered)
          codeStartPos = (strategy === 'redraw' || startIndex == null) ? null : indexToPos(rendered, startIndex)
        }
      }
      else if (
        rewriteOnCodeComplete
        && isCode
        && !isLoading
        && prevCodeWasLoading
        && typeof completedCodeHighlight === 'string'
      ) {
        lastCodeWasLoading = false
        if (strategy === 'redraw') {
          codeStartPos = null
          return surface.setText(rendered)
        }
        if (!codeStartPos) {
          if (!fullRedrawOnMismatch)
            throw new Error('Unable to locate fenced code block start for in-place rewrite')
          return fullRedraw(rendered)
        }

        const startIndexPrev = posToIndex(prevRendered, codeStartPos)
        if (rendered.slice(0, startIndexPrev) !== prevRendered.slice(0, startIndexPrev)) {
          if (!fullRedrawOnMismatch)
            throw new Error('Prefix changed before code block; cannot do in-place rewrite')
          return fullRedraw(rendered)
        }

        const patch = surface.setTextFrom(rendered, codeStartPos)
        codeStartPos = null
        return patch
      }
      else if (
        rewriteOnCodeComplete
        && isCode
        && !isLoading
        && prevCodeWasLoading
        && completedCodeHighlight instanceof Promise
      ) {
        lastCodeWasLoading = false
        codeStartPos = null
      }
      else {
        lastCodeWasLoading = false
        codeStartPos = null
      }

      if (strategy === 'redraw')
        return surface.setText(rendered)

      if (rendered.startsWith(prevRendered)) {
        const delta = rendered.slice(prevRendered.length)
        return surface.append(delta)
      }

      if (!fullRedrawOnMismatch)
        throw new Error('Non-append render update; enable fullRedrawOnMismatch to allow redraw fallback')
      return fullRedraw(rendered)
    },
    async flush() {
      await Promise.allSettled([...pending])
      const out = patchQueue
      patchQueue = []
      return out
    },
    reset() {
      generation += 1
      content = ''
      lastCodeWasLoading = false
      codeStartPos = null
      highlightCache.clear()
      inflightHighlights.clear()
      pending.clear()
      patchQueue = []
      surface.setText('')
    },
    getContent() {
      return content
    },
    getRenderedText() {
      return surface.getText()
    },
    getFullRenderedText() {
      return lastFullRendered
    },
  }
}
