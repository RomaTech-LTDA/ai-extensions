/**
 * Simple sliding-window rate limiter for MCP tool calls.
 */
export class SlidingWindowRateLimiter {
  private readonly _windows = new Map<string, number[]>();

  /**
   * Attempts to acquire a rate limit permit.
   * @returns true if the request is allowed, false if rate-limited.
   */
  tryAcquire(key: string, maxPerMinute: number): boolean {
    const now = Date.now();
    const windowStart = now - 60_000;

    let timestamps = this._windows.get(key);
    if (!timestamps) {
      timestamps = [];
      this._windows.set(key, timestamps);
    }

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
}
