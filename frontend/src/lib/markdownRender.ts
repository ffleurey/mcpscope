import MarkdownIt from 'markdown-it'

// Raw HTML from model output is kept disabled — this renderer is for preview only.
const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: false,
})

/**
 * Renders markdown source text to an HTML string.
 * Raw HTML passthrough is disabled: model-authored HTML tags appear as literal text.
 * Returns escaped plain text on error.
 */
export function renderMarkdown(text: string): string {
  try {
    return md.render(text)
  } catch {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }
}

/**
 * Returns true when the text has enough markdown markers to be worth offering a preview.
 * Deliberately lenient — false positives are fine; false negatives are not.
 */
export function looksLikeMarkdown(text: string): boolean {
  return (
    /^#{1,6} /m.test(text) || // headings
    /\*\*\S/.test(text) || // bold
    /\[.+\]\(https?:\/\//.test(text) || // links
    /^[-*+] \S/m.test(text) || // unordered lists
    /^\d+\. \S/m.test(text) || // ordered lists
    /^```/m.test(text) || // fenced code blocks
    /^>/m.test(text) || // blockquotes
    /\|.*\|.*\|/.test(text)
  ) // tables
}
