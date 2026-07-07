import hljs from 'highlight.js/lib/core'
import json from 'highlight.js/lib/languages/json'

hljs.registerLanguage('json', json)

/**
 * Returns an HTML string with hljs span classes applied to the JSON representation
 * of `data`. Falls back to escaped plain text if highlighting fails.
 */
export function highlightJson(data: unknown): string {
  const text = JSON.stringify(data, null, 2) ?? 'null'
  try {
    return hljs.highlight(text, { language: 'json' }).value
  } catch {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }
}
