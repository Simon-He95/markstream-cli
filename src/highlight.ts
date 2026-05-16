import type { RenderOptions } from './render'

export function callHighlight(
  fn: NonNullable<RenderOptions['highlightCode']>,
  code: string,
  language: string,
  onError?: RenderOptions['onHighlightError'],
): string | Promise<string | undefined> | undefined {
  try {
    const highlighted = fn(code, language)
    if (highlighted instanceof Promise) {
      return highlighted.catch((error) => {
        onError?.(error, code, language)
        return undefined
      })
    }
    return highlighted
  }
  catch (error) {
    onError?.(error, code, language)
    return undefined
  }
}
