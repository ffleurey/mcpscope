<script lang="ts">
  import { activeRun, activeRunReport } from '../benchmarkStore'
  import { chatSessions, selectChat } from '../sessionStore'
  import { modelConfigs } from '../connectionStore'
  import { columnResize } from '../actions/columnResize'
  import IdBadge from './IdBadge.svelte'
  import type { CaseReport, NumberStats } from '../backendTypes'

  const run = $derived($activeRun)
  const report = $derived($activeRunReport)
  const isRunning = $derived(run != null && (run.status === 'pending' || run.status === 'running'))

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

  function caseLabel(c: CaseReport): string {
    return c.prompt
  }

  // Map a sourceCaseId to its produced child sessions for click-through.
  function sessionsForCase(caseId: string): string[] {
    if (!run) return []
    return run.sessions.filter((s) => s.sourceCaseId === caseId).map((s) => s.sessionId)
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
              <col style="width: 16rem" />
              <col style="width: 6rem" />
              <col style="width: 6rem" />
              <col style="width: 7rem" />
              <col style="width: 8rem" />
              <col style="width: 10rem" />
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
              <col style="width: 22rem" />
              <col style="width: 8rem" />
              <col style="width: 7rem" />
              <col style="width: 7rem" />
              <col style="width: 7rem" />
              <col style="width: 8rem" />
              <col style="width: 11rem" />
              <col style="width: 12rem" />
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
              </tr>
            </thead>
            <tbody>
              {#each report.cases as c (c.caseId)}
                {@const sids = sessionsForCase(c.caseId)}
                <tr>
                  <td title={caseLabel(c)}>
                    {caseLabel(c)}
                    {#if sids.length > 0}
                      <span class="case-sessions">
                        {#each sids as sid (sid)}
                          <button
                            class="session-link"
                            title="Open session {sid}"
                            onclick={() => openSession(sid)}>{sid}</button
                          >
                        {/each}
                      </span>
                    {/if}
                  </td>
                  <td class="col-num">{c.hasChecks ? pct(c.successRate) : '—'}</td>
                  <td class="col-num">{c.hasChecks ? (c.passAtK ? 'yes' : 'no') : '—'}</td>
                  <td class="col-num">{c.hasChecks ? (c.passHatK ? 'yes' : 'no') : '—'}</td>
                  <td class="col-num">{c.completedCount}/{c.sessionCount}</td>
                  <td class="col-num">{c.toolErrorCount}</td>
                  <td class="col-num">{statTriple(c.toolCallStats)}</td>
                  <td class="col-num">{statTriple(c.totalTokenStats)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </section>
  </div>
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
  .case-sessions {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 0.25rem;
    margin-left: 0.4rem;
  }
  .session-link {
    background: none;
    border: 1px solid var(--border);
    border-radius: 999px;
    color: var(--text-dim);
    font-family: var(--mono);
    font-size: 0.68rem;
    padding: 0.05rem 0.4rem;
    cursor: pointer;
  }
  .session-link:hover {
    color: var(--amber-bright);
    border-color: var(--amber-bright);
  }
</style>
