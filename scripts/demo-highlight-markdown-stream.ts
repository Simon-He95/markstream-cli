import fs from 'node:fs'
import process from 'node:process'
import { createShikiHighlightCode, streamMarkdownToTerminal } from '../src/index'

function sleep(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms))
}

async function main() {
  if (!process.stdout.isTTY) {
    console.error('This demo needs a real TTY (run in a terminal, not captured output).')
    process.exitCode = 1
    return
  }

  const fixture = fs.readFileSync(new URL('../test/fixtures/complex.md', import.meta.url), 'utf8')
  const full = `${fixture.trimEnd()}\n\n\`\`\`ts\nconst x = 1\nconsole.log(x)\n\`\`\`\n`

  async function* chunks() {
    for (let i = 0; i < full.length; i += 6) {
      yield full.slice(i, i + 6)
      await sleep(25)
    }
  }

  const { term } = await streamMarkdownToTerminal(chunks(), {
    terminal: { clear: true },
    debug: (process.env.MARKSTREAM_DEBUG ?? '0') !== '0'
      ? { patches: (process.env.MARKSTREAM_DEBUG_PATCHES ?? '0') !== '0' }
      : undefined,
    render: {
      theme: {
        // Avoid wrapping blockquote lines in a single style, so code highlight
        // remains visible inside quotes on some themes.
        blockquoteText: {},
      },
      highlightCode: createShikiHighlightCode({ theme: 'vitesse-dark' }),
    },
  })

  term.writeRaw('\nDone.\n')
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
