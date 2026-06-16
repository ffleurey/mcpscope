<script lang="ts">
  import type { LmStudioConnection, ProviderType } from '../types'

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
  let showApiKey = $state(false)
  let seededConnection = $state<LmStudioConnection | null | undefined>(undefined)

  $effect(() => {
    if (connection === seededConnection) return
    seededConnection = connection
    name = connection?.name ?? ''
    baseUrl = connection?.baseUrl ?? 'http://localhost:1234/v1'
    apiKey = connection?.apiKey ?? ''
    providerType = (connection as { providerType?: ProviderType })?.providerType ?? 'lmstudio'
  })

  let errors = $state<Record<string, string>>({})

  function validate(): boolean {
    const e: Record<string, string> = {}
    if (!name.trim()) e.name = 'Name is required'
    if (!baseUrl.trim()) {
      e.baseUrl = 'Base URL is required'
    } else {
      try { new URL(baseUrl) } catch { e.baseUrl = 'Must be a valid URL' }
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
      createdAt: connection?.createdAt ?? now,
      updatedAt: now,
    })
  }
</script>

<form class="profile-form" onsubmit={(e) => { e.preventDefault(); handleSubmit() }}>

  <div class="field">
    <label for="lc-name">Name</label>
    <input id="lc-name" type="text" bind:value={name} placeholder="e.g. Local LM Studio" />
    {#if errors.name}<span class="field-error">{errors.name}</span>{/if}
  </div>

  <div class="field">
    <label for="lc-base-url">Base URL</label>
    <input id="lc-base-url" type="text" bind:value={baseUrl} placeholder="http://localhost:1234/v1" />
    {#if errors.baseUrl}<span class="field-error">{errors.baseUrl}</span>{/if}
  </div>

  <div class="field">
    <label for="lc-api-key">API Key <span class="field-hint">(optional — for HTTPS endpoints)</span></label>
    <div class="api-key-row">
      <input
        id="lc-api-key"
        type={showApiKey ? 'text' : 'password'}
        bind:value={apiKey}
        placeholder="Bearer token — leave blank for local servers"
        autocomplete="off"
      />
      <button type="button" class="btn btn-sm toggle-key" onclick={() => { showApiKey = !showApiKey }}>
        {showApiKey ? 'Hide' : 'Show'}
      </button>
    </div>
  </div>

  <div class="field">
    <label for="lc-provider">Provider Type</label>
    <select id="lc-provider" bind:value={providerType}>
      <option value="lmstudio">LM Studio (local)</option>
      <option value="openrouter">OpenRouter (hosted)</option>
      <option value="ollama">Ollama (local)</option>
    </select>
    <span class="field-hint">
      {#if providerType === 'openrouter'}
        Uses OpenAI-compatible API. Set Base URL to https://openrouter.ai/api/v1
      {:else if providerType === 'ollama'}
        Connects to locally running Ollama instance. Default: http://localhost:11434
      {:else}
        Connects to locally running LM Studio instance.
      {/if}
    </span>
  </div>

  <div class="form-actions">
    <button type="submit" class="btn btn-primary">Save</button>
    <button type="button" class="btn" onclick={onCancel}>Cancel</button>
  </div>
</form>

<style>
  .profile-form {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .field-hint {
    font-size: 0.75rem;
    color: var(--text-dim);
  }
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
  label {
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  input, select {
    width: 100%;
    box-sizing: border-box;
    background: var(--bg-base);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text-bright);
    padding: 0.4rem 0.6rem;
    font-size: 0.875rem;
    font-family: inherit;
    outline: none;
  }
  input:disabled, select:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .field-error {
    font-size: 0.75rem;
    color: var(--red-bright);
  }
  .form-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    padding-top: 0.25rem;
  }
</style>
