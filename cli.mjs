#!/usr/bin/env node
import fs from 'node:fs/promises'
import process from 'node:process'
import { createShikiHighlightCode, highlightMarkdownAsync, streamMarkdownToTerminal } from 'markstream-cli'

const usage = `Usage:
  markstream [file] [--theme <theme>] [--width <columns>] [--no-color] [--final-only]

Options:
  --theme <theme>   Enable Shiki ANSI highlighting, even when stdout is piped.
  --no-color        Disable all ANSI output.

Examples:
  cat README.md | markstream --theme nord --final-only
  markstream ./README.md --no-color
`

function fail(message) {
  process.stderr.write(`${message}\n\n${usage}`)
  process.exitCode = 1
}

function parseArgs(args) {
  const options = {
    color: undefined,
    finalOnly: true,
    file: undefined,
    theme: undefined,
    width: undefined,
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--help' || arg === '-h') {
      process.stdout.write(usage)
      process.exit(0)
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
    else if (arg === '--theme') {
      options.theme = args[++i]
      if (!options.theme)
        return fail('Missing value for --theme')
    }
    else if (arg === '--width') {
      const raw = args[++i]
      const width = Number(raw)
      if (!Number.isInteger(width) || width <= 0)
        return fail('Missing valid positive integer for --width')
      options.width = width
    }
    else if (arg.startsWith('-')) {
      return fail(`Unknown option: ${arg}`)
    }
    else if (options.file) {
      return fail(`Unexpected argument: ${arg}`)
    }
    else {
      options.file = arg
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

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (!options)
    return

  const render = {
    color: options.color,
    width: options.width,
  }

  if (options.theme && options.color !== false)
    render.highlightCode = createShikiHighlightCode({ theme: options.theme })

  if (!process.stdout.isTTY) {
    const input = options.file ? await fs.readFile(options.file, 'utf8') : await readStdin()
    process.stdout.write(await highlightMarkdownAsync(input, { render }))
    return
  }

  const source = options.file
    ? await fs.readFile(options.file, 'utf8')
    : process.stdin.setEncoding('utf8')

  await streamMarkdownToTerminal(source, {
    finalOnly: options.finalOnly,
    requireTTY: false,
    render,
  })
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
