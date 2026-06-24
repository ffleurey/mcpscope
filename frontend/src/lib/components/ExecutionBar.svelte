<script lang="ts">
  import {
    schedulerConnected,
    schedulerSnapshot,
    activeJob,
    pendingJobs,
    pauseExecution,
    resumeExecution,
    abortExecution,
    removePendingJob,
  } from '../executionStore'
  import { stopBenchmarkRun, stopEvaluation } from '../api/backendClient'
  import { followRunning } from '../followStore'
  import { selectChat, activeChatId, chatSessions } from '../sessionStore'
  import Icon from './Icon.svelte'
  import { iconView, iconStop } from '../design/icons'
  import type { ExecutionJobOwner } from '../backendTypes'

  let showQueue = $state(false)
  let isActioning = $state(false)

  const snapshot = $derived($schedulerSnapshot)
  const currentActiveJob = $derived($activeJob)
  const queuedJobs = $derived($pendingJobs)
  const connected = $derived($schedulerConnected)

  // The execution queue's unit is the *run* (benchmark or evaluation), not the
  // individual session: a run enqueues many jobs (init + turn per session) under one
  // owner. Group active+pending jobs by owner so the bar shows — and controls — runs.
  // Ad-hoc (interactive) session jobs have no owner and stay as individual items.
  interface QueueGroup {
    key: string
    ownerKind: ExecutionJobOwner['kind'] | null
    ownerId: string | null
    label: string
    isActive: boolean
    /** A pending job in the group, for removing an ad-hoc job from the queue. */
    representativeJobId: string
  }

  function ownerLabel(owner: ExecutionJobOwner): string {
    return owner.kind === 'benchmark-run'
      ? `Benchmark run ${owner.id}`
      : `LLM evaluation ${owner.id}`
  }

  const groups = $derived.by(() => {
    const entries = [
      ...(currentActiveJob ? [{ job: currentActiveJob, active: true }] : []),
      ...queuedJobs.map((job) => ({ job, active: false })),
    ]
    const byKey = new Map<string, QueueGroup>()
    for (const { job, active } of entries) {
      const owner = job.owner
      const key = owner ? `${owner.kind}:${owner.id}` : `job:${job.jobId}`
      let group = byKey.get(key)
      if (!group) {
        group = {
          key,
          ownerKind: owner?.kind ?? null,
          ownerId: owner?.id ?? null,
          label: owner ? ownerLabel(owner) : formatTarget(job),
          isActive: false,
          representativeJobId: job.jobId,
        }
        byKey.set(key, group)
      }
      if (active) group.isActive = true
      else group.representativeJobId = job.jobId
    }
    return [...byKey.values()]
  })

  const activeGroup = $derived(groups.find((g) => g.isActive) ?? null)
  const pendingGroups = $derived(groups.filter((g) => !g.isActive))

  async function handleStopGroup(group: QueueGroup) {
    if (isActioning) return
    isActioning = true
    try {
      if (group.ownerKind === 'benchmark-run' && group.ownerId) {
        await stopBenchmarkRun(group.ownerId)
      } else if (group.ownerKind === 'benchmark-evaluation' && group.ownerId) {
        await stopEvaluation(group.ownerId)
      } else if (group.isActive) {
        // Ad-hoc active turn: hard-abort the in-flight model call.
        await abortExecution()
      } else {
        await removePendingJob(group.representativeJobId)
      }
    } catch {
      // ignore — the SSE stream reconciles the queue
    } finally {
      isActioning = false
    }
  }

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
    <!-- Active unit indicator (run / evaluation / ad-hoc session) -->
    <div class="exec-status">
      {#if activeGroup !== null}
        <span class="status-dot running"></span>
        <span class="status-label">
          {snapshot.controlState === 'paused' ? 'Pausing…' : 'Running'}
        </span>
        <span class="job-label">{activeGroup.label}</span>
        <button
          class="icon-btn icon-btn-danger stop-btn"
          onclick={() => activeGroup && handleStopGroup(activeGroup)}
          disabled={isActioning}
          title={activeGroup.ownerKind
            ? 'Stop this run (it can be resumed from the run view)'
            : 'Stop: abort the in-flight model call now'}
          aria-label="Stop"
        >
          <Icon path={iconStop} />
        </button>
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

      <!-- Queue-level pause/resume: pauses the whole execution queue. -->
      <button
        class="btn btn-sm"
        onclick={handlePauseResume}
        disabled={isActioning}
        title={snapshot.controlState === 'running'
          ? 'Pause the queue (after the current step)'
          : 'Resume the queue'}
      >
        {snapshot.controlState === 'running' ? '⏸' : '▶'}
      </button>

      <!-- Queue button -->
      {#if pendingGroups.length > 0}
        <button class="btn btn-sm" onclick={() => (showQueue = !showQueue)} title="Show queue">
          Queue ({pendingGroups.length})
          <span class="chevron">{showQueue ? '▲' : '▼'}</span>
        </button>
      {/if}
    </div>
  </div>
{/if}

<!-- Queue dropdown: one row per waiting unit (run / evaluation / ad-hoc session). -->
{#if showQueue && pendingGroups.length > 0}
  <div class="queue-panel">
    <div class="queue-header">Queued</div>
    {#each pendingGroups as group (group.key)}
      <div class="queue-item">
        <span class="queue-item-label">{group.label}</span>
        <button
          class="icon-btn icon-btn-danger"
          onclick={() => handleStopGroup(group)}
          disabled={isActioning}
          title={group.ownerKind
            ? 'Remove this run from the queue (stops it; resume it later from the run view)'
            : 'Remove from queue'}>✕</button
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

  .stop-btn {
    flex-shrink: 0;
    margin-left: 0.1rem;
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
