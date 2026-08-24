/**
 * A minimal fixed-window rate limiter.
 *
 * Deliberately dependency-free: this service sits on the order path, and a
 * lockfile change here means `npm ci` on a deploy either drifts or fails. The
 * behaviour needed is one counter per key per window, which is not worth a
 * dependency.
 *
 * Fixed window, not sliding: at the boundary a caller can burst up to 2×limit
 * across two adjacent windows. That is fine for the job here — the point is to
 * turn an unlimited credential oracle into a bounded one, not to police a
 * precise rate.
 */
export class FixedWindowLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>()

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    /**
     * Hard cap on tracked keys. Without it the map is an unbounded allocation
     * driven by attacker-chosen keys — a memory-exhaustion vector bolted onto
     * the very thing meant to make the endpoint safer. On overflow the oldest
     * windows are dropped first; a dropped key simply starts a fresh window.
     */
    private readonly maxKeys = 10_000,
  ) {}

  /** Returns true if this hit is allowed, false if the key is over its limit. */
  check(key: string, now: number = Date.now()): boolean {
    const existing = this.hits.get(key)
    if (!existing || existing.resetAt <= now) {
      this.evictIfNeeded(now)
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs })
      return true
    }
    existing.count += 1
    return existing.count <= this.limit
  }

  /** Seconds until this key's window rolls over, for a Retry-After header. */
  retryAfterSeconds(key: string, now: number = Date.now()): number {
    const existing = this.hits.get(key)
    if (!existing || existing.resetAt <= now) return 0
    return Math.max(1, Math.ceil((existing.resetAt - now) / 1000))
  }

  private evictIfNeeded(now: number) {
    if (this.hits.size < this.maxKeys) return
    for (const [k, v] of this.hits) {
      if (v.resetAt <= now) this.hits.delete(k)
    }
    // Still full of live windows: drop the oldest insertion to stay bounded.
    if (this.hits.size >= this.maxKeys) {
      const oldest = this.hits.keys().next()
      if (!oldest.done) this.hits.delete(oldest.value)
    }
  }
}
