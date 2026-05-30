import type { ParentKind, SessionType } from './model.js'

/**
 * Validates the current session type / parent combination rules.
 *
 * Returns an error message string if the combination is invalid, or null if valid.
 *
 * Rules:
 *   primary           → parent optional; if present, kind must be 'benchmark'
 *   session_analysis  → parent required; kind must be 'session'
 *   session_compaction→ parent required; kind must be 'session'
 *   benchmark_analysis→ parent required; kind must be 'benchmark'
 *
 * Additionally: parent_kind and parent_id must be both null or both present.
 */
export function validateSessionParent(
  sessionType: SessionType,
  parentKind: ParentKind | null,
  parentId: string | null,
): string | null {
  const hasParent = parentKind !== null || parentId !== null

  if ((parentKind === null) !== (parentId === null)) {
    return 'parent_kind and parent_id must both be present or both be null'
  }

  switch (sessionType) {
    case 'primary':
      if (hasParent && parentKind !== 'benchmark') {
        return "primary sessions may only have a 'benchmark' parent"
      }
      return null

    case 'session_analysis':
      if (!hasParent) return 'session_analysis sessions require a parent'
      if (parentKind !== 'session') return "session_analysis sessions require a 'session' parent"
      return null

    case 'session_compaction':
      if (!hasParent) return 'session_compaction sessions require a parent'
      if (parentKind !== 'session') return "session_compaction sessions require a 'session' parent"
      return null

    case 'benchmark_analysis':
      if (!hasParent) return 'benchmark_analysis sessions require a parent'
      if (parentKind !== 'benchmark') return "benchmark_analysis sessions require a 'benchmark' parent"
      return null
  }
}
