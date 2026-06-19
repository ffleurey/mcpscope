<script lang="ts">
  import InlineAppError from './InlineAppError.svelte'
  import { lmConnections, upsertConnection, removeConnection } from '../connectionStore'
  import type { LmStudioConnection } from '../types'
  import LmConnectionForm from './LmConnectionForm.svelte'
  import ConnectionTestDialog from './ConnectionTestDialog.svelte'
  import DialogShell from './DialogShell.svelte'
  import { testLmConnection } from '../api/backendClient'
  import { toAppError, type AppError } from '../errors'
  import { iconPlus, iconEdit, iconTrash, iconTest } from '../design/icons'
  import Icon from './Icon.svelte'
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

  let editingConn = $derived(
    editingId ? ($lmConnections.find((c) => c.id === editingId) ?? null) : null,
  )
  let detailConn = $derived(
    detailId ? ($lmConnections.find((c) => c.id === detailId) ?? null) : null,
  )

  function providerLabel(p: LmStudioConnection['providerType']): string {
    return p === 'openrouter' ? 'OpenRouter' : p === 'ollama' ? 'Ollama' : 'LM Studio'
  }

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

  async function handleSave(conn: LmStudioConnection) {
    try {
      await upsertConnection(conn)
      saveError = null
      showNew = false
      editingId = null
    } catch (e) {
      saveError = toAppError(e)
    }
  }

  async function handleDelete(id: string) {
    try {
      await removeConnection(id)
      saveError = null
      if (editingId === id) editingId = null
      delete testState[id]
    } catch (e) {
      saveError = toAppError(e)
    }
  }

  async function handleTest(conn: LmStudioConnection) {
    testState[conn.id] = { status: 'testing', message: 'Testing…' }
    try {
      const result = await testLmConnection(conn.baseUrl, conn.apiKey, conn.providerType)
      testState[conn.id] = {
        status: 'ok',
        message: `Connected · ${result.models.length} model${result.models.length === 1 ? '' : 's'}`,
        details: { Models: result.models.length > 0 ? result.models.join(', ') : 'none' },
      }
    } catch (e) {
      const error = toAppError(e)
      testState[conn.id] = { status: 'error', message: error.message, rawDetails: error.details }
    }
  }

  function openDetail(id: string) {
    if (testState[id]?.status !== 'testing') detailId = id
  }
</script>

<div class="config-view">
  <div class="config-view-header">
    <h2>Connections</h2>
    <button class="btn" onclick={startNew}>
      <span class="btn-icon"><Icon path={iconPlus} /></span> New connection
    </button>
  </div>

  <InlineAppError error={saveError} />

  {#if $lmConnections.length === 0}
    <p class="config-empty">No connections yet. Add one to get started.</p>
  {:else}
    <div class="table-scroll">
      <table class="data-table" use:columnResize>
        <colgroup>
          <col style="width: 12rem" />
          <col style="width: 7.5rem" />
          <col class="col-flex" />
          <col style="width: 6.5rem" />
          <col style="width: 16rem" />
          <col style="width: 8.5rem" />
        </colgroup>
        <thead>
          <tr>
            <th>Name</th>
            <th>Provider</th>
            <th>Base URL</th>
            <th>Auth</th>
            <th>Test</th>
            <th class="col-actions">Actions</th>
          </tr>
        </thead>
        <tbody>
          {#each $lmConnections as conn (conn.id)}
            <tr>
              <td title={conn.name}>{conn.name}</td>
              <td>{providerLabel(conn.providerType)}</td>
              <td class="col-mono" title={conn.baseUrl}>{conn.baseUrl}</td>
              <td>{conn.apiKey ? 'Key set' : '—'}</td>
              <td>
                {#if testState[conn.id]}
                  {@const t = testState[conn.id]}
                  <button
                    class="status-cell"
                    disabled={t.status === 'testing'}
                    title={t.message}
                    onclick={() => openDetail(conn.id)}
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
                    onclick={() => handleTest(conn)}><Icon path={iconTest} /></button
                  >
                  <button
                    class="icon-btn"
                    title="Edit"
                    aria-label="Edit"
                    onclick={() => startEdit(conn.id)}><Icon path={iconEdit} /></button
                  >
                  <button
                    class="icon-btn icon-btn-danger"
                    title="Delete"
                    aria-label="Delete"
                    onclick={() => handleDelete(conn.id)}><Icon path={iconTrash} /></button
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
  <DialogShell title="New connection" onClose={cancelNew}>
    <LmConnectionForm onSave={handleSave} onCancel={cancelNew} />
  </DialogShell>
{/if}

{#if editingConn}
  <DialogShell title="Edit connection" onClose={cancelEdit}>
    <LmConnectionForm connection={editingConn} onSave={handleSave} onCancel={cancelEdit} />
  </DialogShell>
{/if}

{#if detailConn && testState[detailConn.id]}
  {@const t = testState[detailConn.id]}
  <ConnectionTestDialog
    title="{providerLabel(detailConn.providerType)} Connection Test"
    target={detailConn.baseUrl}
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
