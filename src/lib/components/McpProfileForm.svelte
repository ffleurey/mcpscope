<script lang="ts">
  import type { McpServerProfile } from '../types'

  interface Props {
    profile?: McpServerProfile | null
    onSave: (profile: McpServerProfile) => void
    onCancel: () => void
  }

  let { profile = null, onSave, onCancel }: Props = $props()

  let name = $state(profile?.name ?? '')
  let url = $state(profile?.url ?? '')

  let errors = $state<Record<string, string>>({})

  function validate(): boolean {
    const e: Record<string, string> = {}
    if (!name.trim()) e.name = 'Name is required'
    if (!url.trim()) {
      e.url = 'URL is required'
    } else {
      try { new URL(url) } catch { e.url = 'Must be a valid URL' }
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
      url: url.trim(),
      transport: 'streamable-http',
      createdAt: profile?.createdAt ?? now,
      updatedAt: now,
    })
  }
</script>

<form class="profile-form" onsubmit={(e) => { e.preventDefault(); handleSubmit() }}>
  <h3>{profile ? 'Edit MCP Server Profile' : 'New MCP Server Profile'}</h3>

  <div class="field">
    <label for="mcp-name">Name</label>
    <input id="mcp-name" type="text" bind:value={name} placeholder="e.g. Local MCP Server" />
    {#if errors.name}<span class="field-error">{errors.name}</span>{/if}
  </div>

  <div class="field">
    <label for="mcp-url">Server URL</label>
    <input id="mcp-url" type="text" bind:value={url} placeholder="http://localhost:3000/mcp" />
    {#if errors.url}<span class="field-error">{errors.url}</span>{/if}
  </div>

  <div class="field">
    <label>Transport</label>
    <input type="text" value="streamable-http" disabled />
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
  input:disabled { opacity: 0.5; cursor: not-allowed; }
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
