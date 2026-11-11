import type { McpRequest } from './protocol';
import { mcpFailure } from './protocol';
import type { McpRequestHandler } from './request-handler';
import type { McpOptions } from './options';
import { buildMcpCallContext, guardMcpHttpRequest, type McpAuthInput } from './http-guard';

/** Framework-neutral HTTP answer produced by `processMcpHttpRequest()`. */
export interface McpHttpOutcome {
  /** HTTP status: 200 (response), 202 (notification accepted, no body), 204 (preflight), or an error status. */
  status: number;
  /** Headers to set (CORS, `Allow`). */
  headers: Record<string, string>;
  /** JSON body to send; absent for 202 and 204. */
  body?: unknown;
}

/**
 * Runs one MCP HTTP request through the shared pipeline used by every adapter:
 * Origin / method / authentication / Content-Type checks, body validation, dispatch,
 * `202 Accepted` without a body for notifications, and a generic 500 that never leaks details.
 *
 * @param readBody - Returns the parsed JSON body. Return `undefined` when no body parser ran;
 *   throw when the body is not valid JSON.
 */
export async function processMcpHttpRequest(
  handler: McpRequestHandler,
  options: McpOptions,
  request: McpAuthInput,
  readBody: () => unknown,
): Promise<McpHttpOutcome> {
  const guard = await guardMcpHttpRequest(request, options);
  const headers = guard.headers;
  if (!guard.ok) {
    return { status: guard.status, headers, body: guard.body };
  }

  let body: unknown;
  try {
    body = await readBody();
  } catch {
    return { status: 400, headers, body: mcpFailure(null, -32700, 'Parse error') };
  }
  if (body === undefined) {
    return {
      status: 400,
      headers,
      body: mcpFailure(null, -32700, 'Request body is missing. Register a JSON body parser (e.g. express.json()) before the MCP route.'),
    };
  }
  if (!isMcpRequestShape(body)) {
    return { status: 400, headers, body: mcpFailure(null, -32600, 'Invalid request') };
  }

  try {
    const context = buildMcpCallContext(request.headers, request.clientId, options, guard.principal);
    const response = await handler.handle(body, context);
    if (response === null) return { status: 202, headers };
    return { status: 200, headers, body: response };
  } catch {
    return { status: 500, headers, body: mcpFailure(null, -32603, 'Internal error') };
  }
}

/** True for a JSON object with a string `method` (the minimum of a JSON-RPC request or notification). */
export function isMcpRequestShape(body: unknown): body is McpRequest {
  return typeof body === 'object' && body !== null && !Array.isArray(body)
    && typeof (body as { method?: unknown }).method === 'string' && (body as { method: string }).method !== '';
}
