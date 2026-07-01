import os from "node:os";
import path from "node:path";
import { ALL_PLATFORMS, type Platform } from "@godotbuild/shared";

function int(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Platforms this host offers in every bundle. Operators without a macOS
 * toolchain (osxcross + Apple SDK + rcodesign) drop "macos" so builds don't hit
 * the all-or-nothing availability gate. Unknown/dup values are ignored; an empty
 * or unset list falls back to every supported platform.
 */
function buildPlatforms(): Platform[] {
  const raw = process.env.BUILD_PLATFORMS;
  if (!raw) return [...ALL_PLATFORMS];
  const picked = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is Platform => (ALL_PLATFORMS as string[]).includes(s));
  const unique = [...new Set(picked)];
  return unique.length ? unique : [...ALL_PLATFORMS];
}

const cores = Math.max(1, os.cpus().length);

export const config = {
  port: int("PORT", 8787),

  /** Root for all mutable state (sources, worktrees, cache, queue db). */
  dataRoot: path.resolve(process.env.DATA_ROOT ?? path.resolve(process.cwd(), ".data")),

  godotRepo: process.env.GODOT_REPO ?? "https://github.com/godotengine/godot.git",

  /** Browser origins allowed to call the API (comma-separated). */
  corsOrigins: (process.env.CORS_ORIGINS ?? "http://localhost:5173")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),

  /**
   * Number of reverse proxies in front of the API. When > 0, Express trusts
   * that many hops of X-Forwarded-For so rate limiting keys on the real client
   * IP rather than the proxy. Keep 0 when directly exposed.
   */
  trustProxy: int("TRUST_PROXY", 0),

  /** Built web bundle to serve (SPA). Empty disables static serving. */
  webDist: process.env.WEB_DIST ?? path.resolve(process.cwd(), "apps/web/dist"),

  /** Platforms every bundle covers (see buildPlatforms above). */
  buildPlatforms: buildPlatforms(),

  /** Refuse to start a build when free disk space drops below this (GiB). */
  minFreeDiskGiB: int("MIN_FREE_DISK_GIB", 10),

  /** Sliding-window rate limits (requests per window) per client IP. */
  rateLimit: {
    windowMs: int("RATE_LIMIT_WINDOW_MS", 60_000),
    /** Cheap read/check endpoints. */
    check: int("RATE_LIMIT_CHECK", 120),
    /** Per-window request burst guard on the enqueue endpoint. */
    build: int("RATE_LIMIT_BUILD", 10),
    /** Artifact downloads. */
    download: int("RATE_LIMIT_DOWNLOAD", 60),
    /** Window for the build quota below (default 24h). */
    buildQuotaWindowMs: int("RATE_LIMIT_BUILD_WINDOW_MS", 24 * 60 * 60 * 1000),
    /** Max real builds an IP may enqueue per quota window (cache hits don't count). */
    buildQuota: int("RATE_LIMIT_BUILD_PER_DAY", 10),
  },

  /** Hard cap on total size of published build artifacts; oldest are evicted. */
  buildCacheLimitGiB: int("BUILD_CACHE_LIMIT_GIB", 50),

  /** Max simultaneous SSE log streams before new ones are refused. */
  maxSseConnections: int("MAX_SSE_CONNECTIONS", 100),

  /** How many builds run concurrently. Native builds are heavy; default 1. */
  maxConcurrentBuilds: int("MAX_CONCURRENT_BUILDS", 1),

  /** -j passed to each scons invocation. */
  jobsPerBuild: int("JOBS_PER_BUILD", cores),

  /** Kill a build that exceeds this. */
  buildTimeoutMs: int("BUILD_TIMEOUT_MS", 60 * 60 * 1000),

  /** scons CacheDir size cap, in GiB. */
  sconsCacheLimitGiB: int("SCONS_CACHE_LIMIT_GIB", 20),

  /** How long a fetched Godot version list stays fresh before a background refresh. */
  versionsTtlMs: int("VERSIONS_TTL_MS", 6 * 60 * 60 * 1000),

  /** Lowest Godot series offered (the option catalog is tuned for 4.3+). */
  versionsMinMajor: int("VERSIONS_MIN_MAJOR", 4),
  versionsMinMinor: int("VERSIONS_MIN_MINOR", 3),

  /** Lines of build log kept in memory per job for SSE replay. */
  logBufferLines: int("LOG_BUFFER_LINES", 5000),

  cores,
} as const;

/** Default cold-build estimate (ms) when we have no history for a series. */
export const DEFAULT_COLD_ESTIMATE_MS = 30 * 60 * 1000;
/** Estimate (ms) when a warm scons cache for the series exists. */
export const WARM_ESTIMATE_MS = 6 * 60 * 1000;
