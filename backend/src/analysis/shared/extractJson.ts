/**
 * Extract a single JSON object from an LLM response that may wrap it in prose or
 * a Markdown code fence.
 *
 * The previous per-step implementations sliced `indexOf('{')`…`lastIndexOf('}')`,
 * which over-captures when the model's trailing prose contains a stray `}`. This
 * version scans brace depth (string/escape aware) from the first `{` to find the
 * matching close, so surrounding prose can't corrupt the slice. The caller still
 * `JSON.parse()`s the returned substring.
 */
export function extractJsonBlock(text: string): string {
  const trimmed = text.trim()
  const fenced = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
  const source = fenced?.[1]?.trim() ?? trimmed

  const start = source.indexOf('{')
  if (start === -1) return source

  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < source.length; i++) {
    const ch = source[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return source.slice(start, i + 1)
    }
  }

  // Unbalanced (truncated output): fall back to the last closing brace.
  const end = source.lastIndexOf('}')
  if (end > start) return source.slice(start, end + 1)
  return source
}
