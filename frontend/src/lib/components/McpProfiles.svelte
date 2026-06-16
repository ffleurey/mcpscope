<script lang="ts">
  import InlineAppError from './InlineAppError.svelte'
  import { mcpProfiles, upsertMcpProfile, removeMcpProfile } from '../connectionStore'
  import type { McpServerProfile } from '../types'
  import McpProfileForm from './McpProfileForm.svelte'
  import ConnectionTestDialog from './ConnectionTestDialog.svelte'
  import DialogShell from './DialogShell.svelte'
  import { testMcpProfile } from '../api/backendClient'
  import { toAppError, type AppError } from '../errors'
  import {
    iconPlus,
    iconEdit,
    iconTrash,
    iconTest,
    iconCheckboxMarked,
    iconCheckboxBlank,
  } from '../design/icons'
  import { columnResize } from '../actions/columnResize'

  // Ephemeral, per-page test results — reset when the view unmounts (navigating away).
  type TestEntry = {
    status: 'testing' | 'ok' | 'error'
    message: string
    details?: Record<string, unknown>
    rawDetails?: unknown
  }

  let editingId = $state<string | null>(null)
  let showNew = $state(false)
  let saveError = $state<AppError | null>(null)
  let testState = $state<Record<string, TestEntry>>({})
  let detailId = $state<string | null>(null)

  let editingProfile = $derived(
    editingId ? ($mcpProfiles.find((p) => p.id === editingId) ?? null) : null,
  )
  let detailProfile = $derived(
    detailId ? ($mcpProfiles.find((p) => p.id === detailId) ?? null) : null,
  )

  function dotClass(status: TestEntry['status']): string {
    return status === 'ok' ? 'running' : status === 'error' ? 'error' : 'warn'
  }

  function startNew() {
    showNew = true
    editingId = null
  }
  function cancelNew() {
    showNew = false
  }
  function startEdit(id: string) {
    editingId = id
    showNew = false
  }
  function cancelEdit() {
    editingId = null
  }

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
      delete testState[id]
    } catch (e) {
      saveError = toAppError(e)
    }
  }

  async function handleToggleDefault(profile: McpServerProfile) {
    try {
      await upsertMcpProfile({ ...profile, defaultEnabled: !profile.defaultEnabled })
      saveError = null
    } catch (e) {
      saveError = toAppError(e)
    }
  }

  async function handleTest(profile: McpServerProfile) {
    testState[profile.id] = { status: 'testing', message: 'Testing…' }
    try {
      const result = await testMcpProfile(profile.url)
      testState[profile.id] = {
        status: 'ok',
        message: `${result.serverName} v${result.serverVersion} · ${result.tools.length} tool${result.tools.length === 1 ? '' : 's'}`,
        details: { Tools: result.tools.length > 0 ? result.tools.join(', ') : 'none' },
      }
    } catch (e) {
      const error = toAppError(e)
      testState[profile.id] = { status: 'error', message: error.message, rawDetails: error.details }
    }
  }

  function openDetail(id: string) {
    if (testState[id]?.status !== 'testing') detailId = id
  }
</script>

<div class="config-view">
  <div class="config-view-header">
    <h2>MCP Server Profiles</h2>
    <button class="btn btn-primary" onclick={startNew}>
      <span class="btn-icon">{@html iconPlus}</span> New profile
    </button>
  </div>

  <InlineAppError error={saveError} />

  {#if $mcpProfiles.length === 0}
    <p class="config-empty">No MCP server profiles yet. Create one to get started.</p>
  {:else}
    <div class="table-scroll">
      <table class="data-table" use:columnResize>
        <colgroup>
          <col style="width: 3rem" />
          <col style="width: 13rem" />
          <col style="width: 11rem" />
          <col style="width: 18rem" />
          <col style="width: 16rem" />
          <col style="width: 8rem" />
        </colgroup>
        <thead>
          <tr>
            <th class="col-toggle" title="Default for new sessions" aria-label="Default"></th>
            <th>Name</th>
            <th>ID</th>
            <th>URL</th>
            <th>Test</th>
            <th class="col-actions">Actions</th>
          </tr>
        </thead>
        <tbody>
          {#each $mcpProfiles as profile (profile.id)}
            <tr>
              <td class="col-toggle">
                <button
                  class="icon-btn"
                  class:icon-glow={profile.defaultEnabled}
                  class:icon-off={!profile.defaultEnabled}
                  title={profile.defaultEnabled
                    ? 'Default for new sessions — click to unset'
                    : 'Set as default for new sessions'}
                  aria-label="Toggle default for new sessions"
                  aria-pressed={profile.defaultEnabled}
                  onclick={() => handleToggleDefault(profile)}
                  >{@html profile.defaultEnabled ? iconCheckboxMarked : iconCheckboxBlank}</button
                >
              </td>
              <td title={profile.name}>{profile.name}</td>
              <td class="col-mono" title={profile.id}>{profile.id}</td>
              <td class="col-mono" title={profile.url}>{profile.url}</td>
              <td>
                {#if testState[profile.id]}
                  {@const t = testState[profile.id]}
                  <button
                    class="status-cell"
                    disabled={t.status === 'testing'}
                    title={t.message}
                    onclick={() => openDetail(profile.id)}
                  >
                    <span class="status-dot {dotClass(t.status)}"></span>
                    <span class="status-text">{t.message}</span>
                  </button>
                {:else}
                  <span class="status-muted">—</span>
                {/if}
              </td>
              <td class="col-actions">
                <span class="row-actions">
                  <button
                    class="icon-btn"
                    title="Test connection"
                    aria-label="Test connection"
                    onclick={() => handleTest(profile)}>{@html iconTest}</button
                  >
                  <button
                    class="icon-btn"
                    title="Edit"
                    aria-label="Edit"
                    onclick={() => startEdit(profile.id)}>{@html iconEdit}</button
                  >
                  <button
                    class="icon-btn icon-btn-danger"
                    title="Delete"
                    aria-label="Delete"
                    onclick={() => handleDelete(profile.id)}>{@html iconTrash}</button
                  >
                </span>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>

{#if showNew}
  <DialogShell title="New MCP Server Profile" onClose={cancelNew}>
    <McpProfileForm onSave={handleSave} onCancel={cancelNew} />
  </DialogShell>
{/if}

{#if editingProfile}
  <DialogShell title="Edit MCP Server Profile" onClose={cancelEdit}>
    <McpProfileForm profile={editingProfile} onSave={handleSave} onCancel={cancelEdit} />
  </DialogShell>
{/if}

{#if detailProfile && testState[detailProfile.id]}
  {@const t = testState[detailProfile.id]}
  <ConnectionTestDialog
    title="MCP Connection Test"
    target={detailProfile.url}
    result={{
      ok: t.status === 'ok',
      message: t.message,
      details: t.details,
      rawDetails: t.rawDetails,
    }}
    onClose={() => {
      detailId = null
    }}
  />
{/if}
