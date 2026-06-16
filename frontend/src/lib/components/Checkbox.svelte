<script lang="ts">
  import { iconCheckboxMarked, iconCheckboxBlank } from '../design/icons'

  interface Props {
    checked: boolean
    label?: string
    hint?: string
    disabled?: boolean
    onchange?: (checked: boolean) => void
  }

  let { checked, label = '', hint = '', disabled = false, onchange }: Props = $props()
</script>

<label class="opt-check" class:disabled>
  <input
    type="checkbox"
    {checked}
    {disabled}
    onchange={(e) => onchange?.(e.currentTarget.checked)}
  />
  <span class="opt-mark">
    <span class="opt-on">{@html iconCheckboxMarked}</span>
    <span class="opt-off">{@html iconCheckboxBlank}</span>
  </span>
  <span class="opt-text">{label}</span>
  {#if hint}<span class="opt-hint">{hint}</span>{/if}
</label>
