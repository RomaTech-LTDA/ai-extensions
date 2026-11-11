import type { McpRequestHandler } from '../mcp/request-handler';
import type { McpOptions } from '../mcp/options';
import { assertMcpAuthConfigured, resolveMcpOptions } from '../mcp/options';
import { processMcpHttpRequest } from '../mcp/http-pipeline';

/**
 * Koa middleware that handles MCP protocol requests.
 * Requires authentication (`apiKey` and/or `authenticate`) unless `allowAnonymous: true`.
 *
 * @throws Error when neither `apiKey`, `authenticate` nor `allowAnonymous: true` is configured.
 *
 * @example
 * ```ts
 * import Koa from 'koa';
 * import bodyParser from 'koa-bodyparser';
 * import { createKoaMcpMiddleware } from '@romatech/ai-extensions/adapters';
 *
 * const app = new Koa();
 * app.use(bodyParser());
 * app.use(createKoaMcpMiddleware(handler, { route: '/mcp', apiKey: process.env.MCP_API_KEY }));
 * ```
 */
export function createKoaMcpMiddleware(
  handler: McpRequestHandler,
  options?: McpOptions,
) {
  assertMcpAuthConfigured(options);
  const opts = resolveMcpOptions(options);

  return async function mcpMiddleware(ctx: any, next: () => Promise<void>): Promise<void> {
    // Health endpoint
    if (ctx.path === `${opts.route}/health` && ctx.method === 'GET') {
      ctx.body = { status: 'ok', timestamp: new Date().toISOString() };
      return;
    }

    // Only handle MCP route
    if (ctx.path !== opts.route) {
      return next();
    }

    const outcome = await processMcpHttpRequest(
      handler,
      opts,
      { method: ctx.method, headers: ctx.headers, clientId: ctx.ip, raw: ctx },
      () => ctx.request.body,
    );
    ctx.set(outcome.headers);
    ctx.status = outcome.status;
    if (outcome.body !== undefined) ctx.body = outcome.body;
  };
}
