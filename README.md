## markstream-cli

Stream-render Markdown in a real terminal (with optional async code highlighting).

## Install

```bash
pnpm add markstream-cli
# or: npm i markstream-cli
# or: yarn add markstream-cli
```

## Usage

One-shot streaming to terminal:

```ts
import { createShikiHighlightCode, streamMarkdownToTerminal } from 'markstream-cli'

async function* chunks() {
  yield '# Hello\n\n'
  yield '```ts\nconst x = 1\n'
  yield '```\n'
}

await streamMarkdownToTerminal(chunks(), {
  terminal: { clear: true },
  // Optional debug instrumentation:
  // debug: { patches: true },
  render: {
    highlightCode: createShikiHighlightCode({ theme: 'nord' as any }),
  },
})
```

## Demos (repo)

These require a real TTY (run in an interactive terminal; not captured output).

- `pnpm run demo:stream`: character-by-character markdown streaming + code fence completion
- `pnpm run demo:highlight-md`: stream a larger markdown fixture + async code highlighting
- `pnpm test`: run unit tests

## Styling notes (terminal)

`**strong**` is rendered using ANSI "bold" (SGR `1`). Whether it *looks* bold depends on your terminal + font/theme:

- Some terminals/fonts show little/no difference for bold text (it may map to a brighter color instead).
- VS Code integrated terminal can look subtle depending on your font and theme.

If you need strong to be visually obvious everywhere, override the render theme:

```ts
await streamMarkdownToTerminal(chunks(), {
  render: {
    // Make strong more visible across terminals:
    theme: { strong: { bold: true, underline: true } },
  },
})
```

## Advanced: low-level renderer

If you want to manage terminal I/O yourself (or integrate with another terminal abstraction),
use `createMarkdownStreamRenderer()`:

```ts
import { createMarkdownStreamRenderer } from 'markstream-cli'

const r = createMarkdownStreamRenderer({
  strategy: 'smart', // append when possible
  render: { color: true },
})

process.stdout.write(r.push('# Title\n\nHello **world**.\n'))
process.stdout.write(r.push('```ts\nconst x = 1\n'))
process.stdout.write(r.push('```'))
await r.flush()
```

## Troubleshooting

- **Nothing updates / looks wrong when piping**: streaming requires a TTY. For programmatic usage set `terminal.stream.isTTY = true` only if your target really is a terminal.
- **Flicker during rewrites**: prefer `streamMarkdownToTerminal()` (it uses synchronized updates and streaming-friendly patching), or set `strategy: 'smart'` unless you need full redraw behavior.

## :coffee:

[buy me a cup of coffee](https://github.com/Simon-He95/sponsor)

## License

[MIT](./license)

## Sponsors

<p align="center">
  <a href="https://cdn.jsdelivr.net/gh/Simon-He95/sponsor/sponsors.svg">
    <img src="https://cdn.jsdelivr.net/gh/Simon-He95/sponsor/sponsors.png"/>
  </a>
</p>
