import type { CodeBlockNode, ParsedNode } from 'stream-markdown-parser'

const inlineNodeTypes = new Set([
  'text',
  'strong',
  'emphasis',
  'strikethrough',
  'highlight',
  'inline_code',
  'link',
  'image',
  'inline',
  'hardbreak',
  'math_inline',
  'footnote_reference',
  'footnote_anchor',
  'reference',
  'html_inline',
])

function visitMaybeArray(value: unknown, visit: (node: any) => void) {
  if (Array.isArray(value)) {
    for (const item of value)
      visit(item)
  }
}

/**
 * Streaming heuristic:
 * Only treat a code block as "loading" when it's the last *block* node in the
 * tree. This avoids parser quirks where some nested fenced code blocks may stay
 * `loading: true` even after being closed.
 */
export function findStreamingLoadingCodeBlock(nodes: ParsedNode[]): CodeBlockNode | null {
  let lastBlock: any | null = null

  function visit(node: any) {
    if (!node || typeof node !== 'object')
      return

    if (!inlineNodeTypes.has(node.type))
      lastBlock = node

    // Common container shapes in stream-markdown-parser.
    visitMaybeArray(node.children, visit)
    visitMaybeArray(node.items, visit)
    visitMaybeArray(node.rows, visit)
    visitMaybeArray(node.cells, visit)

    // Table header is an object, not an array.
    if (node.header && typeof node.header === 'object')
      visit(node.header)
  }

  for (const n of nodes)
    visit(n)

  if (lastBlock?.type === 'code_block' && lastBlock.loading)
    return lastBlock as CodeBlockNode

  return null
}
