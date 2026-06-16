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
    /**
     * Initial display mode (non-compact only).
     *  - `full`: bar width represents the full context window; unused space shown as dark track.
     *  - `breakdown`: bar fills 100% showing only the used token breakdown.
     * Defaults to `full` when contextSize is provided, otherwise `breakdown`.
     */
    defaultMode?: 'full' | 'breakdown'
    /**
     * If provided, enables a `turn` display mode that shows only entries
     * belonging to this turn. Compact label becomes clickable to cycle modes.
     */
    turnId?: string | null
  }

  const {
    entries,
    contextSize,
    label = 'Context',
    showLegend = true,
    compact = false,
    defaultMode,
    turnId = null,
  }: Props = $props()

  type DisplayMode = 'full' | 'breakdown' | 'turn'
  const initialMode = $derived(defaultMode ?? (contextSize != null ? 'full' : 'breakdown'))
  let displayMode = $state<DisplayMode>('breakdown')
  $effect(() => {
    displayMode = initialMode
  })

  /** Entries for the current display mode (filtered for 'turn' mode). */
  const activeEntries = $derived(
    displayMode === 'turn' && turnId != null ? entries.filter((e) => e.turnId === turnId) : entries,
  )

  /** Cycle compact label through: breakdown → full (if contextSize) → turn (if turnId) → breakdown */
  function cycleMode() {
    if (displayMode === 'breakdown') {
      displayMode = contextSize != null ? 'full' : turnId != null ? 'turn' : 'breakdown'
    } else if (displayMode === 'full') {
      displayMode = turnId != null ? 'turn' : 'breakdown'
    } else {
      displayMode = 'breakdown'
    }
  }

  function modeCycleLabel(): string {
    if (displayMode === 'turn') return `${label} (turn)`
    if (displayMode === 'full') return `${label} (full)`
    return label
  }

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
    for (const entry of activeEntries) {
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
  const totalUsed = $derived(activeEntries.reduce((sum, e) => sum + (e.tokens.count ?? 0), 0))
  const ctxSize = $derived(contextSize ?? 0)
  const pct = $derived(ctxSize > 0 ? Math.min(100, (totalUsed / ctxSize) * 100) : 0)

  // ── Helpers ───────────────────────────────────────────────────────────────
  function segWidth(entry: ContextEntry): string {
    const tokens = entry.tokens.count ?? 0
    const denom = displayMode === 'full' && ctxSize > 0 ? ctxSize : totalUsed
    if (denom > 0) return `${(tokens / denom) * 100}%`
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

  function fmt(n: number): string {
    return n.toLocaleString()
  }

  const legendTypes = $derived.by(() => {
    const seen = new Set<ContextEntry['type']>()
    for (const e of activeEntries) seen.add(e.type)
    return [...seen] as ContextEntry['type'][]
  })
</script>

{#if entries.length > 0 || ctxSize > 0}
  <div class="csb" class:compact>
    {#if !compact}
      <div class="csb-header">
        <span class="csb-label">{label}</span>
        {#if ctxSize > 0}
          <span class="csb-counts"
            >{fmt(totalUsed)} / {fmt(ctxSize)} tokens ({Math.round(pct)}%)</span
          >
          <button
            class="csb-mode-btn"
            title={displayMode === 'full'
              ? 'Switch to breakdown view'
              : 'Switch to full context view'}
            onclick={() => {
              displayMode = displayMode === 'full' ? 'breakdown' : 'full'
            }}>{displayMode === 'full' ? '⊟' : '⊠'}</button
          >
        {:else}
          <span class="csb-counts">{fmt(totalUsed)} tokens</span>
        {/if}
      </div>
    {/if}

    <div class="csb-track" role="img" aria-label="{label} — token breakdown">
      {#each groups as group, i (group.turnId + '|' + group.roundId + '|' + i)}
        {#if i > 0}
          <div class="csb-sep" class:turn-sep={isTurnBoundary(i)} title={groupTooltip(group)}></div>
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
      <button class="csb-compact-label" onclick={cycleMode} title="Click to cycle view mode">
        {modeCycleLabel()}
      </button>
      {#if displayMode === 'full' && ctxSize > 0}
        <span class="csb-compact-counts"
          >{fmt(totalUsed)} / {fmt(ctxSize)} ({Math.round(pct)}%)</span
        >
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
    border-top: 1px solid var(--border);
    background: var(--bg-surface);
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
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .csb-counts {
    color: var(--text-dim);
    font-variant-numeric: tabular-nums;
    flex: 1;
    text-align: right;
  }

  .csb-mode-btn {
    background: none;
    border: 1px solid var(--border);
    border-radius: 3px;
    color: var(--text-dim);
    cursor: pointer;
    font-size: 0.7rem;
    padding: 0 0.28rem;
    line-height: 1.4;
    margin-left: 0.35rem;
  }

  .csb-mode-btn:hover {
    color: var(--text-bright);
    border-color: var(--border);
  }

  /* ── Bar track ────────────────────────────────────────────────────────── */
  .csb-track {
    height: 8px;
    background: color-mix(in srgb, var(--bg-base) 70%, #000 30%);
    border: 1px solid var(--border);
    border-radius: 4px;
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
    background: color-mix(in srgb, var(--bg-base) 60%, #000 40%);
    height: 100%;
  }

  .csb-sep.turn-sep {
    flex: 0 0 3px;
    background: color-mix(in srgb, var(--bg-base) 20%, #000 80%);
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
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    white-space: nowrap;
    /* button reset */
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
  }

  .csb-compact-label:hover {
    color: var(--text-bright);
  }

  .csb-compact-counts {
    font-size: 0.65rem;
    color: var(--text-dim);
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
    color: var(--text-dim);
  }

  .csb-legend-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex-shrink: 0;
  }
</style>
