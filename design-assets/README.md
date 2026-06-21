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

PNG exports (raster, for the README header, social previews, and anywhere SVG is awkward):

| File | What it is | Size |
|---|---|---|
| `logo.png` | Lockup raster (used in the README) | 1000×192 |
| `logo-mark.png` | Square mark raster (app / social icon) | 512×512 |

Regenerate the PNGs from the SVG masters with [`rsvg-convert`](https://gitlab.gnome.org/GNOME/librsvg)
(text renders via the system sans-serif, e.g. Liberation Sans):

```bash
rsvg-convert -w 1000 design-assets/logo.svg      -o design-assets/logo.png
rsvg-convert -w 512 -h 512 design-assets/logo-mark.svg -o design-assets/logo-mark.png
```

For a README or web header, use the **lockup** (`logo.svg` vector, or `logo.png` raster). The mark
carries its own dark rounded-square background, so it reads on both light and dark surfaces; the
wordmark and lockup are amber on transparent.
