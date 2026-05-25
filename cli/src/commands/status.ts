import { statusOperation } from '@mcpscope/shared'

export interface StatusOptions {
  url: string
  sessionId: string
  json: boolean
}

export async function runStatus(opts: StatusOptions): Promise<void> {
  const result = await statusOperation.execute(opts.url, { session_id: opts.sessionId })

  if (opts.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n')
    return
  }

  const state = result.session.state
  process.stdout.write(`${result.session.id}  ${state}\n`)

  if (state === 'running' && result.active_turn) {
    process.stdout.write(`  turn  ${result.active_turn.id}  ${result.active_turn.status}\n`)
  }

  if (state === 'ready') {
    process.stdout.write(`\nRun 'mcpscope send ${result.session.id} <prompt>' to start a turn.\n`)
  } else if (state === 'running') {
    process.stdout.write(`\nRun 'mcpscope status ${result.session.id}' again to poll for completion.\n`)
  } else if (state === 'initializing') {
    process.stdout.write(`\nRun 'mcpscope status ${result.session.id}' again to check initialization progress.\n`)
  }
}

export function parseStatusArgs(
  args: string[],
): { opts: StatusOptions } | { help: true } | { error: string } {
  let url: string | undefined
  let json = false
  let sessionId: string | undefined

  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? ''
    if (arg === '-h' || arg === '--help') return { help: true }
    if (arg === '--url') {
      url = args[++i]
      if (!url) return { error: '--url requires a value' }
    } else if (arg === '--json') {
      json = true
    } else if (!arg.startsWith('-')) {
      if (sessionId !== undefined) return { error: 'Too many arguments: only one session ID is allowed' }
      sessionId = arg
    } else {
      return { error: `Unknown option: ${arg}` }
    }
  }

  if (!sessionId) return { error: 'Missing required argument: <session-id>' }

  return { opts: { url: url ?? '', json, sessionId } }
}
