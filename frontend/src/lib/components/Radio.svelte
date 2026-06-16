<script lang="ts">
  import { iconRadioMarked, iconRadioBlank } from '../design/icons'

  interface Props {
    group: string
    value: string
    name?: string
    label?: string
    hint?: string
    disabled?: boolean
    onselect?: (value: string) => void
  }

  let { group, value, name, label = '', hint = '', disabled = false, onselect }: Props = $props()
</script>

<label class="opt-radio" class:disabled>
  <input
    type="radio"
    {name}
    {value}
    checked={group === value}
    {disabled}
    onchange={() => onselect?.(value)}
  />
  <span class="opt-mark">
    <span class="opt-on">{@html iconRadioMarked}</span>
    <span class="opt-off">{@html iconRadioBlank}</span>
  </span>
  <span class="opt-text">{label}</span>
  {#if hint}<span class="opt-hint">{hint}</span>{/if}
</label>
