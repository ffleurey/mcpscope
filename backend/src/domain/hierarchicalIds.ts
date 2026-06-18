export const SESSION_ID_LENGTH = 4
export const SESSION_ID_CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const SESSION_ID_REGEX = /^[A-HJ-NP-Z2-9]{4}$/

export type HierarchicalIdType = 'session' | 'setup' | 'step' | 'turn' | 'round' | 'part'

export interface ParsedHierarchicalId {
  raw: string
  type: HierarchicalIdType
  sessionId: string
  stepNumber: number | null
  turnNumber: number | null
  roundNumber: number | null
  partNumber: number | null
  isSetupPart: boolean
}

/** Maps internal PartRecord partType values to their canonical 2-3-letter ID suffix. */
export const PART_TYPE_SUFFIX: Record<string, string> = {
  'system-prompt': 'SP',
  'mcp-instructions': 'MI',
  'tool-definitions': 'TD',
  'user-message': 'U',
  'assistant-reasoning': 'R',
  'assistant-content': 'A',
  'tool-call': 'T',
  'tool-result': 'TR',
  'diagnostic-note': 'DN',
}

export function isValidSessionId(value: string): boolean {
  return SESSION_ID_REGEX.test(value)
}

export function generateSessionIdCandidate(random: () => number = Math.random): string {
  let value = ''
  for (let i = 0; i < SESSION_ID_LENGTH; i += 1) {
    const index = Math.floor(random() * SESSION_ID_CHARSET.length)
    value += SESSION_ID_CHARSET[index] ?? SESSION_ID_CHARSET[0]
  }
  return value
}

export function generateUniqueSessionId(
  exists: (sessionId: string) => boolean,
  maxAttempts = 3,
  random: () => number = Math.random,
): string | null {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const candidate = generateSessionIdCandidate(random)
    if (!exists(candidate)) {
      return candidate
    }
  }
  return null
}


export function formatSetupId(sessionId: string): string {
  return `${sessionId}.S`
}

export function formatSetupPartId(sessionId: string, partNumber: number, partType: string): string {
  const suffix = PART_TYPE_SUFFIX[partType]
  return suffix ? `${sessionId}.S.${partNumber}-${suffix}` : `${sessionId}.S.${partNumber}`
}

export function formatTurnId(sessionId: string, turnNumber: number, ownerStepId?: string | null): string {
  const prefix = ownerStepId ?? sessionId
  return `${prefix}.${turnNumber}T`
}

export function formatCompactionStepId(sessionId: string, stepNumber: number): string {
  return `${sessionId}.${stepNumber}C`
}

export function formatCompactionPartId(
  sessionId: string,
  stepNumber: number,
  partNumber: number,
  partType?: string,
): string {
  const suffix = partType ? PART_TYPE_SUFFIX[partType] : undefined
  const base = `${sessionId}.${stepNumber}C.${partNumber}`
  return suffix ? `${base}-${suffix}` : base
}

export function formatRoundId(sessionId: string, turnNumber: number, roundNumber: number, ownerStepId?: string | null): string {
  return `${formatTurnId(sessionId, turnNumber, ownerStepId)}.${roundNumber}`
}

/** partType is optional; when provided, appends the canonical type suffix (e.g. -U, -T, -A). */
export function formatPartId(
  sessionId: string,
  turnNumber: number,
  roundNumber: number,
  partNumber: number,
  partType?: string,
  ownerStepId?: string | null,
): string {
  const suffix = partType ? PART_TYPE_SUFFIX[partType] : undefined
  const base = `${formatRoundId(sessionId, turnNumber, roundNumber, ownerStepId)}.${partNumber}`
  return suffix ? `${base}-${suffix}` : base
}

export function parseHierarchicalId(raw: string): ParsedHierarchicalId | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  const parseNumber = (value: string): number | null => {
    if (!/^\d+$/.test(value)) return null
    const parsed = Number(value)
    if (!Number.isSafeInteger(parsed)) return null
    return parsed
  }

  /** Strip optional -XX suffix from a segment and return the numeric part. */
  const parseNumberWithSuffix = (value: string): number | null => {
    const dashIndex = value.indexOf('-')
    const numStr = dashIndex >= 0 ? value.slice(0, dashIndex) : value
    return parseNumber(numStr)
  }

  const parseTurnSegment = (value: string): number | null => {
    if (/^\d+T$/.test(value)) {
      return parseNumber(value.slice(0, -1))
    }
    return parseNumber(value)
  }

  const segments = trimmed.split('.')
  if (segments.length < 1 || segments.length > 5) return null

  const sessionId = segments[0] ?? ''
  if (!isValidSessionId(sessionId)) return null

  if (segments.length === 1) {
    return { raw: trimmed, type: 'session', sessionId, stepNumber: null, turnNumber: null, roundNumber: null, partNumber: null, isSetupPart: false }
  }

  // Setup node: AB12.S or setup part: AB12.S.n[-XX]
  if (segments[1] === 'S') {
    if (segments.length === 2) {
      return { raw: trimmed, type: 'setup', sessionId, stepNumber: null, turnNumber: null, roundNumber: null, partNumber: null, isSetupPart: false }
    }
    if (segments.length === 3) {
      const partNumber = parseNumberWithSuffix(segments[2] ?? '')
      if (partNumber == null || partNumber < 1) return null
      return { raw: trimmed, type: 'part', sessionId, stepNumber: null, turnNumber: null, roundNumber: null, partNumber, isSetupPart: true }
    }
    return null
  }

  const stepMatch = /^(\d+)C$/.exec(segments[1] ?? '') || /^(\d+)W$/.exec(segments[1] ?? '') || /^(?:wf)(\d+)$/.exec(segments[1] ?? '')
  if (stepMatch) {
    const stepNumber = parseNumber(stepMatch[1] ?? '')
    const isWorkflowStep = (segments[1] ?? '').startsWith('wf') || (segments[1] ?? '').endsWith('W') || (segments[1] ?? '').endsWith('C')
    if (stepNumber == null || (isWorkflowStep ? stepNumber < 0 : stepNumber < 1)) return null
    if (segments.length === 2) {
      return { raw: trimmed, type: 'step', sessionId, stepNumber, turnNumber: null, roundNumber: null, partNumber: null, isSetupPart: false }
    }
    if (segments.length === 3) {
      if (/^\d+T$/.test(segments[2] ?? '')) {
        const turnNumber = parseTurnSegment(segments[2] ?? '')
        if (turnNumber == null || turnNumber < 0) return null
        return { raw: trimmed, type: 'turn', sessionId, stepNumber, turnNumber, roundNumber: null, partNumber: null, isSetupPart: false }
      }
      const partNumber = parseNumberWithSuffix(segments[2] ?? '')
      if (partNumber == null || partNumber < 1) return null
      return { raw: trimmed, type: 'part', sessionId, stepNumber, turnNumber: null, roundNumber: null, partNumber, isSetupPart: false }
    }
    if (segments.length === 4) {
      const turnNumber = parseTurnSegment(segments[2] ?? '')
      const roundNumber = parseNumber(segments[3] ?? '')
      if (turnNumber == null || turnNumber < 0 || roundNumber == null || roundNumber < 0) return null
      return { raw: trimmed, type: 'round', sessionId, stepNumber, turnNumber, roundNumber, partNumber: null, isSetupPart: false }
    }
    if (segments.length === 5) {
      const turnNumber = parseTurnSegment(segments[2] ?? '')
      const roundNumber = parseNumber(segments[3] ?? '')
      const partNumber = parseNumberWithSuffix(segments[4] ?? '')
      if (turnNumber == null || turnNumber < 0 || roundNumber == null || roundNumber < 0 || partNumber == null || partNumber < 1) return null
      return { raw: trimmed, type: 'part', sessionId, stepNumber, turnNumber, roundNumber, partNumber, isSetupPart: false }
    }
    return null
  }

  const turnNumber = parseTurnSegment(segments[1] ?? '')
  if (turnNumber == null || turnNumber < 0) return null

  if (segments.length === 2) {
    return { raw: trimmed, type: 'turn', sessionId, stepNumber: null, turnNumber, roundNumber: null, partNumber: null, isSetupPart: false }
  }

  const roundNumber = parseNumber(segments[2] ?? '')
  if (roundNumber == null || roundNumber < 0) return null

  if (segments.length === 3) {
    return { raw: trimmed, type: 'round', sessionId, stepNumber: null, turnNumber, roundNumber, partNumber: null, isSetupPart: false }
  }

  const partNumber = parseNumberWithSuffix(segments[3] ?? '')
  if (partNumber == null || partNumber < 1) return null

  return { raw: trimmed, type: 'part', sessionId, stepNumber: null, turnNumber, roundNumber, partNumber, isSetupPart: false }
}

export function formatStepId(sessionId: string, childIndex: number): string {
  return `${sessionId}.${childIndex}W`
}

// ─────────────────────────────────────────────────────────────────────────────
// Benchmark namespace IDs
//
// Type is tellable from the ID, consistent with the session scheme:
//   - `B-7K3M`     a benchmark (suite) — `B-` namespace prefix + 4-char code
//   - `B-7K3M.3`   case 3 of that benchmark — dotted child of a benchmark
//   - `R-9QX4`     a run — `R-` namespace prefix + 4-char code (flat / first-class)
// A bare 4-char code remains a session. Runs are NOT nested under benchmarks: a
// benchmark is an editable blueprint, a run is an independent snapshot spawned
// from it (association, not composition).
//
// The id predicates below (isBenchmarkId / isRunId / isBenchmarkCaseId) are
// scaffolding for the deferred `inspect`-unification work
// (backlog/candidates/benchmark-inspect-id-unification.md) — teaching the generic
// inspect/hierarchicalLookup path to resolve B-/R- ids. Not yet wired in.
// ─────────────────────────────────────────────────────────────────────────────

export const BENCHMARK_ID_REGEX = /^B-[A-HJ-NP-Z2-9]{4}$/
export const RUN_ID_REGEX = /^R-[A-HJ-NP-Z2-9]{4}$/
export const BENCHMARK_CASE_ID_REGEX = /^B-[A-HJ-NP-Z2-9]{4}\.\d+$/

export function isBenchmarkId(value: string): boolean {
  return BENCHMARK_ID_REGEX.test(value)
}

export function isRunId(value: string): boolean {
  return RUN_ID_REGEX.test(value)
}

export function isBenchmarkCaseId(value: string): boolean {
  return BENCHMARK_CASE_ID_REGEX.test(value)
}

function generatePrefixedId(
  prefix: string,
  exists: (id: string) => boolean,
  maxAttempts: number,
  random: () => number,
): string | null {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const candidate = `${prefix}${generateSessionIdCandidate(random)}`
    if (!exists(candidate)) return candidate
  }
  return null
}

export function generateBenchmarkId(
  exists: (id: string) => boolean,
  maxAttempts = 5,
  random: () => number = Math.random,
): string | null {
  return generatePrefixedId('B-', exists, maxAttempts, random)
}

export function generateRunId(
  exists: (id: string) => boolean,
  maxAttempts = 5,
  random: () => number = Math.random,
): string | null {
  return generatePrefixedId('R-', exists, maxAttempts, random)
}

/** Case ID = `<benchmarkId>.<caseNumber>`; caseNumber is a stable 1-based sequence. */
export function formatBenchmarkCaseId(benchmarkId: string, caseNumber: number): string {
  return `${benchmarkId}.${caseNumber}`
}
