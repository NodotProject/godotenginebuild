import type { VersionInfo } from "./types.js";

/**
 * Seed/offline-fallback list of Godot stable tags. At runtime the API replaces
 * this with the live list of stable tags fetched from the Godot git repo (see
 * apps/api versionService). This list is only used to bootstrap before the first
 * successful fetch, or if the network is unavailable. The requested version is
 * always validated against the current known list before any clone — we never
 * check out an arbitrary git ref.
 */
export const SUPPORTED_VERSIONS: string[] = [
  "4.5-stable",
  "4.4.1-stable",
  "4.4-stable",
  "4.3-stable",
];

export const DEFAULT_VERSION = "4.5-stable";

/** Default lower bound for offered versions. The option catalog is tuned for 4.3+. */
export const MIN_SERIES = { major: 4, minor: 3 } as const;

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
}

const STABLE_TAG_RE = /^(\d+)\.(\d+)(?:\.(\d+))?-stable$/;

/** Parse a "4.5.1-stable" / "4.5-stable" tag. Returns null for non-stable tags. */
export function parseStableTag(tag: string): ParsedVersion | null {
  const m = STABLE_TAG_RE.exec(tag);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: m[3] ? Number(m[3]) : 0 };
}

/** Newest-first comparator. */
export function compareVersionsDesc(a: ParsedVersion, b: ParsedVersion): number {
  return b.major - a.major || b.minor - a.minor || b.patch - a.patch;
}

/** Extract "4.5" from "4.5.1-stable" / "4.5-stable". */
export function versionSeries(tag: string): string {
  const p = parseStableTag(tag);
  return p ? `${p.major}.${p.minor}` : tag;
}

/**
 * Filter a raw list of git tags down to supported stable releases, deduped and
 * sorted newest-first. Drops anything below the minimum series.
 */
export function filterStableTags(
  tags: string[],
  opts: { min?: { major: number; minor: number } } = {},
): string[] {
  const min = opts.min ?? MIN_SERIES;
  const seen = new Set<string>();
  return tags
    .map((t) => ({ tag: t, p: parseStableTag(t) }))
    .filter((x): x is { tag: string; p: ParsedVersion } => x.p !== null)
    .filter(({ p }) => p.major > min.major || (p.major === min.major && p.minor >= min.minor))
    .filter(({ tag }) => (seen.has(tag) ? false : (seen.add(tag), true)))
    .sort((a, b) => compareVersionsDesc(a.p, b.p))
    .map(({ tag }) => tag);
}

export function isSupportedVersion(tag: string): boolean {
  return SUPPORTED_VERSIONS.includes(tag);
}

export function versionInfos(tags: string[] = SUPPORTED_VERSIONS): VersionInfo[] {
  return tags.map((version) => ({ version, series: versionSeries(version) }));
}
