import process from 'node:process'
import { codeToANSI } from '../src/code-to-ansi'
import { createMarkdownStreamRenderer, createTerminalSession } from '../src/index'

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
  const r = createMarkdownStreamRenderer({
    strategy: 'redraw',
    onPatch: patch => term.writeRaw(patch),
    render: {
      color: true,
      highlightCode: async (code, language) => {
        const lang = (language || 'ts') as any
        return codeToANSI(code, lang, 'vitesse-light')
      },
    },
  })

  term.start()
  try {
    for (const ch of '# Demo Stream\n\nThis is a demo of **streaming** markdown rendering to the terminal.\n\nStreaming demo: code becomes highlighted after closing fence.\n\n'.split('')) {
      term.append(ch)
      await sleep(20)
    }

    term.writeRaw(r.push('```ts\nconst x = 1\n'))

    await sleep(900)

    term.writeRaw(r.push('```'))

    await r.flush()
    await sleep(900)

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
