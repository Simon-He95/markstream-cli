#!/usr/bin/env node
import fs from 'node:fs/promises'
import process from 'node:process'

const usage = `Usage:
  markstream [file|-] [--theme <theme>] [--width <columns>] [--no-color] [--final-only] [--no-final-only]

Options:
  --theme <theme>   Enable Shiki ANSI highlighting, even when stdout is piped.
  --color           Force ANSI styling for markdown text.
  --no-color        Disable ANSI styling and syntax highlighting.
  --width <columns> Render width.
  --final-only      Keep only final render in normal terminal scrollback.
  --no-final-only   Leave streaming frames in normal terminal output.

Examples:
  cat README.md | markstream --theme nord --final-only
  markstream - --theme nord
  markstream ./README.md --no-color
  markstream -- --weird-file.md
`

function fail(message) {
  process.stderr.write(`${message}\n\n${usage}`)
  process.exitCode = 1
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error)
}

function setInput(options, arg, dashAsStdin = true) {
  if (options.file || options.stdin) {
    fail(`Unexpected argument: ${arg}`)
    return false
  }

  if (dashAsStdin && arg === '-')
    options.stdin = true
  else
    options.file = arg

  return true
}

function parseArgs(args) {
  const options = {
    color: undefined,
    finalOnly: true,
    file: undefined,
    stdin: false,
    theme: undefined,
    width: undefined,
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--help' || arg === '-h') {
      process.stdout.write(usage)
      process.exit(0)
    }
    else if (arg === '--') {
      for (const positional of args.slice(i + 1)) {
        if (!setInput(options, positional, false))
          return undefined
      }
      break
    }
    else if (arg === '--no-color') {
      options.color = false
    }
    else if (arg === '--color') {
      options.color = true
    }
    else if (arg === '--final-only') {
      options.finalOnly = true
    }
    else if (arg === '--no-final-only') {
      options.finalOnly = false
    }
    else if (arg === '--theme' || arg.startsWith('--theme=')) {
      const raw = arg === '--theme' ? args[++i] : arg.slice('--theme='.length)
      if (!raw || raw.startsWith('-'))
        return fail('Missing value for --theme')
      options.theme = raw
    }
    else if (arg === '--width' || arg.startsWith('--width=')) {
      const raw = arg === '--width' ? args[++i] : arg.slice('--width='.length)
      const width = Number(raw)
      if (!Number.isInteger(width) || width <= 0)
        return fail('Missing valid positive integer for --width')
      options.width = width
    }
    else if (arg === '-') {
      if (!setInput(options, arg))
        return undefined
    }
    else if (arg.startsWith('-')) {
      return fail(`Unknown option: ${arg}`)
    }
    else {
      if (!setInput(options, arg))
        return undefined
    }
  }

  return options
}

async function readStdin() {
  process.stdin.setEncoding('utf8')
  let out = ''
  for await (const chunk of process.stdin)
    out += chunk
  return out
}

async function streamWithCleanup(createTerminalMarkdownStream, source, options) {
  const s = createTerminalMarkdownStream(options)
  let stopped = false

  function stop() {
    if (stopped)
      return
    stopped = true
    s.stop()
  }

  function onSigint() {
    stop()
    process.exit(130)
  }

  function onSigterm() {
    stop()
    process.exit(143)
  }

  function onUncaughtException(error) {
    stop()
    process.stderr.write(`${formatError(error)}\n`)
    process.exit(1)
  }

  function onUnhandledRejection(reason) {
    stop()
    process.stderr.write(`${formatError(reason)}\n`)
    process.exit(1)
  }

  process.once('SIGINT', onSigint)
  process.once('SIGTERM', onSigterm)
  process.once('uncaughtException', onUncaughtException)
  process.once('unhandledRejection', onUnhandledRejection)

  try {
    s.start()

    if (typeof source === 'string') {
      s.push(source)
    }
    else {
      for await (const chunk of source)
        s.push(chunk)
    }

    await s.flush()
  }
  finally {
    process.removeListener('SIGINT', onSigint)
    process.removeListener('SIGTERM', onSigterm)
    process.removeListener('uncaughtException', onUncaughtException)
    process.removeListener('unhandledRejection', onUnhandledRejection)
    stop()
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (!options)
    return

  if (!options.file && !options.stdin && process.stdin.isTTY)
    return fail('No input. Pass a file or pipe Markdown on stdin.')

  const {
    createTerminalMarkdownStream,
    createShikiHighlightCode,
    highlightMarkdownAsync,
  } = await import('markstream-cli')

  const render = {
    color: options.color,
    width: options.width,
  }

  if (options.theme && options.color !== false) {
    let warnedTheme = false
    render.highlightCode = createShikiHighlightCode({
      theme: options.theme,
      onError() {
        if (warnedTheme)
          return
        warnedTheme = true
        process.stderr.write(`Warning: failed to apply theme "${options.theme}"; rendering code without syntax highlighting.\n`)
      },
    })
  }

  if (!process.stdout.isTTY) {
    const input = options.file ? await fs.readFile(options.file, 'utf8') : await readStdin()
    process.stdout.write(await highlightMarkdownAsync(input, { render }))
    return
  }

  const source = options.file
    ? await fs.readFile(options.file, 'utf8')
    : process.stdin.setEncoding('utf8')

  await streamWithCleanup(createTerminalMarkdownStream, source, {
    finalOnly: options.finalOnly,
    requireTTY: false,
    render,
  })
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
