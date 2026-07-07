import hljs from 'highlight.js/lib/core'
import markdown from 'highlight.js/lib/languages/markdown'

hljs.registerLanguage('markdown', markdown)

/**
 * Returns HTML string with hljs span classes applied to markdown source text.
 * The text is kept as-is (not rendered as HTML) — only syntax markers are coloured.
 */
export function highlightMarkdown(text: string): string {
  try {
    return hljs.highlight(text, { language: 'markdown' }).value
  } catch {
    // Fallback: return escaped plain text
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }
}
