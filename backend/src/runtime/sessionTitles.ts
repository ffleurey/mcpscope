import type { SessionRecord } from '../domain/model.js'

export const DEFAULT_SESSION_TITLE = 'New session'

export function maybeApplyAutomaticSessionTitle(
  session: SessionRecord,
  turnSequenceNumber: number,
  userContent: string,
) {
  if (turnSequenceNumber !== 1) {
    return
  }

  if (session.title.trim() !== DEFAULT_SESSION_TITLE) {
    return
  }

  const autoTitle = userContent.slice(0, 60)
  if (!autoTitle) {
    return
  }

  session.title = autoTitle
}
