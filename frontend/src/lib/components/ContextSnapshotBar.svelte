<script lang="ts">
  import type { ContextEntry } from '../backendTypes'
  import { PART_COLORS, PART_LABELS } from '../design/partColors'

  interface Props {
    entries: ContextEntry[]
    /** Loaded context window size in tokens (determines bar scale). */
    contextSize: number | null
    /** Bar label.  Defaults to "Context". */
    label?: string
    /** Show the legend below the bar.  Default true. */
    showLegend?: boolean
    /** Compact mode: thinner bar, no header label. */
    compact?: boolean
  }

  const {
    entries,
    contextSize,
    label = 'Context',
    showLegend = true,
    compact = false,
  }: Props = $props()

  // ── Grouping ──────────────────────────────────────────────────────────────
  // Consecutive entries that share the same (turnId, roundId) form one group.
  // Turn boundaries get a wider separator; round boundaries get a thin one.

  interface SegGroup {
    turnId: string | null
    roundId: string | null
    entries: ContextEntry[]
  }

  const groups = $derived.by((): SegGroup[] => {
    const result: SegGroup[] = []
    for (const entry of entries) {
      const last = result.at(-1)
      if (last && last.turnId === entry.turnId && last.roundId === entry.roundId) {
        last.entries.push(entry)
      } else {
        result.push({ turnId: entry.turnId, roundId: entry.roundId, entries: [entry] })
      }
    }
    return result
  })

  // ── Turn / round numbering (derived from appearance order) ───────────────
  const turnNumbers = $derived.by((): Map<string, number> => {
    const seen = new Map<string, number>()
    let n = 1
    for (const entry of entries) {
      if (entry.turnId !== null && !seen.has(entry.turnId)) seen.set(entry.turnId, n++)
    }
    return seen
  })

  const roundNumbers = $derived.by((): Map<string, number> => {
    const seen = new Map<string, number>()
    const perTurn = new Map<string | null, number>()
    for (const entry of entries) {
      if (entry.roundId !== null && !seen.has(entry.roundId)) {
        const n = (perTurn.get(entry.turnId) ?? 0) + 1
        perTurn.set(entry.turnId, n)
        seen.set(entry.roundId, n)
      }
    }
    return seen
  })

  // ── Token totals ─────────────────────────────────────────────────────────
  const totalUsed = $derived(entries.reduce((sum, e) => sum + (e.tokens.count ?? 0), 0))
  const ctxSize   = $derived(contextSize ?? 0)
  const pct       = $derived(ctxSize > 0 ? Math.min(100, (totalUsed / ctxSize) * 100) : 0)

  // ── Helpers ───────────────────────────────────────────────────────────────
  function segWidth(entry: ContextEntry): string {
    const tokens = entry.tokens.count ?? 0
    if (ctxSize > 0) return `${(tokens / ctxSize) * 100}%`
    if (totalUsed > 0) return `${(tokens / totalUsed) * 100}%`
    return '0%'
  }

  function groupTooltip(group: SegGroup): string {
    if (group.turnId === null) return 'Prelude'
    const t = turnNumbers.get(group.turnId) ?? '?'
    if (group.roundId === null) return `Turn ${t}`
    const r = roundNumbers.get(group.roundId) ?? '?'
    return `Turn ${t} · Round ${r}`
  }

  function isTurnBoundary(i: number): boolean {
    return i > 0 && groups[i].turnId !== groups[i - 1].turnId
  }

  function fmtEntry(entry: ContextEntry): string {
    const n = (entry.tokens.count ?? 0).toLocaleString()
    const approx = entry.tokens.confidence === 'estimated' || entry.tokens.confidence === 'unknown'
    return approx ? `~${n}` : n
  }

  function fmt(n: number): string { return n.toLocaleString() }

  const legendTypes = $derived.by(() => {
    const seen = new Set<ContextEntry['type']>()
    for (const e of entries) seen.add(e.type)
    return [...seen] as ContextEntry['type'][]
  })
</script>

{#if entries.length > 0 || ctxSize > 0}
  <div class="csb" class:compact>

    {#if !compact}
      <div class="csb-header">
        <span class="csb-label">{label}</span>
        {#if ctxSize > 0}
          <span class="csb-counts">{fmt(totalUsed)} / {fmt(ctxSize)} tokens ({Math.round(pct)}%)</span>
        {:else}
          <span class="csb-counts">{fmt(totalUsed)} tokens</span>
        {/if}
      </div>
    {/if}

    <div class="csb-track" role="img" aria-label="{label} — token breakdown">
      {#each groups as group, i (group.turnId + '|' + group.roundId + '|' + i)}
        {#if i > 0}
          <div
            class="csb-sep"
            class:turn-sep={isTurnBoundary(i)}
            title={groupTooltip(group)}
          ></div>
        {/if}

        {#each group.entries as entry (entry.id)}
          <div
            class="csb-seg"
            style="width: {segWidth(entry)}; background: {PART_COLORS[entry.type]};"
            title="{PART_LABELS[entry.type]}: {fmtEntry(entry)} tokens  ·  {groupTooltip(group)}"
          ></div>
        {/each}
      {/each}
    </div>

    {#if compact}
      <span class="csb-compact-label">{label}</span>
      {#if ctxSize > 0}
        <span class="csb-compact-counts">{fmt(totalUsed)} / {fmt(ctxSize)} ({Math.round(pct)}%)</span>
      {:else}
        <span class="csb-compact-counts">{fmt(totalUsed)} tokens</span>
      {/if}
    {/if}

    {#if showLegend && !compact && legendTypes.length > 0}
      <div class="csb-legend">
        {#each legendTypes as type (type)}
          <span class="csb-legend-item">
            <span class="csb-legend-dot" style="background: {PART_COLORS[type]};"></span>
            {PART_LABELS[type]}
          </span>
        {/each}
      </div>
    {/if}

  </div>
{/if}

<style>
  /* ── Full (non-compact) variant ────────────────────────────────────────── */
  .csb {
    padding: 0.4rem 0.75rem 0.35rem;
    border-top: 1px solid var(--border-subtle);
    background: var(--bg-panel);
    flex-shrink: 0;
  }

  .csb-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 0.3rem;
    font-size: 0.68rem;
  }

  .csb-label {
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .csb-counts {
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }

  /* ── Bar track ────────────────────────────────────────────────────────── */
  .csb-track {
    height: 8px;
    background: color-mix(in srgb, var(--bg) 70%, #000 30%);
    border: 1px solid var(--border-subtle);
    border-radius: 5px;
    overflow: hidden;
    display: flex;
    flex-direction: row;
    align-items: stretch;
  }

  .csb.compact .csb-track {
    height: 5px;
    border-radius: 3px;
  }

  /* ── Segments ─────────────────────────────────────────────────────────── */
  .csb-seg {
    height: 100%;
    min-width: 1px;
    flex-shrink: 0;
  }

  /* ── Separators ───────────────────────────────────────────────────────── */
  .csb-sep {
    flex: 0 0 1px;
    background: color-mix(in srgb, var(--bg) 60%, #000 40%);
    height: 100%;
  }

  .csb-sep.turn-sep {
    flex: 0 0 3px;
    background: color-mix(in srgb, var(--bg) 20%, #000 80%);
  }

  /* ── Compact inline label ─────────────────────────────────────────────── */
  .csb.compact {
    padding: 0.15rem 0;
    border-top: none;
    background: none;
    display: flex;
    align-items: center;
    gap: 0.45rem;
  }

  .csb.compact .csb-track {
    flex: 1;
  }

  .csb-compact-label {
    font-size: 0.65rem;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    white-space: nowrap;
  }

  .csb-compact-counts {
    font-size: 0.65rem;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  /* ── Legend ───────────────────────────────────────────────────────────── */
  .csb-legend {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem 0.9rem;
    margin-top: 0.3rem;
  }

  .csb-legend-item {
    display: flex;
    align-items: center;
    gap: 0.28rem;
    font-size: 0.64rem;
    color: var(--text-muted);
  }

  .csb-legend-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex-shrink: 0;
  }
</style>
