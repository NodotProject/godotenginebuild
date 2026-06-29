import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ALL_PLATFORMS,
  stableStringify,
  type OptionCatalog,
  type OptionSelection,
  type OptionValue,
  type Platform,
  type PlatformCheckResult,
  type VersionInfo,
} from "@godotbuild/shared";
import { checkBuilds, createBuilds, getCatalog, getJob, getVersions } from "./api.js";
import { OptionsDrawer } from "./components/OptionsDrawer.js";
import { PlatformCard, type JobState } from "./components/PlatformCard.js";
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
  const [platforms, setPlatforms] = useState<Platform[]>(["linuxbsd"]);
  const [selection, setSelection] = useState<OptionSelection>({});
  const [checks, setChecks] = useState<Record<string, PlatformCheckResult>>({});
  const [jobs, setJobs] = useState<Record<string, JobState>>({});
  const [logs, setLogs] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [history, setHistory] = useState<BuildHistoryEntry[]>(() => loadHistory());

  // Latest history readable from effects without making them re-run on changes.
  const historyRef = useRef(history);
  historyRef.current = history;

  const sources = useRef<Map<string, EventSource>>(new Map());
  const closeStreams = useCallback(() => {
    sources.current.forEach((es) => es.close());
    sources.current.clear();
  }, []);

  // Background status-only streams for in-flight history entries, keyed by jobId.
  // Kept separate from `sources` (the active cards) so a build listed but not
  // currently selected still updates its status live.
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
  // except the one already streamed by an active card (avoids a duplicate).
  useEffect(() => {
    const cardJobIds = new Set(
      Object.values(jobs)
        .filter((j) => j.status === "queued" || j.status === "building")
        .map((j) => j.jobId),
    );
    const wanted = new Set(
      history
        .filter((h) => (h.status === "queued" || h.status === "building") && !cardJobIds.has(h.jobId))
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
  }, [history, jobs, patchHistory]);

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
    if (!catalog || platforms.length === 0) {
      setChecks({});
      return;
    }
    const handle = setTimeout(() => {
      checkBuilds({ version, platforms, options: selection })
        .then((res) => {
          const map: Record<string, PlatformCheckResult> = {};
          for (const r of res.results) map[r.platform] = r;
          setChecks(map);
        })
        .catch((e) => setError(String(e.message ?? e)));
    }, 350);
    return () => clearTimeout(handle);
  }, [catalog, version, platforms, selection]);

  const platformDefs = catalog?.platforms ?? [];

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
      if (preset.platforms) {
        const avail = new Set(catalog.platforms.filter((d) => d.available).map((d) => d.platform));
        setPlatforms(preset.platforms.filter((p) => avail.has(p)));
      }
    },
    [catalog],
  );

  const togglePlatform = (p: Platform) => {
    setPlatforms((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  };

  const loadHistoryEntry = useCallback((entry: BuildHistoryEntry) => {
    setVersion(entry.version);
    setSelection(entry.selection);
    setPlatforms([entry.platform]);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const removeHistoryEntry = useCallback((jobId: string) => {
    setHistory((prev) => prev.filter((e) => e.jobId !== jobId));
  }, []);

  const clearHistory = useCallback(() => setHistory([]), []);

  const startStream = useCallback((platform: string, jobId: string) => {
    const es = new EventSource(`/api/builds/${jobId}/events`);
    sources.current.set(platform, es);
    es.addEventListener("log", (e) => {
      const { line } = JSON.parse((e as MessageEvent).data) as { line: string };
      setLogs((prev) => ({ ...prev, [platform]: [...(prev[platform] ?? []), line] }));
    });
    es.addEventListener("status", (e) => {
      const { status } = JSON.parse((e as MessageEvent).data) as { status: JobState["status"] };
      setJobs((prev) => ({ ...prev, [platform]: { ...prev[platform]!, status } }));
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
      setJobs((prev) => ({
        ...prev,
        [platform]: { ...prev[platform]!, ...d },
      }));
      patchHistory(jobId, d);
      es.close();
      sources.current.delete(platform);
    });
    es.addEventListener("error", (e) => {
      // Custom server "error" event carries data; native connection errors don't.
      if ((e as MessageEvent).data) {
        es.close();
        sources.current.delete(platform);
      }
    });
  }, [patchHistory]);

  // When the resulting build identity changes, reset the job/log UI and rehydrate
  // from history: restore any stored builds for this exact config and reconnect
  // the live stream for ones still in flight, so the user sees their progress.
  useEffect(() => {
    closeStreams();
    setLogs({});

    const matching = historyRef.current.filter(
      (h) => h.version === version && stableStringify(h.selection) === selectionKey,
    );

    const restored: Record<string, JobState> = {};
    for (const h of matching) {
      restored[h.platform] = {
        jobId: h.jobId,
        status: h.status,
        downloadUrl: h.downloadUrl,
        sha256: h.sha256,
        sizeBytes: h.sizeBytes,
        error: h.error,
      };
    }
    setJobs(restored);

    for (const h of matching) {
      if (h.status === "queued" || h.status === "building") {
        setLogs((prev) => ({ ...prev, [h.platform]: [] }));
        startStream(h.platform, h.jobId);
      }
    }
  }, [version, selectionKey, closeStreams, startStream]);

  const generate = useCallback(
    async (targets: Platform[]) => {
      setError(null);
      try {
        const res = await createBuilds({ version, platforms: targets, options: selection });
        const now = Date.now();
        for (const job of res.jobs) {
          setJobs((prev) => ({
            ...prev,
            [job.platform]: {
              jobId: job.jobId,
              status: job.status,
              downloadUrl: job.downloadUrl,
              sha256: job.sha256,
              sizeBytes: job.sizeBytes,
              error: job.error,
            },
          }));
          setHistory((prev) =>
            upsertEntry(prev, {
              jobId: job.jobId,
              cacheKey: job.cacheKey,
              version,
              platform: job.platform,
              selection,
              status: job.status,
              cached: job.cached,
              downloadUrl: job.downloadUrl,
              sha256: job.sha256,
              sizeBytes: job.sizeBytes,
              error: job.error,
              createdAt: now,
              updatedAt: now,
            }),
          );
          if (!job.cached && job.status !== "failed") {
            setLogs((prev) => ({ ...prev, [job.platform]: [] }));
            startStream(job.platform, job.jobId);
          }
        }
      } catch (e) {
        setError(String((e as Error).message ?? e));
      }
    },
    [version, selection, startStream],
  );

  const changedCount = Object.keys(selection).length;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200">
      <div className="max-w-5xl mx-auto px-4 py-10">
        <header className="mb-8">
          <h1 className="text-3xl font-bold text-white">Custom Godot Builds</h1>
          <p className="mt-2 text-slate-400">
            Pick your engine version and features, and download a Godot export template compiled
            to your exact configuration. Every configuration is cached, so repeat downloads are
            instant.
          </p>
        </header>

        {error && (
          <div className="mb-6 border border-rose-800 bg-rose-950/40 text-rose-300 rounded-lg px-4 py-3 text-sm">
            {error}
          </div>
        )}

        <section className="grid md:grid-cols-2 gap-4 mb-6">
          <div>
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
          </div>

          <div>
            <label className="block text-sm text-slate-400 mb-1">Platforms</label>
            <div className="flex flex-wrap gap-2">
              {ALL_PLATFORMS.map((p) => {
                const def = platformDefs.find((d) => d.platform === p);
                const disabled = def ? !def.available : false;
                const active = platforms.includes(p);
                return (
                  <button
                    key={p}
                    type="button"
                    disabled={disabled}
                    title={disabled ? def?.unavailableReason : undefined}
                    onClick={() => togglePlatform(p)}
                    className={[
                      "px-3 py-2 rounded-lg border text-sm",
                      disabled
                        ? "border-slate-800 text-slate-600 cursor-not-allowed"
                        : active
                          ? "border-sky-500 bg-sky-600/20 text-sky-200"
                          : "border-slate-700 hover:border-slate-600",
                    ].join(" ")}
                  >
                    {def?.label ?? p}
                    {disabled && " (n/a)"}
                  </button>
                );
              })}
            </div>
          </div>
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

        <section className="grid sm:grid-cols-2 gap-4">
          {platforms.map((p) => {
            const def = platformDefs.find((d) => d.platform === p);
            if (!def) return null;
            return (
              <PlatformCard
                key={p}
                def={def}
                check={checks[p]}
                job={jobs[p]}
                logLines={logs[p] ?? []}
                version={version}
                selection={selection}
                onGenerate={() => generate([p])}
              />
            );
          })}
        </section>

        <BuildHistory
          entries={history}
          platformDefs={platformDefs}
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
