/**
 * Metadata associated with a route for AI exposure.
 */
export interface RouteMetadata {
  type: 'tool' | 'hidden' | 'readonly';
  toolName?: string;
  description?: string;
  category?: string;
  role?: string;
  rateLimit?: number;
  contextPriority?: number;
}

/**
 * Normalizes a route template to the OpenAPI form, converting Express/Koa/Fastify-style
 * `:param` segments to `{param}`, so metadata registered as `/orders/:id` also applies to
 * the `/orders/{id}` path found in the Swagger spec (otherwise `aiHidden()` would be ignored).
 */
export function normalizeRoutePath(path: string): string {
  return path.replace(/(?<=\/):([A-Za-z0-9_]+)/g, '{$1}');
}

/**
 * Splits a registry key (`METHOD:/path`) at the first colon only, so paths containing
 * `:` (Express params, `/items:batchGet`) stay intact.
 */
export function splitRegistryKey(key: string): [string, string] {
  const index = key.indexOf(':');
  return index < 0 ? [key, ''] : [key.slice(0, index), key.slice(index + 1)];
}

/**
 * Global registry for AI route metadata.
 * Stores metadata keyed by METHOD + PATH.
 */
class MetadataRegistry {
  private readonly _entries = new Map<string, RouteMetadata>();

  private makeKey(method: string, path: string): string {
    return `${method.toUpperCase()}:${normalizeRoutePath(path)}`;
  }

  set(method: string, path: string, metadata: RouteMetadata): void {
    this._entries.set(this.makeKey(method, path), metadata);
  }

  get(method: string, path: string): RouteMetadata | undefined {
    return this._entries.get(this.makeKey(method, path));
  }

  getAll(): Map<string, RouteMetadata> {
    return new Map(this._entries);
  }

  clear(): void {
    this._entries.clear();
  }
}

/** Singleton metadata registry instance. */
export const metadataRegistry = new MetadataRegistry();
