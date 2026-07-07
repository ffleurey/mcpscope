<script lang="ts">
  import type { LmStudioConnection, ProviderType } from '../types'
  import Checkbox from './Checkbox.svelte'

  interface Props {
    connection?: LmStudioConnection | null
    onSave: (conn: LmStudioConnection) => void
    onCancel: () => void
  }

  let { connection = null, onSave, onCancel }: Props = $props()

  let name = $state('')
  let baseUrl = $state('http://localhost:1234/v1')
  let apiKey = $state('')
  let providerType = $state<ProviderType>('lmstudio')
  let autoSwapModel = $state(false)
  let showApiKey = $state(false)
  let seededConnection = $state<LmStudioConnection | null | undefined>(undefined)

  $effect(() => {
    if (connection === seededConnection) return
    seededConnection = connection
    name = connection?.name ?? ''
    baseUrl = connection?.baseUrl ?? 'http://localhost:1234/v1'
    apiKey = connection?.apiKey ?? ''
    providerType = (connection as { providerType?: ProviderType })?.providerType ?? 'lmstudio'
    autoSwapModel = (connection as { autoSwapModel?: boolean })?.autoSwapModel ?? false
  })

  let errors = $state<Record<string, string>>({})

  function validate(): boolean {
    const e: Record<string, string> = {}
    if (!name.trim()) e.name = 'Name is required'
    if (!baseUrl.trim()) {
      e.baseUrl = 'Base URL is required'
    } else {
      try {
        new URL(baseUrl)
      } catch {
        e.baseUrl = 'Must be a valid URL'
      }
    }
    errors = e
    return Object.keys(e).length === 0
  }

  function handleSubmit() {
    if (!validate()) return
    const now = Date.now()
    onSave({
      id: connection?.id ?? crypto.randomUUID(),
      name: name.trim(),
      baseUrl: baseUrl.trim(),
      apiKey: apiKey.trim() || undefined,
      providerType,
      autoSwapModel: providerType === 'lmstudio' ? autoSwapModel : false,
      createdAt: connection?.createdAt ?? now,
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
    <label class="field-label" for="lc-name">Name</label>
    <input
      id="lc-name"
      class="field-input"
      type="text"
      bind:value={name}
      placeholder="e.g. Local LM Studio"
    />
    {#if errors.name}<span class="field-errortext">{errors.name}</span>{/if}
  </div>

  <div class="field">
    <label class="field-label" for="lc-provider">Provider Type</label>
    <select id="lc-provider" class="field-input" bind:value={providerType}>
      <option value="lmstudio">LM Studio (local)</option>
      <option value="openrouter">OpenRouter (hosted)</option>
      <option value="ollama">Ollama (local)</option>
    </select>
    <span class="field-hinttext">
      {#if providerType === 'openrouter'}
        Uses OpenAI-compatible API. Set Base URL to https://openrouter.ai/api/v1
      {:else if providerType === 'ollama'}
        Connects to locally running Ollama instance. Default: http://localhost:11434
      {:else}
        Connects to locally running LM Studio instance.
      {/if}
    </span>
  </div>

  <div class="field">
    <label class="field-label" for="lc-base-url">Base URL</label>
    <input
      id="lc-base-url"
      class="field-input"
      type="text"
      bind:value={baseUrl}
      placeholder="http://localhost:1234/v1"
    />
    {#if errors.baseUrl}<span class="field-errortext">{errors.baseUrl}</span>{/if}
  </div>

  <div class="field">
    <label class="field-label" for="lc-api-key"
      >API Key <span class="field-hinttext">(optional — for HTTPS endpoints)</span></label
    >
    <div class="api-key-row">
      <input
        id="lc-api-key"
        class="field-input"
        type={showApiKey ? 'text' : 'password'}
        bind:value={apiKey}
        placeholder="Bearer token — leave blank for local servers"
        autocomplete="off"
      />
      <button
        type="button"
        class="btn btn-sm toggle-key"
        onclick={() => {
          showApiKey = !showApiKey
        }}
      >
        {showApiKey ? 'Hide' : 'Show'}
      </button>
    </div>
  </div>

  {#if providerType === 'lmstudio'}
    <div class="field">
      <Checkbox
        checked={autoSwapModel}
        label="Auto-swap model"
        hint="Before each request, unload any other model on this instance and load the one the session needs — so a single VRAM-limited LM Studio instance can be driven from the CLI/MCP without manual load/unload."
        onchange={(c) => (autoSwapModel = c)}
      />
    </div>
  {/if}

  <div class="form-actions">
    <button type="button" class="btn" onclick={onCancel}>Cancel</button>
    <button type="submit" class="btn btn-primary">Save</button>
  </div>
</form>

<style>
  .api-key-row {
    display: flex;
    gap: 0.4rem;
  }
  .api-key-row input {
    flex: 1;
  }
  .toggle-key {
    flex-shrink: 0;
    white-space: nowrap;
  }
</style>
