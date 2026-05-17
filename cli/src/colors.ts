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
const dim            = (t: string): string => ansi('2',  '22', t)
const yellow         = (t: string): string => ansi('33', '39', t)

// Token annotation: dim for included, yellow for non-included states
export function colorTokens(count: number | null | undefined, state: string | undefined): string {
  if (count == null) return ''
  const suffix = state && state !== 'included' ? ` - ${state}` : ''
  const text = `  (${count} tokens${suffix})`
  return suffix ? yellow(text) : dim(text)
}
