import type { Express, Router, RequestHandler } from 'express';
import type { RouteMetadata } from './registry';
import { metadataRegistry } from './registry';

type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

/**
 * Registers a route and its AI metadata in a single call.
 *
 * @example
 * ```ts
 * aiRoute(app, 'post', '/api/orders', handler, aiTool({
 *   toolName: 'create_order',
 *   description: 'Creates an order',
 * }));
 * ```
 */
export function aiRoute(
  app: Express | Router,
  method: HttpMethod,
  path: string,
  handler: RequestHandler | RequestHandler[],
  metadata: RouteMetadata,
): void {
  // Register the route on the Express app/router
  (app as any)[method](path, handler);

  // Register AI metadata
  metadataRegistry.set(method.toUpperCase(), path, metadata);
}
