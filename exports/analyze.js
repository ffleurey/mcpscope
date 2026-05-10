#!/usr/bin/env node
// analyze.js - analyze a chat export JSON and report token accounting issues
// Usage: node analyze.js <export-file.json>
// Works with both v1 (sparse) and v2 (full content) exports.

import { readFileSync } from 'fs'

const file = process.argv[2]
if (!file) { console.error('Usage: node analyze.js <export.json>'); process.exit(1) }
const data = JSON.parse(readFileSync(file, 'utf8'))

const { session, contextSegments, contextSegmentsTotal, messages } = data
const isV2 = data.version === 2
const ctx = session.loadedContextLength
const sysTokens = isV2 ? session.tokenEstimates?.systemPrompt : session.systemPromptTokens
const toolDefsTokens = isV2 ? session.tokenEstimates?.toolDefinitions : session.toolDefinitionsTokens

console.log('═══════════════════════════════════════════════════')
console.log(`SESSION  (export v${data.version ?? 1})`)
console.log('═══════════════════════════════════════════════════')
console.log(`  Title:                    ${session.title ?? 'n/a'}`)
console.log(`  Context window (loaded):  ${ctx ?? 'null ← NOT FETCHED'}`)
console.log(`  systemPromptTokens:       ${sysTokens ?? 'null'}`)
console.log(`  toolDefinitionsTokens:    ${toolDefsTokens ?? 'null'}`)
if (isV2) {
  console.log(`  MCP tools:                ${session.mcpTools?.length ?? 0}`)
  const toolSchemaChars = JSON.stringify(session.mcpTools ?? []).length
  console.log(`  Tool schemas JSON size:   ${toolSchemaChars} chars (~${Math.ceil(toolSchemaChars/4)} tokens estimated)`)
  if (toolDefsTokens) console.log(`  tool-defs estimate error: ${toolDefsTokens} stated vs ~${Math.ceil(toolSchemaChars/4)} char-estimated (Δ${toolDefsTokens - Math.ceil(toolSchemaChars/4)})`)
}
console.log(`  contextSegmentsTotal:     ${contextSegmentsTotal}`)
if (ctx) console.log(`  bar overflow:             ${contextSegmentsTotal - ctx} tokens (${((contextSegmentsTotal/ctx - 1)*100).toFixed(1)}% over)`)
console.log()

// Segment breakdown
console.log('═══════════════════════════════════════════════════')
console.log('CONTEXT SEGMENTS BREAKDOWN')
console.log('═══════════════════════════════════════════════════')
const byType = {}
for (const seg of contextSegments) {
  byType[seg.type] = (byType[seg.type] ?? 0) + seg.tokens
}
for (const [type, tokens] of Object.entries(byType).sort((a,b) => b[1]-a[1])) {
  console.log(`  ${type.padEnd(20)} ${String(tokens).padStart(6)} tokens`)
}
console.log(`  ${'TOTAL'.padEnd(20)} ${String(contextSegmentsTotal).padStart(6)} tokens`)
console.log()

// Per-turn analysis
console.log('═══════════════════════════════════════════════════')
console.log('PER-TURN promptTokens (should grow each turn)')
console.log('═══════════════════════════════════════════════════')
const assistants = messages.filter(m => m.role === 'assistant')
let maxPrompt = 0
let flatTurns = 0
let prevPrompt = null
for (const [i, msg] of assistants.entries()) {
  const p = msg.usage?.promptTokens
  const r0 = msg.toolRounds?.[0]?.promptTokens
  const actualPrompt = r0 ?? p
  const delta = prevPrompt !== null ? (actualPrompt - prevPrompt) : null
  const flat = prevPrompt !== null && actualPrompt === prevPrompt
  if (flat) flatTurns++
  if (actualPrompt > maxPrompt) maxPrompt = actualPrompt
  const warn = flat ? ' ← FLAT (context full?)' : ''
  console.log(`  Turn ${String(i+1).padStart(2)}: prompt=${String(actualPrompt).padStart(5)}  delta=${delta !== null ? String(delta).padStart(5) : '  n/a'}  comp=${String(msg.usage?.completionTokens).padStart(4)}  reasoning=${String(msg.usage?.reasoningTokens ?? 0).padStart(4)}${warn}`)
  prevPrompt = actualPrompt
}
console.log()

if (flatTurns > 0) {
  console.log(`⚠  ${flatTurns} turns have FLAT promptTokens = context full, LM Studio reports cap (${maxPrompt}).`)
  console.log()
}

// User token analysis
console.log('═══════════════════════════════════════════════════')
console.log('USER MESSAGE TOKENS')
console.log('═══════════════════════════════════════════════════')
const users = messages.filter(m => m.role === 'user')
for (const msg of users) {
  const charEst = msg.estimatedTokens ?? Math.ceil(msg.contentLength / 4)
  const recorded = msg.tokens ?? 0
  const wrong = recorded <= 1 && msg.contentLength > 20
  const preview = isV2 && msg.content ? `  "${msg.content.slice(0,40).replace(/\n/g,' ')}…"` : ''
  console.log(`  recorded=${String(recorded).padStart(4)}  charEst=${String(charEst).padStart(4)}  charLen=${String(msg.contentLength).padStart(4)}${wrong ? '  ← WRONG' : ''}${preview}`)
}
console.log()

// Tool round detail for turns with tool calls
const toolTurns = assistants.filter(m => m.toolRounds?.length > 0)
if (toolTurns.length > 0) {
  console.log('═══════════════════════════════════════════════════')
  console.log('TOOL-CALLING TURNS: per-round analysis')
  console.log('═══════════════════════════════════════════════════')
  for (const [ti, msg] of toolTurns.entries()) {
    console.log(`\n  Turn ${ti+1} assistant ${msg.id.slice(0,8)} [${msg.toolRounds.length} rounds]:`)
    let prev = null
    for (const [r, round] of msg.toolRounds.entries()) {
      const delta = prev !== null ? round.promptTokens - prev.promptTokens : null
      const isFinal = round.toolCallIds.length === 0
      const isCapped = round.isCapped ?? (round.promptTokens >= (ctx ?? 999999) - 500)
      const label = isFinal ? 'FINAL' : `→ ${round.toolCallIds.length} tool(s)`
      const deltaStr = delta !== null ? `Δ=${String(delta).padStart(5)}` : '       '
      // tcTrDelta: actual cost of tool calls+results from previous round
      const prevTcTr = round.tcTrDelta !== undefined ? round.tcTrDelta : (delta !== null ? Math.max(0, delta - (prev?.reasoningTokens ?? 0)) : null)
      const tcTrStr = prevTcTr !== null ? `  tc+tr(prev)=${String(prevTcTr).padStart(5)}` : ''
      const cappedStr = isCapped ? '  [CAPPED]' : ''
      console.log(`    r[${r}]: PT=${String(round.promptTokens).padStart(5)}  ${deltaStr}  reasoning=${String(round.reasoningTokens).padStart(4)}${tcTrStr}  [${label}]${cappedStr}`)
      prev = round
    }

    // If v2, show tool call detail with token estimates
    if (isV2 && msg.toolCalls?.length > 0) {
      console.log(`\n    Tool call breakdown:`)
      for (const tc of msg.toolCalls) {
        const argEst = tc.argumentsEstimatedTokens ?? Math.ceil((tc.argumentsLength ?? 0) / 4)
        const resEst = tc.resultEstimatedTokens ?? Math.ceil((tc.resultLength ?? 0) / 4)
        const thinkingLen = tc.thinkingBeforeLength ?? tc.thinkingBefore?.length ?? 0
        console.log(`      [${tc.name}] args=${tc.argumentsLength ?? '?'}chars(~${argEst}tok)  result=${tc.resultLength ?? '?'}chars(~${resEst}tok)  thinkingBefore=${thinkingLen}chars  ${tc.durationMs ?? '?'}ms`)
        if (isV2 && tc.argumentsJson !== undefined) {
          const preview = tc.argumentsJson.length > 80 ? tc.argumentsJson.slice(0,80) + '…' : tc.argumentsJson
          console.log(`        args: ${preview}`)
        }
      }
    }

    // If v2, check API payload reconstruction
    if (isV2 && msg.apiPayloadAtRound0) {
      const payload = msg.apiPayloadAtRound0
      const charsTotal = payload.reduce((s, m) => s + (m.content?.length ?? 0) + (m.reasoning_content?.length ?? 0), 0)
      const estTokens = Math.ceil(charsTotal / 4)
      console.log(`\n    API payload at round 0: ${payload.length} messages, ~${charsTotal} chars (~${estTokens} tok estimated)`)
      console.log(`    Actual promptTokens:    ${msg.toolRounds[0]?.promptTokens ?? 'n/a'}`)
      console.log(`    Difference (est-actual): ${estTokens - (msg.toolRounds[0]?.promptTokens ?? 0)}`)
      // Show reasoning-stripped notes
      const stripped = payload.filter(m => m._note && m._note.includes('stripped'))
      if (stripped.length > 0) {
        console.log(`    Reasoning stripped in ${stripped.length} historical messages:`)
        for (const m of stripped) console.log(`      ${m.role}: ${m._note}`)
      }
    }
  }
  console.log()
}

// Summary and diagnosis
console.log('═══════════════════════════════════════════════════')
console.log('ROOT CAUSE DIAGNOSIS')
console.log('═══════════════════════════════════════════════════')
if (flatTurns > 0) {
  console.log(`1. LM Studio caps promptTokens at ${maxPrompt} when context is full.`)
  console.log(`   ${flatTurns} turns are flat. Excess bar sum: ${contextSegmentsTotal} - ${maxPrompt} = ${contextSegmentsTotal - maxPrompt} tokens.`)
  console.log()
}
if (ctx && maxPrompt < ctx - 100) {
  console.log(`2. Model actual cap (${maxPrompt}) << loadedContextLength (${ctx}). Context override in effect.`)
  console.log()
}
if (isV2) {
  const base = (sysTokens ?? 0) + (toolDefsTokens ?? 0)
  const realTurn1 = assistants[0]?.toolRounds?.[0]?.promptTokens
  if (realTurn1) {
    const user0Len = users[0]?.contentLength ?? 0
    const user0Est = Math.ceil(user0Len / 4)
    const expectedBase = realTurn1 - user0Est
    console.log(`3. Base estimation: our system(${sysTokens})+toolDefs(${toolDefsTokens}) = ${base}`)
    console.log(`   Turn1 R0 actual = ${realTurn1}. If user ~${user0Est} tok, base actual ~${expectedBase}.`)
    console.log(`   Base error: ${base - expectedBase} tokens (${base > expectedBase ? 'over' : 'under'}-estimated)`)
  }
}
console.log()
