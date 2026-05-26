<script lang="ts">
  import { modelConfigs } from '../connectionStore'
  import type { AnalysisProfile } from '../types'

  interface Props {
    profile?: AnalysisProfile | null
    onSave: (profile: AnalysisProfile) => void
    onCancel: () => void
  }

  let { profile = null, onSave, onCancel }: Props = $props()

  let name = $state('')
  let modelConfigId = $state('')
  let systemPrompt = $state('')
  let temperature = $state(0.7)
  let reasoning = $state<'on' | 'off' | undefined>(undefined)
  let seededProfile = $state<AnalysisProfile | null | undefined>(undefined)

  $effect(() => {
    if (profile === seededProfile) return
    seededProfile = profile
    name = profile?.name ?? ''
    modelConfigId = profile?.modelConfigId ?? ($modelConfigs[0]?.id ?? '')
    systemPrompt = profile?.systemPrompt ?? ''
    temperature = profile?.temperature ?? 0.7
    reasoning = profile?.reasoning
  })

  // Seed modelConfigId when model configs load and nothing is selected
  $effect(() => {
    if (!modelConfigId && $modelConfigs.length > 0) {
      modelConfigId = $modelConfigs[0].id
    }
  })

  let errors = $state<Record<string, string>>({})

  function validate(): boolean {
    const e: Record<string, string> = {}
    if (!name.trim()) e.name = 'Name is required'
    if (!modelConfigId) e.modelConfigId = 'Model config is required'
    if (!systemPrompt.trim()) e.systemPrompt = 'System prompt is required'
    if (isNaN(temperature) || temperature < 0 || temperature > 2) {
      e.temperature = 'Temperature must be between 0.0 and 2.0'
    }
    errors = e
    return Object.keys(e).length === 0
  }

  function handleSubmit() {
    if (!validate()) return
    const now = Date.now()
    onSave({
      id: profile?.id ?? crypto.randomUUID(),
      name: name.trim(),
      modelConfigId,
      systemPrompt: systemPrompt.trim(),
      temperature,
      reasoning,
      createdAt: profile?.createdAt ?? now,
      updatedAt: now,
    })
  }
</script>

<div class="form-card">
  <h3>{profile ? 'Edit Analysis Profile' : 'New Analysis Profile'}</h3>

  <div class="form-group" class:has-error={!!errors.name}>
    <label for="ap-name">Name</label>
    <input id="ap-name" type="text" bind:value={name} placeholder="e.g. Session Analyser" />
    {#if errors.name}<span class="field-error">{errors.name}</span>{/if}
  </div>

  <div class="form-group" class:has-error={!!errors.modelConfigId}>
    <label for="ap-model-config">Model Config</label>
    {#if $modelConfigs.length === 0}
      <p class="empty-state-inline">No model configs available. Create one under Model Configs first.</p>
    {:else}
      <select id="ap-model-config" bind:value={modelConfigId}>
        {#each $modelConfigs as mc (mc.id)}
          <option value={mc.id}>{mc.name} — {mc.modelDisplayName}</option>
        {/each}
      </select>
    {/if}
    {#if errors.modelConfigId}<span class="field-error">{errors.modelConfigId}</span>{/if}
  </div>

  <div class="form-group">
    <label for="ap-temperature">Temperature</label>
    <input id="ap-temperature" type="number" bind:value={temperature} min="0" max="2" step="0.05" />
    {#if errors.temperature}<span class="field-error">{errors.temperature}</span>{/if}
  </div>

  <div class="form-group">
    <label for="ap-reasoning">Reasoning</label>
    <select id="ap-reasoning" bind:value={reasoning}>
      <option value={undefined}>Not set</option>
      <option value="on">On</option>
      <option value="off">Off</option>
    </select>
  </div>

  <div class="form-group" class:has-error={!!errors.systemPrompt}>
    <label for="ap-system-prompt">System Prompt</label>
    <textarea id="ap-system-prompt" rows={6} bind:value={systemPrompt} placeholder="Instructions for the analysis model…"></textarea>
    {#if errors.systemPrompt}<span class="field-error">{errors.systemPrompt}</span>{/if}
  </div>

  <div class="form-actions">
    <button class="btn btn-primary" onclick={handleSubmit} disabled={$modelConfigs.length === 0}>
      {profile ? 'Save Changes' : 'Create Profile'}
    </button>
    <button class="btn" onclick={onCancel}>Cancel</button>
  </div>
</div>

<style>
  .form-card {
    background: var(--bg-panel);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 1.25rem 1.5rem;
    margin: 0 2rem 1rem;
  }
  h3 {
    margin: 0 0 1rem;
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--text);
  }
  .form-group {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    margin-bottom: 0.85rem;
  }
  label {
    font-size: 0.8rem;
    font-weight: 500;
    color: var(--text-muted);
  }
  input, select, textarea {
    background: var(--bg-input);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text);
    font-family: inherit;
    font-size: 0.875rem;
    padding: 0.4rem 0.6rem;
  }
  textarea {
    resize: vertical;
  }
  .has-error input,
  .has-error select,
  .has-error textarea {
    border-color: var(--color-error);
  }
  .field-error {
    font-size: 0.78rem;
    color: var(--color-error);
  }
  .empty-state-inline {
    font-size: 0.82rem;
    color: var(--text-muted);
    margin: 0;
  }
  .form-actions {
    display: flex;
    gap: 0.5rem;
    margin-top: 1rem;
  }
</style>
