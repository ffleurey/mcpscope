import {
  listModelsWithStatus,
  loadModel,
  unloadModel,
} from "../lmstudio/client.js";
import type { ProviderType } from "./index.js";

/**
 * Per-instance serialization. Auto-swap issues a read-modify-write sequence
 * (list loaded → unload others → load target) against a single LM Studio
 * instance. Two concurrent requests to the same instance must not interleave
 * their load/unload calls, or they corrupt each other's view of what is loaded.
 *
 * Keyed by `baseUrl` because that is the physical instance: same base URL means
 * same process and same VRAM, regardless of which connection config issued the
 * request. The lock guards only the swap sequence, not the downstream request —
 * concurrent requests for the *same* model still run in parallel after the
 * (cheap, already-loaded) check returns.
 */
const instanceLocks = new Map<string, Promise<unknown>>();

function withInstanceLock<T>(
  baseUrl: string,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = instanceLocks.get(baseUrl) ?? Promise.resolve();
  // Chain onto the previous holder regardless of how it settled.
  const next = prev.then(fn, fn);
  // Keep the chain alive but swallow rejections on the stored tail so one
  // failed swap doesn't reject the next waiter before it even runs.
  instanceLocks.set(
    baseUrl,
    next.then(
      () => undefined,
      () => undefined,
    ),
  );
  return next;
}

export interface EnsureModelReadyParams {
  baseUrl: string;
  apiKey: string | undefined;
  providerType: ProviderType | null | undefined;
  /** The model key the caller is about to request. */
  modelKey: string;
  /** Context window to load the model with (LM Studio `context_length`). */
  contextSize?: number | undefined;
  /** Whether auto-swap is enabled for the connection. */
  autoSwap: boolean;
}

/**
 * Ensure `modelKey` is the model loaded on the target LM Studio instance,
 * unloading anything else first. The central swap rule, called before every
 * provider request (via the gateway decorator) and by the manual load button.
 *
 * No-op unless the provider is LM Studio AND auto-swap is enabled — for every
 * other case the model is auto-loaded by the provider on first request, so we
 * leave loading alone.
 */
export async function ensureModelReady(
  params: EnsureModelReadyParams,
): Promise<void> {
  const { baseUrl, apiKey, providerType, modelKey, contextSize, autoSwap } =
    params;

  // Only LM Studio exposes explicit load/unload; ollama/openrouter auto-manage.
  if (providerType && providerType !== "lmstudio") return;
  if (!autoSwap) return;

  await withInstanceLock(baseUrl, async () => {
    const models = await listModelsWithStatus(baseUrl, apiKey);
    const loaded = models.filter((m) => m.isLoaded);
    const loadedKeys = loaded.map((m) => m.key);

    // The target is already resident but at a different context window than
    // requested. LM Studio fixes `context_length` at load time, so the only way
    // to correct the size is to unload and reload. We force this only when a
    // size was requested AND the loaded instance reports a differing one — a
    // null loaded size (unknown) is left alone to avoid needless reloads.
    const target = loaded.find((m) => m.key === modelKey);
    const targetNeedsReload =
      target != null &&
      contextSize != null &&
      target.loadedContextLength != null &&
      target.loadedContextLength !== contextSize;

    // Already the (only) loaded model at the right context — nothing to do.
    // Skipping the call avoids latency (a reload would otherwise be a no-op).
    if (
      loadedKeys.length === 1 &&
      loadedKeys[0] === modelKey &&
      !targetNeedsReload
    ) {
      return;
    }

    for (const key of loadedKeys) {
      if (key === modelKey) continue;
      await unloadModel(baseUrl, apiKey, key);
    }

    // Evict the target itself when it is loaded at the wrong context size, so
    // the reload below can apply the requested window.
    if (targetNeedsReload) {
      await unloadModel(baseUrl, apiKey, modelKey);
    }

    // Load the target unless it is already loaded at the right size (it may have
    // been loaded alongside others we just evicted).
    if (!loadedKeys.includes(modelKey) || targetNeedsReload) {
      await loadModel(baseUrl, apiKey, modelKey, contextSize);
    }
  });
}
