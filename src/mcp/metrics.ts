/**
 * Tracks MCP tool usage metrics.
 */
export interface ToolMetrics {
  toolName: string;
  callCount: number;
  errorCount: number;
  totalDurationMs: number;
  avgDurationMs: number;
  lastCalledAt: number;
}

/**
 * Simple in-memory metrics collector for MCP tool usage.
 */
export class McpMetrics {
  private readonly _metrics = new Map<string, { calls: number; errors: number; totalMs: number; lastAt: number }>();

  /**
   * Records a successful tool call.
   */
  recordCall(toolName: string, durationMs: number): void {
    const entry = this._metrics.get(toolName) ?? { calls: 0, errors: 0, totalMs: 0, lastAt: 0 };
    entry.calls++;
    entry.totalMs += durationMs;
    entry.lastAt = Date.now();
    this._metrics.set(toolName, entry);
  }

  /**
   * Records a failed tool call.
   */
  recordError(toolName: string, durationMs: number): void {
    const entry = this._metrics.get(toolName) ?? { calls: 0, errors: 0, totalMs: 0, lastAt: 0 };
    entry.calls++;
    entry.errors++;
    entry.totalMs += durationMs;
    entry.lastAt = Date.now();
    this._metrics.set(toolName, entry);
  }

  /**
   * Returns metrics for all tools.
   */
  getAll(): ToolMetrics[] {
    return Array.from(this._metrics.entries()).map(([toolName, data]) => ({
      toolName,
      callCount: data.calls,
      errorCount: data.errors,
      totalDurationMs: data.totalMs,
      avgDurationMs: data.calls > 0 ? Math.round(data.totalMs / data.calls) : 0,
      lastCalledAt: data.lastAt,
    }));
  }

  /**
   * Returns metrics for a specific tool.
   */
  get(toolName: string): ToolMetrics | undefined {
    const data = this._metrics.get(toolName);
    if (!data) return undefined;
    return {
      toolName,
      callCount: data.calls,
      errorCount: data.errors,
      totalDurationMs: data.totalMs,
      avgDurationMs: data.calls > 0 ? Math.round(data.totalMs / data.calls) : 0,
      lastCalledAt: data.lastAt,
    };
  }

  /**
   * Resets all metrics.
   */
  reset(): void {
    this._metrics.clear();
  }
}
