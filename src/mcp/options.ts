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
}

export const DEFAULT_MCP_OPTIONS: Required<McpOptions> = {
  route: '/mcp',
  enableRateLimiting: true,
  globalRateLimitPerMinute: 60,
  serverName: '@romatech/ai-extensions',
  serverVersion: '1.0.0',
};
