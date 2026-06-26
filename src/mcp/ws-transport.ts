import type { McpRequest, McpResponse } from './protocol';
import { mcpFailure } from './protocol';
import type { McpRequestHandler } from './request-handler';
import type { McpOptions } from './options';
import { DEFAULT_MCP_OPTIONS } from './options';

/**
 * WebSocket message handler for MCP protocol.
 * Framework-agnostic — works with ws, Socket.IO, uWebSockets, etc.
 *
 * @example
 * ```ts
 * // With 'ws' package
 * import { WebSocketServer } from 'ws';
 * import { createWsMcpHandler } from '@romatech/ai-extensions';
 *
 * const wss = new WebSocketServer({ port: 8080 });
 * const mcpWs = createWsMcpHandler(handler);
 *
 * wss.on('connection', (ws) => {
 *     ws.on('message', async (data) => {
 *         const response = await mcpWs.handleMessage(data.toString());
 *         ws.send(JSON.stringify(response));
 *     });
 * });
 * ```
 */
export function createWsMcpHandler(
  handler: McpRequestHandler,
  options?: McpOptions,
) {
  const opts = { ...DEFAULT_MCP_OPTIONS, ...options };

  return {
    /**
     * Handles a raw WebSocket message string.
     * Parses as JSON, validates, and returns the MCP response.
     */
    async handleMessage(rawMessage: string): Promise<McpResponse> {
      let request: McpRequest;
      try {
        request = JSON.parse(rawMessage);
      } catch {
        return mcpFailure(null, -32700, 'Parse error');
      }

      if (!request || !request.method) {
        return mcpFailure(null, -32600, 'Invalid request');
      }

      // Auth via first message pattern (optional)
      // Normally WebSocket auth is done at connection time

      return handler.handle(request);
    },

    /**
     * Returns server info for the initial connection handshake.
     */
    getServerInfo(): object {
      return {
        protocolVersion: '2024-11-05',
        serverInfo: { name: opts.serverName, version: opts.serverVersion },
      };
    },
  };
}
