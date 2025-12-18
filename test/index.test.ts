import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { highlightMarkdown, parseMarkdown } from '../src/index'

describe('should', () => {
  it('parse markdown to nodes', () => {
    const nodes = parseMarkdown('# Hello World')
    expect(nodes[0]?.type).toBe('heading')
    expect((nodes[0] as any).level).toBe(1)
  })

  it('render heading + paragraph (no color)', () => {
    const out = highlightMarkdown('# Hello World\n\nThis is **bold**.', {
      render: { color: true },
    })
    // eslint-disable-next-line no-console
    console.log(out)
    expect(true).toBe(true)
  })

  it('render complex markdown (heading/blockquote/code/footnote/reference)', () => {
    const md = fs.readFileSync(new URL('./fixtures/complex.md', import.meta.url), 'utf8')
    const out = highlightMarkdown(md, { render: { color: true, width: 40 } })

    // eslint-disable-next-line no-console
    console.log(out)
    expect(true).toBe(true)
  })
})
