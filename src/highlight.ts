import type { RenderOptions } from './render'

export function callHighlight(
  fn: NonNullable<RenderOptions['highlightCode']>,
  code: string,
  language: string,
): string | Promise<string> | undefined {
  try {
    return fn(code, language)
  }
  catch {
    return undefined
  }
}
