import type { RenderOptions } from './render'

export function isPromiseLike<T>(x: unknown): x is PromiseLike<T> {
  return Boolean(x && (typeof x === 'object' || typeof x === 'function') && typeof (x as { then?: unknown }).then === 'function')
}

export function callHighlight(
  fn: NonNullable<RenderOptions['highlightCode']>,
  code: string,
  language: string,
  onError?: RenderOptions['onHighlightError'],
): string | Promise<string | undefined> | undefined {
  try {
    const highlighted = fn(code, language)
    if (isPromiseLike<string>(highlighted)) {
      return Promise.resolve(highlighted).catch((error) => {
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
