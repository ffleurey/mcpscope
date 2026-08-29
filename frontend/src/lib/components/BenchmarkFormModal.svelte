<script lang="ts">
  import { untrack } from 'svelte'
  import { createBenchmark, updateBenchmark } from '../benchmarkStore'
  import { toAppError, type AppError } from '../errors'
  import DialogShell from './DialogShell.svelte'
  import InlineAppError from './InlineAppError.svelte'
  import type { Benchmark } from '../backendTypes'

  interface Props {
    /** When set, the dialog edits this benchmark; otherwise it creates a new one. */
    editBenchmark?: Benchmark | null
    onClose: () => void
    /** Called with the created/updated benchmark id once the save succeeds. */
    onSaved: (id: string) => void
  }

  let { editBenchmark = null, onClose, onSaved }: Props = $props()

  // Seed once from the benchmark being edited. The dialog is recreated per open
  // (parent keys it on open state), so capturing initial values is intended.
  const seed = untrack(() => editBenchmark)
  let formName = $state(seed?.name ?? '')
  let formDescription = $state(seed?.description ?? '')
  let saving = $state(false)
  let formError = $state<AppError | null>(null)

  async function handleSave() {
    if (!formName.trim()) return
    saving = true
    formError = null
    try {
      const payload = {
        name: formName.trim(),
        description: formDescription.trim() || null,
      }
      if (editBenchmark) {
        await updateBenchmark(editBenchmark.id, payload)
        onSaved(editBenchmark.id)
      } else {
        const created = await createBenchmark(payload)
        onSaved(created.id)
      }
    } catch (e) {
      formError = toAppError(e)
    } finally {
      saving = false
    }
  }
</script>

<DialogShell
  title={editBenchmark ? 'Edit benchmark' : 'New benchmark'}
  {onClose}
  dialogClass="benchmark-form-dialog"
>
  <div class="form-stack">
    <InlineAppError error={formError} />
    <div class="field">
      <label class="field-label" for="benchmark-form-name">Name</label>
      <input
        id="benchmark-form-name"
        class="field-input"
        type="text"
        bind:value={formName}
        disabled={saving}
      />
    </div>
    <div class="field">
      <label class="field-label" for="benchmark-form-description"
        >Description <span class="optional">(optional)</span></label
      >
      <textarea
        id="benchmark-form-description"
        class="field-input"
        rows={3}
        bind:value={formDescription}
        disabled={saving}></textarea>
    </div>
    <div class="form-actions">
      <button class="btn" onclick={onClose} disabled={saving}>Cancel</button>
      <button class="btn btn-primary" onclick={handleSave} disabled={saving || !formName.trim()}>
        {saving ? 'Saving…' : editBenchmark ? 'Save benchmark' : 'Create benchmark'}
      </button>
    </div>
  </div>
</DialogShell>

<style>
  .optional {
    font-weight: 400;
    text-transform: none;
    letter-spacing: 0;
    font-size: var(--font-label);
  }
  :global(.benchmark-form-dialog) {
    max-width: min(520px, 95vw);
  }
</style>
