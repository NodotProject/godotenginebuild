import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { paths } from "../paths.js";
import { log } from "../log.js";
import { run } from "../util/proc.js";
import {
  DEFAULT_VERSION,
  SUPPORTED_VERSIONS,
  filterStableTags,
  versionSeries,
  type VersionInfo,
} from "@godotbuild/shared";

interface VersionCache {
  versions: string[];
  fetchedAt: number;
}

let cache: VersionCache | null = null;
let inflight: Promise<string[]> | null = null;

function diskFile(): string {
  return path.join(paths.root, "versions.json");
}

function loadDisk(): VersionCache | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(diskFile(), "utf8")) as VersionCache;
    if (Array.isArray(parsed.versions) && parsed.versions.length > 0) return parsed;
  } catch {
    /* no cache on disk */
  }
  return null;
}

function saveDisk(c: VersionCache): void {
  try {
    fs.mkdirSync(paths.root, { recursive: true });
    fs.writeFileSync(diskFile(), JSON.stringify(c, null, 2));
  } catch (err) {
    log.warn("Failed to persist version cache:", String(err));
  }
}

/** Query the Godot remote for stable tags. Never clones; just lists refs. */
async function fetchTags(): Promise<string[]> {
  const res = await run("git", ["ls-remote", "--tags", "--refs", config.godotRepo]);
  if (res.code !== 0) throw new Error(`git ls-remote failed: ${res.stderr.trim()}`);
  const tags = res.stdout
    .split("\n")
    .map((line) => line.split("\t")[1] ?? "")
    .map((ref) => ref.replace("refs/tags/", ""))
    .filter(Boolean);
  const filtered = filterStableTags(tags, {
    min: { major: config.versionsMinMajor, minor: config.versionsMinMinor },
  });
  if (filtered.length === 0) throw new Error("no stable tags parsed from remote");
  return filtered;
}

/** Refresh the version list from the remote, updating the in-memory + disk cache. */
export async function refreshVersions(): Promise<string[]> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const versions = await fetchTags();
      cache = { versions, fetchedAt: Date.now() };
      saveDisk(cache);
      log.info(`Godot versions refreshed: ${versions.length} tags (latest ${versions[0]}).`);
      return versions;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Populate the in-memory cache from disk if empty (sync, no network). */
function ensureLoaded(): void {
  if (cache) return;
  const disk = loadDisk();
  if (disk) cache = disk;
}

/** Current best-known version list (live cache → disk → seed fallback). */
function currentVersions(): string[] {
  ensureLoaded();
  return cache?.versions ?? SUPPORTED_VERSIONS;
}

/**
 * Version list for the API. Blocks on the first fetch only when no cache exists
 * at all; otherwise serves cached data and refreshes in the background if stale.
 */
export async function getVersions(): Promise<VersionInfo[]> {
  ensureLoaded();
  if (!cache) {
    try {
      await refreshVersions();
    } catch (err) {
      log.warn("Version fetch failed; using seed list:", String(err));
    }
  } else if (Date.now() - cache.fetchedAt >= config.versionsTtlMs) {
    void refreshVersions().catch((err) =>
      log.warn("Background version refresh failed:", String(err)),
    );
  }
  return currentVersions().map((version) => ({ version, series: versionSeries(version) }));
}

export function isSupportedVersion(version: string): boolean {
  return currentVersions().includes(version);
}

export function defaultVersion(): string {
  return currentVersions()[0] ?? DEFAULT_VERSION;
}

/** Kick off an initial fetch and schedule periodic refreshes. */
export function startVersionRefresh(): void {
  void refreshVersions().catch((err) =>
    log.warn("Initial version fetch failed; using cached/seed list:", String(err)),
  );
  const timer = setInterval(() => {
    void refreshVersions().catch(() => {});
  }, config.versionsTtlMs);
  timer.unref?.();
}
