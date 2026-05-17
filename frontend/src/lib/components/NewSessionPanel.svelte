<script lang="ts">
  import { highlightJson } from '../jsonHighlight'
  import { lmConnections, modelConfigs, mcpProfiles, sessionCreationDefaults } from '../connectionStore'
  import { sessionError, sessionErrorSurface, isStartingSession, startSession } from '../sessionStore'
  import { derived } from 'svelte/store'

  let compactionStrategy = $state<'strip-reasoning' | 'none'>('strip-reasoning')
  let sessionTitle = $state('')
  let sessionId = $state('')

  const defaultModelConfig = derived(
    [modelConfigs, sessionCreationDefaults],
    ([$modelConfigs, $defaults]) =>
      $defaults?.defaultModelConfigId
        ? $modelConfigs.find(c => c.id === $defaults.defaultModelConfigId) ?? null
        : null,
  )

  const defaultMcpProfile = derived(
    [mcpProfiles, sessionCreationDefaults],
    ([$mcpProfiles, $defaults]) =>
      $defaults?.defaultMcpProfileId
        ? $mcpProfiles.find(p => p.id === $defaults.defaultMcpProfileId) ?? null
        : null,
  )

  async function handleStart() {
    const config = $defaultModelConfig
    if (!config) return
    const connection = $lmConnections.find(c => c.id === config.connectionId)
    if (!connection) return
    const mcpProfile = $defaultMcpProfile

    await startSession({
      sessionId: sessionId.trim() ? sessionId.trim().toUpperCase() : undefined,
      title: sessionTitle.trim() || undefined,
      modelConfig: config,
      connection,
      mcpProfile,
      compactionStrategy,
    })
  }
</script>

<div class="new-session">
  <div class="new-session-card">
    <h2 class="card-title">New session</h2>

    {#if $sessionError && $sessionErrorSurface === 'new-session'}
      <div class="error-banner">
        <div class="error-message">{$sessionError.message}</div>
        {#if $sessionError.details !== undefined}
          <details class="error-details">
            <summary>Details</summary>
            <!-- eslint-disable-next-line svelte/no-at-html-tags -->
            <pre class="error-details-body">{@html highlightJson($sessionError.details)}</pre>
          </details>
        {/if}
      </div>
    {/if}

    <div class="field">
      <label class="field-label" for="session-title">Title <span class="optional">(optional)</span></label>
      <input
        id="session-title"
        class="field-select"
        type="text"
        maxlength="80"
        placeholder="My session"
        bind:value={sessionTitle}
        disabled={$isStartingSession}
      />
    </div>

    <div class="field">
      <label class="field-label" for="session-id">Session ID <span class="optional">(optional)</span></label>
      <input
        id="session-id"
        class="field-select"
        type="text"
        maxlength="4"
        placeholder="AB12"
        bind:value={sessionId}
        oninput={() => { sessionId = sessionId.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4) }}
        disabled={$isStartingSession}
      />
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

    <div class="defaults-summary">
      <span class="defaults-label">Defaults for this session</span>
      <div class="defaults-row">
        <span class="defaults-key">Model</span>
        {#if $defaultModelConfig}
          <span class="defaults-value">{$defaultModelConfig.name}</span>
        {:else}
          <span class="defaults-missing">None configured</span>
        {/if}
      </div>
      <div class="defaults-row">
        <span class="defaults-key">MCP server</span>
        {#if $defaultMcpProfile}
          <span class="defaults-value">{$defaultMcpProfile.name}</span>
        {:else}
          <span class="defaults-none">None</span>
        {/if}
      </div>
    </div>

    {#if !$defaultModelConfig}
      <p class="hint-no-model">
        No default model configured. Go to <strong>Model Configs</strong> and set one as default before creating a session.
      </p>
    {/if}

    <button
      class="start-btn"
      onclick={handleStart}
      disabled={!$defaultModelConfig || $isStartingSession}
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
    padding: 0.5rem 0.75rem;
  }

  .error-message {
    font-size: 0.82rem;
    line-height: 1.35;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .error-details {
    margin-top: 0.45rem;
    font-size: 0.78rem;
    color: var(--text-muted);
  }

  .error-details summary {
    cursor: pointer;
    user-select: none;
  }

  .error-details-body {
    margin: 0.45rem 0 0;
    background: var(--bg);
    border: 1px solid var(--border-subtle);
    border-radius: 4px;
    padding: 0.45rem 0.6rem;
    font-family: var(--font-mono);
    font-size: 0.76rem;
    overflow-x: auto;
    white-space: pre-wrap;
    word-break: break-all;
    max-height: 170px;
    overflow-y: auto;
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

  .defaults-summary {
    background: var(--bg);
    border: 1px solid var(--border-subtle);
    border-radius: 7px;
    padding: 0.75rem 0.9rem;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .defaults-label {
    font-size: 0.73rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted);
    margin-bottom: 0.15rem;
  }

  .defaults-row {
    display: flex;
    gap: 0.6rem;
    font-size: 0.83rem;
    align-items: baseline;
  }

  .defaults-key {
    color: var(--text-muted);
    min-width: 80px;
    flex-shrink: 0;
  }

  .defaults-value {
    color: var(--text);
    font-weight: 500;
  }

  .defaults-missing {
    color: var(--color-error);
    font-style: italic;
  }

  .defaults-none {
    color: var(--text-muted);
    font-style: italic;
  }

  .hint-no-model {
    font-size: 0.82rem;
    color: var(--color-warning, #f59e0b);
    background: color-mix(in srgb, var(--color-warning, #f59e0b) 10%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-warning, #f59e0b) 30%, transparent);
    border-radius: 6px;
    padding: 0.5rem 0.75rem;
    margin: 0;
    line-height: 1.4;
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
