import { highlightJson } from './jsonHighlight'
import { highlightMarkdown } from './markdownHighlight'

export type HighlightedText = {
  html: string
  format: 'json' | 'markdown'
}

function parseJsonText(text: string): unknown | null {
  const trimmed = text.trim()
  if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) {
    return null
  }

  try {
    return JSON.parse(trimmed)
  } catch {
    return null
  }
}

export function highlightStructuredText(text: string): HighlightedText {
  const parsedJson = parseJsonText(text)
  if (parsedJson !== null) {
    return {
      html: highlightJson(parsedJson),
      format: 'json',
    }
  }

  return {
    html: highlightMarkdown(text),
    format: 'markdown',
  }
}