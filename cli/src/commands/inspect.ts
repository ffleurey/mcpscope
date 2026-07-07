import { cliInspect, cliInspectText } from '../httpClient.js'

export interface InspectOptions {
  url: string
  id: string
  json: boolean
  short: boolean
}

// ─── Entry point ──────────────────────────────────────────────────────────────
//
// Rendering is a backend domain feature:
// the CLI no longer renders payloads itself. It asks the backend for text (default)
// or JSON (`--json`) and prints what it gets, so CLI/MCP/UI share one renderer.

export async function runInspect(opts: InspectOptions): Promise<void> {
  const input = { id: opts.id, ...(opts.short ? { short: true } : {}) }

  if (opts.json) {
    const result = await cliInspect(opts.url, input)
    process.stdout.write(JSON.stringify(result, null, 2) + '\n')
    return
  }

  const text = await cliInspectText(opts.url, input)
  process.stdout.write(text + '\n')
}

export function parseInspectArgs(
  args: string[],
): { opts: InspectOptions } | { help: true } | { error: string } {
  let url: string | undefined
  let json = false
  let short = false
  let id: string | undefined

  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? ''
    if (arg === '-h' || arg === '--help') return { help: true }
    if (arg === '--url') {
      url = args[++i]
      if (!url) return { error: '--url requires a value' }
    } else if (arg === '--json') {
      json = true
    } else if (arg === '--short') {
      short = true
    } else if (!arg.startsWith('-')) {
      if (id !== undefined) return { error: 'Too many arguments: only one ID is allowed' }
      id = arg
    } else {
      return { error: `Unknown option: ${arg}` }
    }
  }

  if (!id) return { error: 'Missing required argument: <id>' }

  return { opts: { url: url ?? '', json, short, id } }
}
