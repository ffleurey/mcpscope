<script lang="ts">
  import InlineAppError from './InlineAppError.svelte'
  import {
    analysisProfiles,
    analysisDefaults,
    modelConfigs,
    upsertAnalysisProfile,
    removeAnalysisProfile,
    setDefaultAnalysisProfile,
  } from '../connectionStore'
  import type { AnalysisProfile } from '../types'
  import AnalysisProfileForm from './AnalysisProfileForm.svelte'
  import { toAppError, type AppError } from '../errors'

  let editingId = $state<string | null>(null)
  let showNew = $state(false)
  let saveError = $state<AppError | null>(null)

  function startNew() { showNew = true; editingId = null }
  function cancelNew() { showNew = false }
  function startEdit(id: string) { editingId = id; showNew = false }
  function cancelEdit() { editingId = null }

  async function handleSave(profile: AnalysisProfile) {
    try {
      await upsertAnalysisProfile(profile)
      saveError = null
      showNew = false
      editingId = null
    } catch (e) {
      saveError = toAppError(e)
    }
  }

  async function handleDelete(id: string) {
    try {
      await removeAnalysisProfile(id)
      saveError = null
      if (editingId === id) editingId = null
    } catch (e) {
      saveError = toAppError(e)
    }
  }

  async function handleSetDefault(id: string) {
    try {
      await setDefaultAnalysisProfile(id)
      saveError = null
    } catch (e) {
      saveError = toAppError(e)
    }
  }

  async function handleClearDefault() {
    try {
      await setDefaultAnalysisProfile(null)
      saveError = null
    } catch (e) {
      saveError = toAppError(e)
    }
  }

  function modelConfigName(modelConfigId: string): string {
    return $modelConfigs.find(c => c.id === modelConfigId)?.name ?? modelConfigId
  }
</script>

<div class="view">
  <div class="view-header">
    <h2>Analysis Profiles</h2>
    {#if !showNew}
      <button
        class="btn btn-primary"
        onclick={startNew}
        disabled={$modelConfigs.length === 0}
        title={$modelConfigs.length === 0 ? 'Create a model config first' : 'Create a new analysis profile'}
      >+ New Analysis Profile</button>
    {/if}
  </div>

  <InlineAppError error={saveError} />

  {#if $modelConfigs.length === 0}
    <p class="empty-state">No model configs exist yet. Create a model config first before adding analysis profiles.</p>
  {:else if showNew}
    <AnalysisProfileForm onSave={handleSave} onCancel={cancelNew} />
  {/if}

  {#if $analysisProfiles.length === 0 && !showNew}
    <p class="empty-state">No analysis profiles yet. Create one to get started.</p>
  {/if}

  {#each $analysisProfiles as profile (profile.id)}
    {#if editingId === profile.id}
      <AnalysisProfileForm {profile} onSave={handleSave} onCancel={cancelEdit} />
    {:else}
      {@const isDefault = $analysisDefaults?.defaultAnalysisProfileId === profile.id}
      <div class="profile-card" class:is-default={isDefault}>
        <div class="card-header">
          <div class="card-title-group">
            <div class="card-name-row">
              <span class="card-name">{profile.name}</span>
              {#if isDefault}
                <span class="default-badge">Default analysis profile</span>
              {/if}
            </div>
            <span class="card-subtitle">{modelConfigName(profile.modelConfigId)}</span>
          </div>
          <div class="card-actions">
            {#if isDefault}
              <button class="btn btn-sm btn-warning" onclick={handleClearDefault}>Clear default</button>
            {:else}
              <button class="btn btn-sm btn-accent" onclick={() => handleSetDefault(profile.id)}>Set as default</button>
            {/if}
            <button class="btn btn-sm" onclick={() => startEdit(profile.id)}>Edit</button>
            <button class="btn btn-sm btn-danger" onclick={() => handleDelete(profile.id)}>Delete</button>
          </div>
        </div>
        <dl class="card-details">
          <div class="detail-row">
            <dt>Model Config</dt>
            <dd>{modelConfigName(profile.modelConfigId)}</dd>
          </div>
          <div class="detail-row">
            <dt>Temperature</dt>
            <dd>{profile.temperature}</dd>
          </div>
          {#if profile.reasoning}
            <div class="detail-row">
              <dt>Reasoning</dt>
              <dd>{profile.reasoning}</dd>
            </div>
          {/if}
          <div class="detail-row">
            <dt>System Prompt</dt>
            <dd class="system-prompt-preview">{profile.systemPrompt}</dd>
          </div>
        </dl>
      </div>
    {/if}
  {/each}
</div>

<style>
  .view {
    padding: 1.5rem 0;
    overflow-y: auto;
    flex: 1;
  }
  .view-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 2rem 1rem;
    border-bottom: 1px solid var(--border-subtle);
    margin-bottom: 1rem;
  }
  .view-header h2 {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
  }
  .empty-state {
    padding: 2rem;
    color: var(--text-muted);
    font-size: 0.875rem;
  }
  .profile-card {
    margin: 0 2rem 0.75rem;
    background: var(--bg-panel);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0.85rem 1rem;
  }
  .profile-card.is-default {
    border-color: var(--color-accent, #4a9eff);
  }
  .card-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 0.6rem;
  }
  .card-title-group {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }
  .card-name-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .card-name {
    font-weight: 600;
    font-size: 0.9rem;
  }
  .card-subtitle {
    font-size: 0.8rem;
    color: var(--text-muted);
  }
  .default-badge {
    font-size: 0.7rem;
    padding: 0.15rem 0.45rem;
    border-radius: 3px;
    background: var(--color-accent, #4a9eff);
    color: #fff;
    font-weight: 500;
  }
  .card-actions {
    display: flex;
    gap: 0.4rem;
    flex-shrink: 0;
  }
  .card-details {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.15rem 1rem;
    font-size: 0.8rem;
    margin: 0;
  }
  .detail-row {
    display: contents;
  }
  dt {
    color: var(--text-muted);
    white-space: nowrap;
  }
  dd {
    margin: 0;
    color: var(--text);
  }
  .system-prompt-preview {
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 4.5em;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
  }
</style>
