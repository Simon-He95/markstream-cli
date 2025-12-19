## markstream-cli

Stream-render Markdown in a real terminal (with optional async code highlighting).

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
