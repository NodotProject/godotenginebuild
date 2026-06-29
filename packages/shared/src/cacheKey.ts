import { CACHE_SCHEMA } from "./catalog.js";
import { canonicalizeOptions } from "./options.js";
import type {
  BuildTarget,
  CacheKeyInput,
  OptionCatalog,
  OptionSelection,
  Platform,
} from "./types.js";

/** Deterministic JSON: object keys sorted recursively, no whitespace. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const parts = Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`);
  return `{${parts.join(",")}}`;
}

export function buildCacheKeyInput(params: {
  version: string;
  platform: Platform;
  arch: string;
  target: BuildTarget;
  options: OptionSelection;
  catalog: OptionCatalog;
}): CacheKeyInput {
  return {
    schema: CACHE_SCHEMA,
    godotVersion: params.version,
    platform: params.platform,
    arch: params.arch,
    target: params.target,
    catalogVersion: params.catalog.catalogVersion,
    options: canonicalizeOptions(params.options, params.catalog, params.platform),
  };
}

/** SHA-256 hex digest using Web Crypto (isomorphic: browser + Node 20+). */
export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function computeCacheKey(input: CacheKeyInput): Promise<string> {
  return sha256Hex(stableStringify(input));
}
