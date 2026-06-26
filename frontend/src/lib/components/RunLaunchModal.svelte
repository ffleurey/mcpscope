<script lang="ts">
  import { modelConfigs, mcpProfiles, sessionCreationDefaults } from '../connectionStore'
  import { launchRun, selectRun } from '../benchmarkStore'
  import { toAppError, type AppError } from '../errors'
  import DialogShell from './DialogShell.svelte'
  import Checkbox from './Checkbox.svelte'
  import InlineAppError from './InlineAppError.svelte'
  import type { BenchmarkCase } from '../backendTypes'

  interface Props {
    benchmarkId: string
    benchmarkName: string
    cases: BenchmarkCase[]
    onClose: () => void
  }

  let { benchmarkId, benchmarkName, cases, onClose }: Props = $props()

  let selectedConfigId = $state('')
  let selectedMcpProfileIds = $state<string[]>([])
  let selectedCaseIds = $state<string[]>([])
  let repetitions = $state(1)
  let maxToolRounds = $state<number | null>(null)
  let launching = $state(false)
  let launchError = $state<AppError | null>(null)
  let hasInitializedModel = $state(false)
  let hasInitializedMcp = $state(false)
  let hasInitializedCases = $state(false)

  $effect(() => {
    if (!hasInitializedCases) {
      selectedCaseIds = cases.map((c) => c.id)
      hasInitializedCases = true
    }
  })

  $effect(() => {
    const defaultId = $sessionCreationDefaults?.defaultModelConfigId ?? null
    const hasDefault = defaultId != null && $modelConfigs.some((c) => c.id === defaultId)
    if (!hasInitializedModel) {
      selectedConfigId = hasDefault ? defaultId : ($modelConfigs[0]?.id ?? '')
      hasInitializedModel = true
    }
  })

  $effect(() => {
    if (!hasInitializedMcp) {
      selectedMcpProfileIds = $mcpProfiles.filter((p) => p.defaultEnabled).map((p) => p.id)
      hasInitializedMcp = true
    }
  })

  function toggleMcp(id: string) {
    selectedMcpProfileIds = selectedMcpProfileIds.includes(id)
      ? selectedMcpProfileIds.filter((i) => i !== id)
      : [...selectedMcpProfileIds, id]
  }

  function toggleCase(id: string) {
    selectedCaseIds = selectedCaseIds.includes(id)
      ? selectedCaseIds.filter((i) => i !== id)
      : [...selectedCaseIds, id]
  }

  function caseLabel(c: BenchmarkCase): string {
    return c.name?.trim() || c.prompt
  }

  async function handleLaunch() {
    if (selectedCaseIds.length === 0 || !selectedConfigId) return
    launching = true
    launchError = null
    try {
      const run = await launchRun(benchmarkId, {
        caseIds: selectedCaseIds,
        repetitions: Math.max(1, Math.floor(repetitions || 1)),
        modelConfigId: selectedConfigId || undefined,
        mcpProfileIds: selectedMcpProfileIds,
        maxToolRounds: maxToolRounds && maxToolRounds > 0 ? Math.floor(maxToolRounds) : undefined,
      })
      onClose()
      await selectRun(run.id)
    } catch (e) {
      launchError = toAppError(e)
    } finally {
      launching = false
    }
  }
</script>

<DialogShell title="Run benchmark" {onClose} dialogClass="run-launch-dialog">
  <div class="form-stack">
    <p class="target-label">
      Benchmark: <span class="target-title">{benchmarkName}</span>
    </p>

    <InlineAppError error={launchError} />

    <div class="field">
      <label class="field-label" for="run-model-select">Model</label>
      {#if $modelConfigs.length === 0}
        <p class="field-hinttext">No model configs — create one in the sidebar first.</p>
      {:else}
        <select
          id="run-model-select"
          class="field-input"
          bind:value={selectedConfigId}
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
      <span class="field-label">MCP servers <span class="optional">(optional)</span></span>
      {#if $mcpProfiles.length === 0}
        <p class="field-hinttext">No MCP server profiles.</p>
      {:else}
        <div class="checkbox-list">
          {#each $mcpProfiles as profile (profile.id)}
            <Checkbox
              label={profile.name}
              hint={profile.defaultEnabled ? '(default)' : ''}
              checked={selectedMcpProfileIds.includes(profile.id)}
              disabled={launching}
              onchange={() => toggleMcp(profile.id)}
            />
          {/each}
        </div>
      {/if}
    </div>

    <div class="field">
      <span class="field-label">Cases</span>
      {#if cases.length === 0}
        <p class="field-hinttext">This benchmark has no cases. Add a case first.</p>
      {:else}
        <div class="checkbox-list">
          {#each cases as c (c.id)}
            <Checkbox
              label={caseLabel(c)}
              checked={selectedCaseIds.includes(c.id)}
              disabled={launching}
              onchange={() => toggleCase(c.id)}
            />
          {/each}
        </div>
      {/if}
    </div>

    <div class="field">
      <label class="field-label" for="run-repetitions">Repetitions</label>
      <input
        id="run-repetitions"
        class="field-input"
        type="number"
        min="1"
        step="1"
        bind:value={repetitions}
        disabled={launching}
      />
    </div>

    <div class="field">
      <label class="field-label" for="run-max-tool-rounds"
        >Max tool rounds <span class="optional">(optional)</span></label
      >
      <p class="field-hinttext">
        Tool-call rounds per turn before a test session fails (loop guard). Applies to every session
        in the run. Leave blank for the default.
      </p>
      <input
        id="run-max-tool-rounds"
        class="field-input"
        type="number"
        min="1"
        step="1"
        placeholder="Default"
        bind:value={maxToolRounds}
        disabled={launching}
      />
    </div>

    <div class="form-actions">
      <button class="btn" onclick={onClose} disabled={launching}>Cancel</button>
      <button
        class="btn btn-primary"
        onclick={handleLaunch}
        disabled={launching ||
          !selectedConfigId ||
          selectedCaseIds.length === 0 ||
          $modelConfigs.length === 0}
      >
        {launching ? 'Launching…' : 'Launch run'}
      </button>
    </div>
  </div>
</DialogShell>

<style>
  .target-label {
    font-size: 0.8rem;
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
    font-size: 0.75rem;
  }
  .checkbox-list {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    max-height: 200px;
    overflow-y: auto;
    padding: 0.25rem 0;
  }
  :global(.run-launch-dialog) {
    max-width: min(560px, 95vw);
  }
</style>
