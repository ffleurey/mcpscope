// ANSI color support with automatic TTY detection.
//
// Colors are emitted only when:
//   - stdout is a real terminal (process.stdout.isTTY)
//   - NO_COLOR env var is not set  (https://no-color.org)
//   - FORCE_COLOR overrides both
//
// When stdout is piped to a file, script, or LLM, isTTY is false and
// all functions return plain text. JSON mode never calls these helpers.

function enabled(): boolean {
  if (process.env['FORCE_COLOR'] !== undefined) return true
  if (process.env['NO_COLOR'] !== undefined) return false
  return process.stdout.isTTY === true
}

function ansi(open: string, close: string, text: string): string {
  return enabled() ? `\x1b[${open}m${text}\x1b[${close}m` : text
}

export const bold    = (t: string): string => ansi('1',  '22', t)
export const dim     = (t: string): string => ansi('2',  '22', t)
export const cyan    = (t: string): string => ansi('36', '39', t)
export const green   = (t: string): string => ansi('32', '39', t)
export const yellow  = (t: string): string => ansi('33', '39', t)
export const magenta = (t: string): string => ansi('35', '39', t)
export const gray    = (t: string): string => ansi('90', '39', t)

// Part type: only the conversational parts get emphasis; everything else is plain
const BOLD_PART_TYPES = new Set(['user_prompt', 'assistant_answer'])

export function colorPartType(type: string): string {
  return BOLD_PART_TYPES.has(type) ? bold(type) : type
}

// Token annotation: dim for included, yellow for non-included states
export function colorTokens(count: number | null | undefined, state: string | undefined): string {
  if (count == null) return ''
  const suffix = state && state !== 'included' ? ` - ${state}` : ''
  const text = `  (${count} tokens${suffix})`
  return suffix ? yellow(text) : dim(text)
}
