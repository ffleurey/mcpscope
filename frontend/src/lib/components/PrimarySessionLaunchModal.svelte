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
  import Checkbox from './Checkbox.svelte'
  import Radio from './Radio.svelte'

  let selectedConfigId = $state('')
  let selectedMcpProfileIds = $state<string[]>([])
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
    if (!hasInitializedMcpSelection) {
      selectedMcpProfileIds = $mcpProfiles.filter(p => p.defaultEnabled).map(p => p.id)
      hasInitializedMcpSelection = true
    }
  })

  async function handleStart() {
    await startSession({
      sessionId: sessionId.trim() ? sessionId.trim().toUpperCase() : undefined,
      modelConfigId: selectedConfigId || undefined,
      mcpProfileIds: selectedMcpProfileIds,
      compactionStrategy,
    })
  }

  function toggleMcp(id: string) {
    if (selectedMcpProfileIds.includes(id)) {
      selectedMcpProfileIds = selectedMcpProfileIds.filter(i => i !== id)
    } else {
      selectedMcpProfileIds = [...selectedMcpProfileIds, id]
    }
  }
</script>

<DialogShell title="New primary session" onClose={closePrimaryLaunchDialog} dialogClass="primary-launch-dialog">
  <div class="form-stack">
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
        class="field-input"
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
        <p class="field-hinttext">No model configs — create one in the sidebar first.</p>
      {:else}
        <select id="primary-model-select" class="field-input" bind:value={selectedConfigId} disabled={$isStartingSession}>
          {#each $modelConfigs as config (config.id)}
            <option value={config.id}>{config.name}{$sessionCreationDefaults?.defaultModelConfigId === config.id ? ' (default)' : ''}</option>
          {/each}
        </select>
      {/if}
    </div>

    <div class="field">
      <span class="field-label">MCP servers <span class="optional">(optional)</span></span>
      {#if $mcpProfiles.length === 0}
        <p class="field-hinttext">No MCP server profiles — create one in the sidebar first.</p>
      {:else}
        <div class="mcp-checkbox-group">
          {#each $mcpProfiles as profile (profile.id)}
            <Checkbox
              label={profile.name}
              hint={profile.defaultEnabled ? '(default)' : ''}
              checked={selectedMcpProfileIds.includes(profile.id)}
              disabled={$isStartingSession}
              onchange={() => toggleMcp(profile.id)}
            />
          {/each}
        </div>
      {/if}
    </div>

    <div class="field">
      <span class="field-label">Context compaction</span>
      <div class="radio-group">
        <Radio
          group={compactionStrategy}
          value="strip-reasoning"
          name="primary-compaction"
          label="Strip reasoning"
          hint="Remove chain-of-thought after each turn to save context"
          disabled={$isStartingSession}
          onselect={(v) => (compactionStrategy = v as 'strip-reasoning' | 'none')}
        />
        <Radio
          group={compactionStrategy}
          value="none"
          name="primary-compaction"
          label="None"
          hint="Keep full context including reasoning"
          disabled={$isStartingSession}
          onselect={(v) => (compactionStrategy = v as 'strip-reasoning' | 'none')}
        />
      </div>
    </div>

    <div class="form-actions">
      <button class="btn" onclick={closePrimaryLaunchDialog} disabled={$isStartingSession}>Cancel</button>
      <button class="btn btn-primary" onclick={handleStart} disabled={!selectedConfigId || $isStartingSession || $modelConfigs.length === 0}>
        {$isStartingSession ? 'Starting…' : 'Start session'}
      </button>
    </div>
  </div>
</DialogShell>

<style>
  .error-banner {
    background: color-mix(in srgb, var(--red-bright) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--red-bright) 35%, transparent);
    border-radius: 6px;
    color: var(--red-bright);
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
    color: var(--text-dim);
  }

  .error-details summary {
    cursor: pointer;
    user-select: none;
  }

  .error-details-body {
    margin: 0.45rem 0 0;
    background: var(--bg-base);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 0.45rem 0.6rem;
    font-family: var(--mono);
    font-size: 0.76rem;
    overflow-x: auto;
    white-space: pre-wrap;
    word-break: break-all;
    max-height: 170px;
    overflow-y: auto;
  }

  .optional {
    font-weight: 400;
    text-transform: none;
    letter-spacing: 0;
    font-size: 0.75rem;
  }

  .mcp-checkbox-group {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }


  .radio-group {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
</style>
