import type { MarkdownIt, ParsedNode, ParseOptions } from 'stream-markdown-parser'
import type { RenderOptions } from './render'
import type { MarkdownStreamRenderer, MarkdownStreamRendererOptions } from './stream'
import { getMarkdown, parseMarkdownToStructure } from 'stream-markdown-parser'
import { normalizeMarkdownInput } from './normalize-markdown-input'
import { renderNodesToAnsi } from './render'
import { createShikiHighlightCode } from './shiki-highlight'
import { createMarkdownStreamRenderer } from './stream'
import { streamMarkdownToTerminal } from './stream-to-terminal'
import { createTerminalMarkdownStream } from './terminal-markdown-stream'

export type { ShikiHighlightOptions } from './shiki-highlight'

interface HighlightMarkdownOptions {
  parse?: ParseOptions
  render?: RenderOptions
  md?: MarkdownIt
}

let defaultMd: MarkdownIt | undefined
export function getDefaultMarkdown() {
  defaultMd ??= getMarkdown()
  return defaultMd
}

export function parseMarkdown(content: string, options?: ParseOptions, md: MarkdownIt = getDefaultMarkdown()): ParsedNode[] {
  return parseMarkdownToStructure(normalizeMarkdownInput(content), md, options)
}

export function highlightMarkdown(
  content: string,
  options?: HighlightMarkdownOptions,
) {
  const md = options?.md ?? getDefaultMarkdown()
  const nodes = parseMarkdownToStructure(normalizeMarkdownInput(content), md, options?.parse)
  return renderNodesToAnsi(nodes, options?.render)
}

export async function highlightMarkdownAsync(
  content: string,
  options?: HighlightMarkdownOptions,
) {
  const md = options?.md ?? getDefaultMarkdown()
  const nodes = parseMarkdownToStructure(normalizeMarkdownInput(content), md, options?.parse)
  const highlightCode = options?.render?.highlightCode

  if (!highlightCode)
    return renderNodesToAnsi(nodes, options?.render)

  const cache = new Map<string, string>()
  const inflight = new Map<string, Promise<void>>()
  const pending: Promise<void>[] = []
  const cachedHighlight = (code: string, language: string): any => {
    const key = `${language}\u0000${code.replace(/\n$/, '')}`
    const cached = cache.get(key)
    if (cached != null)
      return cached

    if (inflight.has(key))
      return undefined

    const highlighted = highlightCode(code, language)
    if (typeof highlighted === 'string') {
      cache.set(key, highlighted)
      return highlighted
    }

    if (highlighted instanceof Promise) {
      const task = highlighted.then((value) => {
        cache.set(key, value)
      })
      inflight.set(key, task)
      pending.push(task)
    }

    return undefined
  }
  const render: RenderOptions = {
    ...options?.render,
    highlightCode: cachedHighlight,
  }

  const first = renderNodesToAnsi(nodes, render)
  if (pending.length === 0)
    return first

  await Promise.all(pending)
  return renderNodesToAnsi(nodes, render)
}

export { renderNodesToAnsi }
export type { RenderOptions }

export { createMarkdownStreamRenderer }
export type { MarkdownStreamRenderer, MarkdownStreamRendererOptions }

export { createTerminalMarkdownStream }
export type { MarkdownChunkSource, StreamMarkdownToTerminalOptions, StreamMarkdownToTerminalResult } from './stream-to-terminal'

export { createShikiHighlightCode }
export type { TerminalMarkdownStream, TerminalMarkdownStreamOptions } from './terminal-markdown-stream'

export { streamMarkdownToTerminal }
export type { TerminalPos, TerminalRange, TerminalSession, TerminalSessionOptions, WritableLike } from 'markstream-terminal'
export { ansi, applyInsert, applyReplace, createAnchoredTextSurface, createTerminalSession, indexToPos, pos, posToIndex, range, stripAnsi, visibleCellWidth, visibleLength } from 'markstream-terminal'
