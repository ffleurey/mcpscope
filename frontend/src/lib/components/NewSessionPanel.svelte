<script lang="ts">
  import { modelConfigs } from '../connectionStore'
  import { openPrimaryLaunchDialog } from '../sessionStore'
</script>

<div class="new-session">
  <div class="new-session-card">
    <h2 class="card-title">No session selected</h2>
    <p class="empty-copy">Open the dedicated primary session constructor to start a new chat session.</p>
    <button class="btn btn-primary start-btn" onclick={openPrimaryLaunchDialog} disabled={$modelConfigs.length === 0}>Create primary session</button>
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
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 2rem 2rem 1.75rem;
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .card-title {
    font-size: 1.1rem;
    font-weight: 700;
    color: var(--text-bright);
    margin: 0;
  }

  .field-hint {
    font-size: 0.8rem;
    color: var(--text-dim);
    margin: 0;
  }

  .empty-copy {
    margin: 0;
    color: var(--text-dim);
    line-height: 1.45;
  }

  .start-btn {
    width: 100%;
    justify-content: center;
    padding: 0.65rem 1.25rem;
    font-size: 0.9rem;
    font-weight: 600;
  }

</style>
