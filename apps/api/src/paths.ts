import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

const root = config.dataRoot;

export const paths = {
  root,
  sources: path.join(root, "sources"),
  worktrees: path.join(root, "worktrees"),
  sconscache: path.join(root, "sconscache"),
  catalogs: path.join(root, "catalogs"),
  builds: path.join(root, "builds"),
  queue: path.join(root, "queue"),
  tmp: path.join(root, "tmp"),

  sourceDir: (version: string) => path.join(root, "sources", version),
  worktreeDir: (jobId: string) => path.join(root, "worktrees", jobId),
  tmpDir: (jobId: string) => path.join(root, "tmp", jobId),
  sconsCacheDir: (version: string) => path.join(root, "sconscache", version),
  catalogFile: (version: string) => path.join(root, "catalogs", `${version}.json`),
  queueDb: () => path.join(root, "queue", "jobs.db"),

  buildDir: (cacheKey: string) => path.join(root, "builds", cacheKey),
  buildArtifact: (cacheKey: string) => path.join(root, "builds", cacheKey, "artifact"),
  buildSha256: (cacheKey: string) => path.join(root, "builds", cacheKey, "artifact.sha256"),
  buildManifest: (cacheKey: string) => path.join(root, "builds", cacheKey, "manifest.json"),
  buildMeta: (cacheKey: string) => path.join(root, "builds", cacheKey, "meta.json"),
  buildLog: (cacheKey: string) => path.join(root, "builds", cacheKey, "build.log"),
  buildComplete: (cacheKey: string) => path.join(root, "builds", cacheKey, ".complete"),
} as const;

/** Create the fixed top-level data directories. Idempotent. */
export function ensureDataDirs(): void {
  for (const dir of [
    paths.sources,
    paths.worktrees,
    paths.sconscache,
    paths.catalogs,
    paths.builds,
    paths.queue,
    paths.tmp,
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
