<script lang="ts">
  // A compact group of mutually-exclusive options (a "switch"/toggle group).
  // The selected option uses the sanctioned amber active-state signal — amber
  // text on a faint amber wash — so it reads clearly on the dark surface.
  interface Option {
    value: string
    label: string
  }

  interface Props {
    options: Option[]
    /** The currently selected option's value. */
    selected: string
    /** Called with the chosen value when an option is clicked. */
    onSelect: (value: string) => void
    /** Accessible label for the group (e.g. "Format"). */
    ariaLabel?: string
  }

  let { options, selected, onSelect, ariaLabel }: Props = $props()
</script>

<div class="seg" role="group" aria-label={ariaLabel}>
  {#each options as opt (opt.value)}
    <button
      type="button"
      class="seg-btn"
      class:active={selected === opt.value}
      aria-pressed={selected === opt.value}
      onclick={() => onSelect(opt.value)}>{opt.label}</button
    >
  {/each}
</div>

<style>
  .seg {
    display: inline-flex;
    border: 1px solid var(--border);
    border-radius: 6px;
    overflow: hidden;
  }

  .seg-btn {
    background: none;
    border: none;
    border-right: 1px solid var(--border);
    color: var(--text-dim);
    cursor: pointer;
    font-family: var(--mono);
    font-size: var(--font-label);
    padding: 0.22rem 0.7rem;
  }

  .seg-btn:last-child {
    border-right: none;
  }

  .seg-btn:hover:not(.active) {
    background: var(--bg-hover);
    color: var(--text-bright);
  }

  /* Selected: amber text + faint amber wash (the sanctioned active signal). */
  .seg-btn.active {
    background: color-mix(in srgb, var(--amber-bright) 16%, transparent);
    color: var(--amber-bright);
  }
</style>
