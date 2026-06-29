import type { Request, Response, NextFunction, RequestHandler } from "express";

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * A dependency-free fixed-window per-IP rate limiter. State lives in-process,
 * which is the right granularity for this single-process build service. Stale
 * buckets are swept lazily so the map cannot grow without bound.
 */
export function rateLimit(opts: {
  windowMs: number;
  max: number;
  message?: string;
}): RequestHandler {
  const buckets = new Map<string, Bucket>();
  const message = opts.message ?? "Too many requests. Please slow down.";
  let lastSweep = Date.now();

  function sweep(now: number): void {
    if (now - lastSweep < opts.windowMs) return;
    lastSweep = now;
    for (const [key, b] of buckets) {
      if (b.resetAt <= now) buckets.delete(key);
    }
  }

  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    sweep(now);

    // Express resolves `req.ip` from X-Forwarded-For per the trust-proxy setting.
    const key = req.ip ?? req.socket.remoteAddress ?? "unknown";
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + opts.windowMs };
      buckets.set(key, bucket);
    }
    bucket.count++;

    const remaining = Math.max(0, opts.max - bucket.count);
    res.setHeader("RateLimit-Limit", String(opts.max));
    res.setHeader("RateLimit-Remaining", String(remaining));
    res.setHeader("RateLimit-Reset", String(Math.ceil((bucket.resetAt - now) / 1000)));

    if (bucket.count > opts.max) {
      res.setHeader("Retry-After", String(Math.ceil((bucket.resetAt - now) / 1000)));
      res.status(429).json({ error: message });
      return;
    }
    next();
  };
}
