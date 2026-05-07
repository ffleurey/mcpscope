<script lang="ts">
  import { chatSessions, activeChatId, activeMessages, selectChat, deleteChat } from '../chatStore'
  import { modelConfigs } from '../connectionStore'

  function handleNewChat() {
    activeChatId.set(null)
    activeMessages.set([])
  }

  async function handleSelect(id: string) {
    await selectChat(id)
  }

  async function handleDelete(e: MouseEvent, id: string) {
    e.stopPropagation()
    await deleteChat(id)
  }
</script>

<div class="chat-list">
  <div class="chat-list-header">
    {#if $modelConfigs.length === 0}
      <span class="no-profiles">Create a model config first</span>
    {:else}
      <button class="btn btn-sm new-chat-btn" onclick={handleNewChat}>+ New Chat</button>
    {/if}
  </div>

  {#if $chatSessions.length === 0}
    <div class="empty">No chats yet</div>
  {:else}
    <ul class="sessions">
      {#each $chatSessions as session (session.id)}
        <li
          class="session-item"
          class:active={$activeChatId === session.id}
          role="button"
          tabindex="0"
          onclick={() => handleSelect(session.id)}
          onkeydown={(e) => e.key === 'Enter' && handleSelect(session.id)}
        >
          <span class="session-title">{session.title}</span>
          <button
            class="delete-btn"
            title="Delete chat"
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

  .no-profiles {
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .new-chat-btn {
    width: 100%;
    justify-content: center;
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
    width: 100%;
    background: none;
    border: none;
    cursor: pointer;
    padding: 0.4rem 0.75rem;
    text-align: left;
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
