<script lang="ts">
  import type { StepRecord } from '../backendTypes'
  import IdBadge from './IdBadge.svelte'

  interface Props {
    step: StepRecord
    mode?: 'chat' | 'inspect'
  }

  const { step, mode = 'chat' }: Props = $props()

  const STEP_TYPE_LABELS: Record<string, string> = {
    analysis_v2_cursor: 'Analysis cursor',
    analysis_bootstrap: 'Bootstrap',
    analysis_context_mutation: 'Context mutation',
    analysis_tool_call_assessment: 'Tool-call assessment',
    analysis_coverage_validation: 'Coverage validation',
    analysis_final_aggregation: 'Final aggregation',
  }

  const label = $derived(STEP_TYPE_LABELS[step.stepTypeKey] ?? step.stepTypeKey.replace(/_/g, ' '))
  const phase = $derived(
    step.stepTypeKey === 'analysis_v2_cursor'
      ? (typeof step.state.phase === 'string' ? step.state.phase : null)
      : null,
  )
  const assessedPacket = $derived(
    step.stepTypeKey === 'analysis_tool_call_assessment'
      ? (typeof step.params.toolCallId === 'string' ? step.params.toolCallId : null)
      : null,
  )
  const showState = $derived(mode === 'inspect')
  const stateJson = $derived(showState ? JSON.stringify(step.state, null, 2) : null)
</script>

<section class="analysis-step" class:analysis-step--cursor={step.stepTypeKey === 'analysis_v2_cursor'}>
  <div class="analysis-step-meta">
    <div class="analysis-step-line">
      <span class="analysis-step-label">{label}</span>
      <span class="analysis-step-status" class:status-complete={step.status === 'complete'} class:status-error={step.status === 'error'}>{step.status}</span>
      {#if phase !== null}
        <span class="analysis-step-detail">phase: {phase}</span>
      {/if}
      {#if assessedPacket !== null}
        <span class="analysis-step-detail">tool call: {assessedPacket.slice(0, 8)}…</span>
      {/if}
    </div>
    <div class="analysis-step-actions">
      <IdBadge id={step.id} />
    </div>
  </div>

  {#if showState && stateJson}
    <details class="analysis-step-state">
      <summary>State</summary>
      <pre class="analysis-step-json">{stateJson}</pre>
    </details>
  {/if}
</section>

<style>
  .analysis-step {
    margin: 0.4rem 0 0.6rem;
    padding: 0.6rem 0.85rem;
    border: 1px solid var(--border-subtle);
    border-radius: 10px;
    background: color-mix(in srgb, var(--bg-panel) 94%, var(--accent) 6%);
  }

  .analysis-step--cursor {
    background: color-mix(in srgb, var(--bg-panel) 90%, var(--accent) 10%);
    border-style: dashed;
  }

  .analysis-step-meta {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .analysis-step-line {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    align-items: center;
  }

  .analysis-step-label {
    font-size: 0.82rem;
    font-weight: 700;
    color: var(--text);
    text-transform: capitalize;
  }

  .analysis-step-status {
    font-size: 0.74rem;
    color: var(--text-muted);
    background: var(--bg-input);
    border-radius: 4px;
    padding: 0.05em 0.45em;
  }

  .analysis-step-status.status-complete {
    color: var(--color-success, #4caf50);
  }

  .analysis-step-status.status-error {
    color: var(--color-error, #f44336);
  }

  .analysis-step-detail {
    font-size: 0.74rem;
    color: var(--text-muted);
  }

  .analysis-step-state {
    margin-top: 0.5rem;
    font-size: 0.76rem;
  }

  .analysis-step-state summary {
    cursor: pointer;
    color: var(--text-muted);
    user-select: none;
  }

  .analysis-step-json {
    margin: 0.3rem 0 0;
    padding: 0.5rem;
    background: var(--bg-input);
    border-radius: 6px;
    overflow-x: auto;
    font-size: 0.73rem;
    white-space: pre;
    color: var(--text);
  }
</style>
