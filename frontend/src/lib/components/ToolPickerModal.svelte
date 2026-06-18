<script lang="ts">
  import { get } from 'svelte/store'
  import { untrack } from 'svelte'
  import { mcpProfiles } from '../connectionStore'
  import { testMcpProfile } from '../api/backendClient'
  import { toAppError } from '../errors'
  import DialogShell from './DialogShell.svelte'
  import Checkbox from './Checkbox.svelte'

  interface Props {
    /** Tool names already present in the target field; shown as "already added". */
    alreadySelected: string[]
    /** Called with the newly-checked tool names (excludes already-present ones). */
    onConfirm: (selected: string[]) => void
    onClose: () => void
  }

  let { alreadySelected, onConfirm, onClose }: Props = $props()

  interface ServerState {
    id: string
    name: string
    url: string
    loading: boolean
    error: string | null
    tools: string[]
  }

  // Snapshot inputs once on open; the dialog is short-lived and recreated per open.
  const alreadySet = new Set(untrack(() => alreadySelected))
  const profiles = untrack(() => get(mcpProfiles))

  let servers = $state<ServerState[]>(
    profiles.map((p) => ({
      id: p.id,
      name: p.name,
      url: p.url,
      loading: true,
      error: null,
      tools: [],
    })),
  )

  // Tool names the user has newly checked in this dialog.
  let picked = $state<Set<string>>(new Set())

  async function loadServer(index: number, url: string): Promise<void> {
    try {
      const { tools } = await testMcpProfile(url)
      servers[index] = { ...servers[index], loading: false, error: null, tools }
    } catch (e) {
      servers[index] = {
        ...servers[index],
        loading: false,
        error: toAppError(e).message,
        tools: [],
      }
    }
  }

  // Load every registered server in parallel; one failing does not block the others.
  $effect(() => {
    profiles.forEach((p, i) => {
      void loadServer(i, p.url)
    })
  })

  function toggle(name: string, checked: boolean): void {
    const next = new Set(picked)
    if (checked) next.add(name)
    else next.delete(name)
    picked = next
  }

  function handleConfirm(): void {
    onConfirm([...picked])
    onClose()
  }
</script>

<DialogShell title="Add tools" {onClose} dialogClass="tool-picker-dialog">
  <div class="form-stack">
    {#if servers.length === 0}
      <p class="empty-state">
        No MCP servers are registered. Add a server in the connections settings to pick tools from
        it.
      </p>
    {:else}
      <div class="server-list">
        {#each servers as server (server.id)}
          <div class="server-group">
            <div class="server-head">
              <span class="server-name">{server.name}</span>
              {#if server.loading}
                <span class="status-pill dim">loading…</span>
              {:else if server.error}
                <span class="status-pill error" title={server.error}>unreachable</span>
              {:else}
                <span class="status-pill dim">{server.tools.length} tools</span>
              {/if}
            </div>

            {#if !server.loading && !server.error}
              {#if server.tools.length === 0}
                <p class="server-empty">No tools exposed.</p>
              {:else}
                <div class="tool-rows">
                  {#each server.tools as tool (tool)}
                    {@const already = alreadySet.has(tool)}
                    <div class="tool-row" class:already>
                      <Checkbox
                        checked={already || picked.has(tool)}
                        disabled={already}
                        label={tool}
                        hint={already ? 'already added' : ''}
                        onchange={(c) => toggle(tool, c)}
                      />
                    </div>
                  {/each}
                </div>
              {/if}
            {/if}
          </div>
        {/each}
      </div>
    {/if}

    <div class="form-actions">
      <button class="btn" onclick={onClose}>Cancel</button>
      <button class="btn btn-primary" onclick={handleConfirm} disabled={picked.size === 0}>
        Add selected
      </button>
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

  .server-list {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
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
  }

  .tool-row.already {
    opacity: 0.6;
  }
</style>
