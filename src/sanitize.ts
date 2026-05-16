export function sanitizeTerminalText(s: string) {
  let out = ''
  for (const ch of s) {
    const code = ch.charCodeAt(0)
    if (code > 0x08 && (code < 0x0B || code > 0x1F) && (code < 0x7F || code > 0x9F)) {
      out += ch
      continue
    }

    if (code === 0x1B)
      out += '␛'
    else if (code === 0x07)
      out += '␇'
    else if (code === 0x9B)
      out += '␛['
    else if (code <= 0x1F)
      out += String.fromCharCode(0x2400 + code)
    else if (code === 0x7F)
      out += '␡'
    else
      out += '␟'
  }
  return out
}
