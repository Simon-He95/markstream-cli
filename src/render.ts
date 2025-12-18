import type {
  AdmonitionNode,
  BlockquoteNode,
  CodeBlockNode,
  EmphasisNode,
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
  StrikethroughNode,
  StrongNode,
  TextNode,
  ThematicBreakNode,
} from 'stream-markdown-parser'
import { type AnsiStyle, applyAnsiStyle, type ColorMode, isColorEnabled, mergeAnsiStyle } from './ansi'

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
}

export interface RenderOptions {
  color?: ColorMode
  width?: number
  theme?: Partial<RenderTheme>
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
  const text = node.children?.length
    ? renderInlineNodes(node.children, ctx, mergeAnsiStyle(inherited, ctx.theme.linkText))
    : styleText(node.text ?? node.href, mergeAnsiStyle(inherited, ctx.theme.linkText), ctx)

  const href = node.href ? styleText(` (${node.href})`, mergeAnsiStyle(inherited, ctx.theme.linkHref), ctx) : ''
  return `${text}${href}`
}

function renderImage(node: ImageNode, ctx: RenderContext, inherited: AnsiStyle) {
  const alt = node.alt ? styleText(node.alt, mergeAnsiStyle(inherited, ctx.theme.imageAlt), ctx) : ''
  const src = node.src ? styleText(` (${node.src})`, mergeAnsiStyle(inherited, ctx.theme.imageSrc), ctx) : ''
  return `![${alt}]${src}`
}

function renderInline(node: InlineNode, ctx: RenderContext, inherited: AnsiStyle) {
  return renderInlineNodes(node.children ?? [], ctx, inherited)
}

function renderHardBreak(_node: HardBreakNode, _ctx: RenderContext, _inherited: AnsiStyle) {
  return '\n'
}

function renderMathInline(node: MathInlineNode, ctx: RenderContext, inherited: AnsiStyle) {
  const next = mergeAnsiStyle(inherited, ctx.theme.math)
  return styleText(node.content, next, ctx)
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
    default:
      return (node as any).raw ? `${(node as any).raw}\n` : ''
  }
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
  const label = node.language ? `\`\`\`${node.language}` : '```'
  const fence = styleText(label, ctx.theme.codeBlockFence, ctx)
  const close = styleText('```', ctx.theme.codeBlockFence, ctx)
  const code = (node.code ?? '').replace(/\n$/, '')

  const lines = code
    .split('\n')
    .map(line => `${ctx.indent}${styleText(line, ctx.theme.codeBlockText, ctx)}`)
    .join('\n')
  return `${ctx.indent}${fence}\n${lines}\n${ctx.indent}${close}\n\n`
}

function renderThematicBreak(_node: ThematicBreakNode, ctx: RenderContext) {
  const width = Math.max(3, ctx.width ?? 40)
  return `${ctx.indent}${styleText('─'.repeat(width), ctx.theme.thematicBreak, ctx)}\n\n`
}

function renderMathBlock(node: MathBlockNode, ctx: RenderContext) {
  const next = mergeAnsiStyle({}, ctx.theme.math)
  const content = styleText(node.content ?? '', next, ctx)
  return `${ctx.indent}${content}\n\n`
}

function renderAdmonition(node: AdmonitionNode, ctx: RenderContext) {
  const title = styleText(node.title || node.kind, ctx.theme.admonitionTitle, ctx)
  const body = renderBlockNodes(node.children ?? [], { ...ctx, indent: `${ctx.indent}  ` }).trimEnd()
  const bodyStyled = body
    ? body.split('\n').map(line => `${ctx.indent}  ${styleText(line, ctx.theme.admonitionBody, ctx)}`).join('\n')
    : ''
  return `${ctx.indent}${title}\n${bodyStyled}\n\n`
}

export function renderNodesToAnsi(nodes: ParsedNode[], options?: RenderOptions) {
  const ctx = createRootContext(options)
  return `${renderBlockNodes(nodes, ctx).trimEnd()}\n`
}
