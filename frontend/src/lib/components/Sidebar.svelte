<script lang="ts">
  import { currentView } from '../navStore'
  import type { NavView } from '../types'
  import ChatList from './ChatList.svelte'
  import RunList from './RunList.svelte'
  import {
    benchmarks,
    clearActiveRun,
    clearBenchmarkSelection,
    createBenchmark,
    selectBenchmark,
    activeBenchmarkId,
  } from '../benchmarkStore'
  import { modelConfigs } from '../connectionStore'
  import {
    importTraceFile,
    isImportingTrace,
    isPrimaryLaunchDialogOpen,
    openPrimaryLaunchDialog,
  } from '../sessionStore'
  import { iconChevronRight, iconChevronDown, iconPlus } from '../design/icons'
  import Icon from './Icon.svelte'
  import DialogShell from './DialogShell.svelte'
  import InlineAppError from './InlineAppError.svelte'
  import PrimarySessionLaunchModal from './PrimarySessionLaunchModal.svelte'
  import { toAppError, type AppError } from '../errors'

  let collapsed = $state(false)
  let sidebarWidth = $state(240)
  let isResizing = $state(false)
  let importInput = $state<HTMLInputElement | null>(null)

  // Collapsible-section expand flags.
  let benchmarksExpanded = $state(true)
  let runsExpanded = $state(true)
  let sessionsExpanded = $state(true)

  // Manually-resizable section heights (px); null = auto (flex). Sessions stays
  // elastic and absorbs the remaining space. Session-only (resets on reload).
  let benchHeight = $state<number | null>(null)
  let runsHeight = $state<number | null>(null)
  let treeAreaEl = $state<HTMLElement | null>(null)
  let benchSection = $state<HTMLElement | null>(null)
  let runsSection = $state<HTMLElement | null>(null)

  // Layout: the bottom-most EXPANDED section always grows to absorb slack, so
  // collapsed sections sit flush above the config (no gap) and manual heights
  // never overflow past it. When every section is collapsed, a spacer pins the
  // collapsed headers to the bottom.
  const lastExpanded = $derived(
    sessionsExpanded
      ? 'sessions'
      : runsExpanded
        ? 'runs'
        : benchmarksExpanded
          ? 'benchmarks'
          : null,
  )
  const allCollapsed = $derived(!benchmarksExpanded && !runsExpanded && !sessionsExpanded)

  function sectionFlex(expanded: boolean, manualHeight: number | null, isLast: boolean): string {
    if (!expanded) return '0 0 auto' // collapsed: header only
    if (isLast) return '1 1 0' // bottom-most expanded fills remaining space
    if (manualHeight !== null) return `0 1 ${manualHeight}px` // sized, shrinkable
    return '1 1 0' // unsized expanded: share
  }

  // New-benchmark dialog
  let showNewBenchmark = $state(false)
  let newName = $state('')
  let newDescription = $state('')
  let creating = $state(false)
  let createError = $state<AppError | null>(null)

  function navigate(view: NavView) {
    // Navigating to a config/management view closes any open run report or
    // benchmark detail so the chosen view actually shows.
    clearActiveRun()
    clearBenchmarkSelection()
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

  function startPaneResize(
    e: MouseEvent,
    section: HTMLElement | null,
    apply: (height: number) => void,
  ) {
    if (!section) return
    const startY = e.clientY
    const startH = section.offsetHeight
    const maxH = (treeAreaEl?.clientHeight ?? 800) - 120

    function onMove(ev: MouseEvent) {
      apply(Math.max(60, Math.min(maxH, startH + ev.clientY - startY)))
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.body.style.cursor = 'ns-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    e.preventDefault()
  }

  function handleNewChat() {
    openPrimaryLaunchDialog()
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
    } catch {
      // error is already surfaced via sessionError → ErrorDialog
    } finally {
      if (target) target.value = ''
    }
  }

  function startNewBenchmark(e: MouseEvent) {
    e.stopPropagation()
    newName = ''
    newDescription = ''
    createError = null
    showNewBenchmark = true
  }

  async function handleCreateBenchmark() {
    if (!newName.trim()) return
    creating = true
    createError = null
    try {
      const benchmark = await createBenchmark({
        name: newName.trim(),
        description: newDescription.trim() || null,
      })
      showNewBenchmark = false
      await selectBenchmark(benchmark.id)
    } catch (e) {
      createError = toAppError(e)
    } finally {
      creating = false
    }
  }
</script>

<nav
  class="sidebar"
  class:collapsed
  class:resizing={isResizing}
  style="width: {collapsed ? '40px' : sidebarWidth + 'px'}"
>
  {#if $isPrimaryLaunchDialogOpen}
    <PrimarySessionLaunchModal />
  {/if}
  {#if collapsed}
    <button class="icon-btn icon-btn-dim" onclick={() => (collapsed = false)} title="Expand sidebar"
      >›</button
    >
  {:else}
    <input
      bind:this={importInput}
      type="file"
      accept="application/json"
      hidden
      onchange={handleImportChange}
    />

    <div class="tree-area" bind:this={treeAreaEl}>
      {#if allCollapsed}<div class="tree-spacer"></div>{/if}
      <!-- Benchmarks ─────────────────────────────────────────── -->
      <section
        class="tree-section"
        class:expanded={benchmarksExpanded}
        bind:this={benchSection}
        style:flex={sectionFlex(benchmarksExpanded, benchHeight, lastExpanded === 'benchmarks')}
      >
        <div class="section-header">
          <button
            class="section-toggle"
            onclick={() => (benchmarksExpanded = !benchmarksExpanded)}
            aria-expanded={benchmarksExpanded}
          >
            <span class="chevron"
              ><Icon path={benchmarksExpanded ? iconChevronDown : iconChevronRight} /></span
            >
            <span class="section-label">Benchmarks</span>
          </button>
          <div class="header-actions">
            <button class="icon-btn icon-btn-dim" onclick={startNewBenchmark} title="New benchmark"
              ><Icon path={iconPlus} /></button
            >
          </div>
        </div>
        {#if benchmarksExpanded}
          <div class="section-body">
            {#if $benchmarks.length === 0}
              <div class="empty">No benchmarks yet</div>
            {:else}
              <ul class="bench-list">
                {#each $benchmarks as benchmark (benchmark.id)}
                  <li class="bench-item" class:active={$activeBenchmarkId === benchmark.id}>
                    <button class="bench-button" onclick={() => selectBenchmark(benchmark.id)}>
                      <span class="bench-name">{benchmark.name}</span>
                      <span class="bench-count">{benchmark.caseCount}</span>
                    </button>
                  </li>
                {/each}
              </ul>
            {/if}
          </div>
          {#if lastExpanded !== 'benchmarks'}
            <button
              type="button"
              class="pane-resize"
              class:sized={benchHeight !== null}
              aria-label="Resize benchmarks section"
              onmousedown={(e) => startPaneResize(e, benchSection, (h) => (benchHeight = h))}
            ></button>
          {/if}
        {/if}
      </section>

      <!-- Benchmark runs ─────────────────────────────────────── -->
      <section
        class="tree-section"
        class:expanded={runsExpanded}
        bind:this={runsSection}
        style:flex={sectionFlex(runsExpanded, runsHeight, lastExpanded === 'runs')}
      >
        <div class="section-header">
          <button
            class="section-toggle"
            onclick={() => (runsExpanded = !runsExpanded)}
            aria-expanded={runsExpanded}
          >
            <span class="chevron"
              ><Icon path={runsExpanded ? iconChevronDown : iconChevronRight} /></span
            >
            <span class="section-label">Benchmark runs</span>
          </button>
        </div>
        {#if runsExpanded}
          <div class="section-body">
            <RunList />
          </div>
          {#if lastExpanded !== 'runs'}
            <button
              type="button"
              class="pane-resize"
              class:sized={runsHeight !== null}
              aria-label="Resize benchmark runs section"
              onmousedown={(e) => startPaneResize(e, runsSection, (h) => (runsHeight = h))}
            ></button>
          {/if}
        {/if}
      </section>

      <!-- Sessions ───────────────────────────────────────────── -->
      <section
        class="tree-section session-section"
        class:expanded={sessionsExpanded}
        style:flex={sectionFlex(sessionsExpanded, null, lastExpanded === 'sessions')}
      >
        <div class="section-header">
          <button
            class="section-toggle"
            onclick={() => (sessionsExpanded = !sessionsExpanded)}
            aria-expanded={sessionsExpanded}
          >
            <span class="chevron"
              ><Icon path={sessionsExpanded ? iconChevronDown : iconChevronRight} /></span
            >
            <span class="section-label">Sessions</span>
          </button>
          <div class="header-actions">
            {#if $modelConfigs.length > 0}
              <button class="icon-btn icon-btn-dim" onclick={handleNewChat} title="New session"
                >+</button
              >
            {/if}
            <button
              class="icon-btn icon-btn-dim"
              onclick={handleImportClick}
              disabled={$isImportingTrace}
              title={$isImportingTrace ? 'Importing…' : 'Import trace'}>↑</button
            >
          </div>
        </div>
        {#if sessionsExpanded}
          <div class="section-body session-body">
            <ChatList />
          </div>
        {/if}
      </section>
    </div>

    <div class="config-section">
      <div class="config-label">Configuration</div>
      <button
        class="nav-item"
        class:active={$currentView === 'model-configs'}
        onclick={() => navigate('model-configs')}
      >
        Model Configs
      </button>
      <button
        class="nav-item"
        class:active={$currentView === 'connections'}
        onclick={() => navigate('connections')}
      >
        Connections
      </button>
      <button
        class="nav-item"
        class:active={$currentView === 'mcp-profiles'}
        onclick={() => navigate('mcp-profiles')}
      >
        MCP Servers
      </button>
    </div>

    <div class="design-section">
      <button
        class="nav-item"
        class:active={$currentView === 'design'}
        onclick={() => navigate('design')}
      >
        Design
      </button>
    </div>

    <button
      type="button"
      class="resize-handle"
      class:dragging={isResizing}
      aria-label="Resize sidebar"
      onmousedown={startResize}
    ></button>
  {/if}
</nav>

{#if showNewBenchmark}
  <DialogShell
    title="New benchmark"
    onClose={() => (showNewBenchmark = false)}
    dialogClass="benchmark-new-dialog"
  >
    <div class="form-stack">
      <InlineAppError error={createError} />
      <div class="field">
        <label class="field-label" for="benchmark-name">Name</label>
        <input
          id="benchmark-name"
          class="field-input"
          type="text"
          bind:value={newName}
          disabled={creating}
        />
      </div>
      <div class="field">
        <label class="field-label" for="benchmark-description"
          >Description <span class="optional">(optional)</span></label
        >
        <textarea
          id="benchmark-description"
          class="field-input"
          rows={3}
          bind:value={newDescription}
          disabled={creating}></textarea>
      </div>
      <div class="form-actions">
        <button class="btn" onclick={() => (showNewBenchmark = false)} disabled={creating}
          >Cancel</button
        >
        <button
          class="btn btn-primary"
          onclick={handleCreateBenchmark}
          disabled={creating || !newName.trim()}
        >
          {creating ? 'Creating…' : 'Create benchmark'}
        </button>
      </div>
    </div>
  </DialogShell>
{/if}

<style>
  .sidebar {
    flex-shrink: 0;
    background: var(--bg-surface);
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

  /* Stacked collapsible sections share the available vertical space; each
     expanded section scrolls its own body independently when long. */
  .tree-area {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .tree-section {
    display: flex;
    flex-direction: column;
    min-height: 0;
    border-bottom: 1px solid var(--border);
    /* flex is computed inline via sectionFlex(): the bottom-most expanded section
       grows to absorb slack so collapsed sections stay flush above the config. */
  }
  /* Pins the collapsed-section headers to the bottom when every section is collapsed. */
  .tree-spacer {
    flex: 1 1 0;
    min-height: 0;
  }

  .section-header {
    display: flex;
    align-items: center;
    padding: 0.55rem 0.5rem 0.4rem 0.5rem;
    gap: 0.15rem;
    flex-shrink: 0;
  }
  .section-toggle {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 0.25rem;
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
    color: var(--text-dim);
    font-family: inherit;
  }
  .section-toggle:hover .section-label {
    color: var(--text-bright);
  }
  .chevron {
    display: inline-flex;
    font-size: 0.9rem;
    flex-shrink: 0;
  }
  .section-label {
    flex: 1;
    min-width: 0;
    text-align: left;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .header-actions {
    display: flex;
    gap: 0.1rem;
    align-items: center;
    flex-shrink: 0;
  }

  .section-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }
  .session-body {
    display: flex;
    flex-direction: column;
  }

  .empty {
    padding: 0.4rem 0.75rem 0.6rem;
    font-size: 0.78rem;
    color: var(--text-dim);
  }

  .bench-list {
    list-style: none;
    margin: 0;
    padding: 0.15rem 0 0.25rem;
  }
  .bench-item {
    color: var(--text-dim);
    font-size: 0.82rem;
  }
  .bench-item.active {
    background: var(--bg-hover);
    color: var(--text-bright);
  }
  .bench-item:hover {
    background: var(--bg-hover);
    color: var(--text-bright);
  }
  .bench-button {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    width: 100%;
    background: none;
    border: none;
    cursor: pointer;
    color: inherit;
    font: inherit;
    text-align: left;
    padding: 0.3rem 0.75rem;
  }
  .bench-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .bench-count {
    flex-shrink: 0;
    font-family: var(--mono);
    font-size: 0.72rem;
    opacity: 0.7;
  }

  .config-section {
    border-top: 1px solid var(--border);
    padding-bottom: 0.25rem;
    flex-shrink: 0;
  }

  .design-section {
    border-top: 1px solid var(--border);
    flex-shrink: 0;
  }
  .design-section .nav-item {
    font-size: 0.75rem;
    opacity: 0.5;
  }
  .design-section .nav-item.active {
    opacity: 1;
  }
  .config-label {
    font-size: 0.68rem;
    font-weight: 600;
    color: var(--text-dim);
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
    color: var(--text-dim);
    font-family: inherit;
    transition:
      background 0.1s,
      color 0.1s;
  }
  .nav-item:hover {
    background: var(--bg-hover);
    color: var(--text-bright);
  }
  .nav-item.active {
    color: var(--text-bright);
    border-bottom: 2px solid var(--amber-bright);
    font-weight: 500;
  }

  .optional {
    font-weight: 400;
    text-transform: none;
    letter-spacing: 0;
    font-size: 0.75rem;
  }
  :global(.benchmark-new-dialog) {
    max-width: min(520px, 95vw);
  }

  .resize-handle {
    position: absolute;
    top: 0;
    right: 0;
    width: 4px;
    padding: 0;
    border: none;
    background: transparent;
    height: 100%;
    cursor: ew-resize;
    z-index: 10;
  }
  .resize-handle:hover,
  .resize-handle.dragging {
    background: var(--amber-bright);
    opacity: 0.35;
  }

  /* Drag the bottom edge of a section to set its height; Sessions stays elastic. */
  .pane-resize {
    flex-shrink: 0;
    width: 100%;
    height: 5px;
    padding: 0;
    border: none;
    background: transparent;
    cursor: ns-resize;
  }
  .pane-resize.sized {
    background: var(--border);
  }
  .pane-resize:hover {
    background: var(--amber-bright);
    opacity: 0.3;
  }
</style>
