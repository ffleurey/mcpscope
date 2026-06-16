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
    class="token-pill id-pill"
    title={id}
    onclick={(e) => { e.stopPropagation(); open = !open }}
  >{id}</button>

  {#if open}
    <div class="id-menu" role="menu" tabindex="-1" onmousedown={(e) => e.stopPropagation()}>
      <button class="menu-item" role="menuitem" onclick={copyId}>Copy ID</button>
      <hr class="menu-sep" />
      <button class="menu-item" role="menuitem" onclick={() => doLookup('summary')}>Summary</button>
      <button class="menu-item" role="menuitem" onclick={() => doLookup('full')}>Full</button>
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

  /* Chrome (border/radius/colour/size) comes from .token-pill; this adds the
     interactive button behaviour + ellipsis. */
  .id-pill {
    background: none;
    cursor: pointer;
    font-family: var(--mono);
    max-width: 260px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .id-pill:hover {
    border-color: var(--text-dim);
    color: var(--text-bright);
  }

  .id-menu {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    z-index: 200;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 6px;
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
    color: var(--text-bright);
    white-space: nowrap;
  }

  .menu-item:hover {
    background: var(--bg-hover);
  }

  .menu-sep {
    border: none;
    border-top: 1px solid var(--border);
    margin: 0.15rem 0;
  }
</style>
