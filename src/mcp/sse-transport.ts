import type { Request, Response, NextFunction } from 'express';
import type { McpRequestHandler } from './request-handler';
import type { McpRequest } from './protocol';
import type { McpOptions } from './options';
import { DEFAULT_MCP_OPTIONS } from './options';

/**
 * Creates an Express middleware that handles MCP over Server-Sent Events (SSE).
 * Provides a persistent connection for streaming MCP responses.
 *
 * Routes:
 * - GET  {route}/sse  — Opens an SSE connection
 * - POST {route}/message — Sends a message over the SSE connection
 *
 * @example
 * ```ts
 * import { createSseTransport } from '@romatech/ai-extensions/mcp';
 *
 * app.use(createSseTransport(handler, { route: '/mcp' }));
 * ```
 */
export function createSseTransport(
  handler: McpRequestHandler,
  options?: McpOptions,
): (req: Request, res: Response, next: NextFunction) => void {
  const opts = { ...DEFAULT_MCP_OPTIONS, ...options };
  const route = opts.route;
  const sseRoute = `${route}/sse`;
  const messageRoute = `${route}/message`;

  // Store active SSE connections
  const connections = new Map<string, Response>();

  // Graceful shutdown: close all SSE connections
  const cleanup = () => {
    for (const [, res] of connections) {
      res.end();
    }
    connections.clear();
  };
  process.on('SIGTERM', cleanup);
  process.on('SIGINT', cleanup);

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // SSE connection endpoint
    if (req.path === sseRoute && req.method === 'GET') {
      // API key authentication for SSE
      if (opts.apiKey) {
        const auth = req.headers['authorization'] ?? '';
        const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
        if (token !== opts.apiKey) {
          res.status(401).json({ error: 'Unauthorized' });
          return;
        }
      }

      const sessionId = generateSessionId();

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Session-Id': sessionId,
      });

      // Send endpoint info
      res.write(`event: endpoint\ndata: ${messageRoute}?sessionId=${sessionId}\n\n`);

      connections.set(sessionId, res);

      // Heartbeat keep-alive (every 30s)
      const heartbeat = setInterval(() => {
        try {
          res.write(`: heartbeat\n\n`);
        } catch {
          clearInterval(heartbeat);
        }
      }, 30_000);

      req.on('close', () => {
        clearInterval(heartbeat);
        connections.delete(sessionId);
      });

      return;
    }

    // Message endpoint
    if (req.path === messageRoute && req.method === 'POST') {
      const sessionId = (req.query.sessionId as string) ?? '';
      const sseRes = connections.get(sessionId);

      if (!sseRes) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }

      try {
        const request = req.body as McpRequest;
        const response = await handler.handle(request);

        // Send response over SSE
        sseRes.write(`event: message\ndata: ${JSON.stringify(response)}\n\n`);

        res.status(202).json({ status: 'accepted' });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: message });
      }

      return;
    }

    next();
  };
}

function generateSessionId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
}
