import type { NextFunction, Request, Response } from "express";

/**
 * Fixed-window rate limiter.
 *
 * The build plan called for rate limiting from day one, "because you're
 * publishing this endpoint to crawlers by design." An endpoint advertised in an
 * AI catalog is one whose traffic you do not control.
 *
 * In-memory, so it resets on restart and does not coordinate across instances.
 * Fine for a single low-traffic service; wrong the moment this runs more than
 * one replica. Tracked in OPEN-QUESTIONS.md 10.6.
 */

interface Window {
  count: number;
  resetAt: number;
}

export interface RateLimitOptions {
  windowMs: number;
  max: number;
}

export function rateLimit(options: RateLimitOptions) {
  const windows = new Map<string, Window>();

  // Cheap sweep so the map can't grow without bound from one-off IPs.
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, window] of windows) {
      if (window.resetAt <= now) windows.delete(key);
    }
  }, options.windowMs);
  sweep.unref();

  return function rateLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
    const key = req.ip ?? "unknown";
    const now = Date.now();

    let window = windows.get(key);
    if (!window || window.resetAt <= now) {
      window = { count: 0, resetAt: now + options.windowMs };
      windows.set(key, window);
    }

    window.count++;

    const remaining = Math.max(0, options.max - window.count);
    res.setHeader("RateLimit-Limit", String(options.max));
    res.setHeader("RateLimit-Remaining", String(remaining));
    res.setHeader("RateLimit-Reset", String(Math.ceil((window.resetAt - now) / 1000)));

    if (window.count > options.max) {
      res.setHeader("Retry-After", String(Math.ceil((window.resetAt - now) / 1000)));
      res.status(429).json({
        error: "rate_limited",
        message: "Too many requests. See the Retry-After header.",
      });
      return;
    }

    next();
  };
}
