import { cliList } from '../../httpClient.js'

export interface SessionsListOptions {
  url: string
  json: boolean
  limit?: number
  offset?: number
}

function formatDate(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 16).replace('T', ' ')
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`
}

export async function runSessionsList(opts: SessionsListOptions): Promise<void> {
  const page: { limit?: number; offset?: number } = {}
  if (opts.limit !== undefined) page.limit = opts.limit
  if (opts.offset !== undefined) page.offset = opts.offset
  const result = await cliList(opts.url, page)
  const sessions = result.sessions

  if (opts.json) {
    process.stdout.write(
      JSON.stringify(result, null, 2) + '\n',
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
    const model = truncate(session.model, 28)
    const updated = formatDate(session.updated_at)
    process.stdout.write(
      `${id.padEnd(26)}  ${title.padEnd(32)}  ${status.padEnd(12)}  ${model.padEnd(28)}  ${updated}\n`,
    )
  }

  const shownTo = result.offset + sessions.length
  process.stdout.write(
    `\nShowing ${result.offset + 1}-${shownTo} of ${result.total} top-level sessions.` +
      (result.has_more ? ` Use --offset ${shownTo} for more.` : '') +
      '\n',
  )
}

export function parseSessionsListArgs(
  args: string[],
): { opts: SessionsListOptions } | { help: true } | { error: string } {
  let url: string | undefined
  let json = false
  let limit: number | undefined
  let offset: number | undefined

  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? ''
    if (arg === '-h' || arg === '--help') return { help: true }
    if (arg === '--url') {
      url = args[++i]
      if (!url) return { error: '--url requires a value' }
    } else if (arg === '--json') {
      json = true
    } else if (arg === '--limit') {
      const raw = args[++i]
      const value = Number(raw)
      if (!raw || !Number.isInteger(value) || value < 1) {
        return { error: '--limit requires a positive integer' }
      }
      limit = value
    } else if (arg === '--offset') {
      const raw = args[++i]
      const value = Number(raw)
      if (!raw || !Number.isInteger(value) || value < 0) {
        return { error: '--offset requires a non-negative integer' }
      }
      offset = value
    } else {
      return { error: `Unknown option: ${arg}` }
    }
  }

  const opts: SessionsListOptions = { url: url ?? '', json }
  if (limit !== undefined) opts.limit = limit
  if (offset !== undefined) opts.offset = offset
  return { opts }
}
