export function sanitizeTerminalText(s: string) {
  return s
    .replaceAll('\u001B', '␛')
    .replaceAll('\u0007', '␇')
    .replaceAll('\u009B', '␛[')
}
