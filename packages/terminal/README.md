# markstream-terminal

Small, pragmatic ANSI terminal editing helpers:

- Anchor to a “line 0” cursor position and redraw from there
- Append-only updates for streaming
- Replace/delete/insert using (line, column) ranges (implemented as “rewrite tail”)
- Optional session wrapper for cursor hide/show + synchronized updates

## Install

```bash
npm i markstream-terminal
```

## Usage

```ts
import { createTerminalSession, range } from 'markstream-terminal'

const term = createTerminalSession({ clear: true })
term.start()

term.setText('Line1: Hello WORLD!\nLine2: ...\n')
term.replace(range(1, 14, 1, 18), 'MARKSTREAM')

term.stop()
```

## Notes

- “Range editing” is implemented by moving the cursor to the start position, then rewriting the tail and erasing the remainder (`CSI J`).
- Some terminal features (like synchronized updates `CSI ?2026`) are supported only on certain terminals; unsupported terminals ignore them.
