<script lang="ts">
  import { onMount } from 'svelte'
  import { lmConnections } from '../connectionStore'
  import { listModels } from '../services/lmstudio'
  import type { LmStudioModel } from '../services/lmstudio'
  import type { ModelConfig } from '../types'

  interface Props {
    modelConfig?: ModelConfig | null
    onSave: (config: ModelConfig) => void
    onCancel: () => void
  }

  let { modelConfig = null, onSave, onCancel }: Props = $props()

  let name = $state(modelConfig?.name ?? '')
  let connectionId = $state(modelConfig?.connectionId ?? '')
  let modelKey = $state(modelConfig?.modelKey ?? '')
  let modelDisplayName = $state(modelConfig?.modelDisplayName ?? '')
  let temperature = $state(modelConfig?.temperature ?? 0.7)
  let systemPrompt = $state(modelConfig?.systemPrompt ?? '')
  let contextWindowSize = $state<string>(modelConfig?.contextWindowSize != null ? String(modelConfig.contextWindowSize) : '')
  let reasoning = $state<'on' | 'off' | undefined>(modelConfig?.reasoning)

  let availableModels = $state<LmStudioModel[]>([])
  let modelsLoading = $state(false)
  let modelsError = $state<string | null>(null)
  let selectedModelMeta = $state<LmStudioModel | null>(null)

  let errors = $state<Record<string, string>>({})

  function applyModelSelection(m: LmStudioModel) {
    modelKey = m.key
    modelDisplayName = m.displayName
    selectedModelMeta = m
    // Auto-fill context window from loaded instance (the real operational limit)
    const ctx = m.loadedContextLength ?? m.maxContextLength
    if (ctx !== null && contextWindowSize === '') {
      contextWindowSize = String(ctx)
    }
    // Auto-set reasoning default if model supports it
    if (m.supportsReasoning && reasoning === undefined) {
      reasoning = m.defaultReasoningOn ? 'on' : 'off'
    } else if (!m.supportsReasoning) {
      reasoning = undefined
    }
  }

  async function fetchModels(connId: string) {
    if (!connId) { availableModels = []; selectedModelMeta = null; return }
    const conn = $lmConnections.find(c => c.id === connId)
    if (!conn) { availableModels = []; selectedModelMeta = null; return }
    modelsLoading = true
    modelsError = null
    availableModels = []
    modelKey = ''
    modelDisplayName = ''
    selectedModelMeta = null
    try {
      const models = await listModels(conn.baseUrl, conn.apiKey)
      availableModels = models
      if (modelConfig?.connectionId === connId && modelConfig.modelKey) {
        const existing = models.find(m => m.key === modelConfig.modelKey)
        if (existing) {
          applyModelSelection(existing)
        } else if (models.length > 0) {
          applyModelSelection(models[0])
        }
      } else {
        const first = models.find(m => m.isLoaded) ?? models[0]
        if (first) applyModelSelection(first)
      }
    } catch (e) {
      modelsError = e instanceof Error ? e.message : String(e)
    } finally {
      modelsLoading = false
    }
  }

  function handleConnectionChange() {
    contextWindowSize = ''
    reasoning = undefined
    fetchModels(connectionId)
  }

  function handleModelChange() {
    const m = availableModels.find(x => x.key === modelKey)
    if (m) {
      modelDisplayName = m.displayName
      selectedModelMeta = m
      // Update context window hint from newly selected model
      const ctx = m.loadedContextLength ?? m.maxContextLength
      if (ctx !== null) contextWindowSize = String(ctx)
      // Update reasoning capability
      if (m.supportsReasoning) {
        reasoning = reasoning ?? (m.defaultReasoningOn ? 'on' : 'off')
      } else {
        reasoning = undefined
      }
    }
  }

  onMount(() => {
    if (!connectionId && $lmConnections.length > 0) {
      connectionId = $lmConnections[0].id
    }
    if (connectionId) fetchModels(connectionId)
  })

  function validate(): boolean {
    const e: Record<string, string> = {}
    if (!name.trim()) e.name = 'Name is required'
    if (!connectionId) e.connectionId = 'Connection is required'
    if (!modelKey) e.modelKey = 'Model is required'
    if (isNaN(temperature) || temperature < 0 || temperature > 2) {
      e.temperature = 'Temperature must be between 0.0 and 2.0'
    }
    if (contextWindowSize !== '' && (isNaN(Number(contextWindowSize)) || Number(contextWindowSize) <= 0)) {
      e.contextWindowSize = 'Must be a positive integer or left blank'
    }
    errors = e
    return Object.keys(e).length === 0
  }

  function handleSubmit() {
    if (!validate()) return
    const now = Date.now()
    onSave({
      id: modelConfig?.id ?? crypto.randomUUID(),
      name: name.trim(),
      connectionId,
      modelKey,
      modelDisplayName,
      systemPrompt: systemPrompt.trim(),
      temperature,
      contextWindowSize: contextWindowSize !== '' ? Number(contextWindowSize) : null,
      reasoning: selectedModelMeta?.supportsReasoning ? reasoning : undefined,
      createdAt: modelConfig?.createdAt ?? now,
      updatedAt: now,
    })
  }
</script>

<form class="profile-form" onsubmit={(e) => { e.preventDefault(); handleSubmit() }}>
  <h3>{modelConfig ? 'Edit Model Config' : 'New Model Config'}</h3>

  <div class="field">
    <label for="mc-name">Name</label>
    <input id="mc-name" type="text" bind:value={name} placeholder="e.g. Qwen3 · Creative" />
    {#if errors.name}<span class="field-error">{errors.name}</span>{/if}
  </div>

  <div class="field">
    <label for="mc-connection">Connection</label>
    {#if $lmConnections.length === 0}
      <p class="no-connections">No connections configured. Add one in the Connections view first.</p>
    {:else}
      <select id="mc-connection" bind:value={connectionId} onchange={handleConnectionChange}>
        {#each $lmConnections as conn (conn.id)}
          <option value={conn.id}>{conn.name}</option>
        {/each}
      </select>
    {/if}
    {#if errors.connectionId}<span class="field-error">{errors.connectionId}</span>{/if}
  </div>

  <div class="field">
    <label for="mc-model">Model</label>
    {#if modelsLoading}
      <p class="loading-hint">Loading models…</p>
    {:else if modelsError}
      <p class="error-hint">{modelsError}</p>
    {:else if availableModels.length === 0 && connectionId}
      <p class="loading-hint">No models found on this connection.</p>
    {:else if availableModels.length > 0}
      <select id="mc-model" bind:value={modelKey} onchange={handleModelChange}>
        {#each availableModels as m (m.uid)}
          <option value={m.key}>{m.displayName}{m.isLoaded ? ' ●' : ''}</option>
        {/each}
      </select>
    {/if}
    {#if errors.modelKey}<span class="field-error">{errors.modelKey}</span>{/if}
  </div>

  <div class="field field-row">
    <div class="sub-field">
      <label for="mc-temperature">Temperature</label>
      <input id="mc-temperature" type="number" step="0.1" min="0" max="2" bind:value={temperature} />
      {#if errors.temperature}<span class="field-error">{errors.temperature}</span>{/if}
    </div>
    <div class="sub-field">
      <label for="mc-ctx">Context Window (tokens)</label>
      <input id="mc-ctx" type="number" step="1" min="1" bind:value={contextWindowSize} placeholder="optional" />
      {#if selectedModelMeta}
        <span class="field-hint">
          {#if selectedModelMeta.loadedContextLength}
            Loaded: {selectedModelMeta.loadedContextLength.toLocaleString()} · Max: {(selectedModelMeta.maxContextLength ?? 0).toLocaleString()}
          {:else if selectedModelMeta.maxContextLength}
            Max: {selectedModelMeta.maxContextLength.toLocaleString()} (not loaded)
          {/if}
        </span>
      {/if}
      {#if errors.contextWindowSize}<span class="field-error">{errors.contextWindowSize}</span>{/if}
    </div>
  </div>

  {#if selectedModelMeta?.supportsReasoning}
  <div class="field">
    <label for="mc-reasoning">Reasoning</label>
    <select id="mc-reasoning" bind:value={reasoning}>
      <option value="on">On</option>
      <option value="off">Off</option>
    </select>
    <span class="field-hint">This model supports extended reasoning (chain-of-thought).</span>
  </div>
  {/if}

  <div class="field">
    <label for="mc-system-prompt">System Prompt</label>
    <textarea id="mc-system-prompt" bind:value={systemPrompt} rows="4" placeholder="Optional system prompt"></textarea>
  </div>

  <div class="form-actions">
    <button type="submit" class="btn btn-primary">Save</button>
    <button type="button" class="btn" onclick={onCancel}>Cancel</button>
  </div>
</form>

<style>
  .profile-form {
    background: var(--bg-panel);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 1.25rem 1.5rem;
    margin-bottom: 1.5rem;
  }
  h3 {
    margin: 0 0 1.1rem;
    font-size: 1rem;
    font-weight: 600;
    color: var(--text);
  }
  .field { margin-bottom: 0.9rem; }
  .field-row {
    display: flex;
    gap: 1rem;
  }
  .sub-field { flex: 1; }
  label {
    display: block;
    font-size: 0.82rem;
    color: var(--text-muted);
    margin-bottom: 0.3rem;
    font-weight: 500;
    letter-spacing: 0.02em;
  }
  input, select, textarea {
    width: 100%;
    box-sizing: border-box;
    background: var(--bg-input);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text);
    padding: 0.45rem 0.6rem;
    font-size: 0.9rem;
    font-family: inherit;
    outline: none;
    transition: border-color 0.15s;
  }
  input:focus, select:focus, textarea:focus { border-color: var(--color-accent); }
  textarea { resize: vertical; }
  .field-error {
    display: block;
    color: var(--color-error);
    font-size: 0.78rem;
    margin-top: 0.25rem;
  }
  .loading-hint, .no-connections {
    font-size: 0.82rem;
    color: var(--text-muted);
    margin: 0.25rem 0 0;
  }
  .field-hint {
    display: block;
    font-size: 0.75rem;
    color: var(--text-muted);
    margin-top: 0.2rem;
  }
  .error-hint {
    font-size: 0.82rem;
    color: var(--color-error);
    margin: 0.25rem 0 0;
  }
  .form-actions {
    display: flex;
    gap: 0.6rem;
    margin-top: 1.1rem;
  }
</style>
