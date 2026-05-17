import { lookupById } from '../apiClient.js'
import { bold, colorTokens, dim } from '../colors.js'

export interface InspectOptions {
  url: string
  id: string
  format: 'text' | 'json'
  mode: 'summary' | 'full'
}

function out(line: string): void {
  process.stdout.write(line + '\n')
}

type AnyRecord = Record<string, unknown>

// ─── Part ─────────────────────────────────────────────────────────────────────

const HIGHLIGHTED_CONTENT_TYPES = new Set(['user_prompt', 'assistant_answer'])

function renderPartLine(part: AnyRecord, indent: string): void {
  const id = String(part['id'] ?? '')
  const type = String(part['type'] ?? '')
  const toolName = part['tool_name'] ? `  ${part['tool_name']}` : ''
  const state = String(part['context_state'] ?? '')
  const count = part['token_count'] != null ? Number(part['token_count']) : null
  out(`${indent}${id}  ${type}${toolName}${colorTokens(count, state)}`)
}

function renderTextBlock(text: string, indent: string, highlight = false): void {
  for (const line of text.split('\n')) {
    out(`${indent}${highlight ? bold(line) : line}`)
  }
}

function renderPartContent(part: AnyRecord, indent: string): void {
  const type = String(part['type'] ?? '')
  const highlight = HIGHLIGHTED_CONTENT_TYPES.has(type)
  const content = part['content'] as AnyRecord | undefined
  if (content) {
    if (typeof content['text'] === 'string') {
      renderTextBlock(content['text'], indent, highlight)
    } else if (Array.isArray(content['json'])) {
      renderTextBlock(JSON.stringify(content['json'], null, 2), indent)
    }
  }

  const toolPayload = part['tool_payload'] as AnyRecord | undefined
  if (toolPayload) {
    const call = toolPayload['call']
    const result = toolPayload['result'] as AnyRecord | undefined
    out(`${indent}call  ${JSON.stringify(call)}`)
    if (result) {
      out(`${indent}result`)
      if (typeof result['text'] === 'string') {
        renderTextBlock(result['text'], indent + '  ')
      } else {
        renderTextBlock(JSON.stringify(result, null, 2), indent + '  ')
      }
    }
  }
}

function renderPart(part: AnyRecord, indent: string): void {
  renderPartLine(part, indent)
  renderPartContent(part, indent + '  ')
}

// ─── Flatten helpers ──────────────────────────────────────────────────────────

function renderTurnParts(turn: AnyRecord): void {
  const rounds = turn['rounds'] as AnyRecord[] | undefined
  if (!rounds) return
  for (const round of rounds) {
    const parts = round['parts'] as AnyRecord[] | undefined
    if (parts) {
      for (const part of parts) renderPart(part, '')
    }
  }
}

// ─── Type-specific text renderers ─────────────────────────────────────────────

function renderSessionText(data: AnyRecord): void {
  const model = data['model'] as AnyRecord | undefined
  const mcp = data['mcp'] as AnyRecord | undefined
  const ctxWindow = data['context_window'] as AnyRecord | undefined

  out(`${bold(String(data['id'] ?? ''))}  ${data['title'] ?? ''}`)
  if (model) {
    const key = model['key'] ? `  ${dim(String(model['key']))}` : ''
    out(`  model       ${model['name'] ?? ''}${key}`)
  }
  if (mcp) out(`  mcp         ${mcp['name'] ?? ''}`)
  if (ctxWindow) out(`  context     ${dim(`${ctxWindow['used'] ?? '?'} / ${ctxWindow['available'] ?? '?'} tokens`)}`)
  if (data['compaction_strategy']) out(`  compaction  ${data['compaction_strategy']}`)

  const setup = data['setup'] as AnyRecord | undefined
  if (setup) {
    out('')
    const parts = setup['parts'] as AnyRecord[] | undefined
    if (parts) {
      for (const part of parts) renderPart(part, '')
    }
  }

  const turns = data['turns'] as AnyRecord[] | undefined
  if (turns && turns.length > 0) {
    for (const turn of turns) {
      out('')
      renderTurnParts(turn)
    }
  }
}

function renderTurnText(data: AnyRecord): void {
  renderTurnParts(data)
}

function renderRoundText(data: AnyRecord): void {
  const parts = data['parts'] as AnyRecord[] | undefined
  if (parts) {
    for (const part of parts) renderPart(part, '')
  }
}

function renderSetupText(data: AnyRecord): void {
  const parts = data['parts'] as AnyRecord[] | undefined
  if (parts) {
    for (const part of parts) renderPart(part, '')
  }
}

function renderPartText(data: AnyRecord): void {
  renderPartLine(data, '')
  renderPartContent(data, '  ')
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export async function runInspect(opts: InspectOptions): Promise<void> {
  const result = await lookupById(opts.url, opts.id, opts.mode)

  if (opts.format === 'json') {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n')
    return
  }

  const { type, data } = result
  const d = data as AnyRecord

  switch (type) {
    case 'session':
      renderSessionText(d)
      break
    case 'turn':
      renderTurnText(d)
      break
    case 'round':
      renderRoundText(d)
      break
    case 'setup':
      renderSetupText(d)
      break
    case 'part':
      renderPartText(d)
      break
    default:
      // Unknown type: fall back to compact JSON
      process.stdout.write(JSON.stringify(result, null, 2) + '\n')
  }
  out('')
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
