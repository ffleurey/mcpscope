<script lang="ts">
  import {
    schedulerConnected,
    schedulerSnapshot,
    activeJob,
    pendingJobs,
    queueLength,
    pauseExecution,
    resumeExecution,
    removePendingJob,
  } from '../executionStore'
  import { followRunning } from '../followStore'
  import { selectChat, activeChatId, chatSessions } from '../sessionStore'
  import Icon from './Icon.svelte'
  import { iconView } from '../design/icons'

  let showQueue = $state(false)
  let isActioning = $state(false)

  const snapshot = $derived($schedulerSnapshot)
  const currentActiveJob = $derived($activeJob)
  const queuedJobs = $derived($pendingJobs)
  const connected = $derived($schedulerConnected)

  // "Follow running": while engaged, auto-open whichever session is currently
  // streaming so the user can watch run / evaluation progress hands-free. Any manual
  // navigation clears the flag (see selectChat / selectRun / selectBenchmark).
  $effect(() => {
    if (!$followRunning) return
    const sid = currentActiveJob?.target.sessionId
    if (!sid || $activeChatId === sid) return
    // Only open sessions we actually know about (skip unknown/transient ids).
    if (!$chatSessions.some((s) => s.id === sid)) return
    void selectChat(sid, { fromFollow: true })
  })

  function toggleFollow() {
    followRunning.set(!$followRunning)
  }

  async function handlePauseResume() {
    if (isActioning) return
    isActioning = true
    try {
      if (snapshot.controlState === 'running') {
        await pauseExecution()
      } else {
        await resumeExecution()
      }
    } catch {
      // ignore
    } finally {
      isActioning = false
    }
  }

  async function handleRemoveJob(jobId: string) {
    try {
      await removePendingJob(jobId)
    } catch {
      // ignore
    }
  }

  function formatTarget(job: {
    target: { kind: string; sessionId: string; stepId?: string }
    prompt?: string
  }) {
    if (job.target.kind === 'session') {
      return job.prompt
        ? `"${job.prompt.slice(0, 40)}${job.prompt.length > 40 ? '…' : ''}"`
        : `Session ${job.target.sessionId}`
    }
    if (job.target.kind === 'init') {
      return `Initializing ${job.target.sessionId}`
    }
    return `Step ${job.target.stepId?.slice(0, 8) ?? job.target.sessionId}`
  }
</script>

{#if connected || currentActiveJob !== null || queuedJobs.length > 0}
  <div class="execution-bar">
    <!-- Active job indicator -->
    <div class="exec-status">
      {#if currentActiveJob !== null}
        <span class="status-dot running"></span>
        <span class="status-label">
          {snapshot.controlState === 'paused' ? 'Pausing…' : 'Running'}
        </span>
        <span class="job-label">{formatTarget(currentActiveJob)}</span>
      {:else if snapshot.controlState === 'paused'}
        <span class="status-dot warn"></span>
        <span class="status-label">Paused</span>
      {:else}
        <span class="status-dot idle"></span>
        <span class="status-label">Idle</span>
      {/if}
    </div>

    <!-- Controls -->
    <div class="exec-controls">
      <button
        class="btn btn-sm follow-btn"
        class:follow-on={$followRunning}
        onclick={toggleFollow}
        title={$followRunning
          ? 'Following the running session — click to stop (also stops when you navigate away)'
          : 'Follow the running session: auto-open it in the main view as it streams'}
      >
        <span class="follow-icon"><Icon path={iconView} /></span> Follow
      </button>

      <button
        class="btn btn-sm"
        onclick={handlePauseResume}
        disabled={isActioning}
        title={snapshot.controlState === 'running'
          ? 'Pause after current step'
          : 'Resume execution'}
      >
        {snapshot.controlState === 'running' ? '⏸' : '▶'}
      </button>

      <!-- Queue button -->
      {#if queuedJobs.length > 0}
        <button class="btn btn-sm" onclick={() => (showQueue = !showQueue)} title="Show queue">
          Queue ({$queueLength})
          <span class="chevron">{showQueue ? '▲' : '▼'}</span>
        </button>
      {/if}
    </div>
  </div>
{/if}

<!-- Queue dropdown -->
{#if showQueue && queuedJobs.length > 0}
  <div class="queue-panel">
    <div class="queue-header">Pending jobs</div>
    {#each queuedJobs as job (job.jobId)}
      <div class="queue-item">
        <span class="queue-item-label">{formatTarget(job)}</span>
        <button
          class="icon-btn icon-btn-danger"
          onclick={() => handleRemoveJob(job.jobId)}
          title="Remove from queue">✕</button
        >
      </div>
    {/each}
  </div>
{/if}

<style>
  .execution-bar {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.35rem 1rem;
    background: var(--bg-surface);
    border-bottom: 1px solid var(--border);
    font-size: 0.8rem;
    min-height: 2rem;
    position: relative;
    z-index: 10;
  }

  .exec-status {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex: 1;
    min-width: 0;
  }

  .status-label {
    color: var(--text-dim);
    flex-shrink: 0;
  }

  .job-label {
    color: var(--text-bright);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .exec-controls {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex-shrink: 0;
  }

  .chevron {
    font-size: 0.6rem;
  }

  .follow-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
  }
  .follow-icon {
    display: inline-flex;
    width: 0.9rem;
    height: 0.9rem;
  }
  /* Engaged toggle uses the amber accent (the sanctioned active-state signal). */
  .follow-btn.follow-on {
    border-color: var(--amber-bright);
    color: var(--amber-bright);
  }

  .queue-panel {
    background: var(--bg-surface);
    border-bottom: 1px solid var(--border);
    padding: 0.5rem 1rem;
    font-size: 0.8rem;
  }

  .queue-header {
    color: var(--text-dim);
    font-weight: 600;
    margin-bottom: 0.4rem;
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .queue-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.25rem 0;
  }

  .queue-item-label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-bright);
  }
</style>
