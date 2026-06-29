import fsp from "node:fs/promises";

export interface DiskInfo {
  freeBytes: number;
  totalBytes: number;
}

/** Free/total bytes available to the data root's filesystem. */
export async function diskInfo(pathOnFs: string): Promise<DiskInfo | null> {
  try {
    const s = await fsp.statfs(pathOnFs);
    return {
      freeBytes: s.bavail * s.bsize,
      totalBytes: s.blocks * s.bsize,
    };
  } catch {
    return null;
  }
}

/**
 * True when at least `minFreeGiB` is available on the filesystem holding
 * `pathOnFs`. Fails open (returns true) if the filesystem can't be queried, so
 * a statfs quirk never wedges the service.
 */
export async function hasFreeSpace(pathOnFs: string, minFreeGiB: number): Promise<boolean> {
  const info = await diskInfo(pathOnFs);
  if (!info) return true;
  return info.freeBytes >= minFreeGiB * 1024 ** 3;
}
