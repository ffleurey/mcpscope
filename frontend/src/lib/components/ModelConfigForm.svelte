<script lang="ts">
  import { onMount } from 'svelte'
  import { lmConnections, modelConfigs } from '../connectionStore'
  import { listModels, loadModel } from '../services/lmstudio'
  import type { LmStudioModel } from '../services/lmstudio'
  import type { ModelConfig } from '../types'
  import { CONTEXT_SIZE_PRESETS } from '../modelConfigHelpers'

  interface Props {
    modelConfig?: ModelConfig | null
    onSave: (config: ModelConfig) => void
    onCancel: () => void
  }

  let { modelConfig = null, onSave, onCancel }: Props = $props()

  // Slugify: lowercase, replace spaces with hyphens, remove non-alphanum except - _
  function slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9_-]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '')
  }

  let name = $state('')
  let customId = $state('')
  let connectionId = $state('')
  let modelKey = $state('')
  let modelDisplayName = $state('')
  // Temperature is optional: 'default' omits it so the provider uses its own
  // default; 'custom' sends `temperatureValue`. Mirrors the context-size control.
  let temperatureMode = $state<'default' | 'custom'>('default')
  let temperatureValue = $state(0.7)
  let systemPrompt = $state('')
  let reasoning = $state<'on' | 'off' | undefined>(undefined)
  let contextSize = $state<number | undefined>(undefined)
  let customContextSize = $state('')
  let seededModelConfig = $state<ModelConfig | null | undefined>(undefined)

  // Auto-generate ID from name, but only when creating (not editing existing)
  let isNew = $derived(!modelConfig)
  $effect(() => {
    if (isNew && name) {
      let slug = slugify(name)
      if (!slug) slug = 'untitled'
      // Check for collision with existing model configs
      const existing = $modelConfigs
      if (existing.some((mc) => mc.id === slug)) {
        let counter = 2
        while (existing.some((mc) => mc.id === `${slug}-${counter}`)) {
          counter++
        }
        slug = `${slug}-${counter}`
      }
      customId = slug
    }
  })

  $effect(() => {
    if (modelConfig === seededModelConfig) return
    seededModelConfig = modelConfig
    name = modelConfig?.name ?? ''
    customId = modelConfig?.id ?? slugify(modelConfig?.name ?? '')
    connectionId = modelConfig?.connectionId ?? ''
    modelKey = modelConfig?.modelKey ?? ''
    modelDisplayName = modelConfig?.modelDisplayName ?? ''
    if (modelConfig?.temperature == null) {
      temperatureMode = 'default'
      temperatureValue = 0.7
    } else {
      temperatureMode = 'custom'
      temperatureValue = modelConfig.temperature
    }
    systemPrompt = modelConfig?.systemPrompt ?? ''
    reasoning = modelConfig?.reasoning
    contextSize = modelConfig?.contextSize
    customContextSize = modelConfig?.contextSize ? String(modelConfig.contextSize) : ''
  })

  let availableModels = $state<LmStudioModel[]>([])
  let modelsLoading = $state(false)
  let modelsError = $state<string | null>(null)
  let selectedModelMeta = $state<LmStudioModel | null>(null)
  let modelSearch = $state('')

  let sortedFilteredModels = $derived(
    (modelSearch
      ? availableModels.filter(
          (m) =>
            m.displayName.toLowerCase().includes(modelSearch.toLowerCase()) ||
            m.key.toLowerCase().includes(modelSearch.toLowerCase()),
        )
      : [...availableModels]
    ).sort((a, b) => a.displayName.localeCompare(b.displayName)),
  )

  let selectedConnection = $derived($lmConnections.find((c) => c.id === connectionId) ?? null)
  let isLmStudio = $derived(selectedConnection?.providerType === 'lmstudio')

  let errors = $state<Record<string, string>>({})

  function applyModelSelection(m: LmStudioModel) {
    modelKey = m.key
    modelDisplayName = m.displayName
    selectedModelMeta = m
    // Auto-set reasoning default if model supports it
    if (m.supportsReasoning && reasoning === undefined) {
      reasoning = m.defaultReasoningOn ? 'on' : 'off'
    } else if (!m.supportsReasoning) {
      reasoning = undefined
    }
  }

  async function fetchModels(connId: string) {
    if (!connId) {
      availableModels = []
      selectedModelMeta = null
      return
    }
    const conn = $lmConnections.find((c) => c.id === connId)
    if (!conn) {
      availableModels = []
      selectedModelMeta = null
      return
    }
    modelsLoading = true
    modelsError = null
    availableModels = []
    modelKey = ''
    modelDisplayName = ''
    selectedModelMeta = null
    try {
      const models = await listModels(conn.baseUrl, conn.apiKey, conn.providerType)
      availableModels = models
      if (modelConfig?.connectionId === connId && modelConfig.modelKey) {
        const existing = models.find((m) => m.key === modelConfig.modelKey)
        if (existing) {
          applyModelSelection(existing)
        } else if (models.length > 0) {
          applyModelSelection(models[0])
        }
      } else {
        const first = isLmStudio ? (models.find((m) => m.isLoaded) ?? models[0]) : models[0]
        if (first) applyModelSelection(first)
      }
    } catch (e) {
      modelsError = e instanceof Error ? e.message : String(e)
    } finally {
      modelsLoading = false
    }
  }

  function handleConnectionChange() {
    reasoning = undefined
    fetchModels(connectionId)
  }

  function handleModelChange() {
    const m = availableModels.find((x) => x.key === modelKey)
    if (m) {
      modelDisplayName = m.displayName
      selectedModelMeta = m
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

  let modelLoading = $state(false)
  let modelLoadError = $state<string | null>(null)

  async function handleLoadModel() {
    const conn = $lmConnections.find((c) => c.id === connectionId)
    if (!conn || !modelKey) return
    const resolvedContextSize =
      contextSize === -1
        ? customContextSize
          ? parseInt(customContextSize, 10)
          : undefined
        : contextSize
    modelLoading = true
    modelLoadError = null
    try {
      await loadModel(conn.baseUrl, modelKey, conn.apiKey, resolvedContextSize, conn.providerType)
      await fetchModels(connectionId)
    } catch (e) {
      modelLoadError = e instanceof Error ? e.message : String(e)
    } finally {
      modelLoading = false
    }
  }

  function validate(): boolean {
    const e: Record<string, string> = {}
    if (!name.trim()) e.name = 'Name is required'
    if (!customId.trim()) e.customId = 'ID is required'
    if (customId.trim() && !/^[a-zA-Z0-9_-]+$/.test(customId.trim())) {
      e.customId = 'ID must only contain letters, numbers, hyphens, and underscores'
    }
    if (!connectionId) e.connectionId = 'Connection is required'
    if (!modelKey) e.modelKey = 'Model is required'
    if (
      temperatureMode === 'custom' &&
      (isNaN(temperatureValue) || temperatureValue < 0 || temperatureValue > 2)
    ) {
      e.temperature = 'Temperature must be between 0.0 and 2.0'
    }
    errors = e
    return Object.keys(e).length === 0
  }

  function handleSubmit() {
    if (!validate()) return
    const now = Date.now()
    const resolvedContextSize =
      contextSize === -1
        ? customContextSize
          ? parseInt(customContextSize, 10)
          : undefined
        : contextSize
    onSave({
      id: customId.trim(),
      name: name.trim(),
      connectionId,
      modelKey,
      modelDisplayName,
      systemPrompt: systemPrompt.trim(),
      temperature: temperatureMode === 'custom' ? temperatureValue : undefined,
      reasoning: selectedModelMeta?.supportsReasoning ? reasoning : undefined,
      contextSize: resolvedContextSize,
      createdAt: modelConfig?.createdAt ?? now,
      updatedAt: now,
    })
  }
</script>

<form
  class="form-stack"
  onsubmit={(e) => {
    e.preventDefault()
    handleSubmit()
  }}
>
  <div class="field">
    <label class="field-label" for="mc-connection">Connection</label>
    {#if $lmConnections.length === 0}
      <p class="no-connections">
        No connections configured. Add one in the Connections view first.
      </p>
    {:else}
      <select
        id="mc-connection"
        class="field-input"
        bind:value={connectionId}
        onchange={handleConnectionChange}
      >
        {#each $lmConnections as conn (conn.id)}
          <option value={conn.id}>{conn.name}</option>
        {/each}
      </select>
    {/if}
    {#if errors.connectionId}<span class="field-errortext">{errors.connectionId}</span>{/if}
  </div>

  <div class="field">
    <label class="field-label" for="mc-model">Model</label>
    {#if modelsLoading}
      <p class="loading-hint">Loading models…</p>
    {:else if modelsError}
      <p class="error-hint">{modelsError}</p>
    {:else if availableModels.length === 0 && connectionId}
      <p class="loading-hint">No models found on this connection.</p>
    {:else if modelSearch && sortedFilteredModels.length === 0}
      <p class="loading-hint">No models match "{modelSearch}".</p>
    {:else if sortedFilteredModels.length > 0}
      <input
        id="mc-model-filter"
        class="field-input"
        type="text"
        bind:value={modelSearch}
        placeholder="Search models…"
      />
      <div class="model-select-row">
        <select
          id="mc-model"
          class="field-input"
          bind:value={modelKey}
          onchange={handleModelChange}
        >
          {#each sortedFilteredModels as m (m.uid)}
            <option value={m.key}>{m.displayName}{isLmStudio && m.isLoaded ? ' ●' : ''}</option>
          {/each}
        </select>
        {#if isLmStudio && selectedModelMeta && !selectedModelMeta.isLoaded}
          <button
            type="button"
            class="btn btn-sm"
            onclick={handleLoadModel}
            disabled={modelLoading}
          >
            {modelLoading ? 'Loading…' : 'Load'}
          </button>
        {/if}
      </div>
      {#if selectedModelMeta}
        <span class="field-hinttext">
          {#if isLmStudio && selectedModelMeta.isLoaded && selectedModelMeta.loadedContextLength}
            ● Loaded · Context: {selectedModelMeta.loadedContextLength.toLocaleString()} tokens (max {(
              selectedModelMeta.maxContextLength ?? 0
            ).toLocaleString()})
          {:else if isLmStudio && selectedModelMeta.maxContextLength}
            ○ Not loaded · Max context: {selectedModelMeta.maxContextLength.toLocaleString()} tokens
          {:else if isLmStudio}
            ○ Not loaded
          {:else if selectedModelMeta.maxContextLength}
            Context: {selectedModelMeta.maxContextLength.toLocaleString()} tokens
          {:else}
            Model key: {selectedModelMeta.key}
          {/if}
        </span>
      {/if}
      {#if modelLoadError}<span class="field-errortext">{modelLoadError}</span>{/if}
    {/if}
    {#if errors.modelKey}<span class="field-errortext">{errors.modelKey}</span>{/if}
  </div>

  <div class="field">
    <label class="field-label" for="mc-name">Name</label>
    <input
      id="mc-name"
      class="field-input"
      type="text"
      bind:value={name}
      placeholder="e.g. Qwen3 · Creative"
    />
    {#if errors.name}<span class="field-errortext">{errors.name}</span>{/if}
  </div>

  <div class="field">
    <label class="field-label" for="mc-id">ID</label>
    {#if modelConfig}
      <span class="field-static">{customId}</span>
    {:else}
      <input
        id="mc-id"
        class="field-input"
        type="text"
        bind:value={customId}
        placeholder="auto-generated from name"
      />
    {/if}
    {#if errors.customId}<span class="field-errortext">{errors.customId}</span>{/if}
    {#if !modelConfig}<span class="field-hinttext"
        >Set once at creation, cannot be changed later.</span
      >{/if}
  </div>

  <div class="field">
    <label class="field-label" for="mc-temperature"
      >Temperature <span class="field-hinttext">(provider default sends no temperature)</span
      ></label
    >
    <div class="temperature-row">
      <select id="mc-temperature" class="field-input" bind:value={temperatureMode}>
        <option value="default">Provider default</option>
        <option value="custom">Custom…</option>
      </select>
      {#if temperatureMode === 'custom'}
        <input
          class="field-input"
          type="number"
          step="0.1"
          min="0"
          max="2"
          bind:value={temperatureValue}
        />
      {/if}
    </div>
    {#if errors.temperature}<span class="field-errortext">{errors.temperature}</span>{/if}
  </div>

  {#if selectedModelMeta?.supportsReasoning}
    <div class="field">
      <label class="field-label" for="mc-reasoning">Reasoning</label>
      <select id="mc-reasoning" class="field-input" bind:value={reasoning}>
        <option value="on">On</option>
        <option value="off">Off</option>
      </select>
      <span class="field-hinttext">This model supports extended reasoning (chain-of-thought).</span>
    </div>
  {/if}

  <div class="field">
    <label class="field-label" for="mc-context-size"
      >Context Size <span class="field-hinttext"
        >(leave empty for provider default){#if selectedModelMeta?.maxContextLength}
          — max {selectedModelMeta.maxContextLength.toLocaleString()}{/if}</span
      ></label
    >
    <div class="context-size-row">
      <select id="mc-context-size" class="field-input" bind:value={contextSize}>
        <option value={undefined}>Auto (provider default)</option>
        {#each CONTEXT_SIZE_PRESETS as preset (preset.value)}
          <option value={preset.value}>{preset.label}</option>
        {/each}
        <option value={-1}>Custom…</option>
      </select>
      {#if contextSize === -1}
        <input
          class="field-input"
          type="number"
          min="1"
          bind:value={customContextSize}
          placeholder="Enter context size"
        />
      {/if}
      {#if isLmStudio && selectedModelMeta?.isLoaded && selectedModelMeta.loadedContextLength}
        <span class="loaded-context-indicator"
          >● Loaded: {selectedModelMeta.loadedContextLength.toLocaleString()} tokens</span
        >
      {/if}
    </div>
  </div>

  <div class="field">
    <label class="field-label" for="mc-system-prompt">System Prompt</label>
    <textarea
      id="mc-system-prompt"
      class="field-input"
      bind:value={systemPrompt}
      rows="4"
      placeholder="Optional system prompt"></textarea>
  </div>

  <div class="form-actions">
    <button type="button" class="btn" onclick={onCancel}>Cancel</button>
    <button type="submit" class="btn btn-primary">Save</button>
  </div>
</form>

<style>
  .model-select-row,
  .context-size-row,
  .temperature-row {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }
  .temperature-row select {
    flex: 1;
  }
  .temperature-row input {
    width: 160px;
  }
  .model-select-row select {
    flex: 1;
  }
  .context-size-row input {
    width: 160px;
  }
  .context-size-row select {
    flex: 1;
  }
  .loaded-context-indicator {
    font-size: 0.78rem;
    color: var(--green-bright);
    font-weight: 500;
    white-space: nowrap;
  }
  .loading-hint,
  .no-connections {
    font-size: 0.82rem;
    color: var(--text-dim);
    margin: 0.25rem 0 0;
  }
  .error-hint {
    font-size: 0.82rem;
    color: var(--red-bright);
    margin: 0.25rem 0 0;
  }
</style>
