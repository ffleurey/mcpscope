// Navigation store: current top-level view.
import { writable } from 'svelte/store'
import type { NavView } from './types'

export const currentView = writable<NavView>('home')
