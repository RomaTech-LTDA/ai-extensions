/**
 * Configuration options for the MCP layer.
 */
export interface McpOptions {
  /** The route for the MCP endpoint. Default: /mcp */
  route?: string;
  /** Whether to enable rate limiting on MCP tool calls. Default: true */
  enableRateLimiting?: boolean;
  /** Global rate limit (requests per minute) if no per-tool limit is set. Default: 60 */
  globalRateLimitPerMinute?: number;
  /** Server name reported in MCP initialize response. */
  serverName?: string;
  /** Server version reported in MCP initialize response. */
  serverVersion?: string;
  /** API key for MCP endpoint authentication. If set, requests must include `Authorization: Bearer <key>`. */
  apiKey?: string;
  /** Whether to forward the incoming Authorization header to tool execution requests. Default: false */
  forwardAuthorization?: boolean;
  /** CORS allowed origins. Set to '*' for all, or an array of origins. Default: undefined (no CORS headers). */
  cors?: string | string[];
  /** Timeout in ms for tool execution. Default: 30000 */
  toolTimeoutMs?: number;
  /**
   * Dry-run mode. When enabled, tools/call validates everything but does NOT execute.
   * Returns what would be called without side effects. Useful for testing.
   * Default: false
   */
  dryRun?: boolean;
}

export const DEFAULT_MCP_OPTIONS: Required<McpOptions> = {
  route: '/mcp',
  enableRateLimiting: true,
  globalRateLimitPerMinute: 60,
  serverName: '@romatech/ai-extensions',
  serverVersion: '2.0.0',
  apiKey: '',
  forwardAuthorization: false,
  cors: '' as any,
  toolTimeoutMs: 30_000,
  dryRun: false,
};
