<script lang="ts">
  // The configuration page: the three config sections (providers, model
  // configs, MCP servers) rendered as Home-style cards. These are the shared
  // LmConnections/ModelConfigs/McpProfiles section components — no config UI is
  // duplicated here.
  import LmConnections from './LmConnections.svelte'
  import ModelConfigs from './ModelConfigs.svelte'
  import McpProfiles from './McpProfiles.svelte'
</script>

<div class="config-page">
  <div class="config-page-inner">
    <header class="config-head">
      <h1>Configuration</h1>
      <p>Providers, model configs, and MCP servers — all in one place.</p>
    </header>

    <section class="config-card"><LmConnections /></section>
    <section class="config-card"><ModelConfigs /></section>
    <section class="config-card"><McpProfiles /></section>
  </div>
</div>

<style>
  .config-page {
    flex: 1;
    overflow-y: auto;
    padding: 2rem 1.5rem;
  }
  .config-page-inner {
    max-width: 1080px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }
  .config-head h1 {
    margin: 0 0 0.25rem;
    font-size: 1.4rem;
    color: var(--text-bright);
  }
  .config-head p {
    margin: 0;
    font-size: 0.85rem;
    color: var(--text-dim);
  }

  /* Home-style card chrome. The embedded .config-view supplies its own header and
     content padding, so the card only adds the surface/border/radius — and we
     tighten the inner padding to match the Home cards' density. */
  .config-card {
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 8px;
  }
  .config-card :global(.config-view) {
    padding: 1.1rem 1.25rem;
  }
</style>
