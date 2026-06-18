import type { McpRequest } from '../mcp/protocol';
import { mcpFailure } from '../mcp/protocol';
import type { McpRequestHandler } from '../mcp/request-handler';
import type { McpOptions } from '../mcp/options';
import { DEFAULT_MCP_OPTIONS } from '../mcp/options';

/**
 * Fastify plugin that handles MCP protocol requests.
 *
 * @example
 * ```ts
 * import Fastify from 'fastify';
 * import { createFastifyMcpPlugin } from '@romatech/ai-extensions/adapters/fastify';
 *
 * const fastify = Fastify();
 * fastify.register(createFastifyMcpPlugin(handler, { route: '/mcp' }));
 * ```
 */
export function createFastifyMcpPlugin(
  handler: McpRequestHandler,
  options?: McpOptions,
) {
  const opts = { ...DEFAULT_MCP_OPTIONS, ...options };

  return async function mcpPlugin(fastify: any) {
    // Health endpoint
    fastify.get(`${opts.route}/health`, async () => {
      return { status: 'ok', timestamp: new Date().toISOString() };
    });

    // MCP endpoint
    fastify.post(opts.route, async (request: any, reply: any) => {
      // API key auth
      if (opts.apiKey) {
        const auth = request.headers['authorization'] ?? '';
        const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
        if (token !== opts.apiKey) {
          return reply.status(401).send(mcpFailure(null, -32000, 'Unauthorized'));
        }
      }

      // Content-Type check
      const contentType = request.headers['content-type'] ?? '';
      if (!contentType.includes('application/json')) {
        return reply.status(415).send(mcpFailure(null, -32700, 'Content-Type must be application/json'));
      }

      const body = request.body as McpRequest;
      if (!body || !body.method) {
        return reply.status(400).send(mcpFailure(null, -32600, 'Invalid request'));
      }

      try {
        const response = await handler.handle(body);
        return response;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.status(500).send(mcpFailure(null, -32603, `Internal error: ${message}`));
      }
    });
  };
}
