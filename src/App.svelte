<script lang="ts">
  import { onMount } from 'svelte'
  import { currentView, initStores, dbError } from './lib/stores'
  import Sidebar from './lib/components/Sidebar.svelte'
  import ModelProfiles from './lib/components/ModelProfiles.svelte'
  import McpProfiles from './lib/components/McpProfiles.svelte'

  let loading = $state(true)

  onMount(async () => {
    await initStores()
    loading = false
  })
</script>

<div class="app-shell">
  <Sidebar />
  <main class="main-content">
    {#if $dbError}
      <div class="db-error">
        <strong>Database error:</strong> {$dbError}
      </div>
    {/if}

    {#if loading}
      <div class="loading">Loading…</div>
    {:else if $currentView === 'chats'}
      <div class="placeholder-view">
        <h2>Chats</h2>
        <p>Chat functionality will be available in a future increment.</p>
      </div>
    {:else if $currentView === 'model-profiles'}
      <ModelProfiles />
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
    overflow-y: auto;
    background: var(--bg);
  }
  .db-error {
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
  .placeholder-view {
    padding: 1.5rem 2rem;
  }
  .placeholder-view h2 {
    margin: 0 0 0.5rem;
    font-size: 1.15rem;
    font-weight: 600;
    color: var(--text);
  }
  .placeholder-view p {
    color: var(--text-muted);
    font-size: 0.9rem;
  }
</style>
