<script lang="ts">
  import {
    activeRun,
    activeRunReport,
    activeRunEvaluations,
    removeEvaluation,
    retryEvaluation,
  } from '../benchmarkStore'
  import { chatSessions, selectChat } from '../sessionStore'
  import { modelConfigs } from '../connectionStore'
  import { columnResize } from '../actions/columnResize'
  import IdBadge from './IdBadge.svelte'
  import Icon from './Icon.svelte'
  import DialogShell from './DialogShell.svelte'
  import BenchmarkCaseCard from './BenchmarkCaseCard.svelte'
  import EvaluationLaunchModal from './EvaluationLaunchModal.svelte'
  import { iconView, iconAnalysis, iconTrash, iconRefresh } from '../design/icons'
  import type {
    CaseReport,
    NumberStats,
    BenchmarkRunCaseSnapshot,
    EvaluationCaseScore,
  } from '../backendTypes'

  const run = $derived($activeRun)
  const report = $derived($activeRunReport)
  const isRunning = $derived(run != null && (run.status === 'pending' || run.status === 'running'))

  // ── LLM evaluation ──────────────────────────────────────────────────
  const evaluations = $derived($activeRunEvaluations)
  const canEvaluate = $derived(run?.status === 'complete')
  let showEvalDialog = $state(false)
  // Single open per-case verdict drilldown, keyed `${evaluationId}:${caseId}`.
  let expandedKey = $state<string | null>(null)

  function judgeName(id: string): string {
    return $modelConfigs.find((c) => c.id === id)?.name ?? id
  }
  function caseScoreLabel(c: EvaluationCaseScore): string {
    return c.name?.trim() || c.sourceCaseId
  }
  function toggleExpand(key: string): void {
    expandedKey = expandedKey === key ? null : key
  }
  async function handleDeleteEvaluation(id: string): Promise<void> {
    await removeEvaluation(id)
  }
  async function handleRetryEvaluation(id: string): Promise<void> {
    await retryEvaluation(id)
  }

  // Live clock so the elapsed-time of an in-progress run ticks forward.
  let now = $state(Date.now())
  $effect(() => {
    if (!isRunning) return
    const t = setInterval(() => (now = Date.now()), 1000)
    return () => clearInterval(t)
  })

  const modelName = $derived.by(() => {
    if (!run) return ''
    return $modelConfigs.find((c) => c.id === run.modelConfigId)?.name ?? run.modelConfigId
  })

  const mcpNames = $derived.by(() => {
    // mcpProfileIds snapshot — best-effort resolve to current profile names.
    return run?.mcpProfileIds ?? []
  })

  function statusPillClass(status: string): string {
    if (status === 'complete') return 'success'
    if (status === 'error') return 'error'
    if (status === 'running') return 'soft'
    return 'dim'
  }

  // Per-tool rollup sorted by error rate then calls (worst offenders first).
  const perToolRows = $derived.by(() => {
    if (!report) return []
    return Object.entries(report.perTool).sort((a, b) => {
      if (b[1].errorRate !== a[1].errorRate) return b[1].errorRate - a[1].errorRate
      return b[1].calls - a[1].calls
    })
  })

  function pct(value: number | null): string {
    if (value == null) return '—'
    return `${Math.round(value * 100)}%`
  }

  function stat(s: NumberStats | null, key: 'min' | 'median' | 'mean'): string {
    if (!s) return '—'
    const v = s[key]
    return Number.isInteger(v) ? String(v) : v.toFixed(1)
  }

  function statTriple(s: NumberStats | null): string {
    if (!s) return '—'
    return `${stat(s, 'min')} / ${stat(s, 'median')} / ${stat(s, 'mean')}`
  }

  // ── Timing ────────────────────────────────────────────────────────
  function formatTimestamp(ts: number | null): string {
    if (ts == null) return '—'
    const d = new Date(ts)
    const dd = String(d.getDate()).padStart(2, '0')
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const HH = String(d.getHours()).padStart(2, '0')
    const MM = String(d.getMinutes()).padStart(2, '0')
    const SS = String(d.getSeconds()).padStart(2, '0')
    return `${dd}/${mm} ${HH}:${MM}:${SS}`
  }

  function formatDuration(ms: number): string {
    const totalSec = Math.max(0, Math.round(ms / 1000))
    const h = Math.floor(totalSec / 3600)
    const m = Math.floor((totalSec % 3600) / 60)
    const s = totalSec % 60
    if (h > 0) return `${h}h ${m}m ${s}s`
    if (m > 0) return `${m}m ${s}s`
    return `${s}s`
  }

  // Duration: completed − started; while running, elapsed from start to now.
  const durationLabel = $derived.by(() => {
    if (!run?.startedAt) return null
    const end = run.completedAt ?? (isRunning ? now : null)
    if (end == null) return null
    return formatDuration(end - run.startedAt)
  })

  // ── Per-case detail: name + full case view ──────────────────────────
  function caseSnapshotFor(caseId: string): BenchmarkRunCaseSnapshot | null {
    return run?.cases.find((c) => c.sourceCaseId === caseId) ?? null
  }

  function caseLabel(c: CaseReport): string {
    const snapshot = caseSnapshotFor(c.caseId)
    return snapshot?.name?.trim() || c.caseId
  }

  // The case shown in the full-view dialog (tracked by id so we can also pull its
  // produced sessions for this run).
  let viewCaseId = $state<string | null>(null)
  const viewSnapshot = $derived(viewCaseId ? caseSnapshotFor(viewCaseId) : null)
  const viewSessions = $derived.by(() => {
    if (!viewCaseId || !run) return []
    const caseReport = report?.cases.find((c) => c.caseId === viewCaseId)
    if (!caseReport) return []
    return caseReport.sessions.map((sm) => ({
      sessionId: sm.sessionId,
      terminalStatus: sm.terminalStatus,
      completed: sm.completed,
      repetition: run.sessions.find((rs) => rs.sessionId === sm.sessionId)?.repetition ?? null,
    }))
  })

  function outcomeLabel(s: { terminalStatus: string | null; completed: boolean }): string {
    return s.terminalStatus ?? (s.completed ? 'complete' : 'running')
  }
  function outcomePillClass(s: { terminalStatus: string | null }): string {
    if (s.terminalStatus === 'complete') return 'success'
    if (s.terminalStatus === 'error' || s.terminalStatus === 'aborted') return 'error'
    return 'soft'
  }

  function openSession(sessionId: string) {
    if ($chatSessions.some((s) => s.id === sessionId)) {
      void selectChat(sessionId)
    }
  }
</script>

{#if !run || !report}
  <div class="report-loading">Loading run report…</div>
{:else}
  <div class="run-report">
    <header class="run-header">
      <div class="header-line">
        <h2 class="benchmark-name">{run.benchmarkName}</h2>
        <IdBadge id={run.id} />
        <span class="status-pill {statusPillClass(run.status)}">{run.status}</span>
        {#if canEvaluate}
          <button class="btn btn-sm header-evaluate" onclick={() => (showEvalDialog = true)}>
            <Icon path={iconAnalysis} /> Evaluate
          </button>
        {/if}
      </div>
      <div class="header-meta">
        <span class="meta-item">Model: <span class="meta-value">{modelName}</span></span>
        <span class="meta-item"
          >MCP: <span class="meta-value">{mcpNames.length > 0 ? mcpNames.join(', ') : 'none'}</span
          ></span
        >
        <span class="meta-item">Repetitions: <span class="meta-value">{run.repetitions}</span></span
        >
        <span class="meta-item">Cases: <span class="meta-value">{report.caseCount}</span></span>
        <span class="meta-item"
          >Sessions: <span class="meta-value">{report.sessionCount}</span></span
        >
        <span class="meta-item"
          >Started: <span class="meta-value">{formatTimestamp(run.startedAt)}</span></span
        >
        <span class="meta-item"
          >Completed: <span class="meta-value">{formatTimestamp(run.completedAt)}</span></span
        >
        {#if durationLabel}
          <span class="meta-item"
            >Duration: <span class="meta-value">{durationLabel}{isRunning ? ' (elapsed)' : ''}</span
            ></span
          >
        {/if}
      </div>
      {#if run.error}
        <div class="run-error">{run.error}</div>
      {/if}
      {#if isRunning}
        <div class="running-note">
          <span class="status-dot running"></span>
          Run in progress — metrics update as sessions complete…
        </div>
      {/if}
    </header>

    <!-- Headline: per-tool rollup -->
    <section class="report-section">
      <h3 class="section-title">Per-tool rollup</h3>
      {#if perToolRows.length === 0}
        <p class="config-empty">No tool calls recorded yet.</p>
      {:else}
        <div class="table-scroll">
          <table class="data-table" use:columnResize>
            <colgroup>
              <col class="col-flex" />
              <col style="width: 4.5rem" />
              <col style="width: 4.5rem" />
              <col style="width: 5.5rem" />
              <col style="width: 5.5rem" />
              <col style="width: 7rem" />
            </colgroup>
            <thead>
              <tr>
                <th>Tool</th>
                <th class="col-num">Calls</th>
                <th class="col-num">Errors</th>
                <th class="col-num">Error rate</th>
                <th class="col-num">Cases used in</th>
                <th class="col-num">Payload chars</th>
              </tr>
            </thead>
            <tbody>
              {#each perToolRows as [name, t] (name)}
                <tr>
                  <td class="col-mono" title={name}>{name}</td>
                  <td class="col-num">{t.calls}</td>
                  <td class="col-num">{t.errors}</td>
                  <td class="col-num">{pct(t.errorRate)}</td>
                  <td class="col-num">{t.casesUsedIn}</td>
                  <td class="col-num">{t.resultPayloadChars}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </section>

    <!-- Per-case detail -->
    <section class="report-section">
      <h3 class="section-title">Per-case detail</h3>
      {#if report.cases.length === 0}
        <p class="config-empty">No cases in this run.</p>
      {:else}
        <div class="table-scroll">
          <table class="data-table" use:columnResize>
            <colgroup>
              <col class="col-flex" />
              <col style="width: 5rem" />
              <col style="width: 4.5rem" />
              <col style="width: 4.5rem" />
              <col style="width: 5rem" />
              <col style="width: 5rem" />
              <col style="width: 11rem" />
              <col style="width: 12rem" />
              <col style="width: 4rem" />
            </colgroup>
            <thead>
              <tr>
                <th>Case</th>
                <th class="col-num">Success</th>
                <th class="col-num">pass@k</th>
                <th class="col-num">pass^k</th>
                <th class="col-num">Completed</th>
                <th class="col-num">Tool errors</th>
                <th class="col-num">Tool calls (min/med/mean)</th>
                <th class="col-num">Total tokens (min/med/mean)</th>
                <th class="col-actions"></th>
              </tr>
            </thead>
            <tbody>
              {#each report.cases as c (c.caseId)}
                <tr>
                  <td><span class="case-name" title={caseLabel(c)}>{caseLabel(c)}</span></td>
                  <td class="col-num">{c.hasChecks ? pct(c.successRate) : '—'}</td>
                  <td class="col-num">{c.hasChecks ? (c.passAtK ? 'yes' : 'no') : '—'}</td>
                  <td class="col-num">{c.hasChecks ? (c.passHatK ? 'yes' : 'no') : '—'}</td>
                  <td class="col-num">{c.completedCount}/{c.sessionCount}</td>
                  <td class="col-num">{c.toolErrorCount}</td>
                  <td class="col-num">{statTriple(c.toolCallStats)}</td>
                  <td class="col-num">{statTriple(c.totalTokenStats)}</td>
                  <td class="col-actions">
                    <span class="row-actions">
                      <button
                        class="icon-btn"
                        title="View case"
                        aria-label="View case"
                        onclick={() => (viewCaseId = c.caseId)}><Icon path={iconView} /></button
                      >
                    </span>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </section>

    <!-- LLM evaluation passes (rubric judging) -->
    {#if evaluations.length > 0 || canEvaluate}
      <section class="report-section">
        <h3 class="section-title">LLM evaluation</h3>
        {#if evaluations.length === 0}
          <p class="config-empty">
            No evaluation passes yet. Click “Evaluate” to score this run's sessions against their
            case rubrics with a judge model.
          </p>
        {:else}
          {#each evaluations as ev (ev.id)}
            <div class="eval-pass">
              <div class="eval-pass-head">
                <span class="eval-judge"
                  >Judge: <span class="meta-value">{judgeName(ev.judgeModelConfigId)}</span></span
                >
                <span class="status-pill {statusPillClass(ev.status)}">{ev.status}</span>
                {#if ev.score.overallPct != null}
                  <span class="eval-overall">{pct(ev.score.overallPct)}</span>
                {/if}
                <IdBadge id={ev.id} />
                <span class="eval-actions">
                  {#if ev.status === 'error'}
                    <button
                      class="icon-btn"
                      title="Retry failed judge sessions"
                      aria-label="Retry evaluation"
                      onclick={() => handleRetryEvaluation(ev.id)}
                    >
                      <Icon path={iconRefresh} />
                    </button>
                  {/if}
                  <button
                    class="icon-btn icon-btn-danger"
                    title="Delete evaluation"
                    aria-label="Delete evaluation"
                    onclick={() => handleDeleteEvaluation(ev.id)}
                  >
                    <Icon path={iconTrash} />
                  </button>
                </span>
              </div>
              {#if ev.error}
                <div class="run-error">{ev.error}</div>
              {/if}
              {#if ev.score.cases.length > 0}
                <div class="table-scroll">
                  <table class="data-table" use:columnResize>
                    <colgroup>
                      <col class="col-flex" />
                      <col style="width: 5rem" />
                      <col style="width: 12rem" />
                      <col style="width: 5rem" />
                      <col style="width: 4rem" />
                    </colgroup>
                    <thead>
                      <tr>
                        <th>Case</th>
                        <th class="col-num">Score</th>
                        <th class="col-num">min/med/max</th>
                        <th class="col-num">Scored</th>
                        <th class="col-actions"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {#each ev.score.cases as c (c.sourceCaseId)}
                        {@const key = `${ev.id}:${c.sourceCaseId}`}
                        {@const scored = c.sessions.filter((s) => s.pct != null).length}
                        <tr>
                          <td
                            ><span class="case-name" title={caseScoreLabel(c)}
                              >{caseScoreLabel(c)}</span
                            ></td
                          >
                          <td class="col-num">{pct(c.pctStats?.mean ?? null)}</td>
                          <td class="col-num">
                            {c.pctStats
                              ? `${pct(c.pctStats.min)} / ${pct(c.pctStats.median)} / ${pct(c.pctStats.max)}`
                              : '—'}
                          </td>
                          <td class="col-num">{scored}/{c.sessions.length}</td>
                          <td class="col-actions">
                            <span class="row-actions">
                              <button
                                class="icon-btn"
                                title="Per-session verdicts"
                                aria-label="Per-session verdicts"
                                onclick={() => toggleExpand(key)}><Icon path={iconView} /></button
                              >
                            </span>
                          </td>
                        </tr>
                        {#if expandedKey === key}
                          <tr class="verdict-subrow">
                            <td colspan="5">
                              <div class="verdict-sessions">
                                {#each c.sessions as s (s.analysisSessionId)}
                                  <div class="verdict-session">
                                    <span class="verdict-score"
                                      >{s.awarded ?? '—'}{s.max != null ? `/${s.max}` : ''}</span
                                    >
                                    <span class="verdict-pct">{pct(s.pct)}</span>
                                    <span class="verdict-ids">
                                      run <IdBadge id={s.runSessionId} /> · judge
                                      <IdBadge id={s.analysisSessionId} />
                                    </span>
                                    <span class="status-pill {statusPillClass(s.status)}"
                                      >{s.status}</span
                                    >
                                  </div>
                                {/each}
                              </div>
                            </td>
                          </tr>
                        {/if}
                      {/each}
                    </tbody>
                  </table>
                </div>
              {/if}
            </div>
          {/each}
        {/if}
      </section>
    {/if}
  </div>
{/if}

{#if viewCaseId && viewSnapshot}
  <DialogShell
    title="Case detail"
    onClose={() => (viewCaseId = null)}
    dialogClass="case-view-dialog"
  >
    <BenchmarkCaseCard case={viewSnapshot} />
    <div class="case-sessions-section">
      <div class="subsection-title">Sessions ({viewSessions.length})</div>
      {#if viewSessions.length === 0}
        <div class="empty-note">No sessions for this case in this run.</div>
      {:else}
        <div class="table-scroll">
          <table class="data-table" use:columnResize>
            <colgroup>
              <col class="col-flex" />
              <col style="width: 3.5rem" />
              <col style="width: 7rem" />
              <col style="width: 4rem" />
            </colgroup>
            <thead>
              <tr>
                <th>Session</th>
                <th class="col-num">Rep</th>
                <th>Outcome</th>
                <th class="col-actions"></th>
              </tr>
            </thead>
            <tbody>
              {#each viewSessions as s (s.sessionId)}
                <tr>
                  <td><IdBadge id={s.sessionId} /></td>
                  <td class="col-num">{s.repetition ?? '—'}</td>
                  <td>
                    <span class="status-pill {outcomePillClass(s)}">{outcomeLabel(s)}</span>
                  </td>
                  <td class="col-actions">
                    <span class="row-actions">
                      <button
                        class="icon-btn"
                        title="Open session"
                        aria-label="Open session"
                        onclick={() => openSession(s.sessionId)}><Icon path={iconView} /></button
                      >
                    </span>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </div>
  </DialogShell>
{/if}

{#if showEvalDialog && run}
  <EvaluationLaunchModal runId={run.id} onClose={() => (showEvalDialog = false)} />
{/if}

<style>
  .report-loading {
    padding: 2rem;
    color: var(--text-dim);
    font-size: 0.9rem;
  }
  .run-report {
    padding: 1.5rem 2rem;
    overflow-y: auto;
    height: 100%;
  }
  .run-header {
    margin-bottom: 1.25rem;
  }
  .header-line {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    margin-bottom: 0.5rem;
  }
  .benchmark-name {
    font-size: 1.15rem;
    font-weight: 600;
    margin: 0;
  }
  .header-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 1rem;
    font-size: 0.8rem;
    color: var(--text-dim);
  }
  .meta-value {
    color: var(--text-bright);
  }
  .run-error {
    margin-top: 0.6rem;
    padding: 0.5rem 0.75rem;
    border: 1px solid color-mix(in srgb, var(--red-bright) 35%, transparent);
    background: color-mix(in srgb, var(--red-bright) 12%, transparent);
    border-radius: 6px;
    color: var(--red-bright);
    font-size: 0.82rem;
  }
  .running-note {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    margin-top: 0.6rem;
    font-size: 0.82rem;
    color: var(--text-dim);
  }
  .report-section {
    margin-bottom: 1.5rem;
  }
  .section-title {
    font-size: 0.95rem;
    font-weight: 600;
    margin: 0 0 0.6rem;
  }
  .case-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  :global(.case-view-dialog) {
    max-width: min(640px, 95vw);
  }
  .case-sessions-section {
    margin-top: 0.75rem;
  }
  .subsection-title {
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin-bottom: 0.4rem;
  }
  .empty-note {
    font-size: 0.82rem;
    color: var(--text-dim);
  }
  .header-evaluate {
    margin-left: auto;
  }
  .eval-pass {
    margin-bottom: 1rem;
    padding: 0.75rem;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-surface);
  }
  .eval-pass-head {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    margin-bottom: 0.6rem;
    font-size: 0.82rem;
    color: var(--text-dim);
  }
  .eval-overall {
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--green-bright);
  }
  .eval-actions {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 0.15rem;
  }
  .verdict-subrow > td {
    padding: 0.4rem 0.6rem;
    background: var(--bg-base);
  }
  .verdict-sessions {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  .verdict-session {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    font-size: 0.8rem;
  }
  .verdict-score {
    font-weight: 600;
    color: var(--text-bright);
    min-width: 3rem;
  }
  .verdict-pct {
    color: var(--green-bright);
    min-width: 2.5rem;
  }
  .verdict-ids {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    color: var(--text-dim);
  }
</style>
