# Brand assets

Master brand SVGs for mcpscope. The rules and rationale (palette, usage, the "amber on a dark
square, never crosshair/weapon imagery" constraint) are canonical in
[DESIGN-SYSTEM.md → Logo](../DESIGN-SYSTEM.md#logo). This file is just the manifest.

The app serves working copies from `frontend/public/` and references them by path (`/logo.svg`,
`/favicon.svg`, …). When a logo changes, update the master here **and** the served copy in
`frontend/public/`.

| File | What it is | Size (viewBox) |
|---|---|---|
| `logo.svg` | **Lockup** (mark + wordmark) — the primary horizontal logo; served copy of choice | 250×48 |
| `logo-lockup.svg` | Lockup master variant | 250×48 |
| `logo-mark.svg` | **Mark** — amber `>` chevron beside three stacked bars on a dark rounded square | 48×48 |
| `logo-wordmark.svg` | **Wordmark** — "mcpscope" in 2-tone amber (`mcp` bright, `scope` dim) | 196×52 |
| `favicon.svg` | The mark, sized for favicon / app icon | 48×48 |
| `social-icons.svg` | Small social / share glyph set | mixed |

For a README or web header, use the **lockup** (`logo.svg`). The mark carries its own dark
rounded-square background, so it reads on both light and dark surfaces; the wordmark and lockup are
amber on transparent.
