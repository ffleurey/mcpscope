<script lang="ts">
  import InspectDialog from './InspectDialog.svelte'

  interface Props {
    id: string
  }

  const { id }: Props = $props()

  let open = $state(false)
  let inspectMode = $state<'summary' | 'full'>('full')
  let showLookup = $state(false)

  // Summary/Full both open the same consolidated inspect dialog, pre-set to the
  // chosen detail level; the dialog then switches detail (summary/full) and
  // format (text/json) freely — it is the GUI equivalent of the inspect tool.
  function doLookup(mode: 'summary' | 'full') {
    open = false
    inspectMode = mode
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

<svelte:document
  onclick={() => {
    if (open) open = false
  }}
/>
<span class="id-badge">
  <button
    class="token-pill id-pill"
    title={id}
    onclick={(e) => {
      e.stopPropagation()
      open = !open
    }}>{id}</button
  >

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
  <InspectDialog
    {id}
    initialMode={inspectMode}
    onClose={() => {
      showLookup = false
    }}
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
    /* Slightly larger than a plain .token-pill: this is an interactive,
       copy/inspect target, not dim metadata. */
    font-size: 0.74rem;
    padding: 0.16rem 0.55rem;
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
