<script lang="ts">
  import { onMount } from 'svelte'
  import DialogShell from './DialogShell.svelte'
  import IdBadge from './IdBadge.svelte'
  import InlineAppError from './InlineAppError.svelte'
  import Checkbox from './Checkbox.svelte'
  import Radio from './Radio.svelte'
  import { AppError } from '../errors'
  import {
    iconPlus,
    iconClose,
    iconPlay,
    iconPause,
    iconImport,
    iconExport,
    iconAnalysis,
    iconSettings,
    iconTrash,
    iconChevronRight,
    iconChevronDown,
    iconCollapse,
    iconExpand,
    iconDot,
    iconSpinner,
    iconEdit,
    iconRefresh,
    iconTest,
    iconLoad,
    iconEject,
    iconInfo,
    iconView,
    iconStar,
    iconStarOutline,
    iconRadioMarked,
    iconRadioBlank,
    iconCheckboxMarked,
    iconCheckboxBlank,
  } from '../design/icons'
  import Icon from './Icon.svelte'
  import { columnResize } from '../actions/columnResize'

  let showDialog = $state(false)
  let showFormDialog = $state(false)

  // Demo state for the live data-table example (checkbox toggles).
  let demoEnabled = $state<Record<string, boolean>>({ 'srv-1': true, 'srv-2': false })

  // Demo state for the Checkbox / Radio components.
  let demoChecks = $state({ a: true, b: false, verbose: true, reconnect: false })
  let demoRadio = $state('one')

  // ── Color tokens — values are read live from :root so this guide can
  //    never drift from app.css. We only name the token + its purpose here.
  const colors = [
    {
      category: 'Grey — Backgrounds',
      items: [
        { token: '--bg-base', use: 'Main app background; inputs' },
        { token: '--bg-surface', use: 'Panels, dialogs, sidebar, cards' },
        { token: '--bg-hover', use: 'Hover state for interactive elements' },
        { token: '--border', use: 'Borders, dividers, separators' },
      ],
    },
    {
      category: 'Grey — Text',
      items: [
        { token: '--text-dim', use: 'Labels, metadata, muted text' },
        { token: '--text-bright', use: 'Primary body text (near-white)' },
      ],
    },
    {
      category: 'Amber — Primary accent (minimal use)',
      items: [
        { token: '--amber-dim', use: 'Logo, secondary amber text' },
        {
          token: '--amber-bright',
          use: 'Primary buttons, active tab underline, links, input focus',
        },
        { token: '--amber-glow', use: 'Hover/enhanced state for primary elements' },
      ],
    },
    {
      category: 'Green — Session content (data color)',
      items: [
        { token: '--green-dim', use: 'Dim status, offline/dormant' },
        {
          token: '--green-bright',
          use: 'Session content: prompts, answers, reasoning, tool calls/results',
        },
        { token: '--green-glow', use: 'Bright status, pulsed indicators' },
      ],
    },
    {
      category: 'Red — Destructive actions, errors',
      items: [
        { token: '--red-dim', use: 'Error text, danger button borders' },
        { token: '--red-bright', use: 'Danger buttons, error states, deletion' },
      ],
    },
  ]

  // Live values read from the document root — single source of truth is app.css.
  let cssValues = $state<Record<string, string>>({})

  onMount(() => {
    const root = getComputedStyle(document.documentElement)
    const tokens = [...colors.flatMap((g) => g.items.map((i) => i.token)), '--sans', '--mono']
    cssValues = Object.fromEntries(tokens.map((t) => [t, root.getPropertyValue(t).trim()]))
  })

  const rules = [
    '--bg-base is the outermost background; everything sits on it.',
    '--bg-surface is one step lighter — used for containers that need distinction from the base.',
    '--text-bright is the default text color; --text-dim for supporting information.',
    'No color-on-color: accent colors sit on --bg-base or --bg-surface only (never on another color).',
    'Amber is reserved for the logo and the single primary action per view/dialog. Most of the UI has no amber at all.',
    'Most of the UI is monochrome grey. Color is added only where it provides signal.',
    'color-scheme: dark on :root to force neutral system colors on native controls.',
    'Green is for session data, grey is for chrome — session content text uses --green-bright to create the oscilloscope metaphor.',
  ]

  // A representative error for the live InlineAppError component.
  const demoError = new AppError('Something went wrong processing your request.', 'upstream', 502, {
    code: 'UPSTREAM_TIMEOUT',
    details: { endpoint: '/v1/chat', waitedMs: 30000 },
  })
</script>

<div class="ref-page">
  <header class="ref-header">
    <h1>Design System Reference</h1>
    <p class="ref-subtitle">
      Living style guide — colors, fonts and components are rendered from live CSS and real
      components, not copied. See <span class="mono">DESIGN-SYSTEM.md</span>
      for rationale and decisions.
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
              style="background: var({c.token}); outline: 1px solid var(--border); outline-offset: -1px;"
            ></div>
            <div class="swatch-info">
              <code class="swatch-token">{c.token}</code>
              <code class="swatch-value">{cssValues[c.token] ?? '…'}</code>
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
        <p class="type-stack">{cssValues['--sans'] ?? '…'}</p>
      </div>
      <div class="type-card">
        <code class="type-token">--mono</code>
        <p class="type-sample mono">The quick brown fox jumps over the lazy dog 123</p>
        <p class="type-stack">{cssValues['--mono'] ?? '…'}</p>
      </div>
    </div>

    <h3 class="group-title">Sizes</h3>
    <table class="size-table">
      <tbody>
        <tr
          ><td><code>14px</code></td><td class="size-14 sans">Base body text</td><td
            ><code>line-height: 1.5</code></td
          ></tr
        >
        <tr
          ><td><code>12px</code></td><td class="size-12 sans"
            >Small UI text (labels, badges, metadata)</td
          ><td><code>0.75rem</code></td></tr
        >
        <tr
          ><td><code>13px</code></td><td class="size-13 mono"
            >Monospace data (token counts, IDs, code)</td
          ><td><code>0.8125rem</code></td></tr
        >
        <tr
          ><td><code>14px</code></td><td class="size-14 mono">Compact UI line-height</td><td
            ><code>line-height: 1.4</code></td
          ></tr
        >
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
      All three variants follow the same model: transparent bg, accent border + text. Hover adds a
      subtle accent-tinted background. Only one primary button per view/dialog.
    </p>

    <h3 class="group-title">With icon</h3>
    <div class="demo-row">
      <button class="btn"><span class="btn-icon"><Icon path={iconAnalysis} /></span> Analyze</button
      >
      <button class="btn btn-primary"
        ><span class="btn-icon"><Icon path={iconPlus} /></span> New session</button
      >
      <button class="btn btn-danger"
        ><span class="btn-icon"><Icon path={iconTrash} /></span> Delete</button
      >
      <button class="btn"><span class="btn-icon"><Icon path={iconExport} /></span> Export</button>
      <button class="btn btn-sm"
        ><span class="btn-icon"><Icon path={iconImport} /></span> Import</button
      >
    </div>

    <h3 class="group-title">Icon only</h3>
    <div class="demo-row">
      <button class="icon-btn" title="Add"><Icon path={iconPlus} /></button>
      <button class="icon-btn" title="Close"><Icon path={iconClose} /></button>
      <button class="icon-btn" title="Settings"><Icon path={iconSettings} /></button>
      <button class="icon-btn icon-btn-danger" title="Delete"><Icon path={iconTrash} /></button>
      <button class="icon-btn" title="Play"><Icon path={iconPlay} /></button>
      <button class="icon-btn" title="Pause"><Icon path={iconPause} /></button>
      <button class="icon-btn" title="Disabled" disabled><Icon path={iconPlus} /></button>
    </div>

    <p class="ref-note">
      Icons are Material Design Icons (<code class="mono">@mdi/js</code>) exposed as semantic names
      in <code class="mono">src/lib/design/icons.ts</code>. Use <code class="mono">.icon-btn</code>
      for standalone icons, <code class="mono">.btn-icon</code> inside
      <code class="mono">.btn</code>
      for icon+text. Tint with accent colors for meaning.
    </p>

    <h3 class="group-title">State markers (amber)</h3>
    <div class="demo-row">
      <button class="icon-btn icon-glow" title="Selected (radio)" aria-label="Selected"
        ><Icon path={iconRadioMarked} /></button
      >
      <button class="icon-btn icon-off" title="Unselected (radio)" aria-label="Unselected"
        ><Icon path={iconRadioBlank} /></button
      >
      <button class="icon-btn icon-glow" title="Enabled (checkbox)" aria-label="Enabled"
        ><Icon path={iconCheckboxMarked} /></button
      >
      <button class="icon-btn icon-off" title="Disabled (checkbox)" aria-label="Disabled"
        ><Icon path={iconCheckboxBlank} /></button
      >
      <button class="icon-btn icon-glow" title="Loaded" aria-label="Loaded"
        ><Icon path={iconEject} /></button
      >
      <button class="icon-btn icon-blink" title="Loading…" aria-label="Loading"
        ><Icon path={iconLoad} /></button
      >
      <button class="icon-btn icon-btn-danger" title="Destructive" aria-label="Destructive"
        ><Icon path={iconTrash} /></button
      >
    </div>
    <p class="ref-note">
      <code class="mono">.icon-glow</code> = selected / loaded (steady amber glow),
      <code class="mono">.icon-blink</code> = in-progress (pulsing amber),
      <code class="mono">.icon-btn-danger</code> = destructive. A deliberate, sanctioned use of amber
      for single-/multi-select state and activity — radio for single-select, checkbox for multi-select.
    </p>
  </section>

  <!-- ─── FORM FIELDS ────────────────────────────────────────────────── -->
  <section class="ref-section" id="forms">
    <h2>Form Fields</h2>
    <p class="ref-note">
      Inputs show an <code class="mono">--amber-bright</code> border on keyboard focus. Checkboxes
      and radios use the <code class="mono">&lt;Checkbox&gt;</code> /
      <code class="mono">&lt;Radio&gt;</code> components — a native input for accessibility with an
      MDI glyph + amber glow, the same toggle visual as the tables. Selects stay native (<code
        class="mono">accent-color</code
      >). Dark theme from
      <code class="mono">color-scheme: dark</code> on the root.
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
        <textarea id="demo-textarea" class="field-input" rows="3" placeholder="Multi-line text"
        ></textarea>
      </div>

      <div class="field">
        <span class="field-label">Read-only value</span>
        <span class="field-static">streamable-http</span>
      </div>

      <div class="field">
        <span class="field-label">Checkbox group</span>
        <Checkbox label="Option A" checked={demoChecks.a} onchange={(v) => (demoChecks.a = v)} />
        <Checkbox label="Option B" checked={demoChecks.b} onchange={(v) => (demoChecks.b = v)} />
      </div>

      <div class="field">
        <span class="field-label">Radio group</span>
        <Radio
          group={demoRadio}
          value="one"
          name="demo-radio"
          label="Choice one"
          hint="With a hint below"
          onselect={(v) => (demoRadio = v)}
        />
        <Radio
          group={demoRadio}
          value="two"
          name="demo-radio"
          label="Choice two"
          onselect={(v) => (demoRadio = v)}
        />
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

    <div class="demo-row" style="gap: 0.75rem;">
      <button class="btn btn-primary" onclick={() => (showDialog = true)}>Open demo dialog</button>
      <button class="btn" onclick={() => (showFormDialog = true)}>Open form dialog</button>
    </div>

    {#if showDialog}
      <DialogShell title="Demo dialog" onClose={() => (showDialog = false)}>
        <p style="margin: 0 0 0.75rem; font-size: 0.875rem; color: var(--text-bright);">
          DialogShell with header, body, and action buttons.
        </p>
        <div class="dialog-actions">
          <button class="btn" onclick={() => (showDialog = false)}>Cancel</button>
          <button class="btn btn-primary" onclick={() => (showDialog = false)}>Confirm</button>
        </div>
      </DialogShell>
    {/if}

    {#if showFormDialog}
      <DialogShell
        title="Form dialog"
        onClose={() => (showFormDialog = false)}
        dialogClass="form-test-dialog"
      >
        <div class="form-stack">
          <div class="field">
            <label class="field-label" for="fd-name">Name</label>
            <input
              id="fd-name"
              class="field-input"
              type="text"
              placeholder="e.g. Production server"
            />
          </div>
          <div class="field">
            <label class="field-label" for="fd-url">URL</label>
            <input
              id="fd-url"
              class="field-input"
              type="text"
              placeholder="https://example.com/api"
            />
          </div>
          <div class="field">
            <label class="field-label" for="fd-type">Type</label>
            <select id="fd-type" class="field-input">
              <option>Standard</option>
              <option>Premium</option>
            </select>
            <span class="field-hinttext">Select the service tier for this endpoint.</span>
          </div>
          <div class="field">
            <label class="field-label" for="fd-notes">Notes</label>
            <textarea id="fd-notes" class="field-input" rows="3" placeholder="Optional notes…"
            ></textarea>
          </div>
          <div class="field">
            <span class="field-label">Options</span>
            <Checkbox
              label="Enable verbose logging"
              checked={demoChecks.verbose}
              onchange={(v) => (demoChecks.verbose = v)}
            />
            <Checkbox
              label="Auto-reconnect on failure"
              checked={demoChecks.reconnect}
              onchange={(v) => (demoChecks.reconnect = v)}
            />
          </div>
        </div>
        <div class="dialog-actions">
          <button class="btn" onclick={() => (showFormDialog = false)}>Cancel</button>
          <button class="btn btn-primary" onclick={() => (showFormDialog = false)}>Save</button>
        </div>
      </DialogShell>
    {/if}

    <p class="ref-note">
      Live <code class="mono">DialogShell.svelte</code> — native
      <code class="mono">&lt;dialog&gt;</code>
      with <code class="mono">::backdrop</code>, draggable header. Max width 720px or 95vw, max
      height 85vh.
    </p>
  </section>

  <!-- ─── STATUS INDICATORS ──────────────────────────────────────────── -->
  <section class="ref-section" id="status">
    <h2>Status indicators</h2>

    <div class="demo-row">
      <span class="status-dot running"></span><span class="status-label-demo">Running / active</span
      >
      <span class="status-dot idle"></span><span class="status-label-demo">Idle / ready</span>
      <span class="status-dot warn"></span><span class="status-label-demo">Warning / attention</span
      >
      <span class="status-dot error"></span><span class="status-label-demo">Error / failed</span>
    </div>

    <p class="ref-note">
      Shared <code class="mono">.status-dot</code> primitive with a state modifier (<code
        class="mono">.running .idle .warn .error</code
      >). Flat dots, no glow.
    </p>
  </section>

  <!-- ─── DATA TABLES ─────────────────────────────────────────────────── -->
  <section class="ref-section" id="tables">
    <h2>Data tables</h2>
    <p class="ref-note">
      Dense admin table: <code class="mono">.data-table</code> inside a
      <code class="mono">.table-scroll</code> wrapper, fixed layout via a
      <code class="mono">&lt;colgroup&gt;</code>, and <code class="mono">use:columnResize</code>
      — drag a header's right border to resize. First column is a single-control
      <code class="mono">.col-toggle</code>; <code class="mono">.col-num</code> for numerics,
      <code class="mono">.col-mono</code> for IDs/URLs, trailing
      <code class="mono">.col-actions</code> holding <code class="mono">.row-actions</code> icon buttons.
      Cells truncate with ellipsis (full value on hover).
    </p>

    <div class="table-scroll">
      <table class="data-table" use:columnResize>
        <colgroup>
          <col style="width: 3rem" />
          <col style="width: 12rem" />
          <col style="width: 16rem" />
          <col style="width: 6rem" />
          <col style="width: 13rem" />
          <col style="width: 7rem" />
        </colgroup>
        <thead>
          <tr>
            <th class="col-toggle" aria-label="Default"></th>
            <th>Name</th>
            <th>Endpoint</th>
            <th class="col-num">Calls</th>
            <th>Status</th>
            <th class="col-actions">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td class="col-toggle">
              <button
                class="icon-btn"
                class:icon-glow={demoEnabled['srv-1']}
                class:icon-off={!demoEnabled['srv-1']}
                aria-label="Toggle default"
                onclick={() => (demoEnabled['srv-1'] = !demoEnabled['srv-1'])}
                ><Icon
                  path={demoEnabled['srv-1'] ? iconCheckboxMarked : iconCheckboxBlank}
                /></button
              >
            </td>
            <td title="Production">Production</td>
            <td class="col-mono" title="https://api.example.com/v1">https://api.example.com/v1</td>
            <td class="col-num">1,284</td>
            <td>
              <span class="status-cell" title="Connected · 3 models">
                <span class="status-dot running"></span>
                <span class="status-text">Connected · 3 models</span>
              </span>
            </td>
            <td class="col-actions">
              <span class="row-actions">
                <button class="icon-btn" aria-label="Test"><Icon path={iconTest} /></button>
                <button class="icon-btn" aria-label="Edit"><Icon path={iconEdit} /></button>
                <button class="icon-btn icon-btn-danger" aria-label="Delete"
                  ><Icon path={iconTrash} /></button
                >
              </span>
            </td>
          </tr>
          <tr>
            <td class="col-toggle">
              <button
                class="icon-btn"
                class:icon-glow={demoEnabled['srv-2']}
                class:icon-off={!demoEnabled['srv-2']}
                aria-label="Toggle default"
                onclick={() => (demoEnabled['srv-2'] = !demoEnabled['srv-2'])}
                ><Icon
                  path={demoEnabled['srv-2'] ? iconCheckboxMarked : iconCheckboxBlank}
                /></button
              >
            </td>
            <td title="Staging">Staging</td>
            <td class="col-mono" title="http://localhost:1234/v1">http://localhost:1234/v1</td>
            <td class="col-num">37</td>
            <td><span class="status-muted">—</span></td>
            <td class="col-actions">
              <span class="row-actions">
                <button class="icon-btn" aria-label="Test"><Icon path={iconTest} /></button>
                <button class="icon-btn" aria-label="Edit"><Icon path={iconEdit} /></button>
                <button class="icon-btn icon-btn-danger" aria-label="Delete"
                  ><Icon path={iconTrash} /></button
                >
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
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
    <InlineAppError error={demoError} />
    <p class="ref-note">
      Live <code class="mono">InlineAppError.svelte</code> with an expandable details payload.
    </p>

    <h3 class="group-title">ID badge</h3>
    <div class="demo-row">
      <IdBadge id="AB12" />
      <IdBadge id="AB12.3W.1T" />
    </div>
    <p class="ref-note">
      Live <code class="mono">IdBadge.svelte</code> — click for the copy / lookup menu.
    </p>

    <h3 class="group-title">Links</h3>
    <div class="demo-row">
      <a href="#colors" onclick={(e) => e.preventDefault()}>Amber link</a>
    </div>
    <p class="ref-note">
      Links use <code class="mono">--amber-bright</code>, no underline by default, underline on
      hover. Text selection uses <code class="mono">--amber-bright</code> at 30% opacity.
    </p>
  </section>

  <!-- ─── SESSION PATTERNS ────────────────────────────────────────────── -->
  <section class="ref-section" id="session">
    <h2>Session content</h2>
    <p class="ref-note">
      Green phosphor text distinguishes LLM content from UI labels. All content text at <strong
        >1rem</strong
      >. Differentiated by font:
      <strong>sans</strong> for prompts/answers,
      <strong>sans italic</strong> for reasoning,
      <strong>mono</strong> for tool content.
    </p>

    <h3 class="group-title">Session text samples</h3>
    <div class="session-demo">
      <div class="session-part">
        <span class="session-part-label">User prompt (sans)</span>
        <p class="session-text">What tools are available for weather data?</p>
      </div>
      <div class="session-part">
        <span class="session-part-label">Reasoning (sans italic)</span>
        <p class="session-text reasoning">
          The user is asking about weather tools. I should list the available MCP tools and their
          capabilities.
        </p>
      </div>
      <div class="session-part">
        <span class="session-part-label">Tool call (mono)</span>
        <p class="session-text tool">get_forecast(latitude: 48.85, longitude: 2.35)</p>
      </div>
      <div class="session-part">
        <span class="session-part-label">Assistant answer (sans)</span>
        <p class="session-text">
          The current temperature in Paris is 18°C with partly cloudy skies. The forecast shows a
          high of 22°C tomorrow.
        </p>
      </div>
    </div>

    <h3 class="group-title">Metadata (stays grey)</h3>
    <div class="demo-row">
      <span class="token-pill">1,234 tokens</span>
      <span class="token-pill">~500 tokens</span>
      <IdBadge id="AB12.4T" />
      <IdBadge id="AB12.S" />
    </div>
  </section>

  <!-- ─── ICON SET ────────────────────────────────────────────────────── -->
  <section class="ref-section" id="icons">
    <h2>Icon set</h2>
    <p class="ref-note">
      All icons live in <code class="mono">src/lib/design/icons.ts</code> as inline SVG strings. No
      icon font dependency. Style via <code class="mono">font-size</code> and
      <code class="mono">color</code>
      on the wrapping element.
    </p>

    <div class="icon-grid">
      <div class="icon-cell">
        <span class="icon-demo"><Icon path={iconChevronRight} /></span><code>iconChevronRight</code>
      </div>
      <div class="icon-cell">
        <span class="icon-demo"><Icon path={iconChevronDown} /></span><code>iconChevronDown</code>
      </div>
      <div class="icon-cell">
        <span class="icon-demo"><Icon path={iconPlus} /></span><code>iconPlus</code>
      </div>
      <div class="icon-cell">
        <span class="icon-demo"><Icon path={iconClose} /></span><code>iconClose</code>
      </div>
      <div class="icon-cell">
        <span class="icon-demo"><Icon path={iconPlay} /></span><code>iconPlay</code>
      </div>
      <div class="icon-cell">
        <span class="icon-demo"><Icon path={iconPause} /></span><code>iconPause</code>
      </div>
      <div class="icon-cell">
        <span class="icon-demo"><Icon path={iconImport} /></span><code>iconImport</code>
      </div>
      <div class="icon-cell">
        <span class="icon-demo"><Icon path={iconExport} /></span><code>iconExport</code>
      </div>
      <div class="icon-cell">
        <span class="icon-demo"><Icon path={iconAnalysis} /></span><code>iconAnalysis</code>
      </div>
      <div class="icon-cell">
        <span class="icon-demo"><Icon path={iconSettings} /></span><code>iconSettings</code>
      </div>
      <div class="icon-cell">
        <span class="icon-demo"><Icon path={iconTrash} /></span><code>iconTrash</code>
      </div>
      <div class="icon-cell">
        <span class="icon-demo"><Icon path={iconCollapse} /></span><code>iconCollapse</code>
      </div>
      <div class="icon-cell">
        <span class="icon-demo"><Icon path={iconExpand} /></span><code>iconExpand</code>
      </div>
      <div class="icon-cell">
        <span class="icon-demo"><Icon path={iconEdit} /></span><code>iconEdit</code>
      </div>
      <div class="icon-cell">
        <span class="icon-demo"><Icon path={iconRefresh} /></span><code>iconRefresh</code>
      </div>
      <div class="icon-cell">
        <span class="icon-demo"><Icon path={iconTest} /></span><code>iconTest</code>
      </div>
      <div class="icon-cell">
        <span class="icon-demo"><Icon path={iconLoad} /></span><code>iconLoad</code>
      </div>
      <div class="icon-cell">
        <span class="icon-demo"><Icon path={iconEject} /></span><code>iconEject</code>
      </div>
      <div class="icon-cell">
        <span class="icon-demo"><Icon path={iconInfo} /></span><code>iconInfo</code>
      </div>
      <div class="icon-cell">
        <span class="icon-demo"><Icon path={iconView} /></span><code>iconView</code>
      </div>
      <div class="icon-cell">
        <span class="icon-demo"><Icon path={iconStar} /></span><code>iconStar</code>
      </div>
      <div class="icon-cell">
        <span class="icon-demo"><Icon path={iconStarOutline} /></span><code>iconStarOutline</code>
      </div>
      <div class="icon-cell">
        <span class="icon-demo"><Icon path={iconRadioMarked} /></span><code>iconRadioMarked</code>
      </div>
      <div class="icon-cell">
        <span class="icon-demo"><Icon path={iconRadioBlank} /></span><code>iconRadioBlank</code>
      </div>
      <div class="icon-cell">
        <span class="icon-demo"><Icon path={iconCheckboxMarked} /></span><code
          >iconCheckboxMarked</code
        >
      </div>
      <div class="icon-cell">
        <span class="icon-demo"><Icon path={iconCheckboxBlank} /></span><code
          >iconCheckboxBlank</code
        >
      </div>
      <div class="icon-cell">
        <span class="icon-demo"><Icon path={iconDot} /></span><code>iconDot</code>
      </div>
      <div class="icon-cell">
        <span class="icon-demo"><Icon path={iconSpinner} /></span><code>iconSpinner</code>
      </div>
    </div>
  </section>

  <!-- ─── COMPACT LAYOUT ─────────────────────────────────────────────── -->
  <section class="ref-section" id="layout">
    <h2>Layout & density</h2>
    <ul class="principle-list">
      <li><strong>Default padding</strong> for containers and dialogs: <code>0.75rem</code></li>
      <li><strong>Default gap</strong> between related elements: <code>0.35rem</code></li>
      <li>
        Use Svelte <code>style</code> directives and native CSS gap/padding directly — no utility classes.
      </li>
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
    color: var(--amber-bright);
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

  .type-sample.sans {
    font-family: var(--sans);
    font-size: 14px;
  }
  .type-sample.mono {
    font-family: var(--mono);
    font-size: 13px;
  }

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

  .size-table td:first-child {
    width: 4rem;
  }
  .size-table td:last-child {
    color: var(--text-dim);
    font-family: var(--mono);
    font-size: 0.75rem;
  }

  .size-14.sans {
    font-family: var(--sans);
    font-size: 14px;
  }
  .size-12.sans {
    font-family: var(--sans);
    font-size: 12px;
  }
  .size-13.mono {
    font-family: var(--mono);
    font-size: 13px;
  }
  .size-14.mono {
    font-family: var(--mono);
    font-size: 14px;
  }

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

  /* ── Dialog demo ──────────────────────────────────────────────────── */
  .form-stack {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .dialog-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    padding-top: 0.5rem;
    border-top: 1px solid var(--border);
  }

  /* ── Status labels (dots come from the global .status-dot primitive) ── */
  .status-label-demo {
    font-size: 0.8rem;
    color: var(--text-bright);
    margin-right: 0.75rem;
  }

  /* ── Details / summary ────────────────────────────────────────────── */
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

  .demo-details-summary::-webkit-details-marker {
    display: none;
  }

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

  .session-text {
    margin: 0;
    color: var(--green-bright);
    font-size: 1rem;
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .session-text.reasoning {
    font-style: italic;
  }
  .session-text.tool {
    font-family: var(--mono);
  }

  .session-part-label {
    font-size: 0.68rem;
    font-weight: 600;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.05em;
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
    border-left: 2px solid var(--amber-dim);
  }

  .principle-list code {
    font-family: var(--mono);
    font-size: 0.78rem;
    background: var(--bg-surface);
    padding: 0.05em 0.3em;
    border-radius: 3px;
  }
</style>
