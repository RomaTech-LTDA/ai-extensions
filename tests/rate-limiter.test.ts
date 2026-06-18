import { describe, it, expect } from 'vitest';
import { SlidingWindowRateLimiter } from '../src/mcp/rate-limiter';

describe('SlidingWindowRateLimiter', () => {
  it('allows requests within the limit', () => {
    const limiter = new SlidingWindowRateLimiter();
    expect(limiter.tryAcquire('tool_a', 5)).toBe(true);
    expect(limiter.tryAcquire('tool_a', 5)).toBe(true);
    expect(limiter.tryAcquire('tool_a', 5)).toBe(true);
  });

  it('blocks requests exceeding the limit', () => {
    const limiter = new SlidingWindowRateLimiter();
    for (let i = 0; i < 3; i++) {
      limiter.tryAcquire('tool_b', 3);
    }
    expect(limiter.tryAcquire('tool_b', 3)).toBe(false);
  });

  it('tracks different keys independently', () => {
    const limiter = new SlidingWindowRateLimiter();
    for (let i = 0; i < 2; i++) {
      limiter.tryAcquire('tool_c', 2);
    }
    expect(limiter.tryAcquire('tool_c', 2)).toBe(false);
    expect(limiter.tryAcquire('tool_d', 2)).toBe(true);
  });
});
