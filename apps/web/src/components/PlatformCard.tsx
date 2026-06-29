import { useEffect, useRef, useState } from "react";
import {
  stableStringify,
  type JobStatus,
  type OptionSelection,
  type PlatformCheckResult,
  type PlatformDef,
} from "@godotbuild/shared";
import { formatBytes, formatDuration, ghActionConfig } from "../util.js";

export interface JobState {
  jobId: string;
  status: JobStatus;
  downloadUrl?: string;
  sha256?: string;
  sizeBytes?: number;
  error?: string;
}

interface Props {
  def: PlatformDef;
  check?: PlatformCheckResult;
  job?: JobState;
  logLines: string[];
  version: string;
  selection: OptionSelection;
  onGenerate: () => void;
}

function LogView({ lines }: { lines: string[] }) {
  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => {
    ref.current?.scrollTo(0, ref.current.scrollHeight);
  }, [lines]);
  return (
    <pre
      ref={ref}
      className="mt-3 h-48 overflow-auto bg-black/60 rounded p-2 text-[11px] leading-tight text-emerald-300/90 font-mono whitespace-pre-wrap"
    >
      {lines.join("\n")}
    </pre>
  );
}

function DownloadButton({ url, size }: { url: string; size?: number }) {
  return (
    <a
      href={url}
      className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-medium px-4 py-2 rounded-lg"
    >
      ↓ Download{size ? ` (${formatBytes(size)})` : ""}
    </a>
  );
}

function CopyActionButton({ config }: { config: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(config);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked (e.g. insecure context) — no-op */
    }
  };
  return (
    <button
      type="button"
      onClick={copy}
      title="Copy a GitHub Actions step that reproduces this build in your CI"
      className="inline-flex items-center gap-2 border border-slate-700 hover:border-slate-600 text-slate-200 font-medium px-4 py-2 rounded-lg"
    >
      {copied ? "✓ Copied" : "Copy GH Action"}
    </button>
  );
}

export function PlatformCard({ def, check, job, logLines, version, selection, onGenerate }: Props) {
  const building = job?.status === "queued" || job?.status === "building";
  const cachedUrl = job?.downloadUrl ?? (check?.cached ? check.downloadUrl : undefined);
  const failed = job?.status === "failed";

  return (
    <div className="border border-slate-800 rounded-xl p-4 bg-slate-900/40">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-slate-100">{def.label}</h3>
        {check?.cached && !building && (
          <span className="text-xs text-emerald-400">cached</span>
        )}
      </div>

      {!def.available ? (
        <p className="mt-3 text-sm text-amber-400/90">
          Unavailable on this host. {def.unavailableReason}
        </p>
      ) : building ? (
        <div className="mt-3">
          <p className="text-sm text-sky-300 flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-sky-400 animate-pulse" />
            {job?.status === "queued" ? "Queued…" : "Building from source…"}
          </p>
          <LogView lines={logLines} />
        </div>
      ) : cachedUrl ? (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <DownloadButton url={cachedUrl} size={job?.sizeBytes ?? check?.sizeBytes} />
            <CopyActionButton
              config={ghActionConfig({
                version,
                platform: def.platform,
                options: stableStringify(selection),
              })}
            />
          </div>
          {(job?.sha256 ?? check?.sha256) && (
            <p className="text-[10px] text-slate-500 break-all">
              sha256: {job?.sha256 ?? check?.sha256}
            </p>
          )}
          {logLines.length > 0 && <LogView lines={logLines} />}
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <button
            type="button"
            onClick={onGenerate}
            className="bg-sky-600 hover:bg-sky-500 text-white font-medium px-4 py-2 rounded-lg"
          >
            Generate my build
            {check ? ` (${formatDuration(check.estimateMs)})` : ""}
          </button>
          {check && (
            <p className="text-xs text-slate-500">
              {check.warmCache
                ? "A similar build exists, so shared compile steps are reused — this is much faster than a first build."
                : "Godot is compiled from source on our server for your exact configuration. The result is cached, so anyone choosing the same options downloads instantly."}
            </p>
          )}
          {failed && <p className="text-sm text-rose-400">Build failed: {job?.error}</p>}
        </div>
      )}
    </div>
  );
}
