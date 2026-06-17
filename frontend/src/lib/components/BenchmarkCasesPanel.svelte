<script lang="ts">
  import { onMount } from 'svelte'
  import { getBenchmark } from '../api/backendClient'
  import { createCase, updateCase, removeCase } from '../benchmarkStore'
  import { toAppError, type AppError } from '../errors'
  import { iconPlus, iconEdit, iconTrash } from '../design/icons'
  import Icon from './Icon.svelte'
  import DialogShell from './DialogShell.svelte'
  import InlineAppError from './InlineAppError.svelte'
  import { columnResize } from '../actions/columnResize'
  import type { BenchmarkCase } from '../backendTypes'

  interface Props {
    benchmarkId: string
    benchmarkName: string
    onClose: () => void
  }

  let { benchmarkId, benchmarkName, onClose }: Props = $props()

  let cases = $state<BenchmarkCase[]>([])
  let loading = $state(true)
  let panelError = $state<AppError | null>(null)

  // Add/edit form state
  let formOpen = $state(false)
  let editingId = $state<string | null>(null)
  let formName = $state('')
  let formPrompt = $state('')
  let formExpectCalled = $state('')
  let formExpectNotCalled = $state('')
  let saving = $state(false)

  async function reload() {
    try {
      const detail = await getBenchmark(benchmarkId)
      cases = [...detail.cases].sort((a, b) => a.orderIndex - b.orderIndex)
    } catch (e) {
      panelError = toAppError(e)
    } finally {
      loading = false
    }
  }

  onMount(reload)

  function parseTools(text: string): string[] {
    return text
      .split(/[\n,]/)
      .map((t) => t.trim())
      .filter(Boolean)
  }

  function startAdd() {
    editingId = null
    formName = ''
    formPrompt = ''
    formExpectCalled = ''
    formExpectNotCalled = ''
    formOpen = true
  }

  function startEdit(c: BenchmarkCase) {
    editingId = c.id
    formName = c.name ?? ''
    formPrompt = c.prompt
    formExpectCalled = c.expectedToolsCalled.join(', ')
    formExpectNotCalled = c.expectedToolsNotCalled.join(', ')
    formOpen = true
  }

  async function handleSave() {
    if (!formPrompt.trim()) return
    saving = true
    panelError = null
    try {
      const payload = {
        name: formName.trim() || null,
        prompt: formPrompt.trim(),
        expectedToolsCalled: parseTools(formExpectCalled),
        expectedToolsNotCalled: parseTools(formExpectNotCalled),
      }
      if (editingId) {
        await updateCase(editingId, payload)
      } else {
        await createCase(benchmarkId, payload)
      }
      formOpen = false
      await reload()
    } catch (e) {
      panelError = toAppError(e)
    } finally {
      saving = false
    }
  }

  async function handleDelete(caseId: string) {
    panelError = null
    try {
      await removeCase(caseId)
      await reload()
    } catch (e) {
      panelError = toAppError(e)
    }
  }
</script>

<DialogShell title="Cases — {benchmarkName}" {onClose} dialogClass="cases-dialog">
  <div class="cases-panel">
    <div class="panel-header">
      <span class="panel-count">{cases.length} case{cases.length === 1 ? '' : 's'}</span>
      <button class="btn btn-sm" onclick={startAdd}>
        <span class="btn-icon"><Icon path={iconPlus} /></span> Add case
      </button>
    </div>

    <InlineAppError error={panelError} />

    {#if loading}
      <p class="config-empty">Loading cases…</p>
    {:else if cases.length === 0}
      <p class="config-empty">No cases yet. Add one to get started.</p>
    {:else}
      <div class="table-scroll">
        <table class="data-table" use:columnResize>
          <colgroup>
            <col style="width: 10rem" />
            <col style="width: 22rem" />
            <col style="width: 12rem" />
            <col style="width: 12rem" />
            <col style="width: 6rem" />
          </colgroup>
          <thead>
            <tr>
              <th>Name</th>
              <th>Prompt</th>
              <th>Expect called</th>
              <th>Forbid called</th>
              <th class="col-actions">Actions</th>
            </tr>
          </thead>
          <tbody>
            {#each cases as c (c.id)}
              <tr>
                <td title={c.name ?? ''}>{c.name ?? '—'}</td>
                <td title={c.prompt}>{c.prompt}</td>
                <td title={c.expectedToolsCalled.join(', ')}
                  >{c.expectedToolsCalled.join(', ') || '—'}</td
                >
                <td title={c.expectedToolsNotCalled.join(', ')}
                  >{c.expectedToolsNotCalled.join(', ') || '—'}</td
                >
                <td class="col-actions">
                  <span class="row-actions">
                    <button
                      class="icon-btn"
                      title="Edit"
                      aria-label="Edit case"
                      onclick={() => startEdit(c)}><Icon path={iconEdit} /></button
                    >
                    <button
                      class="icon-btn icon-btn-danger"
                      title="Delete"
                      aria-label="Delete case"
                      onclick={() => handleDelete(c.id)}><Icon path={iconTrash} /></button
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

{#if formOpen}
  <DialogShell
    title={editingId ? 'Edit case' : 'Add case'}
    onClose={() => (formOpen = false)}
    dialogClass="case-form-dialog"
  >
    <div class="form-stack">
      <div class="field">
        <label class="field-label" for="case-name"
          >Name <span class="optional">(optional)</span></label
        >
        <input
          id="case-name"
          class="field-input"
          type="text"
          bind:value={formName}
          disabled={saving}
        />
      </div>
      <div class="field">
        <label class="field-label" for="case-prompt">Prompt</label>
        <textarea
          id="case-prompt"
          class="field-input"
          rows={4}
          bind:value={formPrompt}
          disabled={saving}></textarea>
      </div>
      <div class="field">
        <label class="field-label" for="case-expect"
          >Expected tools called <span class="optional">(comma/line separated)</span></label
        >
        <input
          id="case-expect"
          class="field-input"
          type="text"
          bind:value={formExpectCalled}
          disabled={saving}
        />
      </div>
      <div class="field">
        <label class="field-label" for="case-forbid"
          >Forbidden tools <span class="optional">(comma/line separated)</span></label
        >
        <input
          id="case-forbid"
          class="field-input"
          type="text"
          bind:value={formExpectNotCalled}
          disabled={saving}
        />
      </div>
      <div class="form-actions">
        <button class="btn" onclick={() => (formOpen = false)} disabled={saving}>Cancel</button>
        <button
          class="btn btn-primary"
          onclick={handleSave}
          disabled={saving || !formPrompt.trim()}
        >
          {saving ? 'Saving…' : editingId ? 'Save case' : 'Add case'}
        </button>
      </div>
    </div>
  </DialogShell>
{/if}

<style>
  .cases-panel {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }
  .panel-count {
    font-size: 0.8rem;
    color: var(--text-dim);
  }
  .optional {
    font-weight: 400;
    text-transform: none;
    letter-spacing: 0;
    font-size: 0.75rem;
  }
  :global(.cases-dialog) {
    max-width: min(900px, 96vw);
  }
  :global(.case-form-dialog) {
    max-width: min(520px, 95vw);
  }
</style>
