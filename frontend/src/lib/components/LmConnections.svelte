<script lang="ts">
  import { lmConnections, upsertConnection, removeConnection } from '../connectionStore'
  import type { LmStudioConnection } from '../types'
  import LmConnectionForm from './LmConnectionForm.svelte'
  import ConnectionTestDialog from './ConnectionTestDialog.svelte'
  import { testLmConnection } from '../api/backendClient'

  let editingId = $state<string | null>(null)
  let showNew = $state(false)
  let saveError = $state<string | null>(null)
  let testDialogConn = $state<LmStudioConnection | null>(null)
  let testDialogResult = $state<{ ok: boolean; message: string; details?: Record<string, unknown>; rawDetails?: unknown } | null>(null)

  function startNew() { showNew = true; editingId = null }
  function cancelNew() { showNew = false }
  function startEdit(id: string) { editingId = id; showNew = false }
  function cancelEdit() { editingId = null }

  async function handleSave(conn: LmStudioConnection) {
    try {
      await upsertConnection(conn)
      showNew = false
      editingId = null
    } catch (e) {
      saveError = e instanceof Error ? e.message : String(e)
    }
  }

  async function handleDelete(id: string) {
    try {
      await removeConnection(id)
      if (editingId === id) editingId = null
    } catch (e) {
      saveError = e instanceof Error ? e.message : String(e)
    }
  }

  async function handleTest(conn: LmStudioConnection) {
    testDialogConn = conn
    testDialogResult = { ok: false, message: 'Testing…' }
    try {
      const result = await testLmConnection(conn.baseUrl, conn.apiKey)
      testDialogResult = {
        ok: true,
        message: 'Connected',
        details: { Models: result.models.length > 0 ? result.models.join(', ') : 'none' },
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const details = (e as { details?: unknown }).details
      testDialogResult = { ok: false, message: msg, rawDetails: details }
    }
  }

  function closeTestDialog() {
    testDialogConn = null
    testDialogResult = null
  }
</script>

<div class="view">
  <div class="view-header">
    <h2>LM Studio Connections</h2>
    {#if !showNew}
      <button class="btn btn-primary" onclick={startNew}>+ New Connection</button>
    {/if}
  </div>

  {#if saveError}
    <p class="save-error">{saveError}</p>
  {/if}

  {#if showNew}
    <LmConnectionForm onSave={handleSave} onCancel={cancelNew} />
  {/if}

  {#if $lmConnections.length === 0 && !showNew}
    <p class="empty-state">No connections yet. Add one to get started.</p>
  {/if}

  {#each $lmConnections as conn (conn.id)}
    {#if editingId === conn.id}
      <LmConnectionForm connection={conn} onSave={handleSave} onCancel={cancelEdit} />
    {:else}
      <div class="profile-card">
        <div class="card-header">
          <span class="card-name">{conn.name}</span>
          <div class="card-actions">
            <button class="btn btn-sm" onclick={() => handleTest(conn)}>Test Connection</button>
            <button class="btn btn-sm" onclick={() => startEdit(conn.id)}>Edit</button>
            <button class="btn btn-sm btn-danger" onclick={() => handleDelete(conn.id)}>Delete</button>
          </div>
        </div>
        <dl class="card-details">
          <div class="detail-row">
            <dt>Base URL</dt><dd><code>{conn.baseUrl}</code></dd>
          </div>
          <div class="detail-row">
            <dt>API Key</dt><dd>{conn.apiKey ? '••••••••' : 'none'}</dd>
          </div>
        </dl>
      </div>
    {/if}
  {/each}
</div>

{#if testDialogConn && testDialogResult}
  <ConnectionTestDialog
    title="LM Studio Connection Test"
    target={testDialogConn.baseUrl}
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
  .save-error { color: var(--color-error); font-size: 0.875rem; margin-bottom: 1rem; }
  .profile-card {
    background: var(--bg-panel);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 1rem 1.25rem;
    margin-bottom: 1rem;
  }
  .card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.75rem;
  }
  .card-name { font-weight: 600; font-size: 0.95rem; color: var(--text); }
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
</style>

