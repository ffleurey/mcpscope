import type { SessionRecord } from '../domain/model.js'
import type { TurnStreamEventSink } from './streamEvents.js'

export const DEFAULT_SESSION_TITLE = 'New session'

/**
 * Auto-title a session from the first user prompt. When the session still
 * holds the default title and this is turn 1, the title is set to the first
 * 60 characters of the user content. If an emitEvent sink is provided, a
 * `session-title-changed` event is emitted so embedders can sync the title
 * into their own store.
 */
export function maybeApplyAutomaticSessionTitle(
  session: SessionRecord,
  turnSequenceNumber: number,
  userContent: string,
  emitEvent?: TurnStreamEventSink,
): void {
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
  emitEvent?.({
    type: 'session-title-changed',
    sessionId: session.id,
    title: autoTitle,
  })
}
