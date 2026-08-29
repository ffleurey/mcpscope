<script lang="ts">
  import { modelConfigs, sessionCreationDefaults } from '../connectionStore'
  import { launchEvaluation } from '../benchmarkStore'
  import { toAppError, type AppError } from '../errors'
  import DialogShell from './DialogShell.svelte'
  import InlineAppError from './InlineAppError.svelte'
  import IdBadge from './IdBadge.svelte'

  interface Props {
    runId: string
    onClose: () => void
  }

  let { runId, onClose }: Props = $props()

  let selectedJudgeId = $state('')
  // 'custom' (default 0.2, mirrors backend DEFAULT_JUDGE_TEMPERATURE) sends an
  // explicit temperature; at exactly 0 a retry of a looping judge can't recover.
  // 'default' sends no temperature so the judge's provider uses its own default.
  let temperatureMode = $state<'default' | 'custom'>('custom')
  let temperatureValue = $state(0.2)
  let launching = $state(false)
  let launchError = $state<AppError | null>(null)
  let hasInitialized = $state(false)

  const selectedConfig = $derived($modelConfigs.find((c) => c.id === selectedJudgeId) ?? null)

  $effect(() => {
    const defaultId = $sessionCreationDefaults?.defaultModelConfigId ?? null
    const hasDefault = defaultId != null && $modelConfigs.some((c) => c.id === defaultId)
    if (!hasInitialized) {
      selectedJudgeId = hasDefault ? defaultId : ($modelConfigs[0]?.id ?? '')
      hasInitialized = true
    }
  })

  async function handleLaunch() {
    if (!selectedJudgeId) return
    launching = true
    launchError = null
    try {
      await launchEvaluation(
        runId,
        selectedJudgeId,
        temperatureMode === 'custom' ? temperatureValue : null,
      )
      onClose()
    } catch (e) {
      launchError = toAppError(e)
    } finally {
      launching = false
    }
  }
</script>

<DialogShell title="Evaluate run" {onClose} dialogClass="eval-launch-dialog">
  <div class="form-stack">
    <p class="target-label">
      Run: <IdBadge id={runId} />
    </p>
    <p class="field-hinttext">
      A judge model scores every session in this run against its case rubric. Use a different model
      than the one under test. You can run multiple passes to compare judges.
    </p>

    <InlineAppError error={launchError} />

    <div class="field">
      <label class="field-label" for="eval-judge-select">Judge model</label>
      {#if $modelConfigs.length === 0}
        <p class="field-hinttext">No model configs — create one in the sidebar first.</p>
      {:else}
        <select
          id="eval-judge-select"
          class="field-input"
          bind:value={selectedJudgeId}
          disabled={launching}
        >
          {#each $modelConfigs as config (config.id)}
            <option value={config.id}
              >{config.name}{$sessionCreationDefaults?.defaultModelConfigId === config.id
                ? ' (default)'
                : ''}</option
            >
          {/each}
        </select>
      {/if}
    </div>

    <div class="field">
      <label class="field-label" for="eval-temp">Temperature</label>
      <div class="temperature-row">
        <select
          id="eval-temp"
          class="field-input"
          bind:value={temperatureMode}
          disabled={launching}
        >
          <option value="default">Provider default</option>
          <option value="custom">Custom…</option>
        </select>
        {#if temperatureMode === 'custom'}
          <input
            class="field-input"
            type="number"
            min="0"
            step="0.1"
            bind:value={temperatureValue}
            disabled={launching}
          />
        {/if}
      </div>
      <p class="field-hinttext">
        Small non-zero (0.2) by default, so retrying a stuck judge can escape. Avoid 0 — a retry
        would reproduce the same result. "Provider default" sends no temperature.
      </p>
    </div>

    {#if selectedConfig}
      <div class="field">
        <span class="field-label">Context size</span>
        <p class="field-hinttext">
          {selectedConfig.contextSize
            ? `${selectedConfig.contextSize.toLocaleString()} tokens`
            : 'model default'} — configured on the model; reload the model to change.
        </p>
      </div>
    {/if}

    <div class="form-actions">
      <button class="btn" onclick={onClose} disabled={launching}>Cancel</button>
      <button
        class="btn btn-primary"
        onclick={handleLaunch}
        disabled={launching || !selectedJudgeId || $modelConfigs.length === 0}
      >
        {launching ? 'Launching…' : 'Launch evaluation'}
      </button>
    </div>
  </div>
</DialogShell>

<style>
  .target-label {
    font-size: var(--font-meta);
    color: var(--text-dim);
    margin: 0;
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  :global(.eval-launch-dialog) {
    max-width: min(480px, 95vw);
  }
  .temperature-row {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }
  .temperature-row select {
    flex: 1;
  }
  .temperature-row input {
    width: 160px;
  }
</style>
