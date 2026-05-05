// Chat store: active chat sessions, messages, streaming state, tool traces, context accounting.
// Stub for Increment 2 — structure will grow here, keeping profile state separate.
import { writable } from 'svelte/store'

// Placeholder — real ChatSession type and logic will be added in Increment 2.
export const activeChatId = writable<string | null>(null)
