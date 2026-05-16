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

const batchIntervalMs = 16
const batchMaxChars = 4096

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

  let buffered = ''
  let batchTimer: ReturnType<typeof setTimeout> | undefined
  let batchError: unknown
  const shouldBatchChunks = options.onChunkPushed == null

  function clearBatchTimer() {
    if (!batchTimer)
      return
    clearTimeout(batchTimer)
    batchTimer = undefined
  }

  function flushBuffered() {
    if (!buffered)
      return
    const chunk = buffered
    buffered = ''
    clearBatchTimer()
    s.push(chunk)
  }

  function scheduleFlush() {
    if (batchTimer)
      return
    batchTimer = setTimeout(() => {
      try {
        flushBuffered()
      }
      catch (error) {
        batchError = error
      }
    }, batchIntervalMs)
    batchTimer.unref?.()
  }

  function pushChunk(chunk: string) {
    if (!shouldBatchChunks) {
      s.push(chunk)
      return
    }

    buffered += chunk
    if (buffered.length >= batchMaxChars)
      flushBuffered()
    else
      scheduleFlush()
  }

  function throwBatchError() {
    if (batchError)
      throw batchError
  }

  try {
    await forEachChunk(source, async (chunk) => {
      throwBatchError()
      pushChunk(chunk)
      await options.onChunkPushed?.(chunk)
    })

    throwBatchError()
    flushBuffered()
    await s.flush()

    return {
      term: s.term,
      getContent: () => s.getContent(),
    }
  }
  finally {
    clearBatchTimer()
    s.stop()
  }
}
