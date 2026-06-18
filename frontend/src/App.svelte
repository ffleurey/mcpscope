<script lang="ts">
  import { onMount } from 'svelte'
  import { currentView } from './lib/navStore'
  import { initConnectionStore, backendError } from './lib/connectionStore'
  import { initSessionStore } from './lib/sessionStore'
  import { initBenchmarkStore, activeRunId, activeBenchmarkId } from './lib/benchmarkStore'
  import { initExecutionStore, destroyExecutionStore } from './lib/executionStore'
  import Sidebar from './lib/components/Sidebar.svelte'
  import LmConnections from './lib/components/LmConnections.svelte'
  import ModelConfigs from './lib/components/ModelConfigs.svelte'
  import McpProfiles from './lib/components/McpProfiles.svelte'
  import BenchmarkDetailView from './lib/components/BenchmarkDetailView.svelte'
  import RunReportView from './lib/components/RunReportView.svelte'
  import ChatView from './lib/components/ChatView.svelte'
  import DesignReference from './lib/components/DesignReference.svelte'
  import ErrorDialog from './lib/components/ErrorDialog.svelte'
  import ExecutionBar from './lib/components/ExecutionBar.svelte'

  let loading = $state(true)

  onMount(() => {
    Promise.all([
      initConnectionStore(),
      initSessionStore(),
      initBenchmarkStore().catch(() => undefined),
    ])
      .then(() => {
        initExecutionStore()
      })
      .finally(() => {
        loading = false
      })
    return destroyExecutionStore
  })
</script>

<div class="app-shell">
  <Sidebar />
  <main class="main-content">
    <ExecutionBar />

    {#if $backendError}
      <div class="backend-error">
        <strong>Backend error:</strong>
        {$backendError}
      </div>
    {/if}

    {#if loading}
      <div class="loading">Loading…</div>
    {:else if $activeBenchmarkId}
      <BenchmarkDetailView />
    {:else if $activeRunId}
      <RunReportView />
    {:else if $currentView === 'chats'}
      <ChatView />
    {:else if $currentView === 'model-configs'}
      <ModelConfigs />
    {:else if $currentView === 'connections'}
      <LmConnections />
    {:else if $currentView === 'mcp-profiles'}
      <McpProfiles />
    {:else if $currentView === 'design'}
      <DesignReference />
    {/if}
  </main>
</div>

<ErrorDialog />

<style>
  .app-shell {
    display: flex;
    height: 100vh;
    overflow: hidden;
    background: var(--bg-base);
  }
  .main-content {
    flex: 1;
    overflow: hidden;
    background: var(--bg-base);
    display: flex;
    flex-direction: column;
  }
  .backend-error {
    margin: 1rem 2rem;
    padding: 0.75rem 1rem;
    background: var(--bg-surface);
    border: 1px solid var(--red-bright);
    border-radius: 4px;
    color: var(--red-bright);
    font-size: 0.875rem;
  }
  .loading {
    padding: 2rem;
    color: var(--text-dim);
    font-size: 0.9rem;
  }
</style>
