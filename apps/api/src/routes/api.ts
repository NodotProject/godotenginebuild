import fs from "node:fs";
import { Router, type Request, type Response, type Router as ExpressRouter } from "express";
import { z } from "zod";
import { getCatalog } from "../catalog/catalogService.js";
import { planBundle, toCheckResult } from "../build/planner.js";
import { getActiveJob, getJobInfo, hasActiveBuild, submitJob } from "../build/queue.js";
import { subscribe, getLive } from "../build/logHub.js";
import {
  isCached,
  readMeta,
  downloadUrl as makeDownloadUrl,
} from "../build/cacheStore.js";
import { isPlatformAvailable } from "../build/hostProbe.js";
import {
  defaultVersion,
  getVersions,
  isSupportedVersion,
} from "../catalog/versionService.js";
import { openSse, sseConnectionsAtCapacity } from "../util/sse.js";
import { rateLimit, ipQuota } from "../util/rateLimit.js";
import { hasFreeSpace } from "../util/diskSpace.js";
import { countBuildSubmitted, countCacheHit, countDownload } from "../metrics.js";
import { paths } from "../paths.js";
import { config } from "../config.js";
import { log } from "../log.js";
import {
  validateSelection,
  type BuildRequest,
  type JobInfo,
} from "@godotbuild/shared";

export const api: ExpressRouter = Router();

const checkLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.check,
});
const buildLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.build,
  message: "You've started too many builds recently. Please wait a minute and retry.",
});
// Counts only builds an IP actually enqueues, so cache hits and "server busy"
// rejections never burn the allowance.
const buildQuota = ipQuota({
  windowMs: config.rateLimit.buildQuotaWindowMs,
  max: config.rateLimit.buildQuota,
});
const downloadLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.download,
});

const buildRequestSchema = z.object({
  version: z.string(),
  options: z.record(z.union([z.boolean(), z.string()])),
});

api.get("/versions", async (_req, res) => {
  res.json({ versions: await getVersions(), defaultVersion: defaultVersion() });
});

api.get("/catalog", async (req, res) => {
  const version = String(req.query.version ?? defaultVersion());
  if (!isSupportedVersion(version)) {
    return res.status(400).json({ error: `Unsupported version: ${version}` });
  }
  try {
    res.json(await getCatalog(version));
  } catch (err) {
    log.error("catalog error", err);
    res.status(500).json({ error: "Failed to build catalog" });
  }
});

/** Validate a build request body and return the normalized selection. */
async function parseAndValidate(req: Request, res: Response) {
  const parsed = buildRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request" });
    return null;
  }
  const body = parsed.data as BuildRequest;
  if (!isSupportedVersion(body.version)) {
    res.status(400).json({ error: `Unsupported version: ${body.version}` });
    return null;
  }
  const catalog = await getCatalog(body.version);
  const validation = validateSelection(body.options, catalog);
  if (!validation.ok) {
    res.status(400).json({ error: validation.error });
    return null;
  }
  return { ...body, options: validation.value };
}

api.post("/builds/check", checkLimiter, async (req, res) => {
  const body = await parseAndValidate(req, res);
  if (!body) return;
  const plan = await planBundle(body.version, body.options);
  res.json({ result: toCheckResult(plan, body.version) });
});

api.post("/builds", buildLimiter, async (req, res) => {
  if (buildQuota.exceeded(req)) {
    res.setHeader("Retry-After", String(buildQuota.retryAfterSeconds(req)));
    return res.status(429).json({
      error: `You've reached the build limit of ${config.rateLimit.buildQuota} builds. Please try again later.`,
    });
  }

  const body = await parseAndValidate(req, res);
  if (!body) return;

  const plan = await planBundle(body.version, body.options);
  const base = { cacheKey: plan.cacheKey, cached: false } as const;
  const respond = (job: JobInfo) => res.json({ job });

  if (plan.cached) {
    countCacheHit();
    const meta = readMeta(plan.cacheKey);
    return respond({
      ...base,
      jobId: `cached-${plan.cacheKey.slice(0, 12)}`,
      status: "success",
      cached: true,
      downloadUrl: makeDownloadUrl(plan.cacheKey),
      sha256: meta?.sha256,
      sizeBytes: meta?.sizeBytes,
    });
  }

  // This exact build is already in flight: attach to it rather than starting a duplicate.
  const active = getActiveJob(plan.cacheKey);
  if (active) {
    return respond({ ...base, jobId: active.jobId, status: active.status });
  }

  // The bundle is all-or-nothing: every offered platform must be buildable here.
  const unavailable: string[] = [];
  for (const platform of config.buildPlatforms) {
    if (!(await isPlatformAvailable(platform))) unavailable.push(platform);
  }
  if (unavailable.length > 0) {
    return respond({
      ...base,
      jobId: "unavailable",
      status: "failed",
      error: `Cannot build the bundle — this host is missing the toolchain for: ${unavailable.join(", ")}.`,
    });
  }

  // A cold build needs tens of GiB for source + worktree + object cache; refuse
  // to start one when the data volume is nearly full (cached downloads still work).
  if (!(await hasFreeSpace(paths.root, config.minFreeDiskGiB))) {
    return respond({
      ...base,
      jobId: "nospace",
      status: "failed",
      error: "The build server is low on disk space. Please try again later.",
    });
  }

  // A different build is already running: do nothing rather than queue more work.
  if (hasActiveBuild()) {
    return respond({
      ...base,
      jobId: "busy",
      status: "failed",
      error: "Server is busy building another configuration. Please retry once it finishes.",
    });
  }

  const { jobId, status } = submitJob(plan.cacheKey, plan.manifest);
  countBuildSubmitted();
  buildQuota.consume(req);
  respond({ ...base, jobId, status });
});

api.get("/builds/:jobId/events", async (req, res) => {
  if (sseConnectionsAtCapacity()) {
    return res.status(503).json({ error: "Too many concurrent log streams. Try again shortly." });
  }
  const jobId = req.params.jobId;
  const headerId = req.header("last-event-id");
  const queryId = req.query.lastSeq;
  const lastEventId =
    headerId !== undefined
      ? Number.parseInt(headerId, 10)
      : typeof queryId === "string"
        ? Number.parseInt(queryId, 10)
        : null;
  const lastSeq = lastEventId !== null && Number.isFinite(lastEventId) ? lastEventId : null;

  const sink = openSse(res);

  // Live (queued/building/recently-finished) jobs: subscribe to the hub.
  if (getLive(jobId)) {
    const unsub = subscribe(jobId, sink, lastSeq);
    req.on("close", () => unsub?.());
    return;
  }

  // Not live: replay the persisted log from disk if the build is cached/known.
  const rec = getJobInfo(jobId);
  if (rec && isCached(rec.cacheKey)) {
    await streamDiskLog(rec.cacheKey, sink);
    const meta = readMeta(rec.cacheKey);
    sink.send("done", {
      status: "success",
      cacheKey: rec.cacheKey,
      downloadUrl: makeDownloadUrl(rec.cacheKey),
      sha256: meta?.sha256,
      sizeBytes: meta?.sizeBytes,
    });
    sink.close();
    return;
  }

  if (rec) {
    sink.send("status", { status: rec.status });
    if (rec.status === "failed") {
      sink.send("done", { status: "failed", cacheKey: rec.cacheKey, error: rec.error });
    }
    sink.close();
    return;
  }

  sink.send("error", { error: "Unknown job" });
  sink.close();
});

api.get("/builds/:jobId", (req, res) => {
  const rec = getJobInfo(req.params.jobId);
  if (!rec) return res.status(404).json({ error: "Unknown job" });
  const meta = isCached(rec.cacheKey) ? readMeta(rec.cacheKey) : null;
  res.json({
    jobId: rec.jobId,
    cacheKey: rec.cacheKey,
    status: rec.status,
    cached: isCached(rec.cacheKey),
    error: rec.error,
    downloadUrl: meta ? makeDownloadUrl(rec.cacheKey) : undefined,
    sha256: meta?.sha256,
    sizeBytes: meta?.sizeBytes,
  });
});

api.get("/builds/:cacheKey/download", downloadLimiter, (req, res) => {
  const cacheKey = req.params.cacheKey;
  if (!cacheKey || !/^[a-f0-9]{64}$/.test(cacheKey)) {
    return res.status(400).json({ error: "Invalid cache key" });
  }
  const meta = readMeta(cacheKey);
  if (!meta) return res.status(404).json({ error: "Build not found" });
  countDownload();
  res.setHeader("X-Checksum-Sha256", meta.sha256);
  res.download(paths.buildArtifact(cacheKey), meta.artifactFilename);
});

async function streamDiskLog(
  cacheKey: string,
  sink: { send: (e: string, d: unknown, id?: number) => void },
) {
  try {
    const content = await fs.promises.readFile(paths.buildLog(cacheKey), "utf8");
    const lines = content.split("\n");
    lines.forEach((line, i) => {
      if (line !== "" || i < lines.length - 1) sink.send("log", { line }, i);
    });
  } catch {
    /* no log on disk */
  }
}
