<script lang="ts">
  import { highlightJson } from '../jsonHighlight'
  import { clearSessionError, sessionError, sessionErrorSurface } from '../sessionStore'

  function dismiss() {
    clearSessionError()
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' || e.key === 'Enter') dismiss()
  }
</script>

{#if $sessionError && $sessionErrorSurface === 'dialog'}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div class="overlay" role="dialog" aria-modal="true" aria-label="Error" tabindex="-1" onkeydown={handleKeydown}>
    <div class="dialog">
      <div class="dialog-title">Error</div>
      <div class="dialog-body">{$sessionError.message}</div>
      {#if $sessionError.details !== undefined}
        <details class="details-section">
          <summary>Details</summary>
          <!-- eslint-disable-next-line svelte/no-at-html-tags -->
          <pre class="details-body">{@html highlightJson($sessionError.details)}</pre>
        </details>
      {/if}
      <div class="dialog-actions">
        <!-- svelte-ignore a11y_autofocus -->
        <button class="btn" onclick={dismiss} autofocus>OK</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .dialog {
    background: var(--bg-panel);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 1.5rem;
    min-width: 320px;
    max-width: 560px;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  }

  .dialog-title {
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--color-error);
  }

  .dialog-body {
    font-size: 0.875rem;
    color: var(--text);
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .details-section {
    font-size: 0.8rem;
    color: var(--text-muted);
  }

  .details-section summary {
    cursor: pointer;
    user-select: none;
    margin-bottom: 0.5rem;
  }

  .details-body {
    background: var(--bg);
    border: 1px solid var(--border-subtle);
    border-radius: 4px;
    padding: 0.5rem 0.75rem;
    font-family: var(--font-mono);
    font-size: 0.8rem;
    overflow-x: auto;
    white-space: pre-wrap;
    word-break: break-all;
    max-height: 200px;
    overflow-y: auto;
  }

  .dialog-actions {
    display: flex;
    justify-content: flex-end;
  }
</style>
