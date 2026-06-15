/**
 * Canonical icon set for mcpscope.
 *
 * Inline SVGs — no icon font dependency, renders identically everywhere.
 * Keep this set small; add icons only when a new semantic need arises.
 *
 * Usage in Svelte:
 *   <script>
 *     import { iconPlus } from '../design/icons'
 *   </script>
 *   <span class="icon">{@html iconPlus}</span>
 *
 * Style with font-size and color via CSS on the wrapping span.
 */

// ── Navigation & layout ────────────────────────────────────────────

/** Chevron right — expand / collapse */
export const iconChevronRight = `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 16 16" fill="currentColor"><path d="M6 3l5 5-5 5-.7-.7L9.6 8 5.3 3.7 6 3z"/></svg>`;

/** Chevron down — expanded state */
export const iconChevronDown = `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 16 16" fill="currentColor"><path d="M3 6l5 5 5-5-.7-.7L8 9.6 3.7 5.3 3 6z"/></svg>`;

/** Collapse sidebar — double chevron left */
export const iconCollapse = `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 16 16" fill="currentColor"><path d="M9 3L4 8l5 5 .7-.7L5.4 8l4.3-4.3L9 3zm3 0l-5 5 5 5 .7-.7L8.4 8l4.3-4.3L12 3z"/></svg>`;

/** Expand sidebar — double chevron right */
export const iconExpand = `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 16 16" fill="currentColor"><path d="M7 3l5 5-5 5-.7-.7L10.6 8 6.3 3.7 7 3zm3 0l5 5-5 5-.7-.7L13.6 8 9.3 3.7 10 3z"/></svg>`;

// ── Actions ─────────────────────────────────────────────────────────

/** Plus — add, create, new */
export const iconPlus = `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 16 16" fill="currentColor"><path d="M7.5 2v5.5H2v1h5.5V14h1V8.5H14v-1H8.5V2h-1z"/></svg>`;

/** Close / X — close, delete, dismiss */
export const iconClose = `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 16 16" fill="currentColor"><path d="M3.3 3.3a.5.5 0 01.7 0L8 7.3l4-4a.5.5 0 11.7.7L8.7 8l4 4a.5.5 0 01-.7.7L8 8.7l-4 4a.5.5 0 01-.7-.7l4-4-4-4a.5.5 0 010-.7z"/></svg>`;

/** Play — start, resume */
export const iconPlay = `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 16 16" fill="currentColor"><path d="M4 2.5v11l9-5.5L4 2.5z"/></svg>`;

/** Pause */
export const iconPause = `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 16 16" fill="currentColor"><path d="M4.5 2.5h3v11h-3v-11zm4 0h3v11h-3v-11z"/></svg>`;

/** Upload / import — arrow pointing up into a tray */
export const iconImport = `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 16 16" fill="currentColor"><path d="M7.5 1v7.8L5.4 6.7l-.7.7L8 9.9l3.3-2.5-.7-.7L8.5 8.8V1h-1z"/><path d="M2 10v3.5c0 .3.2.5.5.5h11c.3 0 .5-.2.5-.5V10h-1v3H3v-3H2z"/></svg>`;

/** Export / download — arrow pointing down from a tray */
export const iconExport = `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 16 16" fill="currentColor"><path d="M7.5 15V7.2L5.4 9.3l-.7-.7L8 6.1l3.3 2.5-.7.7L8.5 7.2V15h-1z"/><path d="M2 6V2.5c0-.3.2-.5.5-.5h11c.3 0 .5.2.5.5V6h-1V3H3v3H2z"/></svg>`;

// ── Status & content ───────────────────────────────────────────────

/** Analysis — bar chart */
export const iconAnalysis = `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 16 16" fill="currentColor"><path d="M2 13h12v-1.5H3V13zm2.5-5h2v3.5h-2V8zm3-2.5h2v6h-2v-6zm3-3h2v9h-2v-9z"/></svg>`;

/** Settings — sliders */
export const iconSettings = `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 16 16" fill="currentColor"><rect x="1.5" y="2" width="13" height="1.5" rx=".75" opacity=".3"/><circle cx="5.5" cy="2.75" r="1.5"/><rect x="1.5" y="7.25" width="13" height="1.5" rx=".75" opacity=".3"/><circle cx="10.5" cy="8" r="1.5"/><rect x="1.5" y="12.5" width="13" height="1.5" rx=".75" opacity=".3"/><circle cx="7.5" cy="13.25" r="1.5"/></svg>`;

/** Trash / delete */
export const iconTrash = `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 16 16" fill="currentColor"><path d="M3 3.5h10l-1.5 10a1 1 0 01-1 .8H5.5a1 1 0 01-1-.8L3 3.5z"/><path d="M5.5 2a.5.5 0 01.5-.5h4a.5.5 0 01.5.5V3.5h-5V2z"/></svg>`;

/** Dot — status indicator */
export const iconDot = `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="8" r="4"/></svg>`;

/** Spinner / loading — three dots */
export const iconSpinner = `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 4" fill="currentColor"><circle cx="2" cy="2" r="2"/><circle cx="12" cy="2" r="2" opacity=".6"/><circle cx="22" cy="2" r="2" opacity=".3"/></svg>`;
