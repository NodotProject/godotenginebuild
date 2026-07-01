// Shared domain types for the Godot build service.
// Kept browser-safe: no `node:*` imports anywhere in this package.

export type Platform = "linuxbsd" | "windows" | "macos";

export type BuildTarget = "template_release" | "template_debug" | "editor";

export type OptionType = "bool" | "enum";

/**
 * UI grouping for options. Drives the sectioning of the advanced drawer.
 */
export type OptionGroup =
  | "optimization"
  | "subsystems"
  | "rendering"
  | "components"
  | "modules"
  | "builtin";

interface OptionBase {
  /** Exact scons variable name, e.g. "disable_3d", "module_mono_enabled". */
  key: string;
  group: OptionGroup;
  label: string;
  help?: string;
  /** Platforms this option applies to. Omitted = all platforms. */
  platforms?: Platform[];
}

export interface BoolOption extends OptionBase {
  type: "bool";
  /** Wire/default value as a boolean. Emitted to custom.py as "yes"/"no". */
  default: boolean;
}

export interface EnumOption extends OptionBase {
  type: "enum";
  values: string[];
  default: string;
  /**
   * Optional per-platform restriction of the allowed values
   * (e.g. Windows forbids full LTO via mingw).
   */
  perPlatformValues?: Partial<Record<Platform, string[]>>;
}

export type BuildOptionDef = BoolOption | EnumOption;

/** A user-selected value for an option (wire form). */
export type OptionValue = boolean | string;

/** Map of optionKey -> value as sent from the browser. */
export type OptionSelection = Record<string, OptionValue>;

export interface PlatformDef {
  platform: Platform;
  /** Human label, e.g. "Linux (x86_64)". */
  label: string;
  /** Default architecture produced for this platform. */
  arch: string;
  /** Whether the host can currently build this platform (toolchain present). */
  available: boolean;
  /** Why it is unavailable, if so. */
  unavailableReason?: string;
}

export interface OptionCatalog {
  godotVersion: string;
  /** Bumped when catalog generation semantics change; part of the cache key. */
  catalogVersion: number;
  generatedAt: string;
  /** Static scons feature flags (browser + server share these). */
  scons: BuildOptionDef[];
  /** Per-version module toggles discovered by scanning the source tree. */
  modules: BuildOptionDef[];
  platforms: PlatformDef[];
  /** Named presets the UI can apply. */
  presets: BuildPreset[];
}

export interface BuildPreset {
  id: string;
  label: string;
  description: string;
  /** Partial selection applied on top of catalog defaults. */
  options: OptionSelection;
}

/** Per-platform build input within a bundle: arch + canonical scons options. */
export interface PlatformBuildSpec {
  arch: string;
  /** Canonicalized scons-value map for this platform (defaults dropped, sorted). */
  options: Record<string, string>;
}

/**
 * Canonical input that is hashed into a cache key. One build produces every
 * platform, so the key covers all of them; `platforms` is keyed by platform
 * name (sorted) and each entry's options are canonicalized before hashing.
 */
export interface CacheKeyInput {
  schema: number;
  godotVersion: string;
  catalogVersion: number;
  target: BuildTarget;
  platforms: Record<Platform, PlatformBuildSpec>;
}

// ---------------------------------------------------------------------------
// API DTOs
// ---------------------------------------------------------------------------

export interface VersionInfo {
  version: string;
  /** Major.minor, e.g. "4.5". */
  series: string;
}

export interface VersionsResponse {
  versions: VersionInfo[];
  defaultVersion: string;
}

export type JobStatus =
  | "queued"
  | "building"
  | "success"
  | "failed"
  | "canceled";

export interface BuildCheckRequest {
  version: string;
  options: OptionSelection;
}

export interface BuildCheckResult {
  cacheKey: string;
  cached: boolean;
  downloadUrl?: string;
  sha256?: string;
  sizeBytes?: number;
  /** Estimated build time if not cached, in milliseconds. */
  estimateMs: number;
  /** True when a similar build of this version exists, so the estimate is low. */
  warmCache: boolean;
}

export interface BuildCheckResponse {
  result: BuildCheckResult;
}

export type BuildRequest = BuildCheckRequest;

export interface JobInfo {
  jobId: string;
  cacheKey: string;
  status: JobStatus;
  cached: boolean;
  downloadUrl?: string;
  sha256?: string;
  sizeBytes?: number;
  error?: string;
}

export interface BuildResponse {
  job: JobInfo;
}

// ---------------------------------------------------------------------------
// SSE event payloads (one per `event:` type)
// ---------------------------------------------------------------------------

export interface SseLogEvent {
  line: string;
}

export interface SseStatusEvent {
  status: JobStatus;
}

export interface SseDoneEvent {
  status: "success" | "failed";
  cacheKey: string;
  downloadUrl?: string;
  sha256?: string;
  sizeBytes?: number;
  error?: string;
}
