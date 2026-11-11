/**
 * A single audit log entry for a tool execution.
 */
export interface AuditEntry {
  timestamp: number;
  toolName: string;
  /** MCP method: `tools/call` or `resources/read`. */
  method: string;
  /** Tool arguments; only recorded when the log was created with `includeArguments: true`. */
  arguments?: Record<string, unknown>;
  durationMs: number;
  success: boolean;
  /** Server-side error message (never sent to the MCP client). */
  error?: string;
  /** Client identifier (normally the caller IP address). */
  clientId?: string;
}

/** Options for `McpAuditLog`. */
export interface McpAuditLogOptions {
  /** Maximum number of entries kept in memory; the oldest are dropped. Default: 10000 */
  maxEntries?: number;
  /**
   * Whether to store the tool arguments in each entry. They can contain personal data or
   * secrets, so they are left out by default. Default: false
   */
  includeArguments?: boolean;
}

/**
 * In-memory audit log for MCP tool executions (bounded; entries are lost on restart).
 * `useAi()` creates one and attaches it to the MCP handler, so every executed `tools/call`
 * (including `rag_search`) and `resources/read` is recorded. Export the entries to durable
 * storage yourself if you need them for compliance.
 *
 * @example
 * ```ts
 * const { auditLog } = useAi(app, { mcp: { apiKey: process.env.MCP_API_KEY } });
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
  private readonly _includeArguments: boolean;

  /** @param options - Options, or the maximum number of entries (legacy signature). */
  constructor(options: number | McpAuditLogOptions = {}) {
    const resolved = typeof options === 'number' ? { maxEntries: options } : options;
    this._maxEntries = Math.max(1, resolved.maxEntries ?? 10_000);
    this._includeArguments = resolved.includeArguments === true;
  }

  /**
   * Records a tool execution. Arguments are dropped unless `includeArguments` is enabled.
   */
  record(entry: Omit<AuditEntry, 'timestamp'>): void {
    const { arguments: args, ...rest } = entry;
    const stored: AuditEntry = { ...rest, timestamp: Date.now() };
    if (this._includeArguments && args !== undefined) stored.arguments = args;
    this._entries.push(stored);

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
