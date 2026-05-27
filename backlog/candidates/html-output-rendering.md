We may later want to support explicit HTML output blocks from the model and render them as previews in the UI.

This should be treated as a separate feature from markdown preview because it is more complex and carries different product and security concerns.

The raw text block must still remain the canonical representation in chat. Any rendered HTML should be optional and shown as a preview, not as a replacement for the original content.

## Why this is separate

- it requires deciding how the model should explicitly emit HTML blocks
- it needs stronger safety rules than markdown preview
- it likely requires sandboxing or other strict isolation for rendering
- it should feel more like artifact preview than normal chat rendering

## Open questions

- What is the best output convention for HTML blocks?
  - fenced code block with `html`
  - explicit tagged block
  - structured part type in the future
- How should the model be instructed to emit HTML intentionally rather than accidentally?
- Should HTML be sanitized, sandboxed in an iframe, or both?
- Which HTML features are allowed in preview?
- Should CSS and script be forbidden entirely?

## Initial product direction

- keep HTML preview opt-in
- never replace the raw text block
- render only in a clearly separated preview surface
- assume sandboxing is required before this becomes a real feature
