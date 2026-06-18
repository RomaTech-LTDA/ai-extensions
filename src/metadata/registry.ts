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
 * Global registry for AI route metadata.
 * Stores metadata keyed by METHOD + PATH.
 */
class MetadataRegistry {
  private readonly _entries = new Map<string, RouteMetadata>();

  private makeKey(method: string, path: string): string {
    return `${method.toUpperCase()}:${path}`;
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
