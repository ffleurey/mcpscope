<script lang="ts">
  import { analysisProfiles, analysisDefaults } from '../connectionStore'
  import { isLaunchingAnalysis, launchAnalysis, sessionError } from '../sessionStore'
  import { currentView } from '../navStore'
  import DialogShell from './DialogShell.svelte'

  interface Props {
    targetSessionId: string
    targetSessionTitle: string
    onClose: () => void
  }

  let { targetSessionId, targetSessionTitle, onClose }: Props = $props()

  let selectedProfileId = $state('')
  let analysisPrompt = $state('')
  let hasInitialized = $state(false)

  $effect(() => {
    if (!hasInitialized) {
      const defaultId = $analysisDefaults?.defaultAnalysisProfileId ?? null
      if (defaultId && $analysisProfiles.some(p => p.id === defaultId)) {
        selectedProfileId = defaultId
      } else if ($analysisProfiles.length > 0) {
        selectedProfileId = $analysisProfiles[0]!.id
      }
      hasInitialized = true
    }
  })

  async function handleLaunch() {
    if (!analysisPrompt.trim() || !selectedProfileId) return

    await launchAnalysis({
      targetSessionId,
      analysisProfileId: selectedProfileId,
      analysisPrompt: analysisPrompt.trim(),
    })

    if (!$sessionError) {
      currentView.set('chats')
      onClose()
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      void handleLaunch()
    }
  }
</script>

<DialogShell title="Analyze session" {onClose} dialogClass="analysis-launch-dialog">
  <div class="form">
    <p class="target-label">Target: <span class="target-title">[{targetSessionId}] {targetSessionTitle}</span></p>

    <div class="field">
      <label class="field-label" for="analysis-profile-select">Analysis profile</label>
      {#if $analysisProfiles.length === 0}
        <p class="field-hint">No analysis profiles configured. Create one in <strong>Analysis Profiles</strong> first.</p>
      {:else}
        <select
          id="analysis-profile-select"
          class="field-select"
          bind:value={selectedProfileId}
          disabled={$isLaunchingAnalysis}
        >
          {#each $analysisProfiles as p (p.id)}
            <option value={p.id}>
              {p.name}{$analysisDefaults?.defaultAnalysisProfileId === p.id ? ' (default)' : ''}
            </option>
          {/each}
        </select>
      {/if}
    </div>

    <div class="field">
      <label class="field-label" for="analysis-prompt">Evaluation instructions</label>
      <p class="field-hint">
        Describe what you expected this session to do, which tools should have been used,
        any failure modes to watch for, or any other evaluation guidance.
      </p>
      <!-- svelte-ignore a11y_autofocus -->
      <textarea
        id="analysis-prompt"
        class="prompt-textarea"
        placeholder="e.g. The agent should have called get_weather before answering. It should not have hallucinated tool results. Evaluate whether it cited evidence from the trace."
        rows={6}
        bind:value={analysisPrompt}
        disabled={$isLaunchingAnalysis}
        onkeydown={handleKeydown}
        autofocus
      ></textarea>
    </div>

    {#if $sessionError}
      <div class="error-banner">{$sessionError.message}</div>
    {/if}

    <div class="actions">
      <button class="btn-secondary" onclick={onClose} disabled={$isLaunchingAnalysis}>
        Cancel
      </button>
      <button
        class="btn-primary"
        onclick={handleLaunch}
        disabled={$isLaunchingAnalysis || !analysisPrompt.trim() || !selectedProfileId}
      >
        {$isLaunchingAnalysis ? 'Launching…' : 'Launch analysis'}
      </button>
    </div>
  </div>
</DialogShell>

<style>
  .form {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 0.25rem 0;
  }

  .target-label {
    font-size: 0.8rem;
    color: var(--text-muted);
    margin: 0;
  }

  .target-title {
    color: var(--text);
    font-weight: 500;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .field-label {
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .field-hint {
    font-size: 0.78rem;
    color: var(--text-muted);
    margin: 0;
    line-height: 1.4;
  }

  .field-select,
  .prompt-textarea {
    background: var(--bg-input, var(--bg));
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text);
    font: inherit;
    font-size: 0.85rem;
    padding: 0.45rem 0.6rem;
    width: 100%;
    box-sizing: border-box;
  }

  .prompt-textarea {
    resize: vertical;
    min-height: 100px;
  }

  .error-banner {
    background: color-mix(in srgb, var(--color-error, #f87171) 15%, transparent);
    border: 1px solid var(--color-error, #f87171);
    border-radius: 4px;
    color: var(--color-error, #f87171);
    font-size: 0.82rem;
    padding: 0.5rem 0.75rem;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    padding-top: 0.25rem;
  }

  .btn-primary,
  .btn-secondary {
    border-radius: 4px;
    border: 1px solid var(--border);
    cursor: pointer;
    font: inherit;
    font-size: 0.85rem;
    padding: 0.4rem 0.9rem;
    transition: background 0.1s;
  }

  .btn-primary {
    background: var(--color-accent, #7c3aed);
    border-color: var(--color-accent, #7c3aed);
    color: #fff;
  }

  .btn-primary:hover:not(:disabled) {
    filter: brightness(1.1);
  }

  .btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-secondary {
    background: transparent;
    color: var(--text-muted);
  }

  .btn-secondary:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text);
  }

  .btn-secondary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  :global(.analysis-launch-dialog) {
    max-width: min(560px, 95vw);
  }
</style>
