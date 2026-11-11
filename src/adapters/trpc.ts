import type { McpCallContext, McpRequest } from '../mcp/protocol';
import { mcpFailure } from '../mcp/protocol';
import type { McpRequestHandler } from '../mcp/request-handler';

/**
 * Creates a tRPC-compatible procedure handler for MCP.
 * tRPC owns transport and authentication: expose it only through an authenticated
 * (`protectedProcedure`-style) procedure. Pass a context built from your tRPC context
 * (e.g. `{ clientId: ctx.ip, principal: ctx.user, forwardHeaders: { authorization: ctx.authHeader } }`)
 * to forward credentials, rate-limit per client and let `resolveRoles` see the caller.
 * Returns `null` for notifications (messages without `id`).
 *
 * @example
 * ```ts
 * import { createTRPCMcpProcedure } from '@romatech/ai-extensions';
 * import { router, protectedProcedure } from './trpc';
 * import { z } from 'zod';
 *
 * const mcpProcedure = createTRPCMcpProcedure(handler);
 *
 * export const appRouter = router({
 *     mcp: protectedProcedure
 *         .input(z.object({ jsonrpc: z.string(), id: z.any(), method: z.string(), params: z.any().optional() }))
 *         .mutation(({ input, ctx }) => mcpProcedure(input, { clientId: ctx.ip, principal: ctx.user })),
 * });
 * ```
 */
export function createTRPCMcpProcedure(handler: McpRequestHandler) {
  return async (input: McpRequest, context?: McpCallContext) => {
    if (!input || !input.method) {
      return mcpFailure(null, -32600, 'Invalid request');
    }
    return handler.handle(input, context);
  };
}
