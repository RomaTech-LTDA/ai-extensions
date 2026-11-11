import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import type { McpRequestHandler } from './request-handler';
import type { McpOptions } from './options';
import { assertMcpAuthConfigured, resolveMcpOptions } from './options';
import { authenticateMcpRequest, getHeader, isOriginAllowed, type McpHeaderSource } from './http-guard';
import { processMcpHttpRequest } from './http-pipeline';

/** Express middleware returned by `createSseTransport()`. */
export type McpSseTransport = ((req: Request, res: Response, next: NextFunction) => void) & {
  /** Ends every open SSE stream. Call it from your own shutdown handler. */
  close(): void;
};

/**
 * Creates an Express middleware that handles MCP over Server-Sent Events (SSE).
 * Provides a persistent connection for streaming MCP responses.
 *
 * Routes:
 * - GET  {route}/sse  — Opens an SSE connection
 * - POST {route}/message — Sends a message over the SSE connection
 *
 * Both routes enforce the Origin check and authentication (`apiKey` and/or `authenticate`,
 * unless `allowAnonymous: true`); the message route also requires `Content-Type: application/json`.
 * Session ids are random UUIDs, and a session is bound to the `Authorization` header that opened
 * it: a message carrying different credentials gets 404, so a caller who learns another client's
 * session id cannot post into (and read answers from) that stream. Notifications are accepted
 * with 202 and produce no SSE event.
 *
 * @throws Error when neither `apiKey`, `authenticate` nor `allowAnonymous: true` is configured.
 *
 * @example
 * ```ts
 * import { createSseTransport } from '@romatech/ai-extensions/mcp';
 *
 * const sse = createSseTransport(handler, { route: '/mcp', apiKey: process.env.MCP_API_KEY });
 * app.use(express.json());
 * app.use(sse);
 * process.on('SIGTERM', () => { sse.close(); server.close(); });
 * ```
 */
export function createSseTransport(
  handler: McpRequestHandler,
  options?: McpOptions,
): McpSseTransport {
  assertMcpAuthConfigured(options);
  const opts = resolveMcpOptions(options);
  const route = opts.route;
  const sseRoute = `${route}/sse`;
  const messageRoute = `${route}/message`;

  // Store active SSE connections with the fingerprint of the credentials that opened them
  const connections = new Map<string, { res: Response; owner: Buffer }>();

  const middleware = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // SSE connection endpoint
    if (req.path === sseRoute && req.method === 'GET') {
      if (!isOriginAllowed(req.headers.origin, opts)) {
        res.status(403).json({ error: 'Forbidden: origin not allowed' });
        return;
      }
      const auth = await authenticateMcpRequest({ method: 'GET', headers: req.headers, clientId: req.ip, raw: req }, opts);
      if (!auth.ok) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const sessionId = randomUUID();

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Session-Id': sessionId,
      });

      // Send endpoint info
      res.write(`event: endpoint\ndata: ${messageRoute}?sessionId=${sessionId}\n\n`);

      connections.set(sessionId, { res, owner: credentialFingerprint(req.headers) });

      // Heartbeat keep-alive (every 30s)
      const heartbeat = setInterval(() => {
        try {
          res.write(`: heartbeat\n\n`);
        } catch {
          clearInterval(heartbeat);
        }
      }, 30_000);
      heartbeat.unref?.();

      req.on('close', () => {
        clearInterval(heartbeat);
        connections.delete(sessionId);
      });

      return;
    }

    // Message endpoint
    if (req.path === messageRoute && req.method === 'POST') {
      const sessionId = typeof req.query.sessionId === 'string' ? req.query.sessionId : '';

      // The session is checked after authentication, so session ids cannot be probed anonymously.
      let missingSession = false;
      const outcome = await processMcpHttpRequest(
        handler,
        opts,
        { method: 'POST', headers: req.headers, clientId: req.ip, raw: req },
        () => {
          const session = connections.get(sessionId);
          if (!session || !timingSafeEqual(session.owner, credentialFingerprint(req.headers))) {
            missingSession = true;
            throw new Error('Session not found');
          }
          return req.body;
        },
      );

      if (missingSession) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }
      if (outcome.status !== 200) {
        for (const [name, value] of Object.entries(outcome.headers)) res.setHeader(name, value);
        if (outcome.body === undefined) res.status(outcome.status).end();
        else res.status(outcome.status).json(outcome.body);
        return;
      }

      // Send response over SSE
      connections.get(sessionId)?.res.write(`event: message\ndata: ${JSON.stringify(outcome.body)}\n\n`);
      res.status(202).json({ status: 'accepted' });
      return;
    }

    next();
  };

  // No process signal handlers here: adding SIGTERM/SIGINT listeners would replace
  // Node's default exit behaviour for the whole application.
  return Object.assign(middleware, {
    close(): void {
      for (const [, { res }] of connections) {
        res.end();
      }
      connections.clear();
    },
  });
}

/** SHA-256 of the caller's `Authorization` header (empty when absent), used to bind a session. */
function credentialFingerprint(headers: McpHeaderSource): Buffer {
  return createHash('sha256').update(getHeader(headers, 'authorization') ?? '').digest();
}
