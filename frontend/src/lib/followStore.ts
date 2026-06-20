import { writable } from 'svelte/store'

/**
 * "Follow running" mode: when on, the main view auto-opens whichever session is
 * currently streaming (benchmark run-sessions, judge sessions, any analysis), so the
 * user can watch progress hands-free. It disengages the moment the user navigates
 * somewhere else, and is re-engaged from the toggle in the execution bar.
 *
 * Leaf module (no other store imports) so sessionStore/benchmarkStore/executionStore
 * can all read+clear it without an import cycle.
 */
export const followRunning = writable(false)
