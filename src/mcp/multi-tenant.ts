import type { McpRequestHandler } from './request-handler';

/**
 * Lookup table from a tenant key to an `McpRequestHandler`.
 *
 * This is a building block only: `useAi()` and the adapters do **not** use it. You must
 * authenticate the caller and derive the tenant key yourself (never trust a tenant key taken
 * from the request without authentication), then route to the resolved handler, e.g. with
 * `processMcpHttpRequest()` in your own route.
 *
 * @example
 * ```ts
 * const multiTenant = new McpMultiTenant();
 * multiTenant.register('tenant-a', handlerA);
 * multiTenant.register('tenant-b', handlerB);
 *
 * app.post('/mcp', async (req, res) => {
 *     const tenant = await authenticateTenant(req);          // your own authentication
 *     const handler = tenant && multiTenant.resolve(tenant.id);
 *     if (!handler) return res.status(401).end();
 *     const outcome = await processMcpHttpRequest(handler, { authenticate: () => tenant },
 *         { method: req.method, headers: req.headers, clientId: req.ip, raw: req }, () => req.body);
 *     sendExpressOutcome(res, outcome);
 * });
 * ```
 */
export class McpMultiTenant {
  private readonly _handlers = new Map<string, McpRequestHandler>();
  private _defaultHandler?: McpRequestHandler;

  /**
   * Registers a handler for a specific tenant key.
   */
  register(tenantKey: string, handler: McpRequestHandler): void {
    this._handlers.set(tenantKey, handler);
  }

  /**
   * Sets the default handler (used when no tenant key matches).
   */
  setDefault(handler: McpRequestHandler): void {
    this._defaultHandler = handler;
  }

  /**
   * Resolves the handler for a given tenant key.
   */
  resolve(tenantKey: string): McpRequestHandler | undefined {
    return this._handlers.get(tenantKey) ?? this._defaultHandler;
  }

  /**
   * Removes a tenant.
   */
  remove(tenantKey: string): void {
    this._handlers.delete(tenantKey);
  }

  /** Number of registered tenants. */
  get count(): number {
    return this._handlers.size;
  }
}
