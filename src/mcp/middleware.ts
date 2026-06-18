import type { Request, Response, NextFunction } from 'express';
import type { McpRequest } from './protocol';
import { mcpFailure } from './protocol';
import type { McpRequestHandler } from './request-handler';
import type { McpOptions } from './options';
import { DEFAULT_MCP_OPTIONS } from './options';

/**
 * Creates an Express middleware that handles MCP protocol requests.
 *
 * @example
 * ```ts
 * import { createMcpMiddleware } from '@romatech/ai-extensions/mcp';
 *
 * app.use(createMcpMiddleware(handler, { route: '/mcp' }));
 * ```
 */
export function createMcpMiddleware(
  handler: McpRequestHandler,
  options?: McpOptions,
): (req: Request, res: Response, next: NextFunction) => void {
  const route = options?.route ?? DEFAULT_MCP_OPTIONS.route;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (req.path !== route) {
      next();
      return;
    }

    if (req.method !== 'POST') {
      res.status(405).end();
      return;
    }

    let request: McpRequest;
    try {
      request = req.body as McpRequest;
      if (!request || !request.method) {
        res.status(400).json(mcpFailure(null, -32600, 'Invalid request'));
        return;
      }
    } catch {
      res.status(400).json(mcpFailure(null, -32700, 'Parse error'));
      return;
    }

    const response = await handler.handle(request);
    res.json(response);
  };
}
