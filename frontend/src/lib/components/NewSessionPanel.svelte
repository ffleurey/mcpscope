<script lang="ts">
  import { modelConfigs } from '../connectionStore'
  import { openPrimaryLaunchDialog } from '../sessionStore'
</script>

<div class="new-session">
  <div class="new-session-card">
    <h2 class="card-title">No session selected</h2>
    <p class="empty-copy">Open the dedicated primary session constructor to start a new chat session.</p>
    <button class="start-btn" onclick={openPrimaryLaunchDialog} disabled={$modelConfigs.length === 0}>Create primary session</button>
    {#if $modelConfigs.length === 0}
      <p class="field-hint">No model configs — create one in the sidebar first.</p>
    {/if}
  </div>
</div>

<style>
  .new-session {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2rem;
    overflow-y: auto;
  }

  .new-session-card {
    width: 100%;
    max-width: 420px;
    background: var(--bg-panel);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 2rem 2rem 1.75rem;
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .card-title {
    font-size: 1.1rem;
    font-weight: 700;
    color: var(--text);
    margin: 0;
  }

  .field-hint {
    font-size: 0.8rem;
    color: var(--text-muted);
    margin: 0;
  }

  .empty-copy {
    margin: 0;
    color: var(--text-muted);
    line-height: 1.45;
  }

  .start-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    background: var(--color-accent);
    border: none;
    border-radius: 7px;
    color: #fff;
    cursor: pointer;
    font-family: inherit;
    font-size: 0.9rem;
    font-weight: 600;
    padding: 0.65rem 1.25rem;
    transition: opacity 0.15s;
  }

  .start-btn:hover:enabled {
    opacity: 0.88;
  }

  .start-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

</style>
