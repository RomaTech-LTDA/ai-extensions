import type { McpRequestHandler } from './request-handler';

/**
 * Multi-tenant MCP — routes requests to different handlers based on tenant.
 * Useful for SaaS where different API keys have access to different tools.
 *
 * @example
 * ```ts
 * const multiTenant = new McpMultiTenant();
 *
 * // Register handlers per tenant/API key
 * multiTenant.register('tenant-a-key', handlerA);
 * multiTenant.register('tenant-b-key', handlerB);
 *
 * // In middleware:
 * const handler = multiTenant.resolve(apiKey);
 * if (handler) {
 *     const response = await handler.handle(request);
 * }
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
