import { listSessions } from '../../apiClient.js'

export interface SessionsListOptions {
  url: string
  json: boolean
}

function formatDate(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 16).replace('T', ' ')
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`
}

export async function runSessionsList(opts: SessionsListOptions): Promise<void> {
  const result = await listSessions(opts.url)
  const sessions = result.sessions

  if (opts.json) {
    process.stdout.write(
      JSON.stringify({ api_version: 1, sessions }, null, 2) + '\n',
    )
    return
  }

  if (sessions.length === 0) {
    process.stdout.write('No sessions found.\n')
    return
  }

  const header = `${'ID'.padEnd(26)}  ${'TITLE'.padEnd(32)}  ${'STATUS'.padEnd(12)}  ${'MODEL'.padEnd(28)}  UPDATED`
  const separator = '-'.repeat(header.length)
  process.stdout.write(header + '\n')
  process.stdout.write(separator + '\n')

  for (const session of sessions) {
    const id = truncate(session.id, 26)
    const title = truncate(session.title, 32)
    const status = truncate(session.status, 12)
    const model = truncate(session.modelProfileSnapshot.name, 28)
    const updated = formatDate(session.updatedAt)
    process.stdout.write(
      `${id.padEnd(26)}  ${title.padEnd(32)}  ${status.padEnd(12)}  ${model.padEnd(28)}  ${updated}\n`,
    )
  }
}

export function printSessionsListHelp(): void {
  process.stdout.write(`Usage: mcpscope sessions list [--json] [--url <url>]

  --json    emit JSON instead of the default columnar text table
`)
}

export function parseSessionsListArgs(
  args: string[],
): { opts: SessionsListOptions } | { help: true } | { error: string } {
  let url: string | undefined
  let json = false

  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? ''
    if (arg === '-h' || arg === '--help') return { help: true }
    if (arg === '--url') {
      url = args[++i]
      if (!url) return { error: '--url requires a value' }
    } else if (arg === '--json') {
      json = true
    } else {
      return { error: `Unknown option: ${arg}` }
    }
  }

  return { opts: { url: url ?? '', json } }
}
