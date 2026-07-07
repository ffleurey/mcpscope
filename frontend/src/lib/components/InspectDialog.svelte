<script lang="ts">
  import { untrack } from 'svelte'
  import { lookupByHierarchicalId, lookupTextByHierarchicalId } from '../api/backendClient'
  import { collectInspectIds, linkify } from '../inspectIds'
  import DialogShell from './DialogShell.svelte'
  import SegmentedControl from './SegmentedControl.svelte'
  import Icon from './Icon.svelte'
  import { iconArrowLeft, iconArrowRight, iconCheck } from '../design/icons'

  interface Props {
    id: string
    /** Which detail level to open on; the dialog can switch freely after. */
    initialMode?: 'summary' | 'full'
    onClose: () => void
  }

  let { id, initialMode = 'full', onClose }: Props = $props()

  // ── Navigation (browser-like) ───────────────────────────────────────────────
  // A history stack of inspected ids; back/forward move a pointer over it. Detail
  // and format are sticky view settings, not per-history-entry.
  let history = $state<string[]>(untrack(() => [id]))
  let pointer = $state(0)
  const currentId = $derived(history[pointer] ?? id)
  const canBack = $derived(pointer > 0)
  const canForward = $derived(pointer < history.length - 1)

  let mode = $state<'summary' | 'full'>(untrack(() => initialMode))
  let format = $state<'text' | 'json'>('text')

  let loading = $state(false)
  let error = $state<string | null>(null)
  let jsonData = $state<unknown>(null)
  let idSet = $state<Set<string>>(new Set())
  let textData = $state('')
  let copied = $state(false)

  // The id input doubles as an address bar: it reflects the current id and lets
  // you jump anywhere (free text — Enter to go).
  let inputValue = $state(untrack(() => id))
  $effect(() => {
    inputValue = currentId
  })

  function navigate(targetId: string) {
    const next = targetId.trim()
    if (!next || next === currentId) return
    history = [...history.slice(0, pointer + 1), next]
    pointer = history.length - 1
  }
  function back() {
    if (canBack) pointer -= 1
  }
  function forward() {
    if (canForward) pointer += 1
  }

  // Guards rapid back/forward or mode toggles: only the latest request may
  // write state, so out-of-order responses can't display a previous id.
  let loadToken = 0

  async function load(
    idToLoad: string,
    currentMode: 'summary' | 'full',
    currentFormat: 'text' | 'json',
  ) {
    const token = ++loadToken
    loading = true
    error = null
    try {
      // Always fetch the JSON: it is the display in JSON mode and the reliable
      // id-set used to linkify both views (the T2 approach).
      const json = await lookupByHierarchicalId(idToLoad, currentMode)
      const text =
        currentFormat === 'text' ? await lookupTextByHierarchicalId(idToLoad, currentMode) : ''
      if (token !== loadToken) return
      jsonData = json
      idSet = collectInspectIds(json)
      textData = text
    } catch (e) {
      if (token !== loadToken) return
      error = e instanceof Error ? e.message : String(e)
      jsonData = null
      idSet = new Set()
      textData = ''
    } finally {
      if (token === loadToken) loading = false
    }
  }

  // Reload on mount and whenever the current id or a view setting changes.
  $effect(() => {
    void load(currentId, mode, format)
  })

  const segments = $derived.by(() => {
    if (loading || error) return []
    const display = format === 'json' ? JSON.stringify(jsonData, null, 2) : textData
    const links = new Set(idSet)
    links.delete(currentId) // don't link the element you're already viewing
    return linkify(display, links)
  })

  async function copyPayload() {
    const content = format === 'json' ? JSON.stringify(jsonData, null, 2) : textData
    try {
      await navigator.clipboard.writeText(content)
      copied = true
      setTimeout(() => (copied = false), 1500)
    } catch {
      // Clipboard unavailable in some contexts.
    }
  }
</script>

<DialogShell
  title={`Inspect ${currentId}`}
  {onClose}
  dialogClass="inspect-dialog-size"
  fixedHeight
  flush
>
  <div class="inspect-toolbar">
    <div class="nav-group">
      <button class="nav-btn" onclick={back} disabled={!canBack} title="Back" aria-label="Back"
        ><Icon path={iconArrowLeft} /></button
      >
      <button
        class="nav-btn"
        onclick={forward}
        disabled={!canForward}
        title="Forward"
        aria-label="Forward"><Icon path={iconArrowRight} /></button
      >
    </div>

    <input
      class="id-input"
      bind:value={inputValue}
      onkeydown={(e) => {
        if (e.key === 'Enter') navigate(inputValue)
      }}
      spellcheck="false"
      autocomplete="off"
      aria-label="Inspect id (Enter to go)"
    />

    <span class="toolbar-spacer"></span>

    <div class="control">
      <span class="control-label">Detail</span>
      <SegmentedControl
        ariaLabel="Detail level"
        selected={mode}
        onSelect={(v) => (mode = v as 'summary' | 'full')}
        options={[
          { value: 'summary', label: 'Summary' },
          { value: 'full', label: 'Full' },
        ]}
      />
    </div>

    <div class="control">
      <span class="control-label">Format</span>
      <SegmentedControl
        ariaLabel="Format"
        selected={format}
        onSelect={(v) => (format = v as 'text' | 'json')}
        options={[
          { value: 'text', label: 'Text' },
          { value: 'json', label: 'JSON' },
        ]}
      />
    </div>

    <button
      class="copy-btn"
      onclick={copyPayload}
      disabled={loading || error != null}
      title="Copy the displayed payload to the clipboard"
    >
      {#if copied}<Icon path={iconCheck} /> Copied{:else}Copy payload{/if}
    </button>
  </div>

  <div class="inspect-body">
    {#if loading}
      <div class="state">Loading…</div>
    {:else if error}
      <pre class="payload payload-error">{error}</pre>
    {:else}
      <!-- prettier-ignore -->
      <pre class="payload">{#each segments as seg, i (i)}{#if seg.id}<button type="button" class="id-link" onclick={() => seg.id && navigate(seg.id)}>{seg.text}</button>{:else}{seg.text}{/if}{/each}</pre>
    {/if}
  </div>
</DialogShell>

<style>
  /* Fixed width; the height is locked by DialogShell's `fixedHeight` (85vh), so
     the dialog uses the available space well and never resizes as content or
     options change — only the content region below scrolls. */
  :global(.inspect-dialog-size) {
    max-width: min(1040px, 92vw);
  }

  .inspect-toolbar {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    padding: 0.55rem 0.85rem;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
    flex-wrap: wrap;
  }

  .toolbar-spacer {
    flex: 1;
  }

  .nav-group {
    display: inline-flex;
    gap: 0.25rem;
  }

  .nav-btn {
    background: none;
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text-dim);
    cursor: pointer;
    font-family: var(--mono);
    font-size: 0.8rem;
    line-height: 1;
    padding: 0.22rem 0.5rem;
  }

  .nav-btn:hover:not(:disabled) {
    border-color: var(--text-dim);
    color: var(--text-bright);
  }

  .nav-btn:disabled {
    opacity: 0.35;
    cursor: default;
  }

  .id-input {
    background: var(--bg-base);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text-bright);
    font-family: var(--mono);
    font-size: 0.74rem;
    padding: 0.22rem 0.5rem;
    width: 14rem;
    max-width: 40vw;
  }

  .id-input:focus-visible {
    outline: none;
    border-color: var(--amber-bright);
  }

  .control {
    display: flex;
    align-items: center;
    gap: 0.45rem;
  }

  .control-label {
    font-size: 0.66rem;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--text-dim);
  }

  .copy-btn {
    background: none;
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text-dim);
    cursor: pointer;
    font-family: var(--mono);
    font-size: 0.74rem;
    padding: 0.22rem 0.7rem;
    white-space: nowrap;
  }

  .copy-btn:hover:not(:disabled) {
    border-color: var(--text-dim);
    color: var(--text-bright);
  }

  .copy-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }

  /* The single scroll region: the toolbar above and the dialog frame stay put. */
  .inspect-body {
    flex: 1;
    min-height: 0;
    overflow: auto;
    background: var(--bg-base);
  }

  .payload {
    margin: 0;
    padding: 1rem;
    font-family: var(--mono);
    font-size: 0.78rem;
    line-height: 1.5;
    color: var(--text-bright);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .payload-error {
    color: var(--red-bright);
  }

  /* Inline id hyperlink within the payload: an amber, underline-on-hover link
     that carries no button chrome so it reads as text in the monospace flow. */
  .id-link {
    background: none;
    border: none;
    padding: 0;
    margin: 0;
    font: inherit;
    color: var(--amber-bright);
    cursor: pointer;
    text-decoration: underline;
    text-decoration-color: color-mix(in srgb, var(--amber-bright) 45%, transparent);
  }

  .id-link:hover {
    text-decoration-color: var(--amber-bright);
  }

  .state {
    padding: 1.5rem;
    color: var(--text-dim);
    font-family: var(--mono);
    font-size: 0.8rem;
  }
</style>
