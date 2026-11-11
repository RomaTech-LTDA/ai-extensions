import type { McpRequestHandler } from '../mcp/request-handler';
import type { McpOptions } from '../mcp/options';
import { assertMcpAuthConfigured, resolveMcpOptions } from '../mcp/options';
import { processMcpHttpRequest } from '../mcp/http-pipeline';

/**
 * Creates a Next.js API route handler for MCP protocol (Pages Router, `req`/`res`).
 * Requires authentication (`apiKey` and/or `authenticate`) unless `allowAnonymous: true`.
 *
 * @throws Error when neither `apiKey`, `authenticate` nor `allowAnonymous: true` is configured.
 *
 * @example
 * ```ts
 * // pages/api/mcp.ts (Pages Router)
 * import { createNextjsMcpHandler } from '@romatech/ai-extensions';
 * export default createNextjsMcpHandler(handler, { apiKey: process.env.MCP_API_KEY });
 * ```
 */
export function createNextjsMcpHandler(
  handler: McpRequestHandler,
  options?: McpOptions,
) {
  assertMcpAuthConfigured(options);
  const opts = resolveMcpOptions(options);

  return async (req: any, res: any): Promise<void> => {
    if (req.method === 'GET') {
      res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
      return;
    }

    const outcome = await processMcpHttpRequest(
      handler,
      opts,
      { method: req.method, headers: req.headers, clientId: req.socket?.remoteAddress, raw: req },
      () => req.body,
    );
    for (const [name, value] of Object.entries(outcome.headers)) {
      res.setHeader(name, value);
    }
    if (outcome.body === undefined) {
      res.status(outcome.status).end();
    } else {
      res.status(outcome.status).json(outcome.body);
    }
  };
}

/**
 * Creates Next.js App Router handlers for MCP.
 * Requires authentication (`apiKey` and/or `authenticate`) unless `allowAnonymous: true`.
 *
 * @throws Error when neither `apiKey`, `authenticate` nor `allowAnonymous: true` is configured.
 *
 * @example
 * ```ts
 * // app/api/mcp/route.ts
 * import { createNextjsAppMcpHandler } from '@romatech/ai-extensions';
 * const { POST, GET, OPTIONS } = createNextjsAppMcpHandler(handler, { apiKey: process.env.MCP_API_KEY });
 * export { POST, GET, OPTIONS };
 * ```
 */
export function createNextjsAppMcpHandler(
  handler: McpRequestHandler,
  options?: McpOptions,
) {
  assertMcpAuthConfigured(options);
  const opts = resolveMcpOptions(options);

  const answer = async (request: Request, method: string): Promise<Response> => {
    // The client address is not available on a standard Request; every caller shares one
    // rate-limit bucket unless your `authenticate` hook or route derives one.
    const outcome = await processMcpHttpRequest(
      handler,
      opts,
      { method, headers: request.headers, raw: request },
      () => request.json(),
    );
    return outcome.body === undefined
      ? new Response(null, { status: outcome.status, headers: outcome.headers })
      : Response.json(outcome.body, { status: outcome.status, headers: outcome.headers });
  };

  const POST = (request: Request): Promise<Response> => answer(request, 'POST');
  const OPTIONS = (request: Request): Promise<Response> => answer(request, 'OPTIONS');
  const GET = async (): Promise<Response> => Response.json({ status: 'ok', timestamp: new Date().toISOString() });

  return { POST, GET, OPTIONS };
}
