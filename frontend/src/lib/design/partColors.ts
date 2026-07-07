/**
 * Semantic color palette for context-window visualization.
 *
 * ── COLOR SEMANTICS ────────────────────────────────────────────────────────
 *
 *  1. RED / PINK  — Static system context (set by the operator, loaded once at
 *                   session start; not part of the conversation itself)
 *
 *     system-prompt      #ef4444  red-500
 *       The primary system instructions that shape the model's persona and
 *       constraints. Vivid red draws attention to how much context the
 *       operator configuration consumes.
 *
 *     mcp-instructions   #f472b6  pink-400
 *       Instructions injected by MCP servers (server-side preambles).
 *       Pink differentiates them from the core system prompt while keeping
 *       them visually in the "system" family.
 *
 *  2. PURPLE  — Tool infrastructure
 *
 *     tool-definitions   #a855f7  purple-500
 *       JSON schemas for all available tools.  Purple sits between the red
 *       "system" family and the blue "tool interaction" family, reflecting
 *       that these are the bridge between operator config and runtime calls.
 *
 *  3. SLATE / GREY  — Conversation flow (the human ↔ AI dialogue)
 *     Deliberately neutral so that the colorful system / tool / reasoning
 *     parts stand out visually.
 *
 *     user-message       #64748b  slate-500  (darker, slightly more prominent)
 *     assistant-content  #94a3b8  slate-400  (lighter, softer — responses)
 *
 *  4. ORANGE  — Thinking / chain-of-thought
 *
 *     assistant-reasoning  #fb923c  orange-400
 *       The model's internal scratchpad.  Warm orange makes reasoning blocks
 *       immediately identifiable and visually "energetic".
 *
 *  5. BLUE  — Tool interaction (dynamic, happens during a turn)
 *
 *     tool-call    #3b82f6  blue-500  (vivid — outbound invocations)
 *     tool-result  #93c5fd  blue-300  (light  — inbound responses)
 *
 *     The vivid → light progression mirrors request → response directionality.
 *
 *  6. MUTED GREY  — Diagnostic / infrastructure notes
 *
 *     diagnostic-note  #6b7280  gray-500
 *
 * ── USAGE RULES ────────────────────────────────────────────────────────────
 *  • Always derive colors for the context bar from PART_COLORS (not ad-hoc
 *    hex literals) so the palette stays consistent across components.
 *  • The CSS variables in app.css mirror these values and should be kept
 *    in sync; they exist for non-TS contexts (e.g. global CSS rules).
 *  • Do NOT add new part types without updating both this file and app.css.
 */

import type { PartRecord } from '../backendTypes'

export type PartType = PartRecord['partType']

/** Hex color for each part type.  Use in inline styles on the context bar. */
export const PART_COLORS: Record<PartType, string> = {
  'system-prompt': '#ef4444', // red-500
  'mcp-instructions': '#f472b6', // pink-400
  'tool-definitions': '#a855f7', // purple-500
  'user-message': '#64748b', // slate-500
  'assistant-content': '#94a3b8', // slate-400
  'assistant-reasoning': '#fb923c', // orange-400
  'tool-call': '#3b82f6', // blue-500
  'tool-result': '#93c5fd', // blue-300
  'diagnostic-note': '#6b7280', // gray-500
}

/** Human-readable label for each part type. */
export const PART_LABELS: Record<PartType, string> = {
  'system-prompt': 'System prompt',
  'mcp-instructions': 'MCP instructions',
  'tool-definitions': 'Tool definitions',
  'user-message': 'User message',
  'assistant-content': 'Assistant response',
  'assistant-reasoning': 'Reasoning',
  'tool-call': 'Tool call',
  'tool-result': 'Tool result',
  'diagnostic-note': 'Diagnostic',
}
