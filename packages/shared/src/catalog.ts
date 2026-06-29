import type {
  BuildOptionDef,
  BuildPreset,
  Platform,
  BuildTarget,
} from "./types.js";

/**
 * Bump whenever the meaning of catalog generation changes (option set, defaults,
 * how custom.py is rendered). It is part of the cache key, so bumping it
 * invalidates every cached build.
 */
export const CATALOG_VERSION = 1;

/** Cache-key schema version. Bump to invalidate all keys on format change. */
export const CACHE_SCHEMA = 1;

/** v1 only produces export-release templates. Kept extensible. */
export const DEFAULT_TARGET: BuildTarget = "template_release";

/**
 * The static, hand-curated scons feature flags. Only `bool` and `enum` options
 * are ever exposed — never free strings (those are arbitrary-code vectors and
 * are deliberately absent: CXX/CC/ccflags/linkflags/cppdefines/extra_suffix/
 * custom_modules/cache_path/etc. are NOT in this list and are rejected by
 * validation if a client sends them).
 *
 * Module toggles (`module_<name>_enabled`) are discovered per version by
 * scanning the source tree and merged in server-side; they are not listed here.
 */
export const BASE_OPTIONS: BuildOptionDef[] = [
  // --- Optimization ---------------------------------------------------------
  {
    key: "optimize",
    type: "enum",
    values: ["auto", "none", "debug", "speed", "speed_trace", "size", "size_extra"],
    default: "auto",
    group: "optimization",
    label: "Optimization",
    help: "Compiler optimization profile. 'size' produces the smallest binary; 'speed' the fastest.",
  },
  {
    key: "lto",
    type: "enum",
    values: ["none", "auto", "thin", "full"],
    default: "none",
    group: "optimization",
    label: "Link-time optimization",
    help: "Full LTO yields the smallest/fastest binary but builds much slower. Windows (mingw) is limited to 'none' to avoid compiler crashes.",
    // mingw full-LTO ICEs; restrict Windows to safe values.
    perPlatformValues: { windows: ["none", "auto", "thin"] },
  },
  {
    key: "debug_symbols",
    type: "bool",
    default: false,
    group: "optimization",
    label: "Debug symbols",
    help: "Include debug symbols. Much larger binary.",
  },
  {
    key: "production",
    type: "bool",
    default: false,
    group: "optimization",
    label: "Production build",
    help: "Enable production tuning (static libstdc++, etc.). Recommended for distributable templates.",
  },
  {
    key: "precision",
    type: "enum",
    values: ["single", "double"],
    default: "single",
    group: "optimization",
    label: "Float precision",
    help: "Double precision is for very large worlds; most projects use single.",
  },

  // --- Subsystems -----------------------------------------------------------
  {
    key: "deprecated",
    type: "bool",
    default: true,
    group: "subsystems",
    label: "Deprecated API",
    help: "Keep deprecated/compatibility API wrappers. Disable to shrink the binary if your project doesn't use them.",
  },
  {
    key: "disable_3d",
    type: "bool",
    default: false,
    group: "subsystems",
    label: "Disable 3D engine",
    help: "Remove the entire 3D engine. For 2D-only projects.",
  },
  {
    key: "disable_advanced_gui",
    type: "bool",
    default: false,
    group: "subsystems",
    label: "Disable advanced GUI",
    help: "Remove advanced GUI nodes (trees, graph edit, rich controls).",
  },
  {
    key: "disable_physics_2d",
    type: "bool",
    default: false,
    group: "subsystems",
    label: "Disable 2D physics",
  },
  {
    key: "disable_physics_3d",
    type: "bool",
    default: false,
    group: "subsystems",
    label: "Disable 3D physics",
  },
  {
    key: "disable_navigation_2d",
    type: "bool",
    default: false,
    group: "subsystems",
    label: "Disable 2D navigation",
  },
  {
    key: "disable_navigation_3d",
    type: "bool",
    default: false,
    group: "subsystems",
    label: "Disable 3D navigation",
  },
  {
    key: "disable_xr",
    type: "bool",
    default: false,
    group: "subsystems",
    label: "Disable XR",
    help: "Remove VR/AR/XR support.",
  },

  // --- Rendering ------------------------------------------------------------
  {
    key: "vulkan",
    type: "bool",
    default: true,
    group: "rendering",
    label: "Vulkan renderer",
    help: "Forward+ / Mobile renderers. Disable for a GL-Compatibility-only, smaller binary.",
  },
  {
    key: "opengl3",
    type: "bool",
    default: true,
    group: "rendering",
    label: "OpenGL (Compatibility)",
    help: "GL Compatibility renderer.",
  },
  {
    key: "use_volk",
    type: "bool",
    default: true,
    group: "rendering",
    label: "Use volk (Vulkan loader)",
    help: "Dynamic Vulkan loader. Disable together with Vulkan.",
  },
  {
    key: "d3d12",
    type: "bool",
    default: false,
    group: "rendering",
    label: "Direct3D 12",
    help: "Windows-only Direct3D 12 renderer.",
    platforms: ["windows"],
  },
  {
    key: "metal",
    type: "bool",
    default: false,
    group: "rendering",
    label: "Metal",
    help: "macOS/Apple Metal renderer.",
    platforms: ["macos"],
  },

  // --- Components -----------------------------------------------------------
  {
    key: "minizip",
    type: "bool",
    default: true,
    group: "components",
    label: "Minizip (ZIP)",
    help: "ZIP archive support (PCK, updater, ZIPReader/ZIPPacker).",
  },
  {
    key: "brotli",
    type: "bool",
    default: true,
    group: "components",
    label: "Brotli",
    help: "Brotli decompression (used by web fonts and assets).",
  },
  {
    key: "accesskit",
    type: "bool",
    default: true,
    group: "components",
    label: "AccessKit",
    help: "Accessibility (screen reader) support.",
  },
  {
    key: "sdl",
    type: "bool",
    default: true,
    group: "components",
    label: "SDL",
    help: "SDL-based gamepad/input support.",
  },
  {
    key: "threads",
    type: "bool",
    default: true,
    group: "components",
    label: "Threads",
    help: "Multithreading support. Disabling is rarely useful off the web platform.",
  },

  // --- Modules (global) -----------------------------------------------------
  {
    key: "modules_enabled_by_default",
    type: "bool",
    default: true,
    group: "modules",
    label: "Enable all modules by default",
    help: "When off, every module is disabled unless you explicitly enable it below — the aggressive size-stripping approach.",
  },
];

/** Lazily-built lookup map of base option key -> def. */
const BASE_BY_KEY = new Map(BASE_OPTIONS.map((o) => [o.key, o]));
export function getBaseOption(key: string): BuildOptionDef | undefined {
  return BASE_BY_KEY.get(key);
}

/**
 * Common modules an aggressive (modules_enabled_by_default=no) build re-enables.
 * Presets reference these; only keys actually present in a version's catalog are
 * applied by the UI.
 */
const LITE_MODULES = [
  "gdscript",
  "freetype",
  "svg",
  "webp",
  "websocket",
  "mbedtls",
  "regex",
  "text_server_fb",
  "zip",
  "jpg",
  "ogg",
  "vorbis",
  "minimp3",
];

function moduleEnables(names: string[]): Record<string, boolean> {
  return Object.fromEntries(names.map((n) => [`module_${n}_enabled`, true]));
}

export const PRESETS: BuildPreset[] = [
  {
    id: "standard",
    label: "Standard",
    description: "Full-featured release template — every engine feature, tuned for production.",
    options: {
      production: true,
      optimize: "speed",
      lto: "auto",
    },
  },
  {
    id: "2d-lite",
    label: "2D Lite",
    description:
      "GodotLite-style minimal 2D template: no 3D/Vulkan/XR, size-optimized, only core modules. Smallest binary.",
    options: {
      production: true,
      optimize: "size",
      lto: "full",
      deprecated: false,
      disable_3d: true,
      disable_navigation_2d: true,
      disable_navigation_3d: true,
      disable_xr: true,
      vulkan: false,
      use_volk: false,
      modules_enabled_by_default: false,
      minizip: true,
      ...moduleEnables(LITE_MODULES),
    },
    platforms: ["linuxbsd"],
  },
  {
    id: "3d-full",
    label: "3D Full",
    description: "Full 3D + Vulkan production template, speed-optimized.",
    options: {
      production: true,
      optimize: "speed",
      lto: "auto",
      vulkan: true,
      use_volk: true,
    },
  },
];

// ---------------------------------------------------------------------------
// Platform metadata
// ---------------------------------------------------------------------------

export const PLATFORM_LABELS: Record<Platform, string> = {
  linuxbsd: "Linux (x86_64)",
  windows: "Windows (x86_64)",
  macos: "macOS (universal)",
};

export const PLATFORM_ARCH: Record<Platform, string> = {
  linuxbsd: "x86_64",
  windows: "x86_64",
  macos: "universal",
};

export const ALL_PLATFORMS: Platform[] = ["linuxbsd", "windows", "macos"];
