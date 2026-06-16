<script lang="ts">
  import type { McpServerProfile } from '../types'
  import { mcpProfiles } from '../connectionStore'

  interface Props {
    profile?: McpServerProfile | null
    onSave: (profile: McpServerProfile) => void
    onCancel: () => void
  }

  let { profile = null, onSave, onCancel }: Props = $props()

  // Slugify: lowercase, replace spaces with hyphens, remove non-alphanum except - _
  function slugify(text: string): string {
    return text.toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9_-]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '')
  }

  let name = $state('')
  let customId = $state('')
  let url = $state('')
  let seededProfile = $state<McpServerProfile | null | undefined>(undefined)

  $effect(() => {
    if (profile === seededProfile) return
    seededProfile = profile
    name = profile?.name ?? ''
    customId = profile?.id ?? slugify(profile?.name ?? '')
    url = profile?.url ?? ''
  })

  // Auto-generate ID from name, but only when creating (not editing existing)
  let isNew = $derived(!profile)
  $effect(() => {
    if (isNew && name) {
      let slug = slugify(name)
      if (!slug) slug = 'untitled'
      // Check for collision with existing MCP profiles
      const existing = $mcpProfiles
      if (existing.some(p => p.id === slug)) {
        let counter = 2
        while (existing.some(p => p.id === `${slug}-${counter}`)) {
          counter++
        }
        slug = `${slug}-${counter}`
      }
      customId = slug
    }
  })

  let errors = $state<Record<string, string>>({})

  function validate(): boolean {
    const e: Record<string, string> = {}
    if (!name.trim()) e.name = 'Name is required'
    if (!customId.trim()) e.customId = 'ID is required'
    if (customId.trim() && !/^[a-zA-Z0-9_-]+$/.test(customId.trim())) {
      e.customId = 'ID must only contain letters, numbers, hyphens, and underscores'
    }
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
      id: customId.trim(),
      name: name.trim(),
      url: url.trim(),
      transport: 'streamable-http',
      authType: profile?.authType ?? null,
      authValue: profile?.authValue ?? null,
      defaultEnabled: profile?.defaultEnabled ?? false,
      createdAt: profile?.createdAt ?? now,
      updatedAt: now,
    })
  }
</script>

<form class="profile-form" onsubmit={(e) => { e.preventDefault(); handleSubmit() }}>

  <div class="field">
    <label for="mcp-name">Name</label>
    <input id="mcp-name" type="text" bind:value={name} placeholder="e.g. Local MCP Server" />
    {#if errors.name}<span class="field-error">{errors.name}</span>{/if}
  </div>

  <div class="field">
    <label for="mcp-id">ID</label>
    {#if profile}
      <input id="mcp-id" type="text" value={customId} disabled class="readonly-field" />
    {:else}
      <input id="mcp-id" type="text" bind:value={customId} placeholder="auto-generated from name" />
    {/if}
    {#if errors.customId}<span class="field-error">{errors.customId}</span>{/if}
    {#if !profile}<span class="field-hint">Set once at creation, cannot be changed later.</span>{/if}
  </div>

  <div class="field">
    <label for="mcp-url">Server URL</label>
    <input id="mcp-url" type="text" bind:value={url} placeholder="http://localhost:3000/mcp" />
    {#if errors.url}<span class="field-error">{errors.url}</span>{/if}
  </div>

  <div class="field">
    <label for="mcp-transport">Transport</label>
    <input id="mcp-transport" type="text" value="streamable-http" disabled />
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
  label {
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  input {
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
  input:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .field-error {
    font-size: 0.75rem;
    color: var(--red-bright);
  }
  .field-hint {
    font-size: 0.75rem;
    color: var(--text-dim);
  }
  .form-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    padding-top: 0.25rem;
  }
</style>
