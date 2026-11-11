import type { McpRequestHandler } from '../mcp/request-handler';
import type { McpOptions } from '../mcp/options';
import { assertMcpAuthConfigured, resolveMcpOptions } from '../mcp/options';
import type { McpHeaderSource } from '../mcp/http-guard';
import { processMcpHttpRequest } from '../mcp/http-pipeline';

/** The parts of the NestJS (Express or Fastify) request the MCP controller needs. */
export interface NestMcpRequestLike {
  headers: McpHeaderSource;
  ip?: string;
  method?: string;
}

/** Optional NestJS response (`@Res({ passthrough: true })`) used to set the HTTP status and headers. */
export interface NestMcpResponseLike {
  status?(code: number): unknown;
  code?(code: number): unknown;
  setHeader?(name: string, value: string): unknown;
  header?(name: string, value: string): unknown;
}

/**
 * Creates a NestJS-compatible controller logic for MCP.
 *
 * `handlePost(body, req, res?)` always runs the Origin, authentication and Content-Type checks,
 * so the incoming request is **required** (NestJS also parses urlencoded forms, which would
 * otherwise allow cross-site form posts). Pass the response with `@Res({ passthrough: true })`
 * to get the real HTTP status (401, 403, 415, 202...); without it only the JSON-RPC body is returned.
 *
 * @throws Error when neither `apiKey`, `authenticate` nor `allowAnonymous: true` is configured.
 *
 * @example
 * ```ts
 * // mcp.controller.ts
 * import { Controller, Post, Get, Body, Req, Res } from '@nestjs/common';
 * import { createNestMcpController } from '@romatech/ai-extensions';
 *
 * const mcpLogic = createNestMcpController(handler, { apiKey: process.env.MCP_API_KEY });
 *
 * @Controller('mcp')
 * export class McpController {
 *     @Post()
 *     handleMcp(@Body() body: any, @Req() req: any, @Res({ passthrough: true }) res: any) {
 *         return mcpLogic.handlePost(body, req, res);
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
  assertMcpAuthConfigured(options);
  const opts = resolveMcpOptions(options);

  return {
    /**
     * @throws TypeError when `req` (with its headers) is not passed: the checks cannot run without it.
     */
    async handlePost(body: unknown, req: NestMcpRequestLike, res?: NestMcpResponseLike): Promise<unknown> {
      if (!req || typeof req !== 'object' || !req.headers) {
        throw new TypeError('createNestMcpController().handlePost(body, req, res?) requires the incoming request (@Req()).');
      }

      const outcome = await processMcpHttpRequest(
        handler,
        opts,
        { method: req.method ?? 'POST', headers: req.headers, clientId: req.ip, raw: req },
        () => body,
      );

      if (res) {
        if (typeof res.status === 'function') res.status(outcome.status);
        else if (typeof res.code === 'function') res.code(outcome.status);
        for (const [name, value] of Object.entries(outcome.headers)) {
          if (typeof res.setHeader === 'function') res.setHeader(name, value);
          else if (typeof res.header === 'function') res.header(name, value);
        }
      }
      return outcome.body;
    },

    health() {
      return { status: 'ok', timestamp: new Date().toISOString() };
    },
  };
}
