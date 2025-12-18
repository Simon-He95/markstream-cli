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
      render: { color: false },
    })
    expect(out).toBe('Hello World\n\nThis is bold.\n')
  })
})
