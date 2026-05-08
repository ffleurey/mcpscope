<script lang="ts">
  import { onMount } from 'svelte'
  import { modelConfigs, lmConnections, upsertModelConfig, removeModelConfig } from '../connectionStore'
  import { listModels, loadModel, unloadModel } from '../services/lmstudio'
  import type { LmStudioModel } from '../services/lmstudio'
  import type { ModelConfig } from '../types'
  import ModelConfigForm from './ModelConfigForm.svelte'
  import JsonDialog from './JsonDialog.svelte'

  let editingId = $state<string | null>(null)
  let showNew = $state(false)
  let saveError = $state<string | null>(null)

  // Live model status keyed by connectionId → model key → LmStudioModel
  let liveModels = $state<Map<string, Map<string, LmStudioModel>>>(new Map())
  let statusLoading = $state(false)

  // Per-card action state: key = config.id
  let cardBusy = $state<Map<string, string>>(new Map())  // value = 'loading' | 'ejecting'
  let cardError = $state<Map<string, string>>(new Map())

  // Details dialog
  let detailsData = $state<unknown>(null)
  let detailsTitle = $state('')
  let showDetails = $state(false)

  function startNew() { showNew = true; editingId = null }
  function cancelNew() { showNew = false }
  function startEdit(id: string) { editingId = id; showNew = false }
  function cancelEdit() { editingId = null }

  async function fetchAllStatuses() {
    statusLoading = true
    const uniqueConnIds = [...new Set($modelConfigs.map(c => c.connectionId))]
    const next = new Map<string, Map<string, LmStudioModel>>()
    await Promise.all(uniqueConnIds.map(async connId => {
      const conn = $lmConnections.find(c => c.id === connId)
      if (!conn) return
      try {
        const models = await listModels(conn.baseUrl, conn.apiKey)
        const byKey = new Map<string, LmStudioModel>()
        for (const m of models) byKey.set(m.key, m)
        next.set(connId, byKey)
      } catch {
        // ignore per-connection errors — card will just show no status
      }
    }))
    liveModels = next
    statusLoading = false
  }

  function liveModel(config: ModelConfig): LmStudioModel | undefined {
    return liveModels.get(config.connectionId)?.get(config.modelKey)
  }

  async function handleLoad(config: ModelConfig) {
    const conn = $lmConnections.find(c => c.id === config.connectionId)
    if (!conn) return
    cardBusy = new Map(cardBusy).set(config.id, 'loading')
    cardError = new Map(cardError).set(config.id, '')
    try {
      await loadModel(conn.baseUrl, config.modelKey, conn.apiKey)
      await fetchAllStatuses()
    } catch (e) {
      cardError = new Map(cardError).set(config.id, e instanceof Error ? e.message : String(e))
    } finally {
      const next = new Map(cardBusy); next.delete(config.id); cardBusy = next
    }
  }

  async function handleEject(config: ModelConfig) {
    const conn = $lmConnections.find(c => c.id === config.connectionId)
    if (!conn) return
    cardBusy = new Map(cardBusy).set(config.id, 'ejecting')
    cardError = new Map(cardError).set(config.id, '')
    try {
      await unloadModel(conn.baseUrl, config.modelKey, conn.apiKey)
      await fetchAllStatuses()
    } catch (e) {
      cardError = new Map(cardError).set(config.id, e instanceof Error ? e.message : String(e))
    } finally {
      const next = new Map(cardBusy); next.delete(config.id); cardBusy = next
    }
  }

  function openDetails(config: ModelConfig) {
    const m = liveModel(config)
    detailsData = m ?? { note: 'Model status not yet fetched. Click Refresh.' }
    detailsTitle = `Model Details — ${config.modelDisplayName}`
    showDetails = true
  }

  async function handleSave(config: ModelConfig) {
    try {
      await upsertModelConfig(config)
      showNew = false
      editingId = null
      await fetchAllStatuses()
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

  onMount(() => { fetchAllStatuses() })
</script>

<div class="view">
  <div class="view-header">
    <h2>Model Configs</h2>
    <div class="header-actions">
      <button class="btn btn-sm" onclick={fetchAllStatuses} disabled={statusLoading} title="Refresh model status">
        {statusLoading ? '…' : '↻'} Refresh
      </button>
      {#if !showNew}
        <button class="btn btn-primary" onclick={startNew}>+ New Model Config</button>
      {/if}
    </div>
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
      {@const live = liveModel(config)}
      {@const busy = cardBusy.get(config.id)}
      {@const err = cardError.get(config.id)}
      <div class="profile-card">
        <div class="card-header">
          <div class="card-title-group">
            <span class="card-name">{config.name}</span>
            <span class="card-model">{config.modelDisplayName}</span>
          </div>
          <div class="card-actions">
            {#if live?.isLoaded}
              <span class="badge-loaded">● loaded</span>
              <button class="btn btn-sm" onclick={() => handleEject(config)} disabled={!!busy}>
                {busy === 'ejecting' ? 'Ejecting…' : 'Eject'}
              </button>
            {:else if live}
              <span class="badge-unloaded">○ not loaded</span>
              <button class="btn btn-sm" onclick={() => handleLoad(config)} disabled={!!busy}>
                {busy === 'loading' ? 'Loading…' : 'Load'}
              </button>
            {/if}
            <button class="btn btn-sm" onclick={() => openDetails(config)}>Details</button>
            <button class="btn btn-sm" onclick={() => startEdit(config.id)}>Edit</button>
            <button class="btn btn-sm btn-danger" onclick={() => handleDelete(config.id)}>Delete</button>
          </div>
        </div>
        {#if err}
          <p class="card-error">{err}</p>
        {/if}
        <dl class="card-details">
          <div class="detail-row">
            <dt>Connection</dt><dd>{connectionName(config.connectionId)}</dd>
          </div>
          <div class="detail-row">
            <dt>Model Key</dt><dd><code>{config.modelKey}</code></dd>
          </div>
          {#if live?.isLoaded && live.loadedContextLength}
            <div class="detail-row">
              <dt>Context</dt><dd>{live.loadedContextLength.toLocaleString()} tokens loaded (max {(live.maxContextLength ?? 0).toLocaleString()})</dd>
            </div>
          {/if}
          <div class="detail-row">
            <dt>Temperature</dt><dd><span class="badge">{config.temperature}</span></dd>
          </div>
          {#if config.reasoning}
            <div class="detail-row">
              <dt>Reasoning</dt><dd><span class="badge">{config.reasoning}</span></dd>
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

{#if showDetails}
  <JsonDialog title={detailsTitle} data={detailsData} onClose={() => { showDetails = false }} />
{/if}

<style>
  .view { padding: 1.5rem 2rem; }
  .view-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 1.5rem;
  }
  .header-actions { display: flex; gap: 0.5rem; align-items: center; }
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
    gap: 0.5rem;
  }
  .card-title-group {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    min-width: 0;
  }
  .card-name { font-weight: 600; font-size: 0.95rem; color: var(--text); }
  .card-model { font-size: 0.8rem; color: var(--text-muted); }
  .card-actions { display: flex; gap: 0.4rem; flex-shrink: 0; align-items: center; flex-wrap: wrap; }
  .card-error { color: var(--color-error); font-size: 0.8rem; margin: 0 0 0.5rem; }
  .badge-loaded { font-size: 0.75rem; color: #4ade80; font-weight: 500; }
  .badge-unloaded { font-size: 0.75rem; color: var(--text-muted); }
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

