/**
 * Options for the sliding-window rate limiter.
 */
export interface RateLimiterOptions {
  /**
   * Maximum number of keys (e.g. client + tool pairs) tracked at once. When the limit is
   * reached, expired keys are dropped first, then the least recently used ones, so memory
   * stays bounded no matter how many distinct clients call. Default: 10000
   */
  maxKeys?: number;
  /** Window length in milliseconds. Default: 60000 (one minute) */
  windowMs?: number;
}

/**
 * Simple sliding-window rate limiter for MCP tool calls.
 * Keys are opaque; `McpRequestHandler` uses `<clientId>|<toolName>` so every client
 * gets its own bucket per tool.
 */
export class SlidingWindowRateLimiter {
  private readonly _windows = new Map<string, number[]>();
  private readonly _maxKeys: number;
  private readonly _windowMs: number;

  constructor(options?: RateLimiterOptions) {
    this._maxKeys = Math.max(1, options?.maxKeys ?? 10_000);
    this._windowMs = options?.windowMs ?? 60_000;
  }

  /** Number of keys currently tracked. */
  get size(): number {
    return this._windows.size;
  }

  /**
   * Attempts to acquire a rate limit permit.
   * @returns true if the request is allowed, false if rate-limited.
   */
  tryAcquire(key: string, maxPerMinute: number): boolean {
    const now = Date.now();
    const windowStart = now - this._windowMs;

    let timestamps = this._windows.get(key);
    if (timestamps) {
      // Move to the end of the Map so iteration order is least-recently-used first.
      this._windows.delete(key);
    } else {
      timestamps = [];
      this.makeRoom(windowStart);
    }
    this._windows.set(key, timestamps);

    // Remove expired entries
    const validIndex = timestamps.findIndex((t) => t > windowStart);
    if (validIndex > 0) {
      timestamps.splice(0, validIndex);
    } else if (validIndex === -1) {
      timestamps.length = 0;
    }

    if (timestamps.length >= maxPerMinute) {
      return false;
    }

    timestamps.push(now);
    return true;
  }

  private makeRoom(windowStart: number): void {
    if (this._windows.size < this._maxKeys) return;

    for (const [key, timestamps] of this._windows) {
      const last = timestamps[timestamps.length - 1];
      if (last === undefined || last <= windowStart) this._windows.delete(key);
    }

    while (this._windows.size >= this._maxKeys) {
      const oldest = this._windows.keys().next().value as string;
      this._windows.delete(oldest);
    }
  }
}
