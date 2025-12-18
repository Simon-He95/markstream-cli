import process from 'node:process'

export type AnsiColor
  = | 'black'
    | 'red'
    | 'green'
    | 'yellow'
    | 'blue'
    | 'magenta'
    | 'cyan'
    | 'white'
    | 'gray'

export interface AnsiStyle {
  fg?: AnsiColor
  bold?: boolean
  dim?: boolean
  italic?: boolean
  underline?: boolean
}

export type ColorMode = boolean | 'auto'

export function isColorEnabled(mode: ColorMode = 'auto') {
  if (mode === true || mode === false)
    return mode

  if (process.env.NO_COLOR != null)
    return false

  if (process.env.FORCE_COLOR != null)
    return true

  return Boolean(process.stdout.isTTY)
}

export function mergeAnsiStyle(base: AnsiStyle, next: AnsiStyle): AnsiStyle {
  return { ...base, ...next }
}

function fgCode(color: AnsiColor) {
  switch (color) {
    case 'black': return 30
    case 'red': return 31
    case 'green': return 32
    case 'yellow': return 33
    case 'blue': return 34
    case 'magenta': return 35
    case 'cyan': return 36
    case 'white': return 37
    case 'gray': return 90
  }
}

export function applyAnsiStyle(text: string, style: AnsiStyle | undefined, enabled: boolean) {
  if (!enabled || !style)
    return text

  const codes: number[] = []
  if (style.bold)
    codes.push(1)
  if (style.dim)
    codes.push(2)
  if (style.italic)
    codes.push(3)
  if (style.underline)
    codes.push(4)
  if (style.fg)
    codes.push(fgCode(style.fg))

  if (codes.length === 0)
    return text

  return `\u001B[${codes.join(';')}m${text}\u001B[0m`
}
