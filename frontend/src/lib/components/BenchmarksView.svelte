<script lang="ts">
  import { getBenchmark } from '../api/backendClient'
  import { benchmarks, createBenchmark, removeBenchmark } from '../benchmarkStore'
  import { toAppError, type AppError } from '../errors'
  import { iconPlus, iconEdit, iconTrash, iconRun } from '../design/icons'
  import Icon from './Icon.svelte'
  import DialogShell from './DialogShell.svelte'
  import InlineAppError from './InlineAppError.svelte'
  import RunLaunchModal from './RunLaunchModal.svelte'
  import BenchmarkCasesPanel from './BenchmarkCasesPanel.svelte'
  import { columnResize } from '../actions/columnResize'
  import type { BenchmarkCase, BenchmarkSummary } from '../backendTypes'

  let viewError = $state<AppError | null>(null)

  // New-benchmark dialog
  let showNew = $state(false)
  let newName = $state('')
  let newDescription = $state('')
  let creating = $state(false)

  // Manage-cases panel
  let casesFor = $state<BenchmarkSummary | null>(null)

  // Run-launch modal
  let runFor = $state<{ benchmark: BenchmarkSummary; cases: BenchmarkCase[] } | null>(null)
  let loadingRunCases = $state(false)

  function startNew() {
    newName = ''
    newDescription = ''
    showNew = true
  }

  async function handleCreate() {
    if (!newName.trim()) return
    creating = true
    viewError = null
    try {
      await createBenchmark({
        name: newName.trim(),
        description: newDescription.trim() || null,
      })
      showNew = false
    } catch (e) {
      viewError = toAppError(e)
    } finally {
      creating = false
    }
  }

  async function handleDelete(id: string) {
    viewError = null
    try {
      await removeBenchmark(id)
    } catch (e) {
      viewError = toAppError(e)
    }
  }

  async function openRun(benchmark: BenchmarkSummary) {
    loadingRunCases = true
    viewError = null
    try {
      const detail = await getBenchmark(benchmark.id)
      runFor = {
        benchmark,
        cases: [...detail.cases].sort((a, b) => a.orderIndex - b.orderIndex),
      }
    } catch (e) {
      viewError = toAppError(e)
    } finally {
      loadingRunCases = false
    }
  }
</script>

<div class="config-view">
  <div class="config-view-header">
    <h2>Benchmarks</h2>
    <button class="btn btn-primary" onclick={startNew}>
      <span class="btn-icon"><Icon path={iconPlus} /></span> New benchmark
    </button>
  </div>

  <InlineAppError error={viewError} />

  {#if $benchmarks.length === 0}
    <p class="config-empty">No benchmarks yet. Create one to get started.</p>
  {:else}
    <div class="table-scroll">
      <table class="data-table" use:columnResize>
        <colgroup>
          <col style="width: 16rem" />
          <col style="width: 22rem" />
          <col style="width: 6rem" />
          <col style="width: 6rem" />
          <col style="width: 11rem" />
        </colgroup>
        <thead>
          <tr>
            <th>Name</th>
            <th>Description</th>
            <th class="col-num">Cases</th>
            <th class="col-num">Runs</th>
            <th class="col-actions">Actions</th>
          </tr>
        </thead>
        <tbody>
          {#each $benchmarks as benchmark (benchmark.id)}
            <tr>
              <td title={benchmark.name}>{benchmark.name}</td>
              <td title={benchmark.description ?? ''}>{benchmark.description ?? '—'}</td>
              <td class="col-num">{benchmark.caseCount}</td>
              <td class="col-num">{benchmark.runCount}</td>
              <td class="col-actions">
                <span class="row-actions">
                  <button
                    class="icon-btn"
                    title="Run benchmark"
                    aria-label="Run benchmark"
                    disabled={loadingRunCases}
                    onclick={() => openRun(benchmark)}><Icon path={iconRun} /></button
                  >
                  <button
                    class="icon-btn"
                    title="Manage cases"
                    aria-label="Manage cases"
                    onclick={() => (casesFor = benchmark)}><Icon path={iconEdit} /></button
                  >
                  <button
                    class="icon-btn icon-btn-danger"
                    title="Delete benchmark"
                    aria-label="Delete benchmark"
                    onclick={() => handleDelete(benchmark.id)}><Icon path={iconTrash} /></button
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

{#if showNew}
  <DialogShell
    title="New benchmark"
    onClose={() => (showNew = false)}
    dialogClass="benchmark-new-dialog"
  >
    <div class="form-stack">
      <div class="field">
        <label class="field-label" for="benchmark-name">Name</label>
        <input
          id="benchmark-name"
          class="field-input"
          type="text"
          bind:value={newName}
          disabled={creating}
        />
      </div>
      <div class="field">
        <label class="field-label" for="benchmark-description"
          >Description <span class="optional">(optional)</span></label
        >
        <textarea
          id="benchmark-description"
          class="field-input"
          rows={3}
          bind:value={newDescription}
          disabled={creating}></textarea>
      </div>
      <div class="form-actions">
        <button class="btn" onclick={() => (showNew = false)} disabled={creating}>Cancel</button>
        <button
          class="btn btn-primary"
          onclick={handleCreate}
          disabled={creating || !newName.trim()}
        >
          {creating ? 'Creating…' : 'Create benchmark'}
        </button>
      </div>
    </div>
  </DialogShell>
{/if}

{#if casesFor}
  <BenchmarkCasesPanel
    benchmarkId={casesFor.id}
    benchmarkName={casesFor.name}
    onClose={() => (casesFor = null)}
  />
{/if}

{#if runFor}
  <RunLaunchModal
    benchmarkId={runFor.benchmark.id}
    benchmarkName={runFor.benchmark.name}
    cases={runFor.cases}
    onClose={() => (runFor = null)}
  />
{/if}

<style>
  .optional {
    font-weight: 400;
    text-transform: none;
    letter-spacing: 0;
    font-size: 0.75rem;
  }
  :global(.benchmark-new-dialog) {
    max-width: min(520px, 95vw);
  }
</style>
