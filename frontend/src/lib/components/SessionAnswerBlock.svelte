<script lang="ts">
  // Assistant answer in the transcript. JSON answers keep the highlighted
  // source form; prose renders as real markdown with a hover toggle back to
  // the raw source. Metadata (token pill, part IdBadge) rides along as the
  // quiet second layer.
  import Icon from './Icon.svelte'
  import IdBadge from './IdBadge.svelte'
  import TokenPill from './TokenPill.svelte'
  import { iconCode, iconView } from '../design/icons'
  import { highlightMarkdown } from '../markdownHighlight'
  import { renderSessionAnswer } from '../textHighlight'

  interface Props {
    text: string
    /** Part id for the hover-revealed IdBadge; null hides the badge. */
    partId?: string | null
    tokens?: number | null
    estimated?: boolean
  }

  const { text, partId = null, tokens = null, estimated = false }: Props = $props()

  let showRaw = $state(false)
  const answer = $derived(renderSessionAnswer(text))
</script>

<!-- Rendered HTML comes from renderMarkdown (html:false) / hljs — both escape input. -->
<div class="answer-block has-reveal">
  {#if answer.format === 'json'}
    <pre class="session-text session-markdown">{@html answer.html}</pre>
  {:else if showRaw}
    <pre class="session-text session-markdown">{@html highlightMarkdown(text)}</pre>
  {:else}
    <div class="prose">{@html answer.html}</div>
  {/if}

  {#if partId !== null || tokens !== null}
    <div class="answer-meta">
      {#if partId !== null}
        <span class="reveal-item"><IdBadge id={partId} /></span>
      {/if}
      <TokenPill count={tokens} {estimated} />
    </div>
  {/if}

  {#if answer.format === 'prose'}
    <button
      class="icon-btn icon-btn-reveal"
      onclick={() => {
        showRaw = !showRaw
      }}
      aria-label={showRaw ? 'Show rendered markdown' : 'Show raw source'}
      title={showRaw ? 'Show rendered markdown' : 'Show raw source'}
    >
      <Icon path={showRaw ? iconView : iconCode} />
    </button>
  {/if}
</div>

<style>
  .answer-block {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: end;
    column-gap: var(--compact-inline-gap);
  }

  .answer-meta {
    display: flex;
    align-items: end;
    gap: var(--compact-inline-gap);
  }
</style>
