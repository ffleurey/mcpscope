<script lang="ts">
  import { clearSessionError, sessionError, sessionErrorSurface } from '../sessionStore'
  import DialogShell from './DialogShell.svelte'
  import InlineAppError from './InlineAppError.svelte'

  function dismiss() {
    clearSessionError()
  }
</script>

{#if $sessionError && $sessionErrorSurface === 'dialog'}
  <DialogShell title="Error" onClose={dismiss}>
    <InlineAppError error={$sessionError} />
    <div class="dialog-actions">
      <button class="btn" onclick={dismiss}>OK</button>
    </div>
  </DialogShell>
{/if}

<style>
  .dialog-actions {
    display: flex;
    justify-content: flex-end;
  }
</style>
