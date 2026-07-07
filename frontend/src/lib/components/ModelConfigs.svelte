<script lang="ts">
  import { onMount } from 'svelte'
  import {
    modelConfigs,
    lmConnections,
    upsertModelConfig,
    removeModelConfig,
    sessionCreationDefaults,
    setDefaultModelConfig,
  } from '../connectionStore'
  import { listModels, loadModel, unloadModel } from '../services/lmstudio'
  import { fetchLmConnectionModelDetails } from '../api/backendClient'
  import type { LmStudioModel } from '../services/lmstudio'
  import type { ModelConfig } from '../types'
  import ModelConfigForm from './ModelConfigForm.svelte'
  import DialogShell from './DialogShell.svelte'
  import { formatContextSize } from '../modelConfigHelpers'
  import InlineAppError from './InlineAppError.svelte'
  import JsonDialog from './JsonDialog.svelte'
  import { AppError, toAppError } from '../errors'
  import {
    iconPlus,
    iconRefresh,
    iconEdit,
    iconTrash,
    iconRadioMarked,
    iconRadioBlank,
    iconLoad,
    iconEject,
    iconInfo,
  } from '../design/icons'
  import Icon from './Icon.svelte'
  import { columnResize } from '../actions/columnResize'

  let editingId = $state<string | null>(null)
  let showNew = $state(false)
  let saveError = $state<AppError | null>(null)
  let statusError = $state<AppError | null>(null)

  // Live model status keyed by connectionId → model key → LmStudioModel
  let liveModels = $state<Map<string, Map<string, LmStudioModel>>>(new Map())
  let statusLoading = $state(false)

  // Per-row action state: key = config.id
  let cardBusy = $state<Map<string, string>>(new Map()) // value = 'loading' | 'ejecting'
  let cardError = $state<Map<string, AppError>>(new Map())

  // Details dialog
  let detailsData = $state<unknown>(null)
  let detailsTitle = $state('')
  let showDetails = $state(false)

  let editingConfig = $derived(
    editingId ? ($modelConfigs.find((c) => c.id === editingId) ?? null) : null,
  )

  function startNew() {
    showNew = true
    editingId = null
  }
  function cancelNew() {
    showNew = false
  }
  function startEdit(id: string) {
    editingId = id
    showNew = false
  }
  function cancelEdit() {
    editingId = null
  }

  async function fetchAllStatuses() {
    statusLoading = true
    statusError = null
    const uniqueConnIds = [...new Set($modelConfigs.map((c) => c.connectionId))]
    const next = new Map<string, Map<string, LmStudioModel>>()
    let firstError: AppError | null = null
    await Promise.all(
      uniqueConnIds.map(async (connId) => {
        const conn = $lmConnections.find((c) => c.id === connId)
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
      }),
    )
    liveModels = next
    statusLoading = false
    statusError = firstError
  }

  function liveModel(config: ModelConfig): LmStudioModel | undefined {
    return liveModels.get(config.connectionId)?.get(config.modelKey)
  }

  async function handleLoad(config: ModelConfig) {
    const conn = $lmConnections.find((c) => c.id === config.connectionId)
    if (!conn) return
    cardBusy = new Map(cardBusy).set(config.id, 'loading')
    const nextCardError = new Map(cardError)
    nextCardError.delete(config.id)
    cardError = nextCardError
    try {
      await loadModel(
        conn.baseUrl,
        config.modelKey,
        conn.apiKey,
        config.contextSize,
        conn.providerType,
      )
      await fetchAllStatuses()
    } catch (e) {
      cardError = new Map(cardError).set(config.id, toAppError(e))
    } finally {
      const next = new Map(cardBusy)
      next.delete(config.id)
      cardBusy = next
    }
  }

  async function handleEject(config: ModelConfig) {
    const conn = $lmConnections.find((c) => c.id === config.connectionId)
    if (!conn) return
    cardBusy = new Map(cardBusy).set(config.id, 'ejecting')
    const nextCardError = new Map(cardError)
    nextCardError.delete(config.id)
    cardError = nextCardError
    try {
      await unloadModel(conn.baseUrl, config.modelKey, conn.apiKey, conn.providerType)
      await fetchAllStatuses()
    } catch (e) {
      cardError = new Map(cardError).set(config.id, toAppError(e))
    } finally {
      const next = new Map(cardBusy)
      next.delete(config.id)
      cardBusy = next
    }
  }

  async function openDetails(config: ModelConfig) {
    const conn = $lmConnections.find((c) => c.id === config.connectionId)
    if (conn?.providerType === 'ollama') {
      detailsTitle = `Model Details — ${config.modelDisplayName}`
      detailsData = { note: 'Loading…' }
      showDetails = true
      try {
        const result = await fetchLmConnectionModelDetails(
          conn.baseUrl,
          config.modelKey,
          conn.providerType,
          conn.apiKey ?? null,
        )
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
    return $lmConnections.find((c) => c.id === connectionId)?.name ?? connectionId
  }

  function isLmStudioConnection(connectionId: string): boolean {
    const conn = $lmConnections.find((c) => c.id === connectionId)
    return conn?.providerType === 'lmstudio'
  }

  onMount(() => {
    fetchAllStatuses()
  })
</script>

<div class="config-view">
  <div class="config-view-header">
    <h2>Model Configs</h2>
    <div class="header-actions">
      <button
        class="btn btn-sm"
        onclick={fetchAllStatuses}
        disabled={statusLoading}
        title="Refresh model status"
      >
        <span class="btn-icon"><Icon path={iconRefresh} /></span>
        {statusLoading ? 'Refreshing…' : 'Refresh'}
      </button>
      <button class="btn" onclick={startNew}>
        <span class="btn-icon"><Icon path={iconPlus} /></span> New model config
      </button>
    </div>
  </div>

  <InlineAppError error={saveError} />
  <InlineAppError error={statusError} />

  {#if $modelConfigs.length === 0}
    <p class="config-empty">No model configs yet. Create one to get started.</p>
  {:else}
    <div class="table-scroll">
      <table class="data-table" use:columnResize>
        <colgroup>
          <col style="width: 3rem" />
          <col style="width: 12rem" />
          <col style="width: 9.5rem" />
          <col class="col-flex" />
          <col style="width: 5rem" />
          <col style="width: 7rem" />
          <col style="width: 12rem" />
          <col style="width: 10rem" />
        </colgroup>
        <thead>
          <tr>
            <th class="col-toggle" title="Default for new sessions" aria-label="Default"></th>
            <th>Name</th>
            <th>Connection</th>
            <th>Model</th>
            <th class="col-num">Temp</th>
            <th>Reasoning</th>
            <th>Context</th>
            <th class="col-actions">Actions</th>
          </tr>
        </thead>
        <tbody>
          {#each $modelConfigs as config (config.id)}
            {@const live = liveModel(config)}
            {@const busy = cardBusy.get(config.id)}
            {@const err = cardError.get(config.id)}
            {@const isDefault = $sessionCreationDefaults?.defaultModelConfigId === config.id}
            {@const isLmStudio = isLmStudioConnection(config.connectionId)}
            {@const loaded = !!(isLmStudio && live?.isLoaded)}
            {@const cfgCtx = config.contextSize ? formatContextSize(config.contextSize) : 'Auto'}
            {@const loadedCtx =
              loaded && live?.loadedContextLength
                ? formatContextSize(live.loadedContextLength)
                : null}
            <tr>
              <td class="col-toggle">
                <button
                  class="icon-btn"
                  class:icon-glow={isDefault}
                  class:icon-off={!isDefault}
                  title={isDefault ? 'Default for new sessions' : 'Set as default for new sessions'}
                  aria-label="Default for new sessions"
                  aria-pressed={isDefault}
                  onclick={() => {
                    if (!isDefault) handleSetDefault(config.id)
                  }}><Icon path={isDefault ? iconRadioMarked : iconRadioBlank} /></button
                >
              </td>
              <td title={config.name}>{config.name}</td>
              <td title={connectionName(config.connectionId)}
                >{connectionName(config.connectionId)}</td
              >
              <td title={config.modelKey}>{config.modelDisplayName}</td>
              <td class="col-num">{config.temperature ?? 'Default'}</td>
              <td>{config.reasoning ?? '—'}</td>
              <td
                title={loadedCtx
                  ? `Configured ${cfgCtx} · ${loadedCtx} loaded`
                  : `Configured ${cfgCtx}`}
              >
                {cfgCtx}{#if loadedCtx}
                  <span class="ctx-loaded">· {loadedCtx}</span>{/if}
              </td>
              <td class="col-actions">
                <span class="row-actions">
                  {#if isLmStudio && live}
                    <button
                      class="icon-btn"
                      class:icon-glow={loaded && !busy && !err}
                      class:icon-blink={!!busy}
                      class:icon-btn-danger={!!err && !busy}
                      title={err
                        ? err.message
                        : loaded
                          ? busy
                            ? 'Ejecting…'
                            : 'Loaded — click to eject'
                          : busy
                            ? 'Loading…'
                            : 'Not loaded — click to load'}
                      aria-label={loaded ? 'Eject model' : 'Load model'}
                      disabled={!!busy}
                      onclick={() => (loaded ? handleEject(config) : handleLoad(config))}
                      ><Icon path={loaded ? iconEject : iconLoad} /></button
                    >
                  {/if}
                  <button
                    class="icon-btn"
                    title="Details"
                    aria-label="Details"
                    onclick={() => openDetails(config)}><Icon path={iconInfo} /></button
                  >
                  <button
                    class="icon-btn"
                    title="Edit"
                    aria-label="Edit"
                    onclick={() => startEdit(config.id)}><Icon path={iconEdit} /></button
                  >
                  <button
                    class="icon-btn icon-btn-danger"
                    title="Delete"
                    aria-label="Delete"
                    onclick={() => handleDelete(config.id)}><Icon path={iconTrash} /></button
                  >
                </span>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>

{#if showNew}
  <DialogShell title="New Model Config" onClose={cancelNew}>
    <ModelConfigForm onSave={handleSave} onCancel={cancelNew} />
  </DialogShell>
{/if}

{#if editingConfig}
  <DialogShell title="Edit Model Config" onClose={cancelEdit}>
    <ModelConfigForm modelConfig={editingConfig} onSave={handleSave} onCancel={cancelEdit} />
  </DialogShell>
{/if}

{#if showDetails}
  <JsonDialog
    title={detailsTitle}
    data={detailsData}
    onClose={() => {
      showDetails = false
    }}
  />
{/if}

<style>
  .ctx-loaded {
    color: var(--text-dim);
  }
</style>
