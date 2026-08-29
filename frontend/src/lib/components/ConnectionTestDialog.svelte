<script lang="ts">
  import { highlightJson } from '../jsonHighlight'
  import DialogShell from './DialogShell.svelte'
  import Icon from './Icon.svelte'
  import { iconCheck, iconClose } from '../design/icons'

  interface TestResult {
    ok: boolean
    message: string
    details?: Record<string, unknown>
    rawDetails?: unknown
  }

  let {
    title,
    target,
    result,
    onClose,
  }: {
    title: string
    target: string
    result: TestResult
    onClose: () => void
  } = $props()
</script>

<DialogShell {title} {onClose} dialogClass="connection-test-dialog">
  <div class="test-result">
    <div class="status-row">
      <span class="status-icon" class:ok={result.ok} class:err={!result.ok}>
        <Icon path={result.ok ? iconCheck : iconClose} />
      </span>
      <span class="status-label" class:ok={result.ok} class:err={!result.ok}>
        {result.ok ? 'Connected' : 'Failed'}
      </span>
    </div>

    <div class="target-row">
      <span class="label">Target</span>
      <span class="value mono">{target}</span>
    </div>

    <div class="message-row">
      <span class="label">Message</span>
      <span class="value">{result.message}</span>
    </div>

    {#if result.details}
      <div class="details-list">
        {#each Object.entries(result.details) as [key, value]}
          <div class="detail-row">
            <span class="detail-key">{key}</span>
            <span class="detail-value mono">{value}</span>
          </div>
        {/each}
      </div>
    {/if}

    {#if result.rawDetails !== undefined}
      <details class="raw-details">
        <summary>Raw details</summary>
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        <pre class="raw-body">{@html highlightJson(result.rawDetails)}</pre>
      </details>
    {/if}
  </div>
</DialogShell>

<style>
  :global(.connection-test-dialog) {
    width: 440px;
  }

  .test-result {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .status-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.25rem;
  }

  .status-icon {
    font-size: 1.1rem;
    font-weight: 700;
  }

  .status-label {
    font-size: var(--font-ui);
    font-weight: 600;
  }

  .ok {
    color: var(--green-bright);
  }

  .err {
    color: var(--red-bright);
  }

  .target-row,
  .message-row {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }

  .label {
    font-size: var(--font-label);
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .value {
    font-size: var(--font-ui);
    color: var(--text-bright);
    word-break: break-word;
  }

  .mono {
    font-family: var(--mono);
  }

  .details-list {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    background: var(--bg-base);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 0.5rem 0.75rem;
  }

  .detail-row {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    font-size: var(--font-meta);
  }

  .detail-key {
    color: var(--text-dim);
  }

  .detail-value {
    color: var(--text-bright);
    word-break: break-all;
  }

  .raw-details {
    font-size: var(--font-meta);
    color: var(--text-dim);
  }

  .raw-details summary {
    cursor: pointer;
    user-select: none;
    margin-bottom: 0.4rem;
  }

  .raw-body {
    background: var(--bg-base);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 0.5rem 0.75rem;
    font-family: var(--mono);
    font-size: var(--font-meta);
    overflow-x: auto;
    white-space: pre-wrap;
    word-break: break-all;
    max-height: 200px;
    overflow-y: auto;
  }
</style>
