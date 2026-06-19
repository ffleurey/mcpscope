<script lang="ts">
  import { currentView } from '../navStore'
  import { modelConfigs } from '../connectionStore'
  import { openPrimaryLaunchDialog } from '../sessionStore'
  import { benchmarks, selectBenchmark } from '../benchmarkStore'
  import { getBenchmark } from '../api/backendClient'
  import { columnResize } from '../actions/columnResize'
  import { formatTreeTimestamp } from '../format'
  import { iconPlus, iconRun } from '../design/icons'
  import Icon from './Icon.svelte'
  import BenchmarkFormModal from './BenchmarkFormModal.svelte'
  import RunLaunchModal from './RunLaunchModal.svelte'
  import type { BenchmarkCase } from '../backendTypes'

  // The session-creation modal is mounted in the Sidebar and driven by a store,
  // so we just trigger it here.
  function handleNewSession() {
    openPrimaryLaunchDialog()
  }

  let showNewBenchmark = $state(false)

  async function handleBenchmarkCreated(id: string) {
    showNewBenchmark = false
    await selectBenchmark(id)
  }

  // Launching a run needs the benchmark's cases, which the summary list doesn't
  // carry — fetch the detail on demand, then open the run dialog.
  let runTarget = $state<{ id: string; name: string; cases: BenchmarkCase[] } | null>(null)
  let loadingRunFor = $state<string | null>(null)

  async function openRun(id: string, name: string) {
    loadingRunFor = id
    try {
      const detail = await getBenchmark(id)
      runTarget = { id, name, cases: detail.cases }
    } finally {
      loadingRunFor = null
    }
  }
</script>

<div class="home">
  <div class="home-inner">
    <!-- ── About ──────────────────────────────────────────────────────── -->
    <section class="hero">
      <img class="hero-logo" src="/logo.svg" alt="mcpscope" />
      <p class="hero-blurb">
        A local-first runtime analysis tool for MCP servers and multi-turn LLM workflows. Inspect
        how models reason, choose tools, and consume context — then benchmark a server across
        repeated runs.
      </p>
    </section>

    <!-- ── Sessions ───────────────────────────────────────────────────── -->
    <section class="card">
      <div class="card-head">
        <h2>Sessions</h2>
        {#if $modelConfigs.length > 0}
          <button class="btn" onclick={handleNewSession}>
            <Icon path={iconPlus} /> New session
          </button>
        {/if}
      </div>
      <p class="card-note">
        Start an interactive session to send prompts to a model with your MCP servers attached and
        watch the context build up turn by turn.
      </p>
      {#if $modelConfigs.length === 0}
        <p class="card-note muted">
          No model configs yet — <button
            class="link"
            onclick={() => currentView.set('configuration')}>configure a model</button
          > first.
        </p>
      {/if}
    </section>

    <!-- ── Benchmarks ─────────────────────────────────────────────────── -->
    <section class="card">
      <div class="card-head">
        <h2>Benchmarks</h2>
        <button class="btn" onclick={() => (showNewBenchmark = true)}>
          <Icon path={iconPlus} /> New benchmark
        </button>
      </div>
      <p class="card-note">
        A benchmark is a reusable suite of prompts. Run it against a model/MCP combination to get
        repeatable, per-tool metrics.
      </p>

      {#if $benchmarks.length === 0}
        <p class="card-note muted">No benchmarks yet.</p>
      {:else}
        <div class="table-scroll">
          <table class="data-table" use:columnResize>
            <colgroup>
              <col class="col-flex" />
              <col style="width: 5rem" />
              <col style="width: 5rem" />
              <col style="width: 11rem" />
              <col style="width: 7rem" />
            </colgroup>
            <thead>
              <tr>
                <th>Benchmark</th>
                <th class="col-num">Cases</th>
                <th class="col-num">Runs</th>
                <th>Updated</th>
                <th class="col-actions"></th>
              </tr>
            </thead>
            <tbody>
              {#each $benchmarks as benchmark (benchmark.id)}
                <tr>
                  <td>
                    <button class="link bench-name" onclick={() => selectBenchmark(benchmark.id)}>
                      <span class="bench-id">[{benchmark.id}]</span>
                      {benchmark.name}
                    </button>
                  </td>
                  <td class="col-num">{benchmark.caseCount}</td>
                  <td class="col-num">{benchmark.runCount}</td>
                  <td>{formatTreeTimestamp(benchmark.updatedAt)}</td>
                  <td class="col-actions">
                    <button
                      class="btn btn-sm"
                      disabled={benchmark.caseCount === 0 || loadingRunFor === benchmark.id}
                      title={benchmark.caseCount === 0
                        ? 'Add a case before running'
                        : 'Launch a run'}
                      onclick={() => openRun(benchmark.id, benchmark.name)}
                    >
                      <Icon path={iconRun} />
                      {loadingRunFor === benchmark.id ? 'Loading…' : 'Run'}
                    </button>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </section>
  </div>
</div>

{#if showNewBenchmark}
  <BenchmarkFormModal onClose={() => (showNewBenchmark = false)} onSaved={handleBenchmarkCreated} />
{/if}

{#if runTarget}
  <RunLaunchModal
    benchmarkId={runTarget.id}
    benchmarkName={runTarget.name}
    cases={runTarget.cases}
    onClose={() => (runTarget = null)}
  />
{/if}

<style>
  .home {
    flex: 1;
    overflow-y: auto;
    padding: 2rem 1.5rem;
  }
  .home-inner {
    max-width: 880px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .hero {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
  }
  .hero-logo {
    height: 44px;
    width: auto;
    align-self: flex-start;
  }
  .hero-blurb {
    margin: 0;
    font-size: 0.85rem;
    color: var(--text-dim);
    line-height: 1.5;
  }

  .card {
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 1.1rem 1.25rem;
  }
  .card-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 0.5rem;
  }
  .card-head h2 {
    margin: 0;
    font-size: 1rem;
    color: var(--text-bright);
  }
  .card-note {
    margin: 0 0 0.9rem;
    font-size: 0.82rem;
    color: var(--text-dim);
    line-height: 1.5;
  }
  .card-note.muted {
    opacity: 0.85;
    margin-bottom: 0;
  }
  .card-note:last-child {
    margin-bottom: 0;
  }

  .link {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    color: var(--amber-bright);
    cursor: pointer;
  }
  .link:hover {
    color: var(--amber-glow);
  }

  .bench-name {
    color: var(--text-bright);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
  }
  .bench-name:hover {
    color: var(--amber-bright);
  }
  .bench-id {
    font-family: var(--mono);
    font-size: 0.75rem;
    opacity: 0.6;
  }
</style>
