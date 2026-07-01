import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BASE_OPTIONS,
  CATALOG_VERSION,
  DEFAULT_TARGET,
  buildCacheKeyInput,
  canonicalizeOptions,
  computeCacheKey,
  renderCustomPy,
  validateSelection,
  type OptionCatalog,
  type OptionSelection,
  type Platform,
} from "@godotbuild/shared";

function makeCatalog(): OptionCatalog {
  return {
    godotVersion: "4.5-stable",
    catalogVersion: CATALOG_VERSION,
    generatedAt: "2025-01-01T00:00:00.000Z",
    scons: BASE_OPTIONS,
    modules: [
      {
        key: "module_mono_enabled",
        type: "bool",
        default: true,
        group: "modules",
        label: "Mono",
      },
    ],
    platforms: [],
    presets: [],
  };
}

function keyInput(options: OptionSelection, platforms?: Platform[]) {
  const catalog = makeCatalog();
  return buildCacheKeyInput({
    version: "4.5-stable",
    target: DEFAULT_TARGET,
    options,
    catalog,
    platforms,
  });
}

// --- validateSelection: the security boundary -----------------------------

test("validateSelection accepts allowlisted bool + enum values", () => {
  const res = validateSelection({ disable_3d: true, optimize: "size" }, makeCatalog());
  assert.equal(res.ok, true);
  assert.deepEqual(res.ok && res.value, { disable_3d: true, optimize: "size" });
});

test("validateSelection rejects unknown / free-string injection keys", () => {
  for (const key of ["ccflags", "CXX", "extra_suffix", "custom_modules", "cache_path"]) {
    const res = validateSelection({ [key]: "-O3; rm -rf /" }, makeCatalog());
    assert.equal(res.ok, false, `${key} must be rejected`);
  }
});

test("validateSelection rejects wrong types and out-of-set enum values", () => {
  assert.equal(validateSelection({ disable_3d: "yes" }, makeCatalog()).ok, false);
  assert.equal(validateSelection({ optimize: "turbo" }, makeCatalog()).ok, false);
  assert.equal(validateSelection({ lto: true }, makeCatalog()).ok, false);
});

// --- canonicalizeOptions ---------------------------------------------------

test("canonicalizeOptions drops values equal to their default", () => {
  const catalog = makeCatalog();
  assert.deepEqual(canonicalizeOptions({}, catalog, "linuxbsd"), {});
  // disable_3d defaults to false, so explicitly false is also dropped.
  assert.deepEqual(canonicalizeOptions({ disable_3d: false }, catalog, "linuxbsd"), {});
});

test("canonicalizeOptions emits non-default values as scons tokens, keys sorted", () => {
  const out = canonicalizeOptions(
    { optimize: "size", disable_3d: true },
    makeCatalog(),
    "linuxbsd",
  );
  assert.deepEqual(out, { disable_3d: "yes", optimize: "size" });
  assert.deepEqual(Object.keys(out), ["disable_3d", "optimize"]); // sorted
});

test("canonicalizeOptions clamps platform-disallowed enum values", () => {
  const catalog = makeCatalog();
  // Full LTO is allowed on Linux but not on Windows (mingw); Windows clamps it
  // to a safe value (which equals the default and is therefore dropped).
  assert.equal(canonicalizeOptions({ lto: "full" }, catalog, "linuxbsd").lto, "full");
  assert.equal(canonicalizeOptions({ lto: "full" }, catalog, "windows").lto, undefined);
});

test("canonicalizeOptions skips options not applicable to the platform", () => {
  // d3d12 is windows-only; on Linux it never appears regardless of selection.
  assert.equal(canonicalizeOptions({ d3d12: true }, makeCatalog(), "linuxbsd").d3d12, undefined);
});

// --- computeCacheKey -------------------------------------------------------

test("cache key is stable: omitting a default == setting it explicitly", async () => {
  const a = await computeCacheKey(keyInput({}));
  const b = await computeCacheKey(keyInput({ disable_3d: false }));
  assert.equal(a, b);
});

test("cache key differs by option value and by platform set", async () => {
  const base = await computeCacheKey(keyInput({}));
  const changed = await computeCacheKey(keyInput({ disable_3d: true }));
  // A bundle covers every configured platform, so the key varies by the SET of
  // platforms, not a single one: a Linux+Windows bundle differs from all-three.
  const fewerPlatforms = await computeCacheKey(keyInput({}, ["linuxbsd", "windows"]));
  assert.notEqual(base, changed);
  assert.notEqual(base, fewerPlatforms);
});

test("cache key is a 64-char hex sha256", async () => {
  const key = await computeCacheKey(keyInput({ disable_3d: true }));
  assert.match(key, /^[a-f0-9]{64}$/);
});

// --- renderCustomPy --------------------------------------------------------

test("renderCustomPy emits sorted, quoted python literals", () => {
  const py = renderCustomPy({ optimize: "size", disable_3d: "yes" });
  assert.match(py, /disable_3d = "yes"/);
  assert.match(py, /optimize = "size"/);
  assert.ok(py.indexOf("disable_3d") < py.indexOf("optimize"), "keys sorted");
});

test("renderCustomPy refuses unsafe option keys", () => {
  assert.throws(() => renderCustomPy({ "bad key; import os": "x" }));
  assert.throws(() => renderCustomPy({ "ccflags=-O3": "x" }));
});
