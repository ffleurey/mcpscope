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
    {#if name}
      <span class="case-name">{name}</span>
    {/if}
    <IdBadge id={caseId} />
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
    {#if expectedToolsCalled.length === 0 && expectedToolsNotCalled.length === 0}
      <span class="tool-empty">none</span>
    {:else}
      <!-- One combined inline list; colour is the signal: green = expected, red = forbidden. -->
      <div class="tool-list">
        {#each expectedToolsCalled as tool (tool)}
          <span class="tool-name expect">{tool}</span>
        {/each}
        {#each expectedToolsNotCalled as tool (tool)}
          <span class="tool-name forbid">{tool}</span>
        {/each}
      </div>
    {/if}
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

  /* One combined inline, wrapping list of tool names; colour carries the signal. */
  .tool-list {
    display: flex;
    flex-wrap: wrap;
    gap: 0.2rem 0.75rem;
  }
  .tool-name {
    font-family: var(--mono);
    font-size: 0.8rem;
  }
  .tool-name.expect {
    color: var(--green-bright);
  }
  .tool-name.forbid {
    color: var(--red-bright);
  }
  .tool-empty {
    font-size: 0.8rem;
    color: var(--text-dim);
    opacity: 0.7;
  }
</style>
