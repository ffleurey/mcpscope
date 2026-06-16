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

<form class="form-stack" onsubmit={(e) => { e.preventDefault(); handleSubmit() }}>

  <div class="field">
    <label class="field-label" for="mcp-name">Name</label>
    <input id="mcp-name" class="field-input" type="text" bind:value={name} placeholder="e.g. Local MCP Server" />
    {#if errors.name}<span class="field-errortext">{errors.name}</span>{/if}
  </div>

  <div class="field">
    <label class="field-label" for="mcp-id">ID</label>
    {#if profile}
      <span class="field-static">{customId}</span>
    {:else}
      <input id="mcp-id" class="field-input" type="text" bind:value={customId} placeholder="auto-generated from name" />
    {/if}
    {#if errors.customId}<span class="field-errortext">{errors.customId}</span>{/if}
    {#if !profile}<span class="field-hinttext">Set once at creation, cannot be changed later.</span>{/if}
  </div>

  <div class="field">
    <label class="field-label" for="mcp-url">Server URL</label>
    <input id="mcp-url" class="field-input" type="text" bind:value={url} placeholder="http://localhost:3000/mcp" />
    {#if errors.url}<span class="field-errortext">{errors.url}</span>{/if}
  </div>

  <div class="field">
    <span class="field-label">Transport</span>
    <span class="field-static">streamable-http</span>
  </div>

  <div class="form-actions">
    <button type="submit" class="btn btn-primary">Save</button>
    <button type="button" class="btn" onclick={onCancel}>Cancel</button>
  </div>
</form>
