<script lang="ts">
  import {
    activeBenchmarkDetail,
    clearBenchmarkSelection,
    refreshActiveBenchmarkDetail,
    removeBenchmark,
    removeCase,
    selectRun,
  } from '../benchmarkStore'
  import { toAppError, type AppError } from '../errors'
  import { iconPlus, iconEdit, iconTrash, iconRun } from '../design/icons'
  import Icon from './Icon.svelte'
  import IdBadge from './IdBadge.svelte'
  import InlineAppError from './InlineAppError.svelte'
  import CaseFormModal from './CaseFormModal.svelte'
  import BenchmarkCaseCard from './BenchmarkCaseCard.svelte'
  import BenchmarkFormModal from './BenchmarkFormModal.svelte'
  import RunLaunchModal from './RunLaunchModal.svelte'
  import { columnResize } from '../actions/columnResize'
  import type { BenchmarkRun, BenchmarkRunStatus } from '../backendTypes'

  const detail = $derived($activeBenchmarkDetail)
  const benchmark = $derived(detail?.benchmark ?? null)
  const cases = $derived(
    detail ? [...detail.cases].sort((a, b) => a.orderIndex - b.orderIndex) : [],
  )
  const runs = $derived(detail ? [...detail.runs].sort((a, b) => b.createdAt - a.createdAt) : [])

  let viewError = $state<AppError | null>(null)

  // Case add/edit dialog. `cases` is the sorted derived list element type.
  let caseDialog = $state<{ editCase: (typeof cases)[number] | null } | null>(null)

  // Run-launch dialog
  let showRun = $state(false)

  // Benchmark edit dialog
  let editing = $state(false)

  async function onBenchmarkSaved() {
    editing = false
    await refreshActiveBenchmarkDetail()
  }

  async function handleDeleteBenchmark() {
    if (!benchmark) return
    viewError = null
    try {
      await removeBenchmark(benchmark.id)
      clearBenchmarkSelection()
    } catch (e) {
      viewError = toAppError(e)
    }
  }

  async function handleDeleteCase(caseId: string) {
    viewError = null
    try {
      await removeCase(caseId)
      await refreshActiveBenchmarkDetail()
    } catch (e) {
      viewError = toAppError(e)
    }
  }

  async function onCaseSaved() {
    caseDialog = null
    await refreshActiveBenchmarkDetail()
  }

  function dotClass(status: BenchmarkRunStatus): string {
    if (status === 'running' || status === 'pending') return 'running'
    if (status === 'error') return 'error'
    return 'idle'
  }

  function statusPillClass(status: BenchmarkRunStatus): string {
    if (status === 'complete') return 'success'
    if (status === 'error') return 'error'
    if (status === 'running') return 'soft'
    return 'dim'
  }

  function formatDate(ts: number): string {
    const d = new Date(ts)
    const dd = String(d.getDate()).padStart(2, '0')
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const HH = String(d.getHours()).padStart(2, '0')
    const MM = String(d.getMinutes()).padStart(2, '0')
    return `${dd}/${mm} ${HH}:${MM}`
  }

  async function openRun(run: BenchmarkRun) {
    await selectRun(run.id)
  }
</script>

{#if !detail || !benchmark}
  <div class="detail-loading">Loading benchmark…</div>
{:else}
  <div class="config-view">
    <div class="config-view-header">
      <div class="title-block">
        <div class="title-line">
          <h2>{benchmark.name}</h2>
          <IdBadge id={benchmark.id} />
        </div>
        {#if benchmark.description}
          <p class="benchmark-description">{benchmark.description}</p>
        {/if}
      </div>
      <div class="header-actions">
        <button
          class="btn btn-primary"
          onclick={() => (showRun = true)}
          disabled={cases.length === 0}
        >
          <span class="btn-icon"><Icon path={iconRun} /></span> Run
        </button>
        <button class="btn" onclick={() => (editing = true)}>
          <span class="btn-icon"><Icon path={iconEdit} /></span> Edit
        </button>
        <button
          class="icon-btn icon-btn-danger"
          title="Delete benchmark"
          aria-label="Delete benchmark"
          onclick={handleDeleteBenchmark}><Icon path={iconTrash} /></button
        >
      </div>
    </div>

    <InlineAppError error={viewError} />

    <section class="detail-section">
      <div class="section-title-row">
        <h3 class="section-title">Cases</h3>
        <button class="btn btn-sm" onclick={() => (caseDialog = { editCase: null })}>
          <span class="btn-icon"><Icon path={iconPlus} /></span> Add case
        </button>
      </div>
      {#if cases.length === 0}
        <p class="config-empty">No cases yet. Add one to get started.</p>
      {:else}
        <div class="case-list">
          {#each cases as c (c.id)}
            <BenchmarkCaseCard case={c}>
              {#snippet actions()}
                <button
                  class="icon-btn"
                  title="Edit case"
                  aria-label="Edit case"
                  onclick={() => (caseDialog = { editCase: c })}><Icon path={iconEdit} /></button
                >
                <button
                  class="icon-btn icon-btn-danger"
                  title="Delete case"
                  aria-label="Delete case"
                  onclick={() => handleDeleteCase(c.id)}><Icon path={iconTrash} /></button
                >
              {/snippet}
            </BenchmarkCaseCard>
          {/each}
        </div>
      {/if}
    </section>

    <section class="detail-section">
      <h3 class="section-title">Runs of this benchmark</h3>
      {#if runs.length === 0}
        <p class="config-empty">No runs yet.</p>
      {:else}
        <div class="table-scroll">
          <table class="data-table" use:columnResize>
            <colgroup>
              <col class="col-flex" />
              <col style="width: 7rem" />
              <col style="width: 7rem" />
              <col style="width: 7rem" />
              <col style="width: 11rem" />
            </colgroup>
            <thead>
              <tr>
                <th>Run</th>
                <th>Status</th>
                <th class="col-num">Repetitions</th>
                <th class="col-num">Cases</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {#each runs as run (run.id)}
                <tr class="run-row" onclick={() => openRun(run)}>
                  <td><IdBadge id={run.id} /></td>
                  <td
                    ><span class="status-dot {dotClass(run.status)}"></span>
                    <span class="status-pill {statusPillClass(run.status)}">{run.status}</span></td
                  >
                  <td class="col-num">{run.repetitions}</td>
                  <td class="col-num">{run.cases.length}</td>
                  <td title={formatDate(run.createdAt)}>{formatDate(run.createdAt)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </section>
  </div>
{/if}

{#if caseDialog}
  <CaseFormModal
    benchmarkId={benchmark!.id}
    editCase={caseDialog.editCase}
    onClose={() => (caseDialog = null)}
    onSaved={onCaseSaved}
  />
{/if}

{#if showRun && benchmark}
  <RunLaunchModal
    benchmarkId={benchmark.id}
    benchmarkName={benchmark.name}
    {cases}
    onClose={() => (showRun = false)}
  />
{/if}

{#if editing && benchmark}
  <BenchmarkFormModal
    editBenchmark={benchmark}
    onClose={() => (editing = false)}
    onSaved={onBenchmarkSaved}
  />
{/if}

<style>
  .detail-loading {
    padding: 2rem;
    color: var(--text-dim);
    font-size: 0.9rem;
  }
  .config-view {
    overflow-y: auto;
    height: 100%;
  }
  .title-block {
    min-width: 0;
  }
  .title-line {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
  }
  .config-view-header h2 {
    margin: 0;
  }
  .benchmark-description {
    margin: 0.3rem 0 0;
    font-size: 0.85rem;
    color: var(--text-dim);
  }
  .detail-section {
    margin-bottom: 1.5rem;
  }
  .case-list {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .section-title-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    margin-bottom: 0.6rem;
  }
  .section-title {
    font-size: 0.95rem;
    font-weight: 600;
    margin: 0;
  }
  .run-row {
    cursor: pointer;
  }
  .run-row .status-dot {
    margin-right: 0.4rem;
    vertical-align: middle;
  }
</style>
