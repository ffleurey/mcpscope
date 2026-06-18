<script lang="ts">
  import type { Snippet } from 'svelte'
  import IdBadge from './IdBadge.svelte'
  import type { BenchmarkCase, BenchmarkRunCaseSnapshot } from '../backendTypes'

  interface Props {
    /**
     * A live benchmark case or a run case-snapshot. Both carry an id/name/prompt
     * and expected/forbidden tool lists; the run snapshot exposes its id as
     * `sourceCaseId`, which is normalised below.
     */
    case: BenchmarkCase | BenchmarkRunCaseSnapshot
    /** Optional trailing actions rendered in the card header (e.g. edit/delete). */
    actions?: Snippet
  }

  let { case: caseData, actions }: Props = $props()

  // Normalise the two accepted shapes. A run snapshot has `sourceCaseId`; a live
  // case has `id`.
  const caseId = $derived('id' in caseData ? caseData.id : caseData.sourceCaseId)
  const name = $derived(caseData.name ?? null)
  const prompt = $derived(caseData.prompt)
  const expectedToolsCalled = $derived(caseData.expectedToolsCalled ?? [])
  const expectedToolsNotCalled = $derived(caseData.expectedToolsNotCalled ?? [])
</script>

<article class="case-card">
  <header class="card-header">
    <IdBadge id={caseId} />
    {#if name}
      <span class="case-name">{name}</span>
    {/if}
    {#if actions}
      <span class="card-actions">{@render actions()}</span>
    {/if}
  </header>

  <section class="card-section">
    <span class="section-label">Prompt</span>
    <p class="prompt-text">{prompt}</p>
  </section>

  <section class="card-section">
    <span class="section-label">Tools</span>
    <div class="tool-groups">
      <div class="tool-group">
        <span class="tool-group-label">Expected</span>
        {#if expectedToolsCalled.length > 0}
          <div class="chips">
            {#each expectedToolsCalled as tool (tool)}
              <span class="token-pill tool-chip expect">{tool}</span>
            {/each}
          </div>
        {:else}
          <span class="tool-empty">none</span>
        {/if}
      </div>
      <div class="tool-group">
        <span class="tool-group-label">Forbidden</span>
        {#if expectedToolsNotCalled.length > 0}
          <div class="chips">
            {#each expectedToolsNotCalled as tool (tool)}
              <span class="token-pill tool-chip forbid">{tool}</span>
            {/each}
          </div>
        {:else}
          <span class="tool-empty">none</span>
        {/if}
      </div>
    </div>
  </section>
</article>

<style>
  .case-card {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0.75rem;
  }

  .card-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .case-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-bright);
    font-weight: 600;
    font-size: 0.9rem;
  }
  .card-actions {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 0.1rem;
    flex-shrink: 0;
  }

  .card-section {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .section-label {
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-dim);
  }

  .prompt-text {
    margin: 0;
    font-size: 0.85rem;
    line-height: 1.45;
    color: var(--text-bright);
    white-space: pre-wrap;
    word-break: break-word;
  }

  .tool-groups {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem 1.5rem;
  }
  .tool-group {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    min-width: 0;
  }
  .tool-group-label {
    font-size: 0.72rem;
    color: var(--text-dim);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
  }
  .tool-chip {
    font-family: var(--mono);
  }
  .tool-chip.expect {
    border-color: color-mix(in srgb, var(--green-bright) 45%, var(--border));
    color: var(--green-bright);
  }
  .tool-chip.forbid {
    border-color: color-mix(in srgb, var(--red-bright) 45%, var(--border));
    color: var(--red-bright);
  }
  .tool-empty {
    font-size: 0.8rem;
    color: var(--text-dim);
    opacity: 0.7;
  }
</style>
