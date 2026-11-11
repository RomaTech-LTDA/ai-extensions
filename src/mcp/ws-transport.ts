import type { McpCallContext, McpRequest, McpResponse } from './protocol';
import { mcpFailure } from './protocol';
import type { McpRequestHandler } from './request-handler';
import type { McpOptions } from './options';
import { assertMcpAuthConfigured, resolveMcpOptions } from './options';
import { authenticateMcpRequest, buildMcpCallContext, getHeader, isOriginAllowed, type McpHeaderSource } from './http-guard';

/** The parts of an HTTP upgrade request the WebSocket transport needs (Node `IncomingMessage`). */
export interface McpUpgradeRequest {
  headers: McpHeaderSource;
  method?: string;
  socket?: { remoteAddress?: string };
}

/** Outcome of `authenticateUpgrade()`. */
export type McpUpgradeResult =
  | { ok: true; context: McpCallContext }
  | { ok: false; status: 401 | 403; message: string };

/**
 * WebSocket message handler for MCP protocol.
 * Framework-agnostic — works with ws, Socket.IO, uWebSockets, etc.
 *
 * Secure by default: authenticate every connection at upgrade time with `verifyClient`
 * (for the `ws` package) or `authenticateUpgrade(req)` (any server). It checks the `Origin`
 * header (cross-site WebSocket hijacking) and `apiKey` / `authenticate`. `handleMessage()` only
 * accepts the context produced by a successful upgrade check, unless the endpoint is
 * anonymous (`allowAnonymous: true` without `apiKey` or `authenticate`).
 *
 * @throws Error when neither `apiKey`, `authenticate` nor `allowAnonymous: true` is configured.
 *
 * @example
 * ```ts
 * import { WebSocketServer } from 'ws';
 * import { createWsMcpHandler } from '@romatech/ai-extensions';
 *
 * const mcpWs = createWsMcpHandler(handler, { apiKey: process.env.MCP_API_KEY });
 * const wss = new WebSocketServer({ port: 8080, verifyClient: mcpWs.verifyClient });
 *
 * wss.on('connection', (ws, req) => {
 *     const context = mcpWs.getContext(req);
 *     ws.on('message', async (data) => {
 *         const response = await mcpWs.handleMessage(data.toString(), context);
 *         if (response) ws.send(JSON.stringify(response));
 *     });
 * });
 * ```
 */
export function createWsMcpHandler(
  handler: McpRequestHandler,
  options?: McpOptions,
) {
  assertMcpAuthConfigured(options);
  const opts = resolveMcpOptions(options);
  const authenticated = new WeakSet<McpCallContext>();
  const contexts = new WeakMap<object, McpCallContext>();
  // Like the HTTP adapters, a configured apiKey/authenticate is enforced even when
  // allowAnonymous is also set: only a fully anonymous endpoint skips the upgrade context.
  const anonymousEndpoint = opts.allowAnonymous === true && !opts.apiKey && typeof opts.authenticate !== 'function';

  async function authenticateUpgrade(req: McpUpgradeRequest): Promise<McpUpgradeResult> {
    if (!req || !req.headers) return { ok: false, status: 401, message: 'Unauthorized' };
    if (!isOriginAllowed(getHeader(req.headers, 'origin'), opts)) {
      return { ok: false, status: 403, message: 'Forbidden: origin not allowed' };
    }
    const clientId = req.socket?.remoteAddress;
    const auth = await authenticateMcpRequest({ method: req.method ?? 'GET', headers: req.headers, clientId, raw: req }, opts);
    if (!auth.ok) return { ok: false, status: 401, message: auth.message };
    const context = buildMcpCallContext(req.headers, clientId, opts, auth.principal);
    authenticated.add(context);
    contexts.set(req, context);
    return { ok: true, context };
  }

  return {
    /**
     * Checks an upgrade request: Origin (403) and authentication (401). On success the returned
     * context must be passed to `handleMessage()` for every message of that connection.
     */
    authenticateUpgrade,

    /**
     * `verifyClient` callback for the `ws` package (`new WebSocketServer({ verifyClient })`).
     * Rejects the handshake with 401/403; on success use `getContext(req)` in the `connection` handler.
     */
    verifyClient(
      info: { origin?: string; req: McpUpgradeRequest; secure?: boolean },
      callback: (result: boolean, code?: number, message?: string) => void,
    ): void {
      authenticateUpgrade(info.req).then(
        (result) => (result.ok ? callback(true) : callback(false, result.status, result.message)),
        () => callback(false, 401, 'Unauthorized'),
      );
    },

    /** The context of an upgrade request accepted by `verifyClient` / `authenticateUpgrade`. */
    getContext(req: object): McpCallContext | undefined {
      return contexts.get(req);
    },

    /**
     * Handles a raw WebSocket message string.
     * Parses as JSON, validates, and returns the MCP response, or `null` for a notification
     * (send nothing back in that case).
     *
     * @param context - The context returned by `authenticateUpgrade()` / `getContext()` for this
     *   connection. Without it the message is rejected, unless the endpoint is anonymous
     *   (`allowAnonymous: true` with neither `apiKey` nor `authenticate`).
     */
    async handleMessage(rawMessage: string, context?: McpCallContext): Promise<McpResponse | null> {
      if (!(context && authenticated.has(context)) && !anonymousEndpoint) {
        return mcpFailure(null, -32001, 'Unauthorized: authenticate the WebSocket upgrade first');
      }

      let request: McpRequest;
      try {
        request = JSON.parse(rawMessage);
      } catch {
        return mcpFailure(null, -32700, 'Parse error');
      }

      if (!request || typeof request !== 'object' || Array.isArray(request) || typeof request.method !== 'string') {
        return mcpFailure(null, -32600, 'Invalid request');
      }

      try {
        return await handler.handle(request, context);
      } catch {
        // Never leak exception details to the client.
        return mcpFailure(request.id ?? null, -32603, 'Internal error');
      }
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
