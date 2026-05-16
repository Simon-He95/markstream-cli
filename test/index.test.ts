import type { HighlightMarkdownOptions } from '../src/index'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ansi, createMarkdownStreamRenderer, highlightMarkdown, highlightMarkdownAsync, parseMarkdown, streamMarkdownToTerminal, stripAnsi } from '../src/index'

const cliPath = fileURLToPath(new URL('../cli.mjs', import.meta.url))

function stripTerminalControlSequences(s: string) {
  // Keep visible text + newlines so we can compare against non-terminal renders.
  return stripAnsi(s)
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('should', () => {
  it('cli rejects invalid options before rendering', () => {
    for (const { args, message } of [
      { args: ['--theme'], message: 'Missing value for --theme' },
      { args: ['--theme', '--no-color'], message: 'Missing value for --theme' },
      { args: ['--width', 'abc'], message: 'Missing valid positive integer for --width' },
      { args: ['--unknown'], message: 'Unknown option: --unknown' },
    ]) {
      const result = spawnSync(process.execPath, [cliPath, ...args], { encoding: 'utf8' })

      expect(result.status).toBe(1)
      expect(result.stderr).toContain(message)
    }
  })

  it('cli prints help', () => {
    const result = spawnSync(process.execPath, [cliPath, '--help'], { encoding: 'utf8' })

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Usage:')
    expect(result.stdout).toContain('--color')
    expect(result.stdout).toContain('--no-final-only')
  })

  it('cli renders stdin in non-tty mode', () => {
    const result = spawnSync(process.execPath, [cliPath, '--no-color', '--no-final-only'], {
      encoding: 'utf8',
      input: '# Hello\n',
    })

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Hello')
  })

  it('cli renders a file in non-tty mode', () => {
    const fixturePath = fileURLToPath(new URL('./fixtures/complex.md', import.meta.url))
    const result = spawnSync(process.execPath, [cliPath, fixturePath, '--no-color'], {
      encoding: 'utf8',
    })

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Footer paragraph.')
  })

  it('cli renders themed ANSI output when stdout is piped', () => {
    const result = spawnSync(process.execPath, [cliPath, '--theme', 'nord'], {
      encoding: 'utf8',
      input: '```ts\nconst x = 1\n```\n',
    })

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('\u001B[')
  })

  it('cli accepts equals option values', () => {
    const result = spawnSync(process.execPath, [cliPath, '--theme=nord', '--width=80'], {
      encoding: 'utf8',
      input: '```ts\nconst x = 1\n```\n',
    })

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('\u001B[')
  })

  it('parse markdown to nodes', () => {
    const nodes = parseMarkdown('# Hello World')
    expect(nodes[0]?.type).toBe('heading')
    expect((nodes[0] as any).level).toBe(1)
  })

  it('render heading + paragraph (no color)', () => {
    const out = highlightMarkdown('# Hello World\n\nThis is **bold**.', {
      render: { color: false },
    })
    expect(out).toBe('Hello World\n\nThis is bold.\n')
  })

  it('exports highlight markdown options type', () => {
    const options: HighlightMarkdownOptions = { render: { color: false } }
    const out = highlightMarkdown('# Hello World\n', options)

    expect(out).toContain('Hello World')
  })

  it('render diff code block highlights added/removed lines', () => {
    const md = [
      '```diff',
      'diff --git a/a.txt b/a.txt',
      'index 0000000..1111111 100644',
      '--- a/a.txt',
      '+++ b/a.txt',
      '@@ -1,2 +1,2 @@',
      '-old',
      '+new',
      ' unchanged',
      '```',
      '',
    ].join('\n')

    const out = highlightMarkdown(md, { render: { color: true } })
    expect(out).toContain('\u001B[')
    expect(out).toContain('\u001B[31m-old')
    expect(out).toContain('\u001B[32m+new')
    expect(stripAnsi(out)).toContain('@@ -1,2 +1,2 @@')
  })

  it('render sanitizes terminal control sequences by default', () => {
    const md = [
      'hello \u001B]52;c;pw\u0007',
      '',
      '`x\u009B31m`',
      '',
      'controls \u0008\u009D\u007F',
      '',
      '```ts',
      'console.log("\u001B[31m")',
      '```',
      '',
    ].join('\n')

    const out = highlightMarkdown(md, { render: { color: false } })

    expect(out).not.toContain('\u001B')
    expect(out).not.toContain('\u0007')
    expect(out).not.toContain('\u009B')
    expect(out).not.toContain('\u009D')
    expect(out).not.toContain('\u0008')
    expect(out).not.toContain('\u007F')
    expect(out).toContain('hello ␛]52;c;pw␇')
    expect(out).toContain('x␛[31m')
    expect(out).toContain('controls ␈␟␡')
    expect(out).toContain('console.log("␛[31m")')
  })

  it('render can opt into raw terminal control sequences', () => {
    const out = highlightMarkdown('hello \u001B[31mred\n', {
      render: { color: false, allowControlSequences: true },
    })

    expect(out).toContain('\u001B[31mred')
  })

  it('async render waits for async code highlight', async () => {
    const out = await highlightMarkdownAsync('```ts\nconst x = 1\n```\n', {
      render: {
        color: false,
        highlightCode: async code => `<<${code.toUpperCase()}>>`,
      },
    })

    expect(out).toContain('<<CONST X = 1>>')
  })

  it('async render swallows async highlight rejection', async () => {
    const out = await highlightMarkdownAsync('```ts\nconst x = 1\n```\n', {
      render: {
        color: false,
        highlightCode: async () => {
          throw new Error('boom')
        },
      },
    })

    expect(out).toContain('const x = 1')
  })

  it('async render swallows sync highlight throw', async () => {
    const out = await highlightMarkdownAsync('```ts\nconst x = 1\n```\n', {
      render: {
        color: false,
        highlightCode: () => {
          throw new Error('boom')
        },
      },
    })

    expect(out).toContain('const x = 1')
  })

  it('render complex markdown (heading/blockquote/code/footnote/reference)', () => {
    const md = fs.readFileSync(new URL('./fixtures/complex.md', import.meta.url), 'utf8')
    const out = highlightMarkdown(md, { render: { color: false, width: 40 } })

    expect(out).toContain('Header\n\n')
    expect(out).toContain('│ Blockquote line\n')
    expect(out).toContain('│ inline and a ref [1] and footnote[^1].\n')
    expect(out).toContain('│ ```ts\n')
    expect(out).toContain('│ const x: number = 1\n')
    expect(out).toContain('│ console.log(x)\n')
    expect(out).toContain('│ ```\n')

    expect(out).toContain('\nFooter paragraph.\n\n')
    expect(out).toContain(`\n${'─'.repeat(40)}\n\n`)
    expect(out).toContain('[^1]: Footnote has bold and a link to [OpenAI](https://openai.com).\n')
    expect(out.endsWith('\n')).toBe(true)
  })

  it('render: indented code block keeps ``` as literal text', () => {
    const md = [
      '    ```ts',
      '    const x = 1',
      '    ```',
      '',
    ].join('\n')

    const out = highlightMarkdown(md, { render: { color: false } })
    expect(out).toBe('```\n```ts\nconst x = 1\n```\n```\n')
  })

  it('streaming: partial fenced code block renders (loading)', () => {
    const samples = [
      '```',
      '```t',
      '```ts',
      '```ts\n',
      '```ts\nconst x = 1',
      '```ts\nconst x = 1\n',
    ]

    for (const md of samples) {
      const nodes = parseMarkdown(md)
      expect(nodes).toHaveLength(1)
      expect(nodes[0]?.type).toBe('code_block')
      expect((nodes[0] as any).loading).toBe(true)

      const out = highlightMarkdown(md, { render: { color: false, streaming: true } })
      expect(out.startsWith('```')).toBe(true)
      expect(out.endsWith('\n')).toBe(true)
    }

    const closedNodes = parseMarkdown('```ts\nconst x = 1\n```')
    expect((closedNodes[0] as any).loading).toBe(false)

    const closed = highlightMarkdown('```ts\nconst x = 1\n```', { render: { color: false } })
    expect(closed).toBe('```ts\nconst x = 1\n```\n')
  })

  it('streaming: rewrite completed code block in-place (fake highlight)', () => {
    const r = createMarkdownStreamRenderer({
      render: {
        color: false,
        highlightCode: code => `<<${code.toUpperCase()}>>`,
      },
    })

    const step1 = r.push('```ts\nconst x = 1\n')
    const step2 = r.push('```')

    expect(step1).toBe('\r\u001B7\u001B[s```ts\nconst x = 1\n')
    expect(step2).toBe('\u001B8\u001B[u```ts\u001B[K\n<<CONST X = 1>>\u001B[K\n```\u001B[K\n\u001B[J')

    // Note: Vitest captures stdout and prints it as logs (e.g. `stdout | ...`),
    // so ANSI cursor moves won't appear as an in-place overwrite there.
    // Use `npm run demo:stream` in a real terminal to see the replacement.
  })

  it('streaming: code block containing backticks still rewrites from opening fence', () => {
    const r = createMarkdownStreamRenderer({
      render: {
        color: false,
        highlightCode: code => `<<${code}>>`,
      },
    })

    r.push('```ts\nconst s = "```"\n')
    const patch = r.push('```')

    expect(stripAnsi(patch)).toContain('```ts\n<<const s = "```">>\n```')
  })

  it('streaming: redraw strategy rewrites from line 0', () => {
    const r = createMarkdownStreamRenderer({
      strategy: 'redraw',
      render: {
        color: false,
        highlightCode: code => `<<${code.toUpperCase()}>>`,
      },
    })

    const step1 = r.push('```ts\nconst x = 1\n')
    const step2 = r.push('```')

    expect(step1).toBe('\r\u001B7\u001B[s```ts\u001B[K\nconst x = 1\u001B[K\n')
    expect(step2).toBe('\u001B8\u001B[u```ts\u001B[K\n<<CONST X = 1>>\u001B[K\n```\u001B[K\n\u001B[J')
  })

  it('streaming: strong renders after closing **', () => {
    const r = createMarkdownStreamRenderer({
      strategy: 'redraw',
      render: { color: false },
    })

    for (const ch of 'This is a demo of **streaming** markdown.\n')
      r.push(ch)

    const rendered = r.getRenderedText()
    expect(rendered).toContain('This is a demo of streaming markdown.\n')
    expect(rendered).not.toContain('**streaming**')
  })

  it('streaming: async highlight replaces later (in-place rewrite)', async () => {
    const r = createMarkdownStreamRenderer({
      render: {
        color: false,
        highlightCode: async code => `<<${code.toUpperCase()}>>`,
      },
    })

    const step1 = r.push('```ts\nconst x = 1\n')
    const step2 = r.push('```')

    expect(step1).toBe('\r\u001B7\u001B[s```ts\nconst x = 1\n')
    expect(step2).toBe('```\n')

    const patches = await r.flush()
    expect(patches).toEqual(['\u001B8\u001B[u```ts\u001B[K\n<<CONST X = 1>>\u001B[K\n```\u001B[K\n\u001B[J'])
  })

  it('streaming: async highlight replaces later (redraw strategy)', async () => {
    const r = createMarkdownStreamRenderer({
      strategy: 'redraw',
      render: {
        color: false,
        highlightCode: async code => `<<${code.toUpperCase()}>>`,
      },
    })

    const step1 = r.push('```ts\nconst x = 1\n')
    const step2 = r.push('```')

    expect(step1).toBe('\r\u001B7\u001B[s```ts\u001B[K\nconst x = 1\u001B[K\n')
    expect(step2).toBe('\u001B8\u001B[u```ts\u001B[K\nconst x = 1\u001B[K\n```\u001B[K\n\u001B[J')

    const patches = await r.flush()
    expect(patches).toEqual(['\u001B8\u001B[u```ts\u001B[K\n<<CONST X = 1>>\u001B[K\n```\u001B[K\n\u001B[J'])
  })

  it('streaming: tail async highlight is only scheduled once', async () => {
    const highlight = deferred<string>()
    let calls = 0
    const r = createMarkdownStreamRenderer({
      render: {
        color: false,
        highlightCode: () => {
          calls += 1
          return highlight.promise
        },
      },
    })

    r.push('```ts\nconst x = 1\n')
    r.push('```')
    r.push('\n\nafter\n')

    expect(calls).toBe(1)
    highlight.resolve('<<CONST X = 1>>')
    const patches = await r.flush()
    expect(patches.join('')).toContain('<<CONST X = 1>>')
  })

  it('streaming: reset ignores stale async highlight patches', async () => {
    const highlight = deferred<string>()
    const r = createMarkdownStreamRenderer({
      render: {
        color: false,
        highlightCode: () => highlight.promise,
      },
    })

    r.push('```ts\nconst x = 1\n')
    r.push('```')
    r.reset()
    highlight.resolve('<<STALE>>')

    await Promise.resolve()
    expect(await r.flush()).toEqual([])
    expect(r.getRenderedText()).toBe('')
  })

  it('streaming: async highlight rejection is swallowed', async () => {
    const highlight = deferred<string>()
    const r = createMarkdownStreamRenderer({
      render: {
        color: false,
        highlightCode: () => highlight.promise,
      },
    })

    r.push('```ts\nconst x = 1\n')
    r.push('```')
    highlight.reject(new Error('boom'))

    await expect(r.flush()).resolves.toEqual([])
  })

  it('streaming: sync highlight throw is swallowed', async () => {
    const r = createMarkdownStreamRenderer({
      render: {
        color: false,
        highlightCode: () => {
          throw new Error('boom')
        },
      },
    })

    expect(() => {
      r.push('```ts\nconst x = 1\n')
      r.push('```')
    }).not.toThrow()

    expect(r.getFullRenderedText()).toContain('const x = 1')
  })

  it('streaming: async highlight works for non-tail code blocks', async () => {
    const r = createMarkdownStreamRenderer({
      render: {
        color: false,
        highlightCode: async code => `<<${code.toUpperCase()}>>`,
      },
    })

    const initial = r.push('```ts\nconst x = 1\n```\n\nafter\n')
    expect(initial).toContain('```ts')
    expect(initial).toContain('const x = 1')
    expect(initial).toContain('after')

    const patches = await r.flush()
    expect(patches.join('')).toContain('<<CONST X = 1>>')
  })

  it('streaming: async highlight cache key uses sanitized code', async () => {
    const r = createMarkdownStreamRenderer({
      render: {
        color: false,
        highlightCode: async code => `<<${code}>>`,
      },
    })

    r.push('```ts\nconsole.log("\u001B[31m")\n')
    r.push('```')

    const patches = await r.flush()
    expect(patches.join('')).toContain('<<console.log("␛[31m")>>')
    expect(r.getFullRenderedText()).not.toContain('\u001B')
  })

  it('streaming: viewportHeight clips rendered output', () => {
    const r = createMarkdownStreamRenderer({
      viewportHeight: 3,
      render: { color: false },
    })

    r.push(['# A', '', 'B', '', 'C', '', 'D', '', 'E', ''].join('\n'))

    const clipped = r.getRenderedText()
    const clippedLines = clipped.split('\n')
    if (clippedLines[clippedLines.length - 1] === '')
      clippedLines.pop()

    expect(clippedLines.length).toBeLessThanOrEqual(3)

    const full = r.getFullRenderedText()
    const fullLines = full.split('\n')
    if (fullLines[fullLines.length - 1] === '')
      fullLines.pop()
    expect(fullLines.length).toBeGreaterThan(clippedLines.length)
  })

  it('streaming: anchor=home does not require save/restore', () => {
    const r = createMarkdownStreamRenderer({
      anchor: 'home',
      render: { color: false },
    })

    const patch = r.push('# A\n\nB\n')
    // Home anchor should use cursor home (CSI H), not save/restore cursor.
    expect(patch).toContain('\u001B[H')
    expect(patch).not.toContain('\u001B7')
    expect(patch).not.toContain('\u001B8')
  })

  it('render table aligns wide chars (CJK/emoji)', () => {
    const md = [
      '## T',
      '',
      '| A | B |',
      '|:--|:--|',
      '| 你 | x |',
      '| 🙂 | yy |',
      '',
    ].join('\n')

    const out = highlightMarkdown(md, { render: { color: false, width: 40 } })
    // Expect the pipe separator to align across rows.
    expect(out).toContain('你 | x')
    expect(out).toContain('🙂 | yy')
  })

  it('streaming: blockquote fenced code closes + highlights', () => {
    const md = [
      '> ```ts',
      '> const x: number = 1',
      '> ```',
      '',
      'after',
      '',
    ].join('\n')

    const out = highlightMarkdown(md, {
      render: {
        color: false,
        streaming: true,
        highlightCode: code => `<<${code.toUpperCase()}>>`,
      },
    })

    expect(out).toContain('│ ```ts\n')
    expect(out).toContain('│ <<CONST X: NUMBER = 1>>\n')
    expect(out).toContain('│ ```\n')
    expect(out).toContain('\nafter\n')
  })

  it('streamMarkdownToTerminal: streams chunks and flushes', async () => {
    const written: string[] = []
    const stream = {
      isTTY: false,
      write(chunk: string) {
        written.push(chunk)
      },
    }

    async function* chunks() {
      yield '# Hello\n\n'
      yield '```ts\nconst x = 1\n'
      yield '```\n'
    }

    await streamMarkdownToTerminal(chunks(), {
      terminal: { stream },
      requireTTY: false,
      startOnNewLine: false,
      render: {
        color: false,
        highlightCode: async code => `<<${code.toUpperCase()}>>`,
      },
    })

    const out = written.join('')
    expect(out).toContain('Hello')
    expect(out).toContain('```ts')
    expect(out).toContain('<<CONST X = 1>>')
  })

  it('streamMarkdownToTerminal: async highlight patch is written once', async () => {
    const written: string[] = []
    const stream = {
      isTTY: true,
      write(chunk: string) {
        written.push(chunk)
      },
    }

    async function* chunks() {
      yield '```ts\nconst x = 1\n'
      yield '```\n'
    }

    await streamMarkdownToTerminal(chunks(), {
      terminal: { stream },
      requireTTY: false,
      startOnNewLine: false,
      finalOnly: false,
      render: {
        color: false,
        highlightCode: async code => `<<${code.toUpperCase()}>>`,
      },
    })

    const out = written.join('')
    const matches = out.match(/<<CONST X = 1>>/g) ?? []
    expect(matches).toHaveLength(1)
  })

  it('streamMarkdownToTerminal: finalOnly avoids streaming linefeeds', async () => {
    const written: string[] = []
    const stream = {
      isTTY: true,
      write(chunk: string) {
        written.push(chunk)
      },
    }

    const md = ['# UNIQUE_FINAL_ONLY_TEST', '', 'line 1', 'line 2', ''].join('\n')

    async function* chunks() {
      for (let i = 0; i < md.length; i += 5)
        yield md.slice(i, i + 5)
    }

    await streamMarkdownToTerminal(chunks(), {
      terminal: { stream, clear: false },
      requireTTY: false,
      startOnNewLine: true,
      finalOnly: true,
      render: { color: false, width: 80 },
    })

    const out = written.join('')

    // Default finalOnly mode is in-place streaming (no alt-screen), to avoid
    // terminals that dump alternate screen output into scrollback.
    expect(out).not.toContain(ansi.altScreenEnter)
    expect(out).not.toContain(ansi.altScreenExit)

    // Streaming patches should avoid real \n (we replace them with cursor moves).
    const expectedFinal = highlightMarkdown(md, { render: { color: false, width: 80 } })
    const expectedNewlines = (expectedFinal.match(/\n/g) ?? []).length + 1 // startOnNewLine
    expect((out.match(/\n/g) ?? []).length).toBe(expectedNewlines)

    // Final output is printed at the end (with real newlines).
    expect(out).toContain('UNIQUE_FINAL_ONLY_TEST\n')
  })

  it('streamMarkdownToTerminal: loadingIndicator shows during streaming but not in final output', async () => {
    const written: string[] = []
    const stream = {
      isTTY: true,
      write(chunk: string) {
        written.push(chunk)
      },
    }

    async function* chunks() {
      yield '# LOADING_TEST\n\n'
      // Keep the stream open briefly so the indicator can tick at least once in real time.
      await new Promise<void>(resolve => setTimeout(resolve, 50))
      yield 'done\n'
    }

    await streamMarkdownToTerminal(chunks(), {
      terminal: { stream, clear: false },
      requireTTY: false,
      startOnNewLine: false,
      finalOnly: true,
      loadingIndicator: {
        text: 'TEST_LOADING',
        frames: ['1', '2'],
        intervalMs: 10,
      },
      render: { color: false },
    })

    const out = written.join('')
    expect(out).toContain('TEST_LOADING')

    // Spinner writes happen without real newlines; the final output contains real newlines.
    const finalStart = out.lastIndexOf('LOADING_TEST\n')
    expect(finalStart).toBeGreaterThanOrEqual(0)
    const finalOut = out.slice(finalStart)
    expect(finalOut).toContain('LOADING_TEST')
    expect(finalOut).not.toContain('TEST_LOADING')
  })

  it('render all-syntax markdown (math/mermaid/etc)', () => {
    const md = fs.readFileSync(new URL('./fixtures/all.md', import.meta.url), 'utf8')
    const nodes = parseMarkdown(md)

    // Parser support varies; unsupported syntax is allowed to pass through as plain text.
    expect(Array.isArray(nodes)).toBe(true)
    expect(nodes.length).toBeGreaterThan(0)

    const out = highlightMarkdown(md, {
      render: {
        color: false,
        width: 40,
        streaming: true,
      },
    })

    expect(out).toContain('All Syntax Fixture\n')
    expect(out).toContain('H3 title')
    expect(out).toContain('H6 title')
    expect(out).toContain('Paragraph with bold, italic, strikethrough, highlight, and inline code.')
    expect(out).toContain('Hard line break follows.\nNext line after hard break.\n')

    expect(out).toContain('[OpenAI](https://openai.com)')
    expect(out).toContain('![Alt](https://example.com/a.png)')
    expect(out).toContain('html')

    expect(out).toContain('│ Blockquote intro')

    // Tables / task list / HTML blocks may be parsed or passed through.
    expect(out).toContain('Tables')
    expect(out).toContain('Col A | Col B')
    expect(out).toContain('Col A')
    expect(out).toContain('A2')
    expect(out).toContain('B2')

    expect(out).toContain('Task list')
    expect(out).toContain('done task')
    expect(out).toContain('pending task')

    expect(out).toContain('Autolinks')
    expect(out).toContain('https://openai.com')
    expect(out).toContain('test@example.com')

    expect(out).toContain('Diff')
    expect(out).toContain('```diff')
    expect(out).toContain('+new line')
    expect(out).toContain('-old line')

    expect(out).toContain('HTML block')
    expect(out).toContain('Block HTML')

    expect(out).toContain('Nested blockquote')
    expect(out).toContain('console.log(\'nested\')')
    expect(out).toContain('Normal paragraph after nested quote.')

    expect(out).toContain('Mixed lists')
    expect(out).toContain('deeper nested')
    expect(out).toContain('nested task')

    expect(out).toContain('Reference-style links')
    expect(out).toContain('ref link')
    expect(out).toContain('openai.com')

    expect(out).toContain('HTML comments')
    expect(out).toContain('comment should not crash')

    expect(out).toContain('Code fence edge cases')
    expect(out).toContain('This fenced block contains backticks')

    // Math: preserve `$` / `$$` delimiters as plain text
    expect(out).toContain('$E = mc^2$')
    expect(out).toContain('$$')
    expect(out).toContain('\\int_0^1 x^2')

    // Mermaid: treated as a fenced code block
    // Mermaid handling may vary (could be a code block, or plain text pass-through).
    expect(out).toContain('graph TD')
    expect(out).toContain('A-->B')

    // Footnotes may be normalized or omitted from the rendered output in streaming mode.
    expect(out).toContain('Footnote reference here')
    expect(out).toContain('Reference [1]')
  })

  it('streaming (redraw): all-syntax final output matches non-stream render', async () => {
    const md = fs.readFileSync(new URL('./fixtures/all.md', import.meta.url), 'utf8')

    const expected = highlightMarkdown(md, {
      render: {
        color: false,
        width: 40,
        streaming: true,
      },
    })

    const r = createMarkdownStreamRenderer({
      strategy: 'redraw',
      render: {
        color: false,
        width: 40,
      },
    })

    let lastPatch = ''
    for (let i = 0; i < md.length; i += 7) {
      const patch = r.push(md.slice(i, i + 7))
      if (patch)
        lastPatch = patch
    }

    const patches = await r.flush()
    for (const p of patches) {
      if (p)
        lastPatch = p
    }

    const actual = stripTerminalControlSequences(lastPatch)
    expect(actual).toBe(expected)
  })
})
