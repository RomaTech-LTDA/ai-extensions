import type { McpRequest } from '../mcp/protocol';
import { mcpFailure } from '../mcp/protocol';
import type { McpRequestHandler } from '../mcp/request-handler';
import type { McpOptions } from '../mcp/options';
import { DEFAULT_MCP_OPTIONS } from '../mcp/options';

/**
 * Koa middleware that handles MCP protocol requests.
 *
 * @example
 * ```ts
 * import Koa from 'koa';
 * import bodyParser from 'koa-bodyparser';
 * import { createKoaMcpMiddleware } from '@romatech/ai-extensions/adapters/koa';
 *
 * const app = new Koa();
 * app.use(bodyParser());
 * app.use(createKoaMcpMiddleware(handler, { route: '/mcp' }));
 * ```
 */
export function createKoaMcpMiddleware(
  handler: McpRequestHandler,
  options?: McpOptions,
) {
  const opts = { ...DEFAULT_MCP_OPTIONS, ...options };

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

    if (ctx.method !== 'POST') {
      ctx.status = 405;
      return;
    }

    // API key auth
    if (opts.apiKey) {
      const auth = ctx.headers['authorization'] ?? '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      if (token !== opts.apiKey) {
        ctx.status = 401;
        ctx.body = mcpFailure(null, -32000, 'Unauthorized');
        return;
      }
    }

    // Content-Type check
    const contentType = ctx.headers['content-type'] ?? '';
    if (!contentType.includes('application/json')) {
      ctx.status = 415;
      ctx.body = mcpFailure(null, -32700, 'Content-Type must be application/json');
      return;
    }

    const body = ctx.request.body as McpRequest;
    if (!body || !body.method) {
      ctx.status = 400;
      ctx.body = mcpFailure(null, -32600, 'Invalid request');
      return;
    }

    try {
      ctx.body = await handler.handle(body);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      ctx.status = 500;
      ctx.body = mcpFailure(null, -32603, `Internal error: ${message}`);
    }
  };
}
