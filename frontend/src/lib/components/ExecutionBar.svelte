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

  let showQueue = $state(false)
  let isActioning = $state(false)

  const snapshot = $derived($schedulerSnapshot)
  const currentActiveJob = $derived($activeJob)
  const queuedJobs = $derived($pendingJobs)
  const connected = $derived($schedulerConnected)

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

  function formatTarget(job: { target: { kind: string; sessionId: string; stepId?: string }; prompt?: string }) {
    if (job.target.kind === 'session') {
      return job.prompt ? `"${job.prompt.slice(0, 40)}${job.prompt.length > 40 ? '…' : ''}"` : `Session ${job.target.sessionId.slice(0, 8)}`
    }
    return `Step ${job.target.stepId?.slice(0, 8) ?? '?'}`
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
        <span class="status-dot paused"></span>
        <span class="status-label">Paused</span>
      {:else}
        <span class="status-dot idle"></span>
        <span class="status-label">Idle</span>
      {/if}
    </div>

    <!-- Controls -->
    <div class="exec-controls">
      <button
        class="exec-btn"
        onclick={handlePauseResume}
        disabled={isActioning}
        title={snapshot.controlState === 'running' ? 'Pause after current step' : 'Resume execution'}
      >
        {snapshot.controlState === 'running' ? '⏸' : '▶'}
      </button>

      <!-- Queue button -->
      {#if queuedJobs.length > 0}
        <button
          class="exec-btn queue-btn"
          onclick={() => showQueue = !showQueue}
          title="Show queue"
        >
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
          class="queue-remove-btn"
          onclick={() => handleRemoveJob(job.jobId)}
          title="Remove from queue"
        >✕</button>
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
    background: var(--bg-panel, #1e2229);
    border-bottom: 1px solid var(--border, #30363d);
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

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .status-dot.running {
    background: #3fb950;
    animation: pulse 1.5s infinite;
  }
  .status-dot.paused {
    background: #d29922;
  }
  .status-dot.idle {
    background: #484f58;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  .status-label {
    color: var(--text-muted, #8b949e);
    flex-shrink: 0;
  }

  .job-label {
    color: var(--text, #e6edf3);
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

  .exec-btn {
    background: var(--bg-input, #21262d);
    border: 1px solid var(--border, #30363d);
    border-radius: 4px;
    color: var(--text, #e6edf3);
    cursor: pointer;
    padding: 0.2rem 0.5rem;
    font-size: 0.75rem;
    display: flex;
    align-items: center;
    gap: 0.3rem;
  }
  .exec-btn:hover:not(:disabled) {
    background: var(--bg-hover, #30363d);
  }
  .exec-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .chevron {
    font-size: 0.6rem;
  }

  .queue-panel {
    background: var(--bg-panel, #1e2229);
    border-bottom: 1px solid var(--border, #30363d);
    padding: 0.5rem 1rem;
    font-size: 0.8rem;
  }

  .queue-header {
    color: var(--text-muted, #8b949e);
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
    color: var(--text, #e6edf3);
  }

  .queue-remove-btn {
    background: none;
    border: none;
    color: var(--text-muted, #8b949e);
    cursor: pointer;
    padding: 0.1rem 0.3rem;
    border-radius: 3px;
    font-size: 0.75rem;
    flex-shrink: 0;
  }
  .queue-remove-btn:hover {
    background: var(--bg-hover, #30363d);
    color: var(--color-error, #f85149);
  }
</style>
