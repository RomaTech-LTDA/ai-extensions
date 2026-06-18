import type { Express, Request, Response, NextFunction } from 'express';
import type { McpOptions } from './mcp/options';
import { DEFAULT_MCP_OPTIONS } from './mcp/options';
import type { RagOptions } from './rag/options';
import { MetadataDiscoveryProvider } from './discovery/metadata-discovery-provider';
import { McpToolRegistry } from './mcp/tool-registry';
import { McpToolExecutor } from './mcp/tool-executor';
import { McpRequestHandler } from './mcp/request-handler';
import { SlidingWindowRateLimiter } from './mcp/rate-limiter';
import { createMcpMiddleware } from './mcp/middleware';
import { LocalEmbeddingProvider } from './rag/local-embedding-provider';
import { SemanticIndexer } from './rag/semantic-indexer';
import { RagSearchService } from './rag/search-service';
import type { IEndpointDiscoveryProvider, IEmbeddingProvider } from './shared/models';

/**
 * Configuration options for the full AI enablement setup.
 */
export interface AiOptions {
  /** MCP configuration. */
  mcp?: McpOptions;
  /** RAG configuration. */
  rag?: RagOptions;
  /** Base URL for internal HTTP calls when executing tools. Default: http://localhost:3000 */
  baseUrl?: string;
  /** Custom discovery provider. Default: MetadataDiscoveryProvider */
  discoveryProvider?: IEndpointDiscoveryProvider;
  /** Custom embedding provider. Default: LocalEmbeddingProvider */
  embeddingProvider?: IEmbeddingProvider;
}

/**
 * Result of the AI setup containing references to services.
 */
export interface AiServices {
  /** MCP request handler for custom integrations. */
  mcpHandler: McpRequestHandler;
  /** MCP tool registry. */
  mcpRegistry: McpToolRegistry;
  /** RAG search service. */
  ragSearch: RagSearchService;
}

/**
 * Sets up AI enablement on an Express app.
 * Registers MCP middleware and initializes RAG services.
 *
 * @example
 * ```ts
 * import express from 'express';
 * import { useAi, registerAiMetadata, aiTool } from '@romatech/ai-extensions';
 *
 * const app = express();
 * app.use(express.json());
 *
 * app.post('/api/orders', createOrder);
 * registerAiMetadata('POST', '/api/orders', aiTool('create_order'));
 *
 * const { ragSearch } = useAi(app, { baseUrl: 'http://localhost:3000' });
 * ```
 */
export function useAi(app: Express, options?: AiOptions): AiServices {
  const baseUrl = options?.baseUrl ?? 'http://localhost:3000';
  const mcpOptions: Required<McpOptions> = { ...DEFAULT_MCP_OPTIONS, ...options?.mcp };

  // Discovery
  const discoveryProvider = options?.discoveryProvider ?? new MetadataDiscoveryProvider();

  // MCP
  const registry = new McpToolRegistry(discoveryProvider);
  const executor = new McpToolExecutor(baseUrl);
  const rateLimiter = new SlidingWindowRateLimiter();
  const handler = new McpRequestHandler(registry, executor, rateLimiter, mcpOptions);

  // RAG
  const embeddingProvider = options?.embeddingProvider ?? new LocalEmbeddingProvider();
  const indexer = new SemanticIndexer(embeddingProvider);
  const ragSearch = new RagSearchService(indexer, discoveryProvider, options?.rag);

  // Register MCP middleware
  app.use(createMcpMiddleware(handler, mcpOptions) as (req: Request, res: Response, next: NextFunction) => void);

  return {
    mcpHandler: handler,
    mcpRegistry: registry,
    ragSearch,
  };
}
