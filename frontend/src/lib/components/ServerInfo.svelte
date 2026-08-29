<script lang="ts">
  // Where the backend is listening — bind address, Web UI URL, and the MCP
  // endpoint to point external clients (coding agents, WSL, Docker) at. Data
  // comes from /api/health via the connection store, so a populated card is
  // itself the proof that the server answers.
  import { serverInfo, backendError } from '../connectionStore'
  import { iconCheck, iconCopy } from '../design/icons'
  import Icon from './Icon.svelte'

  let copied = $state(false)

  async function copyMcpUrl() {
    const url = $serverInfo?.mcpUrl
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      copied = true
      setTimeout(() => (copied = false), 1500)
    } catch {
      // Clipboard unavailable in some contexts.
    }
  }
</script>

<div class="config-view">
  <div class="config-view-header">
    <h2>Server</h2>
    {#if $serverInfo}
      <span class="server-status"><span class="status-dot running"></span> listening</span>
    {:else if $backendError}
      <span class="server-status"><span class="status-dot error"></span> unreachable</span>
    {:else}
      <span class="server-status"><span class="status-dot warn"></span> connecting…</span>
    {/if}
  </div>

  {#if $serverInfo}
    <div class="server-grid">
      <span class="field-label">Address</span>
      <span class="server-value">{$serverInfo.host}:{$serverInfo.port}</span>

      <span class="field-label">Web UI</span>
      <span class="server-value">{$serverInfo.url}</span>

      <span class="field-label">MCP endpoint</span>
      <span class="server-value">
        {$serverInfo.mcpUrl}
        <button
          class="icon-btn icon-btn-dim"
          onclick={copyMcpUrl}
          title="Copy the MCP endpoint URL"
          aria-label="Copy the MCP endpoint URL"
        >
          <Icon path={copied ? iconCheck : iconCopy} />
        </button>
      </span>
    </div>
    <p class="server-hint">
      Point MCP clients (coding agents, scripts) at the MCP endpoint. Set the
      <code>BACKEND_HOST</code> / <code>BACKEND_PORT</code> environment variables before starting to
      change the bind address (e.g. <code>BACKEND_HOST=0.0.0.0</code> to reach mcpscope from WSL or Docker).
    </p>
  {:else}
    <p class="config-empty">
      {$backendError ?? 'Waiting for the backend to answer…'}
    </p>
  {/if}
</div>

<style>
  .server-status {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    font-size: var(--font-meta);
    color: var(--text-dim);
  }

  .server-grid {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 0.35rem 1.25rem;
    align-items: center;
  }

  .server-value {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font-family: var(--mono);
    font-size: var(--font-meta);
    color: var(--text-bright);
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .server-hint {
    margin: 0.75rem 0 0;
    font-size: var(--font-meta);
    color: var(--text-dim);
  }

  .server-hint code {
    font-family: var(--mono);
    font-size: var(--font-label);
  }
</style>
