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
  const force = process.env['FORCE_COLOR']
  if (force !== undefined) return force !== '0' && force !== 'false'
  if (process.env['NO_COLOR'] !== undefined) return false
  return process.stdout.isTTY === true
}

function ansi(open: string, close: string, text: string): string {
  return enabled() ? `\x1b[${open}m${text}\x1b[${close}m` : text
}

export const bold    = (t: string): string => ansi('1',  '22', t)
