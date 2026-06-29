import fs from "node:fs";
import path from "node:path";
import express from "express";
import cors from "cors";
import { config } from "./config.js";
import { ensureDataDirs, paths } from "./paths.js";
import { log } from "./log.js";
import { api } from "./routes/api.js";
import { initQueue, queueStats, shutdownQueue } from "./build/queue.js";
import { getPlatformDefs } from "./build/hostProbe.js";
import { startVersionRefresh } from "./catalog/versionService.js";
import { requestLogger, metrics } from "./metrics.js";
import { killAllStreaming } from "./util/proc.js";
import { diskInfo } from "./util/diskSpace.js";

async function main() {
  ensureDataDirs();
  initQueue();
  startVersionRefresh();

  const defs = await getPlatformDefs();
  log.info(
    "Host build targets:",
    defs.map((d) => `${d.platform}=${d.available ? "yes" : "no"}`).join(" "),
  );

  const app = express();
  app.set("trust proxy", config.trustProxy);
  app.use(requestLogger);
  app.use(cors({ origin: config.corsOrigins }));
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    next();
  });
  app.use(express.json({ limit: "1mb" }));

  // Liveness: the process is up. Cheap, never touches disk.
  app.get("/api/health", (_req, res) => res.json({ ok: true }));

  // Readiness: deeper signal a load balancer can gate traffic on.
  app.get("/api/ready", async (_req, res) => {
    const disk = await diskInfo(paths.root);
    const freeGiB = disk ? +(disk.freeBytes / 1024 ** 3).toFixed(1) : null;
    const lowDisk = disk ? disk.freeBytes < config.minFreeDiskGiB * 1024 ** 3 : false;
    const platforms = defs.filter((d) => d.available).map((d) => d.platform);
    const ready = platforms.length > 0 && !lowDisk;
    res.status(ready ? 200 : 503).json({
      ready,
      queue: queueStats(),
      disk: { freeGiB, lowDisk },
      platforms,
    });
  });

  app.get("/api/metrics", async (_req, res) => {
    const disk = await diskInfo(paths.root);
    res.json({
      uptimeSeconds: Math.round((Date.now() - metrics.startedAt) / 1000),
      requests: metrics.requests,
      responses: metrics.responses,
      builds: {
        submitted: metrics.buildsSubmitted,
        servedFromCache: metrics.buildsServedFromCache,
        downloads: metrics.downloads,
      },
      queue: queueStats(),
      diskFreeGiB: disk ? +(disk.freeBytes / 1024 ** 3).toFixed(1) : null,
    });
  });

  app.use("/api", api);

  // Serve the built SPA (when present) with a history-API fallback so client
  // routes like /privacy and /terms resolve to index.html. /api is already
  // handled above, so it never reaches here.
  const indexHtml = path.join(config.webDist, "index.html");
  if (fs.existsSync(indexHtml)) {
    app.use(express.static(config.webDist));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(indexHtml));
    log.info(`Serving web bundle from ${config.webDist}`);
  } else {
    log.info("No web bundle found; API-only mode (run the Vite dev server separately).");
  }

  const server = app.listen(config.port, () => {
    log.info(`API listening on http://localhost:${config.port}`);
    log.info(`Data root: ${config.dataRoot}`);
  });

  let shuttingDown = false;
  function shutdown(signal: string): void {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info(`Received ${signal}, shutting down…`);

    // Force-exit if a connection (e.g. a stuck SSE stream) refuses to close.
    const force = setTimeout(() => {
      log.warn("Forced exit after shutdown timeout.");
      process.exit(1);
    }, 10_000);
    force.unref();

    server.close(() => {
      killAllStreaming();
      shutdownQueue();
      log.info("Shutdown complete.");
      process.exit(0);
    });
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  log.error("Fatal startup error:", err);
  process.exit(1);
});
