<script lang="ts">
  import { modelConfigs, lmConnections, upsertModelConfig, removeModelConfig } from '../connectionStore'
  import type { ModelConfig } from '../types'
  import ModelConfigForm from './ModelConfigForm.svelte'

  let editingId = $state<string | null>(null)
  let showNew = $state(false)
  let saveError = $state<string | null>(null)

  function startNew() { showNew = true; editingId = null }
  function cancelNew() { showNew = false }
  function startEdit(id: string) { editingId = id; showNew = false }
  function cancelEdit() { editingId = null }

  async function handleSave(config: ModelConfig) {
    try {
      await upsertModelConfig(config)
      showNew = false
      editingId = null
    } catch (e) {
      saveError = e instanceof Error ? e.message : String(e)
    }
  }

  async function handleDelete(id: string) {
    try {
      await removeModelConfig(id)
      if (editingId === id) editingId = null
    } catch (e) {
      saveError = e instanceof Error ? e.message : String(e)
    }
  }

  function connectionName(connectionId: string): string {
    return $lmConnections.find(c => c.id === connectionId)?.name ?? connectionId
  }
</script>

<div class="view">
  <div class="view-header">
    <h2>Model Configs</h2>
    {#if !showNew}
      <button class="btn btn-primary" onclick={startNew}>+ New Model Config</button>
    {/if}
  </div>

  {#if saveError}
    <p class="save-error">{saveError}</p>
  {/if}

  {#if showNew}
    <ModelConfigForm onSave={handleSave} onCancel={cancelNew} />
  {/if}

  {#if $modelConfigs.length === 0 && !showNew}
    <p class="empty-state">No model configs yet. Create one to get started.</p>
  {/if}

  {#each $modelConfigs as config (config.id)}
    {#if editingId === config.id}
      <ModelConfigForm modelConfig={config} onSave={handleSave} onCancel={cancelEdit} />
    {:else}
      <div class="profile-card">
        <div class="card-header">
          <div class="card-title-group">
            <span class="card-name">{config.name}</span>
            <span class="card-model">{config.modelDisplayName}</span>
          </div>
          <div class="card-actions">
            <button class="btn btn-sm" onclick={() => startEdit(config.id)}>Edit</button>
            <button class="btn btn-sm btn-danger" onclick={() => handleDelete(config.id)}>Delete</button>
          </div>
        </div>
        <dl class="card-details">
          <div class="detail-row">
            <dt>Connection</dt><dd>{connectionName(config.connectionId)}</dd>
          </div>
          <div class="detail-row">
            <dt>Model Key</dt><dd><code>{config.modelKey}</code></dd>
          </div>
          <div class="detail-row">
            <dt>Temperature</dt><dd><span class="badge">{config.temperature}</span></dd>
          </div>
          {#if config.contextWindowSize != null}
            <div class="detail-row">
              <dt>Context Window</dt><dd>{config.contextWindowSize.toLocaleString()} tokens</dd>
            </div>
          {/if}
          {#if config.systemPrompt}
            <div class="detail-row">
              <dt>System Prompt</dt><dd class="system-prompt-preview">{config.systemPrompt.slice(0, 120)}{config.systemPrompt.length > 120 ? '…' : ''}</dd>
            </div>
          {/if}
        </dl>
      </div>
    {/if}
  {/each}
</div>

<style>
  .view { padding: 1.5rem 2rem; }
  .view-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 1.5rem;
  }
  h2 {
    margin: 0;
    font-size: 1.15rem;
    font-weight: 600;
    color: var(--text);
  }
  .empty-state { color: var(--text-muted); font-size: 0.9rem; }
  .save-error { color: var(--color-error); font-size: 0.875rem; margin-bottom: 1rem; }
  .profile-card {
    background: var(--bg-panel);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 1rem 1.25rem;
    margin-bottom: 1rem;
  }
  .card-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    margin-bottom: 0.75rem;
  }
  .card-title-group {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }
  .card-name { font-weight: 600; font-size: 0.95rem; color: var(--text); }
  .card-model { font-size: 0.8rem; color: var(--text-muted); }
  .card-actions { display: flex; gap: 0.5rem; flex-shrink: 0; }
  .card-details { margin: 0; }
  .detail-row {
    display: flex;
    gap: 0.75rem;
    font-size: 0.82rem;
    padding: 0.2rem 0;
    border-bottom: 1px solid var(--border-subtle);
  }
  .detail-row:last-child { border-bottom: none; }
  dt { color: var(--text-muted); min-width: 110px; flex-shrink: 0; }
  dd { margin: 0; color: var(--text); word-break: break-all; }
  .system-prompt-preview { color: var(--text-muted); font-style: italic; }
  .badge {
    display: inline-block;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 3px;
    padding: 0 0.3rem;
    font-size: 0.78rem;
    color: var(--text-muted);
  }
  code { font-family: var(--mono); font-size: 0.8rem; }
</style>
