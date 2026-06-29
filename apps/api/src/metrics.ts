import type { Request, Response, NextFunction } from "express";
import { log } from "./log.js";

/** Process-lifetime counters. Reset on restart; exposed at /api/metrics. */
export const metrics = {
  startedAt: Date.now(),
  requests: 0,
  responses: {} as Record<number, number>,
  buildsSubmitted: 0,
  buildsServedFromCache: 0,
  downloads: 0,
};

export function countBuildSubmitted(): void {
  metrics.buildsSubmitted++;
}
export function countCacheHit(): void {
  metrics.buildsServedFromCache++;
}
export function countDownload(): void {
  metrics.downloads++;
}

/** One structured log line per request plus response-code counters. */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  // SSE streams are long-lived; logging them on finish would be misleading.
  if (req.path.endsWith("/events")) return next();

  const start = Date.now();
  metrics.requests++;
  res.on("finish", () => {
    metrics.responses[res.statusCode] = (metrics.responses[res.statusCode] ?? 0) + 1;
    const ms = Date.now() - start;
    log.info(`${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms ${req.ip ?? "-"}`);
  });
  next();
}
