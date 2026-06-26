import type { McpRequest } from '../mcp/protocol';
import { mcpFailure } from '../mcp/protocol';
import type { McpRequestHandler } from '../mcp/request-handler';
import type { McpOptions } from '../mcp/options';
import { DEFAULT_MCP_OPTIONS } from '../mcp/options';

/**
 * Creates a Next.js API route handler for MCP protocol.
 * Works with both Pages Router (req/res) and App Router (Request/Response).
 *
 * @example
 * ```ts
 * // pages/api/mcp.ts (Pages Router)
 * import { createNextjsMcpHandler } from '@romatech/ai-extensions';
 * export default createNextjsMcpHandler(handler);
 *
 * // app/api/mcp/route.ts (App Router)
 * import { createNextjsAppMcpHandler } from '@romatech/ai-extensions';
 * const { POST, GET } = createNextjsAppMcpHandler(handler);
 * export { POST, GET };
 * ```
 */
export function createNextjsMcpHandler(
  handler: McpRequestHandler,
  options?: McpOptions,
) {
  const opts = { ...DEFAULT_MCP_OPTIONS, ...options };

  return async (req: any, res: any): Promise<void> => {
    // CORS
    if (opts.cors) {
      const origin = Array.isArray(opts.cors) ? opts.cors.join(', ') : String(opts.cors);
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    }

    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }

    if (req.method === 'GET') {
      res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
      return;
    }

    if (req.method !== 'POST') {
      res.status(405).end();
      return;
    }

    // Auth
    if (opts.apiKey) {
      const auth = req.headers['authorization'] ?? '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      if (token !== opts.apiKey) {
        res.status(401).json(mcpFailure(null, -32000, 'Unauthorized'));
        return;
      }
    }

    const body = req.body as McpRequest;
    if (!body || !body.method) {
      res.status(400).json(mcpFailure(null, -32600, 'Invalid request'));
      return;
    }

    try {
      const response = await handler.handle(body);
      res.status(200).json(response);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json(mcpFailure(null, -32603, `Internal error: ${message}`));
    }
  };
}

/**
 * Creates Next.js App Router handlers for MCP.
 *
 * @example
 * ```ts
 * // app/api/mcp/route.ts
 * import { createNextjsAppMcpHandler } from '@romatech/ai-extensions';
 * const { POST, GET } = createNextjsAppMcpHandler(handler);
 * export { POST, GET };
 * ```
 */
export function createNextjsAppMcpHandler(
  handler: McpRequestHandler,
  options?: McpOptions,
) {
  const opts = { ...DEFAULT_MCP_OPTIONS, ...options };

  const POST = async (request: Request): Promise<Response> => {
    // Auth
    if (opts.apiKey) {
      const auth = request.headers.get('authorization') ?? '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      if (token !== opts.apiKey) {
        return Response.json(mcpFailure(null, -32000, 'Unauthorized'), { status: 401 });
      }
    }

    let body: McpRequest;
    try {
      body = await request.json();
      if (!body.method) {
        return Response.json(mcpFailure(null, -32600, 'Invalid request'), { status: 400 });
      }
    } catch {
      return Response.json(mcpFailure(null, -32700, 'Parse error'), { status: 400 });
    }

    try {
      const response = await handler.handle(body);
      return Response.json(response);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return Response.json(mcpFailure(null, -32603, message), { status: 500 });
    }
  };

  const GET = async (): Promise<Response> => {
    return Response.json({ status: 'ok', timestamp: new Date().toISOString() });
  };

  return { POST, GET };
}
