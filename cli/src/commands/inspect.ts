import { lookupById } from '../apiClient.js'

export interface InspectOptions {
  url: string
  id: string
  format: 'text' | 'json'
  mode: 'summary' | 'full'
}

function formatDate(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 16).replace('T', ' ')
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`
}

function printKV(key: string, value: string): void {
  process.stdout.write(`  ${key.padEnd(18)} ${value}\n`)
}

function printSection(title: string): void {
  process.stdout.write(`\n${title}\n${'─'.repeat(title.length)}\n`)
}

type AnyRecord = Record<string, unknown>

function renderPart(part: AnyRecord, indent = ''): void {
  const id = String(part['id'] ?? '')
  const type = String(part['type'] ?? '')
  const tokens = part['token_count'] != null ? ` tokens=${part['token_count']}` : ''
  const state = part['context_state'] ? ` [${part['context_state']}]` : ''
  const toolName = part['tool_name'] ? ` tool=${part['tool_name']}` : ''
  process.stdout.write(`${indent}${id}  type=${type}${tokens}${state}${toolName}\n`)

  // In full mode, show content if present
  const content = part['content'] as AnyRecord | undefined
  if (content) {
    if (typeof content['text'] === 'string') {
      const preview = truncate(content['text'].replace(/\n/g, ' '), 120)
      process.stdout.write(`${indent}  content: ${preview}\n`)
    } else if (Array.isArray(content['json'])) {
      process.stdout.write(`${indent}  content: [${(content['json'] as unknown[]).length} items]\n`)
    }
  }

  const toolPayload = part['tool_payload'] as AnyRecord | undefined
  if (toolPayload) {
    const call = toolPayload['call']
    const result = toolPayload['result'] as AnyRecord | undefined
    const callStr = call && typeof call === 'object' ? JSON.stringify(call) : String(call ?? '')
    process.stdout.write(`${indent}  call:    ${truncate(callStr, 100)}\n`)
    if (result && typeof result['text'] === 'string') {
      process.stdout.write(`${indent}  result:  ${truncate(result['text'].replace(/\n/g, ' '), 100)}\n`)
    }
  }
}

function renderSetup(setup: AnyRecord): void {
  printSection(`Setup  ${setup['id'] ?? ''}`)
  const parts = setup['parts'] as AnyRecord[] | undefined
  if (parts) {
    for (const part of parts) renderPart(part, '  ')
  }
}

function renderRound(round: AnyRecord): void {
  const id = String(round['id'] ?? '')
  const status = round['status'] ? `  status=${round['status']}` : ''
  process.stdout.write(`  Round ${round['number'] ?? '?'}  ${id}${status}\n`)
  const parts = round['parts'] as AnyRecord[] | undefined
  if (parts) {
    for (const part of parts) renderPart(part, '    ')
  }
}

function renderTurn(turn: AnyRecord): void {
  const id = String(turn['id'] ?? '')
  const status = turn['status'] ? `  status=${turn['status']}` : ''
  process.stdout.write(`Turn ${turn['number'] ?? '?'}  ${id}${status}\n`)
  const rounds = turn['rounds'] as AnyRecord[] | undefined
  if (rounds) {
    for (const round of rounds) renderRound(round)
  }
}

function renderSessionText(data: AnyRecord, mode: 'summary' | 'full'): void {
  const model = data['model'] as AnyRecord | undefined
  const mcp = data['mcp'] as AnyRecord | undefined
  const ctxWindow = data['context_window'] as AnyRecord | undefined

  printSection(`Session  ${data['id'] ?? ''}  (${mode})`)
  printKV('title:', String(data['title'] ?? ''))
  if (model) printKV('model:', `${model['name'] ?? ''}  key=${model['key'] ?? ''}`)
  if (mcp) printKV('mcp:', `${mcp['name'] ?? ''}  strategy=${mcp['strategy'] ?? ''}`)
  if (ctxWindow) {
    printKV('context_window:', `used=${ctxWindow['used'] ?? '?'}  available=${ctxWindow['available'] ?? '?'}`)
  }

  const setup = data['setup'] as AnyRecord | undefined
  if (setup) renderSetup(setup)

  const turns = data['turns'] as AnyRecord[] | undefined
  if (turns && turns.length > 0) {
    printSection(`Turns (${turns.length})`)
    for (const turn of turns) renderTurn(turn)
  }
}

function renderTurnText(data: AnyRecord, mode: 'summary' | 'full'): void {
  printSection(`Turn ${data['number'] ?? '?'}  ${data['id'] ?? ''}  (${mode})`)
  if (data['status']) printKV('status:', String(data['status']))
  const rounds = data['rounds'] as AnyRecord[] | undefined
  if (rounds && rounds.length > 0) {
    for (const round of rounds) renderRound(round)
  }
}

function renderRoundText(data: AnyRecord, mode: 'summary' | 'full'): void {
  printSection(`Round ${data['number'] ?? '?'}  ${data['id'] ?? ''}  (${mode})`)
  if (data['status']) printKV('status:', String(data['status']))
  const parts = data['parts'] as AnyRecord[] | undefined
  if (parts && parts.length > 0) {
    process.stdout.write('\n')
    for (const part of parts) renderPart(part, '  ')
  }
}

function renderSetupText(data: AnyRecord, mode: 'summary' | 'full'): void {
  printSection(`Setup  ${data['id'] ?? ''}  (${mode})`)
  renderSetup(data)
}

function renderPartText(data: AnyRecord, mode: 'summary' | 'full'): void {
  printSection(`Part  ${data['id'] ?? ''}  (${mode})`)
  renderPart(data, '  ')
}

function renderCreatedAt(data: AnyRecord): void {
  const ts = data['createdAt'] ?? data['created_at']
  if (typeof ts === 'number') printKV('created_at:', formatDate(ts))
}

export async function runInspect(opts: InspectOptions): Promise<void> {
  const result = await lookupById(opts.url, opts.id, opts.mode)

  if (opts.format === 'json') {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n')
    return
  }

  const { type, data, mode } = result
  const d = data as AnyRecord

  renderCreatedAt(d)

  switch (type) {
    case 'session':
      renderSessionText(d, mode as 'summary' | 'full')
      break
    case 'turn':
      renderTurnText(d, mode as 'summary' | 'full')
      break
    case 'round':
      renderRoundText(d, mode as 'summary' | 'full')
      break
    case 'setup':
      renderSetupText(d, mode as 'summary' | 'full')
      break
    case 'part':
      renderPartText(d, mode as 'summary' | 'full')
      break
    default:
      // Unknown type: fall back to compact JSON
      process.stdout.write(JSON.stringify(result, null, 2) + '\n')
  }
  process.stdout.write('\n')
}

export function printInspectHelp(): void {
  process.stdout.write(`Usage: mcpscope inspect <id> [options]

Inspect a session, turn, round, or part by its hierarchical ID.

Arguments:
  <id>               Hierarchical ID (e.g. QGWA, QGWA.1, QGWA.1.1, QGWA.1.1.2-T)

Options:
  --format <fmt>     Output format: text (default) or json
  --mode <mode>      Detail level: summary (default) or full
  --url <url>        Backend URL (overrides MCPSCOPE_URL env var)
  -h, --help         Show this help

Environment:
  MCPSCOPE_URL       Backend URL (default: http://localhost:3030)
`)
}

export function parseInspectArgs(
  args: string[],
): { opts: InspectOptions } | { help: true } | { error: string } {
  let url: string | undefined
  let format: 'text' | 'json' = 'text'
  let mode: 'summary' | 'full' = 'summary'
  let id: string | undefined

  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? ''
    if (arg === '-h' || arg === '--help') return { help: true }
    if (arg === '--url') {
      url = args[++i]
      if (!url) return { error: '--url requires a value' }
    } else if (arg === '--format') {
      const fmt = args[++i]
      if (fmt !== 'text' && fmt !== 'json') return { error: `--format must be "text" or "json"` }
      format = fmt
    } else if (arg === '--mode') {
      const m = args[++i]
      if (m !== 'summary' && m !== 'full') return { error: `--mode must be "summary" or "full"` }
      mode = m
    } else if (!arg.startsWith('-')) {
      if (id !== undefined) return { error: 'Too many arguments: only one ID is allowed' }
      id = arg
    } else {
      return { error: `Unknown option: ${arg}` }
    }
  }

  if (!id) return { error: 'Missing required argument: <id>' }

  return { opts: { url: url ?? '', format, mode, id } }
}
