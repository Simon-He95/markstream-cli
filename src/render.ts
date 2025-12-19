import type {
  AdmonitionNode,
  BlockquoteNode,
  CodeBlockNode,
  EmphasisNode,
  FootnoteAnchorNode,
  FootnoteNode,
  FootnoteReferenceNode,
  HardBreakNode,
  HeadingNode,
  HighlightNode,
  ImageNode,
  InlineCodeNode,
  InlineNode,
  LinkNode,
  ListItemNode,
  ListNode,
  MathBlockNode,
  MathInlineNode,
  ParagraphNode,
  ParsedNode,
  ReferenceNode,
  StrikethroughNode,
  StrongNode,
  TableCellNode,
  TableNode,
  TableRowNode,
  TextNode,
  ThematicBreakNode,
} from 'stream-markdown-parser'
import { visibleCellWidth } from 'markstream-terminal'
import { type AnsiStyle, applyAnsiStyle, type ColorMode, isColorEnabled, mergeAnsiStyle } from './ansi'
import { findStreamingLoadingCodeBlock } from './markdown-node-utils'

export interface RenderTheme {
  heading: (level: number) => AnsiStyle
  paragraph: AnsiStyle
  strong: AnsiStyle
  emphasis: AnsiStyle
  strikethrough: AnsiStyle
  highlight: AnsiStyle
  inlineCode: AnsiStyle
  linkText: AnsiStyle
  linkHref: AnsiStyle
  blockquoteBar: AnsiStyle
  blockquoteText: AnsiStyle
  listMarker: AnsiStyle
  codeBlockFence: AnsiStyle
  codeBlockText: AnsiStyle
  thematicBreak: AnsiStyle
  imageAlt: AnsiStyle
  imageSrc: AnsiStyle
  math: AnsiStyle
  admonitionTitle: AnsiStyle
  admonitionBody: AnsiStyle
  diffHunk: AnsiStyle
  diffAdded: AnsiStyle
  diffRemoved: AnsiStyle
  diffMeta: AnsiStyle
}

export interface RenderOptions {
  color?: ColorMode
  width?: number
  theme?: Partial<RenderTheme>
  /**
   * Enable streaming-friendly rendering for mid-state nodes (e.g. omit the
   * closing fence for `code_block.loading === true`).
   * @default false
   */
  streaming?: boolean
  /**
   * Optional syntax highlighter used only when a `code_block` is complete
   * (`loading === false`). Return value may include ANSI escape codes.
   */
  highlightCode?: (code: string, language: string) => string | Promise<string>
}

interface RenderContext {
  colorEnabled: boolean
  width?: number
  theme: RenderTheme
  indent: string
  listDepth: number
  listOrdered: boolean
  listIndex: number
  blockquoteDepth: number
  highlightCode?: RenderOptions['highlightCode']
  streaming: boolean
  streamingLoadingCodeBlock: CodeBlockNode | null
}

const defaultTheme: RenderTheme = {
  heading(level) {
    if (level <= 1)
      return { fg: 'cyan', bold: true }
    if (level === 2)
      return { fg: 'blue', bold: true }
    if (level === 3)
      return { fg: 'magenta', bold: true }
    return { fg: 'white', bold: true }
  },
  paragraph: {},
  strong: { bold: true },
  emphasis: { italic: true },
  strikethrough: { dim: true },
  highlight: { fg: 'yellow', bold: true },
  inlineCode: { fg: 'cyan' },
  linkText: { underline: true },
  linkHref: { fg: 'gray' },
  blockquoteBar: { fg: 'gray' },
  blockquoteText: { fg: 'gray' },
  listMarker: { fg: 'gray' },
  codeBlockFence: { fg: 'gray' },
  codeBlockText: { fg: 'white' },
  thematicBreak: { fg: 'gray' },
  imageAlt: { underline: true },
  imageSrc: { fg: 'gray' },
  math: { fg: 'magenta' },
  admonitionTitle: { fg: 'yellow', bold: true },
  admonitionBody: {},
  diffHunk: { fg: 'cyan', bold: true },
  diffAdded: { fg: 'green' },
  diffRemoved: { fg: 'red' },
  diffMeta: { fg: 'gray' },
}

function resolveTheme(theme: RenderOptions['theme']): RenderTheme {
  if (!theme)
    return defaultTheme
  return { ...defaultTheme, ...theme }
}

function createRootContext(options?: RenderOptions): RenderContext {
  return {
    colorEnabled: isColorEnabled(options?.color),
    width: options?.width,
    theme: resolveTheme(options?.theme),
    indent: '',
    listDepth: 0,
    listOrdered: false,
    listIndex: 0,
    blockquoteDepth: 0,
    highlightCode: options?.highlightCode,
    streaming: Boolean(options?.streaming),
    streamingLoadingCodeBlock: null,
  }
}

function styleText(text: string, style: AnsiStyle, ctx: RenderContext) {
  return applyAnsiStyle(text, style, ctx.colorEnabled)
}

function renderInlineNodes(nodes: ParsedNode[], ctx: RenderContext, inherited: AnsiStyle): string {
  let out = ''
  for (const node of nodes)
    out += renderInlineNode(node, ctx, inherited)
  return out
}

function renderInlineNode(node: ParsedNode, ctx: RenderContext, inherited: AnsiStyle): string {
  switch (node.type) {
    case 'text':
      return renderText(node as TextNode, ctx, inherited)
    case 'strong':
      return renderStrong(node as StrongNode, ctx, inherited)
    case 'emphasis':
      return renderEmphasis(node as EmphasisNode, ctx, inherited)
    case 'strikethrough':
      return renderStrikethrough(node as StrikethroughNode, ctx, inherited)
    case 'highlight':
      return renderHighlight(node as HighlightNode, ctx, inherited)
    case 'inline_code':
      return renderInlineCode(node as InlineCodeNode, ctx, inherited)
    case 'link':
      return renderLink(node as LinkNode, ctx, inherited)
    case 'image':
      return renderImage(node as ImageNode, ctx, inherited)
    case 'inline':
      return renderInline(node as InlineNode, ctx, inherited)
    case 'hardbreak':
      return renderHardBreak(node as HardBreakNode, ctx, inherited)
    case 'math_inline':
      return renderMathInline(node as MathInlineNode, ctx, inherited)
    case 'footnote_reference':
      return renderFootnoteReference(node as FootnoteReferenceNode, ctx, inherited)
    case 'footnote_anchor':
      return renderFootnoteAnchor(node as unknown as FootnoteAnchorNode, ctx, inherited)
    case 'reference':
      return renderReference(node as ReferenceNode, ctx, inherited)
    default:
      return styleText((node as any).raw ?? '', inherited, ctx)
  }
}

function renderText(node: TextNode, ctx: RenderContext, inherited: AnsiStyle) {
  return styleText(node.content, inherited, ctx)
}

function renderStrong(node: StrongNode, ctx: RenderContext, inherited: AnsiStyle) {
  const next = mergeAnsiStyle(inherited, ctx.theme.strong)
  return renderInlineNodes(node.children ?? [], ctx, next)
}

function renderEmphasis(node: EmphasisNode, ctx: RenderContext, inherited: AnsiStyle) {
  const next = mergeAnsiStyle(inherited, ctx.theme.emphasis)
  return renderInlineNodes(node.children ?? [], ctx, next)
}

function renderStrikethrough(node: StrikethroughNode, ctx: RenderContext, inherited: AnsiStyle) {
  const next = mergeAnsiStyle(inherited, ctx.theme.strikethrough)
  return renderInlineNodes(node.children ?? [], ctx, next)
}

function renderHighlight(node: HighlightNode, ctx: RenderContext, inherited: AnsiStyle) {
  const next = mergeAnsiStyle(inherited, ctx.theme.highlight)
  return renderInlineNodes(node.children ?? [], ctx, next)
}

function renderInlineCode(node: InlineCodeNode, ctx: RenderContext, inherited: AnsiStyle) {
  const next = mergeAnsiStyle(inherited, ctx.theme.inlineCode)
  return styleText(node.code, next, ctx)
}

function renderLink(node: LinkNode, ctx: RenderContext, inherited: AnsiStyle) {
  // Terminals can't "open" links; treat as ordinary text.
  if (node.raw)
    return styleText(node.raw, inherited, ctx)

  // Fallback: reconstruct markdown-like text.
  const text = node.children?.length
    ? renderInlineNodes(node.children, ctx, inherited)
    : (node.text ?? node.href ?? '')

  const href = node.href ?? ''
  return styleText(href ? `[${text}](${href})` : text, inherited, ctx)
}

function renderImage(node: ImageNode, ctx: RenderContext, inherited: AnsiStyle) {
  // Terminals can't render images; treat as ordinary text.
  // `stream-markdown-parser` sets `raw` to the alt text for images (not the
  // original markdown), so only trust it if it already looks like an image token.
  if (typeof node.raw === 'string' && node.raw.trimStart().startsWith('!['))
    return styleText(node.raw, inherited, ctx)

  // Reconstruct markdown-like image token.
  const alt = node.alt ?? (typeof node.raw === 'string' ? node.raw : '') ?? ''
  const src = node.src ?? (node as any).href ?? (node as any).url ?? ''
  const title = typeof node.title === 'string' && node.title.length > 0
    ? ` "${node.title.replaceAll('"', '\\"')}"`
    : ''
  const text = src ? `![${alt}](${src}${title})` : `![${alt}]`
  return styleText(text, inherited, ctx)
}

function renderInline(node: InlineNode, ctx: RenderContext, inherited: AnsiStyle) {
  return renderInlineNodes(node.children ?? [], ctx, inherited)
}

function renderHardBreak(_node: HardBreakNode, _ctx: RenderContext, _inherited: AnsiStyle) {
  return '\n'
}

function renderMathInline(node: MathInlineNode, ctx: RenderContext, inherited: AnsiStyle) {
  const next = mergeAnsiStyle(inherited, ctx.theme.math)
  const raw = (node as any).raw
  // Prefer raw to preserve `$...$` delimiters when present.
  const text = typeof raw === 'string' && raw.length > 0
    ? raw
    : `$${node.content ?? ''}$`
  return styleText(text, next, ctx)
}

function renderFootnoteReference(node: FootnoteReferenceNode, ctx: RenderContext, inherited: AnsiStyle) {
  return styleText(node.raw || `[^${node.id}]`, inherited, ctx)
}

function renderFootnoteAnchor(_node: FootnoteAnchorNode, _ctx: RenderContext, _inherited: AnsiStyle) {
  return ''
}

function renderReference(node: ReferenceNode, ctx: RenderContext, inherited: AnsiStyle) {
  return styleText(node.raw || `[${node.id}]`, inherited, ctx)
}

function renderBlockNodes(nodes: ParsedNode[], ctx: RenderContext): string {
  let out = ''
  for (const node of nodes)
    out += renderBlockNode(node, ctx)
  return out
}

function renderBlockNode(node: ParsedNode, ctx: RenderContext): string {
  switch (node.type) {
    case 'heading':
      return renderHeading(node as HeadingNode, ctx)
    case 'paragraph':
      return renderParagraph(node as ParagraphNode, ctx)
    case 'table':
      return renderTable(node as unknown as TableNode, ctx)
    case 'list':
      return renderList(node as ListNode, ctx)
    case 'list_item':
      return renderListItem(node as ListItemNode, ctx)
    case 'blockquote':
      return renderBlockquote(node as BlockquoteNode, ctx)
    case 'code_block':
      return renderCodeBlock(node as CodeBlockNode, ctx)
    case 'thematic_break':
      return renderThematicBreak(node as ThematicBreakNode, ctx)
    case 'math_block':
      return renderMathBlock(node as MathBlockNode, ctx)
    case 'admonition':
      return renderAdmonition(node as AdmonitionNode, ctx)
    case 'footnote':
      return renderFootnote(node as FootnoteNode, ctx)
    default:
      return (node as any).raw ? `${(node as any).raw}\n` : ''
  }
}

function renderTable(node: TableNode, ctx: RenderContext) {
  const header = node.header as unknown as TableRowNode | undefined
  const rows = (node.rows ?? []) as unknown as TableRowNode[]
  const allRows = header ? [header, ...rows] : rows
  if (allRows.length === 0)
    return ''

  const maxCols = Math.max(0, ...allRows.map(r => (r.cells ?? []).length))
  const alignByCol: Array<'left' | 'right' | 'center'> = Array.from({ length: maxCols }, (_, i) => {
    const cell = header?.cells?.[i] as unknown as TableCellNode | undefined
    const align = cell?.align
    if (align === 'right' || align === 'center' || align === 'left')
      return align
    return 'left'
  })

  const cellTexts: string[][] = allRows.map((row) => {
    const cells = (row.cells ?? []) as unknown as TableCellNode[]
    const rendered = cells.map(cell => renderInlineNodes((cell.children ?? []) as any, ctx, ctx.theme.paragraph).trim())
    while (rendered.length < maxCols)
      rendered.push('')
    return rendered
  })

  const colWidths = Array.from({ length: maxCols }, (_, col) => {
    let w = 0
    for (const row of cellTexts)
      w = Math.max(w, visibleCellWidth(row[col] ?? ''))
    return w
  })

  const padCell = (text: string, col: number) => {
    const visible = visibleCellWidth(text)
    const width = colWidths[col] ?? 0
    const delta = Math.max(0, width - visible)
    const align = alignByCol[col] ?? 'left'
    if (align === 'right')
      return `${' '.repeat(delta)}${text}`
    if (align === 'center') {
      const left = Math.floor(delta / 2)
      const right = delta - left
      return `${' '.repeat(left)}${text}${' '.repeat(right)}`
    }
    return `${text}${' '.repeat(delta)}`
  }

  const lines = cellTexts.map(row =>
    row.map((cell, col) => padCell(cell, col)).join(' | ').trimEnd(),
  )

  const out = lines.map(line => `${ctx.indent}${line}`).join('\n')
  return `${out}\n\n`
}

function renderHeading(node: HeadingNode, ctx: RenderContext) {
  const headingStyle = mergeAnsiStyle({}, ctx.theme.heading(node.level))
  const text = node.children?.length
    ? renderInlineNodes(node.children, ctx, headingStyle)
    : styleText(node.text ?? '', headingStyle, ctx)
  return `${ctx.indent}${text}\n\n`
}

function renderParagraph(node: ParagraphNode, ctx: RenderContext) {
  const text = renderInlineNodes(node.children ?? [], ctx, ctx.theme.paragraph)
  return `${ctx.indent}${text}\n\n`
}

function renderList(node: ListNode, ctx: RenderContext) {
  let out = ''
  const childCtx: RenderContext = {
    ...ctx,
    listDepth: ctx.listDepth + 1,
    listOrdered: node.ordered,
    listIndex: (node.start ?? 1) - 1,
  }

  for (const item of node.items ?? []) {
    childCtx.listIndex += 1
    out += renderListItem(item, childCtx)
  }

  return `${out}\n`
}

function renderListItem(node: ListItemNode, ctx: RenderContext) {
  const marker = ctx.listOrdered ? `${ctx.listIndex}. ` : '- '
  const markerText = styleText(marker, ctx.theme.listMarker, ctx)
  const childIndent = `${ctx.indent}  `

  const itemCtx: RenderContext = { ...ctx, indent: childIndent }
  const body = renderBlockNodes(node.children ?? [], itemCtx).trimEnd()
  if (!body)
    return `${ctx.indent}${markerText}\n`

  const lines = body.split('\n')
  const first = `${ctx.indent}${markerText}${lines[0]}\n`
  const rest = lines.slice(1).map(line => `${childIndent}${line}\n`).join('')
  return first + rest
}

function renderBlockquote(node: BlockquoteNode, ctx: RenderContext) {
  const bar = styleText('│ ', ctx.theme.blockquoteBar, ctx)
  const innerCtx: RenderContext = { ...ctx, indent: ctx.indent, blockquoteDepth: ctx.blockquoteDepth + 1 }
  const body = renderBlockNodes(node.children ?? [], innerCtx).trimEnd()
  if (!body)
    return `${ctx.indent}${bar}\n\n`

  const lines = body
    .split('\n')
    .map(line => `${ctx.indent}${bar}${styleText(line, ctx.theme.blockquoteText, ctx)}`)
  return `${lines.join('\n')}\n\n`
}

function renderCodeBlock(node: CodeBlockNode, ctx: RenderContext) {
  const language = node.language ?? ''
  const isDiff = Boolean((node as any).diff) || language === 'diff' || language === 'patch'
  const displayLanguage = language || (isDiff ? 'diff' : '')

  const label = displayLanguage ? `\`\`\`${displayLanguage}` : '```'
  const fence = styleText(label, ctx.theme.codeBlockFence, ctx)
  const codeRaw = (isDiff && typeof (node as any).raw === 'string') ? String((node as any).raw) : String(node.code ?? '')
  const code = codeRaw.replace(/\n$/, '')

  const isStreamingLoading = Boolean(node.loading) && ctx.streaming && ctx.streamingLoadingCodeBlock === node
  if (isStreamingLoading) {
    const lines = code
      ? code
          .split('\n')
          .map(line => `${ctx.indent}${styleText(line, ctx.theme.codeBlockText, ctx)}`)
          .join('\n')
      : ''
    return lines ? `${ctx.indent}${fence}\n${lines}\n` : `${ctx.indent}${fence}\n`
  }

  const close = styleText('```', ctx.theme.codeBlockFence, ctx)
  const body = renderCodeBlockBody(code, displayLanguage, node, ctx, !isStreamingLoading)
  return body
    ? `${ctx.indent}${fence}\n${body}\n${ctx.indent}${close}\n\n`
    : `${ctx.indent}${fence}\n${ctx.indent}${close}\n\n`
}

function renderCodeBlockBody(code: string, language: string, node: CodeBlockNode, ctx: RenderContext, allowHighlight: boolean) {
  const isDiff = Boolean((node as any).diff) || language === 'diff' || language === 'patch'

  if (allowHighlight && ctx.highlightCode) {
    const highlighted = ctx.highlightCode(code, language)
    if (highlighted instanceof Promise)
      return isDiff ? renderDiffCode(code, ctx) : renderPlainCode(code, ctx)

    const normalized = highlighted?.replace(/\n$/, '')
    if (normalized == null)
      return isDiff ? renderDiffCode(code, ctx) : renderPlainCode(code, ctx)
    if (!normalized)
      return ''
    return normalized.split('\n').map(line => `${ctx.indent}${line}`).join('\n')
  }

  if (isDiff)
    return renderDiffCode(code, ctx)

  return renderPlainCode(code, ctx)
}

function renderPlainCode(code: string, ctx: RenderContext) {
  if (!code)
    return ''
  return code
    .split('\n')
    .map(line => `${ctx.indent}${styleText(line, ctx.theme.codeBlockText, ctx)}`)
    .join('\n')
}

function renderDiffCode(code: string, ctx: RenderContext) {
  if (!code)
    return ''

  return code
    .split('\n')
    .map((line) => {
      let style = ctx.theme.codeBlockText
      if (line.startsWith('@@'))
        style = ctx.theme.diffHunk
      else if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff ') || line.startsWith('index '))
        style = ctx.theme.diffMeta
      else if (line.startsWith('+'))
        style = ctx.theme.diffAdded
      else if (line.startsWith('-'))
        style = ctx.theme.diffRemoved
      return `${ctx.indent}${styleText(line, style, ctx)}`
    })
    .join('\n')
}

function renderThematicBreak(_node: ThematicBreakNode, ctx: RenderContext) {
  const width = Math.max(3, ctx.width ?? 40)
  return `${ctx.indent}${styleText('─'.repeat(width), ctx.theme.thematicBreak, ctx)}\n\n`
}

function renderMathBlock(node: MathBlockNode, ctx: RenderContext) {
  const next = mergeAnsiStyle({}, ctx.theme.math)
  const raw = (node as any).raw
  // Prefer raw to preserve `$$ ... $$` delimiters when present.
  const text = typeof raw === 'string' && raw.length > 0
    ? raw
    : `$$\n${node.content ?? ''}\n$$`

  const lines = text.replace(/\n$/, '').split('\n')
  const rendered = lines
    .map(line => `${ctx.indent}${styleText(line, next, ctx)}`)
    .join('\n')

  return `${rendered}\n\n`
}

function renderAdmonition(node: AdmonitionNode, ctx: RenderContext) {
  const title = styleText(node.title || node.kind, ctx.theme.admonitionTitle, ctx)
  const body = renderBlockNodes(node.children ?? [], { ...ctx, indent: `${ctx.indent}  ` }).trimEnd()
  const bodyStyled = body
    ? body.split('\n').map(line => `${ctx.indent}  ${styleText(line, ctx.theme.admonitionBody, ctx)}`).join('\n')
    : ''
  return `${ctx.indent}${title}\n${bodyStyled}\n\n`
}

function renderFootnote(node: FootnoteNode, ctx: RenderContext) {
  const label = `[^${node.id}]:`
  const body = renderBlockNodes(node.children ?? [], { ...ctx, indent: '' }).trimEnd()
  if (!body)
    return `${ctx.indent}${label}\n\n`

  const lines = body.split('\n')
  const first = `${ctx.indent}${label} ${lines[0]}`
  const rest = lines.slice(1).map(line => `${ctx.indent}  ${line}`).join('\n')
  return `${rest ? `${first}\n${rest}` : first}\n\n`
}

export function renderNodesToAnsi(nodes: ParsedNode[], options?: RenderOptions) {
  const ctx = createRootContext(options)
  if (ctx.streaming)
    ctx.streamingLoadingCodeBlock = findStreamingLoadingCodeBlock(nodes)
  return `${renderBlockNodes(nodes, ctx).trimEnd()}\n`
}
