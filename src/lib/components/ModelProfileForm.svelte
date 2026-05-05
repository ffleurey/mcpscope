<script lang="ts">
  import type { ModelProfile } from '../types'

  interface Props {
    profile?: ModelProfile | null
    onSave: (profile: ModelProfile) => void
    onCancel: () => void
  }

  let { profile = null, onSave, onCancel }: Props = $props()

  let name = $state(profile?.name ?? '')
  let modelId = $state(profile?.modelId ?? '')
  let baseUrl = $state(profile?.baseUrl ?? 'http://localhost:1234/v1')
  let systemPrompt = $state(profile?.systemPrompt ?? '')
  let temperature = $state(profile?.temperature ?? 0.7)
  let contextWindowSize = $state<string>(profile?.contextWindowSize != null ? String(profile.contextWindowSize) : '')

  let errors = $state<Record<string, string>>({})

  function validate(): boolean {
    const e: Record<string, string> = {}
    if (!name.trim()) e.name = 'Name is required'
    // modelId is optional — can be selected per chat
    if (!baseUrl.trim()) {
      e.baseUrl = 'Base URL is required'
    } else {
      try { new URL(baseUrl) } catch { e.baseUrl = 'Must be a valid URL' }
    }
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
      id: profile?.id ?? crypto.randomUUID(),
      name: name.trim(),
      modelId: modelId.trim(),
      baseUrl: baseUrl.trim(),
      systemPrompt: systemPrompt.trim(),
      temperature,
      contextWindowSize: contextWindowSize !== '' ? Number(contextWindowSize) : null,
      createdAt: profile?.createdAt ?? now,
      updatedAt: now,
    })
  }
</script>

<form class="profile-form" onsubmit={(e) => { e.preventDefault(); handleSubmit() }}>
  <h3>{profile ? 'Edit Model Profile' : 'New Model Profile'}</h3>

  <div class="field">
    <label for="mp-name">Name</label>
    <input id="mp-name" type="text" bind:value={name} placeholder="e.g. GPT-4 Local" />
    {#if errors.name}<span class="field-error">{errors.name}</span>{/if}
  </div>

  <div class="field">
    <label for="mp-model-id">Model ID (optional — can be selected per chat)</label>
    <input id="mp-model-id" type="text" bind:value={modelId} placeholder="e.g. meta-llama-3.1-8b — leave blank to select in chat" />
    {#if errors.modelId}<span class="field-error">{errors.modelId}</span>{/if}
  </div>

  <div class="field">
    <label for="mp-base-url">Base URL</label>
    <input id="mp-base-url" type="text" bind:value={baseUrl} placeholder="http://localhost:1234/v1" />
    {#if errors.baseUrl}<span class="field-error">{errors.baseUrl}</span>{/if}
  </div>

  <div class="field">
    <label for="mp-system-prompt">System Prompt</label>
    <textarea id="mp-system-prompt" bind:value={systemPrompt} rows="4" placeholder="Optional system prompt"></textarea>
  </div>

  <div class="field field-row">
    <div class="sub-field">
      <label for="mp-temperature">Temperature</label>
      <input id="mp-temperature" type="number" step="0.1" min="0" max="2" bind:value={temperature} />
      {#if errors.temperature}<span class="field-error">{errors.temperature}</span>{/if}
    </div>
    <div class="sub-field">
      <label for="mp-ctx">Context Window (tokens)</label>
      <input id="mp-ctx" type="number" step="1" min="1" bind:value={contextWindowSize} placeholder="optional" />
      {#if errors.contextWindowSize}<span class="field-error">{errors.contextWindowSize}</span>{/if}
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
  .field {
    margin-bottom: 0.9rem;
  }
  .field-row {
    display: flex;
    gap: 1rem;
  }
  .sub-field {
    flex: 1;
  }
  label {
    display: block;
    font-size: 0.82rem;
    color: var(--text-muted);
    margin-bottom: 0.3rem;
    font-weight: 500;
    letter-spacing: 0.02em;
  }
  input, textarea {
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
  input:focus, textarea:focus {
    border-color: var(--color-accent);
  }
  textarea {
    resize: vertical;
  }
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
