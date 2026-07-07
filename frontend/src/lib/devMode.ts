// Developer mode: reveals developer-only surfaces (currently the Design System
// Reference page) that aren't useful to end users. Off by default; toggled by
// the Konami code (see App.svelte) and persisted so it survives a reload.
import { writable } from 'svelte/store'

const STORAGE_KEY = 'mcpscope:dev-mode'

function readInitial(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

export const devMode = writable<boolean>(readInitial())

devMode.subscribe((on) => {
  try {
    localStorage.setItem(STORAGE_KEY, on ? 'true' : 'false')
  } catch {
    // storage unavailable (private mode) — dev mode simply won't persist
  }
})

/** Flip developer mode and return the new state. */
export function toggleDevMode(): boolean {
  let next = false
  devMode.update((on) => {
    next = !on
    return next
  })
  return next
}
