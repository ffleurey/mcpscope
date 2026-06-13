/**
 * Provider type identifiers.
 *
 * The authoritative source of the provider type is the connection config's
 * `providerType` field (see `providerConnectionSchema` in configuration.ts).
 * This value is carried through the `modelProfileSnapshot` at session creation.
 */

import type { providerTypeValues } from "../../domain/configuration.js";

/** Valid provider type values. Extends config values with `"openai"`. */
export type ProviderType = (typeof providerTypeValues)[number] | "openai";
