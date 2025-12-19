import type { BundledLanguage, BundledTheme } from 'shiki'
import type { RenderOptions } from './render'
import { codeToANSI } from './code-to-ansi'

export interface ShikiHighlightOptions {
  theme: BundledTheme
  /**
   * Used when the fenced block language is empty/unknown.
   * @default 'ts'
   */
  defaultLanguage?: BundledLanguage
}

export function createShikiHighlightCode(options: ShikiHighlightOptions): NonNullable<RenderOptions['highlightCode']> {
  const theme = options.theme
  const defaultLanguage = options.defaultLanguage ?? ('ts' as BundledLanguage)

  return async (code, language) => {
    const lang = (language || defaultLanguage) as BundledLanguage

    try {
      return await codeToANSI(code, lang, theme)
    }
    catch {
      // Fall back to default language or plain text.
      try {
        return await codeToANSI(code, defaultLanguage, theme)
      }
      catch {
        return `${code}\n`
      }
    }
  }
}
