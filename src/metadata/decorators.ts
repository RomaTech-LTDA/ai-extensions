import { metadataRegistry, type RouteMetadata } from './registry';

/**
 * Metadata options for configuring AI exposure on a route.
 */
export interface AiRouteOptions {
  /** Custom tool name for MCP registration. */
  toolName?: string;
  /** Human-readable description for AI consumers. */
  description?: string;
  /** Category grouping for semantic organization. */
  category?: string;
  /** Required role for executing this tool. */
  role?: string;
  /** Rate limit in requests per minute. */
  rateLimit?: number;
  /** Priority for RAG context ranking (higher = more important). */
  contextPriority?: number;
}

/**
 * Marks a route as an executable MCP tool.
 */
export function aiTool(nameOrOptions?: string | AiRouteOptions): RouteMetadata {
  const metadata: RouteMetadata = { type: 'tool' };

  if (typeof nameOrOptions === 'string') {
    metadata.toolName = nameOrOptions;
  } else if (nameOrOptions) {
    metadata.toolName = nameOrOptions.toolName;
    metadata.description = nameOrOptions.description;
    metadata.category = nameOrOptions.category;
    metadata.role = nameOrOptions.role;
    metadata.rateLimit = nameOrOptions.rateLimit;
    metadata.contextPriority = nameOrOptions.contextPriority;
  }

  return metadata;
}

/**
 * Marks a route as hidden from AI systems.
 */
export function aiHidden(): RouteMetadata {
  return { type: 'hidden' };
}

/**
 * Marks a route as read-only (available for RAG but not executable).
 */
export function aiReadOnly(options?: Omit<AiRouteOptions, 'toolName'>): RouteMetadata {
  return {
    type: 'readonly',
    description: options?.description,
    category: options?.category,
    role: options?.role,
    contextPriority: options?.contextPriority,
  };
}

/**
 * Registers AI metadata for a specific route.
 * Use this to annotate routes declaratively.
 *
 * @example
 * ```ts
 * app.post('/api/orders', createOrder);
 * registerAiMetadata('POST', '/api/orders', aiTool('create_order'));
 * ```
 */
export function registerAiMetadata(method: string, path: string, metadata: RouteMetadata): void {
  metadataRegistry.set(method, path, metadata);
}
