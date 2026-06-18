import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SlidingWindowRateLimiter } from '../src/mcp/rate-limiter';

describe('SlidingWindowRateLimiter - window expiry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows requests again after the window expires', () => {
    const limiter = new SlidingWindowRateLimiter();

    // Fill up the limit
    expect(limiter.tryAcquire('tool_x', 2)).toBe(true);
    expect(limiter.tryAcquire('tool_x', 2)).toBe(true);
    expect(limiter.tryAcquire('tool_x', 2)).toBe(false); // blocked

    // Advance time past the 60s window
    vi.advanceTimersByTime(61_000);

    // Should be allowed again
    expect(limiter.tryAcquire('tool_x', 2)).toBe(true);
  });

  it('partially expires old entries within the sliding window', () => {
    const limiter = new SlidingWindowRateLimiter();

    expect(limiter.tryAcquire('tool_y', 2)).toBe(true); // t=0
    vi.advanceTimersByTime(30_000); // t=30s
    expect(limiter.tryAcquire('tool_y', 2)).toBe(true); // t=30s
    expect(limiter.tryAcquire('tool_y', 2)).toBe(false); // full

    vi.advanceTimersByTime(31_000); // t=61s — first entry expired
    expect(limiter.tryAcquire('tool_y', 2)).toBe(true); // allowed (only 1 in window now)
  });
});
