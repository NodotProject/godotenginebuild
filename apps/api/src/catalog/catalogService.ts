import fs from "node:fs";
import fsp from "node:fs/promises";
import { paths } from "../paths.js";
import { log } from "../log.js";
import { ensureSource, discoverModuleNames } from "../build/sourceManager.js";
import { getPlatformDefs } from "../build/hostProbe.js";
import {
  BASE_OPTIONS,
  CATALOG_VERSION,
  PRESETS,
  type BuildOptionDef,
  type OptionCatalog,
} from "@godotbuild/shared";

interface CatalogFile {
  godotVersion: string;
  catalogVersion: number;
  generatedAt: string;
  moduleNames: string[];
}

const memo = new Map<string, OptionCatalog>();

function moduleOption(name: string): BuildOptionDef {
  return {
    key: `module_${name}_enabled`,
    type: "bool",
    default: true,
    group: "modules",
    label: name,
    help: `Enable the '${name}' engine module.`,
  };
}

async function loadOrBuildModuleNames(version: string): Promise<{
  moduleNames: string[];
  generatedAt: string;
}> {
  const file = paths.catalogFile(version);
  if (fs.existsSync(file)) {
    try {
      const parsed = JSON.parse(await fsp.readFile(file, "utf8")) as CatalogFile;
      if (parsed.catalogVersion === CATALOG_VERSION && parsed.moduleNames) {
        return { moduleNames: parsed.moduleNames, generatedAt: parsed.generatedAt };
      }
    } catch {
      // fall through and regenerate
    }
  }

  log.info(`Generating option catalog for ${version}…`);
  await ensureSource(version);
  const moduleNames = await discoverModuleNames(version);
  const generatedAt = new Date().toISOString();
  const payload: CatalogFile = {
    godotVersion: version,
    catalogVersion: CATALOG_VERSION,
    generatedAt,
    moduleNames,
  };
  fs.mkdirSync(paths.catalogs, { recursive: true });
  await fsp.writeFile(file, JSON.stringify(payload, null, 2));
  return { moduleNames, generatedAt };
}

/** Full option catalog for a version: base flags + discovered modules + live platforms. */
export async function getCatalog(version: string): Promise<OptionCatalog> {
  const cached = memo.get(version);
  const platforms = await getPlatformDefs();

  if (cached) {
    // Refresh platform availability (host state) but keep frozen options.
    return { ...cached, platforms };
  }

  const { moduleNames, generatedAt } = await loadOrBuildModuleNames(version);
  const catalog: OptionCatalog = {
    godotVersion: version,
    catalogVersion: CATALOG_VERSION,
    generatedAt,
    scons: BASE_OPTIONS,
    modules: moduleNames.map(moduleOption),
    platforms,
    presets: PRESETS,
  };
  memo.set(version, catalog);
  return catalog;
}
