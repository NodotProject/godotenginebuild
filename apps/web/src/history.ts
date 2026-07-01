import type { JobStatus, OptionSelection } from "@godotbuild/shared";

const STORAGE_KEY = "godotbuild.history.v2";
const MAX_ENTRIES = 50;

/** A build the user kicked off, persisted across reloads in localStorage. */
export interface BuildHistoryEntry {
  jobId: string;
  cacheKey: string;
  version: string;
  /** Exact option selection used, so the config can be reloaded. */
  selection: OptionSelection;
  status: JobStatus;
  cached: boolean;
  downloadUrl?: string;
  sha256?: string;
  sizeBytes?: number;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export function isTerminal(status: JobStatus): boolean {
  return status === "success" || status === "failed" || status === "canceled";
}

export function loadHistory(): BuildHistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((e): e is BuildHistoryEntry => typeof e?.jobId === "string");
  } catch {
    return [];
  }
}

export function saveHistory(entries: BuildHistoryEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
  } catch {
    /* quota or disabled storage: ignore */
  }
}

/** Insert or replace an entry by jobId, keeping newest-first order. */
export function upsertEntry(
  entries: BuildHistoryEntry[],
  entry: BuildHistoryEntry,
): BuildHistoryEntry[] {
  const rest = entries.filter((e) => e.jobId !== entry.jobId);
  return [entry, ...rest].slice(0, MAX_ENTRIES);
}

/** Patch an existing entry by jobId; no-op if absent. */
export function patchEntry(
  entries: BuildHistoryEntry[],
  jobId: string,
  patch: Partial<BuildHistoryEntry>,
): BuildHistoryEntry[] {
  return entries.map((e) =>
    e.jobId === jobId ? { ...e, ...patch, updatedAt: Date.now() } : e,
  );
}
