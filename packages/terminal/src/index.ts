export type { TerminalPos, TerminalRange } from './terminal'
export { ansi, applyInsert, applyReplace, createAnchoredTextSurface, indexToPos, posToIndex, stripAnsi, visibleCellWidth, visibleLength } from './terminal'

export type { TerminalSession, TerminalSessionOptions, WritableLike } from './terminal-session'
export { createTerminalSession, pos, range } from './terminal-session'
