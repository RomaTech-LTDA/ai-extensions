import type { McpRequestHandler } from '../mcp/request-handler';
import type { McpOptions } from '../mcp/options';
import { assertMcpAuthConfigured, resolveMcpOptions } from '../mcp/options';
import { processMcpHttpRequest } from '../mcp/http-pipeline';

/**
 * Fastify plugin that handles MCP protocol requests.
 * Requires authentication (`apiKey` and/or `authenticate`) unless `allowAnonymous: true`.
 *
 * @throws Error when neither `apiKey`, `authenticate` nor `allowAnonymous: true` is configured.
 *
 * @example
 * ```ts
 * import Fastify from 'fastify';
 * import { createFastifyMcpPlugin } from '@romatech/ai-extensions/adapters';
 *
 * const fastify = Fastify();
 * fastify.register(createFastifyMcpPlugin(handler, { route: '/mcp', apiKey: process.env.MCP_API_KEY }));
 * ```
 */
export function createFastifyMcpPlugin(
  handler: McpRequestHandler,
  options?: McpOptions,
) {
  assertMcpAuthConfigured(options);
  const opts = resolveMcpOptions(options);

  return async function mcpPlugin(fastify: any) {
    registerFastifyMcpRoutes(fastify, handler, opts);
  };
}

/** Registers the health, preflight and MCP routes on a Fastify instance. */
export function registerFastifyMcpRoutes(fastify: any, handler: McpRequestHandler, opts: McpOptions): void {
  const route = opts.route ?? '/mcp';

  fastify.get(`${route}/health`, async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

  const answer = async (request: any, reply: any) => {
    const outcome = await processMcpHttpRequest(
      handler,
      opts,
      { method: request.method, headers: request.headers, clientId: request.ip, raw: request },
      () => request.body,
    );
    reply.headers(outcome.headers);
    reply.status(outcome.status);
    return outcome.body === undefined ? reply.send() : reply.send(outcome.body);
  };

  // CORS preflight (only answered when allowed by the Origin check)
  fastify.options?.(route, answer);
  fastify.post(route, answer);
}
