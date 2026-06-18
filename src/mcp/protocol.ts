/**
 * Incoming MCP JSON-RPC request.
 */
export interface McpRequest {
  jsonrpc: string;
  id?: string | number | null;
  method: string;
  params?: McpRequestParams;
}

/**
 * Parameters for an MCP request.
 */
export interface McpRequestParams {
  name?: string;
  arguments?: Record<string, unknown>;
  cursor?: string;
  uri?: string;
  /** For completions/complete — reference to what is being completed. */
  ref?: { type?: string; name?: string };
  /** For completions/complete — the argument being completed. */
  argument?: { name?: string; value?: string };
}

/**
 * Outgoing MCP JSON-RPC response.
 */
export interface McpResponse {
  jsonrpc: '2.0';
  id?: string | number | null;
  result?: unknown;
  error?: McpError;
}

/**
 * MCP error object.
 */
export interface McpError {
  code: number;
  message: string;
}

/**
 * MCP tool definition for tools/list response.
 */
export interface McpToolDefinition {
  name: string;
  description?: string;
  inputSchema?: object;
}

export function mcpSuccess(id: string | number | null | undefined, result: unknown): McpResponse {
  return { jsonrpc: '2.0', id, result };
}

export function mcpFailure(id: string | number | null | undefined, code: number, message: string): McpResponse {
  return { jsonrpc: '2.0', id, error: { code, message } };
}
