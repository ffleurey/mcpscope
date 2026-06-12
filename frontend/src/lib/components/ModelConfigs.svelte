<script lang="ts">
  import { onMount } from 'svelte'
  import { modelConfigs, lmConnections, upsertModelConfig, removeModelConfig, sessionCreationDefaults, setDefaultModelConfig } from '../connectionStore'
  import { listModels, loadModel, unloadModel } from '../services/lmstudio'
  import { fetchLmConnectionModelDetails } from '../api/backendClient'
  import type { LmStudioModel } from '../services/lmstudio'
  import type { ModelConfig } from '../types'
  import ModelConfigForm from './ModelConfigForm.svelte'
import { formatContextSize } from '../modelConfigHelpers'
  import InlineAppError from './InlineAppError.svelte'
  import JsonDialog from './JsonDialog.svelte'
  import { AppError, toAppError } from '../errors'

  let editingId = $state<string | null>(null)
  let showNew = $state(false)
  let saveError = $state<AppError | null>(null)
  let statusError = $state<AppError | null>(null)

  // Live model status keyed by connectionId → model key → LmStudioModel
  let liveModels = $state<Map<string, Map<string, LmStudioModel>>>(new Map())
  let statusLoading = $state(false)

  // Per-card action state: key = config.id
  let cardBusy = $state<Map<string, string>>(new Map())  // value = 'loading' | 'ejecting'
  let cardError = $state<Map<string, AppError>>(new Map())

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
    statusError = null
    const uniqueConnIds = [...new Set($modelConfigs.map(c => c.connectionId))]
    const next = new Map<string, Map<string, LmStudioModel>>()
    let firstError: AppError | null = null
    await Promise.all(uniqueConnIds.map(async connId => {
      const conn = $lmConnections.find(c => c.id === connId)
      if (!conn) return
      try {
        const models = await listModels(conn.baseUrl, conn.apiKey, conn.providerType)
        const byKey = new Map<string, LmStudioModel>()
        for (const m of models) byKey.set(m.key, m)
        next.set(connId, byKey)
      } catch (e) {
        if (!firstError) {
          const error = toAppError(e)
          firstError = new AppError(
            `Could not refresh model status for ${conn.name}: ${error.message}`,
            error.errorType,
            error.statusCode,
            { code: error.code, details: error.details },
          )
        }
      }
    }))
    liveModels = next
    statusLoading = false
    statusError = firstError
  }

  function liveModel(config: ModelConfig): LmStudioModel | undefined {
    return liveModels.get(config.connectionId)?.get(config.modelKey)
  }

  async function handleLoad(config: ModelConfig) {
    const conn = $lmConnections.find(c => c.id === config.connectionId)
    if (!conn) return
    cardBusy = new Map(cardBusy).set(config.id, 'loading')
    const nextCardError = new Map(cardError)
    nextCardError.delete(config.id)
    cardError = nextCardError
    try {
      await loadModel(conn.baseUrl, config.modelKey, conn.apiKey, config.contextSize)
      await fetchAllStatuses()
    } catch (e) {
      cardError = new Map(cardError).set(config.id, toAppError(e))
    } finally {
      const next = new Map(cardBusy); next.delete(config.id); cardBusy = next
    }
  }

  async function handleEject(config: ModelConfig) {
    const conn = $lmConnections.find(c => c.id === config.connectionId)
    if (!conn) return
    cardBusy = new Map(cardBusy).set(config.id, 'ejecting')
    const nextCardError = new Map(cardError)
    nextCardError.delete(config.id)
    cardError = nextCardError
    try {
      await unloadModel(conn.baseUrl, config.modelKey, conn.apiKey)
      await fetchAllStatuses()
    } catch (e) {
      cardError = new Map(cardError).set(config.id, toAppError(e))
    } finally {
      const next = new Map(cardBusy); next.delete(config.id); cardBusy = next
    }
  }

  async function openDetails(config: ModelConfig) {
    const conn = $lmConnections.find(c => c.id === config.connectionId)
    if (conn?.providerType === 'ollama') {
      detailsTitle = `Model Details — ${config.modelDisplayName}`
      detailsData = { note: 'Loading…' }
      showDetails = true
      try {
        const result = await fetchLmConnectionModelDetails(conn.baseUrl, config.modelKey, conn.providerType)
        detailsData = result.details
      } catch (e) {
        const m = liveModel(config)
        detailsData = m?.raw ?? { error: e instanceof Error ? e.message : String(e) }
      }
    } else {
      const m = liveModel(config)
      detailsData = m?.raw ?? { note: 'Model status not yet fetched. Click Refresh.' }
      detailsTitle = `Model Details — ${config.modelDisplayName}`
      showDetails = true
    }
  }

  async function handleSave(config: ModelConfig) {
    try {
      await upsertModelConfig(config)
      saveError = null
      showNew = false
      editingId = null
      await fetchAllStatuses()
    } catch (e) {
      saveError = toAppError(e)
    }
  }

  async function handleDelete(id: string) {
    try {
      await removeModelConfig(id)
      saveError = null
      if (editingId === id) editingId = null
    } catch (e) {
      saveError = toAppError(e)
    }
  }

  async function handleSetDefault(id: string) {
    try {
      await setDefaultModelConfig(id)
      saveError = null
    } catch (e) {
      saveError = toAppError(e)
    }
  }

  function connectionName(connectionId: string): string {
    return $lmConnections.find(c => c.id === connectionId)?.name ?? connectionId
  }

  function isLmStudioConnection(connectionId: string): boolean {
    const conn = $lmConnections.find(c => c.id === connectionId)
    return conn?.providerType === 'lmstudio'
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

  <InlineAppError error={saveError} />
  <InlineAppError error={statusError} />

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
      {@const isDefault = $sessionCreationDefaults?.defaultModelConfigId === config.id}
      <div class="profile-card" class:is-default={isDefault}>
        <div class="card-header">
          <div class="card-title-group">
            <div class="card-name-row">
              <span class="card-name">{config.name}</span>
              {#if isDefault}
                <span class="default-badge">Default for new sessions</span>
              {/if}
            </div>
            <span class="card-model">{config.modelDisplayName}</span>
          </div>
          <div class="card-actions">
            {#if isLmStudioConnection(config.connectionId) && live?.isLoaded}
              <span class="badge-loaded">● loaded</span>
              {#if live.loadedContextLength}
                <span class="badge-loaded-context">{live.loadedContextLength.toLocaleString()} ctx</span>
              {/if}
              <button class="btn btn-sm" onclick={() => handleEject(config)} disabled={!!busy}>
                {busy === 'ejecting' ? 'Ejecting…' : 'Eject'}
              </button>
            {:else if isLmStudioConnection(config.connectionId) && live}
              <span class="badge-unloaded">○ not loaded</span>
              <button class="btn btn-sm" onclick={() => handleLoad(config)} disabled={!!busy}>
                {busy === 'loading' ? 'Loading…' : 'Load'}
              </button>
            {/if}
            <button class="btn btn-sm" onclick={() => openDetails(config)}>Details</button>
            {#if !isDefault}
              <button class="btn btn-sm btn-accent" onclick={() => handleSetDefault(config.id)}>Set as default</button>
            {/if}
            <button class="btn btn-sm" onclick={() => startEdit(config.id)}>Edit</button>
            <button class="btn btn-sm btn-danger" onclick={() => handleDelete(config.id)}>Delete</button>
          </div>
        </div>
        {#if err}
          <InlineAppError error={err} />
        {/if}
        <dl class="card-details">
          <div class="detail-row">
            <dt>Connection</dt><dd>{connectionName(config.connectionId)}</dd>
          </div>
          <div class="detail-row">
            <dt>Model Key</dt><dd><code>{config.modelKey}</code></dd>
          </div>
          {#if config.contextSize}
            <div class="detail-row">
              <dt>Context Size</dt><dd>{formatContextSize(config.contextSize)}</dd>
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
  .profile-card {
    background: var(--bg-panel);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 1rem 1.25rem;
    margin-bottom: 1rem;
  }
  .profile-card.is-default {
    border-color: var(--color-accent);
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
  .card-name-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .card-name { font-weight: 600; font-size: 0.95rem; color: var(--text); }
  .card-model { font-size: 0.8rem; color: var(--text-muted); }
  .default-badge {
    display: inline-block;
    background: color-mix(in srgb, var(--color-accent) 15%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-accent) 40%, transparent);
    color: var(--color-accent);
    border-radius: 3px;
    padding: 0.1rem 0.45rem;
    font-size: 0.72rem;
    font-weight: 600;
    white-space: nowrap;
  }
  .card-actions { display: flex; gap: 0.4rem; flex-shrink: 0; align-items: center; flex-wrap: wrap; }
  .badge-loaded { font-size: 0.75rem; color: #4ade80; font-weight: 500; }
  .badge-loaded-context { font-size: 0.75rem; color: #4ade80; font-weight: 500; white-space: nowrap; }
  .badge-unloaded { font-size: 0.75rem; color: var(--text-muted); }
  .text-muted { color: var(--text-muted); }
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
  .btn-accent {
    background: color-mix(in srgb, var(--color-accent) 15%, transparent);
    border-color: color-mix(in srgb, var(--color-accent) 40%, transparent);
    color: var(--color-accent);
  }
  .btn-accent:hover {
    background: color-mix(in srgb, var(--color-accent) 25%, transparent);
  }
  code { font-family: var(--mono); font-size: 0.8rem; }
</style>
