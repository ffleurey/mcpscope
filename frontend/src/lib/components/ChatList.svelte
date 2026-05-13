<script lang="ts">
  import {
    activeChatId,
    chatSessions,
    deleteChat,
    selectChat,
  } from '../sessionStore'
  import { currentView } from '../navStore'

  async function handleSelect(id: string) {
    await selectChat(id)
    currentView.set('chats')
  }

  async function handleDelete(e: MouseEvent, id: string) {
    e.stopPropagation()
    await deleteChat(id)
  }
</script>

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

<style>
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
    display: block;
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
