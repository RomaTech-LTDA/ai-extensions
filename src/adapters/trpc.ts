import type { McpRequest } from '../mcp/protocol';
import { mcpFailure } from '../mcp/protocol';
import type { McpRequestHandler } from '../mcp/request-handler';

/**
 * Creates a tRPC-compatible procedure handler for MCP.
 *
 * @example
 * ```ts
 * import { createTRPCMcpProcedure } from '@romatech/ai-extensions';
 * import { router, publicProcedure } from './trpc';
 * import { z } from 'zod';
 *
 * const mcpProcedure = createTRPCMcpProcedure(handler);
 *
 * export const appRouter = router({
 *     mcp: publicProcedure
 *         .input(z.object({ jsonrpc: z.string(), id: z.any(), method: z.string(), params: z.any().optional() }))
 *         .mutation(({ input }) => mcpProcedure(input)),
 * });
 * ```
 */
export function createTRPCMcpProcedure(handler: McpRequestHandler) {
  return async (input: McpRequest) => {
    if (!input || !input.method) {
      return mcpFailure(null, -32600, 'Invalid request');
    }
    return handler.handle(input);
  };
}
