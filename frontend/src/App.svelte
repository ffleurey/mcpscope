<script lang="ts">
  import { onMount } from 'svelte'
  import { currentView } from './lib/navStore'
  import { devMode, toggleDevMode } from './lib/devMode'
  import { initConnectionStore, backendError } from './lib/connectionStore'
  import { initSessionStore } from './lib/sessionStore'
  import { initBenchmarkStore, activeRunId, activeBenchmarkId } from './lib/benchmarkStore'
  import { initExecutionStore, destroyExecutionStore } from './lib/executionStore'
  import Sidebar from './lib/components/Sidebar.svelte'
  import BenchmarkDetailView from './lib/components/BenchmarkDetailView.svelte'
  import RunReportView from './lib/components/RunReportView.svelte'
  import ChatView from './lib/components/ChatView.svelte'
  import HomeView from './lib/components/HomeView.svelte'
  import ConfigView from './lib/components/ConfigView.svelte'
  import DesignReference from './lib/components/DesignReference.svelte'
  import ErrorDialog from './lib/components/ErrorDialog.svelte'
  import ExecutionBar from './lib/components/ExecutionBar.svelte'

  let loading = $state(true)
  let devToast = $state<string | null>(null)
  let devToastTimer: ReturnType<typeof setTimeout> | null = null

  // Konami code toggles developer mode (reveals the Design page and any future
  // developer-only surfaces). ↑ ↑ ↓ ↓ ← → ← → B A.
  const KONAMI = [
    'ArrowUp',
    'ArrowUp',
    'ArrowDown',
    'ArrowDown',
    'ArrowLeft',
    'ArrowRight',
    'ArrowLeft',
    'ArrowRight',
    'b',
    'a',
  ]
  let konamiProgress = 0

  function handleKonami(event: KeyboardEvent): void {
    // Don't intercept typing (the 'b'/'a' steps would otherwise fire in inputs).
    const target = event.target as HTMLElement | null
    if (
      target &&
      (target.isContentEditable ||
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT')
    ) {
      konamiProgress = 0
      return
    }
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
    if (key === KONAMI[konamiProgress]) {
      konamiProgress += 1
    } else {
      // Restart, but let a mismatching key still count as a fresh first step
      // (so "↑ ↑ ↑ ↓ ↓ …" recovers instead of dead-ending).
      konamiProgress = key === KONAMI[0] ? 1 : 0
    }
    if (konamiProgress === KONAMI.length) {
      konamiProgress = 0
      const on = toggleDevMode()
      showDevToast(`Developer mode ${on ? 'on' : 'off'}`)
    }
  }

  function showDevToast(message: string): void {
    devToast = message
    if (devToastTimer) clearTimeout(devToastTimer)
    devToastTimer = setTimeout(() => (devToast = null), 2200)
  }

  // Leaving the Design page visible after dev mode is switched off would strand
  // the user on a hidden view — send them home.
  $effect(() => {
    if (!$devMode && $currentView === 'design') currentView.set('home')
  })

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
    window.addEventListener('keydown', handleKonami)
    return () => {
      window.removeEventListener('keydown', handleKonami)
      if (devToastTimer) clearTimeout(devToastTimer)
      destroyExecutionStore()
    }
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
    {:else if $currentView === 'home'}
      <HomeView />
    {:else if $currentView === 'configuration'}
      <ConfigView />
    {:else if $currentView === 'chats'}
      <ChatView />
    {:else if $currentView === 'design' && $devMode}
      <DesignReference />
    {/if}
  </main>
</div>

{#if devToast}
  <div class="dev-toast" role="status">{devToast}</div>
{/if}

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
    font-size: var(--font-ui);
  }
  .loading {
    padding: 2rem;
    color: var(--text-dim);
    font-size: var(--font-ui);
  }
  /* Transient confirmation when developer mode is toggled (Konami code). */
  .dev-toast {
    position: fixed;
    bottom: 1rem;
    left: 50%;
    transform: translateX(-50%);
    padding: 0.4rem 0.85rem;
    background: var(--bg-surface);
    border: 1px solid var(--amber-dim);
    border-radius: 4px;
    color: var(--amber-bright);
    font-size: var(--font-meta);
    z-index: 100;
  }
</style>
