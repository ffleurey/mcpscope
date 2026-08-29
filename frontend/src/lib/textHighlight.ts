import { highlightJson } from './jsonHighlight'
import { highlightMarkdown } from './markdownHighlight'
import { renderMarkdown } from './markdownRender'

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

export type SessionAnswer = {
  html: string
  format: 'json' | 'prose'
}

/**
 * Renders an assistant answer for the transcript: JSON payloads keep the
 * syntax-highlighted source form; everything else renders as markdown
 * (markdown-it escapes plain text, so non-markdown answers pass through
 * unchanged apart from paragraph wrapping).
 */
export function renderSessionAnswer(text: string): SessionAnswer {
  const parsedJson = parseJsonText(text)
  if (parsedJson !== null) {
    return {
      html: highlightJson(parsedJson),
      format: 'json',
    }
  }

  return {
    html: renderMarkdown(text),
    format: 'prose',
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
