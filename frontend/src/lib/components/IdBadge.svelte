<script lang="ts">
  import { lookupByHierarchicalId } from '../api/backendClient'
  import JsonDialog from './JsonDialog.svelte'

  interface Props {
    id: string
  }

  const { id }: Props = $props()

  let open = $state(false)
  let lookupTitle = $state('')
  let lookupData = $state<unknown>(null)
  let showLookup = $state(false)

  async function doLookup(mode: 'summary' | 'full') {
    open = false
    const payload = await lookupByHierarchicalId(id, mode)
    lookupTitle = `${id} (${mode})`
    lookupData = payload
    showLookup = true
  }

  async function copyId() {
    open = false
    try {
      await navigator.clipboard.writeText(id)
    } catch {
      // Clipboard unavailable in some contexts.
    }
  }
</script>

<svelte:document onclick={() => { if (open) open = false }} />
<span class="id-badge">
  <button
    class="id-pill"
    title={id}
    onclick={(e) => { e.stopPropagation(); open = !open }}
  >{id}</button>

  {#if open}
    <div class="id-menu" role="menu" tabindex="-1" onmousedown={(e) => e.stopPropagation()}>
      <button class="menu-item" onclick={copyId}>Copy ID</button>
      <hr class="menu-sep" />
      <button class="menu-item" onclick={() => doLookup('summary')}>Summary</button>
      <button class="menu-item" onclick={() => doLookup('full')}>Full</button>
    </div>
  {/if}
</span>

{#if showLookup}
  <JsonDialog
    title={lookupTitle}
    data={lookupData}
    onClose={() => { showLookup = false }}
  />
{/if}

<style>
  .id-badge {
    position: relative;
    display: inline-block;
  }

  .id-pill {
    background: none;
    border: 1px solid var(--border-subtle);
    border-radius: 999px;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 0.68rem;
    font-family: var(--mono);
    padding: 0.08rem 0.45rem;
    white-space: nowrap;
    max-width: 260px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .id-pill:hover {
    border-color: var(--border);
    color: var(--text);
  }

  .id-menu {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    z-index: 200;
    background: var(--bg-panel);
    border: 1px solid var(--border);
    border-radius: 6px;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18);
    min-width: 110px;
    padding: 0.18rem 0;
  }

  .menu-item {
    display: block;
    width: 100%;
    text-align: left;
    background: none;
    border: none;
    padding: 0.3rem 0.75rem;
    cursor: pointer;
    font-size: 0.78rem;
    color: var(--text);
    white-space: nowrap;
  }

  .menu-item:hover {
    background: var(--bg-hover);
  }

  .menu-sep {
    border: none;
    border-top: 1px solid var(--border-subtle);
    margin: 0.15rem 0;
  }
</style>
