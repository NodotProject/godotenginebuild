import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  stableStringify,
  type BuildCheckResult,
  type OptionCatalog,
  type OptionSelection,
  type OptionValue,
  type VersionInfo,
} from "@godotbuild/shared";
import { checkBuilds, createBuilds, getCatalog, getJob, getVersions } from "./api.js";
import { formatList } from "./util.js";
import { OptionsDrawer } from "./components/OptionsDrawer.js";
import { BuildCard, type JobState } from "./components/BuildCard.js";
import { BuildHistory } from "./components/BuildHistory.js";
import {
  isTerminal,
  loadHistory,
  patchEntry,
  saveHistory,
  upsertEntry,
  type BuildHistoryEntry,
} from "./history.js";

export function App() {
  const [versions, setVersions] = useState<VersionInfo[]>([]);
  const [version, setVersion] = useState<string>("");
  const [catalog, setCatalog] = useState<OptionCatalog | null>(null);
  const [selection, setSelection] = useState<OptionSelection>({});
  const [check, setCheck] = useState<BuildCheckResult | null>(null);
  const [job, setJob] = useState<JobState | null>(null);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [history, setHistory] = useState<BuildHistoryEntry[]>(() => loadHistory());

  // Latest history readable from effects without making them re-run on changes.
  const historyRef = useRef(history);
  historyRef.current = history;

  // The single active-card stream (queued/building build the user is watching).
  const sourceRef = useRef<EventSource | null>(null);

  // Background status-only streams for in-flight history entries, keyed by jobId.
  // Kept separate from the active card so a build listed but not currently
  // selected still updates its status live.
  const listSources = useRef<Map<string, EventSource>>(new Map());

  // Persist history whenever it changes.
  useEffect(() => {
    saveHistory(history);
  }, [history]);

  const patchHistory = useCallback((jobId: string, patch: Partial<BuildHistoryEntry>) => {
    setHistory((prev) => patchEntry(prev, jobId, patch));
  }, []);

  // Load versions on mount.
  useEffect(() => {
    getVersions()
      .then((v) => {
        setVersions(v.versions);
        setVersion(v.defaultVersion);
      })
      .catch((e) => setError(String(e.message ?? e)));
  }, []);

  // Load catalog when version changes; prune selection to keys still present.
  useEffect(() => {
    if (!version) return;
    let cancelled = false;
    getCatalog(version)
      .then((c) => {
        if (cancelled) return;
        setCatalog(c);
        const valid = new Set([...c.scons, ...c.modules].map((o) => o.key));
        setSelection((prev) =>
          Object.fromEntries(Object.entries(prev).filter(([k]) => valid.has(k))),
        );
      })
      .catch((e) => setError(String(e.message ?? e)));
    return () => {
      cancelled = true;
    };
  }, [version]);

  const selectionKey = useMemo(() => stableStringify(selection), [selection]);

  // On load, refresh the stored status of any build that wasn't finished yet.
  useEffect(() => {
    const stale = historyRef.current.filter((h) => !isTerminal(h.status));
    for (const h of stale) {
      getJob(h.jobId)
        .then((info) => {
          if (!info) return;
          patchHistory(h.jobId, {
            status: info.status,
            cached: info.cached,
            downloadUrl: info.downloadUrl,
            sha256: info.sha256,
            sizeBytes: info.sizeBytes,
            error: info.error,
          });
        })
        .catch(() => {});
    }
    // Run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep a background status stream open for every in-flight build in the list,
  // except the one already streamed by the active card (avoids a duplicate).
  useEffect(() => {
    const cardJobId =
      job && (job.status === "queued" || job.status === "building") ? job.jobId : null;
    const wanted = new Set(
      history
        .filter(
          (h) =>
            (h.status === "queued" || h.status === "building") && h.jobId !== cardJobId,
        )
        .map((h) => h.jobId),
    );

    for (const [jobId, es] of listSources.current) {
      if (!wanted.has(jobId)) {
        es.close();
        listSources.current.delete(jobId);
      }
    }

    for (const jobId of wanted) {
      if (listSources.current.has(jobId)) continue;
      const es = new EventSource(`/api/builds/${jobId}/events`);
      listSources.current.set(jobId, es);
      es.addEventListener("status", (e) => {
        const { status } = JSON.parse((e as MessageEvent).data) as { status: JobState["status"] };
        patchHistory(jobId, { status });
      });
      es.addEventListener("done", (e) => {
        const d = JSON.parse((e as MessageEvent).data) as {
          status: "success" | "failed";
          downloadUrl?: string;
          sha256?: string;
          sizeBytes?: number;
          error?: string;
        };
        patchHistory(jobId, d);
        es.close();
        listSources.current.delete(jobId);
      });
      es.addEventListener("error", (e) => {
        if ((e as MessageEvent).data) {
          es.close();
          listSources.current.delete(jobId);
        }
      });
    }
  }, [history, job, patchHistory]);

  // Close background streams on unmount.
  useEffect(() => {
    const map = listSources.current;
    return () => {
      map.forEach((es) => es.close());
      map.clear();
    };
  }, []);

  // Debounced live cache check.
  useEffect(() => {
    if (!catalog) {
      setCheck(null);
      return;
    }
    const handle = setTimeout(() => {
      checkBuilds({ version, options: selection })
        .then((res) => setCheck(res.result))
        .catch((e) => setError(String(e.message ?? e)));
    }, 350);
    return () => clearTimeout(handle);
  }, [catalog, version, selection]);

  const setOption = useCallback((key: string, value: OptionValue | undefined) => {
    setSelection((prev) => {
      const next = { ...prev };
      if (value === undefined) delete next[key];
      else next[key] = value;
      return next;
    });
  }, []);

  const applyPreset = useCallback(
    (presetId: string) => {
      if (!catalog) return;
      const preset = catalog.presets.find((p) => p.id === presetId);
      if (!preset) return;
      const valid = new Set([...catalog.scons, ...catalog.modules].map((o) => o.key));
      const next: OptionSelection = {};
      for (const [k, v] of Object.entries(preset.options)) {
        if (valid.has(k)) next[k] = v;
      }
      setSelection(next);
    },
    [catalog],
  );

  const loadHistoryEntry = useCallback((entry: BuildHistoryEntry) => {
    setVersion(entry.version);
    setSelection(entry.selection);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const removeHistoryEntry = useCallback((jobId: string) => {
    setHistory((prev) => prev.filter((e) => e.jobId !== jobId));
  }, []);

  const clearHistory = useCallback(() => setHistory([]), []);

  const startStream = useCallback(
    (jobId: string) => {
      sourceRef.current?.close();
      const es = new EventSource(`/api/builds/${jobId}/events`);
      sourceRef.current = es;
      es.addEventListener("log", (e) => {
        const { line } = JSON.parse((e as MessageEvent).data) as { line: string };
        setLogLines((prev) => [...prev, line]);
      });
      es.addEventListener("status", (e) => {
        const { status } = JSON.parse((e as MessageEvent).data) as { status: JobState["status"] };
        setJob((prev) => (prev ? { ...prev, status } : prev));
        patchHistory(jobId, { status });
      });
      es.addEventListener("done", (e) => {
        const d = JSON.parse((e as MessageEvent).data) as {
          status: "success" | "failed";
          downloadUrl?: string;
          sha256?: string;
          sizeBytes?: number;
          error?: string;
        };
        setJob((prev) => (prev ? { ...prev, ...d } : prev));
        patchHistory(jobId, d);
        es.close();
        if (sourceRef.current === es) sourceRef.current = null;
      });
      es.addEventListener("error", (e) => {
        // Custom server "error" event carries data; native connection errors don't.
        if ((e as MessageEvent).data) {
          es.close();
          if (sourceRef.current === es) sourceRef.current = null;
        }
      });
    },
    [patchHistory],
  );

  // When the build identity (version + options) changes, reset the job/log UI and
  // rehydrate from history: restore a stored build for this exact config and
  // reconnect the live stream if it is still in flight.
  useEffect(() => {
    sourceRef.current?.close();
    sourceRef.current = null;
    setLogLines([]);

    const match = historyRef.current.find(
      (h) => h.version === version && stableStringify(h.selection) === selectionKey,
    );

    if (!match) {
      setJob(null);
      return;
    }

    setJob({
      jobId: match.jobId,
      status: match.status,
      downloadUrl: match.downloadUrl,
      sha256: match.sha256,
      sizeBytes: match.sizeBytes,
      error: match.error,
    });
    if (match.status === "queued" || match.status === "building") {
      startStream(match.jobId);
    }
  }, [version, selectionKey, startStream]);

  const generate = useCallback(async () => {
    setError(null);
    try {
      const res = await createBuilds({ version, options: selection });
      const j = res.job;
      const now = Date.now();
      setJob({
        jobId: j.jobId,
        status: j.status,
        downloadUrl: j.downloadUrl,
        sha256: j.sha256,
        sizeBytes: j.sizeBytes,
        error: j.error,
      });
      setHistory((prev) =>
        upsertEntry(prev, {
          jobId: j.jobId,
          cacheKey: j.cacheKey,
          version,
          selection,
          status: j.status,
          cached: j.cached,
          downloadUrl: j.downloadUrl,
          sha256: j.sha256,
          sizeBytes: j.sizeBytes,
          error: j.error,
          createdAt: now,
          updatedAt: now,
        }),
      );
      if (!j.cached && j.status !== "failed") {
        setLogLines([]);
        startStream(j.jobId);
      }
    } catch (e) {
      setError(String((e as Error).message ?? e));
    }
  }, [version, selection, startStream]);

  const changedCount = Object.keys(selection).length;
  const platforms = catalog?.platforms ?? [];
  const platformLabels = platforms.map((d) => d.label);
  const unavailable = platforms.filter((d) => !d.available);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200">
      <div className="max-w-5xl mx-auto px-4 py-10">
        <header className="mb-8">
          <h1 className="text-3xl font-bold text-white">Custom Godot Builds</h1>
          <p className="mt-2 text-slate-400">
            Pick your engine version and features, and download Godot export templates
            {platformLabels.length > 0 ? ` for ${formatList(platformLabels)}` : ""} compiled to your
            exact configuration. Every configuration is cached, so repeat downloads are instant.
          </p>
        </header>

        {error && (
          <div className="mb-6 border border-rose-800 bg-rose-950/40 text-rose-300 rounded-lg px-4 py-3 text-sm">
            {error}
          </div>
        )}

        <section className="mb-6">
          <label className="block text-sm text-slate-400 mb-1">Godot version</label>
          <select
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2"
            value={version}
            onChange={(e) => setVersion(e.target.value)}
          >
            {versions.map((v) => (
              <option key={v.version} value={v.version}>
                {v.version}
              </option>
            ))}
          </select>
        </section>

        {catalog && (
          <section className="mb-6">
            <label className="block text-sm text-slate-400 mb-2">Presets</label>
            <div className="flex flex-wrap gap-2">
              {catalog.presets.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => applyPreset(preset.id)}
                  title={preset.description}
                  className="px-3 py-2 rounded-lg border border-slate-700 hover:border-sky-500 hover:bg-sky-600/10 text-sm"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </section>
        )}

        {catalog && (
          <section className="mb-8">
            <button
              type="button"
              onClick={() => setShowAdvanced((s) => !s)}
              className="text-sm text-sky-400 hover:text-sky-300 mb-3"
            >
              {showAdvanced ? "▾" : "▸"} Advanced options
              {changedCount > 0 && (
                <span className="ml-2 text-xs text-slate-500">{changedCount} changed</span>
              )}
            </button>
            {showAdvanced && (
              <OptionsDrawer catalog={catalog} selection={selection} onChange={setOption} />
            )}
          </section>
        )}

        {unavailable.length > 0 && (
          <div className="mb-4 border border-amber-800 bg-amber-950/30 text-amber-300/90 rounded-lg px-4 py-3 text-sm">
            This host can't currently build every platform, so bundle builds will fail:{" "}
            {unavailable.map((d) => d.label).join(", ")}.
          </div>
        )}

        <BuildCard
          check={check ?? undefined}
          job={job ?? undefined}
          logLines={logLines}
          version={version}
          selection={selection}
          platformLabels={platformLabels}
          onGenerate={generate}
        />

        <BuildHistory
          entries={history}
          onLoad={loadHistoryEntry}
          onRemove={removeHistoryEntry}
          onClear={clearHistory}
        />

        <footer className="mt-12 text-xs text-slate-600 space-y-3">
          <p>
            Builds are compiled with scons on the host and cached per configuration. First build of a
            version is slowest (~30 min); similar later builds reuse shared compile steps.
          </p>
          <p>
            Free, open-source, and not affiliated with the Godot project. Binaries are provided as-is
            — verify the published sha256 before use.
          </p>
          <nav className="flex gap-4">
            <a href="/privacy" className="hover:text-slate-400">
              Privacy
            </a>
            <a href="/terms" className="hover:text-slate-400">
              Terms
            </a>
          </nav>
        </footer>
      </div>
    </div>
  );
}
