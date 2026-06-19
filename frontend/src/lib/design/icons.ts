/**
 * Canonical icon set for mcpscope.
 *
 * Icons are Material Design Icons (https://pictogrammers.com/library/mdi/),
 * exposed as tree-shakeable 24×24 path data from `@mdi/js` under semantic names.
 * Render them with the <Icon> component — never `{@html}` (no XSS surface, and
 * `<path d={...}>` is plain SVG markup):
 *
 *   import Icon from './Icon.svelte'
 *   import { iconPlus } from '../design/icons'
 *   <button class="icon-btn"><Icon path={iconPlus} /></button>
 *
 * To change the icon set, only this file changes.
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
  mdiClipboardListOutline,
  mdiRocketLaunchOutline,
  mdiEyeOutline,
  mdiHomeOutline,
} from '@mdi/js'

// ── Navigation & layout ────────────────────────────────────────────
export const iconChevronRight = mdiChevronRight
export const iconChevronDown = mdiChevronDown
export const iconCollapse = mdiChevronDoubleLeft
export const iconExpand = mdiChevronDoubleRight

// ── Actions ─────────────────────────────────────────────────────────
export const iconPlus = mdiPlus
export const iconClose = mdiClose
export const iconEdit = mdiPencilOutline
export const iconTrash = mdiTrashCanOutline
export const iconTest = mdiLanConnect
export const iconStar = mdiStar
export const iconStarOutline = mdiStarOutline
export const iconRefresh = mdiRefresh
export const iconLoad = mdiDownloadOutline
export const iconEject = mdiEjectOutline
export const iconInfo = mdiInformationOutline
export const iconView = mdiEyeOutline
export const iconPlay = mdiPlay
export const iconPause = mdiPause
export const iconImport = mdiImport
export const iconExport = mdiExport
export const iconRadioMarked = mdiRadioboxMarked
export const iconRadioBlank = mdiRadioboxBlank
export const iconCheckboxMarked = mdiCheckboxMarked
export const iconCheckboxBlank = mdiCheckboxBlankOutline

// ── Status & content ───────────────────────────────────────────────
export const iconAnalysis = mdiChartBar
export const iconSettings = mdiTune
export const iconDot = mdiCircle
export const iconSpinner = mdiDotsHorizontal
export const iconBenchmark = mdiClipboardListOutline
export const iconRun = mdiRocketLaunchOutline
export const iconHome = mdiHomeOutline
