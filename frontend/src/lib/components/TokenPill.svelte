<script lang="ts">
  // Token-count metadata pill — the one way a token count renders in the
  // transcript. Wraps the global .pill primitive; renders nothing for a
  // null count.
  import { fmtTokens } from '../format'

  interface Props {
    count: number | null
    /** Prefix the count with ~ (estimated rather than provider-reported). */
    estimated?: boolean
    /** Push the pill to the end of a flex/grid row (.pill-end). */
    end?: boolean
    /** Pill sits on a --bg-raised parent (bubble, open disclosure row). */
    onRaised?: boolean
    /** Abbreviate the unit to `tk` (dense rows like round headers). */
    short?: boolean
  }

  const { count, estimated = false, end = false, onRaised = false, short = false }: Props = $props()
</script>

{#if count !== null}
  <span class="pill mono amber" class:pill-end={end} class:on-raised={onRaised}
    >{fmtTokens(count, estimated, short ? 'tk' : 'tokens')}</span
  >
{/if}
