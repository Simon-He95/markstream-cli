import { performance } from 'node:perf_hooks'
import process from 'node:process'
import { createMarkdownStreamRenderer } from '../src/index'

type ChunkMode = 'whole' | 'line' | 'char'

const sizes = [10 * 1024, 100 * 1024, 1024 * 1024]
const modes: ChunkMode[] = ['whole', 'line', 'char']
const lineLimit = Number(process.env.MARKSTREAM_BENCH_LINE_LIMIT ?? 10 * 1024)
const charLimit = Number(process.env.MARKSTREAM_BENCH_CHAR_LIMIT ?? 2 * 1024)

function makeMarkdown(size: number) {
  const block = [
    '# Heading',
    '',
    'Paragraph with **bold**, _italic_, `inline code`, and a [link](https://example.com).',
    '',
    '- item one',
    '- item two',
    '',
    '```ts',
    'const x: number = 1',
    'console.log(x)',
    '```',
    '',
  ].join('\n')

  let out = ''
  while (out.length < size)
    out += block
  return out.slice(0, size)
}

function* chunkMarkdown(markdown: string, mode: ChunkMode) {
  if (mode === 'whole') {
    yield markdown
    return
  }

  if (mode === 'line') {
    let start = 0
    while (start < markdown.length) {
      const nextNewline = markdown.indexOf('\n', start)
      if (nextNewline === -1) {
        yield markdown.slice(start)
        return
      }
      yield markdown.slice(start, nextNewline + 1)
      start = nextNewline + 1
    }
    return
  }

  for (const char of markdown)
    yield char
}

async function run(size: number, mode: ChunkMode) {
  const markdown = makeMarkdown(size)
  const renderer = createMarkdownStreamRenderer({
    render: {
      color: false,
      width: 80,
    },
  })
  let chunks = 0
  const start = performance.now()

  for (const chunk of chunkMarkdown(markdown, mode)) {
    renderer.push(chunk)
    chunks += 1
  }
  await renderer.flush()

  return {
    chunks,
    ms: Math.round((performance.now() - start) * 100) / 100,
  }
}

for (const size of sizes) {
  for (const mode of modes) {
    if (mode === 'line' && size > lineLimit) {
      console.log(`${size}\t${mode}\tskipped\tset MARKSTREAM_BENCH_LINE_LIMIT=${size} to run`)
      continue
    }

    if (mode === 'char' && size > charLimit) {
      console.log(`${size}\t${mode}\tskipped\tset MARKSTREAM_BENCH_CHAR_LIMIT=${size} to run`)
      continue
    }

    const result = await run(size, mode)
    console.log(`${size}\t${mode}\t${result.chunks}\t${result.ms}ms`)
  }
}
