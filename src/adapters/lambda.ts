import type { McpRequestHandler } from '../mcp/request-handler';
import type { McpOptions } from '../mcp/options';
import { assertMcpAuthConfigured, resolveMcpOptions } from '../mcp/options';
import { processMcpHttpRequest } from '../mcp/http-pipeline';

/**
 * AWS Lambda event shape (API Gateway v2 / HTTP API).
 */
interface LambdaEvent {
  body?: string;
  isBase64Encoded?: boolean;
  headers?: Record<string, string>;
  requestContext?: {
    http?: { method?: string; path?: string; sourceIp?: string };
    identity?: { sourceIp?: string };
  };
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
 * Requires authentication (`apiKey` and/or `authenticate`) unless `allowAnonymous: true`.
 *
 * @throws Error when neither `apiKey`, `authenticate` nor `allowAnonymous: true` is configured.
 *
 * @example
 * ```ts
 * // handler.ts
 * import { createLambdaMcpHandler, McpRequestHandler, ... } from '@romatech/ai-extensions';
 *
 * const handler = new McpRequestHandler(registry, executor, rateLimiter);
 * export const mcpHandler = createLambdaMcpHandler(handler, { apiKey: process.env.MCP_API_KEY });
 * ```
 */
export function createLambdaMcpHandler(
  handler: McpRequestHandler,
  options?: McpOptions,
) {
  assertMcpAuthConfigured(options);
  const opts = resolveMcpOptions(options);

  return async (event: LambdaEvent): Promise<LambdaResponse> => {
    const method = event.requestContext?.http?.method ?? event.httpMethod ?? 'POST';

    // Health check
    const path = event.rawPath ?? event.path ?? '';
    if (path.endsWith('/health') && method === 'GET') {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }),
      };
    }

    const clientId = event.requestContext?.http?.sourceIp ?? event.requestContext?.identity?.sourceIp;
    const outcome = await processMcpHttpRequest(
      handler,
      opts,
      { method, headers: event.headers, clientId, raw: event },
      () => {
        const raw = event.isBase64Encoded && event.body
          ? Buffer.from(event.body, 'base64').toString('utf8')
          : event.body ?? '';
        return JSON.parse(raw);
      },
    );

    const headers: Record<string, string> = { ...outcome.headers };
    if (outcome.body !== undefined) headers['Content-Type'] = 'application/json';
    return {
      statusCode: outcome.status,
      headers,
      body: outcome.body === undefined ? '' : JSON.stringify(outcome.body),
    };
  };
}
