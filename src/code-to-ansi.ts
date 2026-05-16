import type { BundledLanguage, BundledTheme } from 'shiki'
import { FontStyle } from '@shikijs/vscode-textmate'
import { Ansis } from 'ansis'
import { codeToTokensBase, getSingletonHighlighter } from 'shiki'
import { hexApplyAlpha } from './colors'
import { sanitizeTerminalText } from './sanitize'

const ansi = new Ansis(1)

export async function codeToANSI(code: string, lang: BundledLanguage, theme: BundledTheme, allowControlSequences = false): Promise<string> {
  let output = ''

  const lines = await codeToTokensBase(code, {
    lang,
    theme,
  })

  const highlight = await getSingletonHighlighter()
  const themeReg = highlight.getTheme(theme)

  for (const line of lines) {
    for (const token of line) {
      let text = allowControlSequences ? token.content : sanitizeTerminalText(token.content)
      const color = token.color || themeReg.fg
      if (color)
        text = ansi.hex(hexApplyAlpha(color, themeReg.type))(text)
      if (token.fontStyle) {
        if (token.fontStyle & FontStyle.Bold)
          text = ansi.bold(text)
        if (token.fontStyle & FontStyle.Italic)
          text = ansi.italic(text)
        if (token.fontStyle & FontStyle.Underline)
          text = ansi.underline(text)
        if (token.fontStyle & FontStyle.Strikethrough)
          text = ansi.strikethrough(text)
      }
      output += text
    }
    output += '\n'
  }

  return output
}
