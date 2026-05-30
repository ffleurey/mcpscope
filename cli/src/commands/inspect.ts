import { cliInspect } from '../httpClient.js'
import { bold, colorTokens } from '../colors.js'

export interface InspectOptions {
  url: string
  id: string
  json: boolean
  short: boolean
}

function out(line: string): void {
  process.stdout.write(line + '\n')
}

type AnyRecord = Record<string, unknown>

// ─── Part ─────────────────────────────────────────────────────────────────────

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

const HIGHLIGHTED_CONTENT_TYPES = new Set(['user_prompt', 'assistant_answer'])

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

  // tool_definitions: render tool names as comma-separated list
  const tools = part['tools'] as string[] | undefined
  if (tools && tools.length > 0) {
    out(`${indent}${tools.join(', ')}`)
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

function renderGenericStep(step: AnyRecord): void {
  const id = String(step['id'] ?? '')
  const type = String(step['type'] ?? 'step')
  const status = step['status'] ? `  ${String(step['status'])}` : ''
  const strategy = step['strategy'] ? `  ${String(step['strategy'])}` : ''
  const sourceTurn = step['source_turn_number'] != null ? `  after turn ${String(step['source_turn_number'])}` : ''
  out(`${id}  ${type}${status}${strategy}${sourceTurn}`)

  const strippedPartIds = Array.isArray(step['stripped_part_ids']) ? step['stripped_part_ids'] as unknown[] : []
  if (strippedPartIds.length > 0) {
    out('  stripped parts')
    for (const partId of strippedPartIds) {
      out(`    ${String(partId)}`)
    }
  }

  const strippedParts = Array.isArray(step['stripped_parts']) ? step['stripped_parts'] as AnyRecord[] : []
  if (strippedParts.length > 0) {
    out('  stripped details')
    for (const strippedPart of strippedParts) {
      const strippedId = String(strippedPart['id'] ?? '')
      const strippedType = strippedPart['type'] ? `  ${String(strippedPart['type'])}` : ''
      const strippedTokens = strippedPart['token_count'] != null ? `  (${Number(strippedPart['token_count'])} tokens)` : ''
      out(`    ${strippedId}${strippedType}${strippedTokens}`)
      if (typeof strippedPart['reason'] === 'string') {
        out(`      ${strippedPart['reason']}`)
      }
    }
  }

  const parts = step['parts'] as AnyRecord[] | undefined
  if (parts) {
    for (const part of parts) renderPart(part, '  ')
  }
}

// ─── Type-specific text renderers ─────────────────────────────────────────────

function renderSessionText(data: AnyRecord): void {
  const model = data['model'] as AnyRecord | undefined
  const mcp = data['mcp'] as AnyRecord | undefined
  const ctxWindow = data['context_window'] as AnyRecord | undefined

  out(`${String(data['id'] ?? '')}  ${data['title'] ?? ''}`)
  if (model) {
    const key = model['key'] ? `  ${String(model['key'])}` : ''
    out(`  model       ${model['name'] ?? ''}${key}`)
  }
  if (mcp) out(`  mcp         ${mcp['name'] ?? ''}`)
  if (ctxWindow) out(`  context     ${ctxWindow['used'] ?? '?'} / ${ctxWindow['available'] ?? '?'} tokens`)
  if (data['compaction_strategy']) out(`  compaction  ${data['compaction_strategy']}`)

  const setup = data['setup'] as AnyRecord | undefined
  if (setup) {
    out('')
    const parts = setup['parts'] as AnyRecord[] | undefined
    if (parts) {
      for (const part of parts) renderPart(part, '')
    }
  }

  const steps = data['steps'] as AnyRecord[] | undefined
  if (steps && steps.length > 0) {
    for (const step of steps) {
      out('')
      if (String(step['type'] ?? '') === 'turn') {
        renderTurnParts(step)
      } else {
        renderGenericStep(step)
      }
    }
    return
  }

  const turns = data['turns'] as AnyRecord[] | undefined
  if (turns && turns.length > 0) {
    for (const turn of turns) {
      out('')
      renderTurnParts(turn)
    }
  }
}

function renderStepText(data: AnyRecord): void {
  renderGenericStep(data)
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
  const result = await cliInspect(opts.url, {
    id: opts.id,
    ...(opts.short ? { short: true } : {}),
  })

  if (opts.json) {
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
    case 'step':
      renderStepText(d)
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
      process.stdout.write(JSON.stringify(result, null, 2) + '\n')
  }
  out('')
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
