import type {
  BuildOptionDef,
  OptionCatalog,
  OptionSelection,
  OptionValue,
  Platform,
} from "./types.js";

/** Build a key -> def lookup over both scons flags and module toggles. */
export function optionMap(catalog: OptionCatalog): Map<string, BuildOptionDef> {
  const m = new Map<string, BuildOptionDef>();
  for (const o of catalog.scons) m.set(o.key, o);
  for (const o of catalog.modules) m.set(o.key, o);
  return m;
}

export function optionAppliesToPlatform(
  def: BuildOptionDef,
  platform: Platform,
): boolean {
  return !def.platforms || def.platforms.includes(platform);
}

/** True for a per-module toggle (`module_<name>_enabled`), not the global flag. */
export function isModuleOption(def: BuildOptionDef): boolean {
  return def.key.startsWith("module_") && def.key.endsWith("_enabled");
}

/** Current value of the global modules_enabled_by_default flag (default true). */
export function modulesEnabledByDefault(selection: OptionSelection): boolean {
  const v = selection["modules_enabled_by_default"];
  return v === undefined ? true : Boolean(v);
}

/**
 * The effective default for an option given the rest of the selection. A
 * module's default is NOT its static `true` — it tracks
 * `modules_enabled_by_default`, so explicitly enabling a module while that flag
 * is off is preserved (and vice-versa).
 */
export function effectiveDefault(
  def: BuildOptionDef,
  selection: OptionSelection,
): OptionValue {
  if (def.type === "bool" && isModuleOption(def)) {
    return modulesEnabledByDefault(selection);
  }
  return def.default;
}

/** Allowed enum values for an option on a given platform. */
export function allowedValuesForPlatform(
  def: Extract<BuildOptionDef, { type: "enum" }>,
  platform: Platform,
): string[] {
  return def.perPlatformValues?.[platform] ?? def.values;
}

/** Convert a wire value to its scons string form ("yes"/"no" or enum token). */
export function toSconsValue(def: BuildOptionDef, value: OptionValue): string {
  if (def.type === "bool") return value ? "yes" : "no";
  return String(value);
}

export function defaultSconsValue(def: BuildOptionDef): string {
  return toSconsValue(def, def.default);
}

export type ValidationResult =
  | { ok: true; value: OptionSelection }
  | { ok: false; error: string };

/**
 * The security boundary. Rejects any key not in the catalog and any value that
 * is not a member of the option's closed set. Returns the selection unchanged
 * (still in wire form) when valid — canonicalization happens separately.
 */
export function validateSelection(
  raw: Record<string, unknown>,
  catalog: OptionCatalog,
): ValidationResult {
  const map = optionMap(catalog);
  const out: OptionSelection = {};

  for (const [key, value] of Object.entries(raw)) {
    const def = map.get(key);
    if (!def) return { ok: false, error: `Unknown option: ${key}` };

    if (def.type === "bool") {
      if (typeof value !== "boolean") {
        return { ok: false, error: `Option ${key} must be a boolean` };
      }
      out[key] = value;
    } else {
      if (typeof value !== "string" || !def.values.includes(value)) {
        return {
          ok: false,
          error: `Option ${key} must be one of: ${def.values.join(", ")}`,
        };
      }
      out[key] = value;
    }
  }

  return { ok: true, value: out };
}

/**
 * Produce the canonical scons-value map for one platform: apply defaults, clamp
 * platform-disallowed enum values to a safe value, drop options equal to their
 * default, drop options not applicable to the platform, and sort keys.
 *
 * This is what makes the cache key stable: omitting an option and explicitly
 * setting it to its default hash identically.
 */
export function canonicalizeOptions(
  selection: OptionSelection,
  catalog: OptionCatalog,
  platform: Platform,
): Record<string, string> {
  const map = optionMap(catalog);
  const result: Record<string, string> = {};

  for (const [key, def] of map) {
    if (!optionAppliesToPlatform(def, platform)) continue;

    const effDefaultStr = toSconsValue(def, effectiveDefault(def, selection));
    const provided = selection[key];
    let sconsVal = provided === undefined ? effDefaultStr : toSconsValue(def, provided);

    if (def.type === "enum") {
      const allowed = allowedValuesForPlatform(def, platform);
      if (!allowed.includes(sconsVal)) {
        // Clamp to the safest allowed value: prefer "none", else first allowed.
        sconsVal = allowed.includes("none") ? "none" : allowed[0]!;
      }
    }

    if (sconsVal === effDefaultStr) continue; // drop values at their effective default
    result[key] = sconsVal;
  }

  // Return with sorted keys for deterministic serialization.
  return Object.fromEntries(
    Object.keys(result)
      .sort()
      .map((k) => [k, result[k]!]),
  );
}
