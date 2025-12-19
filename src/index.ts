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
  options?: { parse?: ParseOptions, render?: RenderOptions, md?: MarkdownIt },
) {
  const md = options?.md ?? getDefaultMarkdown()
  const nodes = parseMarkdownToStructure(normalizeMarkdownInput(content), md, options?.parse)
  return renderNodesToAnsi(nodes, options?.render)
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
export * from 'markstream-terminal'
