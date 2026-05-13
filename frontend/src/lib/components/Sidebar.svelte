<script lang="ts">
  import { currentView } from '../navStore'
  import type { NavView } from '../types'
  import ChatList from './ChatList.svelte'
  import { modelConfigs } from '../connectionStore'
  import { importTraceFile, isImportingTrace, startDraftSession } from '../sessionStore'

  let collapsed = $state(false)
  let sidebarWidth = $state(240)
  let isResizing = $state(false)
  let importInput = $state<HTMLInputElement | null>(null)

  function navigate(view: NavView) {
    currentView.set(view)
  }

  function startResize(e: MouseEvent) {
    isResizing = true
    const startX = e.clientX
    const startWidth = sidebarWidth

    function onMove(ev: MouseEvent) {
      sidebarWidth = Math.max(180, Math.min(480, startWidth + ev.clientX - startX))
    }
    function onUp() {
      isResizing = false
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    e.preventDefault()
  }

  function handleNewChat() {
    startDraftSession()
    currentView.set('chats')
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
      currentView.set('chats')
    } finally {
      if (target) target.value = ''
    }
  }
</script>

<nav class="sidebar" class:collapsed class:resizing={isResizing}
  style="width: {collapsed ? '40px' : sidebarWidth + 'px'}"
>
  {#if collapsed}
    <button class="collapse-toggle" onclick={() => collapsed = false} title="Expand sidebar">›</button>
  {:else}
    <div class="section-header">
      <span class="section-label">Sessions</span>
      <div class="header-actions">
        {#if $modelConfigs.length > 0}
          <button class="icon-btn" onclick={handleNewChat} title="New session">+</button>
        {/if}
        <button class="icon-btn" onclick={handleImportClick} disabled={$isImportingTrace} title={$isImportingTrace ? 'Importing…' : 'Import trace'}>↑</button>
        <button class="icon-btn" onclick={() => collapsed = true} title="Collapse sidebar">‹</button>
      </div>
    </div>

    <input bind:this={importInput} type="file" accept="application/json" hidden onchange={handleImportChange} />

    <div class="session-list-area">
      <ChatList />
    </div>

    <div class="config-section">
      <div class="config-label">Configuration</div>
      <button class="nav-item" class:active={$currentView === 'model-configs'} onclick={() => navigate('model-configs')}>
        Model Configs
      </button>
      <button class="nav-item" class:active={$currentView === 'connections'} onclick={() => navigate('connections')}>
        Connections
      </button>
      <button class="nav-item" class:active={$currentView === 'mcp-profiles'} onclick={() => navigate('mcp-profiles')}>
        MCP Servers
      </button>
    </div>

    <div class="resize-handle" class:dragging={isResizing} role="separator" aria-orientation="vertical" onmousedown={startResize}></div>
  {/if}
</nav>

<style>
  .sidebar {
    flex-shrink: 0;
    background: var(--bg-sidebar);
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    height: 100vh;
    position: relative;
    overflow: hidden;
  }
  .sidebar:not(.resizing) {
    transition: width 0.15s ease;
  }
  .sidebar.collapsed {
    align-items: center;
    padding-top: 0.5rem;
  }

  .collapse-toggle {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-muted);
    font-size: 1.3rem;
    padding: 0.35rem 0.5rem;
    border-radius: 4px;
    line-height: 1;
    font-family: inherit;
  }
  .collapse-toggle:hover {
    background: var(--bg-hover);
    color: var(--text);
  }

  .section-header {
    display: flex;
    align-items: center;
    padding: 0.55rem 0.5rem 0.4rem 0.75rem;
    border-bottom: 1px solid var(--border-subtle);
    gap: 0.15rem;
  }
  .section-label {
    flex: 1;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .header-actions {
    display: flex;
    gap: 0.1rem;
    align-items: center;
  }
  .icon-btn {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-muted);
    font-size: 0.95rem;
    padding: 0.2rem 0.42rem;
    border-radius: 3px;
    line-height: 1;
    opacity: 0.65;
    font-family: inherit;
  }
  .icon-btn:hover {
    background: var(--bg-hover);
    color: var(--text);
    opacity: 1;
  }
  .icon-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  .session-list-area {
    flex: 1;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .config-section {
    border-top: 1px solid var(--border-subtle);
    padding-bottom: 0.25rem;
  }
  .config-label {
    font-size: 0.68rem;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.07em;
    padding: 0.5rem 0.75rem 0.2rem;
    opacity: 0.55;
  }
  .nav-item {
    display: block;
    width: 100%;
    text-align: left;
    background: none;
    border: none;
    cursor: pointer;
    padding: 0.4rem 0.75rem;
    font-size: 0.83rem;
    color: var(--text-muted);
    font-family: inherit;
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

  .resize-handle {
    position: absolute;
    top: 0;
    right: 0;
    width: 4px;
    height: 100%;
    cursor: ew-resize;
    z-index: 10;
  }
  .resize-handle:hover,
  .resize-handle.dragging {
    background: var(--color-accent);
    opacity: 0.35;
  }
</style>
