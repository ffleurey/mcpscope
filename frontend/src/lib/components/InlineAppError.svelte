<script lang="ts">
  import type { AppError } from '../errors'
  import { highlightJson } from '../jsonHighlight'

  interface Props {
    error: AppError | null
  }

  let { error }: Props = $props()

  let detailPayload = $derived.by(() => {
    if (!error) return undefined

    const payload: Record<string, unknown> = {}
    if (error.code) payload.code = error.code
    if (error.statusCode > 0) payload.statusCode = error.statusCode
    if (error.details !== undefined) payload.details = error.details

    return Object.keys(payload).length > 0 ? payload : undefined
  })
</script>

{#if error}
  <div class="inline-error">
    <div class="inline-error-message">{error.message}</div>
    {#if detailPayload}
      <details class="inline-error-details">
        <summary>Details</summary>
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        <pre class="inline-error-details-body">{@html highlightJson(detailPayload)}</pre>
      </details>
    {/if}
  </div>
{/if}

<style>
  .inline-error {
    background: color-mix(in srgb, var(--red-bright) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--red-bright) 35%, transparent);
    border-radius: 6px;
    color: var(--red-bright);
    padding: 0.5rem 0.75rem;
    margin-bottom: 1rem;
  }

  .inline-error-message {
    font-size: var(--font-meta);
    line-height: 1.35;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .inline-error-details {
    margin-top: 0.45rem;
    font-size: var(--font-meta);
    color: var(--text-dim);
  }

  .inline-error-details summary {
    cursor: pointer;
    user-select: none;
  }

  .inline-error-details-body {
    margin: 0.45rem 0 0;
    background: var(--bg-base);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 0.45rem 0.6rem;
    font-family: var(--mono);
    font-size: var(--font-meta);
    overflow-x: auto;
    white-space: pre-wrap;
    word-break: break-all;
    max-height: 170px;
    overflow-y: auto;
  }
</style>
