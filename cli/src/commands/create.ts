import { createSessionFromDefaults } from '../apiClient.js'
import type { CreatedSessionSummary, CreateFromDefaultsInput } from '../apiClient.js'

export interface CreateOptions {
  url: string
  title: string
  id?: string | undefined
  compaction?: 'none' | 'strip-reasoning' | undefined
  json: boolean
}

function formatDate(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 16).replace('T', ' ')
}

export async function runCreate(opts: CreateOptions): Promise<void> {
  const input: CreateFromDefaultsInput = { title: opts.title }
  if (opts.id !== undefined) input.sessionId = opts.id
  if (opts.compaction !== undefined) input.compactionStrategy = opts.compaction

  const result = await createSessionFromDefaults(opts.url, input)

  const { session } = result

  if (opts.json) {
    process.stdout.write(
      JSON.stringify(
        {
          api_version: 1,
          session: toJsonShape(session),
        },
        null,
        2,
      ) + '\n',
    )
    return
  }

  process.stdout.write(`${session.id}  ${session.title}\n`)
  process.stdout.write(`  status      ${session.status}\n`)
  process.stdout.write(`  init        ${session.initStatus}\n`)
  process.stdout.write(`  model       ${session.model.name}  (${session.model.id})\n`)
  if (session.mcp) {
    process.stdout.write(`  mcp         ${session.mcp.name}  (${session.mcp.id})\n`)
  }
  process.stdout.write(`  compaction  ${session.compactionStrategy}\n`)
  process.stdout.write(`  created     ${formatDate(session.createdAt)}\n`)
  process.stdout.write(`\nRun 'mcpscope status ${session.id}' to check initialization progress.\n`)
}

function toJsonShape(session: CreatedSessionSummary) {
  return {
    id: session.id,
    title: session.title,
    status: session.status,
    init_status: session.initStatus,
    model: session.model,
    mcp: session.mcp,
    compaction_strategy: session.compactionStrategy,
    created_at: session.createdAt,
    updated_at: session.updatedAt,
  }
}

export function parseCreateArgs(
  args: string[],
): { opts: CreateOptions } | { help: true } | { error: string } {
  let url: string | undefined
  let json = false
  let id: string | undefined
  let compaction: 'none' | 'strip-reasoning' | undefined
  let title: string | undefined

  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? ''
    if (arg === '-h' || arg === '--help') return { help: true }
    if (arg === '--url') {
      url = args[++i]
      if (!url) return { error: '--url requires a value' }
    } else if (arg === '--json') {
      json = true
    } else if (arg === '--id') {
      id = args[++i]
      if (!id) return { error: '--id requires a value' }
    } else if (arg === '--compaction') {
      const val = args[++i]
      if (!val) return { error: '--compaction requires a value' }
      if (val !== 'none' && val !== 'strip-reasoning') {
        return { error: `--compaction must be 'none' or 'strip-reasoning'` }
      }
      compaction = val
    } else if (!arg.startsWith('-')) {
      if (title !== undefined) return { error: 'Too many arguments: title must be a single quoted string' }
      title = arg
    } else {
      return { error: `Unknown option: ${arg}` }
    }
  }

  if (!title) return { error: 'Missing required argument: <title>' }

  const opts: CreateOptions = { url: url ?? '', json, title }
  if (id !== undefined) opts.id = id
  if (compaction !== undefined) opts.compaction = compaction
  return { opts }
}
