import process from 'node:process'
import { createTerminalSession } from '../src/index'

function sleep(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms))
}

async function main() {
  if (!process.stdout.isTTY) {
    console.error('This demo needs a real TTY (run in a terminal, not captured output).')
    process.exitCode = 1
    return
  }

  const term = createTerminalSession({ clear: true })
  term.start()
  try {
    term.writeRaw('Streaming demo: append characters on a single line.\n\n')

    const text = 'Typing: The quick brown fox jumps over the lazy dog.'
    for (const ch of text) {
      term.append(ch)
      await sleep(35)
    }

    term.writeRaw('\n\nDone.\n')
  }
  finally {
    term.stop()
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
