<script lang="ts">
  import { untrack } from 'svelte'
  import { createCase, updateCase } from '../benchmarkStore'
  import { toAppError, type AppError } from '../errors'
  import DialogShell from './DialogShell.svelte'
  import InlineAppError from './InlineAppError.svelte'
  import IdBadge from './IdBadge.svelte'
  import Icon from './Icon.svelte'
  import ToolPickerModal from './ToolPickerModal.svelte'
  import { iconPlus } from '../design/icons'
  import type { BenchmarkCase } from '../backendTypes'

  interface Props {
    benchmarkId: string
    /** When set, the dialog edits this case; otherwise it adds a new one. */
    editCase?: BenchmarkCase | null
    onClose: () => void
    onSaved: () => void
  }

  let { benchmarkId, editCase = null, onClose, onSaved }: Props = $props()

  // Seed the form once from the case being edited. The dialog is recreated per
  // open (parent keys it on open state), so capturing initial values is intended.
  const seed = untrack(() => editCase)
  let formName = $state(seed?.name ?? '')
  let formPrompt = $state(seed?.prompt ?? '')
  let formExpectCalled = $state(seed?.expectedToolsCalled.join(', ') ?? '')
  let formExpectNotCalled = $state(seed?.expectedToolsNotCalled.join(', ') ?? '')
  let saving = $state(false)
  let formError = $state<AppError | null>(null)

  function parseTools(text: string): string[] {
    return text
      .split(/[\n,]/)
      .map((t) => t.trim())
      .filter(Boolean)
  }

  // Tool picker: tracks which field is currently being edited via the picker.
  let pickerField = $state<'expect' | 'forbid' | null>(null)

  function pickerTarget(): string {
    return pickerField === 'expect' ? formExpectCalled : formExpectNotCalled
  }

  function handlePicked(selected: string[]): void {
    const field = pickerField
    if (!field) return
    const current = field === 'expect' ? formExpectCalled : formExpectNotCalled
    const merged = [...new Set([...parseTools(current), ...selected])]
    const value = merged.join(', ')
    if (field === 'expect') formExpectCalled = value
    else formExpectNotCalled = value
  }

  async function handleSave() {
    if (!formPrompt.trim()) return
    saving = true
    formError = null
    try {
      const payload = {
        name: formName.trim() || null,
        prompt: formPrompt.trim(),
        expectedToolsCalled: parseTools(formExpectCalled),
        expectedToolsNotCalled: parseTools(formExpectNotCalled),
      }
      if (editCase) {
        await updateCase(editCase.id, payload)
      } else {
        await createCase(benchmarkId, payload)
      }
      onSaved()
    } catch (e) {
      formError = toAppError(e)
    } finally {
      saving = false
    }
  }
</script>

<DialogShell title={editCase ? 'Edit case' : 'Add case'} {onClose} dialogClass="case-form-dialog">
  <div class="form-stack">
    <InlineAppError error={formError} />

    {#if editCase}
      <div class="field">
        <span class="field-label">Case ID</span>
        <div><IdBadge id={editCase.id} /></div>
      </div>
    {/if}

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
      <div class="tool-field-row">
        <input
          id="case-expect"
          class="field-input"
          type="text"
          bind:value={formExpectCalled}
          disabled={saving}
        />
        <button
          type="button"
          class="icon-btn"
          title="Pick from MCP servers"
          aria-label="Pick from MCP servers"
          onclick={() => (pickerField = 'expect')}
          disabled={saving}
        >
          <Icon path={iconPlus} />
        </button>
      </div>
    </div>
    <div class="field">
      <label class="field-label" for="case-forbid"
        >Forbidden tools <span class="optional">(comma/line separated)</span></label
      >
      <div class="tool-field-row">
        <input
          id="case-forbid"
          class="field-input"
          type="text"
          bind:value={formExpectNotCalled}
          disabled={saving}
        />
        <button
          type="button"
          class="icon-btn"
          title="Pick from MCP servers"
          aria-label="Pick from MCP servers"
          onclick={() => (pickerField = 'forbid')}
          disabled={saving}
        >
          <Icon path={iconPlus} />
        </button>
      </div>
    </div>
    <div class="form-actions">
      <button class="btn" onclick={onClose} disabled={saving}>Cancel</button>
      <button class="btn btn-primary" onclick={handleSave} disabled={saving || !formPrompt.trim()}>
        {saving ? 'Saving…' : editCase ? 'Save case' : 'Add case'}
      </button>
    </div>
  </div>
</DialogShell>

{#if pickerField}
  <ToolPickerModal
    alreadySelected={parseTools(pickerTarget())}
    onConfirm={handlePicked}
    onClose={() => (pickerField = null)}
  />
{/if}

<style>
  .tool-field-row {
    display: flex;
    align-items: center;
    gap: 0.3rem;
  }
  .tool-field-row .field-input {
    flex: 1;
    min-width: 0;
  }
  .optional {
    font-weight: 400;
    text-transform: none;
    letter-spacing: 0;
    font-size: 0.75rem;
  }
  :global(.case-form-dialog) {
    max-width: min(520px, 95vw);
  }
</style>
