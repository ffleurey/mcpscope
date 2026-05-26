<script lang="ts">
  import {
    activeChatId,
    chatSessions,
    deleteChat,
    selectChat,
  } from '../sessionStore'
  import { currentView } from '../navStore'
  import { analysisProfiles } from '../connectionStore'
  import { untrack } from 'svelte'
  import AnalysisLaunchModal from './AnalysisLaunchModal.svelte'
  import type { SessionSummary } from '../backendTypes'

  // ─── Modal state ────────────────────────────────────────────────────────────
  let analysisTarget = $state<{ id: string; title: string } | null>(null)

  // ─── Tree shaping ────────────────────────────────────────────────────────────
  // Primary sessions sorted newest-first; for each primary session, collect
  // its session_analysis children sorted oldest-first.
  const primarySessions = $derived(
    [...$chatSessions]
      .filter(s => s.session_type === 'primary')
      .sort((a, b) => b.updated_at - a.updated_at),
  )

  function childrenOf(parentId: string): SessionSummary[] {
    return [...$chatSessions]
      .filter(s => s.parent_kind === 'session' && s.parent_id === parentId)
      .sort((a, b) => a.created_at - b.created_at)
  }

  // Track which primary sessions have their children expanded.
  // A session is auto-expanded when children are detected.
  let expandedIds = $state(new Set<string>())

  $effect(() => {
    // Auto-expand any primary session that has children.
    // Use untrack when reading expandedIds to avoid writing to a tracked dependency.
    const toExpand = primarySessions.filter(s => childrenOf(s.id).length > 0).map(s => s.id)
    if (toExpand.length > 0) {
      const current = untrack(() => expandedIds)
      if (toExpand.some(id => !current.has(id))) {
        expandedIds = new Set([...current, ...toExpand])
      }
    }
  })

  function toggleExpand(sessionId: string, e: MouseEvent) {
    e.stopPropagation()
    const next = new Set(expandedIds)
    if (next.has(sessionId)) {
      next.delete(sessionId)
    } else {
      next.add(sessionId)
    }
    expandedIds = next
  }

  // ─── Navigation ─────────────────────────────────────────────────────────────
  async function handleSelect(id: string) {
    await selectChat(id)
    currentView.set('chats')
  }

  async function handleDelete(e: MouseEvent, id: string) {
    e.stopPropagation()
    await deleteChat(id)
  }

  // ─── Analysis launch ─────────────────────────────────────────────────────────
  function openAnalysis(e: MouseEvent, session: SessionSummary) {
    e.stopPropagation()
    analysisTarget = { id: session.id, title: session.title }
  }

  function formatDate(ts: number): string {
    const d = new Date(ts)
    const dd = String(d.getDate()).padStart(2, '0')
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const HH = String(d.getHours()).padStart(2, '0')
    const MM = String(d.getMinutes()).padStart(2, '0')
    return `${dd}/${mm} ${HH}:${MM}`
  }
</script>

{#if analysisTarget}
  <AnalysisLaunchModal
    targetSessionId={analysisTarget.id}
    targetSessionTitle={analysisTarget.title}
    onClose={() => { analysisTarget = null }}
  />
{/if}

{#if primarySessions.length === 0}
  <div class="empty">No sessions yet</div>
{:else}
  <ul class="sessions">
    {#each primarySessions as session (session.id)}
      {@const children = childrenOf(session.id)}
      {@const isExpanded = expandedIds.has(session.id)}
      {@const hasChildren = children.length > 0}

      <li class="session-item primary-item" class:active={$activeChatId === session.id}>
        <div class="session-row">
          <!-- Expand/collapse toggle (only when there are children) -->
          <button
            class="expand-btn"
            class:visible={hasChildren}
            onclick={(e) => toggleExpand(session.id, e)}
            aria-label={isExpanded ? 'Collapse children' : 'Expand children'}
            title={isExpanded ? 'Hide analysis sessions' : 'Show analysis sessions'}
          >
            {isExpanded ? '▾' : '▸'}
          </button>

          <button
            class="session-button"
            onclick={() => handleSelect(session.id)}
            onkeydown={(e) => e.key === 'Enter' && handleSelect(session.id)}
          >
            <span class="session-id">[{session.id}]</span>
            <span class="session-title">{session.title}</span>
            <span class="session-date">{formatDate(session.updated_at)}</span>
          </button>

          <div class="row-actions">
            {#if $analysisProfiles.length > 0}
              <button
                class="action-btn analyze-btn"
                title="Launch analysis"
                onclick={(e) => openAnalysis(e, session)}
              >∑</button>
            {/if}
            <button
              class="action-btn delete-btn"
              title="Delete session"
              onclick={(e) => handleDelete(e, session.id)}
            >×</button>
          </div>
        </div>

        <!-- Child sessions (analysis) -->
        {#if isExpanded && hasChildren}
          <ul class="child-sessions">
            {#each children as child (child.id)}
              <li class="session-item child-item" class:active={$activeChatId === child.id}>
                <div class="session-row">
                  <span class="child-indent"></span>
                  <button
                    class="session-button"
                    onclick={() => handleSelect(child.id)}
                    onkeydown={(e) => e.key === 'Enter' && handleSelect(child.id)}
                  >
                    <span class="session-id child-id">[{child.id}]</span>
                    <span class="session-title child-title">{child.title}</span>
                    <span class="session-date">{formatDate(child.created_at)}</span>
                  </button>
                  <div class="row-actions">
                    <button
                      class="action-btn delete-btn"
                      title="Delete analysis session"
                      onclick={(e) => handleDelete(e, child.id)}
                    >×</button>
                  </div>
                </div>
              </li>
            {/each}
          </ul>
        {/if}
      </li>
    {/each}
  </ul>
{/if}

<style>
  .empty {
    padding: 0.75rem;
    font-size: 0.8rem;
    color: var(--text-muted);
  }

  .sessions,
  .child-sessions {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .sessions {
    overflow-y: auto;
    flex: 1;
    padding: 0.25rem 0;
  }

  .child-sessions {
    padding: 0;
  }

  .session-item {
    background: none;
    color: var(--text-muted);
    font-size: 0.82rem;
    font-family: inherit;
    list-style: none;
  }

  .session-row {
    display: flex;
    align-items: center;
    padding: 0.35rem 0.5rem 0.35rem 0.25rem;
    transition: background 0.1s, color 0.1s;
  }

  .primary-item:hover > .session-row {
    background: var(--bg-hover);
    color: var(--text);
  }

  .session-item.active > .session-row {
    background: var(--bg-active);
    color: var(--text);
  }

  .child-item > .session-row {
    padding-left: 0;
    background: color-mix(in srgb, var(--bg-panel, var(--bg)) 60%, transparent);
  }

  .child-item:hover > .session-row {
    background: var(--bg-hover);
  }

  .child-item.active > .session-row {
    background: var(--bg-active);
    color: var(--text);
  }

  .expand-btn {
    flex-shrink: 0;
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 0.7rem;
    line-height: 1;
    padding: 0 0.25rem;
    width: 1.1rem;
    visibility: hidden;
    transition: opacity 0.1s;
  }

  .expand-btn.visible {
    visibility: visible;
  }

  .session-button {
    flex: 1;
    min-width: 0;
    background: none;
    border: none;
    color: inherit;
    cursor: pointer;
    font: inherit;
    padding: 0 0.25rem;
    text-align: left;
    display: flex;
    align-items: baseline;
    gap: 0.35rem;
    overflow: hidden;
  }

  .session-id {
    flex-shrink: 0;
    font-family: monospace;
    font-size: 0.75rem;
    opacity: 0.7;
  }

  .child-id {
    font-size: 0.72rem;
  }

  .session-title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .child-title {
    font-size: 0.79rem;
    font-style: italic;
    opacity: 0.9;
  }

  .session-date {
    flex-shrink: 0;
    font-size: 0.7rem;
    opacity: 0.55;
    white-space: nowrap;
  }

  .child-indent {
    display: block;
    flex-shrink: 0;
    width: 1.5rem;
    border-left: 1px solid var(--border);
    align-self: stretch;
    margin-left: 0.5rem;
  }

  .row-actions {
    display: flex;
    align-items: center;
    gap: 0.1rem;
    flex-shrink: 0;
    opacity: 0;
    transition: opacity 0.1s;
  }

  .session-item:hover .row-actions {
    opacity: 1;
  }

  .action-btn {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-muted);
    font-size: 0.9rem;
    line-height: 1;
    padding: 0.1rem 0.25rem;
    transition: color 0.1s;
  }

  .analyze-btn:hover {
    color: var(--color-accent, #7c3aed);
  }

  .delete-btn:hover {
    color: var(--color-error);
  }
</style>

