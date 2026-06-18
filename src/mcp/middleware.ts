import type { Request, Response, NextFunction } from 'express';
import type { McpRequest } from './protocol';
import { mcpFailure } from './protocol';
import type { McpRequestHandler } from './request-handler';
import type { McpOptions } from './options';
import { DEFAULT_MCP_OPTIONS } from './options';

/**
 * Creates an Express middleware that handles MCP protocol requests.
 * Supports authentication via API key and CORS headers.
 *
 * @example
 * ```ts
 * app.use(createMcpMiddleware(handler, {
 *   route: '/mcp',
 *   apiKey: process.env.MCP_API_KEY,
 *   cors: '*',
 * }));
 * ```
 */
export function createMcpMiddleware(
  handler: McpRequestHandler,
  options?: McpOptions,
): (req: Request, res: Response, next: NextFunction) => void {
  const opts = { ...DEFAULT_MCP_OPTIONS, ...options };
  const route = opts.route;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Only handle requests to the MCP route (and sub-routes for SSE)
    if (!req.path.startsWith(route)) {
      next();
      return;
    }

    // Health check endpoint (GET /mcp/health)
    if (req.path === `${route}/health` && req.method === 'GET') {
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
      return;
    }

    // CORS headers
    if (opts.cors) {
      const origin = Array.isArray(opts.cors) ? opts.cors.join(', ') : opts.cors;
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    }

    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }

    // Only exact route match for the main endpoint
    if (req.path !== route) {
      next();
      return;
    }

    if (req.method !== 'POST') {
      res.status(405).end();
      return;
    }

    // API key authentication
    if (opts.apiKey) {
      const auth = req.headers['authorization'] ?? '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      if (token !== opts.apiKey) {
        res.status(401).json(mcpFailure(null, -32000, 'Unauthorized: invalid or missing API key'));
        return;
      }
    }

    // Validate Content-Type
    const contentType = req.headers['content-type'] ?? '';
    if (!contentType.includes('application/json')) {
      res.status(415).json(mcpFailure(null, -32700, 'Content-Type must be application/json'));
      return;
    }

    let request: McpRequest;
    try {
      request = req.body as McpRequest;
      if (!request || !request.method) {
        // Check if body parser is missing
        if (req.body === undefined) {
          res.status(400).json(mcpFailure(null, -32700,
            'Request body is undefined. Did you forget app.use(express.json()) before useAi()?'));
          return;
        }
        res.status(400).json(mcpFailure(null, -32600, 'Invalid request'));
        return;
      }
    } catch {
      res.status(400).json(mcpFailure(null, -32700, 'Parse error'));
      return;
    }

    try {
      const response = await handler.handle(request);
      res.json(response);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json(mcpFailure(null, -32603, `Internal error: ${message}`));
    }
  };
}
