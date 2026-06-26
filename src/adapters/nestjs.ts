import type { McpRequest } from '../mcp/protocol';
import { mcpFailure } from '../mcp/protocol';
import type { McpRequestHandler } from '../mcp/request-handler';
import type { McpOptions } from '../mcp/options';
import { DEFAULT_MCP_OPTIONS } from '../mcp/options';

/**
 * Creates a NestJS-compatible controller class for MCP.
 * Use this in a NestJS module to expose the MCP endpoint.
 *
 * @example
 * ```ts
 * // mcp.controller.ts
 * import { Controller, Post, Get, Body, Headers } from '@nestjs/common';
 * import { createNestMcpController } from '@romatech/ai-extensions';
 *
 * const mcpLogic = createNestMcpController(handler, { apiKey: 'secret' });
 *
 * @Controller('mcp')
 * export class McpController {
 *     @Post()
 *     handleMcp(@Body() body: any, @Headers('authorization') auth: string) {
 *         return mcpLogic.handlePost(body, auth);
 *     }
 *
 *     @Get('health')
 *     health() { return mcpLogic.health(); }
 * }
 * ```
 */
export function createNestMcpController(
  handler: McpRequestHandler,
  options?: McpOptions,
) {
  const opts = { ...DEFAULT_MCP_OPTIONS, ...options };

  return {
    async handlePost(body: McpRequest, authorization?: string) {
      // Auth
      if (opts.apiKey) {
        const token = (authorization ?? '').startsWith('Bearer ')
          ? (authorization ?? '').slice(7) : '';
        if (token !== opts.apiKey) {
          return mcpFailure(null, -32000, 'Unauthorized');
        }
      }

      if (!body || !body.method) {
        return mcpFailure(null, -32600, 'Invalid request');
      }

      return handler.handle(body);
    },

    health() {
      return { status: 'ok', timestamp: new Date().toISOString() };
    },
  };
}
