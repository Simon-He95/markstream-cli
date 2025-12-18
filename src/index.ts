import type { MarkdownIt, ParsedNode, ParseOptions } from 'stream-markdown-parser'
import type { RenderOptions } from './render'
import { getMarkdown, parseMarkdownToStructure } from 'stream-markdown-parser'
import { renderNodesToAnsi } from './render'

let defaultMd: MarkdownIt | undefined
export function getDefaultMarkdown() {
  defaultMd ??= getMarkdown()
  return defaultMd
}

export function parseMarkdown(content: string, options?: ParseOptions, md: MarkdownIt = getDefaultMarkdown()): ParsedNode[] {
  return parseMarkdownToStructure(content, md, options)
}

export function highlightMarkdown(
  content: string,
  options?: { parse?: ParseOptions, render?: RenderOptions, md?: MarkdownIt },
) {
  const md = options?.md ?? getDefaultMarkdown()
  const nodes = parseMarkdownToStructure(content, md, options?.parse)
  return renderNodesToAnsi(nodes, options?.render)
}

export { renderNodesToAnsi }
export type { RenderOptions }
