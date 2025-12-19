import type { TerminalSession, TerminalSessionOptions } from 'markstream-terminal'
import type { TerminalMarkdownStreamOptions } from './terminal-markdown-stream'
import { createTerminalMarkdownStream } from './terminal-markdown-stream'

export type MarkdownChunkSource = string | Iterable<string> | AsyncIterable<string>

export interface StreamMarkdownToTerminalOptions extends TerminalMarkdownStreamOptions {
  /**
   * Optional hook invoked after each chunk is pushed.
   * Useful for demos/tests.
   */
  onChunkPushed?: (chunk: string) => void | Promise<void>
}

function isAsyncIterable(x: any): x is AsyncIterable<string> {
  return Boolean(x && typeof x === 'object' && typeof x[Symbol.asyncIterator] === 'function')
}

function isIterable(x: any): x is Iterable<string> {
  return Boolean(x && typeof x === 'object' && typeof x[Symbol.iterator] === 'function')
}

async function forEachChunk(source: MarkdownChunkSource, fn: (chunk: string) => void | Promise<void>) {
  if (typeof source === 'string') {
    await fn(source)
    return
  }

  if (isAsyncIterable(source)) {
    for await (const chunk of source)
      await fn(chunk)
    return
  }

  if (isIterable(source)) {
    for (const chunk of source)
      await fn(chunk)
    return
  }

  throw new TypeError('Invalid markdown chunk source')
}

export interface StreamMarkdownToTerminalResult {
  term: TerminalSession
  getContent: () => string
}

/**
 * High-level helper that streams markdown to a terminal session.
 * It automatically starts/stops the session and flushes pending async highlights.
 */
export async function streamMarkdownToTerminal(
  source: MarkdownChunkSource,
  options: StreamMarkdownToTerminalOptions & { terminal?: TerminalSession | TerminalSessionOptions } = {},
): Promise<StreamMarkdownToTerminalResult> {
  const s = createTerminalMarkdownStream(options)
  s.start()

  try {
    await forEachChunk(source, async (chunk) => {
      s.push(chunk)
      await options.onChunkPushed?.(chunk)
    })

    await s.flush()

    return {
      term: s.term,
      getContent: () => s.getContent(),
    }
  }
  finally {
    s.stop()
  }
}
