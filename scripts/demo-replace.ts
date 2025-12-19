import process from 'node:process'
import { createTerminalSession, range } from '../src/index'

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
    term.writeRaw('Streaming demo: replace a (line,col) range.\n\n')

    term.setText('Line1: Hello WORLD!\nLine2: Replace across lines -> ABCDE\n')

    await sleep(700)

    term.replace(range(1, 14, 1, 18), '\u001B[33mMARKSTREAM\u001B[0m')

    await sleep(900)

    term.replace(range(2, 8, 2, 28), '\u001B[36m[OK]\u001B[0m')

    await sleep(700)
    term.writeRaw('\nDone.\n')
  }
  finally {
    term.stop()
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
