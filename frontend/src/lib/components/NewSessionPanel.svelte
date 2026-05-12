<script lang="ts">
  import { lmConnections, modelConfigs, mcpProfiles } from '../connectionStore'
  import { sessionError, isStartingSession, startSession } from '../sessionStore'

  let selectedConfigId = $state('')
  let selectedMcpProfileId = $state('')
  let compactionStrategy = $state<'strip-reasoning' | 'none'>('strip-reasoning')

  // Auto-select the first model config when available
  $effect(() => {
    if (!$modelConfigs.some(c => c.id === selectedConfigId)) {
      selectedConfigId = $modelConfigs[0]?.id ?? ''
    }
  })

  async function handleStart() {
    const config = $modelConfigs.find(c => c.id === selectedConfigId)
    if (!config) return
    const connection = $lmConnections.find(c => c.id === config.connectionId)
    if (!connection) return
    const mcpProfile = $mcpProfiles.find(p => p.id === selectedMcpProfileId) ?? null

    await startSession({ modelConfig: config, connection, mcpProfile, compactionStrategy })
  }
</script>

<div class="new-session">
  <div class="new-session-card">
    <h2 class="card-title">New session</h2>

    {#if $sessionError}
      <div class="error-banner">{$sessionError}</div>
    {/if}

    <div class="field">
      <label class="field-label" for="model-select">Model</label>
      {#if $modelConfigs.length === 0}
        <p class="field-hint">No model configs — create one in the sidebar first.</p>
      {:else}
        <select id="model-select" class="field-select" bind:value={selectedConfigId} disabled={$isStartingSession}>
          {#each $modelConfigs as c (c.id)}
            <option value={c.id}>{c.name}</option>
          {/each}
        </select>
      {/if}
    </div>

    <div class="field">
      <label class="field-label" for="mcp-select">MCP server <span class="optional">(optional)</span></label>
      <select id="mcp-select" class="field-select" bind:value={selectedMcpProfileId} disabled={$isStartingSession}>
        <option value="">None</option>
        {#each $mcpProfiles as p (p.id)}
          <option value={p.id}>{p.name}</option>
        {/each}
      </select>
    </div>

    <div class="field">
      <span class="field-label">Context compaction</span>
      <div class="radio-group">
        <label class="radio-option">
          <input type="radio" name="compaction" value="strip-reasoning" bind:group={compactionStrategy} disabled={$isStartingSession} />
          <span class="radio-label">Strip reasoning</span>
          <span class="radio-hint">Remove chain-of-thought after each turn to save context</span>
        </label>
        <label class="radio-option">
          <input type="radio" name="compaction" value="none" bind:group={compactionStrategy} disabled={$isStartingSession} />
          <span class="radio-label">None</span>
          <span class="radio-hint">Keep full context including reasoning</span>
        </label>
      </div>
    </div>

    <button
      class="start-btn"
      onclick={handleStart}
      disabled={!selectedConfigId || $isStartingSession || $modelConfigs.length === 0}
    >
      {#if $isStartingSession}
        <span class="spinner" aria-hidden="true"></span>Starting…
      {:else}
        Start session
      {/if}
    </button>
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

  .error-banner {
    background: color-mix(in srgb, var(--color-error) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-error) 35%, transparent);
    border-radius: 6px;
    color: var(--color-error);
    font-size: 0.82rem;
    padding: 0.5rem 0.75rem;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }

  .field-label {
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .optional {
    font-weight: 400;
    text-transform: none;
    letter-spacing: 0;
    font-size: 0.75rem;
  }

  .field-select {
    background: var(--bg-input);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    font-family: inherit;
    font-size: 0.875rem;
    padding: 0.45rem 0.65rem;
    outline: none;
    cursor: pointer;
    appearance: auto;
  }

  .field-select:focus {
    border-color: var(--color-accent);
  }

  .field-select:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .field-hint {
    font-size: 0.8rem;
    color: var(--text-muted);
    margin: 0;
  }

  .radio-group {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .radio-option {
    display: grid;
    grid-template-columns: auto 1fr;
    grid-template-rows: auto auto;
    column-gap: 0.55rem;
    row-gap: 0.1rem;
    align-items: baseline;
    cursor: pointer;
    padding: 0.55rem 0.7rem;
    border: 1px solid var(--border-subtle);
    border-radius: 7px;
    background: var(--bg);
    transition: border-color 0.1s;
  }

  .radio-option:has(input:checked) {
    border-color: var(--color-accent);
    background: color-mix(in srgb, var(--color-accent) 7%, var(--bg));
  }

  .radio-option input[type="radio"] {
    grid-row: 1;
    grid-column: 1;
    margin: 0;
    accent-color: var(--color-accent);
    cursor: pointer;
  }

  .radio-label {
    grid-row: 1;
    grid-column: 2;
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--text);
  }

  .radio-hint {
    grid-row: 2;
    grid-column: 2;
    font-size: 0.75rem;
    color: var(--text-muted);
    line-height: 1.3;
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

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .spinner {
    display: inline-block;
    width: 14px;
    height: 14px;
    border: 2px solid rgba(255,255,255,0.4);
    border-top-color: #fff;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }
</style>
