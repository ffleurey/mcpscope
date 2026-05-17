<script lang="ts">
  import InlineAppError from './InlineAppError.svelte'
  import { mcpProfiles, upsertMcpProfile, removeMcpProfile, sessionCreationDefaults, setDefaultMcpProfile } from '../connectionStore'
  import type { McpServerProfile } from '../types'
  import McpProfileForm from './McpProfileForm.svelte'
  import ConnectionTestDialog from './ConnectionTestDialog.svelte'
  import { testMcpProfile } from '../api/backendClient'
  import { toAppError, type AppError } from '../errors'

  let editingId = $state<string | null>(null)
  let showNew = $state(false)
  let saveError = $state<AppError | null>(null)
  let testDialogProfile = $state<McpServerProfile | null>(null)
  let testDialogResult = $state<{ ok: boolean; message: string; details?: Record<string, unknown>; rawDetails?: unknown } | null>(null)

  function startNew() { showNew = true; editingId = null }
  function cancelNew() { showNew = false }
  function startEdit(id: string) { editingId = id; showNew = false }
  function cancelEdit() { editingId = null }

  async function handleSave(profile: McpServerProfile) {
    try {
      await upsertMcpProfile(profile)
      saveError = null
      showNew = false
      editingId = null
    } catch (e) {
      saveError = toAppError(e)
    }
  }

  async function handleDelete(id: string) {
    try {
      await removeMcpProfile(id)
      saveError = null
      if (editingId === id) editingId = null
    } catch (e) {
      saveError = toAppError(e)
    }
  }

  async function handleTest(profile: McpServerProfile) {
    testDialogProfile = profile
    testDialogResult = { ok: false, message: 'Testing…' }
    try {
      const result = await testMcpProfile(profile.url)
      testDialogResult = {
        ok: true,
        message: `${result.serverName} v${result.serverVersion}`,
        details: { Tools: result.tools.length > 0 ? result.tools.join(', ') : 'none' },
      }
    } catch (e) {
      const error = toAppError(e)
      testDialogResult = {
        ok: false,
        message: error.message,
        rawDetails: error.details,
      }
    }
  }

  async function handleSetDefault(id: string) {
    try {
      await setDefaultMcpProfile(id)
      saveError = null
    } catch (e) {
      saveError = toAppError(e)
    }
  }

  async function handleClearDefault() {
    try {
      await setDefaultMcpProfile(null)
      saveError = null
    } catch (e) {
      saveError = toAppError(e)
    }
  }

  function closeTestDialog() {
    testDialogProfile = null
    testDialogResult = null
  }
</script>

<div class="view">
  <div class="view-header">
    <h2>MCP Server Profiles</h2>
    {#if !showNew}
      <button class="btn btn-primary" onclick={startNew}>New Profile</button>
    {/if}
  </div>

  <InlineAppError error={saveError} />

  {#if showNew}
    <McpProfileForm onSave={handleSave} onCancel={cancelNew} />
  {/if}

  {#if $mcpProfiles.length === 0 && !showNew}
    <p class="empty-state">No MCP server profiles yet. Create one to get started.</p>
  {/if}

  {#each $mcpProfiles as profile (profile.id)}
    {#if editingId === profile.id}
      <McpProfileForm profile={profile} onSave={handleSave} onCancel={cancelEdit} />
    {:else}
      {@const isDefault = $sessionCreationDefaults?.defaultMcpProfileId === profile.id}
      <div class="profile-card" class:is-default={isDefault}>
        <div class="card-header">
          <div class="card-title-group">
            <div class="card-name-row">
              <span class="card-name">{profile.name}</span>
              {#if isDefault}
                <span class="default-badge">Default for new sessions</span>
              {/if}
            </div>
          </div>
          <div class="card-actions">
            <button class="btn btn-sm" onclick={() => handleTest(profile)}>Test Connection</button>
            {#if isDefault}
              <button class="btn btn-sm btn-warning" onclick={handleClearDefault}>Clear default</button>
            {:else}
              <button class="btn btn-sm btn-accent" onclick={() => handleSetDefault(profile.id)}>Set as default</button>
            {/if}
            <button class="btn btn-sm" onclick={() => startEdit(profile.id)}>Edit</button>
            <button class="btn btn-sm btn-danger" onclick={() => handleDelete(profile.id)}>Delete</button>
          </div>
        </div>
        <dl class="card-details">
          <div class="detail-row">
            <dt>URL</dt><dd><code>{profile.url}</code></dd>
          </div>
          <div class="detail-row">
            <dt>Transport</dt><dd>{profile.transport}</dd>
          </div>
        </dl>
      </div>
    {/if}
  {/each}
</div>

{#if testDialogProfile && testDialogResult}
  <ConnectionTestDialog
    title="MCP Connection Test"
    target={testDialogProfile.url}
    result={testDialogResult}
    onClose={closeTestDialog}
  />
{/if}

<style>
  .view { padding: 1.5rem 2rem; }
  .view-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 1.5rem;
  }
  h2 {
    margin: 0;
    font-size: 1.15rem;
    font-weight: 600;
    color: var(--text);
  }
  .empty-state { color: var(--text-muted); font-size: 0.9rem; }
  .profile-card {
    background: var(--bg-panel);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 1rem 1.25rem;
    margin-bottom: 1rem;
  }
  .profile-card.is-default {
    border-color: var(--color-accent);
  }
  .card-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    margin-bottom: 0.75rem;
    gap: 0.5rem;
  }
  .card-title-group {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    min-width: 0;
  }
  .card-name-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .card-name { font-weight: 600; font-size: 0.95rem; color: var(--text); }
  .default-badge {
    display: inline-block;
    background: color-mix(in srgb, var(--color-accent) 15%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-accent) 40%, transparent);
    color: var(--color-accent);
    border-radius: 3px;
    padding: 0.1rem 0.45rem;
    font-size: 0.72rem;
    font-weight: 600;
    white-space: nowrap;
  }
  .card-actions { display: flex; gap: 0.5rem; }
  .card-details { margin: 0; }
  .detail-row {
    display: flex;
    gap: 0.75rem;
    font-size: 0.82rem;
    padding: 0.2rem 0;
    border-bottom: 1px solid var(--border-subtle);
  }
  .detail-row:last-child { border-bottom: none; }
  dt { color: var(--text-muted); min-width: 80px; flex-shrink: 0; }
  dd { margin: 0; color: var(--text); word-break: break-all; }
  code { font-family: var(--mono); font-size: 0.8rem; }
  .btn-accent {
    background: color-mix(in srgb, var(--color-accent) 15%, transparent);
    border-color: color-mix(in srgb, var(--color-accent) 40%, transparent);
    color: var(--color-accent);
  }
  .btn-accent:hover {
    background: color-mix(in srgb, var(--color-accent) 25%, transparent);
  }
  .btn-warning {
    background: color-mix(in srgb, #f59e0b 12%, transparent);
    border-color: color-mix(in srgb, #f59e0b 35%, transparent);
    color: #f59e0b;
  }
  .btn-warning:hover {
    background: color-mix(in srgb, #f59e0b 22%, transparent);
  }
</style>
