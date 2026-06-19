<script lang="ts">
  import { chatSessions, selectChat } from '../sessionStore'
  import { activeChatId } from '../sessionStore'
  import { runs, activeRunId, selectRun, removeRun } from '../benchmarkStore'
  import type { BenchmarkRun, BenchmarkRunStatus } from '../backendTypes'
  import type { SessionSummary } from '../backendTypes'
  import { formatTreeTimestamp } from '../format'
  import { iconChevronRight, iconChevronDown } from '../design/icons'
  import Icon from './Icon.svelte'

  const sortedRuns = $derived([...$runs].sort((a, b) => b.createdAt - a.createdAt))

  function sessionsOf(runId: string): SessionSummary[] {
    return [...$chatSessions]
      .filter((s) => s.parent_kind === 'benchmark' && s.parent_id === runId)
      .sort((a, b) => a.created_at - b.created_at)
  }

  // Expansion is purely manual (a normal treeview) and independent of selection:
  // clicking a run selects it; only the chevron toggles its sessions.
  let expandedIds = $state(new Set<string>())

  function toggleExpand(runId: string, e: MouseEvent) {
    e.stopPropagation()
    const next = new Set(expandedIds)
    if (next.has(runId)) next.delete(runId)
    else next.add(runId)
    expandedIds = next
  }

  function dotClass(status: BenchmarkRunStatus): string {
    if (status === 'running' || status === 'pending') return 'running'
    if (status === 'error') return 'error'
    return 'idle'
  }

  async function handleSelectRun(run: BenchmarkRun) {
    await selectRun(run.id)
  }

  async function handleDelete(e: MouseEvent, runId: string) {
    e.stopPropagation()
    await removeRun(runId)
  }
</script>

{#if sortedRuns.length === 0}
  <div class="empty">No runs yet</div>
{:else}
  <ul class="runs">
    {#each sortedRuns as run (run.id)}
      {@const children = sessionsOf(run.id)}
      {@const isExpanded = expandedIds.has(run.id)}
      {@const hasChildren = children.length > 0}

      <li class="run-item primary-item" class:active={$activeRunId === run.id}>
        <div class="run-row">
          <button
            class="expand-btn"
            class:visible={hasChildren}
            onclick={(e) => toggleExpand(run.id, e)}
            aria-label={isExpanded ? 'Collapse sessions' : 'Expand sessions'}
            title={isExpanded ? 'Hide run sessions' : 'Show run sessions'}
          >
            <Icon path={isExpanded ? iconChevronDown : iconChevronRight} />
          </button>

          <button class="run-button" onclick={() => handleSelectRun(run)}>
            <span class="run-id">[{run.id}]</span>
            <span class="run-title">{run.benchmarkName}</span>
            <!-- A completed run needs no status dot; the timestamp carries the info.
                 Keep the dot only for in-progress (running/pending) and error. -->
            {#if run.status !== 'complete'}
              <span class="status-dot {dotClass(run.status)}"></span>
            {/if}
            <span class="run-date">{formatTreeTimestamp(run.createdAt)}</span>
          </button>

          <div class="row-actions">
            <button
              class="action-btn delete-btn"
              title="Delete run"
              onclick={(e) => handleDelete(e, run.id)}>×</button
            >
          </div>
        </div>

        {#if isExpanded && hasChildren}
          <ul class="child-sessions">
            {#each children as child (child.id)}
              <li class="run-item child-item" class:active={$activeChatId === child.id}>
                <div class="run-row">
                  <span class="child-indent"></span>
                  <button class="run-button" onclick={() => selectChat(child.id)}>
                    <span class="run-id">[{child.id}]</span>
                    <span class="run-title">{child.title}</span>
                    <span class="run-date">{formatTreeTimestamp(child.created_at)}</span>
                  </button>
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
    padding: 0.4rem 0.75rem 0.6rem;
    font-size: 0.78rem;
    color: var(--text-dim);
  }

  .runs,
  .child-sessions {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .runs {
    padding: 0.15rem 0 0.25rem;
  }

  .run-item {
    background: none;
    color: var(--text-dim);
    font-size: 0.82rem;
    font-family: inherit;
  }

  .run-row {
    display: flex;
    align-items: center;
    padding: 0.3rem 0.5rem 0.3rem 0.25rem;
    transition:
      background 0.1s,
      color 0.1s;
  }

  .primary-item:hover > .run-row {
    background: var(--bg-hover);
    color: var(--text-bright);
  }

  .run-item.active > .run-row {
    background: var(--bg-hover);
    color: var(--text-bright);
  }

  .child-item > .run-row {
    padding-left: 0;
    background: color-mix(in srgb, var(--bg-surface) 60%, transparent);
  }

  .child-item:hover > .run-row,
  .child-item.active > .run-row {
    background: var(--bg-hover);
    color: var(--text-bright);
  }

  .expand-btn {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    color: var(--text-dim);
    cursor: pointer;
    font-size: 0.9rem; /* same chevron size as the sidebar group toggles */
    line-height: 1;
    padding: 0 0.25rem;
    width: 1.1rem;
    visibility: hidden;
  }
  .expand-btn.visible {
    visibility: visible;
  }

  .run-button {
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
    align-items: center;
    gap: 0.35rem;
    overflow: hidden;
  }

  .run-id {
    flex-shrink: 0;
    font-family: var(--mono);
    font-size: 0.75rem;
    opacity: 0.7;
  }

  .run-title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .run-date {
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
  .run-item:hover .row-actions {
    opacity: 1;
  }

  .action-btn {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-dim);
    font-size: 0.9rem;
    line-height: 1;
    padding: 0.1rem 0.25rem;
    transition: color 0.1s;
  }
  .delete-btn:hover {
    color: var(--red-bright);
  }
</style>
