We want to keep the chat UI as simple text rendering. We have added some highlighting and it is very good.

We do not want to change the main chat rendering to HTML because the whole point of the tool is to show the output as it actually was produced.

However, when an assistant response block contains markdown, we could add a button to open a rendered preview.

For a first version, this should be a simple dialog or modal and should not replace the source text block in the chat. The raw block remains the canonical view, and the rendered version is only an optional preview.

This idea is intentionally limited to markdown preview.

## Scope

- keep raw text rendering as the default in chat
- detect markdown-like assistant content blocks
- add a button such as `Preview` or `Render`
- open the rendered markdown in a dialog/modal
- do not replace the original text block inline

## Notes

- `markdown-it` looks like the best initial library choice: popular, well maintained, lightweight enough for this feature, and easy to keep scoped to safe markdown preview.
- The preview should be clearly labelled as a rendered view of the same raw content.
- HTML output/rendering is a separate idea and should be considered independently.

## Implementation plan

### 1. Rendering library

- add `markdown-it`
- keep raw HTML disabled in the renderer
- keep the configuration minimal for the first version

### 2. Block-level preview action

- identify assistant content blocks that look like markdown
- add a small `Preview` button on those blocks
- keep the button out of the default reading flow when a block is clearly plain text

### 3. Preview dialog

- open a modal/dialog containing the rendered markdown
- keep the raw source block visible in the main chat view
- label the dialog clearly as a rendered preview of the original block

### 4. Styling

- use simple typography-oriented styling for headings, lists, code, blockquotes, and links
- reuse the existing visual language where possible
- keep the preview readable without trying to make it look like a full document viewer

### 5. Safety and boundaries

- do not switch the main chat rendering to HTML
- do not render arbitrary HTML from the model in this feature
- keep this feature limited to markdown preview only

### 6. Validation

- verify the button only appears for blocks that should be previewable
- verify markdown rendering works for common cases: headings, emphasis, lists, links, fenced code blocks, and tables if supported
- verify the raw text block remains the canonical visible representation in chat
