<script lang="ts">
  import type { ConnectionTestResult } from '../types'

  let { result }: { result: ConnectionTestResult } = $props()
</script>

{#if result.status !== 'idle'}
  <div class="test-result" class:success={result.status === 'success'} class:error={result.status === 'error'} class:testing={result.status === 'testing'}>
    <span class="status-label">
      {#if result.status === 'testing'}Testing…{/if}
      {#if result.status === 'success'}Connected{/if}
      {#if result.status === 'error'}Error{/if}
    </span>
    {#if result.message && result.status !== 'testing'}
      <span class="message">{result.message}</span>
    {/if}
    {#if result.details.length > 0}
      <ul class="details">
        {#each result.details as detail}
          <li>{detail}</li>
        {/each}
      </ul>
    {/if}
  </div>
{/if}

<style>
  .test-result {
    margin-top: 0.75rem;
    padding: 0.6rem 0.8rem;
    border-radius: 4px;
    border: 1px solid var(--border);
    font-size: 0.85rem;
    line-height: 1.5;
  }
  .test-result.success {
    border-color: var(--color-success);
    color: var(--color-success);
  }
  .test-result.error {
    border-color: var(--color-error);
    color: var(--color-error);
  }
  .test-result.testing {
    border-color: var(--border);
    color: var(--text-muted);
  }
  .status-label {
    font-weight: 600;
    display: block;
    margin-bottom: 0.2rem;
  }
  .message {
    display: block;
  }
  .details {
    margin: 0.3rem 0 0;
    padding-left: 1.2rem;
  }
  .details li {
    margin-bottom: 0.15rem;
  }
</style>
