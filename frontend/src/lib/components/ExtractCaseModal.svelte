<script lang="ts">
  import { benchmarks, createCaseFromSession } from '../benchmarkStore'
  import { toAppError, type AppError } from '../errors'
  import DialogShell from './DialogShell.svelte'
  import InlineAppError from './InlineAppError.svelte'

  interface Props {
    sessionId: string
    sessionTitle: string
    onClose: () => void
  }

  let { sessionId, sessionTitle, onClose }: Props = $props()

  let selectedBenchmarkId = $state('')
  let caseName = $state('')
  let saving = $state(false)
  let extractError = $state<AppError | null>(null)

  $effect(() => {
    if (!selectedBenchmarkId && $benchmarks.length > 0) {
      selectedBenchmarkId = $benchmarks[0]!.id
    }
  })

  async function handleExtract() {
    if (!selectedBenchmarkId) return
    saving = true
    extractError = null
    try {
      await createCaseFromSession(selectedBenchmarkId, {
        sessionId,
        name: caseName.trim() || null,
      })
      onClose()
    } catch (e) {
      extractError = toAppError(e)
    } finally {
      saving = false
    }
  }
</script>

<DialogShell title="Extract as benchmark case" {onClose} dialogClass="extract-case-dialog">
  <div class="form-stack">
    <p class="target-label">
      Session: <span class="target-title">[{sessionId}] {sessionTitle}</span>
    </p>

    <InlineAppError error={extractError} />

    <div class="field">
      <label class="field-label" for="extract-benchmark">Target benchmark</label>
      {#if $benchmarks.length === 0}
        <p class="field-hinttext">No benchmarks yet. Create one in the Benchmarks view first.</p>
      {:else}
        <select
          id="extract-benchmark"
          class="field-input"
          bind:value={selectedBenchmarkId}
          disabled={saving}
        >
          {#each $benchmarks as benchmark (benchmark.id)}
            <option value={benchmark.id}>{benchmark.name}</option>
          {/each}
        </select>
      {/if}
    </div>

    <div class="field">
      <label class="field-label" for="extract-name"
        >Case name <span class="optional">(optional)</span></label
      >
      <input
        id="extract-name"
        class="field-input"
        type="text"
        bind:value={caseName}
        disabled={saving}
      />
    </div>

    <div class="form-actions">
      <button class="btn" onclick={onClose} disabled={saving}>Cancel</button>
      <button
        class="btn btn-primary"
        onclick={handleExtract}
        disabled={saving || !selectedBenchmarkId || $benchmarks.length === 0}
      >
        {saving ? 'Extracting…' : 'Extract case'}
      </button>
    </div>
  </div>
</DialogShell>

<style>
  .target-label {
    font-size: var(--font-meta);
    color: var(--text-dim);
    margin: 0;
  }
  .target-title {
    color: var(--text-bright);
    font-weight: 500;
  }
  .optional {
    font-weight: 400;
    text-transform: none;
    letter-spacing: 0;
    font-size: var(--font-label);
  }
  :global(.extract-case-dialog) {
    max-width: min(480px, 95vw);
  }
</style>
