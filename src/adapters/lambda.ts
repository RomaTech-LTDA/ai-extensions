import type { McpRequest } from '../mcp/protocol';
import { mcpFailure } from '../mcp/protocol';
import type { McpRequestHandler } from '../mcp/request-handler';
import type { McpOptions } from '../mcp/options';
import { DEFAULT_MCP_OPTIONS } from '../mcp/options';

/**
 * AWS Lambda event shape (API Gateway v2 / HTTP API).
 */
interface LambdaEvent {
  body?: string;
  headers?: Record<string, string>;
  requestContext?: { http?: { method?: string; path?: string } };
  rawPath?: string;
  httpMethod?: string;
  path?: string;
}

/**
 * AWS Lambda response shape.
 */
interface LambdaResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

/**
 * Creates an AWS Lambda handler for MCP protocol.
 * Works with API Gateway v1, v2, and Function URLs.
 *
 * @example
 * ```ts
 * // handler.ts
 * import { createLambdaMcpHandler, McpRequestHandler, ... } from '@romatech/ai-extensions';
 *
 * const handler = new McpRequestHandler(registry, executor, rateLimiter);
 * export const mcpHandler = createLambdaMcpHandler(handler);
 * ```
 *
 * Deploy with:
 * - AWS SAM
 * - Serverless Framework
 * - AWS CDK
 * - Terraform
 */
export function createLambdaMcpHandler(
  handler: McpRequestHandler,
  options?: McpOptions,
) {
  const opts = { ...DEFAULT_MCP_OPTIONS, ...options };

  return async (event: LambdaEvent): Promise<LambdaResponse> => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // CORS
    if (opts.cors) {
      const origin = Array.isArray(opts.cors) ? opts.cors.join(', ') : String(opts.cors);
      headers['Access-Control-Allow-Origin'] = origin;
      headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
      headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization';
    }

    // Handle preflight
    const method = event.requestContext?.http?.method ?? event.httpMethod ?? 'POST';
    if (method === 'OPTIONS') {
      return { statusCode: 204, headers, body: '' };
    }

    // Health check
    const path = event.rawPath ?? event.path ?? '';
    if (path.endsWith('/health') && method === 'GET') {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }),
      };
    }

    // Auth check
    if (opts.apiKey) {
      const auth = event.headers?.['authorization'] ?? event.headers?.['Authorization'] ?? '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      if (token !== opts.apiKey) {
        return {
          statusCode: 401,
          headers,
          body: JSON.stringify(mcpFailure(null, -32000, 'Unauthorized')),
        };
      }
    }

    // Parse body
    let request: McpRequest;
    try {
      request = JSON.parse(event.body ?? '{}');
      if (!request.method) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify(mcpFailure(null, -32600, 'Invalid request')),
        };
      }
    } catch {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify(mcpFailure(null, -32700, 'Parse error')),
      };
    }

    // Handle MCP request
    try {
      const response = await handler.handle(request);
      return { statusCode: 200, headers, body: JSON.stringify(response) };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify(mcpFailure(null, -32603, `Internal error: ${message}`)),
      };
    }
  };
}
