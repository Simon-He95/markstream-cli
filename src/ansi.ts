import process from 'node:process'
import { Ansis } from 'ansis'

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

// Force ANSI output when `enabled === true` (even if stdout isn't a TTY),
// while still letting the caller decide via `isColorEnabled()`.
const forcedAnsi = new Ansis(1)

export function applyAnsiStyle(text: string, style: AnsiStyle | undefined, enabled: boolean) {
  if (!enabled || !style)
    return text

  if (!style.fg && !style.bold && !style.dim && !style.italic && !style.underline)
    return text

  let chain: any = forcedAnsi
  if (style.fg)
    chain = chain[style.fg]
  if (style.bold)
    chain = chain.bold
  if (style.dim)
    chain = chain.dim
  if (style.italic)
    chain = chain.italic
  if (style.underline)
    chain = chain.underline

  return chain(text)
}
