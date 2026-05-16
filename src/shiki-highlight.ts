import type { BundledLanguage, BundledTheme } from 'shiki'
import type { RenderOptions } from './render'
import { codeToANSI } from './code-to-ansi'
import { sanitizeTerminalText } from './sanitize'

export interface ShikiHighlightOptions {
  theme: BundledTheme
  /**
   * Allow raw terminal control sequences from highlighted code to reach output.
   * @default false
   */
  allowControlSequences?: boolean
  /**
   * Used when the fenced block language is empty/unknown.
   * @default 'ts'
   */
  defaultLanguage?: BundledLanguage
}

export function createShikiHighlightCode(options: ShikiHighlightOptions): NonNullable<RenderOptions['highlightCode']> {
  const theme = options.theme
  const defaultLanguage = options.defaultLanguage ?? ('ts' as BundledLanguage)
  const allowControlSequences = Boolean(options.allowControlSequences)

  return async (code, language) => {
    const lang = (language || defaultLanguage) as BundledLanguage

    try {
      return await codeToANSI(code, lang, theme, allowControlSequences)
    }
    catch {
      // Fall back to default language or plain text.
      try {
        return await codeToANSI(code, defaultLanguage, theme, allowControlSequences)
      }
      catch {
        return `${allowControlSequences ? code : sanitizeTerminalText(code)}\n`
      }
    }
  }
}
