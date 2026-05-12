<script lang="ts">
  import { onMount } from 'svelte'
  import { currentView } from './lib/navStore'
  import { initConnectionStore, backendError } from './lib/connectionStore'
  import { initSessionStore } from './lib/sessionStore'
  import Sidebar from './lib/components/Sidebar.svelte'
  import LmConnections from './lib/components/LmConnections.svelte'
  import ModelConfigs from './lib/components/ModelConfigs.svelte'
  import McpProfiles from './lib/components/McpProfiles.svelte'
  import ChatView from './lib/components/ChatView.svelte'

  let loading = $state(true)

  onMount(async () => {
    try {
      await Promise.all([initConnectionStore(), initSessionStore()])
    } finally {
      loading = false
    }
  })
</script>

<div class="app-shell">
  <Sidebar />
  <main class="main-content">
    {#if $backendError}
      <div class="backend-error">
        <strong>Backend error:</strong> {$backendError}
      </div>
    {/if}

    {#if loading}
      <div class="loading">Loading…</div>
    {:else if $currentView === 'chats'}
      <ChatView />
    {:else if $currentView === 'model-configs'}
      <ModelConfigs />
    {:else if $currentView === 'connections'}
      <LmConnections />
    {:else if $currentView === 'mcp-profiles'}
      <McpProfiles />
    {/if}
  </main>
</div>

<style>
  .app-shell {
    display: flex;
    height: 100vh;
    overflow: hidden;
    background: var(--bg);
  }
  .main-content {
    flex: 1;
    overflow: hidden;
    background: var(--bg);
    display: flex;
    flex-direction: column;
  }
  .backend-error {
    margin: 1rem 2rem;
    padding: 0.75rem 1rem;
    background: var(--bg-panel);
    border: 1px solid var(--color-error);
    border-radius: 4px;
    color: var(--color-error);
    font-size: 0.875rem;
  }
  .loading {
    padding: 2rem;
    color: var(--text-muted);
    font-size: 0.9rem;
  }
</style>
