import { ALL_PLATFORMS, CACHE_SCHEMA, PLATFORM_ARCH } from "./catalog.js";
import { canonicalizeOptions } from "./options.js";
import type {
  BuildTarget,
  CacheKeyInput,
  OptionCatalog,
  OptionSelection,
  Platform,
  PlatformBuildSpec,
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
  target: BuildTarget;
  options: OptionSelection;
  catalog: OptionCatalog;
  /** Platforms the bundle should cover. Defaults to every supported platform. */
  platforms?: Platform[];
}): CacheKeyInput {
  const targetPlatforms = params.platforms ?? ALL_PLATFORMS;
  const platforms = {} as Record<Platform, PlatformBuildSpec>;
  for (const platform of targetPlatforms) {
    platforms[platform] = {
      arch: PLATFORM_ARCH[platform],
      options: canonicalizeOptions(params.options, params.catalog, platform),
    };
  }
  return {
    schema: CACHE_SCHEMA,
    godotVersion: params.version,
    catalogVersion: params.catalog.catalogVersion,
    target: params.target,
    platforms,
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
