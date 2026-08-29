<script lang="ts">
  import { chatSessions, selectChat } from '../sessionStore'
  import { activeChatId } from '../sessionStore'
  import { runs, activeRunId, selectRun, removeRun } from '../benchmarkStore'
  import type { BenchmarkRun } from '../backendTypes'
  import type { SessionSummary } from '../backendTypes'
  import { formatTreeTimestamp, runStatusDotClass } from '../format'
  import { iconChevronRight, iconChevronDown, iconTrash } from '../design/icons'
  import Icon from './Icon.svelte'

  const sortedRuns = $derived([...$runs].sort((a, b) => b.createdAt - a.createdAt))

  function sessionsOf(runId: string): SessionSummary[] {
    return [...$chatSessions]
      .filter((s) => s.parent_kind === 'benchmark' && s.parent_id === runId)
      .sort((a, b) => a.created_at - b.created_at)
  }

  // Judge sessions are session_analysis children of a run-session (one per
  // evaluation pass). They nest under the run-session they scored, mirroring how
  // analysis sessions nest under primaries — so they open in the normal session
  // view (context, tool calls, what the judge pulled).
  function judgesOf(sessionId: string): SessionSummary[] {
    return [...$chatSessions]
      .filter((s) => s.parent_kind === 'session' && s.parent_id === sessionId)
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
              <span class="status-dot {runStatusDotClass(run.status)}"></span>
            {/if}
            <span class="run-date">{formatTreeTimestamp(run.createdAt)}</span>
          </button>

          <div class="row-actions">
            <button
              class="action-btn delete-btn"
              title="Delete run"
              onclick={(e) => handleDelete(e, run.id)}><Icon path={iconTrash} /></button
            >
          </div>
        </div>

        {#if isExpanded && hasChildren}
          <ul class="child-sessions">
            {#each children as child (child.id)}
              {@const judges = judgesOf(child.id)}
              {@const childExpanded = expandedIds.has(child.id)}
              <li class="run-item child-item" class:active={$activeChatId === child.id}>
                <div class="run-row">
                  <span class="child-indent"></span>
                  <button
                    class="expand-btn"
                    class:visible={judges.length > 0}
                    onclick={(e) => toggleExpand(child.id, e)}
                    aria-label={childExpanded ? 'Collapse judge sessions' : 'Expand judge sessions'}
                    title={childExpanded ? 'Hide judge sessions' : 'Show judge sessions'}
                  >
                    <Icon path={childExpanded ? iconChevronDown : iconChevronRight} />
                  </button>
                  <button class="run-button" onclick={() => selectChat(child.id)}>
                    <span class="run-id">[{child.id}]</span>
                    <span class="run-title">{child.title}</span>
                    <span class="run-date">{formatTreeTimestamp(child.created_at)}</span>
                  </button>
                </div>

                {#if childExpanded && judges.length > 0}
                  <ul class="child-sessions">
                    {#each judges as judge (judge.id)}
                      <li class="run-item child-item" class:active={$activeChatId === judge.id}>
                        <div class="run-row">
                          <span class="child-indent"></span>
                          <span class="child-indent"></span>
                          <button class="run-button" onclick={() => selectChat(judge.id)}>
                            <span class="run-id">[{judge.id}]</span>
                            <span class="run-title judge-title">{judge.title}</span>
                            <span class="run-date">{formatTreeTimestamp(judge.created_at)}</span>
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
      </li>
    {/each}
  </ul>
{/if}

<style>
  .empty {
    padding: 0.4rem 0.75rem 0.6rem;
    font-size: var(--font-meta);
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
    font-size: var(--font-meta);
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
    font-size: var(--font-label);
    opacity: 0.7;
  }

  .run-title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Judge (evaluation) sessions read as analysis children, like the Sessions tree. */
  .judge-title {
    font-style: italic;
    opacity: 0.9;
  }

  .run-date {
    flex-shrink: 0;
    font-size: var(--font-label);
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
    font-size: var(--font-ui);
    line-height: 1;
    padding: 0.1rem 0.25rem;
    transition: color 0.1s;
  }
  .delete-btn:hover {
    color: var(--red-bright);
  }
</style>
