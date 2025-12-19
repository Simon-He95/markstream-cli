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

  const md = fs.readFileSync(new URL('../test/fixtures/all.md', import.meta.url), 'utf8')

  const chunkSize = Math.max(1, Number(process.env.MARKSTREAM_CHUNK_SIZE || 8))
  const delayMs = Math.max(0, Number(process.env.MARKSTREAM_DELAY_MS || 20))
  const finalOnly = (process.env.MARKSTREAM_FINAL_ONLY ?? '1') !== '0'
  const debug = (process.env.MARKSTREAM_DEBUG ?? '0') !== '0'
  const debugPatches = (process.env.MARKSTREAM_DEBUG_PATCHES ?? '0') !== '0'

  async function* chunks() {
    for (let i = 0; i < md.length; i += chunkSize) {
      yield md.slice(i, i + chunkSize)
      if (delayMs)
        await sleep(delayMs)
    }
  }

  await streamMarkdownToTerminal(chunks(), {
    terminal: { clear: true },
    finalOnly,
    debug: debug ? { patches: debugPatches } : undefined,
    render: {
      color: true,
      theme: {
        // Avoid wrapping blockquote lines in a single style, so code highlight
        // remains visible inside quotes on some themes.
        blockquoteText: {},
      },
      highlightCode: createShikiHighlightCode({ theme: 'vitesse-dark' }),
    },
  })

  process.stdout.write('\nDone.\n')
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
