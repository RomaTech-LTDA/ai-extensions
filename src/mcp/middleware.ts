import type { Request, Response, NextFunction } from 'express';
import type { McpRequestHandler } from './request-handler';
import type { McpOptions } from './options';
import { assertMcpAuthConfigured, resolveMcpOptions } from './options';
import { processMcpHttpRequest, type McpHttpOutcome } from './http-pipeline';

/**
 * Creates an Express middleware that handles MCP protocol requests.
 * Requires authentication (`apiKey` and/or `authenticate`) unless `allowAnonymous: true`;
 * validates Origin and Content-Type and sets CORS headers.
 *
 * @throws Error when neither `apiKey`, `authenticate` nor `allowAnonymous: true` is configured.
 *
 * @example
 * ```ts
 * app.use(express.json());
 * app.use(createMcpMiddleware(handler, {
 *   route: '/mcp',
 *   apiKey: process.env.MCP_API_KEY,
 *   cors: ['https://admin.example.com'],
 * }));
 * ```
 */
export function createMcpMiddleware(
  handler: McpRequestHandler,
  options?: McpOptions,
): (req: Request, res: Response, next: NextFunction) => void {
  assertMcpAuthConfigured(options);
  const opts = resolveMcpOptions(options);
  const route = opts.route;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Only handle the MCP route and its sub-routes (not every path sharing the prefix)
    if (req.path !== route && !req.path.startsWith(`${route}/`)) {
      next();
      return;
    }

    // Health check endpoint (GET /mcp/health)
    if (req.path === `${route}/health` && req.method === 'GET') {
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
      return;
    }

    // Only exact route match for the main endpoint
    if (req.path !== route) {
      next();
      return;
    }

    const outcome = await processMcpHttpRequest(
      handler,
      opts,
      { method: req.method, headers: req.headers, clientId: req.ip, raw: req },
      () => req.body,
    );
    sendExpressOutcome(res, outcome);
  };
}

/** Writes a pipeline outcome to an Express/Node-style response. */
export function sendExpressOutcome(res: Response, outcome: McpHttpOutcome): void {
  for (const [name, value] of Object.entries(outcome.headers)) {
    res.setHeader(name, value);
  }
  if (outcome.body === undefined) {
    res.status(outcome.status).end();
  } else {
    res.status(outcome.status).json(outcome.body);
  }
}
