/**
 * Canonical icon set for mcpscope.
 *
 * Icons are Material Design Icons (https://pictogrammers.com/library/mdi/),
 * sourced as tree-shakeable path data from `@mdi/js` — no icon font dependency.
 * Each export is a ready-to-render inline SVG string at 1em / currentColor.
 *
 * Usage in Svelte:
 *   import { iconPlus } from '../design/icons'
 *   <span class="icon">{@html iconPlus}</span>      // inherits font-size + color
 *   <button class="icon-btn">{@html iconEdit}</button>
 *
 * To change the icon set, only this file changes — swap the mdi* path imports.
 */

import {
  mdiChevronRight,
  mdiChevronDown,
  mdiChevronDoubleLeft,
  mdiChevronDoubleRight,
  mdiPlus,
  mdiClose,
  mdiPencilOutline,
  mdiTrashCanOutline,
  mdiLanConnect,
  mdiStar,
  mdiStarOutline,
  mdiRefresh,
  mdiDownloadOutline,
  mdiEjectOutline,
  mdiInformationOutline,
  mdiRadioboxMarked,
  mdiRadioboxBlank,
  mdiCheckboxMarked,
  mdiCheckboxBlankOutline,
  mdiPlay,
  mdiPause,
  mdiImport,
  mdiExport,
  mdiChartBar,
  mdiTune,
  mdiCircle,
  mdiDotsHorizontal,
} from '@mdi/js'

/** Wrap an MDI 24×24 path into an inline SVG that scales with font-size and inherits color. */
function svg(path: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="currentColor"><path d="${path}"/></svg>`
}

// ── Navigation & layout ────────────────────────────────────────────
export const iconChevronRight = svg(mdiChevronRight)
export const iconChevronDown = svg(mdiChevronDown)
export const iconCollapse = svg(mdiChevronDoubleLeft)
export const iconExpand = svg(mdiChevronDoubleRight)

// ── Actions ─────────────────────────────────────────────────────────
export const iconPlus = svg(mdiPlus)
export const iconClose = svg(mdiClose)
export const iconEdit = svg(mdiPencilOutline)
export const iconTrash = svg(mdiTrashCanOutline)
export const iconTest = svg(mdiLanConnect)
export const iconStar = svg(mdiStar)
export const iconStarOutline = svg(mdiStarOutline)
export const iconRefresh = svg(mdiRefresh)
export const iconLoad = svg(mdiDownloadOutline)
export const iconEject = svg(mdiEjectOutline)
export const iconInfo = svg(mdiInformationOutline)
export const iconRadioMarked = svg(mdiRadioboxMarked)
export const iconRadioBlank = svg(mdiRadioboxBlank)
export const iconCheckboxMarked = svg(mdiCheckboxMarked)
export const iconCheckboxBlank = svg(mdiCheckboxBlankOutline)
export const iconPlay = svg(mdiPlay)
export const iconPause = svg(mdiPause)
export const iconImport = svg(mdiImport)
export const iconExport = svg(mdiExport)

// ── Status & content ───────────────────────────────────────────────
export const iconAnalysis = svg(mdiChartBar)
export const iconSettings = svg(mdiTune)
export const iconDot = svg(mdiCircle)
export const iconSpinner = svg(mdiDotsHorizontal)
