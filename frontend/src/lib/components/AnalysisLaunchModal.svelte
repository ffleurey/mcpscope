<script lang="ts">
  import { onMount, untrack } from 'svelte'
  import { modelConfigs, sessionCreationDefaults } from '../connectionStore'
  import { isLaunchingAnalysis, launchAnalysis, sessionError } from '../sessionStore'
  import { currentView } from '../navStore'
  import { getDefaultAnalysisSystemPrompt, getSessionTrace } from '../api/backendClient'
  import DialogShell from './DialogShell.svelte'
  import Checkbox from './Checkbox.svelte'
  import type {
    AnalysisWorkflowKind,
    PartRecord,
    SessionTraceBundle,
    TurnRecord,
  } from '../backendTypes'

  interface Props {
    targetSessionId: string
    targetSessionTitle: string
    onClose: () => void
  }

  let { targetSessionId, targetSessionTitle, onClose }: Props = $props()

  let selectedModelConfigId = $state('')
  let selectedWorkflowKind = $state<AnalysisWorkflowKind>('full_session_analysis')
  let selectedTurnId = $state('')
  let completedTurns = $state<TurnRecord[]>([])
  let traceBundle = $state<SessionTraceBundle | null>(null)
  let selectedToolNames = $state<string[]>([])
  let onlyFailedToolCalls = $state(false)
  let systemPromptText = $state('')
  let loadingSystemPrompt = $state(true)
  let systemPromptLoadId = 0
  // 'custom' (default 0.5, the historical analysis default) sends an explicit
  // temperature; 'default' omits it so the provider uses its own default.
  let temperatureMode = $state<'default' | 'custom'>('custom')
  let temperatureValue = $state(0.5)
  let maxToolRounds = $state<number | null>(null)
  let evaluationCriteriaText = $state('')
  let loadingTurns = $state(true)
  let hasInitializedModelSelection = $state(false)
  let availableToolNames = $derived.by(() => {
    const trace = traceBundle
    if (!trace || !selectedTurnId) {
      return []
    }

    const selectedTurn = trace.turns.find((turn) => turn.id === selectedTurnId)
    if (!selectedTurn) {
      return []
    }

    const turnIdsInScope = new Set(
      trace.turns
        .filter((turn) => turn.status === 'complete' && turn.turnNumber <= selectedTurn.turnNumber)
        .map((turn) => turn.id),
    )

    return [
      ...new Set(
        trace.parts
          .filter(
            (part): part is PartRecord =>
              part.partType === 'tool-call' && !!part.turnId && turnIdsInScope.has(part.turnId),
          )
          .map((part) =>
            String((part.payload.json as { name?: string } | null)?.name ?? 'unknown'),
          ),
      ),
    ].sort((left, right) => left.localeCompare(right))
  })

  onMount(async () => {
    try {
      const trace = await getSessionTrace(targetSessionId)
      traceBundle = trace
      completedTurns = trace.turns.filter((t) => t.status === 'complete')
      // Default to the last complete turn
      if (completedTurns.length > 0) {
        selectedTurnId = completedTurns[completedTurns.length - 1]!.id
      }
    } catch {
      // ignore — user can type a turn ID manually
    } finally {
      loadingTurns = false
    }
  })

  $effect(() => {
    const workflowKind = selectedWorkflowKind
    const loadId = ++systemPromptLoadId
    loadingSystemPrompt = true

    void getDefaultAnalysisSystemPrompt({ workflow_kind: workflowKind })
      .then(({ systemPrompt }) => {
        if (loadId !== systemPromptLoadId) return
        systemPromptText = systemPrompt
      })
      .catch(() => {
        // ignore — launch can still rely on the backend default when no override is supplied
      })
      .finally(() => {
        if (loadId !== systemPromptLoadId) return
        loadingSystemPrompt = false
      })
  })

  $effect(() => {
    const defaultId = $sessionCreationDefaults?.defaultModelConfigId ?? null
    const hasDefault = defaultId != null && $modelConfigs.some((config) => config.id === defaultId)
    const currentIsValid = $modelConfigs.some((config) => config.id === selectedModelConfigId)

    if (!hasInitializedModelSelection) {
      selectedModelConfigId = hasDefault ? defaultId : ($modelConfigs[0]?.id ?? '')
      hasInitializedModelSelection = true
      return
    }

    if (!currentIsValid) {
      selectedModelConfigId = hasDefault ? defaultId : ($modelConfigs[0]?.id ?? '')
    }
  })

  $effect(() => {
    const currentSelection = untrack(() => selectedToolNames)
    const filteredSelection = currentSelection.filter((toolName) =>
      availableToolNames.includes(toolName),
    )

    if (filteredSelection.length !== currentSelection.length) {
      selectedToolNames = filteredSelection
    }
  })

  function toggleToolName(toolName: string, enabled: boolean) {
    if (enabled) {
      selectedToolNames = [...new Set([...selectedToolNames, toolName])]
      return
    }
    selectedToolNames = selectedToolNames.filter((value) => value !== toolName)
  }

  let temperatureValid = $derived(
    temperatureMode === 'default' || Number.isFinite(temperatureValue),
  )

  async function handleLaunch() {
    if (!selectedModelConfigId || !selectedTurnId.trim() || !temperatureValid) return

    const evaluationCriteria = evaluationCriteriaText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)

    await launchAnalysis({
      targetSessionId,
      targetTurnId: selectedTurnId.trim(),
      workflowKind: selectedWorkflowKind,
      modelConfigId: selectedModelConfigId,
      systemPromptOverride: systemPromptText.trim() || undefined,
      temperature: temperatureMode === 'custom' ? temperatureValue : null,
      maxToolRounds: maxToolRounds && maxToolRounds > 0 ? Math.floor(maxToolRounds) : undefined,
      selectedToolNames: selectedToolNames.length > 0 ? selectedToolNames : undefined,
      onlyFailedToolCalls,
      evaluationCriteria: evaluationCriteria.length > 0 ? evaluationCriteria : undefined,
    })

    if (!$sessionError) {
      currentView.set('chats')
      onClose()
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      void handleLaunch()
    }
  }
</script>

<DialogShell title="Analyze session" {onClose} dialogClass="analysis-launch-dialog">
  <div class="form-stack">
    <p class="target-label">
      Target: <span class="target-title">[{targetSessionId}] {targetSessionTitle}</span>
    </p>

    <div class="field">
      <label class="field-label" for="analysis-workflow-kind">Analysis type</label>
      <select
        id="analysis-workflow-kind"
        class="field-input"
        bind:value={selectedWorkflowKind}
        disabled={$isLaunchingAnalysis}
      >
        <option value="full_session_analysis">Full session analysis</option>
        <option value="fast_session_analysis">Fast session analysis</option>
        <option value="fast_tool_analysis">Fast tool analysis</option>
      </select>
    </div>

    <div class="field">
      <label class="field-label" for="analysis-model-select">Model</label>
      {#if $modelConfigs.length === 0}
        <p class="field-hinttext">
          No model configs configured. Create one in <strong>Model Configs</strong> first.
        </p>
      {:else}
        <select
          id="analysis-model-select"
          class="field-input"
          bind:value={selectedModelConfigId}
          disabled={$isLaunchingAnalysis}
        >
          {#each $modelConfigs as config (config.id)}
            <option value={config.id}>
              {config.name}{$sessionCreationDefaults?.defaultModelConfigId === config.id
                ? ' (default)'
                : ''}
            </option>
          {/each}
        </select>
      {/if}
    </div>

    <div class="field">
      <label class="field-label" for="analysis-temperature"
        >Temperature <span class="optional">(optional)</span></label
      >
      <p class="field-hinttext">
        Defaults to 0.5 for analysis runs. Choose "Provider default" to send no temperature, or set
        a custom value for broader or narrower sampling.
      </p>
      <div class="temperature-row">
        <select
          id="analysis-temperature"
          class="field-input"
          bind:value={temperatureMode}
          disabled={$isLaunchingAnalysis}
        >
          <option value="default">Provider default</option>
          <option value="custom">Custom…</option>
        </select>
        {#if temperatureMode === 'custom'}
          <input
            class="field-input"
            type="number"
            min="0"
            max="2"
            step="0.05"
            bind:value={temperatureValue}
            disabled={$isLaunchingAnalysis}
          />
        {/if}
      </div>
    </div>

    <div class="field">
      <label class="field-label" for="analysis-max-tool-rounds"
        >Max tool rounds <span class="optional">(optional)</span></label
      >
      <p class="field-hinttext">
        Tool-call rounds the judge may use to inspect the target before it must answer (loop guard).
        Leave blank for the default.
      </p>
      <input
        id="analysis-max-tool-rounds"
        class="field-input"
        type="number"
        min="1"
        step="1"
        placeholder="Default"
        bind:value={maxToolRounds}
        disabled={$isLaunchingAnalysis}
      />
    </div>

    <div class="field">
      <label class="field-label" for="analysis-system-prompt">System prompt</label>
      <p class="field-hinttext">
        This is the backend-owned default analysis prompt. You can edit it for this launch before
        starting the analysis session.
      </p>
      {#if loadingSystemPrompt}
        <p class="field-hinttext">Loading default system prompt…</p>
      {/if}
      <textarea
        id="analysis-system-prompt"
        class="field-input"
        rows={12}
        bind:value={systemPromptText}
        disabled={$isLaunchingAnalysis}
        placeholder="Loading the default analysis system prompt..."></textarea>
    </div>

    <div class="field">
      <label class="field-label" for="analysis-turn-select">Analyze through turn</label>
      <p class="field-hinttext">
        Select the turn to analyze up to (inclusive). The analysis will cover all tool calls from
        the beginning of the session.
      </p>
      {#if loadingTurns}
        <p class="field-hinttext">Loading turns…</p>
      {:else if completedTurns.length === 0}
        <input
          id="analysis-turn-select"
          class="field-input"
          type="text"
          placeholder="Turn ID (e.g. ABCD-T1)"
          bind:value={selectedTurnId}
          disabled={$isLaunchingAnalysis}
        />
      {:else}
        <select
          id="analysis-turn-select"
          class="field-input"
          bind:value={selectedTurnId}
          disabled={$isLaunchingAnalysis}
        >
          {#each completedTurns as turn, i (turn.id)}
            <option value={turn.id}>Turn {i + 1} — {turn.id}</option>
          {/each}
        </select>
      {/if}
    </div>

    <div class="field">
      <div class="field-label">Tool scope <span class="optional">(optional)</span></div>
      <p class="field-hinttext">
        Leave all unchecked to analyze every tool call in scope, or select a subset of tools.
      </p>
      {#if availableToolNames.length === 0}
        <p class="field-hinttext">No tool calls found in the currently selected turn range.</p>
      {:else}
        <div class="checkbox-list">
          {#each availableToolNames as toolName (toolName)}
            <Checkbox
              label={toolName}
              checked={selectedToolNames.includes(toolName)}
              disabled={$isLaunchingAnalysis}
              onchange={(c) => toggleToolName(toolName, c)}
            />
          {/each}
        </div>
      {/if}
    </div>

    <div class="field checkbox-field">
      <Checkbox
        label="Only analyze tool calls whose recorded tool result is marked as an error"
        checked={onlyFailedToolCalls}
        disabled={$isLaunchingAnalysis}
        onchange={(c) => (onlyFailedToolCalls = c)}
      />
    </div>

    <div class="field">
      <label class="field-label" for="evaluation-criteria"
        >Evaluation criteria <span class="optional">(optional)</span></label
      >
      <p class="field-hinttext">
        Add one criterion per line when you want this analysis run to emphasize specific checks.
      </p>
      <textarea
        id="evaluation-criteria"
        class="field-input"
        rows={4}
        bind:value={evaluationCriteriaText}
        disabled={$isLaunchingAnalysis}
        placeholder={'Example:\nCheck whether retries were justified\nPrefer direct tool use over guesswork'}
        onkeydown={handleKeydown}></textarea>
    </div>

    {#if $sessionError}
      <div class="error-banner">{$sessionError.message}</div>
    {/if}

    <div class="form-actions">
      <button class="btn" onclick={onClose} disabled={$isLaunchingAnalysis}> Cancel </button>
      <button
        class="btn btn-primary"
        onclick={handleLaunch}
        disabled={$isLaunchingAnalysis ||
          !selectedModelConfigId ||
          !selectedTurnId.trim() ||
          !temperatureValid}
      >
        {$isLaunchingAnalysis ? 'Running analysis…' : 'Launch analysis'}
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

  .checkbox-list {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    max-height: 160px;
    overflow-y: auto;
    padding: 0.25rem 0;
  }

  .checkbox-field {
    gap: 0;
  }

  .error-banner {
    background: color-mix(in srgb, var(--red-bright) 15%, transparent);
    border: 1px solid var(--red-bright);
    border-radius: 4px;
    color: var(--red-bright);
    font-size: 0.82rem;
    padding: 0.5rem 0.75rem;
  }

  :global(.analysis-launch-dialog) {
    max-width: min(560px, 95vw);
  }
</style>
