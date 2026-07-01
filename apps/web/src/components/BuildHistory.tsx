import type { JobStatus } from "@godotbuild/shared";
import type { BuildHistoryEntry } from "../history.js";
import { formatBytes } from "../util.js";

interface Props {
  entries: BuildHistoryEntry[];
  onLoad: (entry: BuildHistoryEntry) => void;
  onRemove: (jobId: string) => void;
  onClear: () => void;
}

const STATUS_STYLES: Record<JobStatus, string> = {
  queued: "text-amber-300 border-amber-700/60 bg-amber-900/20",
  building: "text-sky-300 border-sky-700/60 bg-sky-900/20",
  success: "text-emerald-300 border-emerald-700/60 bg-emerald-900/20",
  failed: "text-rose-300 border-rose-700/60 bg-rose-900/20",
  canceled: "text-slate-400 border-slate-700/60 bg-slate-800/40",
};

const STATUS_LABELS: Record<JobStatus, string> = {
  queued: "Queued",
  building: "Building",
  success: "Ready",
  failed: "Failed",
  canceled: "Canceled",
};

function relativeTime(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function BuildHistory({ entries, onLoad, onRemove, onClear }: Props) {
  if (entries.length === 0) return null;

  return (
    <section className="mt-12">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold text-slate-100">Your builds</h2>
        <button
          type="button"
          onClick={onClear}
          className="text-xs text-slate-500 hover:text-slate-300"
        >
          Clear all
        </button>
      </div>

      <ul className="space-y-2">
        {entries.map((e) => {
          const building = e.status === "queued" || e.status === "building";
          const optionCount = Object.keys(e.selection).length;
          return (
            <li
              key={e.jobId}
              className="flex flex-wrap items-center gap-x-3 gap-y-2 border border-slate-800 rounded-lg px-3 py-2.5 bg-slate-900/40"
            >
              <span
                className={`text-[11px] px-2 py-0.5 rounded-full border ${STATUS_STYLES[e.status]} ${
                  building ? "inline-flex items-center gap-1.5" : ""
                }`}
              >
                {building && (
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
                )}
                {STATUS_LABELS[e.status]}
              </span>

              <div className="min-w-0 flex-1">
                <p className="text-sm text-slate-200 truncate">
                  Godot {e.version}
                  <span className="text-slate-500"> · all platforms</span>
                </p>
                <p className="text-xs text-slate-500">
                  {optionCount === 0 ? "default options" : `${optionCount} option${optionCount === 1 ? "" : "s"} changed`}
                  {" · "}
                  {relativeTime(e.createdAt)}
                  {e.status === "failed" && e.error ? ` · ${e.error}` : ""}
                </p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {e.status === "success" && e.downloadUrl && (
                  <a
                    href={e.downloadUrl}
                    className="text-xs bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded-md"
                  >
                    ↓ Download{e.sizeBytes ? ` (${formatBytes(e.sizeBytes)})` : ""}
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => onLoad(e)}
                  className="text-xs border border-slate-700 hover:border-sky-500 text-slate-300 px-3 py-1.5 rounded-md"
                >
                  Load config
                </button>
                <button
                  type="button"
                  onClick={() => onRemove(e.jobId)}
                  title="Remove from history"
                  className="text-xs text-slate-600 hover:text-rose-400 px-1.5"
                >
                  ✕
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
