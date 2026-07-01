<script lang="ts">
  import { get } from 'svelte/store'
  import { untrack } from 'svelte'
  import { mcpProfiles } from '../connectionStore'
  import { testMcpProfile } from '../api/backendClient'
  import { toAppError } from '../errors'
  import DialogShell from './DialogShell.svelte'
  import Checkbox from './Checkbox.svelte'
  import Icon from './Icon.svelte'
  import { iconClose } from '../design/icons'

  interface Props {
    /** Tool names already present in the target field; seed the selection. */
    selectedTools: string[]
    /** Called with the full selected tool-name list when the user applies. */
    onConfirm: (selected: string[]) => void
    onClose: () => void
  }

  let { selectedTools, onConfirm, onClose }: Props = $props()

  // Snapshot inputs once on open; the dialog is short-lived and recreated per open.
  const profiles = untrack(() => get(mcpProfiles))

  // The working selection — the full set of tools the field will hold on Apply.
  // Seeded from the field's current tools so the user can both add and remove.
  let selection = $state<Set<string>>(new Set(untrack(() => selectedTools)))

  // Stage 1: which server is picked (by id). Stage 2: its tools load below.
  let selectedServerId = $state<string>('')
  let loading = $state(false)
  let loadError = $state<string | null>(null)
  let serverTools = $state<string[]>([])

  const selectedServer = $derived(profiles.find((p) => p.id === selectedServerId) ?? null)

  // Sorted view of the working selection for the persistent "Selected (N)" list.
  const selectedList = $derived([...selection].sort((a, b) => a.localeCompare(b)))

  async function loadServerTools(server: {
    url: string
    authType?: string | null
    authValue?: string | null
  }): Promise<void> {
    loading = true
    loadError = null
    serverTools = []
    try {
      const { tools } = await testMcpProfile(server.url, {
        authType: server.authType,
        authValue: server.authValue,
      })
      serverTools = tools
    } catch (e) {
      loadError = toAppError(e).message
    } finally {
      loading = false
    }
  }

  function onServerChange(): void {
    const server = profiles.find((p) => p.id === selectedServerId)
    if (server) void loadServerTools(server)
    else {
      serverTools = []
      loadError = null
    }
  }

  function toggle(name: string, checked: boolean): void {
    const next = new Set(selection)
    if (checked) next.add(name)
    else next.delete(name)
    selection = next
  }

  function remove(name: string): void {
    const next = new Set(selection)
    next.delete(name)
    selection = next
  }

  function handleConfirm(): void {
    onConfirm([...selection])
    onClose()
  }
</script>

<DialogShell title="Select MCP tools" {onClose} dialogClass="tool-picker-dialog">
  <div class="form-stack">
    {#if profiles.length === 0}
      <p class="empty-state">
        No MCP servers are registered. Add a server in the connections settings to pick tools from
        it.
      </p>
    {:else}
      <div class="field">
        <label class="field-label" for="tool-picker-server">MCP server</label>
        <select
          id="tool-picker-server"
          class="field-input"
          bind:value={selectedServerId}
          onchange={onServerChange}
        >
          <option value="">Select a server…</option>
          {#each profiles as profile (profile.id)}
            <option value={profile.id}>{profile.name}</option>
          {/each}
        </select>
      </div>

      {#if selectedServer}
        <div class="server-tools">
          <div class="server-head">
            <span class="server-name">{selectedServer.name}</span>
            {#if loading}
              <span class="status-pill dim">loading…</span>
            {:else if loadError}
              <span class="status-pill error" title={loadError}>unreachable</span>
            {:else}
              <span class="status-pill dim">{serverTools.length} tools</span>
            {/if}
          </div>

          {#if !loading && !loadError}
            {#if serverTools.length === 0}
              <p class="server-empty">No tools exposed.</p>
            {:else}
              <div class="tool-rows">
                {#each serverTools as tool (tool)}
                  <div class="tool-row">
                    <Checkbox
                      checked={selection.has(tool)}
                      label={tool}
                      onchange={(c) => toggle(tool, c)}
                    />
                  </div>
                {/each}
              </div>
            {/if}
          {/if}
        </div>
      {/if}
    {/if}

    <div class="selected-area">
      <span class="field-label">Selected ({selection.size})</span>
      {#if selectedList.length === 0}
        <p class="server-empty">No tools selected.</p>
      {:else}
        <div class="selected-list">
          {#each selectedList as tool (tool)}
            <span class="selected-item">
              <span class="selected-name">{tool}</span>
              <button
                type="button"
                class="icon-btn icon-btn-dim"
                title="Remove {tool}"
                aria-label="Remove {tool}"
                onclick={() => remove(tool)}
              >
                <Icon path={iconClose} />
              </button>
            </span>
          {/each}
        </div>
      {/if}
    </div>

    <div class="form-actions">
      <button class="btn" onclick={onClose}>Cancel</button>
      <button class="btn btn-primary" onclick={handleConfirm}>Apply</button>
    </div>
  </div>
</DialogShell>

<style>
  :global(.tool-picker-dialog) {
    max-width: min(480px, 95vw);
  }

  .empty-state {
    margin: 0;
    font-size: 0.85rem;
    color: var(--text-dim);
    line-height: 1.4;
  }

  .server-head {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    margin-bottom: 0.35rem;
  }

  .server-name {
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .server-empty {
    margin: 0;
    font-size: 0.8rem;
    color: var(--text-dim);
  }

  .tool-rows {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    max-height: 30vh;
    overflow-y: auto;
  }

  .selected-area {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    border-top: 1px solid var(--border);
    padding-top: 0.6rem;
  }

  .selected-list {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
  }

  .selected-item {
    display: inline-flex;
    align-items: center;
    gap: 0.15rem;
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 0.05rem 0.1rem 0.05rem 0.45rem;
  }

  .selected-name {
    font-family: var(--mono);
    font-size: 0.78rem;
    color: var(--text-bright);
  }
</style>
