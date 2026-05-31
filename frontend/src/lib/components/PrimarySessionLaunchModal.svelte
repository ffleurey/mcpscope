<script lang="ts">
  import { highlightJson } from '../jsonHighlight'
  import { modelConfigs, mcpProfiles, sessionCreationDefaults } from '../connectionStore'
  import {
    closePrimaryLaunchDialog,
    isStartingSession,
    sessionError,
    sessionErrorSurface,
    startSession,
  } from '../sessionStore'
  import DialogShell from './DialogShell.svelte'

  let selectedConfigId = $state('')
  let selectedMcpProfileId = $state('')
  let compactionStrategy = $state<'strip-reasoning' | 'none'>('strip-reasoning')
  let sessionId = $state('')
  let hasInitializedModelSelection = $state(false)
  let hasInitializedMcpSelection = $state(false)

  $effect(() => {
    const defaultId = $sessionCreationDefaults?.defaultModelConfigId ?? null
    const hasDefault = defaultId != null && $modelConfigs.some((config) => config.id === defaultId)
    const currentIsValid = $modelConfigs.some((config) => config.id === selectedConfigId)

    if (!hasInitializedModelSelection) {
      selectedConfigId = hasDefault ? defaultId : ($modelConfigs[0]?.id ?? '')
      hasInitializedModelSelection = true
      return
    }

    if (!currentIsValid) {
      selectedConfigId = hasDefault ? defaultId : ($modelConfigs[0]?.id ?? '')
    }
  })

  $effect(() => {
    const defaultId = $sessionCreationDefaults?.defaultMcpProfileId ?? null
    const hasDefault = defaultId != null && $mcpProfiles.some((profile) => profile.id === defaultId)
    const currentIsValid = selectedMcpProfileId === '' || $mcpProfiles.some((profile) => profile.id === selectedMcpProfileId)

    if (!hasInitializedMcpSelection) {
      selectedMcpProfileId = hasDefault ? defaultId : ''
      hasInitializedMcpSelection = true
      return
    }

    if (!currentIsValid) {
      selectedMcpProfileId = hasDefault ? defaultId : ''
    }
  })

  async function handleStart() {
    await startSession({
      sessionId: sessionId.trim() ? sessionId.trim().toUpperCase() : undefined,
      modelConfigId: selectedConfigId || undefined,
      mcpProfileId: selectedMcpProfileId || null,
      compactionStrategy,
    })
  }
</script>

<DialogShell title="New primary session" onClose={closePrimaryLaunchDialog} dialogClass="primary-launch-dialog">
  <div class="form">
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
      <label class="field-label" for="primary-session-id">Session ID <span class="optional">(optional)</span></label>
      <input
        id="primary-session-id"
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
      <label class="field-label" for="primary-model-select">Model</label>
      {#if $modelConfigs.length === 0}
        <p class="field-hint">No model configs — create one in the sidebar first.</p>
      {:else}
        <select id="primary-model-select" class="field-select" bind:value={selectedConfigId} disabled={$isStartingSession}>
          {#each $modelConfigs as config (config.id)}
            <option value={config.id}>{config.name}{$sessionCreationDefaults?.defaultModelConfigId === config.id ? ' (default)' : ''}</option>
          {/each}
        </select>
      {/if}
    </div>

    <div class="field">
      <label class="field-label" for="primary-mcp-select">MCP server <span class="optional">(optional)</span></label>
      <select id="primary-mcp-select" class="field-select" bind:value={selectedMcpProfileId} disabled={$isStartingSession}>
        <option value="">None</option>
        {#each $mcpProfiles as profile (profile.id)}
          <option value={profile.id}>{profile.name}{$sessionCreationDefaults?.defaultMcpProfileId === profile.id ? ' (default)' : ''}</option>
        {/each}
      </select>
    </div>

    <div class="field">
      <span class="field-label">Context compaction</span>
      <div class="radio-group">
        <label class="radio-option">
          <input type="radio" name="primary-compaction" value="strip-reasoning" bind:group={compactionStrategy} disabled={$isStartingSession} />
          <span class="radio-label">Strip reasoning</span>
          <span class="radio-hint">Remove chain-of-thought after each turn to save context</span>
        </label>
        <label class="radio-option">
          <input type="radio" name="primary-compaction" value="none" bind:group={compactionStrategy} disabled={$isStartingSession} />
          <span class="radio-label">None</span>
          <span class="radio-hint">Keep full context including reasoning</span>
        </label>
      </div>
    </div>

    <div class="actions">
      <button class="btn-secondary" onclick={closePrimaryLaunchDialog} disabled={$isStartingSession}>Cancel</button>
      <button class="btn-primary" onclick={handleStart} disabled={!selectedConfigId || $isStartingSession || $modelConfigs.length === 0}>
        {$isStartingSession ? 'Starting…' : 'Start session'}
      </button>
    </div>
  </div>
</DialogShell>

<style>
  .form {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 1rem;
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

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
  }

  .btn-primary,
  .btn-secondary {
    border-radius: 4px;
    border: 1px solid var(--border);
    cursor: pointer;
    font: inherit;
    font-size: 0.85rem;
    padding: 0.4rem 0.9rem;
  }

  .btn-primary {
    background: var(--color-accent, #7c3aed);
    border-color: var(--color-accent, #7c3aed);
    color: #fff;
  }

  .btn-secondary {
    background: var(--bg);
    color: var(--text);
  }
</style>