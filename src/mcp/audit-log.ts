/**
 * A single audit log entry for a tool execution.
 */
export interface AuditEntry {
  timestamp: number;
  toolName: string;
  method: string;
  arguments?: Record<string, unknown>;
  durationMs: number;
  success: boolean;
  error?: string;
  /** Client identifier (from API key or IP). */
  clientId?: string;
}

/**
 * Audit log for MCP tool executions.
 * Records all tool calls for compliance, debugging, and analytics.
 *
 * @example
 * ```ts
 * const { auditLog } = useAi(app);
 *
 * // Query recent entries
 * const recent = auditLog.getRecent(50);
 *
 * // Filter by tool
 * const orderCalls = auditLog.getByTool('create_order');
 *
 * // Export for external systems
 * const entries = auditLog.getAll();
 * await sendToSIEM(entries);
 * ```
 */
export class McpAuditLog {
  private readonly _entries: AuditEntry[] = [];
  private readonly _maxEntries: number;

  constructor(maxEntries = 10_000) {
    this._maxEntries = maxEntries;
  }

  /**
   * Records a tool execution.
   */
  record(entry: Omit<AuditEntry, 'timestamp'>): void {
    this._entries.push({ ...entry, timestamp: Date.now() });

    // Evict oldest entries if over limit
    if (this._entries.length > this._maxEntries) {
      this._entries.splice(0, this._entries.length - this._maxEntries);
    }
  }

  /**
   * Returns the N most recent entries.
   */
  getRecent(count = 100): AuditEntry[] {
    return this._entries.slice(-count).reverse();
  }

  /**
   * Returns entries for a specific tool.
   */
  getByTool(toolName: string, count = 100): AuditEntry[] {
    return this._entries
      .filter(e => e.toolName === toolName)
      .slice(-count)
      .reverse();
  }

  /**
   * Returns all entries.
   */
  getAll(): AuditEntry[] {
    return [...this._entries];
  }

  /**
   * Returns entries within a time range.
   */
  getByTimeRange(fromMs: number, toMs: number): AuditEntry[] {
    return this._entries.filter(e => e.timestamp >= fromMs && e.timestamp <= toMs);
  }

  /**
   * Clears all entries.
   */
  clear(): void {
    this._entries.length = 0;
  }

  /** Total number of entries. */
  get count(): number {
    return this._entries.length;
  }
}
