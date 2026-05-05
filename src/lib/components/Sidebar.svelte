<script lang="ts">
  import { currentView } from '../navStore'
  import type { NavView } from '../types'
  import ChatList from './ChatList.svelte'

  function navigate(view: NavView) {
    currentView.set(view)
  }
</script>

<nav class="sidebar">
  <div class="sidebar-title">AI Client</div>
  <ul class="nav-list">
    <li>
      <button
        class="nav-item"
        class:active={$currentView === 'chats'}
        onclick={() => navigate('chats')}
      >
        Chats
      </button>
    </li>
    <li>
      <button
        class="nav-item"
        class:active={$currentView === 'model-profiles'}
        onclick={() => navigate('model-profiles')}
      >
        Model Profiles
      </button>
    </li>
    <li>
      <button
        class="nav-item"
        class:active={$currentView === 'mcp-profiles'}
        onclick={() => navigate('mcp-profiles')}
      >
        MCP Profiles
      </button>
    </li>
  </ul>

  {#if $currentView === 'chats'}
    <div class="chat-list-container">
      <ChatList />
    </div>
  {/if}
</nav>

<style>
  .sidebar {
    width: 240px;
    flex-shrink: 0;
    background: var(--bg-sidebar);
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    height: 100vh;
    position: sticky;
    top: 0;
  }
  .sidebar-title {
    padding: 1.1rem 1.25rem 0.9rem;
    font-size: 0.95rem;
    font-weight: 700;
    color: var(--text);
    letter-spacing: 0.03em;
    border-bottom: 1px solid var(--border);
  }
  .nav-list {
    list-style: none;
    margin: 0;
    padding: 0.5rem 0;
    border-bottom: 1px solid var(--border-subtle);
  }
  .nav-item {
    display: block;
    width: 100%;
    text-align: left;
    background: none;
    border: none;
    cursor: pointer;
    padding: 0.5rem 1.25rem;
    font-size: 0.88rem;
    color: var(--text-muted);
    border-radius: 0;
    transition: background 0.1s, color 0.1s;
  }
  .nav-item:hover {
    background: var(--bg-hover);
    color: var(--text);
  }
  .nav-item.active {
    color: var(--text);
    background: var(--bg-active);
    font-weight: 500;
  }
  .chat-list-container {
    display: flex;
    flex-direction: column;
    flex: 1;
    overflow: hidden;
  }
</style>
