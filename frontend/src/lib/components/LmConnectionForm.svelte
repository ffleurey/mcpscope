<script lang="ts">
  import type { LmStudioConnection } from '../types'

  interface Props {
    connection?: LmStudioConnection | null
    onSave: (conn: LmStudioConnection) => void
    onCancel: () => void
  }

  let { connection = null, onSave, onCancel }: Props = $props()

  let name = $state('')
  let baseUrl = $state('http://localhost:1234/v1')
  let apiKey = $state('')
  let showApiKey = $state(false)
  let seededConnection = $state<LmStudioConnection | null | undefined>(undefined)

  $effect(() => {
    if (connection === seededConnection) return
    seededConnection = connection
    name = connection?.name ?? ''
    baseUrl = connection?.baseUrl ?? 'http://localhost:1234/v1'
    apiKey = connection?.apiKey ?? ''
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
      createdAt: connection?.createdAt ?? now,
      updatedAt: now,
    })
  }
</script>

<form class="profile-form" onsubmit={(e) => { e.preventDefault(); handleSubmit() }}>
  <h3>{connection ? 'Edit Connection' : 'New Connection'}</h3>

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
  .field-hint {
    font-weight: 400;
    opacity: 0.7;
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
    display: block;
    font-size: 0.82rem;
    color: var(--text-muted);
    margin-bottom: 0.3rem;
    font-weight: 500;
    letter-spacing: 0.02em;
  }
  input {
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
  input:focus { border-color: var(--color-accent); }
  .field-error {
    display: block;
    color: var(--color-error);
    font-size: 0.78rem;
    margin-top: 0.25rem;
  }
  .form-actions {
    display: flex;
    gap: 0.6rem;
    margin-top: 1.1rem;
  }
</style>
