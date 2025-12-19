/**
 * Normalize raw markdown input before feeding it into markdown-it.
 *
 * We currently escape HTML comments that start a line (e.g. `<!-- ... -->`).
 * Some markdown-it configurations/tokenizers may treat them as an unterminated
 * HTML block and consume the rest of the document.
 *
 * By inserting a backslash before the opening `<`, markdown renders the comment
 * as plain text (`<!-- ... -->`) which matches our "unsupported syntax renders
 * as plain text" goal.
 */
export function normalizeMarkdownInput(markdown: string): string {
  if (!markdown)
    return markdown

  // Only escape comments that begin a line (optionally preceded by spaces/tabs).
  // Avoid touching inline usages and reduce the risk of interfering with code.
  return markdown.replace(/(^|\n)([\t ]*)<!--/g, '$1$2\\<!--')
}
