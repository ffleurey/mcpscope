<script lang="ts">
  import { modelProfiles, upsertModelProfile, removeModelProfile } from '../profileStores'
  import type { ModelProfile, ConnectionTestResult } from '../types'
  import ModelProfileForm from './ModelProfileForm.svelte'
  import ConnectionTestResultComponent from './ConnectionTestResult.svelte'
  import { testLmStudioConnection } from '../services/lmstudio'

  let editingId = $state<string | null>(null)
  let showNew = $state(false)
  let testResults = $state<Record<string, ConnectionTestResult>>({})
  let saveError = $state<string | null>(null)

  function startNew() { showNew = true; editingId = null }
  function cancelNew() { showNew = false }
  function startEdit(id: string) { editingId = id; showNew = false }
  function cancelEdit() { editingId = null }

  async function handleSave(profile: ModelProfile) {
    try {
      await upsertModelProfile(profile)
      showNew = false
      editingId = null
    } catch (e) {
      saveError = e instanceof Error ? e.message : String(e)
    }
  }

  async function handleDelete(id: string) {
    try {
      await removeModelProfile(id)
      if (editingId === id) editingId = null
    } catch (e) {
      saveError = e instanceof Error ? e.message : String(e)
    }
  }

  async function handleTest(profile: ModelProfile) {
    testResults[profile.id] = { status: 'testing', message: '', details: [] }
    const result = await testLmStudioConnection(profile.baseUrl, profile.apiKey)
    testResults[profile.id] = result
  }
</script>

<div class="view">
  <div class="view-header">
    <h2>Model Profiles</h2>
    {#if !showNew}
      <button class="btn btn-primary" onclick={startNew}>New Profile</button>
    {/if}
  </div>

  {#if saveError}
    <p class="save-error">{saveError}</p>
  {/if}

  {#if showNew}
    <ModelProfileForm onSave={handleSave} onCancel={cancelNew} />
  {/if}

  {#if $modelProfiles.length === 0 && !showNew}
    <p class="empty-state">No model profiles yet. Create one to get started.</p>
  {/if}

  {#each $modelProfiles as profile (profile.id)}
    {#if editingId === profile.id}
      <ModelProfileForm profile={profile} onSave={handleSave} onCancel={cancelEdit} />
    {:else}
      <div class="profile-card">
        <div class="card-header">
          <span class="card-name">{profile.name}</span>
          <div class="card-actions">
            <button class="btn btn-sm" onclick={() => handleTest(profile)}>Test Connection</button>
            <button class="btn btn-sm" onclick={() => startEdit(profile.id)}>Edit</button>
            <button class="btn btn-sm btn-danger" onclick={() => handleDelete(profile.id)}>Delete</button>
          </div>
        </div>
        <dl class="card-details">
          <div class="detail-row">
            <dt>Model ID</dt><dd>{profile.modelId}</dd>
          </div>
          <div class="detail-row">
            <dt>Base URL</dt><dd><code>{profile.baseUrl}</code></dd>
          </div>
          <div class="detail-row">
            <dt>Temperature</dt><dd>{profile.temperature}</dd>
          </div>
          {#if profile.contextWindowSize != null}
            <div class="detail-row">
              <dt>Context Window</dt><dd>{profile.contextWindowSize.toLocaleString()} tokens</dd>
            </div>
          {/if}
          {#if profile.systemPrompt}
            <div class="detail-row">
              <dt>System Prompt</dt><dd class="system-prompt-preview">{profile.systemPrompt.slice(0, 120)}{profile.systemPrompt.length > 120 ? '…' : ''}</dd>
            </div>
          {/if}
        </dl>
        {#if testResults[profile.id]}
          <ConnectionTestResultComponent result={testResults[profile.id]} />
        {/if}
      </div>
    {/if}
  {/each}
</div>

<style>
  .view { padding: 1.5rem 2rem; }
  .view-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 1.5rem;
  }
  h2 {
    margin: 0;
    font-size: 1.15rem;
    font-weight: 600;
    color: var(--text);
  }
  .empty-state { color: var(--text-muted); font-size: 0.9rem; }
  .save-error { color: var(--color-error); font-size: 0.875rem; margin-bottom: 1rem; }
  .profile-card {
    background: var(--bg-panel);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 1rem 1.25rem;
    margin-bottom: 1rem;
  }
  .card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.75rem;
  }
  .card-name { font-weight: 600; font-size: 0.95rem; color: var(--text); }
  .card-actions { display: flex; gap: 0.5rem; }
  .card-details { margin: 0; }
  .detail-row {
    display: flex;
    gap: 0.75rem;
    font-size: 0.82rem;
    padding: 0.2rem 0;
    border-bottom: 1px solid var(--border-subtle);
  }
  .detail-row:last-child { border-bottom: none; }
  dt { color: var(--text-muted); min-width: 110px; flex-shrink: 0; }
  dd { margin: 0; color: var(--text); word-break: break-all; }
  .system-prompt-preview { color: var(--text-muted); font-style: italic; }
  code { font-family: var(--mono); font-size: 0.8rem; }
</style>
