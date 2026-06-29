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

function clientKey(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? "unknown";
}

export interface IpQuota {
  /** True when this client has already used its full allowance for the window. */
  exceeded(req: Request): boolean;
  /** Record `n` consumed units against this client's current window. */
  consume(req: Request, n?: number): void;
  /** Seconds until the client's window resets (for a Retry-After header). */
  retryAfterSeconds(req: Request): number;
}

/**
 * A fixed-window per-IP quota whose counting is decoupled from request handling:
 * callers `consume` only when a unit is actually used (e.g. a real build is
 * enqueued), so cache hits and rejected requests don't burn the allowance.
 * Same in-process, lazily-swept design as {@link rateLimit}.
 */
export function ipQuota(opts: { windowMs: number; max: number }): IpQuota {
  const buckets = new Map<string, Bucket>();
  let lastSweep = Date.now();

  function sweep(now: number): void {
    if (now - lastSweep < opts.windowMs) return;
    lastSweep = now;
    for (const [key, b] of buckets) {
      if (b.resetAt <= now) buckets.delete(key);
    }
  }

  function bucketFor(key: string, now: number): Bucket {
    let b = buckets.get(key);
    if (!b || b.resetAt <= now) {
      b = { count: 0, resetAt: now + opts.windowMs };
      buckets.set(key, b);
    }
    return b;
  }

  return {
    exceeded(req) {
      const now = Date.now();
      sweep(now);
      return bucketFor(clientKey(req), now).count >= opts.max;
    },
    consume(req, n = 1) {
      bucketFor(clientKey(req), Date.now()).count += n;
    },
    retryAfterSeconds(req) {
      const b = buckets.get(clientKey(req));
      return b ? Math.max(0, Math.ceil((b.resetAt - Date.now()) / 1000)) : Math.ceil(opts.windowMs / 1000);
    },
  };
}
