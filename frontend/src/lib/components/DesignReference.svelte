<script lang="ts">
  import DialogShell from './DialogShell.svelte'
  import {
    iconPlus, iconClose, iconPlay, iconPause, iconImport, iconExport,
    iconAnalysis, iconSettings, iconTrash,
    iconChevronRight, iconChevronDown,
    iconDot, iconSpinner,
  } from '../design/icons'

  let showDialog = $state(false)

  // ── Color tokens (keep in sync with app.css :root) ────────────────
  const colors = [
    { category: 'Grey — Backgrounds', items: [
      { token: '--bg-base',       value: '#141414', use: 'Main app background' },
      { token: '--bg-surface',    value: '#1e1e1e', use: 'Panels, dialogs, sidebar, inputs' },
      { token: '--bg-hover',      value: '#282828', use: 'Hover state for interactive elements' },
      { token: '--border',        value: '#333333', use: 'Borders, dividers, separators' },
    ]},
    { category: 'Grey — Text', items: [
      { token: '--text-dim',      value: '#888888', use: 'Labels, metadata, muted text' },
      { token: '--text-bright',   value: '#e8e8e8', use: 'Primary body text (near-white)' },
    ]},
    { category: 'Amber — Primary accent (minimal use)', items: [
      { token: '--amber-dim',     value: 'oklch(55% 0.15 75)', use: 'Logo, secondary amber text' },
      { token: '--amber-bright',  value: 'oklch(72% 0.18 75)', use: 'Primary buttons, active tab underline, links' },
      { token: '--amber-glow',    value: 'oklch(78% 0.20 75)', use: 'Hover/enhanced state for primary elements' },
    ]},
    { category: 'Green — Secondary accent (status, success)', items: [
      { token: '--green-dim',     value: 'oklch(50% 0.14 145)', use: 'Dim status, offline/dormant' },
      { token: '--green-bright',  value: 'oklch(65% 0.18 145)', use: 'Active status dots, success feedback' },
      { token: '--green-glow',    value: 'oklch(72% 0.22 145)', use: 'Bright status, pulsed indicators' },
    ]},
    { category: 'Red — Destructive actions, errors', items: [
      { token: '--red-dim',       value: 'oklch(45% 0.12 25)', use: 'Error text, danger button borders' },
      { token: '--red-bright',    value: 'oklch(60% 0.16 25)', use: 'Danger buttons, error states, deletion' },
    ]},
  ]

  const rules = [
    '--bg-base is the outermost background; everything sits on it.',
    '--bg-surface is one step lighter — used for containers that need distinction from the base.',
    '--text-bright is the default text color; --text-dim for supporting information.',
    'No color-on-color: accent colors sit on --bg-base or --bg-surface only (never on another color).',
    'Amber is reserved for the logo and the single primary action per view/dialog. Most of the UI has no amber at all.',
    'Most of the UI is monochrome grey. Color is added only where it provides signal.',
    'color-scheme: dark on :root to force neutral system colors on native controls.',
  ]
</script>

<div class="ref-page">
  <header class="ref-header">
    <h1>Design System Reference</h1>
    <p class="ref-subtitle">
      Living style guide — rendered from live CSS and components.
      See <span class="mono">backlog/design-system.md</span> for rationale and decisions.
    </p>
  </header>

  <!-- ─── COLORS ─────────────────────────────────────────────────────── -->
  <section class="ref-section" id="colors">
    <h2>Colors</h2>

    {#each colors as group}
      <h3 class="group-title">{group.category}</h3>
      <div class="swatch-grid">
        {#each group.items as c}
          <div class="swatch-card">
            <div
              class="swatch"
              style="background: {c.value}; outline: 1px solid var(--border); outline-offset: -1px;"
            ></div>
            <div class="swatch-info">
              <code class="swatch-token">{c.token}</code>
              <code class="swatch-value">{c.value}</code>
              <span class="swatch-use">{c.use}</span>
            </div>
          </div>
        {/each}
      </div>
    {/each}

    <div class="rules-callout">
      <strong>Color rules</strong>
      <ul>
        {#each rules as rule}
          <li>{rule}</li>
        {/each}
      </ul>
    </div>
  </section>

  <!-- ─── TYPOGRAPHY ─────────────────────────────────────────────────── -->
  <section class="ref-section" id="typography">
    <h2>Typography</h2>

    <div class="type-grid">
      <div class="type-card">
        <code class="type-token">--sans</code>
        <p class="type-sample sans">The quick brown fox jumps over the lazy dog 123</p>
        <p class="type-stack">system-ui, 'Segoe UI', Roboto, sans-serif</p>
      </div>
      <div class="type-card">
        <code class="type-token">--mono</code>
        <p class="type-sample mono">The quick brown fox jumps over the lazy dog 123</p>
        <p class="type-stack">ui-monospace, 'Cascadia Code', Consolas, monospace</p>
      </div>
    </div>

    <h3 class="group-title">Sizes</h3>
    <table class="size-table">
      <tbody>
        <tr><td><code>14px</code></td><td class="size-14 sans">Base body text</td><td><code>line-height: 1.5</code></td></tr>
        <tr><td><code>12px</code></td><td class="size-12 sans">Small UI text (labels, badges, metadata)</td><td><code>0.75rem</code></td></tr>
        <tr><td><code>13px</code></td><td class="size-13 mono">Monospace data (token counts, IDs, code)</td><td><code>0.8125rem</code></td></tr>
        <tr><td><code>14px</code></td><td class="size-14 mono">Compact UI line-height</td><td><code>line-height: 1.4</code></td></tr>
      </tbody>
    </table>
  </section>

  <!-- ─── BUTTONS ────────────────────────────────────────────────────── -->
  <section class="ref-section" id="buttons">
    <h2>Buttons</h2>

    <div class="demo-row">
      <button class="btn">Default</button>
      <button class="btn btn-primary">Primary</button>
      <button class="btn btn-danger">Danger</button>
      <button class="btn" disabled>Disabled</button>
      <button class="btn btn-primary" disabled>Disabled primary</button>
      <button class="icon-btn" title="Icon button">+</button>
      <button class="btn btn-sm">Small</button>
    </div>

    <p class="ref-note">
      All three variants follow the same model: transparent bg, accent
      border + text. Hover adds a subtle accent-tinted background.
      Only one primary button per view/dialog.
    </p>

    <h3 class="group-title">With icon</h3>
    <div class="demo-row">
      <button class="btn"><span class="btn-icon">{@html iconAnalysis}</span> Analyze</button>
      <button class="btn btn-primary"><span class="btn-icon">{@html iconPlus}</span> New session</button>
      <button class="btn btn-danger"><span class="btn-icon">{@html iconTrash}</span> Delete</button>
      <button class="btn"><span class="btn-icon">{@html iconExport}</span> Export</button>
      <button class="btn btn-sm"><span class="btn-icon">{@html iconImport}</span> Import</button>
    </div>

    <h3 class="group-title">Icon only</h3>
    <div class="demo-row">
      <button class="icon-btn" title="Add">{@html iconPlus}</button>
      <button class="icon-btn" title="Close">{@html iconClose}</button>
      <button class="icon-btn" title="Settings">{@html iconSettings}</button>
      <button class="icon-btn" title="Delete" style="color: var(--red-bright);">{@html iconTrash}</button>
      <button class="icon-btn" title="Play">{@html iconPlay}</button>
      <button class="icon-btn" title="Pause">{@html iconPause}</button>
      <button class="icon-btn" title="Disabled" disabled>{@html iconPlus}</button>
    </div>

    <p class="ref-note">
      All icons are inline SVGs from <code class="mono">src/lib/design/icons.ts</code>.
      Use <code class="mono">.icon-btn</code> for standalone icons, <code class="mono">.btn-icon</code>
      inside <code class="mono">.btn</code> for icon+text. Tint with accent colors for meaning.
    </p>

  </section>

  <!-- ─── FORM FIELDS ────────────────────────────────────────────────── -->
  <section class="ref-section" id="forms">
    <h2>Form Fields</h2>
    <p class="ref-note">
      Fully monochrome — no accent outline on focus.
      Checkboxes, radios and selects use standard OS rendering with
      <code class="mono">accent-color: var(--amber-bright)</code>.
      The dark theme comes from <code class="mono">color-scheme: dark</code>
      on the root element.
    </p>

    <div class="form-demo">
      <div class="field">
        <label class="field-label" for="demo-input">Text input</label>
        <input id="demo-input" class="field-input" type="text" placeholder="Placeholder text" />
      </div>

      <div class="field">
        <label class="field-label" for="demo-select">Select</label>
        <select id="demo-select" class="field-input">
          <option>Option one</option>
          <option>Option two</option>
          <option>Option three</option>
        </select>
      </div>

      <div class="field">
        <label class="field-label" for="demo-textarea">Textarea</label>
        <textarea id="demo-textarea" class="field-input" rows="3" placeholder="Multi-line text"></textarea>
      </div>

      <div class="field">
        <span class="field-label">Checkbox group</span>
        <label class="check-option">
          <input type="checkbox" checked />
          <span class="check-label">Option A</span>
        </label>
        <label class="check-option">
          <input type="checkbox" />
          <span class="check-label">Option B</span>
        </label>
      </div>

      <div class="field">
        <span class="field-label">Radio group</span>
        <label class="radio-opt">
          <input type="radio" name="demo-radio" checked />
          <span class="radio-opt-label">Choice one</span>
          <span class="radio-opt-hint">With a hint below</span>
        </label>
        <label class="radio-opt">
          <input type="radio" name="demo-radio" />
          <span class="radio-opt-label">Choice two</span>
        </label>
      </div>

      <div class="field">
        <label class="field-label" for="demo-error">With error</label>
        <input id="demo-error" class="field-input field-error" type="text" value="bad value" />
        <span class="field-errortext">This field has a problem</span>
      </div>

      <div class="field">
        <label class="field-label" for="demo-hint">With hint</label>
        <input id="demo-hint" class="field-input" type="text" />
        <span class="field-hinttext">A helpful description of this field.</span>
      </div>
    </div>
  </section>

  <!-- ─── DIALOG ─────────────────────────────────────────────────────── -->
  <section class="ref-section" id="dialogs">
    <h2>Dialog</h2>

    <button class="btn btn-primary" onclick={() => showDialog = true}>Open demo dialog</button>

    {#if showDialog}
      <DialogShell title="Demo dialog" onClose={() => showDialog = false}>
        <div class="dialog-demo-body">
          <p>DialogShell with header, body, and action buttons.</p>
          <div class="dialog-demo-actions">
            <button class="btn" onclick={() => showDialog = false}>Cancel</button>
            <button class="btn btn-primary" onclick={() => showDialog = false}>Confirm</button>
          </div>
        </div>
      </DialogShell>
    {/if}

    <p class="ref-note">
      Uses native <code class="mono">&lt;dialog&gt;</code> element with <code class="mono">::backdrop</code>.
      Max width 720px or 95vw, max height 85vh.
    </p>
  </section>

  <!-- ─── STATUS INDICATORS ──────────────────────────────────────────── -->
  <section class="ref-section" id="status">
    <h2>Status indicators</h2>

    <div class="demo-row">
      <span class="status-dot-demo running"></span><span class="status-label-demo">Running / active</span>
      <span class="status-dot-demo idle"></span><span class="status-label-demo">Idle / ready</span>
      <span class="status-dot-demo warn"></span><span class="status-label-demo">Warning / attention</span>
      <span class="status-dot-demo error"></span><span class="status-label-demo">Error / failed</span>
    </div>

    <p class="ref-note">
      Flat dots, no glow effects. Colors: <code class="mono">--green-bright</code>,
      <code class="mono">--green-dim</code>, <code class="mono">--amber-bright</code>,
      <code class="mono">--red-bright</code>.
    </p>
  </section>

  <!-- ─── UTILITY PATTERNS ───────────────────────────────────────────── -->
  <section class="ref-section" id="utility">
    <h2>Utility patterns</h2>

    <h3 class="group-title">Token pill</h3>
    <div class="demo-row">
      <span class="token-pill">1,234 tokens</span>
      <span class="token-pill">~500 tokens</span>
    </div>

    <h3 class="group-title">Details / Summary expand</h3>
    <details class="demo-details">
      <summary class="demo-details-summary">Click to expand</summary>
      <div class="demo-details-body">
        Hidden content revealed on expand. Uses the <code class="mono">▶</code> / rotate pattern.
      </div>
    </details>

    <h3 class="group-title">Error banner</h3>
    <div class="demo-error-banner">
      <div class="demo-error-message">Something went wrong processing your request.</div>
    </div>

    <h3 class="group-title">ID badge</h3>
    <div class="demo-row">
      <span class="id-pill-demo">AB12</span>
      <span class="id-pill-demo">AB12.3W.1T</span>
    </div>

    <h3 class="group-title">Links</h3>
    <div class="demo-row">
      <a href="#colors" onclick={(e) => e.preventDefault()}>Amber link</a>
    </div>
    <p class="ref-note">
      Links use <code class="mono">--amber-bright</code>, no underline by default, underline on hover.
      Text selection uses <code class="mono">--amber-bright</code> at 30% opacity.
    </p>
  </section>

  <!-- ─── SESSION PATTERNS ────────────────────────────────────────────── -->
  <section class="ref-section" id="session">
    <h2>Session content</h2>
    <p class="ref-note">
      Green phosphor text distinguishes session data from UI chrome.
      All text inside a session trace uses <code class="mono">--green-bright</code>.
      See <code class="mono">backlog/design-system.md</code> for the full rationale.
    </p>

    <h3 class="group-title">Session text samples</h3>
    <div class="session-demo">
      <div class="session-part" style="color: var(--green-bright);">
        <span class="session-part-label">User prompt</span>
        <p>What tools are available for weather data?</p>
      </div>
      <div class="session-part" style="color: var(--green-bright);">
        <span class="session-part-label">Reasoning</span>
        <p class="session-reasoning">The user is asking about weather tools. I should list the available MCP tools and their capabilities.</p>
      </div>
      <div class="session-part" style="color: var(--green-bright);">
        <span class="session-part-label">Tool call</span>
        <p class="session-mono">get_forecast(latitude: 48.85, longitude: 2.35)</p>
      </div>
      <div class="session-part" style="color: var(--green-bright);">
        <span class="session-part-label">Assistant answer</span>
        <p>The current temperature in Paris is 18°C with partly cloudy skies. The forecast shows a high of 22°C tomorrow.</p>
      </div>
    </div>

    <div class="demo-row" style="margin-top: 0.75rem;">
      <span class="token-pill" style="border-color: var(--border); color: var(--green-bright);">1,234 tokens</span>
      <span class="token-pill" style="border-color: var(--border); color: var(--green-bright);">~500 tokens</span>
      <span class="session-badge">Round 3</span>
      <span class="session-badge">AB12.4T</span>
    </div>
  </section>

  <!-- ─── ICON SET ────────────────────────────────────────────────────── -->
  <section class="ref-section" id="icons">
    <h2>Icon set</h2>
    <p class="ref-note">
      All icons live in <code class="mono">src/lib/design/icons.ts</code> as inline SVG strings.
      No icon font dependency. Style via <code class="mono">font-size</code> and <code class="mono">color</code>
      on the wrapping element.
    </p>

    <div class="icon-grid">
      <div class="icon-cell"><span class="icon-demo">{@html iconChevronRight}</span><code>iconChevronRight</code></div>
      <div class="icon-cell"><span class="icon-demo">{@html iconChevronDown}</span><code>iconChevronDown</code></div>
      <div class="icon-cell"><span class="icon-demo">{@html iconPlus}</span><code>iconPlus</code></div>
      <div class="icon-cell"><span class="icon-demo">{@html iconClose}</span><code>iconClose</code></div>
      <div class="icon-cell"><span class="icon-demo">{@html iconPlay}</span><code>iconPlay</code></div>
      <div class="icon-cell"><span class="icon-demo">{@html iconPause}</span><code>iconPause</code></div>
      <div class="icon-cell"><span class="icon-demo">{@html iconImport}</span><code>iconImport</code></div>
      <div class="icon-cell"><span class="icon-demo">{@html iconExport}</span><code>iconExport</code></div>
      <div class="icon-cell"><span class="icon-demo">{@html iconAnalysis}</span><code>iconAnalysis</code></div>
      <div class="icon-cell"><span class="icon-demo">{@html iconSettings}</span><code>iconSettings</code></div>
      <div class="icon-cell"><span class="icon-demo">{@html iconTrash}</span><code>iconTrash</code></div>
      <div class="icon-cell"><span class="icon-demo">{@html iconDot}</span><code>iconDot</code></div>
      <div class="icon-cell"><span class="icon-demo">{@html iconSpinner}</span><code>iconSpinner</code></div>
    </div>
  </section>

  <!-- ─── COMPACT LAYOUT ─────────────────────────────────────────────── -->
  <section class="ref-section" id="layout">
    <h2>Layout & density</h2>
    <ul class="principle-list">
      <li><strong>Default padding</strong> for containers, dialogs, buttons: <code>0.75rem</code></li>
      <li><strong>Default gap</strong> between related elements: <code>0.35rem</code></li>
      <li>Use Svelte <code>style</code> directives and native CSS gap/padding directly — no utility classes.</li>
      <li>No unnecessary wrapper divs. Prefer flat DOM with direct spacing.</li>
      <li>Dialogs and forms must fit without scrolling.</li>
      <li>Use the minimum spacing that makes information legible.</li>
    </ul>
  </section>
</div>

<style>
  /* ── Page layout ──────────────────────────────────────────────────── */
  .ref-page {
    padding: 1.5rem 2rem;
    max-width: 900px;
    overflow-y: auto;
    height: 100%;
  }

  .ref-header {
    margin-bottom: 2rem;
  }

  .ref-header h1 {
    font-size: 1.3rem;
    font-weight: 700;
    color: var(--amber-bright, var(--color-accent));
    margin: 0 0 0.35rem;
  }

  .ref-subtitle {
    font-size: 0.85rem;
    color: var(--text-dim);
    margin: 0;
  }

  .ref-section {
    margin-bottom: 2.5rem;
  }

  .ref-section h2 {
    font-size: 1rem;
    font-weight: 600;
    color: var(--text-bright);
    border-bottom: 1px solid var(--border);
    padding-bottom: 0.4rem;
    margin: 0 0 0.75rem;
  }

  .group-title {
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin: 1rem 0 0.5rem;
  }

  .ref-note {
    font-size: 0.8rem;
    color: var(--text-dim);
    margin: 0.5rem 0 0;
    line-height: 1.5;
  }

  .mono {
    font-family: var(--mono);
  }

  /* ── Icon grid ─────────────────────────────────────────────────────── */
  .icon-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 0.4rem;
    margin-top: 0.5rem;
  }

  .icon-cell {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.3rem 0.5rem;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-surface);
  }

  .icon-demo {
    display: inline-flex;
    font-size: 1rem;
    color: var(--text-bright);
    flex-shrink: 0;
  }

  .icon-cell code {
    font-size: 0.68rem;
    color: var(--text-dim);
    word-break: break-all;
  }

  /* ── Colors ───────────────────────────────────────────────────────── */
  .swatch-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 0.5rem;
    margin-bottom: 1rem;
  }

  .swatch-card {
    display: flex;
    gap: 0.5rem;
    align-items: flex-start;
    padding: 0.4rem;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-surface);
  }

  .swatch {
    width: 2rem;
    height: 2rem;
    border-radius: 3px;
    flex-shrink: 0;
  }

  .swatch-info {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    min-width: 0;
  }

  .swatch-token {
    font-family: var(--mono);
    font-size: 0.72rem;
    color: var(--text-bright);
    font-weight: 600;
  }

  .swatch-value {
    font-family: var(--mono);
    font-size: 0.68rem;
    color: var(--text-dim);
  }

  .swatch-use {
    font-size: 0.75rem;
    color: var(--text-dim);
    line-height: 1.3;
  }

  .rules-callout {
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0.75rem 1rem;
    font-size: 0.82rem;
    color: var(--text-bright);
  }

  .rules-callout ul {
    margin: 0.35rem 0 0;
    padding-left: 1.2rem;
  }

  .rules-callout li {
    margin-bottom: 0.2rem;
    line-height: 1.45;
    color: var(--text-dim);
  }

  /* ── Typography ───────────────────────────────────────────────────── */
  .type-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.75rem;
    margin-bottom: 0.75rem;
  }

  .type-card {
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 0.75rem;
    background: var(--bg-surface);
  }

  .type-token {
    font-family: var(--mono);
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--text-dim);
    margin-bottom: 0.35rem;
    display: block;
  }

  .type-sample {
    margin: 0.35rem 0;
    color: var(--text-bright);
  }

  .type-sample.sans { font-family: var(--sans); font-size: 14px; }
  .type-sample.mono { font-family: var(--mono); font-size: 13px; }

  .type-stack {
    font-family: var(--mono);
    font-size: 0.68rem;
    color: var(--text-dim);
    word-break: break-all;
    margin: 0;
  }

  .size-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.85rem;
  }

  .size-table td {
    padding: 0.35rem 0.6rem;
    border-bottom: 1px solid var(--border);
    color: var(--text-bright);
  }

  .size-table td:first-child { width: 4rem; }
  .size-table td:last-child { color: var(--text-dim); font-family: var(--mono); font-size: 0.75rem; }

  .size-14.sans { font-family: var(--sans); font-size: 14px; }
  .size-12.sans { font-family: var(--sans); font-size: 12px; }
  .size-13.mono { font-family: var(--mono); font-size: 13px; }
  .size-14.mono { font-family: var(--mono); font-size: 14px; }

  /* ── Buttons ──────────────────────────────────────────────────────── */
  .demo-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem;
    background: var(--bg-base);
    border: 1px solid var(--border);
    border-radius: 4px;
  }

  /* ── Forms ─────────────────────────────────────────────────────────── */
  .form-demo {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 1rem;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 6px;
    max-width: 480px;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }

  .field-label {
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .field-input {
    background: var(--bg-base);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text-bright);
    font-family: inherit;
    font-size: 0.875rem;
    padding: 0.4rem 0.6rem;
    outline: none;
  }

  /* Monochrome: no accent outline on focus */

  .field-input.field-error {
    border-color: var(--red-bright, var(--color-error));
  }

  .field-errortext {
    font-size: 0.75rem;
    color: var(--red-bright, var(--color-error));
  }

  .field-hinttext {
    font-size: 0.75rem;
    color: var(--text-dim);
  }

  .check-option,
  .radio-opt {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    cursor: pointer;
    user-select: none;
  }

  .check-option input[type="checkbox"],
  .radio-opt input[type="radio"] {
    accent-color: var(--amber-bright);
    margin: 0;
    flex-shrink: 0;
  }

  select {
    accent-color: var(--amber-bright);
  }

  .check-label,
  .radio-opt-label {
    font-size: 0.875rem;
    color: var(--text-bright);
  }

  .radio-opt {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.45rem;
    cursor: pointer;
    user-select: none;
  }

  .radio-opt-hint {
    width: 100%;
    margin-top: -0.2rem;
    padding-left: 1.5rem;
    font-size: 0.75rem;
    color: var(--text-dim);
  }

  /* ── Dialog demo ──────────────────────────────────────────────────── */
  .dialog-demo-body {
    padding: 0.75rem 1rem;
    font-size: 0.875rem;
    color: var(--text-bright);
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .dialog-demo-body p {
    margin: 0;
  }

  .dialog-demo-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
  }

  /* ── Status dots ──────────────────────────────────────────────────── */
  .status-dot-demo {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    display: inline-block;
    flex-shrink: 0;
  }

  .status-dot-demo.running { background: var(--green-bright, #3fb950); }
  .status-dot-demo.idle    { background: var(--green-dim, #484f58); }
  .status-dot-demo.warn    { background: var(--amber-bright, #d29922); }
  .status-dot-demo.error   { background: var(--red-bright, #f85149); }

  .status-label-demo {
    font-size: 0.8rem;
    color: var(--text-bright);
    margin-right: 0.75rem;
  }

  /* ── Utility patterns ─────────────────────────────────────────────── */
  .token-pill {
    font-size: 0.68rem;
    color: var(--text-dim);
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 0.1rem 0.45rem;
  }

  .demo-details {
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-surface);
    max-width: 400px;
  }

  .demo-details-summary {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.4rem 0.6rem;
    cursor: pointer;
    list-style: none;
    font-size: 0.85rem;
    color: var(--text-bright);
  }

  .demo-details-summary::-webkit-details-marker { display: none; }

  .demo-details-summary::before {
    content: '▶';
    font-size: 0.6rem;
    color: var(--text-dim);
    transition: transform 0.15s;
  }

  .demo-details[open] .demo-details-summary::before {
    transform: rotate(90deg);
  }

  .demo-details-body {
    padding: 0.4rem 0.6rem 0.5rem 1.2rem;
    border-top: 1px solid var(--border);
    font-size: 0.82rem;
    color: var(--text-dim);
    line-height: 1.45;
  }

  .demo-error-banner {
    background: color-mix(in srgb, var(--red-bright, var(--color-error)) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--red-bright, var(--color-error)) 35%, transparent);
    border-radius: 6px;
    padding: 0.5rem 0.75rem;
    max-width: 480px;
  }

  .demo-error-message {
    font-size: 0.82rem;
    color: var(--red-bright, var(--color-error));
    line-height: 1.35;
  }

  .id-pill-demo {
    border: 1px solid var(--border);
    border-radius: 999px;
    color: var(--text-dim);
    font-size: 0.68rem;
    font-family: var(--mono);
    padding: 0.08rem 0.45rem;
  }

  /* ── Session patterns ──────────────────────────────────────────── */
  .session-demo {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 0.75rem 1rem;
    background: var(--bg-base);
    border: 1px solid var(--border);
    border-radius: 4px;
  }

  .session-part {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }

  .session-part p {
    margin: 0;
    font-size: 0.88rem;
    line-height: 1.55;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .session-part-label {
    font-size: 0.68rem;
    font-weight: 600;
    color: var(--green-dim);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .session-reasoning {
    font-style: italic;
    opacity: 0.85;
  }

  .session-mono {
    font-family: var(--mono);
    font-size: 0.82rem;
  }

  .session-badge {
    border: 1px solid var(--border);
    border-radius: 999px;
    color: var(--green-bright);
    font-size: 0.68rem;
    font-family: var(--mono);
    padding: 0.08rem 0.45rem;
  }

  /* ── Principles list ──────────────────────────────────────────────── */
  .principle-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .principle-list li {
    font-size: 0.85rem;
    color: var(--text-bright);
    line-height: 1.45;
    padding-left: 1rem;
    border-left: 2px solid var(--amber-dim, var(--text-dim));
  }

  .principle-list code {
    font-family: var(--mono);
    font-size: 0.78rem;
    background: var(--bg-surface);
    padding: 0.05em 0.3em;
    border-radius: 3px;
  }
</style>
