<script lang="ts">
  // Renders a Material Design Icon path (from ../design/icons) as inline SVG.
  // Scales with font-size (1em) and inherits color (currentColor); decorative
  // by default — give the surrounding button a title/aria-label.
  let { path }: { path: string } = $props()
</script>

<svg
  xmlns="http://www.w3.org/2000/svg"
  width="1em"
  height="1em"
  viewBox="0 0 24 24"
  fill="currentColor"
  aria-hidden="true"
>
  <path d={path} />
</svg>
