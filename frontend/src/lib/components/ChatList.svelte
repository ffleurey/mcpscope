<script lang="ts">
  import {
    activeChatId,
    chatSessions,
    deleteChat,
    importTraceFile,
    isImportingTrace,
    selectChat,
    startDraftSession,
  } from '../sessionStore'
  import { modelConfigs } from '../connectionStore'

  let importInput = $state<HTMLInputElement | null>(null)

  function handleNewChat() {
    startDraftSession()
  }

  async function handleSelect(id: string) {
    await selectChat(id)
  }

  async function handleDelete(e: MouseEvent, id: string) {
    e.stopPropagation()
    await deleteChat(id)
  }

  function handleImportClick() {
    importInput?.click()
  }

  async function handleImportChange(event: Event) {
    const target = event.currentTarget as HTMLInputElement | null
    const file = target?.files?.[0]
    if (!file) return

    try {
      await importTraceFile(file)
    } finally {
      if (target) target.value = ''
    }
  }
</script>

<div class="chat-list">
  <div class="chat-list-header">
    <input bind:this={importInput} type="file" accept="application/json" hidden onchange={handleImportChange} />

    <div class="session-actions">
      {#if $modelConfigs.length === 0}
        <span class="no-profiles">Create a model config first</span>
      {:else}
        <button class="btn btn-sm new-chat-btn" onclick={handleNewChat}>+ New Session</button>
      {/if}

      <button class="btn btn-sm import-btn" onclick={handleImportClick} disabled={$isImportingTrace}>
        {$isImportingTrace ? 'Importing…' : 'Import Trace'}
      </button>
    </div>
  </div>

  {#if $chatSessions.length === 0}
    <div class="empty">No sessions yet</div>
  {:else}
    <ul class="sessions">
      {#each $chatSessions as session (session.id)}
        <li class="session-item" class:active={$activeChatId === session.id}>
          <button
            class="session-button"
            onclick={() => handleSelect(session.id)}
            onkeydown={(e) => e.key === 'Enter' && handleSelect(session.id)}
          >
            <span class="session-title">{session.title}</span>
          </button>
          <button
            class="delete-btn"
            title="Delete session"
            onclick={(e) => handleDelete(e, session.id)}
          >×</button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .chat-list {
    display: flex;
    flex-direction: column;
    flex: 1;
    overflow: hidden;
  }

  .chat-list-header {
    padding: 0.5rem 0.75rem;
    border-bottom: 1px solid var(--border-subtle);
  }

  .session-actions {
    display: flex;
    gap: 0.4rem;
    align-items: center;
  }

  .no-profiles {
    font-size: 0.75rem;
    color: var(--text-muted);
    flex: 1;
  }

  .new-chat-btn {
    flex: 1;
    justify-content: center;
  }

  .import-btn {
    flex-shrink: 0;
  }

  .empty {
    padding: 0.75rem;
    font-size: 0.8rem;
    color: var(--text-muted);
  }

  .sessions {
    list-style: none;
    margin: 0;
    padding: 0.25rem 0;
    overflow-y: auto;
    flex: 1;
  }

  .session-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: none;
    padding: 0.4rem 0.75rem;
    color: var(--text-muted);
    font-size: 0.82rem;
    font-family: inherit;
    transition: background 0.1s, color 0.1s;
    border-radius: 0;
    list-style: none;
  }

  .session-item:hover {
    background: var(--bg-hover);
    color: var(--text);
  }

  .session-item.active {
    background: var(--bg-active);
    color: var(--text);
  }

  .session-button {
    flex: 1;
    min-width: 0;
    background: none;
    border: none;
    color: inherit;
    cursor: pointer;
    font: inherit;
    padding: 0;
    text-align: left;
  }

  .session-title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
  }

  .delete-btn {
    flex-shrink: 0;
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-muted);
    font-size: 1rem;
    line-height: 1;
    padding: 0 0 0 0.4rem;
    opacity: 0;
    transition: opacity 0.1s, color 0.1s;
  }

  .session-item:hover .delete-btn {
    opacity: 1;
  }

  .delete-btn:hover {
    color: var(--color-error);
  }
</style>
