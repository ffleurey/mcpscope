<script lang="ts">
  import { iconCheckboxMarked, iconCheckboxBlank } from '../design/icons'
  import Icon from './Icon.svelte'

  interface Props {
    checked: boolean
    label?: string
    hint?: string
    disabled?: boolean
    title?: string
    onchange?: (checked: boolean) => void
  }

  let { checked, label = '', hint = '', disabled = false, title = '', onchange }: Props = $props()
</script>

<label class="opt-check" class:disabled title={title || undefined}>
  <input
    type="checkbox"
    {checked}
    {disabled}
    onchange={(e) => onchange?.(e.currentTarget.checked)}
  />
  <span class="opt-mark">
    <span class="opt-on"><Icon path={iconCheckboxMarked} /></span>
    <span class="opt-off"><Icon path={iconCheckboxBlank} /></span>
  </span>
  <span class="opt-text">{label}</span>
  {#if hint}<span class="opt-hint">{hint}</span>{/if}
</label>
