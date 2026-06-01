<script lang="ts">
  import type {
    ContextEntry,
    PartRecord,
    RoundRecord,
    StepRecord,
    WorkflowStepTrace,
  } from '../backendTypes'
  import type { StreamingRoundState } from '../traceStreaming'
  import IdBadge from './IdBadge.svelte'
  import SessionCompactionStepBlock from './SessionCompactionStepBlock.svelte'
  import SessionTurnBlock from './SessionTurnBlock.svelte'

  interface Props {
    workflowStep: WorkflowStepTrace
    roundsByTurn: Map<string, RoundRecord[]>
    partsByTurn: Map<string, PartRecord[]>
    roundStreamsByTurn: Map<string, StreamingRoundState[]>
    contextSnapshotsByRound?: Map<string, ContextEntry[]>
    loadedContextLength?: number | null
    mode?: 'chat' | 'inspect'
  }

  const {
    workflowStep,
    roundsByTurn,
    partsByTurn,
    roundStreamsByTurn,
    contextSnapshotsByRound,
    loadedContextLength = null,
    mode = 'chat',
  }: Props = $props()

  const step = $derived(workflowStep.step)

  const STEP_TYPE_LABELS: Record<string, string> = {
    analysis_bootstrap: 'Prepare evidence',
    analysis_tool_call_assessment: 'Assess tool call',
    analysis_tool_group_assessment: 'Assess tool group',
    analysis_turn_summary: 'Summarize turn',
    analysis_final_aggregation: 'Build final report',
  }

  function humanizeStepType(stepTypeKey: string): string {
    return stepTypeKey
      .replace(/^analysis_/, '')
      .replace(/_/g, ' ')
      .trim()
  }

  const label = $derived(STEP_TYPE_LABELS[step.stepTypeKey] ?? humanizeStepType(step.stepTypeKey))
  const toolCallPartId = $derived(
    step.stepTypeKey === 'analysis_tool_call_assessment'
      ? (typeof step.params.tool_call_part_id === 'string' ? step.params.tool_call_part_id : null)
      : null,
  )
  const workUnitId = $derived(
    step.stepTypeKey === 'analysis_tool_group_assessment'
      ? (typeof step.params.work_unit_id === 'string' ? step.params.work_unit_id : null)
      : null,
  )
  const turnId = $derived(
    step.stepTypeKey === 'analysis_turn_summary'
      ? (typeof step.params.turn_id === 'string' ? step.params.turn_id : null)
      : null,
  )
  const detailBadges = $derived.by(() => {
    const details: string[] = []
    if (turnId !== null) details.push(`turn: ${turnId}`)
    if (toolCallPartId !== null) details.push(`tool call: ${toolCallPartId}`)
    if (workUnitId !== null) details.push(`work unit: ${workUnitId}`)
    if (workflowStep.ownedTurns.length > 0) details.push(`${workflowStep.ownedTurns.length} turn${workflowStep.ownedTurns.length === 1 ? '' : 's'}`)
    if (workflowStep.artifacts.length > 0) details.push(`${workflowStep.artifacts.length} artifact${workflowStep.artifacts.length === 1 ? '' : 's'}`)
    return details
  })
  const artifactLabels = $derived(
    workflowStep.artifacts
      .map((artifact) => typeof artifact.metadata.schema_key === 'string' ? artifact.metadata.schema_key : artifact.id)
      .filter((value, index, all) => all.indexOf(value) === index),
  )

  function labelOwnedTurn(index: number): string {
    if (step.stepTypeKey === 'analysis_bootstrap') {
      return 'Bootstrap inspect turn'
    }
    if (step.stepTypeKey === 'analysis_tool_call_assessment') {
      return index === 0 ? 'Evidence turn' : 'Assessment turn'
    }
    if (step.stepTypeKey === 'analysis_tool_group_assessment') {
      return index === 0 ? 'Grouped evidence turn' : 'Grouped assessment turn'
    }
    if (step.stepTypeKey === 'analysis_turn_summary') {
      return 'Summary turn'
    }
    if (step.stepTypeKey === 'analysis_final_aggregation') {
      return 'Final report turn'
    }
    return `Turn ${index + 1}`
  }

  const contextRetirementNotes = $derived.by(() => {
    const notes: string[] = []
    const seen = new Set<string>()

    for (const turn of workflowStep.ownedTurns) {
      const parts = partsByTurn.get(turn.id) ?? []
      const toolCallsExcluded = parts.filter((part) => part.partType === 'tool-call' && part.context.state === 'excluded').length
      const toolResultsExcluded = parts.filter((part) => part.partType === 'tool-result' && part.context.state === 'excluded').length
      const promptsHistorical = parts.filter((part) => part.partType === 'user-message' && part.context.state === 'historical-only').length
      const reasoningExcluded = parts.filter((part) => part.partType === 'assistant-reasoning' && part.context.state === 'excluded').length

      if (toolCallsExcluded > 0 || toolResultsExcluded > 0) {
        const totalEvidenceParts = toolCallsExcluded + toolResultsExcluded
        const note = `${totalEvidenceParts} evidence part${totalEvidenceParts === 1 ? '' : 's'} excluded from active context after this step`
        if (!seen.has(note)) {
          seen.add(note)
          notes.push(note)
        }
      }

      if (promptsHistorical > 0) {
        const note = `${promptsHistorical} prompt${promptsHistorical === 1 ? '' : 's'} retained for inspection only`
        if (!seen.has(note)) {
          seen.add(note)
          notes.push(note)
        }
      }

      if (reasoningExcluded > 0) {
        const note = `${reasoningExcluded} reasoning part${reasoningExcluded === 1 ? '' : 's'} excluded from active context`
        if (!seen.has(note)) {
          seen.add(note)
          notes.push(note)
        }
      }
    }

    return notes
  })
</script>

<section class="analysis-workflow-block">
  <div class="analysis-workflow-meta">
    <div class="analysis-workflow-line">
      <span class="analysis-workflow-label">{label}</span>
      <span class="analysis-workflow-status" class:status-complete={step.status === 'complete'} class:status-error={step.status === 'error'}>{step.status}</span>
      {#each detailBadges as detail (detail)}
        <span class="analysis-workflow-detail">{detail}</span>
      {/each}
    </div>
    <div class="analysis-workflow-actions">
      <IdBadge id={step.id} />
    </div>
  </div>

  <div class="analysis-workflow-content">
    {#if artifactLabels.length > 0}
      <div class="analysis-workflow-artifacts">
        {#each artifactLabels as label (label)}
          <span class="analysis-workflow-artifact">{label}</span>
        {/each}
      </div>
    {/if}

    {#if contextRetirementNotes.length > 0}
      <div class="analysis-workflow-retirement">
        <div class="analysis-workflow-section-title">Context changes</div>
        <div class="analysis-workflow-retirement-list">
          {#each contextRetirementNotes as note (note)}
            <span class="analysis-workflow-retirement-note">{note}</span>
          {/each}
        </div>
      </div>
    {/if}

    {#each workflowStep.ownedTurns as turn, index (turn.id)}
      <div class="analysis-workflow-section">
        <div class="analysis-workflow-section-title">{labelOwnedTurn(index)}</div>
        <SessionTurnBlock
          {turn}
          rounds={roundsByTurn.get(turn.id) ?? []}
          parts={partsByTurn.get(turn.id) ?? []}
          roundStreams={roundStreamsByTurn.get(turn.id) ?? []}
          {mode}
          {contextSnapshotsByRound}
          loadedContextLength={loadedContextLength}
        />
      </div>
    {/each}

    {#each workflowStep.postambleSteps as postamble (postamble.id)}
      <div class="analysis-workflow-section">
        <div class="analysis-workflow-section-title">Regular compaction</div>
        <SessionCompactionStepBlock
          step={postamble}
          parts={[]}
          mode={mode}
        />
      </div>
    {/each}

    {#if workflowStep.ownedTurns.length === 0 && workflowStep.postambleSteps.length === 0}
      <div class="analysis-workflow-empty">
        {#if workflowStep.artifacts.length > 0}
          This step completed deterministically and produced artifacts without a child turn.
        {:else}
          No child turns recorded for this step.
        {/if}
      </div>
    {/if}
  </div>
</section>

<style>
  .analysis-workflow-block {
    margin: 0.6rem 0 0.9rem;
    padding: 0.8rem 0.95rem;
    border: 1px solid var(--border-subtle);
    border-radius: 14px;
    background: color-mix(in srgb, var(--bg-panel) 95%, var(--accent) 5%);
  }

  .analysis-workflow-meta {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem;
    margin-bottom: 0.6rem;
  }

  .analysis-workflow-line {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    align-items: center;
  }

  .analysis-workflow-label {
    font-size: 0.84rem;
    font-weight: 700;
    color: var(--text);
  }

  .analysis-workflow-status,
  .analysis-workflow-detail {
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .analysis-workflow-status.status-complete {
    color: var(--color-success, #4caf50);
  }

  .analysis-workflow-status.status-error {
    color: var(--color-error, #f44336);
  }

  .analysis-workflow-content {
    display: grid;
    gap: 0.45rem;
  }

  .analysis-workflow-section {
    display: grid;
    gap: 0.3rem;
  }

  .analysis-workflow-section-title {
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-muted);
  }

  .analysis-workflow-artifacts {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }

  .analysis-workflow-artifact {
    font-size: 0.72rem;
    color: var(--text-muted);
    background: var(--bg-input);
    border-radius: 999px;
    padding: 0.15rem 0.45rem;
  }

  .analysis-workflow-retirement {
    display: grid;
    gap: 0.25rem;
  }

  .analysis-workflow-retirement-list {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }

  .analysis-workflow-retirement-note {
    font-size: 0.72rem;
    color: var(--text-muted);
    background: color-mix(in srgb, var(--bg-panel) 86%, var(--accent) 14%);
    border-radius: 999px;
    padding: 0.15rem 0.45rem;
  }

  .analysis-workflow-empty {
    font-size: 0.78rem;
    color: var(--text-muted);
  }
</style>