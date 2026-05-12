<script lang="ts">
  import type { ContextEntry, PartRecord } from '../backendTypes'

  interface Props {
    entries: ContextEntry[]
    loadedContextLength: number | null
  }

  const { entries, loadedContextLength }: Props = $props()

  // Map segment type to its CSS variable name
  const segmentColors: Record<ContextEntry['type'], string> = {
    'system-prompt': 'var(--token-system-prompt)',
    'mcp-instructions': 'var(--token-system-prompt)',
    'tool-definitions': 'var(--token-tool-definitions)',
    'user-message': 'var(--token-user)',
    'assistant-reasoning': 'var(--token-reasoning)',
    'assistant-content': 'var(--token-content)',
    'tool-call': 'var(--token-tool-call)',
    'tool-result': 'var(--token-tool-response)',
    'diagnostic-note': 'var(--text-muted)',
  }

  const segmentLabels: Record<PartRecord['partType'], string> = {
    'system-prompt': 'System prompt',
    'mcp-instructions': 'MCP instructions',
    'tool-definitions': 'Tool definitions',
    'user-message': 'User message',
    'assistant-reasoning': 'Reasoning',
    'assistant-content': 'Assistant response',
    'tool-call': 'Tool call',
    'tool-result': 'Tool result',
    'diagnostic-note': 'Diagnostic',
  }

  let totalUsed = $derived(entries.reduce((sum, entry) => sum + (entry.tokens.count ?? 0), 0))
  let ctxSize = $derived(loadedContextLength ?? 0)
  let pct = $derived(ctxSize > 0 ? Math.min(100, (totalUsed / ctxSize) * 100) : 0)
  let totalKnown = $derived(entries.reduce((sum, entry) => sum + (entry.tokens.count ?? 0), 0))

  let legendTypes = $derived.by(() => {
    const seen = new Set<ContextEntry['type']>()
    for (const entry of entries) seen.add(entry.type)
    return [...seen] as ContextEntry['type'][]
  })

  function fmt(n: number) { return n.toLocaleString() }
  function fmtEntry(entry: ContextEntry): string {
    const n = fmt(entry.tokens.count ?? 0)
    const approx = entry.tokens.confidence === 'estimated' || entry.tokens.confidence === 'unknown'
    return approx ? `~${n} tokens` : `${n} tokens`
  }
</script>

{#if ctxSize > 0 || entries.length > 0}
  <div class="context-bar-wrapper">
    <div class="bar-header">
      <span class="bar-label">Context</span>
      {#if ctxSize > 0}
        <span class="bar-counts">{fmt(totalUsed)} / {fmt(ctxSize)} ({Math.round(pct)}%)</span>
      {:else}
        <span class="bar-counts">{fmt(totalUsed)} tokens</span>
      {/if}
    </div>

    <div class="bar-track" title="Context usage by token type">
      {#if ctxSize > 0}
        {#each entries as entry (entry.id)}
          <div
            class="bar-segment"
            style="width: {((entry.tokens.count ?? 0) / ctxSize) * 100}%; background: {segmentColors[entry.type]};"
            title="{segmentLabels[entry.type]}: {fmtEntry(entry)}"
          ></div>
        {/each}
      {:else if entries.length > 0}
        {#each entries as entry (entry.id)}
          <div
            class="bar-segment"
            style="width: {100 / Math.max(entries.length, totalKnown > 0 ? entries.length : 1)}%; background: {segmentColors[entry.type]};"
            title="{segmentLabels[entry.type]}: {fmtEntry(entry)}"
          ></div>
        {/each}
      {/if}
    </div>

    {#if legendTypes.length > 0}
      <div class="bar-legend">
        {#each legendTypes as type (type)}
          <span class="legend-item">
            <span class="legend-dot" style="background: {segmentColors[type]};"></span>
            {segmentLabels[type]}
          </span>
        {/each}
      </div>
    {/if}
  </div>
{/if}

<style>
  .context-bar-wrapper {
    padding: 0.4rem 0.75rem 0.3rem;
    border-top: 1px solid var(--border-subtle);
    background: var(--bg-panel);
    flex-shrink: 0;
  }

  .bar-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 0.25rem;
    font-size: 0.68rem;
  }

  .bar-label {
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .bar-counts {
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }

  .bar-track {
    height: 8px;
    background: var(--bg);
    border: 1px solid var(--border-subtle);
    border-radius: 4px;
    overflow: hidden;
    display: flex;
    flex-direction: row;
  }

  .bar-segment {
    height: 100%;
    min-width: 1px;
    flex-shrink: 0;
  }

  .bar-legend {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem 1rem;
    margin-top: 0.3rem;
  }

  .legend-item {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.65rem;
    color: var(--text-muted);
  }

  .legend-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }
</style>
